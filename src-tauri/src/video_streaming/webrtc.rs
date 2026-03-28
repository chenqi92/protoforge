//! WebRTC 协议实现
//! 支持 SDP Offer/Answer 生成与解析、ICE candidate 收集
//! 使用 STUN 绑定请求获取 server reflexive 地址，展示信令流程用于协议调试

use tokio::net::UdpSocket;
use tauri::{AppHandle, Emitter};

use super::state::{ProtocolMessage, WebRtcSession, VideoStreamState};

// ── STUN 常量 ──

const STUN_BINDING_REQUEST: u16 = 0x0001;
const STUN_BINDING_RESPONSE: u16 = 0x0101;
const STUN_MAGIC_COOKIE: u32 = 0x2112A442;
const STUN_ATTR_XOR_MAPPED_ADDR: u16 = 0x0020;
const STUN_ATTR_MAPPED_ADDR: u16 = 0x0001;

// ── SDP 生成 ──

fn generate_sdp_offer(
    ice_ufrag: &str,
    ice_pwd: &str,
    candidates: &[IceCandidate],
) -> String {
    let session_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut sdp = format!(
        "v=0\r\n\
         o=- {} 2 IN IP4 127.0.0.1\r\n\
         s=-\r\n\
         t=0 0\r\n\
         a=group:BUNDLE 0\r\n\
         a=msid-semantic: WMS\r\n\
         m=video 9 UDP/TLS/RTP/SAVPF 96\r\n\
         c=IN IP4 0.0.0.0\r\n\
         a=rtcp:9 IN IP4 0.0.0.0\r\n\
         a=ice-ufrag:{}\r\n\
         a=ice-pwd:{}\r\n\
         a=ice-options:trickle\r\n\
         a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\n\
         a=setup:actpass\r\n\
         a=mid:0\r\n\
         a=sendrecv\r\n\
         a=rtcp-mux\r\n\
         a=rtpmap:96 H264/90000\r\n\
         a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n",
        session_id, ice_ufrag, ice_pwd
    );

    for c in candidates {
        sdp.push_str(&format!(
            "a=candidate:{} 1 {} {} {} {} typ {}\r\n",
            c.foundation, c.protocol, c.priority, c.address, c.port, c.candidate_type
        ));
    }

    sdp
}

fn generate_ice_credentials() -> (String, String) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let ufrag = format!("{:x}", (ts & 0xFFFFFFFF) as u32);
    let pwd = format!("{:x}{:x}", (ts >> 32) as u64, (ts & 0xFFFFFFFF) as u64);
    (ufrag, pwd)
}

#[derive(Clone)]
struct IceCandidate {
    foundation: String,
    protocol: String,
    priority: u32,
    address: String,
    port: u16,
    candidate_type: String,
}

// ── STUN Binding ──

