//! 内置视频播放器
//! 使用 ffmpeg-next (静态链接) 读取 RTSP/RTMP/HLS 等流
//! 通过 Tauri 事件将 H.264 数据推送到前端（避免 WebSocket 安全限制）
//! 前端用 MSE API + fMP4 封装播放

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tauri::{AppHandle, Emitter};
use base64::Engine;

use super::state::ProtocolMessage;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInitEvent {
    session_id: String,
    codec: String,
    width: u32,
    height: u32,
    extradata: String, // base64
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerFrameEvent {
    session_id: String,
    seq: u32,
    pts: i64,
    is_key: bool,
    data: String, // base64
}

pub struct PlayerSession {
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

pub static PLAYER_SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, PlayerSession>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

pub async fn start_player(
    session_id: String,
    url: String,
    app: AppHandle,
) -> Result<(), String> {
    stop_player(&session_id).await;

    let (shutdown_tx, _shutdown_rx) = oneshot::channel::<()>();

    PLAYER_SESSIONS.lock().await.insert(session_id.clone(), PlayerSession {
        shutdown_tx: Some(shutdown_tx),
    });

    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "player".to_string(),
        summary: format!("播放器启动 — ffmpeg 打开 {}", url),
        detail: format!("源: {}\n传输: Tauri IPC", url),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    let sid = session_id.clone();
    let app_clone = app.clone();

    // Run ffmpeg in a blocking thread
    std::thread::spawn(move || {
        let result = run_pipeline(&sid, &url, &app_clone);
        if let Err(e) = &result {
            log::warn!("Player {} error: {}", sid, e);
            let msg = ProtocolMessage {
                id: uuid::Uuid::new_v4().to_string(),
                direction: "info".to_string(),
                protocol: "player".to_string(),
                summary: format!("播放器错误: {}", e),
                detail: e.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                size: None,
            };
            let _ = app_clone.emit("videostream-protocol-msg", &msg);
        }
    });

    // Give ffmpeg a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    Ok(())
}

pub async fn stop_player(session_id: &str) {
    if let Some(session) = PLAYER_SESSIONS.lock().await.remove(session_id) {
        if let Some(tx) = session.shutdown_tx {
            let _ = tx.send(());
        }
    }
}

/// Blocking pipeline: open ffmpeg → read packets → emit via Tauri events
fn run_pipeline(session_id: &str, url: &str, app: &AppHandle) -> Result<(), String> {
    extern crate ffmpeg_next as ffmpeg;

    ffmpeg::init().map_err(|e| format!("ffmpeg init: {}", e))?;
    log::info!("Player {}: opening {}", session_id, url);

    let mut opts = ffmpeg::Dictionary::new();
    if url.starts_with("rtsp://") {
        opts.set("rtsp_transport", "tcp");
    }
    opts.set("stimeout", "5000000");
    opts.set("analyzeduration", "3000000");
    opts.set("probesize", "2000000");

    let mut ictx = ffmpeg::format::input_with_dictionary(url, opts)
        .map_err(|e| format!("打开流失败: {} — {}", url, e))?;

    log::info!("Player {}: opened, {} streams", session_id, ictx.nb_streams());

    let video_idx = ictx.streams().best(ffmpeg::media::Type::Video)
        .map(|s| s.index())
        .ok_or_else(|| "未找到视频流".to_string())?;

    let video_stream = ictx.stream(video_idx).unwrap();
    let params = video_stream.parameters();
    let (width, height, extradata) = unsafe {
        let p = params.as_ptr();
        let w = (*p).width as u32;
        let h = (*p).height as u32;
        let ed = if !(*p).extradata.is_null() && (*p).extradata_size > 0 {
            std::slice::from_raw_parts((*p).extradata, (*p).extradata_size as usize).to_vec()
        } else {
            Vec::new()
        };
        (w, h, ed)
    };

    log::info!("Player {}: video {}x{}, extradata {} bytes", session_id, width, height, extradata.len());

    // Emit init event
    let init_event = PlayerInitEvent {
        session_id: session_id.to_string(),
        codec: "h264".to_string(),
        width,
        height,
        extradata: base64::engine::general_purpose::STANDARD.encode(&extradata),
    };
    let _ = app.emit("player-init", &init_event);

    // Read and emit video packets
    let mut seq = 0u32;
    let mut errors = 0;

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_idx { continue; }

        let data = match packet.data() {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };

        seq += 1;
        let pts = packet.pts().unwrap_or(0);
        let is_key = packet.is_key();

        let frame_event = PlayerFrameEvent {
            session_id: session_id.to_string(),
            seq,
            pts,
            is_key,
            data: base64::engine::general_purpose::STANDARD.encode(data),
        };

        if app.emit("player-frame", &frame_event).is_err() {
            errors += 1;
            if errors > 10 {
                log::info!("Player {}: too many emit errors, stopping", session_id);
                break;
            }
        }

        // Pace output to avoid flooding the event bus
        // At 20fps, sleep ~50ms between frames
        if seq % 2 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    }

    log::info!("Player {}: stream ended after {} frames", session_id, seq);
    Ok(())
}
