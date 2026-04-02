//! RTSP 客户端实现
//! 支持 DESCRIBE/SETUP/PLAY/PAUSE/TEARDOWN 命令，SDP 解析，RTP/RTCP 统计

use std::sync::atomic::AtomicU32;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::state::{ProtocolMessage, StreamEvent};

/// RTSP 会话状态
#[allow(dead_code)]
pub struct RtspSession {
    pub stream: Option<TcpStream>,
    pub cseq: AtomicU32,
    pub session_id: Option<String>,
    pub url: String,
    pub sdp: Option<String>,
}

/// SDP 解析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdpInfo {
    pub raw: String,
    pub session_name: Option<String>,
    pub media_descriptions: Vec<SdpMedia>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdpMedia {
    pub media_type: String,  // "video" or "audio"
    pub port: u32,
    pub protocol: String,
    pub codec: Option<String>,
    pub clock_rate: Option<u32>,
    pub control: Option<String>,
    pub fmtp: Option<String>,
}

/// 解析 RTSP URL 为 (host, port, path)
fn parse_rtsp_url(url: &str) -> Result<(String, u16, String), String> {
    let without_scheme = url.strip_prefix("rtsp://")
        .ok_or_else(|| "URL must start with rtsp://".to_string())?;

    // Strip userinfo if present
    let without_auth = if let Some(idx) = without_scheme.find('@') {
        &without_scheme[idx + 1..]
    } else {
        without_scheme
    };

    let (host_port, path) = match without_auth.find('/') {
        Some(idx) => (&without_auth[..idx], &without_auth[idx..]),
        None => (without_auth, "/"),
    };

    let (host, port) = match host_port.rfind(':') {
        Some(idx) => {
            let port_str = &host_port[idx + 1..];
            let port = port_str.parse::<u16>().unwrap_or(554);
            (host_port[..idx].to_string(), port)
        }
        None => (host_port.to_string(), 554),
    };

    Ok((host, port, path.to_string()))
}

/// 解析 SDP 内容
pub fn parse_sdp(raw: &str) -> SdpInfo {
    let mut session_name = None;
    let mut media_descriptions = Vec::new();
    let mut current_media: Option<SdpMedia> = None;

    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with("s=") {
            session_name = Some(line[2..].to_string());
        } else if line.starts_with("m=") {
            // Flush previous media
            if let Some(m) = current_media.take() {
                media_descriptions.push(m);
            }
            // Parse: m=video 0 RTP/AVP 96
            let parts: Vec<&str> = line[2..].splitn(4, ' ').collect();
            current_media = Some(SdpMedia {
                media_type: parts.first().unwrap_or(&"unknown").to_string(),
                port: parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(0),
                protocol: parts.get(2).unwrap_or(&"RTP/AVP").to_string(),
                codec: None,
                clock_rate: None,
                control: None,
                fmtp: None,
            });
        } else if line.starts_with("a=rtpmap:") {
            // a=rtpmap:96 H264/90000
            if let Some(ref mut m) = current_media {
                if let Some(payload_info) = line.split(' ').nth(1) {
                    let codec_parts: Vec<&str> = payload_info.split('/').collect();
                    m.codec = codec_parts.first().map(|s| s.to_string());
                    m.clock_rate = codec_parts.get(1).and_then(|s| s.parse().ok());
                }
            }
        } else if line.starts_with("a=control:") {
            if let Some(ref mut m) = current_media {
                m.control = Some(line[10..].to_string());
            }
        } else if line.starts_with("a=fmtp:") {
            if let Some(ref mut m) = current_media {
                m.fmtp = Some(line.to_string());
            }
        }
    }

    if let Some(m) = current_media {
        media_descriptions.push(m);
    }

    SdpInfo {
        raw: raw.to_string(),
        session_name,
        media_descriptions,
    }
}

