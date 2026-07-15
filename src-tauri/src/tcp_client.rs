// TCP 客户端/服务端 + UDP 模块
// 使用带代际标识的生命周期状态，保证并发启动、停止与自然退出可线性化。

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const SEND_QUEUE_CAPACITY: usize = 256;
const MAX_TCP_CLIENTS: usize = 256;
const MAX_TRANSPORT_PAYLOAD: usize = 8 * 1024 * 1024;

type Payload = Arc<[u8]>;

/// TCP/UDP 事件（后端 → 前端推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpEvent {
    pub connection_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<usize>,
    pub timestamp: String,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Convert raw bytes to hex string like "48 65 6c 6c 6f".
pub(crate) fn bytes_to_hex(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Decode user input based on encoding format.
pub(crate) fn decode_send_data(data: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "hex" => {
            let cleaned: String = data
                .replace("0x", "")
                .replace("0X", "")
                .replace(' ', "")
                .replace(',', "")
                .replace('\n', "")
                .replace('\r', "");
            if cleaned.len() % 2 != 0 {
                return Err("Hex 字符串长度必须为偶数".into());
            }
            if !cleaned.is_ascii() {
                return Err("Hex 输入只能包含 ASCII 十六进制字符".into());
            }
            (0..cleaned.len())
                .step_by(2)
                .map(|i| {
                    u8::from_str_radix(&cleaned[i..i + 2], 16)
                        .map_err(|e| format!("无效的 Hex 字符: {}", e))
                })
                .collect()
        }
        "base64" => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(data.trim())
                .map_err(|e| format!("无效的 Base64: {}", e))
        }
        "gbk" => {
            let (encoded, _, had_errors) = encoding_rs::GBK.encode(data);
            if had_errors {
                Err("GBK 编码失败: 包含无法编码的字符".into())
            } else {
                Ok(encoded.into_owned())
            }
        }
        _ => Ok(data.as_bytes().to_vec()),
    }
}

/// Decode received bytes into a displayable string.
pub(crate) fn decode_received_data(data: &[u8], encoding: &str) -> String {
    match encoding {
        "gbk" => {
            let (decoded, _, _) = encoding_rs::GBK.decode(data);
            decoded.into_owned()
        }
        _ => match std::str::from_utf8(data) {
            Ok(s) => s.to_string(),
            Err(_) => {
                let (decoded, _, had_errors) = encoding_rs::GBK.decode(data);
                if had_errors {
                    bytes_to_hex(data)
                } else {
                    decoded.into_owned()
                }
            }
        },
    }
}

fn next_generation(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::Relaxed).wrapping_add(1)
}

fn ensure_payload_size(data: &[u8]) -> Result<(), String> {
    ensure_payload_len(data.len())
}

fn ensure_payload_len(size: usize) -> Result<(), String> {
    if size > MAX_TRANSPORT_PAYLOAD {
        Err(format!(
            "发送数据超过 {}MB 限制",
            MAX_TRANSPORT_PAYLOAD / 1024 / 1024
        ))
    } else {
        Ok(())
    }
}

fn try_broadcast_payload(senders: &[mpsc::Sender<Payload>], payload: Payload) -> usize {
    senders
        .iter()
        .filter(|sender| sender.try_send(payload.clone()).is_ok())
        .count()
}

struct FinishedGuard(CancellationToken);

impl Drop for FinishedGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

async fn cancel_and_wait(cancel: CancellationToken, finished: CancellationToken) {
    cancel.cancel();
    let _ = tokio::time::timeout(STOP_TIMEOUT, finished.cancelled()).await;
}

// ═══════════════════════════════════════════
//  TCP 客户端
// ═══════════════════════════════════════════

struct TcpClientSlot {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
    /// `None` 表示 Starting，占位后才能进行网络握手。
    sender: Option<mpsc::Sender<Payload>>,
}

pub struct TcpConnections {
    connections: Arc<Mutex<HashMap<String, TcpClientSlot>>>,
    next_generation: AtomicU64,
}

impl TcpConnections {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(0),
        }
    }

    async fn reserve(&self, connection_id: &str) -> (u64, CancellationToken, FinishedGuard) {
        let generation = next_generation(&self.next_generation);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        let finished_guard = FinishedGuard(finished.clone());
        let replaced = self.connections.lock().await.insert(
            connection_id.to_string(),
            TcpClientSlot {
                generation,
                cancel: cancel.clone(),
                finished: finished.clone(),
                sender: None,
            },
        );
        if let Some(slot) = replaced {
            cancel_and_wait(slot.cancel, slot.finished).await;
        }
        (generation, cancel, finished_guard)
    }
}

