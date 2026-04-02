//! SRT (Secure Reliable Transport) 协议实现
//! 手写 SRT 握手协议，展示连接建立过程和报文用于协议调试
//! SRT 使用 UDP 传输，握手分为 Induction 和 Conclusion 两个阶段

use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;

use super::state::{ProtocolMessage, SrtSession, VideoStreamState};

// ── SRT 协议常量 ──

const SRT_MAGIC: u32 = 0x00004953; // "SI" in handshake
const SRT_VERSION: u32 = 0x00010401; // SRT 1.4.1

// Handshake types
const HS_TYPE_INDUCTION: u32 = 1;
const HS_TYPE_CONCLUSION: u32 = 0xFFFFFFFF_u32;

// Control packet type
const CTRL_HANDSHAKE: u16 = 0x0000;

// ── SRT 连接 ──

pub async fn connect(
    session_id: &str,
    config: &str,
    state: &VideoStreamState,
    app: &AppHandle,
) -> Result<(), String> {
    let cfg: serde_json::Value = serde_json::from_str(config).unwrap_or_default();
    let host = cfg
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1");
    let port = cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(9000) as u16;
    let mode = cfg.get("mode").and_then(|v| v.as_str()).unwrap_or("caller");
    let latency = cfg.get("latency").and_then(|v| v.as_u64()).unwrap_or(120) as u32;
    let stream_id = cfg.get("streamId").and_then(|v| v.as_str()).unwrap_or("");

    match mode {
        "caller" => caller_connect(session_id, host, port, latency, stream_id, state, app).await,
        "listener" => listener_connect(session_id, port, latency, state, app).await,
        _ => Err(format!("Unsupported SRT mode: {}", mode)),
    }
}

async fn caller_connect(
    session_id: &str,
    host: &str,
    port: u16,
    latency: u32,
    stream_id: &str,
    state: &VideoStreamState,
    app: &AppHandle,
) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Bind UDP socket failed: {}", e))?;

    let target = format!("{}:{}", host, port);
    socket
        .connect(&target)
        .await
        .map_err(|e| format!("Connect to {} failed: {}", target, e))?;

    // ── Phase 1: Induction ──
    let client_socket_id = gen_socket_id();
    let induction_req = build_handshake_packet(
        HS_TYPE_INDUCTION,
        SRT_VERSION,
        1500,   // MSS
        256000, // flow window
        0,      // initial seq
        client_socket_id,
        0,   // SRT socket ID (0 for induction)
        &[], // no extensions in induction
    );

    emit_msg(
        app,
        session_id,
        "sent",
        "SRT Induction Request (Caller → Listener)",
        &format!(
            "SRT Handshake Phase 1: Induction\n\
                   Socket ID: 0x{:08X}\n\
                   Version: 0x{:08X}\n\
                   MSS: 1500\n\
                   Flow Window: 256000\n\
                   Packet size: {} bytes",
            client_socket_id,
            SRT_VERSION,
            induction_req.len()
        ),
    );

    socket
        .send(&induction_req)
        .await
        .map_err(|e| format!("Send induction failed: {}", e))?;

    // Read induction response
    let mut buf = vec![0u8; 2048];
    let n = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv(&mut buf))
        .await
        .map_err(|_| "SRT induction response timeout".to_string())?
        .map_err(|e| format!("Recv induction failed: {}", e))?;

    let resp_data = &buf[..n];
    let server_socket_id = parse_handshake_socket_id(resp_data);

    emit_msg(
        app,
        session_id,
        "received",
        &format!("SRT Induction Response ({} bytes)", n),
        &format!(
            "SRT Handshake Phase 1: Induction Response\n\
                   Server Socket ID: 0x{:08X}\n\
                   Packet size: {} bytes\n\
                   First 32 bytes: {}",
            server_socket_id,
            n,
            hex_preview(resp_data, 32)
        ),
    );

    // ── Phase 2: Conclusion ──
    let mut extensions = Vec::new();

    // SRT_CMD_HSREQ extension (type=1, SRT version + flags)
    let hsreq_ext = build_srt_hs_extension(latency);
    extensions.extend_from_slice(&hsreq_ext);

    // Stream ID extension if provided
    if !stream_id.is_empty() {
        let sid_ext = build_stream_id_extension(stream_id);
        extensions.extend_from_slice(&sid_ext);
    }

    let conclusion_req = build_handshake_packet(
        HS_TYPE_CONCLUSION,
        SRT_VERSION,
        1500,
        256000,
        0,
        client_socket_id,
        server_socket_id,
        &extensions,
    );

    emit_msg(
        app,
        session_id,
        "sent",
        "SRT Conclusion Request (Caller → Listener)",
        &format!(
            "SRT Handshake Phase 2: Conclusion\n\
                   Client Socket ID: 0x{:08X}\n\
                   Server Socket ID: 0x{:08X}\n\
                   Latency: {} ms\n\
                   Stream ID: {}\n\
                   Extensions: {} bytes\n\
                   Total packet: {} bytes",
            client_socket_id,
            server_socket_id,
            latency,
            if stream_id.is_empty() {
                "(none)"
            } else {
                stream_id
            },
            extensions.len(),
            conclusion_req.len()
        ),
    );

    socket
        .send(&conclusion_req)
        .await
        .map_err(|e| format!("Send conclusion failed: {}", e))?;

    // Read conclusion response
    let n2 = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv(&mut buf))
        .await
        .map_err(|_| "SRT conclusion response timeout".to_string())?
        .map_err(|e| format!("Recv conclusion failed: {}", e))?;

    emit_msg(
        app,
        session_id,
        "received",
        &format!("SRT Conclusion Response ({} bytes)", n2),
        &format!(
            "SRT Handshake Phase 2: Conclusion Response\n\
                   Packet size: {} bytes\n\
                   First 32 bytes: {}",
            n2,
            hex_preview(&buf[..n2], 32)
        ),
    );

    // Emit success
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "srt".to_string(),
        summary: format!("SRT connected to {}:{}", host, port),
        detail: format!(
            "Mode: Caller\nTarget: {}:{}\nLatency: {} ms\nStream ID: {}",
            host, port, latency, stream_id
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    // Store session
    let srt_session = SrtSession {
        config: format!("caller://{}:{}", host, port),
        connected: true,
        shutdown_tx: None,
    };
    state
        .srt_sessions
        .lock()
        .await
        .insert(session_id.to_string(), srt_session);

    Ok(())
}

