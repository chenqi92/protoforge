// ProtoForge SSE (Server-Sent Events) 客户端
// 握手可取消且有超时，解析器对全部在途状态施加统一内存上限。

use bytes::BytesMut;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const SSE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SSE_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const SSE_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SSE_MEMORY: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SseLifecycle {
    Starting,
    Running,
    Stopping,
}

struct SseSlot {
    generation: u64,
    lifecycle: SseLifecycle,
    cancel: CancellationToken,
    finished: CancellationToken,
}

struct SseRegistry {
    entries: Mutex<HashMap<String, SseSlot>>,
    next_generation: AtomicU64,
}

#[derive(Clone)]
pub struct SseConnections {
    registry: Arc<SseRegistry>,
}

pub fn new_connections() -> SseConnections {
    SseConnections {
        registry: Arc::new(SseRegistry {
            entries: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(0),
        }),
    }
}

impl SseConnections {
    async fn reserve(
        &self,
        connection_id: &str,
    ) -> Result<(u64, CancellationToken, CancellationToken), String> {
        let mut entries = self.registry.entries.lock().await;
        if entries.contains_key(connection_id) {
            return Err("该连接已存在".into());
        }
        let generation = self
            .registry
            .next_generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        entries.insert(
            connection_id.to_string(),
            SseSlot {
                generation,
                lifecycle: SseLifecycle::Starting,
                cancel: cancel.clone(),
                finished: finished.clone(),
            },
        );
        Ok((generation, cancel, finished))
    }
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

#[derive(Debug, PartialEq, Eq)]
struct ParsedSseEvent {
    id: Option<String>,
    event_type: String,
    data: String,
}

struct SseParser {
    buffer: BytesMut,
    current_event_type: String,
    current_id: Option<String>,
    current_data: String,
    has_data: bool,
    memory_limit: usize,
}

impl SseParser {
    fn new(memory_limit: usize) -> Self {
        Self {
            buffer: BytesMut::new(),
            current_event_type: "message".into(),
            current_id: None,
            current_data: String::new(),
            has_data: false,
            memory_limit,
        }
    }

    fn memory_usage(&self) -> usize {
        self.buffer.len()
            + self.current_event_type.len()
            + self.current_id.as_ref().map_or(0, String::len)
            + self.current_data.len()
    }

    fn ensure_total(&self, total: usize) -> Result<(), String> {
        if total > self.memory_limit {
            Err(format!(
                "SSE 事件状态超过 {}MB 限制",
                self.memory_limit / 1024 / 1024
            ))
        } else {
            Ok(())
        }
    }

    fn replace_event_type(&mut self, value: String) -> Result<(), String> {
        let total = self
            .memory_usage()
            .saturating_sub(self.current_event_type.len())
            .checked_add(value.len())
            .ok_or_else(|| "SSE 事件状态大小溢出".to_string())?;
        self.ensure_total(total)?;
        self.current_event_type = value;
        Ok(())
    }

    fn replace_id(&mut self, value: String) -> Result<(), String> {
        let total = self
            .memory_usage()
            .saturating_sub(self.current_id.as_ref().map_or(0, String::len))
            .checked_add(value.len())
            .ok_or_else(|| "SSE 事件状态大小溢出".to_string())?;
        self.ensure_total(total)?;
        self.current_id = Some(value);
        Ok(())
    }

    fn append_data(&mut self, value: &str) -> Result<(), String> {
        let separator = usize::from(self.has_data);
        let total = self
            .memory_usage()
            .checked_add(separator)
            .and_then(|total| total.checked_add(value.len()))
            .ok_or_else(|| "SSE 事件状态大小溢出".to_string())?;
        self.ensure_total(total)?;
        if self.has_data {
            self.current_data.push('\n');
        }
        self.current_data.push_str(value);
        self.has_data = true;
        Ok(())
    }