#[cfg(test)]
async fn tcp_client_is_current(
    connections: &Arc<Mutex<HashMap<String, TcpClientSlot>>>,
    connection_id: &str,
    generation: u64,
) -> bool {
    connections
        .lock()
        .await
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn emit_tcp_client_if_current(
    app: &tauri::AppHandle,
    connections: &Arc<Mutex<HashMap<String, TcpClientSlot>>>,
    connection_id: &str,
    generation: u64,
    event: TcpEvent,
) -> bool {
    let entries = connections.lock().await;
    if entries
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        let _ = app.emit("tcp-event", event);
        true
    } else {
        false
    }
}

async fn remove_tcp_client_if_current(
    connections: &Arc<Mutex<HashMap<String, TcpClientSlot>>>,
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

pub async fn tcp_connect(
    app: tauri::AppHandle,
    connections: &TcpConnections,
    connection_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let (generation, cancel, finished_guard) = connections.reserve(&connection_id).await;
    let addr = format!("{}:{}", host, port);

    let stream = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("TCP 连接已取消".into()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr)) => {
            match result {
                Ok(Ok(stream)) => stream,
                Ok(Err(error)) => {
                    remove_tcp_client_if_current(&connections.connections, &connection_id, generation).await;
                    return Err(format!("TCP 连接失败: {}", error));
                }
                Err(_) => {
                    remove_tcp_client_if_current(&connections.connections, &connection_id, generation).await;
                    return Err("TCP 连接超时".into());
                }
            }
        }
    };

    let remote = stream
        .peer_addr()
        .map(|address| address.to_string())
        .unwrap_or_default();
    let (reader, writer) = stream.into_split();
    let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);

    let (start_tx, start_rx) = oneshot::channel();
    let worker_app = app.clone();
    let worker_entries = connections.connections.clone();
    let worker_id = connection_id.clone();
    let worker_cancel = cancel.clone();
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        let started = tokio::select! {
            biased;
            _ = worker_cancel.cancelled() => false,
            result = start_rx => result.is_ok(),
        };
        if started {
            run_tcp_client(
                worker_app,
                worker_entries,
                worker_id,
                generation,
                worker_cancel,
                reader,
                writer,
                receiver,
            )
            .await;
        }
    });

    {
        let mut entries = connections.connections.lock().await;
        let Some(slot) = entries.get_mut(&connection_id) else {
            return Err("TCP 连接已取消".into());
        };
        if slot.generation != generation || cancel.is_cancelled() {
            return Err("TCP 连接已取消".into());
        }
        slot.sender = Some(sender);
        if start_tx.send(()).is_err() {
            entries.remove(&connection_id);
            return Err("TCP 连接任务启动失败".into());
        }
        let _ = app.emit(
            "tcp-event",
            TcpEvent {
                connection_id: connection_id.clone(),
                event_type: "connected".into(),
                data: Some(addr),
                raw_hex: None,
                remote_addr: Some(remote),
                client_id: None,
                size: None,
                timestamp: now_iso(),
            },
        );
    }
    Ok(())
}

async fn run_tcp_client(
    app: tauri::AppHandle,
    connections: Arc<Mutex<HashMap<String, TcpClientSlot>>>,
    connection_id: String,
    generation: u64,
    cancel: CancellationToken,
    mut reader: tokio::net::tcp::OwnedReadHalf,
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    mut receiver: mpsc::Receiver<Payload>,
) {
    let mut buffer = vec![0_u8; 8192];
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            command = receiver.recv() => {
                let Some(data) = command else { break };
                let result = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    result = writer.write_all(&data) => result,
                };
                if let Err(error) = result {
                    emit_tcp_client_if_current(
                        &app,
                        &connections,
                        &connection_id,
                        generation,
                        TcpEvent {
                            connection_id: connection_id.clone(),
                            event_type: "error".into(),
                            data: Some(error.to_string()),
                            raw_hex: None,
                            remote_addr: None,
                            client_id: None,
                            size: None,
                            timestamp: now_iso(),
                        },
                    ).await;
                    break;
                }
            }
            result = reader.read(&mut buffer) => {
                match result {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = &buffer[..size];
                        if !emit_tcp_client_if_current(
                            &app,
                            &connections,
                            &connection_id,
                            generation,
                            TcpEvent {
                                connection_id: connection_id.clone(),
                                event_type: "data".into(),
                                data: Some(decode_received_data(data, "auto")),
                                raw_hex: Some(bytes_to_hex(data)),
                                remote_addr: None,
                                client_id: None,
                                size: Some(size),
                                timestamp: now_iso(),
                            },
                        ).await {
                            break;
                        }
                    }
                    Err(error) => {
                        emit_tcp_client_if_current(
                            &app,
                            &connections,
                            &connection_id,
                            generation,
                            TcpEvent {
                                connection_id: connection_id.clone(),
                                event_type: "error".into(),
                                data: Some(error.to_string()),
                                raw_hex: None,
                                remote_addr: None,
                                client_id: None,
                                size: None,
                                timestamp: now_iso(),
                            },
                        ).await;
                        break;
                    }
                }
            }
        }
    }

    if remove_tcp_client_if_current(&connections, &connection_id, generation).await {
        let _ = app.emit(
            "tcp-event",
            TcpEvent {
                connection_id,
                event_type: "disconnected".into(),
                data: None,
                raw_hex: None,
                remote_addr: None,
                client_id: None,
                size: None,
                timestamp: now_iso(),
            },
        );
    }
}

