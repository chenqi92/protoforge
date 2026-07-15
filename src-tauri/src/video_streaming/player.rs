//! 内置视频播放器
//! 使用 FFmpeg CLI 子进程读取 RTSP/RTMP/HLS 等流
//! 输出 fragmented MP4 (fMP4)，通过 Tauri 事件推送到前端
//! 前端用 MSE API 直接 appendBuffer 播放

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

use super::ffmpeg_manager;
use super::state::{GenerationTagged, ProtocolMessage};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerInitEvent {
    session_id: String,
    generation: u64,
    codec: String,
    width: u32,
    height: u32,
    has_audio: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerDataEvent {
    session_id: String,
    generation: u64,
    seq: u32,
    data: String, // base64-encoded fMP4 chunk
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerErrorEvent {
    session_id: String,
    generation: u64,
    error: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerStatsEvent {
    session_id: String,
    generation: u64,
    bytes_received: u64,
    packets_received: u64,
    packets_lost: u64,
    bitrate: u64,
    fps: f64,
    uptime: u64,
}

fn truncate_log_line(mut line: String, max_bytes: usize) -> (String, bool) {
    if line.len() <= max_bytes {
        return (line, false);
    }
    let suffix = " …[truncated]";
    if max_bytes <= suffix.len() {
        let mut marker = suffix.to_string();
        let mut end = max_bytes.min(marker.len());
        while end > 0 && !marker.is_char_boundary(end) {
            end -= 1;
        }
        marker.truncate(end);
        return (marker, true);
    }
    let target = max_bytes.saturating_sub(suffix.len());
    let mut end = target.min(line.len());
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    line.truncate(end);
    line.push_str(suffix);
    (line, true)
}

fn read_bounded_to_end(
    mut reader: impl std::io::Read,
    max_bytes: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut truncated = false;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        let remaining = max_bytes.saturating_sub(output.len());
        let retained = remaining.min(size);
        output.extend_from_slice(&buffer[..retained]);
        truncated |= retained < size;
    }
    Ok((output, truncated))
}

pub struct PlayerSession {
    generation: String,
    gate: PlayerGenerationGate,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

pub static PLAYER_SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, PlayerSession>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// A synchronous generation gate shared by every thread belonging to one player start.
///
/// `emit_if_current` holds a read lock through `AppHandle::emit`, while stop/restart takes
/// the write lock to invalidate the generation. Once invalidation returns, an old worker
/// therefore cannot pass a check and publish an event afterwards.
#[derive(Clone)]
struct PlayerGenerationGate {
    generation: String,
    active: Arc<RwLock<bool>>,
}

impl PlayerGenerationGate {
    fn new() -> Self {
        Self {
            generation: uuid::Uuid::new_v4().to_string(),
            active: Arc::new(RwLock::new(true)),
        }
    }

    fn is_current(&self) -> bool {
        *self
            .active
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn invalidate(&self) {
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = false;
    }

    fn run_if_current<T>(&self, action: impl FnOnce() -> T) -> Option<T> {
        let active = self
            .active
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !*active {
            return None;
        }
        Some(action())
    }

    fn emit_if_current<S: Serialize + Clone>(
        &self,
        app: &AppHandle,
        event: &str,
        payload: &S,
    ) -> Result<bool, tauri::Error> {
        match self.run_if_current(|| app.emit(event, payload)) {
            Some(result) => result.map(|()| true),
            None => Ok(false),
        }
    }
}

/// Install a pending generation immediately, before any async FFmpeg discovery. This makes the
/// latest start invocation authoritative even when an older invocation finishes discovery later.
async fn begin_player_generation(session_id: &str) -> PlayerGenerationGate {
    let gate = PlayerGenerationGate::new();
    let previous_shutdown = {
        let mut sessions = PLAYER_SESSIONS.lock().await;
        let previous = sessions.remove(session_id);
        if let Some(previous) = previous.as_ref() {
            previous.gate.invalidate();
        }
        sessions.insert(
            session_id.to_string(),
            PlayerSession {
                generation: gate.generation.clone(),
                gate: gate.clone(),
                shutdown_tx: None,
            },
        );
        previous.and_then(|session| session.shutdown_tx)
    };
    if let Some(tx) = previous_shutdown {
        let _ = tx.send(());
    }
    gate
}

async fn remove_player_generation_if_current(
    session_id: &str,
    gate: &PlayerGenerationGate,
) -> bool {
    let mut sessions = PLAYER_SESSIONS.lock().await;
    let is_current = sessions
        .get(session_id)
        .is_some_and(|session| session.generation == gate.generation);
    if is_current {
        if let Some(session) = sessions.remove(session_id) {
            session.gate.invalidate();
        }
    }
    is_current
}

async fn attach_player_shutdown(
    session_id: &str,
    gate: &PlayerGenerationGate,
    shutdown_tx: oneshot::Sender<()>,
) -> bool {
    let mut shutdown_tx = Some(shutdown_tx);
    let attached = {
        let mut sessions = PLAYER_SESSIONS.lock().await;
        match sessions.get_mut(session_id) {
            Some(session) if session.generation == gate.generation && gate.is_current() => {
                session.shutdown_tx = shutdown_tx.take();
                true
            }
            _ => false,
        }
    };
    // Dropping an unattached sender also releases its receiver.
    drop(shutdown_tx);
    attached
}

pub async fn start_player(
    session_id: String,
    outer_generation: u64,
    protocol: String,
    url: String,
    config: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    let gate = begin_player_generation(&session_id).await;

    // 确保 FFmpeg 已安装
    let ffmpeg_path = match ffmpeg_manager::ensure_ffmpeg(&app).await {
        Ok(path) => path,
        Err(error) => {
            return if remove_player_generation_if_current(&session_id, &gate).await {
                Err(error)
            } else {
                // A newer start already owns the session; do not surface a stale failure.
                Ok(())
            };
        }
    };
    let ffprobe_path = ffmpeg_manager::get_ffprobe_path(&app).await.ok();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    if !attach_player_shutdown(&session_id, &gate, shutdown_tx).await {
        return Ok(());
    }

    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        direction: "info".to_string(),
        protocol: protocol.clone(),
        summary: format!("播放器启动 -- FFmpeg fMP4 管线: {}", url),
        detail: format!(
            "源: {}\nFFmpeg: {}\n输出: fragmented MP4 → Tauri IPC → MSE",
            url,
            ffmpeg_path.display()
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = gate.emit_if_current(
        &app,
        "videostream-protocol-msg",
        &GenerationTagged::new(&msg, outer_generation),
    );

    let sid = session_id.clone();
    let app_clone = app.clone();
    let protocol_clone = protocol.clone();
    let worker_gate = gate.clone();

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
            &worker_gate,
            outer_generation,
        );
        if let Err(e) = &result {
            log::warn!("Player {} error: {}", sid, e);
            // Emit player-error so frontend VideoPlayer can show the error
            let _ = worker_gate.emit_if_current(
                &app_clone,
                "player-error",
                &PlayerErrorEvent {
                    session_id: sid.clone(),
                    generation: outer_generation,
                    error: e.clone(),
                },
            );
            let msg = ProtocolMessage {
                id: uuid::Uuid::new_v4().to_string(),
                session_id: sid.clone(),
                direction: "info".to_string(),
                protocol: protocol_clone.clone(),
                summary: format!("播放器错误: {}", e),
                detail: e.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                size: None,
            };
            let _ = worker_gate.emit_if_current(
                &app_clone,
                "videostream-protocol-msg",
                &GenerationTagged::new(&msg, outer_generation),
            );
        }

        // Natural EOF and pipeline errors must release the registry sender as
        // well as the generation gate. The generation check prevents an old
        // worker from removing a newer restart for the same session id.
        tauri::async_runtime::spawn(async move {
            remove_player_generation_if_current(&sid, &worker_gate).await;
        });
    });

    // Give FFmpeg a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    Ok(())
}

pub async fn stop_player(session_id: &str) {
    let session = {
        let mut sessions = PLAYER_SESSIONS.lock().await;
        let session = sessions.remove(session_id);
        if let Some(session) = session.as_ref() {
            session.gate.invalidate();
        }
        session
    };
    if let Some(session) = session {
        if let Some(tx) = session.shutdown_tx {
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
pub(crate) async fn install_test_player_session(session_id: &str) {
    let _ = begin_player_generation(session_id).await;
}

#[cfg(test)]
pub(crate) async fn has_test_player_session(session_id: &str) -> bool {
    PLAYER_SESSIONS.lock().await.contains_key(session_id)
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
                if let Some(major) = ver_part
                    .split('.')
                    .next()
                    .and_then(|m| m.parse::<u32>().ok())
                {
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
    shutdown_rx: &mut oneshot::Receiver<()>,
    gate: &PlayerGenerationGate,
) -> Option<ProbeResult> {
    let mut cmd = std::process::Command::new(ffprobe_path);

    // 为流媒体 URL 添加超时参数
    let lower_url = url.to_lowercase();
    let is_rtmp =
        protocol == "rtmp" || lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://");
    if is_rtmp {
        // RTMP 需要完成握手+connect+play协商后才有数据，远程服务器可能需要更长时间
        cmd.args(["-rw_timeout", "15000000"]);
    } else if protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        let transport = config
            .get("transport")
            .and_then(|v| v.as_str())
            .unwrap_or("tcp");
        cmd.args([
            "-rtsp_transport",
            if transport == "udp" { "udp" } else { "tcp" },
        ]);
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
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-analyzeduration",
        analyze_dur,
        "-probesize",
        probe_sz,
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
            const MAX_FFPROBE_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
            let stdout_handle = child.stdout.take().map(|stdout| {
                std::thread::spawn(move || read_bounded_to_end(stdout, MAX_FFPROBE_OUTPUT_BYTES))
            });
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(probe_deadline_secs);
            let mut cancelled = false;
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {
                        let shutdown_requested = match shutdown_rx.try_recv() {
                            Ok(()) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => true,
                            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => false,
                        };
                        if shutdown_requested || !gate.is_current() {
                            cancelled = true;
                            let _ = child.kill();
                            let _ = child.wait();
                            break None;
                        }
                        if std::time::Instant::now() >= deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            break None;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("ffprobe wait error: {}", e);
                        let _ = child.kill();
                        let _ = child.wait();
                        break None;
                    }
                }
            };
            let output = stdout_handle
                .and_then(|handle| handle.join().ok())
                .and_then(Result::ok);
            if cancelled {
                return None;
            }
            match status {
                Some(s) if s.success() => {
                    if let Some((output, truncated)) = output {
                        if !truncated {
                            return Some(parse_ffprobe_output(&output));
                        }
                        log::warn!("ffprobe output exceeded {} bytes", MAX_FFPROBE_OUTPUT_BYTES);
                    } else {
                        log::warn!("ffprobe: could not read stdout");
                    }
                }
                Some(s) => log::warn!("ffprobe exited with status: {}", s),
                None => {
                    log::warn!("ffprobe timed out or failed");
                }
            }
        }
        Err(e) => log::warn!("ffprobe spawn error: {}", e),
    }

    Some(ProbeResult {
        width: 0,
        height: 0,
        codec: "h264".to_string(),
        has_audio: false,
    })
}

/// 解析 ffprobe JSON 输出 — 提取视频 codec/分辨率 + 检测音频流
fn parse_ffprobe_output(output: &[u8]) -> ProbeResult {
    let mut result = ProbeResult {
        width: 0,
        height: 0,
        codec: "h264".to_string(),
        has_audio: false,
    };
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(output) {
        if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
            for stream in streams {
                let codec_type = stream
                    .get("codec_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                match codec_type {
                    "video" if result.width == 0 => {
                        // First video stream
                        result.width =
                            stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        result.height =
                            stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        result.codec = stream
                            .get("codec_name")
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
            let username = config
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let password = config
                .get("password")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            inject_url_credentials(url, username, password)
        }
        "srt" => {
            let mut parsed = match url::Url::parse(url) {
                Ok(parsed) => parsed,
                Err(_) => return url.to_string(),
            };
            let mut params: Vec<(String, String)> = parsed
                .query_pairs()
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
                config
                    .get("latency")
                    .and_then(|v| v.as_u64())
                    .map(|v| v.to_string()),
            );
            push_if_missing(
                "streamid",
                config
                    .get("streamId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            );
            push_if_missing(
                "passphrase",
                config
                    .get("passphrase")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            );
            push_if_missing(
                "mode",
                config
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
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
    mut shutdown_rx: oneshot::Receiver<()>,
    gate: &PlayerGenerationGate,
    outer_generation: u64,
) -> Result<(), String> {
    if !gate.is_current() {
        return Ok(());
    }
    let config = parse_player_config(config);
    let prepared_url = prepare_input_url(protocol, url, &config);

    log::info!(
        "Player {}: opening {} via fMP4 pipeline",
        session_id,
        prepared_url
    );

    // Probe stream info (video codec + audio detection)
    let probe = if let Some(probe_path) = ffprobe_path {
        let Some(probe) = probe_stream(
            probe_path,
            protocol,
            &prepared_url,
            &config,
            &mut shutdown_rx,
            gate,
        ) else {
            return Ok(());
        };
        probe
    } else {
        ProbeResult {
            width: 0,
            height: 0,
            codec: "h264".to_string(),
            has_audio: false,
        }
    };
    if !gate.is_current() {
        return Ok(());
    }

    log::info!(
        "Player {}: probed {}x{} codec={} has_audio={}",
        session_id,
        probe.width,
        probe.height,
        probe.codec,
        probe.has_audio
    );

    let needs_transcode =
        probe.codec.contains("hevc") || probe.codec.contains("h265") || probe.codec.contains("hev");

    // If HEVC, we'll transcode to H.264 for MSE compatibility
    let output_codec = if needs_transcode {
        "h264".to_string()
    } else {
        probe.codec.clone()
    };
    let output_width = if probe.width > 1920 && needs_transcode {
        1920
    } else {
        probe.width
    };
    let output_height = if probe.width > 1920 && needs_transcode {
        0
    } else {
        probe.height
    };

    // Emit init event — frontend uses has_audio to decide MIME type
    // Small delay to ensure frontend event listeners are ready
    // (the probe usually takes seconds, but in case it's fast)
    std::thread::sleep(std::time::Duration::from_millis(200));
    let init_event = PlayerInitEvent {
        session_id: session_id.to_string(),
        generation: outer_generation,
        codec: output_codec,
        width: output_width,
        height: output_height,
        has_audio: probe.has_audio,
    };
    if !gate
        .emit_if_current(app, "player-init", &init_event)
        .unwrap_or(false)
    {
        return Ok(());
    }

    // Build FFmpeg command — output fragmented MP4
    let mut cmd = std::process::Command::new(ffmpeg_path);
    cmd.args(["-hide_banner", "-loglevel", "warning"]);

    // Protocol-specific input options
    let lower_url = prepared_url.to_lowercase();
    let is_rtmp =
        protocol == "rtmp" || lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://");
    if protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        let transport = config
            .get("transport")
            .and_then(|v| v.as_str())
            .unwrap_or("tcp");
        cmd.args([
            "-rtsp_transport",
            if transport == "udp" { "udp" } else { "tcp" },
        ]);
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
    cmd.args(["-analyzeduration", analyze_dur, "-probesize", probe_sz]);

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
        log::info!(
            "Player {}: HEVC detected, transcoding to H.264 for MSE compatibility",
            session_id
        );
        if probe.width > 1920 {
            cmd.args(["-vf", "scale=1920:-2"]);
        }
        if cfg!(target_os = "macos") {
            cmd.args([
                "-c:v",
                "h264_videotoolbox",
                "-b:v",
                "4000k",
                "-realtime",
                "1",
            ]);
        } else {
            cmd.args([
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-b:v",
                "4000k",
            ]);
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
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
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

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法获取 FFmpeg stdout")?;

    // CRITICAL: Drain stderr in a separate thread to prevent pipe deadlock.
    // If stderr fills up and nobody reads it, FFmpeg blocks on write() and hangs.
    let stderr = child.stderr.take();
    let stderr_sid = session_id.to_string();
    let stderr_protocol = protocol.to_string();
    let stderr_app = app.clone();
    let stderr_gate = gate.clone();
    let stderr_handle = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            const MAX_STDERR_LINES: usize = 200;
            const MAX_STDERR_BYTES: usize = 256 * 1024;
            const MAX_STDERR_LINE_BYTES: usize = 16 * 1024;
            let mut lines: std::collections::VecDeque<String> = std::collections::VecDeque::new();
            let mut retained_bytes = 0usize;
            let mut dropped_lines = 0usize;
            let mut truncated_lines = 0usize;
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if !l.trim().is_empty() {
                            let (line, truncated) = truncate_log_line(l, MAX_STDERR_LINE_BYTES);
                            truncated_lines += usize::from(truncated);
                            log::warn!("FFmpeg [{}]: {}", stderr_sid, line);
                            while !lines.is_empty()
                                && (lines.len() >= MAX_STDERR_LINES
                                    || retained_bytes + line.len() > MAX_STDERR_BYTES)
                            {
                                if let Some(removed) = lines.pop_front() {
                                    retained_bytes -= removed.len();
                                    dropped_lines += 1;
                                }
                            }
                            retained_bytes += line.len();
                            lines.push_back(line);
                        }
                    }
                    Err(_) => break,
                }
            }
            // Emit aggregated stderr as a protocol message for debugging
            // Use the detected stream protocol so messages appear in the correct tab
            if !lines.is_empty() {
                let mut detail = lines.into_iter().collect::<Vec<_>>().join("\n");
                if dropped_lines > 0 || truncated_lines > 0 {
                    detail.push_str(&format!(
                        "\n[stderr bounded: {} older lines dropped, {} long lines truncated]",
                        dropped_lines, truncated_lines
                    ));
                }
                let msg = super::state::ProtocolMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    session_id: stderr_sid.clone(),
                    direction: "info".to_string(),
                    protocol: stderr_protocol.clone(),
                    summary: format!("FFmpeg stderr (bounded, {} bytes retained)", retained_bytes),
                    detail,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    size: None,
                };
                let _ = stderr_gate.emit_if_current(
                    &stderr_app,
                    "videostream-protocol-msg",
                    &GenerationTagged::new(&msg, outer_generation),
                );
            }
        }
    });

    // Drain stdout on a dedicated reader thread. The pipeline thread can then
    // poll shutdown and kill FFmpeg even while the pipe itself is idle.
    let (stdout_tx, stdout_rx) = std::sync::mpsc::sync_channel::<std::io::Result<Vec<u8>>>(8);
    let stdout_handle = std::thread::spawn(move || {
        use std::io::Read;

        let mut reader = std::io::BufReader::with_capacity(128 * 1024, stdout);
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = stdout_tx.send(Ok(Vec::new()));
                    break;
                }
                Ok(size) => {
                    if stdout_tx.send(Ok(buf[..size].to_vec())).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = stdout_tx.send(Err(error));
                    break;
                }
            }
        }
    });

    let mut seq = 0u32;
    let mut total_bytes = 0u64;
    let mut errors = 0;
    let start_time = std::time::Instant::now();
    let mut last_stats_at = start_time;
    let mut stats_bytes_window = 0u64;

    // 15 秒内没有任何管线数据时，认为流已断开。
    let mut no_data_start: Option<std::time::Instant> = None;
    let max_wait = std::time::Duration::from_secs(15);

    loop {
        match shutdown_rx.try_recv() {
            Ok(()) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                log::info!("Player {}: shutdown requested", session_id);
                break;
            }
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
        }

        let chunk = match stdout_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(Ok(chunk)) if chunk.is_empty() => {
                // EOF — 流结束
                if seq == 0 {
                    // 没读到任何数据就 EOF，说明 FFmpeg 连接/启动失败
                    let _ = gate.emit_if_current(
                        app,
                        "player-error",
                        &PlayerErrorEvent {
                            session_id: session_id.to_string(),
                            generation: outer_generation,
                            error: "FFmpeg 未能读取到流数据，请检查地址是否正确或流是否可用"
                                .to_string(),
                        },
                    );
                }
                break;
            }
            Ok(Ok(chunk)) => {
                no_data_start = None;
                chunk
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if let Some(start) = no_data_start {
                    if start.elapsed() > max_wait {
                        log::warn!(
                            "Player {}: no data for {:?}, giving up",
                            session_id,
                            max_wait
                        );
                        let _ = gate.emit_if_current(
                            app,
                            "player-error",
                            &PlayerErrorEvent {
                                session_id: session_id.to_string(),
                                generation: outer_generation,
                                error: "流数据超时，可能已断开".to_string(),
                            },
                        );
                        break;
                    }
                } else {
                    no_data_start = Some(std::time::Instant::now());
                }
                continue;
            }
            Ok(Err(e)) => {
                log::warn!("Player {}: read error: {}", session_id, e);
                let _ = gate.emit_if_current(
                    app,
                    "player-error",
                    &PlayerErrorEvent {
                        session_id: session_id.to_string(),
                        generation: outer_generation,
                        error: format!("读取流数据失败: {}", e),
                    },
                );
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let n = chunk.len();

        seq += 1;
        total_bytes += n as u64;
        stats_bytes_window += n as u64;

        let data_event = PlayerDataEvent {
            session_id: session_id.to_string(),
            generation: outer_generation,
            seq,
            data: base64::engine::general_purpose::STANDARD.encode(&chunk),
        };

        match gate.emit_if_current(app, "player-data", &data_event) {
            Ok(true) => {}
            Ok(false) => break,
            Err(_) => {
                errors += 1;
                if errors > 10 {
                    log::info!("Player {}: too many emit errors, stopping", session_id);
                    break;
                }
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
                generation: outer_generation,
                bytes_received: total_bytes,
                packets_received: seq as u64,
                packets_lost: 0,
                bitrate: ((stats_bytes_window as f64 * 8.0) / 1000.0 / elapsed) as u64,
                fps: 0.0,
                uptime: start_time.elapsed().as_secs(),
            };
            if !gate
                .emit_if_current(app, "videostream-stats", &stats_event)
                .unwrap_or(false)
            {
                break;
            }
            stats_bytes_window = 0;
            last_stats_at = std::time::Instant::now();
        }
    }

    // Clean up child process
    let _ = child.kill();
    let _ = child.wait();
    drop(stdout_rx);

    // Wait for both pipe-drain threads to finish. Dropping the bounded stdout
    // receiver also releases a reader that was blocked while sending a chunk.
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    log::info!(
        "Player {}: stream ended, {} chunks, {} bytes total",
        session_id,
        seq,
        total_bytes
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn replacing_and_stopping_player_invalidates_older_generation_gates() {
        let session_id = format!("player-generation-test-{}", uuid::Uuid::new_v4());
        let first = begin_player_generation(&session_id).await;
        let second = begin_player_generation(&session_id).await;

        assert_ne!(first.generation, second.generation);
        assert!(!first.is_current());
        assert!(second.is_current());

        let actions = AtomicUsize::new(0);
        assert!(
            first
                .run_if_current(|| actions.fetch_add(1, Ordering::SeqCst))
                .is_none()
        );
        assert_eq!(actions.load(Ordering::SeqCst), 0);
        assert_eq!(
            second.run_if_current(|| actions.fetch_add(1, Ordering::SeqCst)),
            Some(0)
        );

        stop_player(&session_id).await;
        assert!(!second.is_current());
        assert!(
            second
                .run_if_current(|| actions.fetch_add(1, Ordering::SeqCst))
                .is_none()
        );
        assert_eq!(actions.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn natural_completion_cleanup_drops_shutdown_sender() {
        let session_id = format!("player-natural-end-test-{}", uuid::Uuid::new_v4());
        let gate = begin_player_generation(&session_id).await;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        assert!(attach_player_shutdown(&session_id, &gate, shutdown_tx).await);

        assert!(remove_player_generation_if_current(&session_id, &gate).await);
        assert!(!gate.is_current());
        assert!(shutdown_rx.await.is_err());
        assert!(!PLAYER_SESSIONS.lock().await.contains_key(&session_id));
    }

    #[test]
    fn stderr_line_truncation_is_utf8_safe_and_bounded() {
        let (short, truncated) = truncate_log_line("short".to_string(), 16);
        assert_eq!(short, "short");
        assert!(!truncated);

        let (long, truncated) = truncate_log_line("错误错误错误错误错误".to_string(), 20);
        assert!(truncated);
        assert!(long.is_char_boundary(long.len()));
        assert!(long.len() <= 20);
        assert!(long.ends_with("[truncated]"));
    }

    #[test]
    fn probe_output_drain_keeps_reading_after_retention_limit() {
        let input = vec![7u8; 128 * 1024];
        let (output, truncated) =
            read_bounded_to_end(std::io::Cursor::new(input), 32 * 1024).unwrap();
        assert_eq!(output.len(), 32 * 1024);
        assert!(truncated);
        assert!(output.iter().all(|byte| *byte == 7));
    }
}