/// 发送 RTSP 请求并接收响应
pub async fn send_rtsp_request(
    session_id: &str,
    url: &str,
    method: &str,
    rtsp_session: Option<&str>,
    transport: &str,
    extra_headers: &str,
    app: &AppHandle,
) -> Result<String, String> {
    let (host, port, _path) = parse_rtsp_url(url)?;

    // Build CSeq (using a simple counter)
    let cseq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() % 10000;

    // Build request
    let mut request = format!(
        "{} {} RTSP/1.0\r\nCSeq: {}\r\nUser-Agent: ProtoForge/1.0\r\n",
        method.to_uppercase(), url, cseq
    );

    if let Some(sess) = rtsp_session {
        request.push_str(&format!("Session: {}\r\n", sess));
    }

    if method.eq_ignore_ascii_case("SETUP") {
        if transport.eq_ignore_ascii_case("udp") {
            request.push_str("Transport: RTP/AVP;unicast;client_port=8000-8001\r\n");
        } else {
            request.push_str("Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n");
        }
    }

    if !extra_headers.is_empty() {
        request.push_str(extra_headers);
    }

    request.push_str("\r\n");

    // Emit sent message
    let sent_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: "rtsp".to_string(),
        summary: format!("{} {} RTSP/1.0", method.to_uppercase(), url),
        detail: request.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(request.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &sent_msg);

    // Connect and send
    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

    stream.write_all(request.as_bytes()).await
        .map_err(|e| format!("Failed to send RTSP request: {}", e))?;

    // Read response
    let mut response = Vec::new();
    let mut buf = [0u8; 8192];

    // Read with timeout
    let read_result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        async {
            loop {
                let n = stream.read(&mut buf).await
                    .map_err(|e| format!("Read error: {}", e))?;
                if n == 0 { break; }
                response.extend_from_slice(&buf[..n]);

                // Check if we have a complete response
                let resp_str = String::from_utf8_lossy(&response);
                if resp_str.contains("\r\n\r\n") {
                    // Check if there's a Content-Length header
                    if let Some(cl_line) = resp_str.lines().find(|l| l.to_lowercase().starts_with("content-length:")) {
                        let cl: usize = cl_line.split(':').nth(1)
                            .and_then(|s| s.trim().parse().ok())
                            .unwrap_or(0);
                        let header_end = resp_str.find("\r\n\r\n").unwrap() + 4;
                        if response.len() >= header_end + cl {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            Ok::<_, String>(())
        }
    ).await;

    match read_result {
        Ok(Ok(())) => {},
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            // Timeout is OK for some commands, use what we have
            if response.is_empty() {
                return Err("RTSP response timeout".to_string());
            }
        }
    }

    let response_str = String::from_utf8_lossy(&response).to_string();

    // Parse status line
    let status_line = response_str.lines().next().unwrap_or("").to_string();

    // Emit received message
    let recv_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "received".to_string(),
        protocol: "rtsp".to_string(),
        summary: status_line.clone(),
        detail: response_str.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(response.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &recv_msg);

    // If DESCRIBE, also emit stream-info with SDP
    if method.eq_ignore_ascii_case("DESCRIBE") {
        if let Some(sdp_start) = response_str.find("v=0") {
            let sdp_raw = &response_str[sdp_start..];
            let sdp = parse_sdp(sdp_raw);

            // Try to extract stream info from SDP
            if let Some(video) = sdp.media_descriptions.iter().find(|m| m.media_type == "video") {
                let info = super::state::StreamInfo {
                    codec: video.codec.clone().unwrap_or_else(|| "Unknown".to_string()),
                    width: 0, // Not available in SDP directly
                    height: 0,
                    fps: 0.0,
                    bitrate: 0,
                    audio_codec: sdp.media_descriptions.iter()
                        .find(|m| m.media_type == "audio")
                        .and_then(|a| a.codec.clone()),
                    sample_rate: sdp.media_descriptions.iter()
                        .find(|m| m.media_type == "audio")
                        .and_then(|a| a.clock_rate),
                    channels: None,
                };
                let event = StreamEvent {
                    session_id: session_id.to_string(),
                    event_type: "stream-info".to_string(),
                    data: Some(serde_json::to_string(&info).unwrap_or_default()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };
                let _ = app.emit("videostream-event", &event);
            }

            // Emit SDP as info message
            let sdp_msg = ProtocolMessage {
                id: uuid::Uuid::new_v4().to_string(),
                direction: "info".to_string(),
                protocol: "rtsp".to_string(),
                summary: format!("SDP: {} media description(s)", sdp.media_descriptions.len()),
                detail: serde_json::to_string_pretty(&sdp).unwrap_or_else(|_| sdp_raw.to_string()),
                timestamp: chrono::Utc::now().to_rfc3339(),
                size: None,
            };
            let _ = app.emit("videostream-protocol-msg", &sdp_msg);
        }
    }

    Ok(response_str)
}