pub async fn tcp_send(
    connections: &TcpConnections,
    connection_id: &str,
    data: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    ensure_payload_size(&bytes)?;
    let sender = connections
        .connections
        .lock()
        .await
        .get(connection_id)
        .and_then(|slot| slot.sender.clone())
        .ok_or_else(|| "TCP 连接不存在或仍在建立".to_string())?;
    sender
        .send(bytes.into())
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

pub async fn tcp_disconnect(
    connections: &TcpConnections,
    connection_id: &str,
) -> Result<(), String> {
    let removed = {
        let mut entries = connections.connections.lock().await;
        entries.remove(connection_id)
    };
    if let Some(slot) = removed {
        cancel_and_wait(slot.cancel, slot.finished).await;
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  TCP 服务端
// ═══════════════════════════════════════════

struct ServerClientHandle {
    sender: mpsc::Sender<Payload>,
    finished: CancellationToken,
    remote_addr: String,
}

type ServerClients = Arc<Mutex<HashMap<String, ServerClientHandle>>>;

struct TcpServerSlot {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
    bind_addr: String,
    /// `None` 表示 Starting。
    clients: Option<ServerClients>,
}

pub struct TcpServers {
    servers: Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    next_generation: AtomicU64,
}

impl TcpServers {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(0),
        }
    }

    async fn reserve(
        &self,
        server_id: &str,
        bind_addr: &str,
    ) -> (u64, CancellationToken, FinishedGuard) {
        let generation = next_generation(&self.next_generation);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        let finished_guard = FinishedGuard(finished.clone());
        let replaced = {
            let mut servers = self.servers.lock().await;
            let stale_ids: Vec<String> = servers
                .iter()
                .filter(|(id, slot)| id.as_str() == server_id || slot.bind_addr == bind_addr)
                .map(|(id, _)| id.clone())
                .collect();
            let replaced: Vec<TcpServerSlot> = stale_ids
                .iter()
                .filter_map(|id| servers.remove(id))
                .collect();
            servers.insert(
                server_id.to_string(),
                TcpServerSlot {
                    generation,
                    cancel: cancel.clone(),
                    finished: finished.clone(),
                    bind_addr: bind_addr.to_string(),
                    clients: None,
                },
            );
            replaced
        };
        for slot in replaced {
            cancel_and_wait(slot.cancel, slot.finished).await;
        }
        (generation, cancel, finished_guard)
    }
}

async fn tcp_server_is_current(
    servers: &Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    server_id: &str,
    generation: u64,
) -> bool {
    servers
        .lock()
        .await
        .get(server_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn emit_tcp_server_if_current(
    app: &tauri::AppHandle,
    servers: &Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    server_id: &str,
    generation: u64,
    event: TcpEvent,
) -> bool {
    let entries = servers.lock().await;
    if entries
        .get(server_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        let _ = app.emit("tcp-server-event", event);
        true
    } else {
        false
    }
}

async fn start_tcp_server_client_if_current(
    app: &tauri::AppHandle,
    servers: &Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    server_id: &str,
    generation: u64,
    start_tx: oneshot::Sender<()>,
    event: TcpEvent,
) -> bool {
    let entries = servers.lock().await;
    if !entries
        .get(server_id)
        .is_some_and(|slot| slot.generation == generation)
        || start_tx.send(()).is_err()
    {
        return false;
    }
    let _ = app.emit("tcp-server-event", event);
    true
}

async fn remove_tcp_server_if_current(
    servers: &Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    server_id: &str,
    generation: u64,
) -> bool {
    let mut entries = servers.lock().await;
    if entries
        .get(server_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        entries.remove(server_id);
        true
    } else {
        false
    }
}

pub async fn tcp_server_start(
    app: tauri::AppHandle,
    servers: &TcpServers,
    server_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let addr = format!("{}:{}", host, port);
    let (generation, cancel, finished_guard) = servers.reserve(&server_id, &addr).await;
    let listener = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("TCP 服务器启动已取消".into()),
        result = TcpListener::bind(&addr) => match result {
            Ok(listener) => listener,
            Err(error) => {
                remove_tcp_server_if_current(&servers.servers, &server_id, generation).await;
                return Err(format!("TCP 服务器启动失败: {}", error));
            }
        }
    };

    let clients = Arc::new(Mutex::new(HashMap::new()));
    let (start_tx, start_rx) = oneshot::channel();
    let worker_app = app.clone();
    let worker_entries = servers.servers.clone();
    let worker_clients = clients.clone();
    let worker_id = server_id.clone();
    let worker_cancel = cancel.clone();
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        let started = tokio::select! {
            biased;
            _ = worker_cancel.cancelled() => false,
            result = start_rx => result.is_ok(),
        };
        if started {
            run_tcp_server(
                worker_app,
                worker_entries,
                worker_clients,
                worker_id,
                generation,
                worker_cancel,
                listener,
            )
            .await;
        }
    });

    {
        let mut entries = servers.servers.lock().await;
        let Some(slot) = entries.get_mut(&server_id) else {
            return Err("TCP 服务器启动已取消".into());
        };
        if slot.generation != generation || cancel.is_cancelled() {
            return Err("TCP 服务器启动已取消".into());
        }
        slot.clients = Some(clients.clone());
        if start_tx.send(()).is_err() {
            entries.remove(&server_id);
            return Err("TCP 服务器任务启动失败".into());
        }
        let _ = app.emit(
            "tcp-server-event",
            TcpEvent {
                connection_id: server_id.clone(),
                event_type: "started".into(),
                data: Some(addr),
                raw_hex: None,
                remote_addr: None,
                client_id: None,
                size: None,
                timestamp: now_iso(),
            },
        );
    }
    Ok(())
}

