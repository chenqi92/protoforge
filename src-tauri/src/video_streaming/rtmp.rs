//! RTMP 协议实现
//! 支持 TCP 握手 (C0/S0/C1/S1/C2/S2)、AMF0 编解码、connect/createStream/play 命令
//! 手写实现，展示原始报文用于协议调试

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tauri::{AppHandle, Emitter};

use super::state::ProtocolMessage;

// ── RTMP 握手 ──

/// 执行 RTMP 握手全流程 (C0+C1 → S0+S1+S2 → C2)
pub async fn handshake(
    session_id: &str,
    url: &str,
    app: &AppHandle,
) -> Result<TcpStream, String> {
    let (host, port, _app_name, _stream_name) = parse_rtmp_url(url)?;

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("RTMP connect to {} failed: {}", addr, e))?;

    // ── C0: version byte (0x03 = RTMP version 3)
    let c0 = [0x03u8];
    stream.write_all(&c0).await.map_err(|e| format!("Send C0 failed: {}", e))?;

    emit_protocol_msg(app, session_id, "sent", "C0 → Version (0x03)",
        &format!("RTMP Handshake C0\nVersion: 3\nBytes: {:02X}", c0[0]));

    // ── C1: 1536 bytes (timestamp + zero + random)
    let mut c1 = vec![0u8; 1536];
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32;
    c1[0..4].copy_from_slice(&ts.to_be_bytes());
    c1[4..8].copy_from_slice(&[0, 0, 0, 0]); // zero
    // Fill rest with pseudo-random
    for i in 8..1536 {
        c1[i] = ((i * 37 + 13) % 256) as u8;
    }
    stream.write_all(&c1).await.map_err(|e| format!("Send C1 failed: {}", e))?;

    emit_protocol_msg(app, session_id, "sent", "C1 → Handshake (1536 bytes)",
        &format!("RTMP Handshake C1\nTimestamp: {}\nSize: 1536 bytes\nFirst 16 bytes: {}",
            ts, hex_preview(&c1, 16)));

    // ── Read S0 (1 byte)
    let mut s0 = [0u8; 1];
    stream.read_exact(&mut s0).await.map_err(|e| format!("Read S0 failed: {}", e))?;

    emit_protocol_msg(app, session_id, "received", &format!("S0 ← Version (0x{:02X})", s0[0]),
        &format!("RTMP Handshake S0\nServer version: {}\nBytes: {:02X}", s0[0], s0[0]));

    // ── Read S1 (1536 bytes)
    let mut s1 = vec![0u8; 1536];
    stream.read_exact(&mut s1).await.map_err(|e| format!("Read S1 failed: {}", e))?;

    let s1_ts = u32::from_be_bytes([s1[0], s1[1], s1[2], s1[3]]);
    emit_protocol_msg(app, session_id, "received", "S1 ← Handshake (1536 bytes)",
        &format!("RTMP Handshake S1\nServer timestamp: {}\nSize: 1536 bytes\nFirst 16 bytes: {}",
            s1_ts, hex_preview(&s1, 16)));

    // ── Read S2 (1536 bytes) — echo of C1
    let mut s2 = vec![0u8; 1536];
    stream.read_exact(&mut s2).await.map_err(|e| format!("Read S2 failed: {}", e))?;

    emit_protocol_msg(app, session_id, "received", "S2 ← Echo of C1 (1536 bytes)",
        &format!("RTMP Handshake S2\nSize: 1536 bytes\nFirst 16 bytes: {}",
            hex_preview(&s2, 16)));

    // ── C2: echo of S1
    stream.write_all(&s1).await.map_err(|e| format!("Send C2 failed: {}", e))?;

    emit_protocol_msg(app, session_id, "sent", "C2 → Echo of S1 (1536 bytes)",
        &format!("RTMP Handshake C2\nSize: 1536 bytes (echo of S1)"));

    // Emit handshake complete info
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "rtmp".to_string(),
        summary: "RTMP handshake completed successfully".to_string(),
        detail: format!("Server: {}:{}\nClient version: 3\nServer version: {}", host, port, s0[0]),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(stream)
}

// ── AMF0 编码 ──

fn amf0_encode_string(s: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x02); // string marker
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
    buf
}

fn amf0_encode_number(n: f64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x00); // number marker
    buf.extend_from_slice(&n.to_be_bytes());
    buf
}

