//! HLS (HTTP Live Streaming) 解析器
//! 支持 Master Playlist 和 Media Playlist 的完整解析

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::state::ProtocolMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HlsPlaylistInfo {
    pub playlist_type: String, // "master" or "media"
    pub version: Option<u32>,
    pub target_duration: Option<f64>,
    pub media_sequence: Option<u64>,
    pub is_live: bool,
    pub variants: Vec<HlsVariant>,
    pub segments: Vec<HlsSegment>,
    pub total_duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HlsVariant {
    pub bandwidth: u64,
    pub resolution: Option<String>,
    pub codecs: Option<String>,
    pub url: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HlsSegment {
    pub duration: f64,
    pub uri: String,
    pub sequence: u64,
    pub title: Option<String>,
    pub byte_range: Option<String>,
    pub discontinuity: bool,
}

/// 解析 m3u8 播放列表文本
pub fn parse_m3u8(content: &str, base_url: &str) -> HlsPlaylistInfo {
    let lines: Vec<&str> = content.lines().collect();
    let mut info = HlsPlaylistInfo {
        playlist_type: "media".to_string(),
        version: None,
        target_duration: None,
        media_sequence: None,
        is_live: true, // Assume live until we see #EXT-X-ENDLIST
        variants: Vec::new(),
        segments: Vec::new(),
        total_duration: 0.0,
    };

    let base = if let Some(idx) = base_url.rfind('/') {
        &base_url[..idx + 1]
    } else {
        base_url
    };

    let mut current_segment_duration: Option<f64> = None;
    let mut current_segment_title: Option<String> = None;
    let mut current_variant: Option<HlsVariant> = None;
    let mut sequence = 0u64;
    let mut next_discontinuity = false;

    for line in &lines {
        let line = line.trim();

        if line.starts_with("#EXT-X-VERSION:") {
            info.version = line[15..].trim().parse().ok();
        } else if line.starts_with("#EXT-X-TARGETDURATION:") {
            info.target_duration = line[22..].trim().parse().ok();
        } else if line.starts_with("#EXT-X-MEDIA-SEQUENCE:") {
            let seq: u64 = line[22..].trim().parse().unwrap_or(0);
            info.media_sequence = Some(seq);
            sequence = seq;
        } else if line.starts_with("#EXT-X-STREAM-INF:") {
            info.playlist_type = "master".to_string();
            let attrs = &line[18..];
            let mut variant = HlsVariant {
                bandwidth: 0,
                resolution: None,
                codecs: None,
                url: String::new(),
                name: None,
            };

            for attr in parse_attributes(attrs) {
                match attr.0.as_str() {
                    "BANDWIDTH" => { variant.bandwidth = attr.1.parse().unwrap_or(0); }
                    "RESOLUTION" => { variant.resolution = Some(attr.1.clone()); }
                    "CODECS" => { variant.codecs = Some(attr.1.trim_matches('"').to_string()); }
                    "NAME" => { variant.name = Some(attr.1.trim_matches('"').to_string()); }
                    _ => {}
                }
            }

            current_variant = Some(variant);
        } else if line.starts_with("#EXTINF:") {
            let rest = &line[8..];
            let duration_str = rest.split(',').next().unwrap_or("0");
            current_segment_duration = duration_str.trim().parse().ok();
            let title = rest.split(',').nth(1).map(|s| s.trim().to_string());
            current_segment_title = title;
        } else if line.starts_with("#EXT-X-ENDLIST") {
            info.is_live = false;
        } else if line.starts_with("#EXT-X-DISCONTINUITY") {
            next_discontinuity = true;
        } else if !line.is_empty() && !line.starts_with('#') {
            // This is a URI line
            let uri = if line.starts_with("http://") || line.starts_with("https://") {
                line.to_string()
            } else {
                format!("{}{}", base, line)
            };

            if let Some(mut variant) = current_variant.take() {
                variant.url = uri;
                info.variants.push(variant);
            } else if let Some(duration) = current_segment_duration.take() {
                info.segments.push(HlsSegment {
                    duration,
                    uri,
                    sequence,
                    title: current_segment_title.take(),
                    byte_range: None,
                    discontinuity: next_discontinuity,
                });
                info.total_duration += duration;
                sequence += 1;
                next_discontinuity = false;
            }
        }
    }

    info
}

/// 解析 m3u8 属性 (KEY=VALUE,KEY="VALUE")
fn parse_attributes(s: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let mut remaining = s;

    while !remaining.is_empty() {
        if let Some(eq_idx) = remaining.find('=') {
            let key = remaining[..eq_idx].trim().to_string();
            let after_eq = &remaining[eq_idx + 1..];

            let (value, rest) = if after_eq.starts_with('"') {
                // Quoted value
                if let Some(end_quote) = after_eq[1..].find('"') {
                    let val = after_eq[1..end_quote + 1].to_string();
                    let rest = &after_eq[end_quote + 2..];
                    (val, rest.trim_start_matches(',').trim())
                } else {
                    (after_eq.to_string(), "")
                }
            } else {
                // Unquoted value
                if let Some(comma_idx) = after_eq.find(',') {
                    (after_eq[..comma_idx].trim().to_string(), after_eq[comma_idx + 1..].trim())
                } else {
                    (after_eq.trim().to_string(), "")
                }
            };

            attrs.push((key, value));
            remaining = rest;
        } else {
            break;
        }
    }

    attrs
}

/// 从 URL 获取并解析 m3u8 播放列表
pub async fn fetch_and_parse_playlist(
    session_id: &str,
    url: &str,
    app: &AppHandle,
) -> Result<HlsPlaylistInfo, String> {
    // Emit request message
    let req_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: "hls".to_string(),
        summary: format!("GET {}", url),
        detail: format!("GET {} HTTP/1.1\r\nAccept: application/vnd.apple.mpegurl\r\n", url),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &req_msg);

    // Fetch
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client.get(url)
        .header("User-Agent", "ProtoForge/1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch m3u8: {}", e))?;

    let status = response.status();
    let body = response.text().await
        .map_err(|e| format!("Failed to read m3u8 body: {}", e))?;

    // Emit response message
    let resp_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "received".to_string(),
        protocol: "hls".to_string(),
        summary: format!("HTTP {} — {} bytes", status.as_u16(), body.len()),
        detail: body.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(body.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &resp_msg);

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }

    let playlist = parse_m3u8(&body, url);

    // Emit info message with summary
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "hls".to_string(),
        summary: format!(
            "{} playlist: {} variants, {} segments, {:.1}s total",
            if playlist.playlist_type == "master" { "Master" } else { "Media" },
            playlist.variants.len(),
            playlist.segments.len(),
            playlist.total_duration,
        ),
        detail: serde_json::to_string_pretty(&playlist).unwrap_or_default(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(playlist)
}