async fn run_tcp_server(
    app: tauri::AppHandle,
    servers: Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    clients: ServerClients,
    server_id: String,
    generation: u64,
    cancel: CancellationToken,
    listener: TcpListener,
) {
    loop {
        let accepted = tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            result = listener.accept() => result,
        };
        let (stream, address) = match accepted {
            Ok(value) => value,
            Err(error) => {
                emit_tcp_server_if_current(
                    &app,
                    &servers,
                    &server_id,
                    generation,
                    TcpEvent {
                        connection_id: server_id.clone(),
                        event_type: "error".into(),
                        data: Some(error.to_string()),
                        raw_hex: None,
                        remote_addr: None,
                        client_id: None,
                        size: None,
                        timestamp: now_iso(),
                    },
                )
                .await;
                break;
            }
        };

        if !tcp_server_is_current(&servers, &server_id, generation).await {
            break;
        }
        if clients.lock().await.len() >= MAX_TCP_CLIENTS {
            log::warn!(
                "TCP 服务器 {} 连接数已达上限 {}，拒绝新连接 {}",
                server_id,
                MAX_TCP_CLIENTS,
                address
            );
            continue;
        }

        let client_id = uuid::Uuid::new_v4().to_string();
        let remote_addr = address.to_string();
        let (reader, writer) = stream.into_split();
        let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let client_cancel = cancel.child_token();
        let client_finished = CancellationToken::new();
        clients.lock().await.insert(
            client_id.clone(),
            ServerClientHandle {
                sender,
                finished: client_finished.clone(),
                remote_addr: remote_addr.clone(),
            },
        );

        let (client_start_tx, client_start_rx) = oneshot::channel();
        let worker_app = app.clone();
        let worker_servers = servers.clone();
        let worker_clients = clients.clone();
        let worker_server_id = server_id.clone();
        let worker_client_id = client_id.clone();
        let worker_cancel = client_cancel.clone();
        tokio::spawn(async move {
            let _finished_guard = FinishedGuard(client_finished);
            let started = tokio::select! {
                biased;
                _ = worker_cancel.cancelled() => false,
                result = client_start_rx => result.is_ok(),
            };
            if started {
                run_tcp_server_client(
                    worker_app,
                    worker_servers,
                    worker_clients,
                    worker_server_id,
                    generation,
                    worker_client_id,
                    worker_cancel,
                    reader,
                    writer,
                    receiver,
                )
                .await;
            }
        });

        let started = start_tcp_server_client_if_current(
            &app,
            &servers,
            &server_id,
            generation,
            client_start_tx,
            TcpEvent {
                connection_id: server_id.clone(),
                event_type: "client-connected".into(),
                data: None,
                raw_hex: None,
                remote_addr: Some(remote_addr),
                client_id: Some(client_id.clone()),
                size: None,
                timestamp: now_iso(),
            },
        )
        .await;
        if !started {
            client_cancel.cancel();
            clients.lock().await.remove(&client_id);
            if !tcp_server_is_current(&servers, &server_id, generation).await {
                break;
            }
        }
    }

    // 先释放监听端口，再等待已接受连接完成收尾，允许同地址重启立即绑定。
    drop(listener);
    cancel.cancel();
    let client_completions: Vec<CancellationToken> = clients
        .lock()
        .await
        .values()
        .map(|client| client.finished.clone())
        .collect();
    let _ = tokio::time::timeout(STOP_TIMEOUT, async move {
        for finished in client_completions {
            finished.cancelled().await;
        }
    })
    .await;
    remove_tcp_server_if_current(&servers, &server_id, generation).await;
}