    fn push_chunk(&mut self, chunk: &[u8]) -> Result<Vec<ParsedSseEvent>, String> {
        let total = self
            .memory_usage()
            .checked_add(chunk.len())
            .ok_or_else(|| "SSE 事件状态大小溢出".to_string())?;
        self.ensure_total(total)?;
        self.buffer.extend_from_slice(chunk);

        let mut events = Vec::new();
        while let Some(line_end) = self.buffer.iter().position(|byte| *byte == b'\n') {
            // split_to 只移动缓冲区视图，避免大量短行触发 Vec::drain 的 O(n²) 搬移。
            let mut line = self.buffer.split_to(line_end + 1);
            line.truncate(line_end);
            if line.last() == Some(&b'\r') {
                line.truncate(line.len() - 1);
            }

            if line.is_empty() {
                if self.has_data {
                    events.push(ParsedSseEvent {
                        id: self.current_id.take(),
                        event_type: std::mem::replace(
                            &mut self.current_event_type,
                            "message".into(),
                        ),
                        data: std::mem::take(&mut self.current_data),
                    });
                    self.has_data = false;
                }
                continue;
            }
            if line.first() == Some(&b':') {
                continue;
            }

            let (field, raw_value) = match line.iter().position(|byte| *byte == b':') {
                Some(index) => (&line[..index], &line[index + 1..]),
                None => (&line[..], &[][..]),
            };
            let raw_value = raw_value.strip_prefix(b" ").unwrap_or(raw_value);
            let value = String::from_utf8_lossy(raw_value);
            match field {
                b"data" => self.append_data(&value)?,
                b"event" => self.replace_event_type(value.into_owned())?,
                b"id" if !raw_value.contains(&0) => self.replace_id(value.into_owned())?,
                _ => {}
            }
        }
        Ok(events)
    }
}

struct FinishedGuard(CancellationToken);

impl Drop for FinishedGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

#[cfg(test)]
async fn sse_is_current(
    connections: &SseConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    connections
        .registry
        .entries
        .lock()
        .await
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn mark_sse_running(
    connections: &SseConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    let mut entries = connections.registry.entries.lock().await;
    let Some(slot) = entries.get_mut(connection_id) else {
        return false;
    };
    if slot.generation != generation || slot.lifecycle != SseLifecycle::Starting {
        return false;
    }
    slot.lifecycle = SseLifecycle::Running;
    true
}

async fn remove_sse_if_current(
    connections: &SseConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    let mut entries = connections.registry.entries.lock().await;
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

async fn emit_status_if_current(
    app: &AppHandle,
    connections: &SseConnections,
    connection_id: &str,
    generation: u64,
    status: &str,
) -> bool {
    let entries = connections.registry.entries.lock().await;
    if entries.get(connection_id).is_some_and(|slot| {
        slot.generation == generation
            && (slot.lifecycle != SseLifecycle::Stopping || status == "disconnected")
    }) {
        let _ = app.emit(&format!("sse-status-{}", connection_id), status);
        true
    } else {
        false
    }
}

async fn emit_event_if_current(
    app: &AppHandle,
    connections: &SseConnections,
    connection_id: &str,
    generation: u64,
    event: &SseEvent,
) -> bool {
    let entries = connections.registry.entries.lock().await;
    if entries.get(connection_id).is_some_and(|slot| {
        slot.generation == generation && slot.lifecycle == SseLifecycle::Running
    }) {
        let _ = app.emit(&format!("sse-event-{}", connection_id), event);
        true
    } else {
        false
    }
}

/// 连接 SSE 端点。命令在后台任务启动后返回，Starting 状态可被 disconnect 取消。
pub async fn connect(
    conn_id: String,
    req: SseConnectRequest,
    connections: SseConnections,
    app_handle: AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(SSE_CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("创建 SSE 客户端失败: {}", error))?;
    let mut header_map = HeaderMap::new();
    header_map.insert("Accept", HeaderValue::from_static("text/event-stream"));
    header_map.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    for (name, value) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            header_map.insert(name, value);
        }
    }

    let (generation, cancel, finished) = connections.reserve(&conn_id).await?;
    let finished_guard = FinishedGuard(finished);
    let url = req.url;
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        emit_status_if_current(
            &app_handle,
            &connections,
            &conn_id,
            generation,
            "connecting",
        )
        .await;

        let request = client.get(&url).headers(header_map).send();
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                emit_status_if_current(&app_handle, &connections, &conn_id, generation, "disconnected").await;
                remove_sse_if_current(&connections, &conn_id, generation).await;
                return;
            }
            result = tokio::time::timeout(SSE_HANDSHAKE_TIMEOUT, request) => match result {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => {
                    let status = if cancel.is_cancelled() {
                        "disconnected".to_string()
                    } else {
                        format!("error:{}", error)
                    };
                    emit_status_if_current(&app_handle, &connections, &conn_id, generation, &status).await;
                    remove_sse_if_current(&connections, &conn_id, generation).await;
                    return;
                }
                Err(_) => {
                    let status = if cancel.is_cancelled() {
                        "disconnected"
                    } else {
                        "error:SSE 握手超时"
                    };
                    emit_status_if_current(&app_handle, &connections, &conn_id, generation, status).await;
                    remove_sse_if_current(&connections, &conn_id, generation).await;
                    return;
                }
            }
        };

        if cancel.is_cancelled() || !mark_sse_running(&connections, &conn_id, generation).await {
            emit_status_if_current(
                &app_handle,
                &connections,
                &conn_id,
                generation,
                "disconnected",
            )
            .await;
            remove_sse_if_current(&connections, &conn_id, generation).await;
            return;
        }
        if !response.status().is_success() {
            let status = format!("error:HTTP {}", response.status());
            emit_status_if_current(&app_handle, &connections, &conn_id, generation, &status).await;
            remove_sse_if_current(&connections, &conn_id, generation).await;
            return;
        }

        emit_status_if_current(&app_handle, &connections, &conn_id, generation, "connected").await;
        let mut stream = response.bytes_stream();
        let mut parser = SseParser::new(MAX_SSE_MEMORY);
        let terminal_status = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break "disconnected".to_string(),
                chunk = stream.next() => match chunk {
                    Some(Ok(bytes)) => match parser.push_chunk(&bytes) {
                        Ok(events) => {
                            for event in events {
                                let event = SseEvent {
                                    id: event.id,
                                    event_type: event.event_type,
                                    data: event.data,
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                };
                                if !emit_event_if_current(
                                    &app_handle,
                                    &connections,
                                    &conn_id,
                                    generation,
                                    &event,
                                ).await {
                                    break;
                                }
                            }
                        }
                        Err(error) => break format!("error:{}", error),
                    },
                    Some(Err(error)) => break format!("error:{}", error),
                    None => break "disconnected".to_string(),
                }
            }
        };

        emit_status_if_current(
            &app_handle,
            &connections,
            &conn_id,
            generation,
            &terminal_status,
        )
        .await;
        remove_sse_if_current(&connections, &conn_id, generation).await;
    });
    Ok(())
}

