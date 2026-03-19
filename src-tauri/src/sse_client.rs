// ProtoForge SSE (Server-Sent Events) 客户端
// 基于 reqwest 的 EventSource 实现

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub type SseConnections = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>;

pub fn new_connections() -> SseConnections {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseConnectRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseEvent {
    pub id: Option<String>,
    pub event_type: String,
    pub data: String,
    pub timestamp: String,
}

/// 连接 SSE 端点
pub async fn connect(
    conn_id: String,
    req: SseConnectRequest,
    connections: SseConnections,
    app_handle: AppHandle,
) -> Result<(), String> {
    // 检查是否已连接
    {
        let conns = connections.lock().await;
        if conns.contains_key(&conn_id) {
            return Err("该连接已存在".to_string());
        }
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    // 保存取消 sender
    {
        let mut conns = connections.lock().await;
        conns.insert(conn_id.clone(), cancel_tx);
    }

    let client = reqwest::Client::new();
    let mut header_map = HeaderMap::new();
    header_map.insert("Accept", HeaderValue::from_static("text/event-stream"));
    header_map.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    for (k, v) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            header_map.insert(name, value);
        }
    }

    let url = req.url.clone();
    let connections_clone = connections.clone();
    let conn_id_clone = conn_id.clone();

    // 启动后台任务接收事件
    tokio::spawn(async move {
        let emit_event = |event: SseEvent| {
            let _ = app_handle.emit(&format!("sse-event-{}", conn_id_clone), &event);
        };
        let emit_status = |status: &str| {
            let _ = app_handle.emit(&format!("sse-status-{}", conn_id_clone), status);
        };

        emit_status("connecting");

        let response = match client.get(&url).headers(header_map).send().await {
            Ok(r) => r,
            Err(e) => {
                emit_status(&format!("error:{}", e));
                let mut conns = connections_clone.lock().await;
                conns.remove(&conn_id_clone);
                return;
            }
        };

        if !response.status().is_success() {
            emit_status(&format!("error:HTTP {}", response.status()));
            let mut conns = connections_clone.lock().await;
            conns.remove(&conn_id_clone);
            return;
        }

        emit_status("connected");

        // 使用 cancel_rx 来支持断开连接
        let mut cancel_rx = cancel_rx;
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        let mut buffer = String::new();
        let mut current_event_type = String::from("message");
        let mut current_id: Option<String> = None;
        let mut current_data = String::new();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    emit_status("disconnected");
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let text = String::from_utf8_lossy(&bytes);
                            buffer.push_str(&text);

                            // 按行解析 SSE 流
                            while let Some(line_end) = buffer.find('\n') {
                                let line = buffer[..line_end].trim_end_matches('\r').to_string();
                                buffer = buffer[line_end + 1..].to_string();

                                if line.is_empty() {
                                    // 空行 -> 派发事件
                                    if !current_data.is_empty() {
                                        let event = SseEvent {
                                            id: current_id.take(),
                                            event_type: std::mem::replace(&mut current_event_type, "message".to_string()),
                                            data: std::mem::take(&mut current_data),
                                            timestamp: chrono::Utc::now().to_rfc3339(),
                                        };
                                        emit_event(event);
                                    }
                                } else if let Some(value) = line.strip_prefix("data:") {
                                    if !current_data.is_empty() {
                                        current_data.push('\n');
                                    }
                                    current_data.push_str(value.trim_start());
                                } else if let Some(value) = line.strip_prefix("event:") {
                                    current_event_type = value.trim_start().to_string();
                                } else if let Some(value) = line.strip_prefix("id:") {
                                    current_id = Some(value.trim_start().to_string());
                                }
                                // ignore "retry:" and comments (":...")
                            }
                        }
                        Some(Err(e)) => {
                            emit_status(&format!("error:{}", e));
                            break;
                        }
                        None => {
                            emit_status("disconnected");
                            break;
                        }
                    }
                }
            }
        }

        // 清理
        let mut conns = connections_clone.lock().await;
        conns.remove(&conn_id_clone);
    });

    Ok(())
}

/// 断开 SSE 连接
pub async fn disconnect(conn_id: &str, connections: SseConnections) -> Result<(), String> {
    let mut conns = connections.lock().await;
    if let Some(cancel_tx) = conns.remove(conn_id) {
        let _ = cancel_tx.send(());
        Ok(())
    } else {
        Err("连接不存在".to_string())
    }
}