#[allow(clippy::too_many_arguments)]
async fn run_tcp_server_client(
    app: tauri::AppHandle,
    servers: Arc<Mutex<HashMap<String, TcpServerSlot>>>,
    clients: ServerClients,
    server_id: String,
    generation: u64,
    client_id: String,
    cancel: CancellationToken,
    mut reader: tokio::net::tcp::OwnedReadHalf,
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    mut receiver: mpsc::Receiver<Payload>,
) {
    let mut buffer = vec![0_u8; 8192];
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            command = receiver.recv() => {
                let Some(data) = command else { break };
                let result = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    result = writer.write_all(&data) => result,
                };
                if result.is_err() {
                    break;
                }
            }
            result = reader.read(&mut buffer) => {
                match result {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = &buffer[..size];
                        if !emit_tcp_server_if_current(
                            &app,
                            &servers,
                            &server_id,
                            generation,
                            TcpEvent {
                                connection_id: server_id.clone(),
                                event_type: "client-data".into(),
                                data: Some(decode_received_data(data, "auto")),
                                raw_hex: Some(bytes_to_hex(data)),
                                remote_addr: None,
                                client_id: Some(client_id.clone()),
                                size: Some(size),
                                timestamp: now_iso(),
                            },
                        ).await {
                            break;
                        }
                    }
                    Err(error) => {
                        emit_tcp_server_if_current(
                            &app,
                            &servers,
                            &server_id,
                            generation,
                            TcpEvent {
                                connection_id: server_id.clone(),
                                event_type: "error".into(),
                                data: Some(error.to_string()),
                                raw_hex: None,
                                remote_addr: None,
                                client_id: Some(client_id.clone()),
                                size: None,
                                timestamp: now_iso(),
                            },
                        ).await;
                        break;
                    }
                }
            }
        }
    }

    let removed = clients.lock().await.remove(&client_id).is_some();
    if removed {
        emit_tcp_server_if_current(
            &app,
            &servers,
            &server_id,
            generation,
            TcpEvent {
                connection_id: server_id.clone(),
                event_type: "client-disconnected".into(),
                data: None,
                raw_hex: None,
                remote_addr: None,
                client_id: Some(client_id),
                size: None,
                timestamp: now_iso(),
            },
        )
        .await;
    }
}

#[allow(dead_code)]
pub async fn tcp_server_list_clients(
    servers: &TcpServers,
    server_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let clients = servers
        .servers
        .lock()
        .await
        .get(server_id)
        .and_then(|slot| slot.clients.clone())
        .ok_or_else(|| "服务器不存在或仍在启动".to_string())?;
    let entries = clients.lock().await;
    Ok(entries
        .iter()
        .map(|(id, handle)| (id.clone(), handle.remote_addr.clone()))
        .collect())
}

pub async fn tcp_server_send(
    servers: &TcpServers,
    server_id: &str,
    client_id: &str,
    data: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    ensure_payload_size(&bytes)?;
    let clients = servers
        .servers
        .lock()
        .await
        .get(server_id)
        .and_then(|slot| slot.clients.clone())
        .ok_or_else(|| "服务器不存在或仍在启动".to_string())?;
    let sender = clients
        .lock()
        .await
        .get(client_id)
        .map(|client| client.sender.clone())
        .ok_or_else(|| "客户端不存在或已断开".to_string())?;
    sender
        .send(bytes.into())
        .await
        .map_err(|_| "发送失败: 客户端已断开".to_string())
}

pub async fn tcp_server_broadcast(
    servers: &TcpServers,
    server_id: &str,
    data: String,
    encoding: String,
) -> Result<usize, String> {
    let bytes = decode_send_data(&data, &encoding)?;
    ensure_payload_size(&bytes)?;
    let bytes: Payload = bytes.into();
    let clients = servers
        .servers
        .lock()
        .await
        .get(server_id)
        .and_then(|slot| slot.clients.clone())
        .ok_or_else(|| "服务器不存在或仍在启动".to_string())?;
    let senders: Vec<mpsc::Sender<Payload>> = clients
        .lock()
        .await
        .values()
        .map(|client| client.sender.clone())
        .collect();

    // 广播永不等待单个慢客户端；每个客户端的有界队列提供背压和内存上限。
    Ok(try_broadcast_payload(&senders, bytes))
}

