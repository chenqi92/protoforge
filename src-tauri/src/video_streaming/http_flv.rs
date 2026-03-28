//! HTTP-FLV 流解析器
//! 解析 FLV Header 和 Tag，通过事件推送到前端

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::state::ProtocolMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlvHeader {
    pub signature: String,
    pub version: u8,
    pub has_audio: bool,
    pub has_video: bool,
    pub header_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlvTag {
    pub tag_type: String,  // "audio" | "video" | "script"
    pub data_size: u32,
    pub timestamp: u32,
    pub stream_id: u32,
    pub keyframe: bool,
    pub codec_info: Option<String>,
    pub offset: u64,
}

/// 解析 FLV Header (前 9 字节)
pub fn parse_flv_header(data: &[u8]) -> Result<FlvHeader, String> {
    if data.len() < 9 {
        return Err("FLV header too short".to_string());
    }

    let sig = String::from_utf8_lossy(&data[0..3]).to_string();
    if sig != "FLV" {
        return Err(format!("Invalid FLV signature: {}", sig));
    }

    let version = data[3];
    let flags = data[4];
    let has_audio = (flags & 0x04) != 0;
    let has_video = (flags & 0x01) != 0;
    let header_size = u32::from_be_bytes([data[5], data[6], data[7], data[8]]);

    Ok(FlvHeader {
        signature: sig,
        version,
        has_audio,
        has_video,
        header_size,
    })
}

/// 解析单个 FLV Tag
pub fn parse_flv_tag(data: &[u8], offset: u64) -> Result<(FlvTag, usize), String> {
    if data.len() < 11 {
        return Err("FLV tag header too short".to_string());
    }

    let tag_type_byte = data[0] & 0x1F;
    let tag_type = match tag_type_byte {
        8 => "audio",
        9 => "video",
        18 => "script",
        _ => "unknown",
    };

    let data_size = ((data[1] as u32) << 16) | ((data[2] as u32) << 8) | (data[3] as u32);
    let timestamp = ((data[4] as u32) << 16) | ((data[5] as u32) << 8) | (data[6] as u32)
        | ((data[7] as u32) << 24); // timestamp_extended
    let stream_id = ((data[8] as u32) << 16) | ((data[9] as u32) << 8) | (data[10] as u32);

    // Parse codec info from tag data
    let mut keyframe = false;
    let mut codec_info = None;

    if data.len() > 11 && data_size > 0 {
        match tag_type {
            "video" => {
                if data.len() > 11 {
                    let frame_type = (data[11] >> 4) & 0x0F;
                    let codec_id = data[11] & 0x0F;
                    keyframe = frame_type == 1;
                    codec_info = Some(match codec_id {
                        2 => "H.263",
                        3 => "Screen Video",
                        4 => "VP6",
                        7 => "AVC (H.264)",
                        12 => "HEVC (H.265)",
                        _ => "Unknown",
                    }.to_string());
                }
            }
            "audio" => {
                if data.len() > 11 {
                    let sound_format = (data[11] >> 4) & 0x0F;
                    let sample_rate_idx = (data[11] >> 2) & 0x03;
                    let sample_rates = ["5.5kHz", "11kHz", "22kHz", "44kHz"];
                    let sr = sample_rates.get(sample_rate_idx as usize).unwrap_or(&"?");
                    codec_info = Some(match sound_format {
                        0 => format!("PCM {}", sr),
                        2 => format!("MP3 {}", sr),
                        10 => format!("AAC {}", sr),
                        11 => format!("Speex {}", sr),
                        _ => format!("Audio({}) {}", sound_format, sr),
                    });
                }
            }
            _ => {}
        }
    }

    let total_size = 11 + data_size as usize + 4; // tag header + data + previous tag size

    Ok((
        FlvTag {
            tag_type: tag_type.to_string(),
            data_size,
            timestamp,
            stream_id,
            keyframe,
            codec_info,
            offset,
        },
        total_size,
    ))
}

/// 从 HTTP-FLV URL 拉流并解析
pub async fn start_flv_stream(
    session_id: String,
    url: String,
    app: AppHandle,
    mut shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    log::info!("Starting FLV stream: session={} url={}", session_id, url);

    // Emit request
    let req_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: "http-flv".to_string(),
        summary: format!("GET {}", url),
        detail: format!("GET {} HTTP/1.1\r\nAccept: video/x-flv\r\n", url),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &req_msg);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client.get(&url)
        .header("User-Agent", "ProtoForge/1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let status = response.status();
    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let resp_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "received".to_string(),
        protocol: "http-flv".to_string(),
        summary: format!("HTTP {} Content-Type: {}", status.as_u16(), content_type),
        detail: format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\n", status, content_type),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &resp_msg);

    if !status.is_success() {
        return Err(format!("HTTP error: {}", status));
    }

    // Read the stream
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut offset: u64 = 0;
    let mut header_parsed = false;
    let mut tag_count = 0u64;

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                log::info!("FLV stream shutdown: session={}", session_id);
                break;
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(data)) => {
                        buffer.extend_from_slice(&data);

                        // Parse FLV header
                        if !header_parsed && buffer.len() >= 13 {
                            match parse_flv_header(&buffer) {
                                Ok(header) => {
                                    let header_msg = ProtocolMessage {
                                        id: uuid::Uuid::new_v4().to_string(),
                                        direction: "info".to_string(),
                                        protocol: "http-flv".to_string(),
                                        summary: format!("FLV v{} audio={} video={}", header.version, header.has_audio, header.has_video),
                                        detail: serde_json::to_string_pretty(&header).unwrap_or_default(),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        size: Some(header.header_size),
                                    };
                                    let _ = app.emit("videostream-protocol-msg", &header_msg);

                                    // Skip header + first PreviousTagSize
                                    let skip = header.header_size as usize + 4;
                                    if buffer.len() >= skip {
                                        buffer = buffer[skip..].to_vec();
                                        offset = skip as u64;
                                    }
                                    header_parsed = true;
                                }
                                Err(e) => {
                                    log::warn!("FLV header parse error: {}", e);
                                    break;
                                }
                            }
                        }

                        // Parse tags
                        if header_parsed {
                            while buffer.len() >= 11 {
                                match parse_flv_tag(&buffer, offset) {
                                    Ok((tag, consumed)) => {
                                        if buffer.len() < consumed {
                                            break; // Need more data
                                        }

                                        tag_count += 1;

                                        // Emit every Nth tag to avoid flooding (emit first 10, then every 50th)
                                        if tag_count <= 10 || tag_count % 50 == 0 || tag.keyframe {
                                            let tag_msg = ProtocolMessage {
                                                id: uuid::Uuid::new_v4().to_string(),
                                                direction: "info".to_string(),
                                                protocol: "http-flv".to_string(),
                                                summary: format!(
                                                    "FLV Tag #{} {} {}B @{}ms{}{}",
                                                    tag_count,
                                                    tag.tag_type,
                                                    tag.data_size,
                                                    tag.timestamp,
                                                    if tag.keyframe { " [KEY]" } else { "" },
                                                    tag.codec_info.as_deref().map(|c| format!(" ({})", c)).unwrap_or_default(),
                                                ),
                                                detail: serde_json::to_string_pretty(&tag).unwrap_or_default(),
                                                timestamp: chrono::Utc::now().to_rfc3339(),
                                                size: Some(tag.data_size),
                                            };
                                            let _ = app.emit("videostream-protocol-msg", &tag_msg);
                                        }

                                        buffer = buffer[consumed..].to_vec();
                                        offset += consumed as u64;
                                    }
                                    Err(_) => break,
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        log::warn!("FLV stream error: {}", e);
                        break;
                    }
                    None => {
                        log::info!("FLV stream ended: session={}", session_id);
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}