/// 断开 SSE 连接。等待后台任务确认取消，防止旧任务的状态污染紧随其后的重连。
pub async fn disconnect(conn_id: &str, connections: SseConnections) -> Result<(), String> {
    let (generation, cancel, finished) = {
        let mut entries = connections.registry.entries.lock().await;
        let slot = entries
            .get_mut(conn_id)
            .ok_or_else(|| "连接不存在".to_string())?;
        slot.lifecycle = SseLifecycle::Stopping;
        (slot.generation, slot.cancel.clone(), slot.finished.clone())
    };
    cancel.cancel();
    let _ = tokio::time::timeout(SSE_STOP_TIMEOUT, finished.cancelled()).await;
    remove_sse_if_current(&connections, conn_id, generation).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accumulates_newline_data_without_bypassing_cap() {
        let mut parser = SseParser::new(24);
        // 默认 event type 占 7 字节，其余 data 行跨换行累计后超过总上限。
        assert!(parser.push_chunk(b"data: 12345678\n").is_ok());
        let error = parser.push_chunk(b"data: abcdefgh\n").unwrap_err();
        assert!(error.contains("限制"));
        assert!(parser.memory_usage() <= 24);
    }

    #[test]
    fn parser_caps_unterminated_input_and_all_metadata() {
        let mut parser = SseParser::new(32);
        assert!(parser.push_chunk(b"event: custom\n").is_ok());
        assert!(parser.push_chunk(b"id: identifier\n").is_ok());
        assert!(parser.push_chunk(b"01234567890123456789").is_err());
        assert!(parser.memory_usage() <= 32);
    }

    #[test]
    fn parser_dispatches_empty_data_and_crlf() {
        let mut parser = SseParser::new(128);
        let events = parser
            .push_chunk(b"id: 7\r\nevent: ping\r\ndata:\r\n\r\n")
            .unwrap();
        assert_eq!(
            events,
            vec![ParsedSseEvent {
                id: Some("7".into()),
                event_type: "ping".into(),
                data: String::new(),
            }]
        );
    }

    #[tokio::test]
    async fn generation_cleanup_cannot_remove_new_connection() {
        let connections = new_connections();
        let (first, _, _) = connections.reserve("same-id").await.unwrap();
        assert!(remove_sse_if_current(&connections, "same-id", first).await);
        let (second, _, _) = connections.reserve("same-id").await.unwrap();
        assert_ne!(first, second);
        assert!(!remove_sse_if_current(&connections, "same-id", first).await);
        assert!(sse_is_current(&connections, "same-id", second).await);
    }

    #[tokio::test]
    async fn disconnect_waits_for_cancelled_task_cleanup() {
        let connections = new_connections();
        let (generation, cancel, finished) = connections.reserve("pending").await.unwrap();
        let worker_connections = connections.clone();
        tokio::spawn(async move {
            cancel.cancelled().await;
            remove_sse_if_current(&worker_connections, "pending", generation).await;
            finished.cancel();
        });
        disconnect("pending", connections.clone()).await.unwrap();
        assert!(connections.registry.entries.lock().await.is_empty());
    }

    #[tokio::test]
    async fn concurrent_reservation_is_rejected() {
        let connections = new_connections();
        connections.reserve("same-id").await.unwrap();
        assert!(connections.reserve("same-id").await.is_err());
    }
}
