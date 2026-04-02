//! 内置视频播放器
//! 使用 FFmpeg CLI 子进程读取 RTSP/RTMP/HLS 等流
//! 输出 fragmented MP4 (fMP4)，通过 Tauri 事件推送到前端
//! 前端用 MSE API 直接 appendBuffer 播放

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tauri::{AppHandle, Emitter};
use base64::Engine;
use serde_json::Value;

use super::state::ProtocolMessage;
use super::ffmpeg_manager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInitEvent {
    session_id: String,
    codec: String,
    width: u32,
    height: u32,
    has_audio: bool,
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerStatsEvent {
    session_id: String,
    bytes_received: u64,
    packets_received: u64,
    packets_lost: u64,
    bitrate: u64,
    fps: f64,
    uptime: u64,
}

pub struct PlayerSession {
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

pub static PLAYER_SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, PlayerSession>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

pub async fn start_player(
    session_id: String,
    protocol: String,
    url: String,
    config: Option<String>,
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
    let protocol_clone = protocol.clone();

    // Run FFmpeg CLI pipeline in a blocking thread
    std::thread::spawn(move || {
        let result = run_fmp4_pipeline(
            &sid,
            &protocol_clone,
            &url,
            config.as_deref(),
            &ffmpeg_path,
            ffprobe_path.as_deref(),
            &app_clone,
            shutdown_rx,
        );
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

/// Detect FFmpeg major version and return the correct RTSP socket timeout flag.
/// FFmpeg < 8: -stimeout (microseconds)
/// FFmpeg >= 8: -timeout (microseconds, -stimeout was removed)
fn detect_rtsp_timeout_flag(ffmpeg_path: &std::path::Path) -> &'static str {
    // Cache result to avoid repeated subprocess spawns
    use std::sync::OnceLock;
    static FLAG: OnceLock<&'static str> = OnceLock::new();
    FLAG.get_or_init(|| {
        let output = std::process::Command::new(ffmpeg_path)
            .args(["-version"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(out) = output {
            let version_str = String::from_utf8_lossy(&out.stdout);
            // Parse "ffmpeg version X.Y.Z" or "ffmpeg version N-..."
            if let Some(ver_part) = version_str.split_whitespace().nth(2) {
                if let Some(major) = ver_part.split('.').next().and_then(|m| m.parse::<u32>().ok()) {
                    log::info!("Detected FFmpeg major version: {}", major);
                    if major >= 8 {
                        return "-timeout";
                    }
                }
            }
        }
        // Default to -stimeout for older/unknown versions
        "-stimeout"
    })
}

/// Stream probe result
struct ProbeResult {
    width: u32,
    height: u32,
    codec: String,
    has_audio: bool,
}

/// 使用 ffprobe 获取视频流元信息（带超时，防止阻塞）
/// 同时检测是否存在音频流，用于决定 FFmpeg 输出是否包含音频
fn probe_stream(
    ffprobe_path: &std::path::Path,
    protocol: &str,
    url: &str,
    config: &Value,
) -> ProbeResult {
    let mut cmd = std::process::Command::new(ffprobe_path);

    // 为流媒体 URL 添加超时参数
    let lower_url = url.to_lowercase();
    let is_rtmp = protocol == "rtmp" || lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://");
    if is_rtmp {
        // RTMP 需要完成握手+connect+play协商后才有数据，远程服务器可能需要更长时间
        cmd.args(["-rw_timeout", "15000000"]);
    } else if protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        let transport = config.get("transport")
            .and_then(|v| v.as_str())
            .unwrap_or("tcp");
        cmd.args(["-rtsp_transport", if transport == "udp" { "udp" } else { "tcp" }]);
        let flag = detect_rtsp_timeout_flag(ffprobe_path);
        cmd.args([flag, "5000000"]);
    } else if protocol == "srt" || lower_url.starts_with("srt://") {
        cmd.args(["-rw_timeout", "15000000"]);
    } else {
        cmd.args(["-rw_timeout", "5000000"]);
    }

    // RTMP 流远程探测需要更大的分析时间和缓冲
    let (analyze_dur, probe_sz) = if is_rtmp {
        ("8000000", "5000000")
    } else {
        ("3000000", "2000000")
    };

    // Probe ALL streams (not just video) so we can detect audio
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-analyzeduration", analyze_dur,
        "-probesize", probe_sz,
        url,
    ]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    // RTMP 远程服务器的完整探测可能需要更长时间
    let probe_deadline_secs = if is_rtmp { 18 } else { 8 };
    match cmd.spawn() {
        Ok(mut child) => {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(probe_deadline_secs);
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline { break None; }
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
                Some(s) => log::warn!("ffprobe exited with status: {}", s),
                None => {
                    log::warn!("ffprobe timed out, killing process");
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        Err(e) => log::warn!("ffprobe spawn error: {}", e),
    }

    ProbeResult { width: 0, height: 0, codec: "h264".to_string(), has_audio: false }
}

/// 解析 ffprobe JSON 输出 — 提取视频 codec/分辨率 + 检测音频流
fn parse_ffprobe_output(output: &[u8]) -> ProbeResult {
    let mut result = ProbeResult { width: 0, height: 0, codec: "h264".to_string(), has_audio: false };
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(output) {
        if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
            for stream in streams {
                let codec_type = stream.get("codec_type").and_then(|v| v.as_str()).unwrap_or("");
                match codec_type {
                    "video" if result.width == 0 => {
                        // First video stream
                        result.width = stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        result.height = stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        result.codec = stream.get("codec_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("h264")
                            .to_string();
                    }
                    "audio" => {
                        result.has_audio = true;
                    }
                    _ => {}
                }
            }
        }
    }
    result
}

fn parse_player_config(config: Option<&str>) -> Value {
    config
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_default()
}

fn inject_url_credentials(url: &str, username: &str, password: &str) -> String {
    if username.is_empty() && password.is_empty() {
        return url.to_string();
    }
    match url::Url::parse(url) {
        Ok(mut parsed) if parsed.username().is_empty() => {
            let _ = parsed.set_username(username);
            let _ = parsed.set_password(Some(password));
            parsed.to_string()
        }
        _ => url.to_string(),
    }
}

fn prepare_input_url(protocol: &str, url: &str, config: &Value) -> String {
    match protocol {
        "rtsp" => {
            let username = config.get("username").and_then(|v| v.as_str()).unwrap_or("");
            let password = config.get("password").and_then(|v| v.as_str()).unwrap_or("");
            inject_url_credentials(url, username, password)
        }
        "srt" => {
            let mut parsed = match url::Url::parse(url) {
                Ok(parsed) => parsed,
                Err(_) => return url.to_string(),
            };
            let mut params: Vec<(String, String)> = parsed.query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let mut push_if_missing = |key: &str, value: Option<String>| {
                if value.as_deref().map(str::is_empty).unwrap_or(true) {
                    return;
                }
                if params.iter().all(|(existing, _)| existing != key) {
                    params.push((key.to_string(), value.unwrap()));
                }
            };
            push_if_missing(
                "latency",
                config.get("latency").and_then(|v| v.as_u64()).map(|v| v.to_string()),
            );
            push_if_missing(
                "streamid",
                config.get("streamId").and_then(|v| v.as_str()).map(str::to_string),
            );
            push_if_missing(
                "passphrase",
                config.get("passphrase").and_then(|v| v.as_str()).map(str::to_string),
            );
            push_if_missing(
                "mode",
                config.get("mode").and_then(|v| v.as_str()).map(str::to_string),
            );
            parsed.set_query(None);
            let mut qp = parsed.query_pairs_mut();
            for (key, value) in params {
                qp.append_pair(&key, &value);
            }
            drop(qp);
            parsed.to_string()
        }
        _ => url.to_string(),
    }
}

fn run_fmp4_pipeline(
    session_id: &str,
    protocol: &str,
    url: &str,
    config: Option<&str>,
    ffmpeg_path: &std::path::Path,
    ffprobe_path: Option<&std::path::Path>,
    app: &AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let config = parse_player_config(config);
    let prepared_url = prepare_input_url(protocol, url, &config);

    log::info!("Player {}: opening {} via fMP4 pipeline", session_id, prepared_url);

    // Probe stream info (video codec + audio detection)
    let probe = if let Some(probe_path) = ffprobe_path {
        probe_stream(probe_path, protocol, &prepared_url, &config)
    } else {
        ProbeResult { width: 0, height: 0, codec: "h264".to_string(), has_audio: false }
    };

    log::info!("Player {}: probed {}x{} codec={} has_audio={}",
        session_id, probe.width, probe.height, probe.codec, probe.has_audio);

    let needs_transcode = probe.codec.contains("hevc") || probe.codec.contains("h265") || probe.codec.contains("hev");

    // If HEVC, we'll transcode to H.264 for MSE compatibility
    let output_codec = if needs_transcode { "h264".to_string() } else { probe.codec.clone() };
    let output_width = if probe.width > 1920 && needs_transcode { 1920 } else { probe.width };
    let output_height = if probe.width > 1920 && needs_transcode { 0 } else { probe.height };

    // Emit init event — frontend uses has_audio to decide MIME type
    // Small delay to ensure frontend event listeners are ready
    // (the probe usually takes seconds, but in case it's fast)
    std::thread::sleep(std::time::Duration::from_millis(200));
    let init_event = PlayerInitEvent {
        session_id: session_id.to_string(),
        codec: output_codec,
        width: output_width,
        height: output_height,
        has_audio: probe.has_audio,
    };
    let _ = app.emit("player-init", &init_event);

    // Build FFmpeg command — output fragmented MP4
    let mut cmd = std::process::Command::new(ffmpeg_path);
    cmd.args(["-hide_banner", "-loglevel", "warning"]);

    // Protocol-specific input options
    let lower_url = prepared_url.to_lowercase();
    let is_rtmp = protocol == "rtmp" || lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://");
    if protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        let transport = config.get("transport")
            .and_then(|v| v.as_str())
            .unwrap_or("tcp");
        cmd.args(["-rtsp_transport", if transport == "udp" { "udp" } else { "tcp" }]);
        let rtsp_timeout_flag = detect_rtsp_timeout_flag(ffmpeg_path);
        cmd.args([rtsp_timeout_flag, "5000000"]);
    } else if is_rtmp {
        cmd.args(["-rtmp_live", "live"]);
        // RTMP 握手+connect+play 协商完成后才有数据流，远程服务器需要更长超时
        cmd.args(["-rw_timeout", "15000000"]);
    } else if protocol == "srt" || lower_url.starts_with("srt://") {
        cmd.args(["-rw_timeout", "15000000"]);
    } else {
        cmd.args(["-rw_timeout", "5000000"]);
    }

    // RTMP 流需要缓冲来解析 FLV 容器的初始化数据（onMetaData + 第一个关键帧）
    // 使用 nobuffer 会导致初始化数据丢失，FFmpeg 无法解码
    let (analyze_dur, probe_sz) = if is_rtmp {
        ("8000000", "5000000")
    } else {
        ("3000000", "2000000")
    };

    // Common input options
    cmd.args([
        "-analyzeduration", analyze_dur,
        "-probesize", probe_sz,
    ]);

    // RTMP 不使用 nobuffer — 需要缓冲来完成 FLV 初始化解析
    // 其他协议可以用 nobuffer + low_delay 降低延迟
    if !is_rtmp {
        cmd.args(["-fflags", "nobuffer", "-flags", "low_delay"]);
    } else {
        cmd.args(["-fflags", "+discardcorrupt"]);
    }

    cmd.args(["-i", &prepared_url]);

    // ── Video output ──
    if needs_transcode {
        log::info!("Player {}: HEVC detected, transcoding to H.264 for MSE compatibility", session_id);
        if probe.width > 1920 {
            cmd.args(["-vf", "scale=1920:-2"]);
        }
        if cfg!(target_os = "macos") {
            cmd.args(["-c:v", "h264_videotoolbox", "-b:v", "4000k", "-realtime", "1"]);
        } else {
            cmd.args(["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-b:v", "4000k"]);
        }
    } else {
        cmd.args(["-c:v", "copy"]);
    }

    // ── Audio output (conditional) ──
    if probe.has_audio {
        cmd.args(["-c:a", "aac", "-ac", "1", "-ar", "44100", "-b:a", "64k"]);
    } else {
        cmd.args(["-an"]);
    }

    cmd.args([
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
    let stderr_protocol = protocol.to_string();
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
            // Use the detected stream protocol so messages appear in the correct tab
            if !lines.is_empty() {
                let msg = super::state::ProtocolMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    direction: "info".to_string(),
                    protocol: stderr_protocol.clone(),
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
    let start_time = std::time::Instant::now();
    let mut last_stats_at = start_time;
    let mut stats_bytes_window = 0u64;

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
        stats_bytes_window += n as u64;

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

        // Keep IPC bursts bounded without capping throughput too aggressively.
        if seq % 8 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        if last_stats_at.elapsed() >= std::time::Duration::from_secs(1) {
            let elapsed = last_stats_at.elapsed().as_secs_f64().max(0.001);
            let stats_event = PlayerStatsEvent {
                session_id: session_id.to_string(),
                bytes_received: total_bytes,
                packets_received: seq as u64,
                packets_lost: 0,
                bitrate: ((stats_bytes_window as f64 * 8.0) / 1000.0 / elapsed) as u64,
                fps: 0.0,
                uptime: start_time.elapsed().as_secs(),
            };
            let _ = app.emit("videostream-stats", &stats_event);
            stats_bytes_window = 0;
            last_stats_at = std::time::Instant::now();
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
