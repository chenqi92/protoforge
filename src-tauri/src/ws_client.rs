// WebSocket 客户端模块
// 使用 Starting 占位和代际 CAS，避免并发连接/断开留下幽灵连接。

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_util::sync::CancellationToken;

const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const WS_CLOSE_TIMEOUT: Duration = Duration::from_secs(1);
const WS_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const WS_SEND_QUEUE_CAPACITY: usize = 32;
const MAX_WS_MESSAGE_SIZE: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsEvent {
    pub connection_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<usize>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

enum WsCmd {
    Text(String),
    Binary(Vec<u8>),
}

struct WsSlot {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
    /// `None` 表示 Starting。
    sender: Option<mpsc::Sender<WsCmd>>,
}

pub struct WsConnections {
    connections: Arc<Mutex<HashMap<String, WsSlot>>>,
    next_generation: AtomicU64,
}

impl WsConnections {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(0),
        }
    }

    async fn reserve(&self, connection_id: &str) -> (u64, CancellationToken, FinishedGuard) {
        let generation = self
            .next_generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        let finished_guard = FinishedGuard(finished.clone());
        let replaced = self.connections.lock().await.insert(
            connection_id.to_string(),
            WsSlot {
                generation,
                cancel: cancel.clone(),
                finished: finished.clone(),
                sender: None,
            },
        );
        if let Some(slot) = replaced {
            slot.cancel.cancel();
            let _ = tokio::time::timeout(WS_STOP_TIMEOUT, slot.finished.cancelled()).await;
        }
        (generation, cancel, finished_guard)
    }
}

struct FinishedGuard(CancellationToken);

impl Drop for FinishedGuard {
    fn drop(&mut self) {
        self.0.cancel();
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

#[cfg(test)]
async fn ws_is_current(
    connections: &Arc<Mutex<HashMap<String, WsSlot>>>,
    connection_id: &str,
    generation: u64,
) -> bool {
    connections
        .lock()
        .await
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn emit_ws_if_current(
    app: &tauri::AppHandle,
    connections: &Arc<Mutex<HashMap<String, WsSlot>>>,
    connection_id: &str,
    generation: u64,
    event: WsEvent,
) -> bool {
    let entries = connections.lock().await;
    if entries
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        let _ = app.emit("ws-event", event);
        true
    } else {
        false
    }
}

async fn remove_ws_if_current(
    connections: &Arc<Mutex<HashMap<String, WsSlot>>>,
    connection_id: &str,
    generation: u64,
) -> bool {
    let mut entries = connections.lock().await;
    if entries
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        entries.remove(connection_id);
        true
    } else {
        false
    }
}

fn ensure_message_size(size: usize) -> Result<(), String> {
    if size > MAX_WS_MESSAGE_SIZE {
        Err(format!(
            "WebSocket 消息超过 {}MB 限制",
            MAX_WS_MESSAGE_SIZE / 1024 / 1024
        ))
    } else {
        Ok(())
    }
}

/// 建立 WebSocket 连接（支持自定义 Headers）。
pub async fn connect(
    app: tauri::AppHandle,
    connections: &WsConnections,
    connection_id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("构建请求失败: {}", error))?;