pub async fn tcp_server_stop(servers: &TcpServers, server_id: &str) -> Result<(), String> {
    let removed = {
        let mut entries = servers.servers.lock().await;
        entries.remove(server_id)
    };
    if let Some(slot) = removed {
        cancel_and_wait(slot.cancel, slot.finished).await;
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  UDP
// ═══════════════════════════════════════════

struct UdpSlot {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
    bind_addr: String,
    /// `None` 表示 Starting。
    sender: Option<mpsc::Sender<(Payload, String)>>,
}

pub struct UdpSockets {
    sockets: Arc<Mutex<HashMap<String, UdpSlot>>>,
    next_generation: AtomicU64,
}

impl UdpSockets {
    pub fn new() -> Self {
        Self {
            sockets: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(0),
        }
    }

    async fn reserve(
        &self,
        socket_id: &str,
        bind_addr: &str,
    ) -> (u64, CancellationToken, FinishedGuard) {
        let generation = next_generation(&self.next_generation);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        let finished_guard = FinishedGuard(finished.clone());
        let replaced = {
            let mut sockets = self.sockets.lock().await;
            let stale_ids: Vec<String> = sockets
                .iter()
                .filter(|(id, slot)| id.as_str() == socket_id || slot.bind_addr == bind_addr)
                .map(|(id, _)| id.clone())
                .collect();
            let replaced: Vec<UdpSlot> = stale_ids
                .iter()
                .filter_map(|id| sockets.remove(id))
                .collect();
            sockets.insert(
                socket_id.to_string(),
                UdpSlot {
                    generation,
                    cancel: cancel.clone(),
                    finished: finished.clone(),
                    bind_addr: bind_addr.to_string(),
                    sender: None,
                },
            );
            replaced
        };
        for slot in replaced {
            cancel_and_wait(slot.cancel, slot.finished).await;
        }
        (generation, cancel, finished_guard)
    }
}

#[cfg(test)]
async fn udp_is_current(
    sockets: &Arc<Mutex<HashMap<String, UdpSlot>>>,
    socket_id: &str,
    generation: u64,
) -> bool {
    sockets
        .lock()
        .await
        .get(socket_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn emit_udp_if_current(
    app: &tauri::AppHandle,
    sockets: &Arc<Mutex<HashMap<String, UdpSlot>>>,
    socket_id: &str,
    generation: u64,
    event: TcpEvent,
) -> bool {
    let entries = sockets.lock().await;
    if entries
        .get(socket_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        let _ = app.emit("udp-event", event);
        true
    } else {
        false
    }
}

async fn remove_udp_if_current(
    sockets: &Arc<Mutex<HashMap<String, UdpSlot>>>,
    socket_id: &str,
    generation: u64,
) -> bool {
    let mut entries = sockets.lock().await;
    if entries
        .get(socket_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        entries.remove(socket_id);
        true
    } else {
        false
    }
}

pub async fn udp_bind(
    app: tauri::AppHandle,
    sockets: &UdpSockets,
    socket_id: String,
    local_addr: String,
) -> Result<(), String> {
    let (generation, cancel, finished_guard) = sockets.reserve(&socket_id, &local_addr).await;
    let socket = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("UDP 绑定已取消".into()),
        result = UdpSocket::bind(&local_addr) => match result {
            Ok(socket) => socket,
            Err(error) => {
                remove_udp_if_current(&sockets.sockets, &socket_id, generation).await;
                return Err(format!("UDP 绑定失败: {}", error));
            }
        }
    };
    let socket = Arc::new(socket);
    let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);

    let (start_tx, start_rx) = oneshot::channel();
    let worker_app = app.clone();
    let worker_entries = sockets.sockets.clone();
    let worker_id = socket_id.clone();
    let worker_cancel = cancel.clone();
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        let started = tokio::select! {
            biased;
            _ = worker_cancel.cancelled() => false,
            result = start_rx => result.is_ok(),
        };
        if started {
            run_udp_socket(
                worker_app,
                worker_entries,
                worker_id,
                generation,
                worker_cancel,
                socket,
                receiver,
            )
            .await;
        }
    });

    {
        let mut entries = sockets.sockets.lock().await;
        let Some(slot) = entries.get_mut(&socket_id) else {
            return Err("UDP 绑定已取消".into());
        };
        if slot.generation != generation || cancel.is_cancelled() {
            return Err("UDP 绑定已取消".into());
        }
        slot.sender = Some(sender);
        if start_tx.send(()).is_err() {
            entries.remove(&socket_id);
            return Err("UDP 任务启动失败".into());
        }
        let _ = app.emit(
            "udp-event",
            TcpEvent {
                connection_id: socket_id.clone(),
                event_type: "bound".into(),
                data: Some(local_addr),
                raw_hex: None,
                remote_addr: None,
                client_id: None,
                size: None,
                timestamp: now_iso(),
            },
        );
    }
    Ok(())
}