async fn stun_binding(
    stun_server: &str,
    session_id: &str,
    app: &AppHandle,
) -> Result<Option<(String, u16)>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").await
        .map_err(|e| format!("Bind STUN socket failed: {}", e))?;

    // Parse STUN server address
    let addr = if stun_server.starts_with("stun:") {
        &stun_server[5..]
    } else {
        stun_server
    };

    // Add default port if missing
    let addr_with_port = if addr.contains(':') {
        addr.to_string()
    } else {
        format!("{}:3478", addr)
    };

    // Build STUN Binding Request
    let transaction_id: [u8; 12] = {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut id = [0u8; 12];
        for (i, b) in id.iter_mut().enumerate() {
            *b = ((ts >> (i * 8)) & 0xFF) as u8;
        }
        id
    };

    let mut request = Vec::with_capacity(20);
    request.extend_from_slice(&STUN_BINDING_REQUEST.to_be_bytes());
    request.extend_from_slice(&0u16.to_be_bytes()); // message length
    request.extend_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
    request.extend_from_slice(&transaction_id);

    emit_msg(app, session_id, "sent",
        &format!("STUN Binding Request → {}", addr_with_port),
        &format!("STUN Binding Request\nServer: {}\nTransaction ID: {}\nMessage size: {} bytes",
                  addr_with_port,
                  transaction_id.iter().map(|b| format!("{:02X}", b)).collect::<String>(),
                  request.len()));

    // Resolve and send
    let resolved: std::net::SocketAddr = tokio::net::lookup_host(&addr_with_port).await
        .map_err(|e| format!("Resolve STUN server {} failed: {}", addr_with_port, e))?
        .next()
        .ok_or_else(|| format!("No address found for {}", addr_with_port))?;

    socket.send_to(&request, resolved).await
        .map_err(|e| format!("Send STUN request failed: {}", e))?;

    // Receive response
    let mut buf = vec![0u8; 2048];
    let n = match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        socket.recv(&mut buf),
    ).await {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => return Err(format!("STUN recv error: {}", e)),
        Err(_) => {
            emit_msg(app, session_id, "info",
                &format!("STUN timeout from {}", addr_with_port),
                "No response within 3 seconds");
            return Ok(None);
        }
    };

    let resp = &buf[..n];

    // Parse STUN response
    if n < 20 {
        return Ok(None);
    }

    let msg_type = u16::from_be_bytes([resp[0], resp[1]]);
    if msg_type != STUN_BINDING_RESPONSE {
        return Ok(None);
    }

    // Parse attributes to find XOR-MAPPED-ADDRESS or MAPPED-ADDRESS
    let mapped = parse_stun_mapped_address(resp, &transaction_id);

    if let Some((ip, port)) = &mapped {
        emit_msg(app, session_id, "received",
            &format!("STUN Response: {}:{} (srflx)", ip, port),
            &format!("STUN Binding Response from {}\nMapped Address: {}:{}\nCandidate type: srflx (server reflexive)\nPacket size: {} bytes",
                      addr_with_port, ip, port, n));
    }

    Ok(mapped)
}

fn parse_stun_mapped_address(resp: &[u8], _txn_id: &[u8; 12]) -> Option<(String, u16)> {
    if resp.len() < 20 {
        return None;
    }

    let msg_len = u16::from_be_bytes([resp[2], resp[3]]) as usize;
    let attrs_end = (20 + msg_len).min(resp.len());
    let mut offset = 20;

    while offset + 4 <= attrs_end {
        let attr_type = u16::from_be_bytes([resp[offset], resp[offset + 1]]);
        let attr_len = u16::from_be_bytes([resp[offset + 2], resp[offset + 3]]) as usize;
        let attr_start = offset + 4;

        if attr_start + attr_len > attrs_end {
            break;
        }

        let attr_data = &resp[attr_start..attr_start + attr_len];

        if attr_type == STUN_ATTR_XOR_MAPPED_ADDR && attr_len >= 8 {
            let family = attr_data[1];
            if family == 0x01 {
                // IPv4
                let xport = u16::from_be_bytes([attr_data[2], attr_data[3]]) ^ (STUN_MAGIC_COOKIE >> 16) as u16;
                let xip = u32::from_be_bytes([attr_data[4], attr_data[5], attr_data[6], attr_data[7]]) ^ STUN_MAGIC_COOKIE;
                let ip = format!("{}.{}.{}.{}", (xip >> 24) & 0xFF, (xip >> 16) & 0xFF, (xip >> 8) & 0xFF, xip & 0xFF);
                return Some((ip, xport));
            }
        } else if attr_type == STUN_ATTR_MAPPED_ADDR && attr_len >= 8 {
            let family = attr_data[1];
            if family == 0x01 {
                let port = u16::from_be_bytes([attr_data[2], attr_data[3]]);
                let ip = format!("{}.{}.{}.{}", attr_data[4], attr_data[5], attr_data[6], attr_data[7]);
                return Some((ip, port));
            }
        }

        // Advance to next attribute (padded to 4 bytes)
        offset = attr_start + ((attr_len + 3) / 4 * 4);
    }

    None
}

// ── 公开 API ──