    let mut reserved_header_conflict = false;
    if let Some(headers) = &headers {
        for (name, value) in headers {
            if is_reserved_ws_header(name) {
                reserved_header_conflict = true;
                continue;
            }
            let name = http::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| format!("无效的请求头名称 {}: {}", name, error))?;
            let value = http::HeaderValue::from_str(value)
                .map_err(|error| format!("无效的请求头值 {}: {}", name, error))?;
            request.headers_mut().insert(name, value);
        }
    }

    let (generation, cancel, finished_guard) = connections.reserve(&connection_id).await;
    let config = WebSocketConfig::default()
        .read_buffer_size(16 * 1024)
        .write_buffer_size(16 * 1024)
        .max_write_buffer_size(MAX_WS_MESSAGE_SIZE + 32 * 1024)
        .max_message_size(Some(MAX_WS_MESSAGE_SIZE))
        .max_frame_size(Some(MAX_WS_MESSAGE_SIZE));
    let connect_future = tokio_tungstenite::connect_async_with_config(request, Some(config), false);

    let (stream, _) = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("WebSocket 连接已取消".into()),
        result = tokio::time::timeout(WS_CONNECT_TIMEOUT, connect_future) => {
            match result {
                Ok(Ok(value)) => value,
                Ok(Err(error)) => {
                    remove_ws_if_current(&connections.connections, &connection_id, generation).await;
                    let message = error.to_string();
                    if reserved_header_conflict
                        && message.to_ascii_lowercase().contains("sec-websocket-key")
                    {
                        return Err("WebSocket 连接失败: 握手头冲突。请移除自定义请求头中的保留握手字段，例如 Sec-WebSocket-Key / Connection / Upgrade。".into());
                    }
                    return Err(format!("WebSocket 连接失败: {}", error));
                }
                Err(_) => {
                    remove_ws_if_current(&connections.connections, &connection_id, generation).await;
                    return Err("WebSocket 连接超时".into());
                }
            }
        }
    };

    let (mut writer, mut reader) = stream.split();
    let (sender, mut receiver) = mpsc::channel(WS_SEND_QUEUE_CAPACITY);

    // guardian 在提交前接管完成守卫，避免 stop 卡在尚未 spawn 的局部资源上。
    let (start_tx, start_rx) = oneshot::channel();
    let task_finished = CancellationToken::new();
    let guardian_cancel = cancel.clone();
    let guardian_task_finished = task_finished.clone();
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        let started = tokio::select! {
            biased;
            _ = guardian_cancel.cancelled() => false,
            result = start_rx => result.is_ok(),
        };
        if started {
            guardian_task_finished.cancelled().await;
        }
    });

    {
        let mut entries = connections.connections.lock().await;
        let Some(slot) = entries.get_mut(&connection_id) else {
            return Err("WebSocket 连接已取消".into());
        };
        if slot.generation != generation || cancel.is_cancelled() {
            return Err("WebSocket 连接已取消".into());
        }
        slot.sender = Some(sender);
        if start_tx.send(()).is_err() {
            entries.remove(&connection_id);
            return Err("WebSocket 连接任务启动失败".into());
        }
        let _ = app.emit(
            "ws-event",
            WsEvent {
                connection_id: connection_id.clone(),
                event_type: "connected".into(),
                data: Some(url),
                data_type: None,
                size: None,
                timestamp: now_iso(),
                reason: None,
            },
        );
    }

    let entries = connections.connections.clone();
    tokio::spawn(async move {
        let _task_finished_guard = FinishedGuard(task_finished);
        let mut reason = "normal".to_string();
        let mut disconnect_data = None;
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    let _ = tokio::time::timeout(WS_CLOSE_TIMEOUT, writer.close()).await;
                    break;
                }
                command = receiver.recv() => {
                    let Some(command) = command else { break };
                    let message = match command {
                        WsCmd::Text(text) => Message::Text(text.into()),
                        WsCmd::Binary(bytes) => Message::Binary(bytes.into()),
                    };
                    let result = tokio::select! {
                        biased;
                        _ = cancel.cancelled() => break,
                        result = writer.send(message) => result,
                    };
                    if let Err(error) = result {
                        reason = "error".into();
                        disconnect_data = Some(error.to_string());
                        emit_ws_if_current(
                            &app,
                            &entries,
                            &connection_id,
                            generation,
                            WsEvent {
                                connection_id: connection_id.clone(),
                                event_type: "error".into(),
                                data: Some(error.to_string()),
                                data_type: None,
                                size: None,
                                timestamp: now_iso(),
                                reason: None,
                            },
                        ).await;
                        break;
                    }
                }
                incoming = reader.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            let text = text.to_string();
                            let size = text.len();
                            if !emit_ws_if_current(
                                &app,
                                &entries,
                                &connection_id,
                                generation,
                                WsEvent {
                                    connection_id: connection_id.clone(),
                                    event_type: "message".into(),
                                    data: Some(text),
                                    data_type: Some("text".into()),
                                    size: Some(size),
                                    timestamp: now_iso(),
                                    reason: None,
                                },
                            ).await {
                                break;
                            }
                        }
                        Some(Ok(Message::Binary(bytes))) => {
                            let size = bytes.len();
                            let data = bytes
                                .iter()
                                .map(|byte| format!("{:02x}", byte))
                                .collect::<Vec<_>>()
                                .join(" ");
                            if !emit_ws_if_current(
                                &app,
                                &entries,
                                &connection_id,
                                generation,
                                WsEvent {
                                    connection_id: connection_id.clone(),
                                    event_type: "message".into(),
                                    data: Some(data),
                                    data_type: Some("binary".into()),
                                    size: Some(size),
                                    timestamp: now_iso(),
                                    reason: None,
                                },
                            ).await {
                                break;
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            let result = tokio::select! {
                                biased;
                                _ = cancel.cancelled() => break,
                                result = writer.send(Message::Pong(payload)) => result,
                            };
                            if result.is_err() {
                                reason = "error".into();
                                break;
                            }
                        }
                        Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                        Some(Ok(Message::Close(_))) => {
                            reason = "server_close".into();
                            disconnect_data = Some("服务器关闭连接".into());
                            break;
                        }
                        Some(Err(error)) => {
                            reason = "error".into();
                            disconnect_data = Some(error.to_string());
                            emit_ws_if_current(
                                &app,
                                &entries,
                                &connection_id,
                                generation,
                                WsEvent {
                                    connection_id: connection_id.clone(),
                                    event_type: "error".into(),
                                    data: Some(error.to_string()),
                                    data_type: None,
                                    size: None,
                                    timestamp: now_iso(),
                                    reason: None,
                                },
                            ).await;
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        if remove_ws_if_current(&entries, &connection_id, generation).await {
            let _ = app.emit(
                "ws-event",
                WsEvent {
                    connection_id,
                    event_type: "disconnected".into(),
                    data: disconnect_data,
                    data_type: None,
                    size: None,
                    timestamp: now_iso(),
                    reason: Some(reason),
                },
            );
        }
    });

    Ok(())
}

