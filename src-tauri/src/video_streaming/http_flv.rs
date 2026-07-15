//! HTTP-FLV 流解析器
//! 解析 FLV Header 和 Tag，通过事件推送到前端

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

use super::state::{GenerationTagged, ProtocolMessage, StreamSession};

const MAX_FLV_HEADER_SIZE: usize = 64 * 1024;
const MAX_FLV_TAG_DATA_SIZE: usize = 8 * 1024 * 1024;
const MAX_FLV_BUFFER_SIZE: usize = MAX_FLV_TAG_DATA_SIZE + 11 + 4;
const FLV_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const FLV_READ_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

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
    pub tag_type: String, // "audio" | "video" | "script"
    pub data_size: u32,
    pub timestamp: u32,
    pub stream_id: u32,
    pub keyframe: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    if !(9..=MAX_FLV_HEADER_SIZE as u32).contains(&header_size) {
        return Err(format!("Invalid FLV header size: {header_size}"));
    }

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
    if data_size as usize > MAX_FLV_TAG_DATA_SIZE {
        return Err(format!("FLV tag payload too large: {data_size}"));
    }
    let timestamp = ((data[4] as u32) << 16)
        | ((data[5] as u32) << 8)
        | (data[6] as u32)
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
                    codec_info = Some(
                        match codec_id {
                            2 => "H.263",
                            3 => "Screen Video",
                            4 => "VP6",
                            7 => "AVC (H.264)",
                            12 => "HEVC (H.265)",
                            _ => "Unknown",
                        }
                        .to_string(),
                    );
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
    generation: u64,
    sessions: Arc<Mutex<HashMap<String, StreamSession>>>,
) -> Result<(), String> {
    log::info!("Starting FLV stream: session={} url={}", session_id, url);
    if shutdown_requested(&mut shutdown_rx)
        || !generation_is_current(&sessions, &session_id, generation).await
    {
        return Ok(());
    }

    // Emit request
    let req_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        direction: "sent".to_string(),
        protocol: "http-flv".to_string(),
        summary: format!("GET {}", url),
        detail: format!("GET {} HTTP/1.1\r\nAccept: video/x-flv\r\n", url),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    if !emit_if_current(&sessions, &session_id, generation, &app, &req_msg).await {
        return Ok(());
    }

    let client = build_flv_client()?;

    let request = client
        .get(&url)
        .header("User-Agent", "ProtoForge/1.0")
        .send();
    tokio::pin!(request);
    let response = tokio::select! {
        biased;
        _ = &mut shutdown_rx => {
            log::info!("FLV stream shutdown during handshake: session={}", session_id);
            return Ok(());
        }
        response = &mut request => response.map_err(|e| format!("Failed to connect: {e}"))?,
    };

    if shutdown_requested(&mut shutdown_rx)
        || !generation_is_current(&sessions, &session_id, generation).await
    {
        return Ok(());
    }

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let resp_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        direction: "received".to_string(),
        protocol: "http-flv".to_string(),
        summary: format!("HTTP {} Content-Type: {}", status.as_u16(), content_type),
        detail: format!(
            "HTTP/1.1 {}\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\n",
            status, content_type
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    if !emit_if_current(&sessions, &session_id, generation, &app, &resp_msg).await {
        return Ok(());
    }

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
            biased;
            _ = &mut shutdown_rx => {
                log::info!("FLV stream shutdown: session={}", session_id);
                break;
            }
            _ = tokio::time::sleep(FLV_READ_IDLE_TIMEOUT) => {
                return Err("HTTP-FLV stream read idle timeout".to_string());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(data)) => {
                        if shutdown_requested(&mut shutdown_rx) {
                            return Ok(());
                        }
                        if !generation_is_current(&sessions, &session_id, generation).await {
                            return Ok(());
                        }
                        if buffer.len().saturating_add(data.len()) > MAX_FLV_BUFFER_SIZE {
                            return Err("HTTP-FLV parser buffer limit exceeded".to_string());
                        }
                        buffer.extend_from_slice(&data);

                        // Parse FLV header
                        if !header_parsed {
                            match complete_flv_header(&buffer)? {
                                Some((header, skip)) => {
                                    if !generation_is_current(&sessions, &session_id, generation).await {
                                        return Ok(());
                                    }
                                    let header_msg = ProtocolMessage {
                                        id: uuid::Uuid::new_v4().to_string(),
                                        session_id: session_id.clone(),
                                        direction: "info".to_string(),
                                        protocol: "http-flv".to_string(),
                                        summary: format!("FLV v{} audio={} video={}", header.version, header.has_audio, header.has_video),
                                        detail: serde_json::to_string_pretty(&header).unwrap_or_default(),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        size: Some(header.header_size),
                                    };
                                    if !emit_if_current(
                                        &sessions,
                                        &session_id,
                                        generation,
                                        &app,
                                        &header_msg,
                                    )
                                    .await
                                    {
                                        return Ok(());
                                    }

                                    // Skip header + first PreviousTagSize
                                    buffer.drain(..skip);
                                    offset = skip as u64;
                                    header_parsed = true;
                                }
                                None => continue,
                            }
                        }

                        // Parse tags
                        if header_parsed {
                            while buffer.len() >= 11 {
                                if shutdown_requested(&mut shutdown_rx) {
                                    return Ok(());
                                }
                                if !generation_is_current(&sessions, &session_id, generation).await {
                                    return Ok(());
                                }
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
                                                session_id: session_id.clone(),
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
                                            if !emit_if_current(
                                                &sessions,
                                                &session_id,
                                                generation,
                                                &app,
                                                &tag_msg,
                                            )
                                            .await
                                            {
                                                return Ok(());
                                            }
                                        }

                                        buffer.drain(..consumed);
                                        offset += consumed as u64;
                                    }
                                    Err(error) => return Err(error),
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        return Err(format!("HTTP-FLV stream error: {e}"));
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

fn build_flv_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(FLV_CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("HTTP client error: {error}"))
}

fn complete_flv_header(data: &[u8]) -> Result<Option<(FlvHeader, usize)>, String> {
    if data.len() < 9 {
        return Ok(None);
    }
    let header = parse_flv_header(data)?;
    let consumed = (header.header_size as usize)
        .checked_add(4)
        .ok_or_else(|| "FLV header size overflow".to_string())?;
    if data.len() < consumed {
        return Ok(None);
    }
    Ok(Some((header, consumed)))
}

fn shutdown_requested(shutdown_rx: &mut oneshot::Receiver<()>) -> bool {
    match shutdown_rx.try_recv() {
        Ok(()) | Err(oneshot::error::TryRecvError::Closed) => true,
        Err(oneshot::error::TryRecvError::Empty) => false,
    }
}

async fn generation_is_current(
    sessions: &Arc<Mutex<HashMap<String, StreamSession>>>,
    session_id: &str,
    generation: u64,
) -> bool {
    sessions
        .lock()
        .await
        .get(session_id)
        .is_some_and(|session| session.generation == generation)
}

async fn emit_if_current(
    sessions: &Arc<Mutex<HashMap<String, StreamSession>>>,
    session_id: &str,
    generation: u64,
    app: &AppHandle,
    message: &ProtocolMessage,
) -> bool {
    let sessions = sessions.lock().await;
    if sessions
        .get(session_id)
        .is_some_and(|session| session.generation == generation)
    {
        let _ = app.emit(
            "videostream-protocol-msg",
            &GenerationTagged::new(message, generation),
        );
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_FLV_HEADER_SIZE, MAX_FLV_TAG_DATA_SIZE, build_flv_client, complete_flv_header,
        parse_flv_header, parse_flv_tag, shutdown_requested,
    };

    #[test]
    fn shutdown_signal_is_observed_without_waiting_for_network_io() {
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        assert!(!shutdown_requested(&mut rx));

        tx.send(()).expect("shutdown receiver alive");
        assert!(shutdown_requested(&mut rx));
    }

    #[test]
    fn dropped_shutdown_sender_is_terminal() {
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        drop(tx);

        assert!(shutdown_requested(&mut rx));
    }

    #[test]
    fn extended_header_waits_until_header_and_previous_size_are_complete() {
        let mut data = vec![0u8; 13];
        data[..5].copy_from_slice(b"FLV\x01\x05");
        data[5..9].copy_from_slice(&20u32.to_be_bytes());
        assert!(complete_flv_header(&data).unwrap().is_none());

        data.resize(24, 0);
        let (header, consumed) = complete_flv_header(&data)
            .unwrap()
            .expect("complete header");
        assert_eq!(header.header_size, 20);
        assert_eq!(consumed, 24);
    }

    #[test]
    fn invalid_header_and_oversized_tag_are_rejected() {
        let mut header = b"FLV\x01\x05\0\0\0\x08".to_vec();
        assert!(parse_flv_header(&header).is_err());
        header[5..9].copy_from_slice(&((MAX_FLV_HEADER_SIZE + 1) as u32).to_be_bytes());
        assert!(parse_flv_header(&header).is_err());

        let oversized = (MAX_FLV_TAG_DATA_SIZE + 1) as u32;
        let mut tag = [0u8; 11];
        tag[0] = 9;
        tag[1] = ((oversized >> 16) & 0xff) as u8;
        tag[2] = ((oversized >> 8) & 0xff) as u8;
        tag[3] = (oversized & 0xff) as u8;
        assert!(parse_flv_tag(&tag, 0).is_err());
    }

    #[test]
    fn streaming_client_configuration_builds_without_total_request_timeout() {
        build_flv_client().expect("HTTP-FLV client");
    }
}