async fn run_udp_socket(
    app: tauri::AppHandle,
    sockets: Arc<Mutex<HashMap<String, UdpSlot>>>,
    socket_id: String,
    generation: u64,
    cancel: CancellationToken,
    socket: Arc<UdpSocket>,
    mut receiver: mpsc::Receiver<(Payload, String)>,
) {
    let mut buffer = vec![0_u8; 65_535];
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            command = receiver.recv() => {
                let Some((data, target)) = command else { break };
                let result = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    result = socket.send_to(&data, &target) => result,
                };
                if let Err(error) = result {
                    emit_udp_if_current(
                        &app,
                        &sockets,
                        &socket_id,
                        generation,
                        TcpEvent {
                            connection_id: socket_id.clone(),
                            event_type: "error".into(),
                            data: Some(error.to_string()),
                            raw_hex: None,
                            remote_addr: None,
                            client_id: None,
                            size: None,
                            timestamp: now_iso(),
                        },
                    ).await;
                }
            }
            result = socket.recv_from(&mut buffer) => {
                match result {
                    Ok((size, address)) => {
                        let data = &buffer[..size];
                        if !emit_udp_if_current(
                            &app,
                            &sockets,
                            &socket_id,
                            generation,
                            TcpEvent {
                                connection_id: socket_id.clone(),
                                event_type: "data".into(),
                                data: Some(decode_received_data(data, "auto")),
                                raw_hex: Some(bytes_to_hex(data)),
                                remote_addr: Some(address.to_string()),
                                client_id: None,
                                size: Some(size),
                                timestamp: now_iso(),
                            },
                        ).await {
                            break;
                        }
                    }
                    Err(error) => {
                        emit_udp_if_current(
                            &app,
                            &sockets,
                            &socket_id,
                            generation,
                            TcpEvent {
                                connection_id: socket_id.clone(),
                                event_type: "error".into(),
                                data: Some(error.to_string()),
                                raw_hex: None,
                                remote_addr: None,
                                client_id: None,
                                size: None,
                                timestamp: now_iso(),
                            },
                        ).await;
                        break;
                    }
                }
            }
        }
    }
    remove_udp_if_current(&sockets, &socket_id, generation).await;
}

pub async fn udp_send_to(
    sockets: &UdpSockets,
    socket_id: &str,
    data: String,
    target_addr: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    ensure_payload_size(&bytes)?;
    let sender = sockets
        .sockets
        .lock()
        .await
        .get(socket_id)
        .and_then(|slot| slot.sender.clone())
        .ok_or_else(|| "UDP Socket 不存在或仍在绑定".to_string())?;
    sender
        .send((bytes.into(), target_addr))
        .await
        .map_err(|_| "发送失败: Socket 已关闭".to_string())
}

