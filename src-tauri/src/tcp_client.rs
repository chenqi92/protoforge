// TCP 客户端/服务端 + UDP 模块
// 使用 tokio 异步 I/O 实现

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, Mutex};

/// TCP/UDP 事件（后端 → 前端推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpEvent {
    pub connection_id: String,
    pub event_type: String,
    pub data: Option<String>,
    pub raw_hex: Option<String>,
    pub remote_addr: Option<String>,
    pub client_id: Option<String>,
    pub size: Option<usize>,
    pub timestamp: String,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Convert raw bytes to hex string like "48 65 6c 6c 6f"
fn bytes_to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")
}

/// Decode user input based on encoding format.
/// Returns the raw bytes to send over the wire.
fn decode_send_data(data: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "hex" => {
            // Accept hex like "48656c6c6f" or "48 65 6c 6c 6f" or "0x48 0x65"
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
        _ => Ok(data.as_bytes().to_vec()), // ascii / utf8
    }
}

/// Decode received bytes into a displayable string.
/// "auto" = try UTF-8 first, then GBK fallback; "gbk" = always GBK.
fn decode_received_data(data: &[u8], encoding: &str) -> String {
    match encoding {
        "gbk" => {
            let (decoded, _, _) = encoding_rs::GBK.decode(data);
            decoded.into_owned()
        }
        _ => {
            // auto: UTF-8 first, GBK fallback if invalid
            match std::str::from_utf8(data) {
                Ok(s) => s.to_string(),
                Err(_) => {
                    // Try GBK before falling back to hex
                    let (decoded, _, had_errors) = encoding_rs::GBK.decode(data);
                    if had_errors {
                        bytes_to_hex(data)
                    } else {
                        decoded.into_owned()
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════
//  TCP 客户端
// ═══════════════════════════════════════════

pub(crate) struct TcpClientHandle {
    sender: mpsc::Sender<Vec<u8>>,
    abort_handle: tokio::task::AbortHandle,
}

pub struct TcpConnections {
    pub connections: Arc<Mutex<HashMap<String, TcpClientHandle>>>,
}

impl TcpConnections {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn tcp_connect(
    app: tauri::AppHandle,
    connections: &TcpConnections,
    connection_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    // 先断开已有同 id 连接
    tcp_disconnect(connections, &connection_id).await.ok();

    let addr = format!("{}:{}", host, port);
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP 连接失败: {}", e))?;

    let remote = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_default();

    let (mut reader, mut writer) = stream.into_split();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);

    // 通知前端已连接
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

    let cid = connection_id.clone();
    let app_clone = app.clone();
    let conns = connections.connections.clone();

    let task = tokio::spawn(async move {
        // 写入子任务
        let write_task = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                if writer.write_all(&data).await.is_err() {
                    break;
                }
            }
        });

        // 读取循环
        let mut buf = vec![0u8; 8192];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break, // 连接关闭
                Ok(n) => {
                    let data = &buf[..n];
                    let hex_str = bytes_to_hex(data);
                    let text = decode_received_data(data, "auto");

                    let _ = app_clone.emit(
                        "tcp-event",
                        TcpEvent {
                            connection_id: cid.clone(),
                            event_type: "data".into(),
                            data: Some(text),
                            raw_hex: Some(hex_str),
                            remote_addr: None,
                            client_id: None,
                            size: Some(n),
                            timestamp: now_iso(),
                        },
                    );
                }
                Err(e) => {
                    let _ = app_clone.emit(
                        "tcp-event",
                        TcpEvent {
                            connection_id: cid.clone(),
                            event_type: "error".into(),
                            data: Some(e.to_string()),
                            raw_hex: None,
                            remote_addr: None,
                            client_id: None,
                            size: None,
                            timestamp: now_iso(),
                        },
                    );
                    break;
                }
            }
        }

        write_task.abort();
        let _ = app_clone.emit(
            "tcp-event",
            TcpEvent {
                connection_id: cid.clone(),
                event_type: "disconnected".into(),
                data: None,
                raw_hex: None,
                remote_addr: None,
                client_id: None,
                size: None,
                timestamp: now_iso(),
            },
        );
        conns.lock().await.remove(&cid);
    });

    let handle = TcpClientHandle {
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

pub async fn tcp_send(
    connections: &TcpConnections,
    connection_id: &str,
    data: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    let conns = connections.connections.lock().await;
    let handle = conns
        .get(connection_id)
        .ok_or_else(|| "TCP 连接不存在或已断开".to_string())?;
    handle
        .sender
        .send(bytes)
        .await
        .map_err(|_| "发送失败: 连接已关闭".to_string())
}

pub async fn tcp_disconnect(
    connections: &TcpConnections,
    connection_id: &str,
) -> Result<(), String> {
    let mut conns = connections.connections.lock().await;
    if let Some(handle) = conns.remove(connection_id) {
        handle.abort_handle.abort();
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  TCP 服务端
// ═══════════════════════════════════════════

pub(crate) struct ServerClientHandle {
    sender: mpsc::Sender<Vec<u8>>,
    abort_handle: tokio::task::AbortHandle,
    pub(crate) remote_addr: String,
}

pub(crate) struct TcpServerHandle {
    abort_handle: tokio::task::AbortHandle,
    clients: Arc<Mutex<HashMap<String, ServerClientHandle>>>,
}

pub struct TcpServers {
    pub servers: Arc<Mutex<HashMap<String, TcpServerHandle>>>,
}

impl TcpServers {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn tcp_server_start(
    app: tauri::AppHandle,
    servers: &TcpServers,
    server_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    // 先停止已有同 id 服务器
    tcp_server_stop(servers, &server_id).await.ok();
    // 等待系统释放端口（abort 是异步的，旧 listener 可能延迟释放）
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("TCP 服务器启动失败: {}", e))?;

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

    let clients: Arc<Mutex<HashMap<String, ServerClientHandle>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let sid = server_id.clone();
    let clients_clone = clients.clone();
    let app_clone = app.clone();

    /// TCP 服务端单实例最大连接数限制
    const MAX_TCP_CLIENTS: usize = 256;

    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    // 检查连接数上限
                    {
                        let c = clients_clone.lock().await;
                        if c.len() >= MAX_TCP_CLIENTS {
                            log::warn!("TCP 服务器 {} 连接数已达上限 {}，拒绝新连接 {}", sid, MAX_TCP_CLIENTS, addr);
                            drop(stream);
                            continue;
                        }
                    }
                    let client_id = uuid::Uuid::new_v4().to_string();
                    let remote_addr = addr.to_string();
                    let (mut reader, mut writer) = stream.into_split();
                    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);

                    // 通知前端有新客户端连接
                    let _ = app_clone.emit(
                        "tcp-server-event",
                        TcpEvent {
                            connection_id: sid.clone(),
                            event_type: "client-connected".into(),
                            data: None,
                            raw_hex: None,
                            remote_addr: Some(remote_addr.clone()),
                            client_id: Some(client_id.clone()),
                            size: None,
                            timestamp: now_iso(),
                        },
                    );

                    let c_sid = sid.clone();
                    let c_cid = client_id.clone();
                    let c_app = app_clone.clone();
                    let c_clients = clients_clone.clone();

                    let client_task = tokio::spawn(async move {
                        // 写入子任务
                        let write_task = tokio::spawn(async move {
                            while let Some(data) = rx.recv().await {
                                if writer.write_all(&data).await.is_err() {
                                    break;
                                }
                            }
                        });

                        // 读取循环
                        let mut buf = vec![0u8; 8192];
                        loop {
                            match reader.read(&mut buf).await {
                                Ok(0) => break,
                                Ok(n) => {
                                    let data = &buf[..n];
                                    let hex_str = bytes_to_hex(data);
                                    let text = decode_received_data(data, "auto");

                                    let _ = c_app.emit(
                                        "tcp-server-event",
                                        TcpEvent {
                                            connection_id: c_sid.clone(),
                                            event_type: "client-data".into(),
                                            data: Some(text),
                                            raw_hex: Some(hex_str),
                                            remote_addr: None,
                                            client_id: Some(c_cid.clone()),
                                            size: Some(n),
                                            timestamp: now_iso(),
                                        },
                                    );
                                }
                                Err(e) => {
                                    let _ = c_app.emit(
                                        "tcp-server-event",
                                        TcpEvent {
                                            connection_id: c_sid.clone(),
                                            event_type: "error".into(),
                                            data: Some(e.to_string()),
                                            raw_hex: None,
                                            remote_addr: None,
                                            client_id: Some(c_cid.clone()),
                                            size: None,
                                            timestamp: now_iso(),
                                        },
                                    );
                                    break;
                                }
                            }
                        }

                        write_task.abort();

                        let _ = c_app.emit(
                            "tcp-server-event",
                            TcpEvent {
                                connection_id: c_sid.clone(),
                                event_type: "client-disconnected".into(),
                                data: None,
                                raw_hex: None,
                                remote_addr: None,
                                client_id: Some(c_cid.clone()),
                                size: None,
                                timestamp: now_iso(),
                            },
                        );
                        c_clients.lock().await.remove(&c_cid);
                    });

                    let client_handle = ServerClientHandle {
                        sender: tx,
                        abort_handle: client_task.abort_handle(),
                        remote_addr,
                    };
                    clients_clone
                        .lock()
                        .await
                        .insert(client_id, client_handle);
                }
                Err(e) => {
                    let _ = app_clone.emit(
                        "tcp-server-event",
                        TcpEvent {
                            connection_id: sid.clone(),
                            event_type: "error".into(),
                            data: Some(e.to_string()),
                            raw_hex: None,
                            remote_addr: None,
                            client_id: None,
                            size: None,
                            timestamp: now_iso(),
                        },
                    );
                    break;
                }
            }
        }
    });

    let handle = TcpServerHandle {
        abort_handle: task.abort_handle(),
        clients,
    };
    servers.servers.lock().await.insert(server_id, handle);

    Ok(())
}