async fn listener_connect(
    session_id: &str,
    port: u16,
    latency: u32,
    state: &VideoStreamState,
    app: &AppHandle,
) -> Result<(), String> {
    let socket = UdpSocket::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Bind SRT listener on port {} failed: {}", port, e))?;

    emit_msg(
        app,
        session_id,
        "info",
        &format!("SRT Listener waiting on port {}", port),
        &format!(
            "SRT Listener Mode\nPort: {}\nLatency: {} ms\nWaiting for caller...",
            port, latency
        ),
    );

    // Wait for induction from caller
    let mut buf = vec![0u8; 2048];
    let (n, caller_addr) = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        socket.recv_from(&mut buf),
    )
    .await
    .map_err(|_| "SRT listener: no caller connected within 30s".to_string())?
    .map_err(|e| format!("SRT recv failed: {}", e))?;

    let caller_socket_id = parse_handshake_socket_id(&buf[..n]);

    emit_msg(
        app,
        session_id,
        "received",
        &format!("SRT Induction from {} ({} bytes)", caller_addr, n),
        &format!(
            "Caller: {}\nCaller Socket ID: 0x{:08X}\nSize: {} bytes",
            caller_addr, caller_socket_id, n
        ),
    );

    // Send induction response
    let server_socket_id = gen_socket_id();
    let resp = build_handshake_packet(
        HS_TYPE_INDUCTION,
        SRT_VERSION,
        1500,
        256000,
        0,
        server_socket_id,
        caller_socket_id,
        &[],
    );

    socket
        .send_to(&resp, caller_addr)
        .await
        .map_err(|e| format!("Send induction response failed: {}", e))?;

    emit_msg(
        app,
        session_id,
        "sent",
        "SRT Induction Response (Listener → Caller)",
        &format!(
            "Server Socket ID: 0x{:08X}\nSize: {} bytes",
            server_socket_id,
            resp.len()
        ),
    );

    // Wait for conclusion
    let (n2, _) = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        socket.recv_from(&mut buf),
    )
    .await
    .map_err(|_| "SRT conclusion timeout".to_string())?
    .map_err(|e| format!("Recv conclusion failed: {}", e))?;

    emit_msg(
        app,
        session_id,
        "received",
        &format!("SRT Conclusion from caller ({} bytes)", n2),
        &format!(
            "Size: {} bytes\nFirst 32 bytes: {}",
            n2,
            hex_preview(&buf[..n2], 32)
        ),
    );

    // Send conclusion response
    let hsreq_ext = build_srt_hs_extension(latency);
    let conclusion_resp = build_handshake_packet(
        HS_TYPE_CONCLUSION,
        SRT_VERSION,
        1500,
        256000,
        0,
        server_socket_id,
        caller_socket_id,
        &hsreq_ext,
    );

    socket
        .send_to(&conclusion_resp, caller_addr)
        .await
        .map_err(|e| format!("Send conclusion response failed: {}", e))?;

    emit_msg(
        app,
        session_id,
        "sent",
        "SRT Conclusion Response",
        &format!("SRT handshake complete\nCaller: {}", caller_addr),
    );

    // Emit connected
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "srt".to_string(),
        summary: format!("SRT listener connected from {}", caller_addr),
        detail: format!(
            "Mode: Listener\nPort: {}\nCaller: {}\nLatency: {} ms",
            port, caller_addr, latency
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    let srt_session = SrtSession {
        config: String::new(),
        connected: true,
        shutdown_tx: None,
    };
    state
        .srt_sessions
        .lock()
        .await
        .insert(session_id.to_string(), srt_session);

    Ok(())
}