pub async fn send(
    connections: &WsConnections,
    connection_id: &str,
    message: String,
) -> Result<(), String> {
    ensure_message_size(message.len())?;
    let sender = connections
        .connections
        .lock()
        .await
        .get(connection_id)
        .and_then(|slot| slot.sender.clone())
        .ok_or_else(|| "连接不存在或仍在建立".to_string())?;
    sender
        .send(WsCmd::Text(message))
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

pub async fn send_binary(
    connections: &WsConnections,
    connection_id: &str,
    data: Vec<u8>,
) -> Result<(), String> {
    ensure_message_size(data.len())?;
    let sender = connections
        .connections
        .lock()
        .await
        .get(connection_id)
        .and_then(|slot| slot.sender.clone())
        .ok_or_else(|| "连接不存在或仍在建立".to_string())?;
    sender
        .send(WsCmd::Binary(data))
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

pub async fn disconnect(connections: &WsConnections, connection_id: &str) -> Result<(), String> {
    let removed = {
        let mut entries = connections.connections.lock().await;
        entries.remove(connection_id)
    };
    if let Some(slot) = removed {
        slot.cancel.cancel();
        let _ = tokio::time::timeout(WS_STOP_TIMEOUT, slot.finished.cancelled()).await;
    }
    Ok(())
}

pub async fn is_connected(
    connections: &WsConnections,
    connection_id: &str,
) -> Result<bool, String> {
    Ok(connections
        .connections
        .lock()
        .await
        .get(connection_id)
        .is_some_and(|slot| slot.sender.is_some()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn generation_cas_does_not_remove_replacement() {
        let connections = WsConnections::new();
        let (first, first_cancel, first_guard) = connections.reserve("same-id").await;
        drop(first_guard);
        let (second, _, _second_guard) = connections.reserve("same-id").await;
        assert!(first_cancel.is_cancelled());
        assert!(!remove_ws_if_current(&connections.connections, "same-id", first).await);
        assert!(ws_is_current(&connections.connections, "same-id", second).await);
    }

    #[tokio::test]
    async fn disconnect_cancels_starting_handshake() {
        let connections = WsConnections::new();
        let (_, cancel, guard) = connections.reserve("pending").await;
        drop(guard);
        disconnect(&connections, "pending").await.unwrap();
        assert!(cancel.is_cancelled());
        assert!(connections.connections.lock().await.is_empty());
    }

    #[test]
    fn outbound_messages_are_bounded() {
        assert!(ensure_message_size(MAX_WS_MESSAGE_SIZE).is_ok());
        assert!(ensure_message_size(MAX_WS_MESSAGE_SIZE + 1).is_err());
    }

    #[test]
    fn websocket_internal_headers_are_reserved_case_insensitively() {
        assert!(is_reserved_ws_header("Sec-WebSocket-Key"));
        assert!(is_reserved_ws_header("connection"));
        assert!(!is_reserved_ws_header("Authorization"));
    }
}
