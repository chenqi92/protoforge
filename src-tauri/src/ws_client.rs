// WebSocket 客户端模块
// 使用 tokio-tungstenite 实现异步 WebSocket 连接

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;
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
}

/// 发送命令
enum WsCmd {
    Text(String),
    Binary(Vec<u8>),
}

/// 单个连接的发送通道
struct WsHandle {
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

    // 构造带 headers 的请求
    let mut req_builder = http::Request::builder().uri(&url);
    if let Some(hdrs) = &headers {
        for (k, v) in hdrs {
            req_builder = req_builder.header(k.as_str(), v.as_str());
        }
    }
    let request = req_builder.body(()).map_err(|e| format!("构建请求失败: {}", e))?;

    let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

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
                            let hex: String = b.iter().map(|byte| format!("{:02x} ", byte)).collect::<String>().trim().to_string();
                            let len = b.len();
                            (Some(hex), Some("binary".to_string()), Some(len))
                        }
                        Message::Close(_) => {
                            break;
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
                        },
                    );
                    break;
                }
            }
        }

        // 连接结束
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
