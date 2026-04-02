// WebSocket 客户端模块
// 使用 tokio-tungstenite 实现异步 WebSocket 连接

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http;

/// WebSocket 事件（后端 → 前端推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsEvent {
    pub connection_id: String,
    pub event_type: String, // "connected" | "message" | "disconnected" | "error"
    pub data: Option<String>,
    pub data_type: Option<String>, // "text" | "binary"
    pub size: Option<usize>,
    pub timestamp: String,
    pub reason: Option<String>, // "normal" | "error" | "server_close" (仅 disconnected 事件携带)
}

/// 发送命令
enum WsCmd {
    Text(String),
    Binary(Vec<u8>),
}

/// 单个连接的发送通道
pub(crate) struct WsHandle {
    sender: mpsc::Sender<WsCmd>,
    abort_handle: tokio::task::AbortHandle,
}

/// 全局 WebSocket 连接管理器
pub struct WsConnections {
    pub connections: Arc<Mutex<HashMap<String, WsHandle>>>,
}

impl WsConnections {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn is_reserved_ws_header(header_name: &str) -> bool {
    matches!(
        header_name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "upgrade"
            | "sec-websocket-key"
            | "sec-websocket-version"
            | "sec-websocket-extensions"
            | "sec-websocket-accept"
    )
}

/// 建立 WebSocket 连接（支持自定义 Headers）
pub async fn connect(
    app: tauri::AppHandle,
    connections: &WsConnections,
    connection_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    // 先断开已有同 id 连接
    disconnect(connections, &connection_id).await.ok();

    // 使用标准 WebSocket 客户端请求，保留库自动生成的握手头
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("构建请求失败: {}", e))?;

    let mut reserved_header_conflict = false;
    if let Some(hdrs) = &headers {
        for (k, v) in hdrs {
            if is_reserved_ws_header(k) {
                reserved_header_conflict = true;
                continue;
            }
            let header_name = http::header::HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("无效的请求头名称 {}: {}", k, e))?;
            let header_value = http::HeaderValue::from_str(v)
                .map_err(|e| format!("无效的请求头值 {}: {}", k, e))?;
            request.headers_mut().insert(header_name, header_value);
        }
    }

    let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| {
            let message = e.to_string();
            if reserved_header_conflict && message.to_ascii_lowercase().contains("sec-websocket-key") {
                "WebSocket 连接失败: 握手头冲突。请移除自定义请求头中的保留握手字段，例如 Sec-WebSocket-Key / Connection / Upgrade。".to_string()
            } else {
                format!("WebSocket 连接失败: {}", e)
            }
        })?;

    let (mut write, mut read) = ws_stream.split();

    // 创建发送通道
    let (tx, mut rx) = mpsc::channel::<WsCmd>(256);

    // 通知前端已连接
    let _ = app.emit(
        "ws-event",
        WsEvent {
            connection_id: connection_id.clone(),
            event_type: "connected".into(),
            data: Some(url.clone()),
            data_type: None,
            size: None,
            timestamp: now_iso(),
            reason: None,
        },
    );

    let cid = connection_id.clone();
    let app_clone = app.clone();
    let conns = connections.connections.clone();

    // spawn 后台任务处理读写
    let task = tokio::spawn(async move {
        // spawn 写入子任务
        let write_task = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                let msg = match cmd {
                    WsCmd::Text(s) => Message::Text(s.into()),
                    WsCmd::Binary(b) => Message::Binary(b.into()),
                };
                if write.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // 读取循环
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(msg) => {
                    let (data, data_type, size) = match &msg {
                        Message::Text(t) => {
                            let text: String = t.to_string();
                            let len = text.len();
                            (Some(text), Some("text".to_string()), Some(len))
                        }
                        Message::Binary(b) => {
                            // 转为 hex 显示
                            let hex: String = b
                                .iter()
                                .map(|byte| format!("{:02x} ", byte))
                                .collect::<String>()
                                .trim()
                                .to_string();
                            let len = b.len();
                            (Some(hex), Some("binary".to_string()), Some(len))
                        }
                        Message::Close(_) => {
                            // 服务器主动关闭
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    connection_id: cid.clone(),
                                    event_type: "disconnected".into(),
                                    data: Some("服务器关闭连接".into()),
                                    data_type: None,
                                    size: None,
                                    timestamp: now_iso(),
                                    reason: Some("server_close".into()),
                                },
                            );
                            conns.lock().await.remove(&cid);
                            return; // 直接返回，不再发送下方的 disconnected 事件
                        }
                        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
                    };

                    let _ = app_clone.emit(
                        "ws-event",
                        WsEvent {
                            connection_id: cid.clone(),
                            event_type: "message".into(),
                            data,
                            data_type,
                            size,
                            timestamp: now_iso(),
                            reason: None,
                        },
                    );
                }
                Err(e) => {
                    let _ = app_clone.emit(
                        "ws-event",
                        WsEvent {
                            connection_id: cid.clone(),
                            event_type: "error".into(),
                            data: Some(e.to_string()),
                            data_type: None,
                            size: None,
                            timestamp: now_iso(),
                            reason: None,
                        },
                    );
                    // 异常断开，发送 reason = "error"
                    let _ = app_clone.emit(
                        "ws-event",
                        WsEvent {
                            connection_id: cid.clone(),
                            event_type: "disconnected".into(),
                            data: Some(e.to_string()),
                            data_type: None,
                            size: None,
                            timestamp: now_iso(),
                            reason: Some("error".into()),
                        },
                    );
                    conns.lock().await.remove(&cid);
                    return;
                }
            }
        }

        // 正常断开（读取循环自然结束）
        write_task.abort();
        let _ = app_clone.emit(
            "ws-event",
            WsEvent {
                connection_id: cid.clone(),
                event_type: "disconnected".into(),
                data: None,
                data_type: None,
                size: None,
                timestamp: now_iso(),
                reason: Some("normal".into()),
            },
        );

        // 从连接池移除
        conns.lock().await.remove(&cid);
    });

    let handle = WsHandle {
        sender: tx,
        abort_handle: task.abort_handle(),
    };

    connections
        .connections
        .lock()
        .await
        .insert(connection_id, handle);

    Ok(())
}

/// 发送 WebSocket 文本消息
pub async fn send(
    connections: &WsConnections,
    connection_id: &str,
    message: String,
) -> Result<(), String> {
    let conns = connections.connections.lock().await;
    let handle = conns
        .get(connection_id)
        .ok_or_else(|| "连接不存在或已断开".to_string())?;

    handle
        .sender
        .send(WsCmd::Text(message))
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

/// 发送 WebSocket 二进制消息
pub async fn send_binary(
    connections: &WsConnections,
    connection_id: &str,
    data: Vec<u8>,
) -> Result<(), String> {
    let conns = connections.connections.lock().await;
    let handle = conns
        .get(connection_id)
        .ok_or_else(|| "连接不存在或已断开".to_string())?;

    handle
        .sender
        .send(WsCmd::Binary(data))
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

/// 断开 WebSocket 连接
pub async fn disconnect(connections: &WsConnections, connection_id: &str) -> Result<(), String> {
    let mut conns = connections.connections.lock().await;
    if let Some(handle) = conns.remove(connection_id) {
        handle.abort_handle.abort();
    }
    Ok(())
}

pub async fn is_connected(
    connections: &WsConnections,
    connection_id: &str,
) -> Result<bool, String> {
    let conns = connections.connections.lock().await;
    Ok(conns.contains_key(connection_id))
}
