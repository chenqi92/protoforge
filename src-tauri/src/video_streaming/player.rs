//! 内置视频播放器
//! 使用 FFmpeg CLI 子进程读取 RTSP/RTMP/HLS 等流
//! 输出 fragmented MP4 (fMP4)，通过 Tauri 事件推送到前端
//! 前端用 MSE API 直接 appendBuffer 播放

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tauri::{AppHandle, Emitter};
use base64::Engine;

use super::state::ProtocolMessage;
use super::ffmpeg_manager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInitEvent {
    session_id: String,
    codec: String,
    width: u32,
    height: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerDataEvent {
    session_id: String,
    seq: u32,
    data: String, // base64-encoded fMP4 chunk
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

    // 确保 FFmpeg 已安装
    let ffmpeg_path = ffmpeg_manager::ensure_ffmpeg(&app).await?;
    let ffprobe_path = ffmpeg_manager::get_ffprobe_path(&app).await.ok();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    PLAYER_SESSIONS.lock().await.insert(session_id.clone(), PlayerSession {
        shutdown_tx: Some(shutdown_tx),
    });

    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "player".to_string(),
        summary: format!("播放器启动 -- FFmpeg fMP4 管线: {}", url),
        detail: format!("源: {}\nFFmpeg: {}\n输出: fragmented MP4 → Tauri IPC → MSE", url, ffmpeg_path.display()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    let sid = session_id.clone();
    let app_clone = app.clone();

    // Run FFmpeg CLI pipeline in a blocking thread
    std::thread::spawn(move || {
        let result = run_fmp4_pipeline(&sid, &url, &ffmpeg_path, ffprobe_path.as_deref(), &app_clone, shutdown_rx);
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

    // Give FFmpeg a moment to start
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

/// 使用 ffprobe 获取视频流元信息
fn probe_stream(ffprobe_path: &std::path::Path, url: &str) -> (u32, u32, String) {
    let output = std::process::Command::new(ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-select_streams", "v:0",
            url,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    if let Ok(output) = output {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
            if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
                if let Some(stream) = streams.first() {
                    let width = stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let height = stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let codec = stream.get("codec_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("h264")
                        .to_string();
                    return (width, height, codec);
                }
            }
        }
    }

    // Fallback defaults
    (0, 0, "h264".to_string())
}

/// Blocking pipeline: spawn FFmpeg CLI → output fMP4 to stdout → read chunks → emit via Tauri events
fn run_fmp4_pipeline(
    session_id: &str,
    url: &str,
    ffmpeg_path: &std::path::Path,
    ffprobe_path: Option<&std::path::Path>,
    app: &AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    log::info!("Player {}: opening {} via fMP4 pipeline", session_id, url);

    // Probe stream info
    let (width, height, codec) = if let Some(probe_path) = ffprobe_path {
        probe_stream(probe_path, url)
    } else {
        (0, 0, "h264".to_string())
    };

    log::info!("Player {}: probed {}x{} codec={}", session_id, width, height, codec);

    // Emit init event (metadata only, no extradata needed — fMP4 moov contains avcC/hvcC)
    let init_event = PlayerInitEvent {
        session_id: session_id.to_string(),
        codec: codec.clone(),
        width,
        height,
    };
    let _ = app.emit("player-init", &init_event);

    // Build FFmpeg command — output fragmented MP4
    let mut cmd = std::process::Command::new(ffmpeg_path);
    cmd.args(["-hide_banner", "-loglevel", "warning"]);

    // Input options
    if url.starts_with("rtsp://") {
        cmd.args(["-rtsp_transport", "tcp"]);
    }
    cmd.args([
        "-stimeout", "5000000",
        "-analyzeduration", "3000000",
        "-probesize", "2000000",
        "-i", url,
    ]);

    // Output: copy video stream → fragmented MP4 to stdout
    // -movflags frag_keyframe: fragment on each keyframe
    // -movflags empty_moov: put no samples in initial moov (required for streaming)
    // -movflags default_base_moof: required by MSE spec
    cmd.args([
        "-c:v", "copy",
        "-an",                          // no audio
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
    ]);

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Windows: prevent console window from flashing
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    let stdout = child.stdout.take()
        .ok_or("无法获取 FFmpeg stdout")?;

    // Read fMP4 chunks from stdout and emit as data events
    let mut reader = std::io::BufReader::with_capacity(128 * 1024, stdout);
    let mut buf = vec![0u8; 64 * 1024]; // 64KB read buffer
    let mut seq = 0u32;
    let mut total_bytes = 0u64;
    let mut errors = 0;

    // Check shutdown in a non-blocking way
    let shutdown_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag_clone = shutdown_flag.clone();
    std::thread::spawn(move || {
        let _ = shutdown_rx.blocking_recv();
        flag_clone.store(true, std::sync::atomic::Ordering::Relaxed);
    });

    use std::io::Read;
    loop {
        if shutdown_flag.load(std::sync::atomic::Ordering::Relaxed) {
            log::info!("Player {}: shutdown requested", session_id);
            break;
        }

        let n = match reader.read(&mut buf) {
            Ok(0) => break, // EOF
            Ok(n) => n,
            Err(e) => {
                log::warn!("Player {}: read error: {}", session_id, e);
                break;
            }
        };

        seq += 1;
        total_bytes += n as u64;

        let data_event = PlayerDataEvent {
            session_id: session_id.to_string(),
            seq,
            data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
        };

        if app.emit("player-data", &data_event).is_err() {
            errors += 1;
            if errors > 10 {
                log::info!("Player {}: too many emit errors, stopping", session_id);
                let _ = child.kill();
                return Ok(());
            }
        }

        // Pace output to avoid overwhelming IPC
        // ~30fps at 64KB chunks ≈ ~15Mbps throughput, sufficient for most streams
        if seq % 3 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    // Clean up child process
    let _ = child.kill();
    let _ = child.wait();

    log::info!("Player {}: stream ended, {} chunks, {} bytes total", session_id, seq, total_bytes);
    Ok(())
}