fn amf0_encode_object(pairs: &[(&str, AmfValue)]) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x03); // object marker
    for (key, value) in pairs {
        buf.extend_from_slice(&(key.len() as u16).to_be_bytes());
        buf.extend_from_slice(key.as_bytes());
        match value {
            AmfValue::Number(n) => buf.extend(amf0_encode_number_raw(*n)),
            AmfValue::String(s) => buf.extend(amf0_encode_string_raw(s)),
            AmfValue::Boolean(b) => {
                buf.push(0x01);
                buf.push(if *b { 1 } else { 0 });
            }
        }
    }
    // Object end marker
    buf.extend_from_slice(&[0x00, 0x00, 0x09]);
    buf
}

fn amf0_encode_number_raw(n: f64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x00);
    buf.extend_from_slice(&n.to_be_bytes());
    buf
}

fn amf0_encode_string_raw(s: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x02);
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
    buf
}

enum AmfValue<'a> {
    Number(f64),
    String(&'a str),
    Boolean(bool),
}

// ── RTMP Chunk 编码 ──

fn build_rtmp_chunk(
    chunk_stream_id: u8,
    msg_type_id: u8,
    msg_stream_id: u32,
    payload: &[u8],
) -> Vec<u8> {
    let mut buf = Vec::new();

    // Chunk Basic Header (fmt=0, csid)
    buf.push(chunk_stream_id & 0x3F); // fmt=0 (full header)

    // Chunk Message Header (fmt 0 = 11 bytes)
    // Timestamp (3 bytes)
    buf.extend_from_slice(&[0x00, 0x00, 0x00]);
    // Message length (3 bytes)
    let len = payload.len() as u32;
    buf.push(((len >> 16) & 0xFF) as u8);
    buf.push(((len >> 8) & 0xFF) as u8);
    buf.push((len & 0xFF) as u8);
    // Message type ID (1 byte)
    buf.push(msg_type_id);
    // Message stream ID (4 bytes, little-endian)
    buf.extend_from_slice(&msg_stream_id.to_le_bytes());

    // Payload
    buf.extend_from_slice(payload);

    buf
}

// ── RTMP connect 命令 ──

pub async fn connect_app(
    stream: &mut TcpStream,
    session_id: &str,
    url: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let (_host, _port, app_name, _stream_name) = parse_rtmp_url(url)?;

    // tcUrl = rtmp://host[:port]/app (without stream key, per RTMP spec)
    let tc_url = {
        let without_scheme = url.strip_prefix("rtmp://").unwrap_or(url);
        match without_scheme.find('/') {
            Some(first_slash) => {
                let after_host = &without_scheme[first_slash + 1..];
                // app is everything before the next '/'
                match after_host.find('/') {
                    Some(second_slash) => format!("rtmp://{}/{}", &without_scheme[..first_slash], &after_host[..second_slash]),
                    None => format!("rtmp://{}/{}", &without_scheme[..first_slash], after_host),
                }
            }
            None => url.to_string(),
        }
    };

    // Build connect command
    let mut payload = Vec::new();
    payload.extend(amf0_encode_string("connect"));
    payload.extend(amf0_encode_number(1.0)); // transaction ID

    // Command object
    payload.extend(amf0_encode_object(&[
        ("app", AmfValue::String(&app_name)),
        ("flashVer", AmfValue::String("ProtoForge/1.0")),
        ("tcUrl", AmfValue::String(&tc_url)),
        ("fpad", AmfValue::Boolean(false)),
        ("capabilities", AmfValue::Number(239.0)),
        ("audioCodecs", AmfValue::Number(3575.0)),
        ("videoCodecs", AmfValue::Number(252.0)),
        ("videoFunction", AmfValue::Number(1.0)),
    ]));

    let chunk = build_rtmp_chunk(3, 0x14, 0, &payload); // 0x14 = AMF0 command

    emit_protocol_msg(app, session_id, "sent", "connect command (AMF0)",
        &format!("RTMP connect\nApp: {}\ntcUrl: {}\nPayload size: {} bytes\nChunk size: {} bytes",
            app_name, url, payload.len(), chunk.len()));

    stream.write_all(&chunk).await.map_err(|e| format!("Send connect failed: {}", e))?;

    // Read response
    let mut resp_buf = vec![0u8; 4096];
    let n = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read(&mut resp_buf),
    ).await
        .map_err(|_| "connect response timeout".to_string())?
        .map_err(|e| format!("Read connect response failed: {}", e))?;

    if n > 0 {
        emit_protocol_msg(app, session_id, "received",
            &format!("connect response ({} bytes)", n),
            &format!("RTMP connect response\nSize: {} bytes\nFirst 32 bytes: {}",
                n, hex_preview(&resp_buf[..n], 32)));
    }

    Ok(())
}