pub async fn create_offer(
    session_id: &str,
    config: &str,
    state: &VideoStreamState,
    app: &AppHandle,
) -> Result<String, String> {
    let cfg: serde_json::Value = serde_json::from_str(config).unwrap_or_default();
    let stun_servers: Vec<String> = cfg.get("stunServers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| vec!["stun:stun.l.google.com:19302".to_string()]);

    let (ice_ufrag, ice_pwd) = generate_ice_credentials();
    let mut candidates = Vec::new();

    // Gather host candidates from local interfaces
    let local_addr = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    candidates.push(IceCandidate {
        foundation: "1".to_string(),
        protocol: "udp".to_string(),
        priority: 2130706431,
        address: local_addr.clone(),
        port: 9,
        candidate_type: "host".to_string(),
    });

    // Emit host candidate
    let _ = app.emit("videostream-event", &super::state::StreamEvent {
        session_id: session_id.to_string(),
        event_type: "protocol-data".to_string(),
        data: Some(serde_json::json!({
            "type": "ice-candidate",
            "candidate": {
                "type": "host",
                "address": local_addr,
                "port": 9,
                "protocol": "udp",
                "state": "gathered"
            }
        }).to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    });

    // Gather server reflexive candidates via STUN
    for stun_server in &stun_servers {
        match stun_binding(stun_server, session_id, app).await {
            Ok(Some((ip, port))) => {
                candidates.push(IceCandidate {
                    foundation: "2".to_string(),
                    protocol: "udp".to_string(),
                    priority: 1694498815,
                    address: ip.clone(),
                    port,
                    candidate_type: "srflx".to_string(),
                });

                // Emit srflx candidate
                let _ = app.emit("videostream-event", &super::state::StreamEvent {
                    session_id: session_id.to_string(),
                    event_type: "protocol-data".to_string(),
                    data: Some(serde_json::json!({
                        "type": "ice-candidate",
                        "candidate": {
                            "type": "srflx",
                            "address": ip,
                            "port": port,
                            "protocol": "udp",
                            "state": "gathered"
                        }
                    }).to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!("STUN binding to {} failed: {}", stun_server, e);
            }
        }
    }

    // Generate SDP offer
    let sdp = generate_sdp_offer(&ice_ufrag, &ice_pwd, &candidates);

    emit_msg(app, session_id, "info",
        &format!("SDP Offer generated ({} candidates)", candidates.len()),
        &sdp);

    // Store session
    let webrtc_session = WebRtcSession {
        config: config.to_string(),
        connected: false,
        shutdown_tx: None,
    };
    state.webrtc_sessions.lock().await.insert(session_id.to_string(), webrtc_session);

    Ok(sdp)
}

pub async fn set_answer(
    session_id: &str,
    sdp: &str,
    state: &VideoStreamState,
    app: &AppHandle,
) -> Result<(), String> {
    emit_msg(app, session_id, "received", "SDP Answer received",
        &format!("Remote SDP Answer:\n{}", sdp));

    // Parse remote SDP for ice-ufrag, ice-pwd, candidates
    let remote_ufrag = sdp.lines()
        .find(|l| l.starts_with("a=ice-ufrag:"))
        .map(|l| l[12..].to_string())
        .unwrap_or_default();

    let remote_candidates: Vec<&str> = sdp.lines()
        .filter(|l| l.starts_with("a=candidate:"))
        .collect();

    emit_msg(app, session_id, "info",
        &format!("Parsed remote SDP: ufrag={}, {} candidates", remote_ufrag, remote_candidates.len()),
        &format!("Remote ICE ufrag: {}\nRemote candidates:\n{}",
                  remote_ufrag,
                  remote_candidates.join("\n")));

    // Update session state
    if let Some(session) = state.webrtc_sessions.lock().await.get_mut(session_id) {
        session.connected = true;
    }

    // Emit connected event
    let _ = app.emit("videostream-event", &super::state::StreamEvent {
        session_id: session_id.to_string(),
        event_type: "connected".to_string(),
        data: Some("WebRTC signaling complete".to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    });

    Ok(())
}

pub async fn add_ice_candidate(
    session_id: &str,
    candidate: &str,
    _state: &VideoStreamState,
    app: &AppHandle,
) -> Result<(), String> {
    emit_msg(app, session_id, "received",
        &format!("Remote ICE candidate added"),
        &format!("Candidate: {}", candidate));

    Ok(())
}

// ── 辅助函数 ──

fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

fn emit_msg(app: &AppHandle, _session_id: &str, direction: &str, summary: &str, detail: &str) {
    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: direction.to_string(),
        protocol: "webrtc".to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);
}
