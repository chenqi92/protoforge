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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerErrorEvent {
    session_id: String,
    error: String,
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
            // Emit player-error so frontend VideoPlayer can show the error
            let _ = app_clone.emit("player-error", &PlayerErrorEvent {
                session_id: sid.clone(),
                error: e.clone(),
            });
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

/// 使用 ffprobe 获取视频流元信息（带超时，防止阻塞）
fn probe_stream(ffprobe_path: &std::path::Path, url: &str) -> (u32, u32, String) {
    let mut cmd = std::process::Command::new(ffprobe_path);

    // 为流媒体 URL 添加超时参数，避免 ffprobe 无限阻塞
    let lower_url = url.to_lowercase();
    if lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://") {
        cmd.args(["-rw_timeout", "5000000"]); // 5 秒超时
    } else if lower_url.starts_with("rtsp://") {
        cmd.args(["-rtsp_transport", "tcp"]);
        cmd.args(["-stimeout", "5000000"]);
    } else {
        cmd.args(["-rw_timeout", "5000000"]);
    }

    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-select_streams", "v:0",
        "-analyzeduration", "3000000",
        "-probesize", "2000000",
        url,
    ]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    // Windows: 不弹控制台窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    // 启动子进程，用 try_wait 轮询防止无限阻塞
    match cmd.spawn() {
        Ok(mut child) => {
            // 轮询等待最多 8 秒
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            break None; // 超时
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("ffprobe wait error: {}", e);
                        let _ = child.kill();
                        break None;
                    }
                }
            };

            match status {
                Some(s) if s.success() => {
                    // 读取 stdout
                    if let Some(stdout) = child.stdout.take() {
                        use std::io::Read;
                        let mut output = Vec::new();
                        let mut reader = std::io::BufReader::new(stdout);
                        if reader.read_to_end(&mut output).is_ok() {
                            return parse_ffprobe_output(&output);
                        }
                    }
                    log::warn!("ffprobe: could not read stdout");
                }
                Some(s) => {
                    log::warn!("ffprobe exited with status: {}", s);
                }
                None => {
                    // 超时，杀掉子进程
                    log::warn!("ffprobe timed out, killing process");
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        Err(e) => {
            log::warn!("ffprobe spawn error: {}", e);
        }
    }

    // Fallback defaults
    (0, 0, "h264".to_string())
}

/// 解析 ffprobe JSON 输出
fn parse_ffprobe_output(output: &[u8]) -> (u32, u32, String) {
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(output) {
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

    // Protocol-specific input options
    let lower_url = url.to_lowercase();
    if lower_url.starts_with("rtsp://") {
        // RTSP: force TCP interleaved transport, set socket timeout
        cmd.args(["-rtsp_transport", "tcp"]);
        cmd.args(["-stimeout", "5000000"]);
    } else if lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://") {
        // RTMP: hint live stream mode, set connection timeout
        cmd.args(["-rtmp_live", "live"]);
        cmd.args(["-rw_timeout", "5000000"]);
    } else {
        // Generic: use rw_timeout for connection/read timeout
        cmd.args(["-rw_timeout", "5000000"]);
    }

    // Common input options
    cmd.args([
        "-analyzeduration", "3000000",
        "-probesize", "2000000",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
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

    // CRITICAL: Drain stderr in a separate thread to prevent pipe deadlock.
    // If stderr fills up and nobody reads it, FFmpeg blocks on write() and hangs.
    let stderr = child.stderr.take();
    let stderr_sid = session_id.to_string();
    let stderr_app = app.clone();
    let stderr_handle = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if !l.trim().is_empty() {
                            log::warn!("FFmpeg [{}]: {}", stderr_sid, l);
                            lines.push(l);
                        }
                    }
                    Err(_) => break,
                }
            }
            // Emit aggregated stderr as a protocol message for debugging
            if !lines.is_empty() {
                let msg = super::state::ProtocolMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    direction: "info".to_string(),
                    protocol: "player".to_string(),
                    summary: format!("FFmpeg stderr ({} lines)", lines.len()),
                    detail: lines.join("\n"),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    size: None,
                };
                let _ = stderr_app.emit("videostream-protocol-msg", &msg);
            }
        }
    });

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

    // 设置读取超时：如果 10 秒内没有数据，认为流已断开
    let mut no_data_start: Option<std::time::Instant> = None;
    let max_wait = std::time::Duration::from_secs(15);

    loop {
        if shutdown_flag.load(std::sync::atomic::Ordering::Relaxed) {
            log::info!("Player {}: shutdown requested", session_id);
            break;
        }

        let n = match reader.read(&mut buf) {
            Ok(0) => {
                // EOF — 流结束
                if seq == 0 {
                    // 没读到任何数据就 EOF，说明 FFmpeg 连接/启动失败
                    let _ = app.emit("player-error", &PlayerErrorEvent {
                        session_id: session_id.to_string(),
                        error: "FFmpeg 未能读取到流数据，请检查地址是否正确或流是否可用".to_string(),
                    });
                }
                break;
            }
            Ok(n) => {
                no_data_start = None;
                n
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut
                       || e.kind() == std::io::ErrorKind::WouldBlock => {
                // 非阻塞读取可能返回 WouldBlock
                if let Some(start) = no_data_start {
                    if start.elapsed() > max_wait {
                        log::warn!("Player {}: no data for {:?}, giving up", session_id, max_wait);
                        let _ = app.emit("player-error", &PlayerErrorEvent {
                            session_id: session_id.to_string(),
                            error: "流数据超时，可能已断开".to_string(),
                        });
                        break;
                    }
                } else {
                    no_data_start = Some(std::time::Instant::now());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            Err(e) => {
                log::warn!("Player {}: read error: {}", session_id, e);
                let _ = app.emit("player-error", &PlayerErrorEvent {
                    session_id: session_id.to_string(),
                    error: format!("读取流数据失败: {}", e),
                });
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

    // Wait for stderr drain thread to finish
    let _ = stderr_handle.join();

    log::info!("Player {}: stream ended, {} chunks, {} bytes total", session_id, seq, total_bytes);
    Ok(())
}