// ── RTMP play 命令 ──

pub async fn play(
    stream: &mut TcpStream,
    session_id: &str,
    stream_key: &str,
    app: &AppHandle,
) -> Result<(), String> {
    // createStream command
    let mut cs_payload = Vec::new();
    cs_payload.extend(amf0_encode_string("createStream"));
    cs_payload.extend(amf0_encode_number(2.0)); // transaction ID
    cs_payload.push(0x05); // null

    let cs_chunk = build_rtmp_chunk(3, 0x14, 0, &cs_payload);

    emit_protocol_msg(app, session_id, "sent", "createStream command",
        &format!("RTMP createStream\nTransaction ID: 2\nPayload: {} bytes", cs_payload.len()));

    stream.write_all(&cs_chunk).await.map_err(|e| format!("Send createStream failed: {}", e))?;

    // Read createStream response
    let mut resp_buf = vec![0u8; 4096];
    let n = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read(&mut resp_buf),
    ).await
        .map_err(|_| "createStream response timeout".to_string())?
        .map_err(|e| format!("Read createStream response failed: {}", e))?;

    if n > 0 {
        emit_protocol_msg(app, session_id, "received",
            &format!("createStream response ({} bytes)", n),
            &format!("Size: {} bytes\nFirst 32 bytes: {}", n, hex_preview(&resp_buf[..n], 32)));
    }

    // play command
    let mut play_payload = Vec::new();
    play_payload.extend(amf0_encode_string("play"));
    play_payload.extend(amf0_encode_number(0.0)); // transaction ID
    play_payload.push(0x05); // null
    play_payload.extend(amf0_encode_string(stream_key));

    let play_chunk = build_rtmp_chunk(8, 0x14, 1, &play_payload);

    emit_protocol_msg(app, session_id, "sent", &format!("play \"{}\"", stream_key),
        &format!("RTMP play\nStream key: {}\nPayload: {} bytes", stream_key, play_payload.len()));

    stream.write_all(&play_chunk).await.map_err(|e| format!("Send play failed: {}", e))?;

    // Read play response
    let n2 = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read(&mut resp_buf),
    ).await
        .map_err(|_| "play response timeout".to_string())?
        .map_err(|e| format!("Read play response failed: {}", e))?;

    if n2 > 0 {
        emit_protocol_msg(app, session_id, "received",
            &format!("play response ({} bytes)", n2),
            &format!("Size: {} bytes\nFirst 32 bytes: {}", n2, hex_preview(&resp_buf[..n2], 32)));
    }

    Ok(())
}

// ── 辅助函数 ──

fn parse_rtmp_url(url: &str) -> Result<(String, u16, String, String), String> {
    let without_scheme = url.strip_prefix("rtmp://")
        .ok_or_else(|| "URL must start with rtmp://".to_string())?;

    let (host_port, path) = match without_scheme.find('/') {
        Some(idx) => (&without_scheme[..idx], &without_scheme[idx + 1..]),
        None => (without_scheme, ""),
    };

    let (host, port) = match host_port.rfind(':') {
        Some(idx) => {
            let port = host_port[idx + 1..].parse::<u16>().unwrap_or(1935);
            (host_port[..idx].to_string(), port)
        }
        None => (host_port.to_string(), 1935),
    };

    // Split path into app_name/stream_name
    let (app_name, stream_name) = match path.find('/') {
        Some(idx) => (path[..idx].to_string(), path[idx + 1..].to_string()),
        None => (path.to_string(), String::new()),
    };

    Ok((host, port, app_name, stream_name))
}

fn hex_preview(data: &[u8], max: usize) -> String {
    let len = data.len().min(max);
    data[..len].iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
}

fn emit_protocol_msg(app: &AppHandle, _session_id: &str, direction: &str, summary: &str, detail: &str) {
    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: direction.to_string(),
        protocol: "rtmp".to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);
}