// ── 报文构造 ──

fn build_handshake_packet(
    hs_type: u32,
    version: u32,
    mss: u32,
    flow_window: u32,
    initial_seq: u32,
    socket_id: u32,
    peer_socket_id: u32,
    extensions: &[u8],
) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(64 + extensions.len());

    // ── UDT/SRT Header (16 bytes) ──
    // Control bit (1) + type (CTRL_HANDSHAKE=0) + subtype (0)
    let first_word: u32 = 0x80000000 | ((CTRL_HANDSHAKE as u32) << 16);
    pkt.extend_from_slice(&first_word.to_be_bytes());
    // Additional info (0)
    pkt.extend_from_slice(&0u32.to_be_bytes());
    // Timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as u32;
    pkt.extend_from_slice(&ts.to_be_bytes());
    // Destination Socket ID
    pkt.extend_from_slice(&peer_socket_id.to_be_bytes());

    // ── Handshake Payload (48 bytes) ──
    pkt.extend_from_slice(&version.to_be_bytes()); // UDT/SRT version
    pkt.extend_from_slice(&5u16.to_be_bytes()); // Encryption: none
    pkt.extend_from_slice(&0u16.to_be_bytes()); // Extension field
    pkt.extend_from_slice(&initial_seq.to_be_bytes()); // Initial sequence
    pkt.extend_from_slice(&mss.to_be_bytes()); // MSS
    pkt.extend_from_slice(&flow_window.to_be_bytes()); // Flow window
    pkt.extend_from_slice(&hs_type.to_be_bytes()); // Handshake type
    pkt.extend_from_slice(&socket_id.to_be_bytes()); // SRT Socket ID
    pkt.extend_from_slice(&SRT_MAGIC.to_be_bytes()); // SYN Cookie / Magic
    // Peer IP (16 bytes, IPv4-mapped-IPv6 or zeros)
    pkt.extend_from_slice(&[0u8; 16]);

    // Extensions
    if !extensions.is_empty() {
        pkt.extend_from_slice(extensions);
    }

    pkt
}

fn build_srt_hs_extension(latency: u32) -> Vec<u8> {
    let mut ext = Vec::new();
    // Extension type: SRT_CMD_HSREQ (1)
    ext.extend_from_slice(&1u16.to_be_bytes());
    // Extension length (in 32-bit words): 3
    ext.extend_from_slice(&3u16.to_be_bytes());
    // SRT version
    ext.extend_from_slice(&SRT_VERSION.to_be_bytes());
    // SRT flags (TSBPDSND | TSBPDRCV | CRYPT | TLPKTDROP | PERIODICNAK | REXMITFLG)
    ext.extend_from_slice(&0x0000003Fu32.to_be_bytes());
    // TsbPd delay (receiver latency in ms in upper 16 bits, sender in lower)
    let latency_field = ((latency as u32) << 16) | (latency as u32);
    ext.extend_from_slice(&latency_field.to_be_bytes());
    ext
}

fn build_stream_id_extension(stream_id: &str) -> Vec<u8> {
    let mut ext = Vec::new();
    let sid_bytes = stream_id.as_bytes();
    let padded_len = (sid_bytes.len() + 3) / 4 * 4; // pad to 4-byte boundary

    // Extension type: SRT_CMD_SID (5)
    ext.extend_from_slice(&5u16.to_be_bytes());
    // Extension length in 32-bit words
    ext.extend_from_slice(&((padded_len / 4) as u16).to_be_bytes());
    // Stream ID content (padded)
    ext.extend_from_slice(sid_bytes);
    ext.resize(ext.len() + padded_len - sid_bytes.len(), 0);

    ext
}

fn parse_handshake_socket_id(data: &[u8]) -> u32 {
    // Socket ID is at offset 48 in the handshake (16 byte header + 32 bytes into payload)
    if data.len() >= 52 {
        u32::from_be_bytes([data[48], data[49], data[50], data[51]])
    } else {
        0
    }
}

// ── 辅助函数 ──

fn gen_socket_id() -> u32 {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u32;
    ts ^ 0xDEADBEEF
}

fn hex_preview(data: &[u8], max: usize) -> String {
    let len = data.len().min(max);
    data[..len]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

fn emit_msg(app: &AppHandle, _session_id: &str, direction: &str, summary: &str, detail: &str) {
    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: direction.to_string(),
        protocol: "srt".to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);
}
