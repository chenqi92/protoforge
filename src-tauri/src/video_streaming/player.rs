//! 内置视频播放器
//! 使用 FFmpeg CLI 子进程读取 RTSP/RTMP/HLS 等流
//! 通过 Tauri 事件将 H.264 数据推送到前端（避免 WebSocket 安全限制）
//! 前端用 MSE API + fMP4 封装播放

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
        summary: format!("播放器启动 — FFmpeg CLI: {}", url),
        detail: format!("源: {}\nFFmpeg: {}\n传输: Tauri IPC", url, ffmpeg_path.display()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    let sid = session_id.clone();
    let app_clone = app.clone();

    // Run FFmpeg CLI pipeline in a blocking thread
    std::thread::spawn(move || {
        let result = run_pipeline(&sid, &url, &ffmpeg_path, ffprobe_path.as_deref(), &app_clone, shutdown_rx);
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
fn probe_stream(ffprobe_path: &std::path::Path, url: &str) -> (u32, u32, String, Vec<u8>) {
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
                    return (width, height, codec, Vec::new());
                }
            }
        }
    }

    // Fallback defaults
    (0, 0, "h264".to_string(), Vec::new())
}

/// Blocking pipeline: spawn FFmpeg CLI -> read H.264 NAL units from stdout -> emit via Tauri events
fn run_pipeline(
    session_id: &str,
    url: &str,
    ffmpeg_path: &std::path::Path,
    ffprobe_path: Option<&std::path::Path>,
    app: &AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    log::info!("Player {}: opening {} via CLI", session_id, url);

    // Probe stream info
    let (width, height, codec, extradata) = if let Some(probe_path) = ffprobe_path {
        probe_stream(probe_path, url)
    } else {
        (0, 0, "h264".to_string(), Vec::new())
    };

    log::info!("Player {}: probed {}x{} codec={}", session_id, width, height, codec);

    // Build FFmpeg command
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

    // Output: copy video stream, convert to Annex B H.264, output to stdout
    cmd.args([
        "-c:v", "copy",
        "-an",                          // no audio
        "-bsf:v", "h264_mp4toannexb",  // ensure Annex B format with start codes
        "-f", "h264",                   // raw H.264 output
        "pipe:1",
    ]);

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    let stdout = child.stdout.take()
        .ok_or("无法获取 FFmpeg stdout")?;

    // Emit init event
    let init_event = PlayerInitEvent {
        session_id: session_id.to_string(),
        codec: codec.clone(),
        width,
        height,
        extradata: base64::engine::general_purpose::STANDARD.encode(&extradata),
    };
    let _ = app.emit("player-init", &init_event);

    // Read H.264 NAL units from stdout and emit as frame events
    let mut reader = std::io::BufReader::with_capacity(256 * 1024, stdout);
    let mut buf = vec![0u8; 512 * 1024]; // 512KB read buffer
    let mut nal_buffer = Vec::with_capacity(1024 * 1024); // accumulate NAL data
    let mut seq = 0u32;
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

        nal_buffer.extend_from_slice(&buf[..n]);

        // Split NAL units by start codes (0x00000001 or 0x000001)
        // and emit each complete NAL as a frame event
        while let Some((nal, remaining)) = extract_nal(&nal_buffer) {
            seq += 1;
            // Check NAL type for key frame detection (bit 5 of first byte after start code)
            let nal_type = nal.first().map(|b| b & 0x1F).unwrap_or(0);
            let is_key = nal_type == 5 || nal_type == 7; // IDR or SPS

            let frame_event = PlayerFrameEvent {
                session_id: session_id.to_string(),
                seq,
                pts: seq as i64, // CLI mode doesn't give us PTS easily
                is_key,
                data: base64::engine::general_purpose::STANDARD.encode(&nal),
            };

            if app.emit("player-frame", &frame_event).is_err() {
                errors += 1;
                if errors > 10 {
                    log::info!("Player {}: too many emit errors, stopping", session_id);
                    let _ = child.kill();
                    return Ok(());
                }
            }

            nal_buffer = remaining;

            // Pace output
            if seq % 2 == 0 {
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
        }
    }

    // Clean up child process
    let _ = child.kill();
    let _ = child.wait();

    log::info!("Player {}: stream ended after {} NAL units", session_id, seq);
    Ok(())
}

/// Extract one complete NAL unit from the buffer.
/// Returns (NAL data without start code, remaining buffer) or None if no complete NAL found.
fn extract_nal(buf: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    // Find first start code
    let start = find_start_code(buf, 0)?;
    let nal_start = start + if buf[start..].starts_with(&[0, 0, 0, 1]) { 4 } else { 3 };

    // Find next start code (marks end of current NAL)
    if let Some(next_start) = find_start_code(buf, nal_start) {
        let nal_data = buf[nal_start..next_start].to_vec();
        let remaining = buf[next_start..].to_vec();
        Some((nal_data, remaining))
    } else {
        // No next start code found — NAL is incomplete, wait for more data
        None
    }
}

/// Find the position of a start code (0x000001 or 0x00000001) starting from `from`.
fn find_start_code(buf: &[u8], from: usize) -> Option<usize> {
    if buf.len() < from + 3 {
        return None;
    }
    for i in from..buf.len().saturating_sub(2) {
        if buf[i] == 0 && buf[i + 1] == 0 {
            if buf[i + 2] == 1 {
                return Some(i);
            }
            if i + 3 < buf.len() && buf[i + 2] == 0 && buf[i + 3] == 1 {
                return Some(i);
            }
        }
    }
    None
}