/// 列出服务器当前所有连接客户端
#[allow(dead_code)]
pub async fn tcp_server_list_clients(
    servers: &TcpServers,
    server_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let svrs = servers.servers.lock().await;
    let handle = svrs
        .get(server_id)
        .ok_or_else(|| "服务器不存在".to_string())?;
    let clients = handle.clients.lock().await;
    Ok(clients
        .iter()
        .map(|(id, h)| (id.clone(), h.remote_addr.clone()))
        .collect())
}

/// 向特定客户端发送数据
pub async fn tcp_server_send(
    servers: &TcpServers,
    server_id: &str,
    client_id: &str,
    data: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    let svrs = servers.servers.lock().await;
    let handle = svrs
        .get(server_id)
        .ok_or_else(|| "服务器不存在".to_string())?;
    let clients = handle.clients.lock().await;
    let client = clients
        .get(client_id)
        .ok_or_else(|| "客户端不存在或已断开".to_string())?;
    client
        .sender
        .send(bytes)
        .await
        .map_err(|_| "发送失败: 客户端已断开".to_string())
}

/// 向所有客户端广播数据
pub async fn tcp_server_broadcast(
    servers: &TcpServers,
    server_id: &str,
    data: String,
    encoding: String,
) -> Result<usize, String> {
    let bytes = decode_send_data(&data, &encoding)?;
    let svrs = servers.servers.lock().await;
    let handle = svrs
        .get(server_id)
        .ok_or_else(|| "服务器不存在".to_string())?;
    let clients = handle.clients.lock().await;
    let mut sent = 0;
    for (_id, client) in clients.iter() {
        if client.sender.send(bytes.clone()).await.is_ok() {
            sent += 1;
        }
    }
    Ok(sent)
}