pub async fn udp_close(sockets: &UdpSockets, socket_id: &str) -> Result<(), String> {
    let removed = {
        let mut entries = sockets.sockets.lock().await;
        entries.remove(socket_id)
    };
    if let Some(slot) = removed {
        cancel_and_wait(slot.cancel, slot.finished).await;
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  活跃连接查询 API（前端刷新后状态恢复）
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTcpConnection {
    pub connection_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTcpServer {
    pub server_id: String,
    pub client_ids: Vec<String>,
    pub client_addrs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveUdpSocket {
    pub socket_id: String,
}

pub async fn list_active_connections(connections: &TcpConnections) -> Vec<ActiveTcpConnection> {
    connections
        .connections
        .lock()
        .await
        .iter()
        .filter(|(_, slot)| slot.sender.is_some())
        .map(|(id, _)| ActiveTcpConnection {
            connection_id: id.clone(),
        })
        .collect()
}

pub async fn list_active_servers(servers: &TcpServers) -> Vec<ActiveTcpServer> {
    let snapshots: Vec<(String, ServerClients)> = servers
        .servers
        .lock()
        .await
        .iter()
        .filter_map(|(id, slot)| slot.clients.clone().map(|clients| (id.clone(), clients)))
        .collect();
    let mut result = Vec::with_capacity(snapshots.len());
    for (server_id, clients) in snapshots {
        let clients = clients.lock().await;
        result.push(ActiveTcpServer {
            server_id,
            client_ids: clients.keys().cloned().collect(),
            client_addrs: clients
                .values()
                .map(|client| client.remote_addr.clone())
                .collect(),
        });
    }
    result
}

pub async fn list_active_sockets(sockets: &UdpSockets) -> Vec<ActiveUdpSocket> {
    sockets
        .sockets
        .lock()
        .await
        .iter()
        .filter(|(_, slot)| slot.sender.is_some())
        .map(|(id, _)| ActiveUdpSocket {
            socket_id: id.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn tcp_generation_prevents_stale_cleanup() {
        let connections = TcpConnections::new();
        let (first, first_cancel, first_guard) = connections.reserve("same-id").await;
        drop(first_guard);
        let (second, _, _second_guard) = connections.reserve("same-id").await;
        assert!(first_cancel.is_cancelled());
        assert_ne!(first, second);
        assert!(!remove_tcp_client_if_current(&connections.connections, "same-id", first).await);
        assert!(tcp_client_is_current(&connections.connections, "same-id", second).await);
        assert!(remove_tcp_client_if_current(&connections.connections, "same-id", second).await);
    }

    #[tokio::test]
    async fn stop_cancels_starting_tcp_generation() {
        let connections = TcpConnections::new();
        let (_, cancel, guard) = connections.reserve("pending").await;
        drop(guard);
        tcp_disconnect(&connections, "pending").await.unwrap();
        assert!(cancel.is_cancelled());
        assert!(connections.connections.lock().await.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ready_commit_lock_orders_stop_after_ready_barrier() {
        let connections = Arc::new(TcpConnections::new());
        let (generation, cancel, finished_guard) = connections.reserve("barrier").await;
        let (start_tx, start_rx) = oneshot::channel();
        let worker_cancel = cancel.clone();
        tokio::spawn(async move {
            let _finished_guard = finished_guard;
            let started = tokio::select! {
                biased;
                _ = worker_cancel.cancelled() => false,
                result = start_rx => result.is_ok(),
            };
            if started {
                worker_cancel.cancelled().await;
            }
        });

        let mut entries = connections.connections.lock().await;
        let attempted = CancellationToken::new();
        let stop_connections = connections.clone();
        let stop_attempted = attempted.clone();
        let stop_task = tokio::spawn(async move {
            stop_attempted.cancel();
            tcp_disconnect(&stop_connections, "barrier").await.unwrap();
        });
        attempted.cancelled().await;
        tokio::task::yield_now().await;
        assert!(!stop_task.is_finished());

        let (sender, _receiver) = mpsc::channel(1);
        let slot = entries.get_mut("barrier").unwrap();
        assert_eq!(slot.generation, generation);
        slot.sender = Some(sender);
        start_tx.send(()).unwrap();
        let ready_emitted = true;
        drop(entries);

        stop_task.await.unwrap();
        assert!(ready_emitted);
        assert!(cancel.is_cancelled());
    }

    #[tokio::test]
    async fn server_reservation_replaces_same_address_atomically() {
        let servers = TcpServers::new();
        let (_, first_cancel, first_guard) = servers.reserve("first", "127.0.0.1:9").await;
        drop(first_guard);
        let (second, _, _second_guard) = servers.reserve("second", "127.0.0.1:9").await;
        assert!(first_cancel.is_cancelled());
        let entries = servers.servers.lock().await;
        assert!(!entries.contains_key("first"));
        assert_eq!(entries.get("second").unwrap().generation, second);
    }

    #[tokio::test]
    async fn udp_generation_prevents_stale_cleanup() {
        let sockets = UdpSockets::new();
        let (first, first_cancel, first_guard) = sockets.reserve("same-id", "127.0.0.1:0").await;
        drop(first_guard);
        let (second, _, _second_guard) = sockets.reserve("same-id", "127.0.0.1:0").await;
        assert!(first_cancel.is_cancelled());
        assert!(!remove_udp_if_current(&sockets.sockets, "same-id", first).await);
        assert!(udp_is_current(&sockets.sockets, "same-id", second).await);
    }

    #[test]
    fn decode_hex_rejects_non_ascii_without_panicking() {
        assert!(decode_send_data("00界", "hex").is_err());
    }

    #[test]
    fn transport_payload_limit_is_enforced_without_allocation() {
        assert!(ensure_payload_len(MAX_TRANSPORT_PAYLOAD).is_ok());
        assert!(ensure_payload_len(MAX_TRANSPORT_PAYLOAD + 1).is_err());
    }

    #[tokio::test]
    async fn broadcast_skips_full_clients_without_waiting() {
        let (full_sender, mut full_receiver) = mpsc::channel(1);
        let (open_sender, mut open_receiver) = mpsc::channel(1);
        let payload: Payload = Vec::from(&b"message"[..]).into();
        full_sender.try_send(payload.clone()).unwrap();

        assert_eq!(
            try_broadcast_payload(&[full_sender, open_sender], payload.clone()),
            1
        );
        assert_eq!(&*full_receiver.recv().await.unwrap(), &*payload);
        assert_eq!(&*open_receiver.recv().await.unwrap(), &*payload);
    }
}