pub async fn tcp_server_stop(servers: &TcpServers, server_id: &str) -> Result<(), String> {
    let mut svrs = servers.servers.lock().await;
    if let Some(handle) = svrs.remove(server_id) {
        // 关闭所有客户端连接
        let clients = handle.clients.lock().await;
        for (_id, client) in clients.iter() {
            client.abort_handle.abort();
        }
        drop(clients);
        handle.abort_handle.abort();
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  UDP
// ═══════════════════════════════════════════

pub(crate) struct UdpHandle {
    sender: mpsc::Sender<(Vec<u8>, String)>, // (data, target_addr)
    abort_handle: tokio::task::AbortHandle,
}

pub struct UdpSockets {
    pub sockets: Arc<Mutex<HashMap<String, UdpHandle>>>,
}

impl UdpSockets {
    pub fn new() -> Self {
        Self {
            sockets: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn udp_bind(
    app: tauri::AppHandle,
    sockets: &UdpSockets,
    socket_id: String,
    local_addr: String,
) -> Result<(), String> {
    udp_close(sockets, &socket_id).await.ok();

    let socket = UdpSocket::bind(&local_addr)
        .await
        .map_err(|e| format!("UDP 绑定失败: {}", e))?;

    let socket = Arc::new(socket);

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

    let (tx, mut rx) = mpsc::channel::<(Vec<u8>, String)>(256);
    let sid = socket_id.clone();
    let app_clone = app.clone();
    let sock_clone = socket.clone();
    let conns = sockets.sockets.clone();

    let task = tokio::spawn(async move {
        // 写入子任务
        let sock_write = sock_clone.clone();
        let write_task = tokio::spawn(async move {
            while let Some((data, target)) = rx.recv().await {
                let _ = sock_write.send_to(&data, &target).await;
            }
        });

        // 读取循环
        let mut buf = vec![0u8; 65535];
        loop {
            match sock_clone.recv_from(&mut buf).await {
                Ok((n, addr)) => {
                    let data = &buf[..n];
                    let hex_str = bytes_to_hex(data);
                    let text = decode_received_data(data, "auto");

                    let _ = app_clone.emit(
                        "udp-event",
                        TcpEvent {
                            connection_id: sid.clone(),
                            event_type: "data".into(),
                            data: Some(text),
                            raw_hex: Some(hex_str),
                            remote_addr: Some(addr.to_string()),
                            client_id: None,
                            size: Some(n),
                            timestamp: now_iso(),
                        },
                    );
                }
                Err(e) => {
                    let _ = app_clone.emit(
                        "udp-event",
                        TcpEvent {
                            connection_id: sid.clone(),
                            event_type: "error".into(),
                            data: Some(e.to_string()),
                            raw_hex: None,
                            remote_addr: None,
                            client_id: None,
                            size: None,
                            timestamp: now_iso(),
                        },
                    );
                    break;
                }
            }
        }

        write_task.abort();
        conns.lock().await.remove(&sid);
    });

    let handle = UdpHandle {
        sender: tx,
        abort_handle: task.abort_handle(),
    };
    sockets.sockets.lock().await.insert(socket_id, handle);

    Ok(())
}

pub async fn udp_send_to(
    sockets: &UdpSockets,
    socket_id: &str,
    data: String,
    target_addr: String,
    encoding: String,
) -> Result<(), String> {
    let bytes = decode_send_data(&data, &encoding)?;
    let conns = sockets.sockets.lock().await;
    let handle = conns
        .get(socket_id)
        .ok_or_else(|| "UDP Socket 不存在".to_string())?;
    handle
        .sender
        .send((bytes, target_addr))
        .await
        .map_err(|_| "发送失败: Socket 已关闭".to_string())
}

pub async fn udp_close(sockets: &UdpSockets, socket_id: &str) -> Result<(), String> {
    let mut conns = sockets.sockets.lock().await;
    if let Some(handle) = conns.remove(socket_id) {
        handle.abort_handle.abort();
    }
    Ok(())
}
