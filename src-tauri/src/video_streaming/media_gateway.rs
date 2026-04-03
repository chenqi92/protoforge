//! 本地媒体网关
//! 将 RTSP / RTMP / SRT / ONVIF / GB28181 等源流统一转为本地 HLS，
//! 供前端播放器通过 http://127.0.0.1:<port>/videostream/<session>/index.m3u8 访问。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, oneshot};

use super::ffmpeg_manager;
use super::state::{ProtocolMessage, StreamEvent};

#[derive(Clone)]
struct GatewayServer {
    port: u16,
    root_dir: PathBuf,
}

struct GatewaySession {
    shutdown_tx: Option<oneshot::Sender<()>>,
    output_dir: PathBuf,
}

struct PreparedGatewayInput {
    display_source: String,
    ffmpeg_input: String,
    protocol_whitelist: Option<String>,
}

static SERVER_START_LOCK: std::sync::LazyLock<Arc<Mutex<()>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(())));
static SERVER_STATE: std::sync::LazyLock<Arc<Mutex<Option<GatewayServer>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));
static GATEWAY_SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, GatewaySession>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

async fn ensure_server(app: &AppHandle) -> Result<GatewayServer, String> {
    if let Some(existing) = SERVER_STATE.lock().await.clone() {
        return Ok(existing);
    }

    let _guard = SERVER_START_LOCK.lock().await;
    if let Some(existing) = SERVER_STATE.lock().await.clone() {
        return Ok(existing);
    }

    let root_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?
        .join("video-gateway");
    std::fs::create_dir_all(&root_dir).map_err(|e| format!("创建媒体网关目录失败: {}", e))?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("启动本地媒体网关失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取本地媒体网关端口失败: {}", e))?
        .port();

    let server = GatewayServer {
        port,
        root_dir: root_dir.clone(),
    };
    let serve_root = root_dir.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve(listener, serve_root).await {
            log::warn!("Media gateway server exited: {}", error);
        }
    });

    *SERVER_STATE.lock().await = Some(server.clone());
    Ok(server)
}

pub async fn start_hls_session(
    session_id: String,
    protocol: String,
    url: String,
    config: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    stop_hls_session(&session_id).await;

    let ffmpeg_path = ffmpeg_manager::ensure_ffmpeg(&app).await?;
    let server = ensure_server(&app).await?;
    let public_dir = format!("{}-{}", session_id, uuid::Uuid::new_v4().simple());
    let output_dir = server.root_dir.join(&public_dir);
    reset_output_dir(&output_dir)?;

    let player_config = parse_player_config(config.as_deref());
    let prepared_url = prepare_input_url(&protocol, &url, &player_config);
    let gateway_input = prepare_gateway_input(&protocol, &prepared_url, &output_dir)?;
    let rtsp_transport = resolve_rtsp_transport(&protocol, &prepared_url, &player_config);
    let playlist_path = output_dir.join("index.m3u8");
    let segment_pattern = output_dir.join("segment-%05d.ts");

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (startup_tx, startup_rx) = oneshot::channel::<Result<(), String>>();

    GATEWAY_SESSIONS.lock().await.insert(
        session_id.clone(),
        GatewaySession {
            shutdown_tx: Some(shutdown_tx),
            output_dir: output_dir.clone(),
        },
    );

    emit_protocol_message(
        &app,
        &protocol,
        "info",
        format!("本地 HLS 网关启动: {}", gateway_input.display_source),
        format!(
            "输入源: {}\nFFmpeg 输入: {}\nRTSP 传输: {}\n输出目录: {}\n本地播放地址: http://127.0.0.1:{}/videostream/{}/index.m3u8",
            gateway_input.display_source,
            gateway_input.ffmpeg_input,
            rtsp_transport,
            output_dir.display(),
            server.port,
            public_dir,
        ),
    );

    let sid = session_id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let result = run_hls_pipeline(
            &sid,
            &protocol,
            &gateway_input.ffmpeg_input,
            &rtsp_transport,
            gateway_input.protocol_whitelist.as_deref(),
            &ffmpeg_path,
            &playlist_path,
            &segment_pattern,
            &app_clone,
            shutdown_rx,
            startup_tx,
        );

        if let Err(error) = result {
            log::warn!("HLS gateway [{}] stopped with error: {}", sid, error);
        }
    });

    match tokio::time::timeout(std::time::Duration::from_secs(30), startup_rx).await {
        Ok(Ok(Ok(()))) => {
            let event = StreamEvent {
                session_id: session_id.clone(),
                event_type: "connected".to_string(),
                data: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            };
            let _ = app.emit("videostream-event", &event);
            Ok(format!(
                "hls:http://127.0.0.1:{}/videostream/{}/index.m3u8",
                server.port, public_dir
            ))
        }
        Ok(Ok(Err(error))) => {
            stop_hls_session(&session_id).await;
            Err(error)
        }
        Ok(Err(_)) => {
            stop_hls_session(&session_id).await;
            Err("本地 HLS 网关启动失败：启动信号丢失".to_string())
        }
        Err(_) => {
            stop_hls_session(&session_id).await;
            Err("本地 HLS 网关启动超时，未生成播放列表".to_string())
        }
    }
}

pub async fn stop_hls_session(session_id: &str) {
    let session = GATEWAY_SESSIONS.lock().await.remove(session_id);
    if let Some(mut session) = session {
        if let Some(tx) = session.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let output_dir = session.output_dir.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let _ = tokio::fs::remove_dir_all(output_dir).await;
        });
    }
}

async fn serve(listener: TcpListener, root_dir: PathBuf) -> Result<(), String> {
    loop {
        let (socket, _addr) = listener
            .accept()
            .await
            .map_err(|e| format!("媒体网关 accept 失败: {}", e))?;
        let root = root_dir.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle_connection(socket, root).await {
                log::debug!("Media gateway request error: {}", error);
            }
        });
    }
}

async fn handle_connection(mut socket: TcpStream, root_dir: PathBuf) -> Result<(), String> {
    let mut buffer = [0u8; 8192];
    let bytes_read = socket
        .read(&mut buffer)
        .await
        .map_err(|e| format!("读取请求失败: {}", e))?;
    if bytes_read == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut lines = request.lines();
    let request_line = lines.next().ok_or("非法 HTTP 请求")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        write_response(
            &mut socket,
            405,
            "text/plain; charset=utf-8",
            b"Method Not Allowed",
            method == "HEAD",
        )
        .await?;
        return Ok(());
    }

    let path = raw_path.split('?').next().unwrap_or("/");
    let target = resolve_request_path(&root_dir, path)?;
    if !target.exists() || !target.is_file() {
        write_response(
            &mut socket,
            404,
            "text/plain; charset=utf-8",
            b"Not Found",
            method == "HEAD",
        )
        .await?;
        return Ok(());
    }

    let body = tokio::fs::read(&target)
        .await
        .map_err(|e| format!("读取媒体文件失败: {}", e))?;
    let content_type = content_type_for_path(&target);
    write_response(&mut socket, 200, content_type, &body, method == "HEAD").await?;
    Ok(())
}

fn resolve_request_path(root_dir: &Path, request_path: &str) -> Result<PathBuf, String> {
    let mut path = root_dir.to_path_buf();
    let mut segments = request_path.trim_start_matches('/').split('/');

    match segments.next() {
        Some("videostream") => {}
        _ => return Err("非法媒体路径".to_string()),
    }

    for segment in segments {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
            return Err("非法媒体路径".to_string());
        }
        path.push(segment);
    }

    Ok(path)
}

async fn write_response(
    socket: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };

    let headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nContent-Type: {}\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        status,
        reason,
        body.len(),
        content_type,
    );

    socket
        .write_all(headers.as_bytes())
        .await
        .map_err(|e| format!("写入响应头失败: {}", e))?;
    if !head_only {
        socket
            .write_all(body)
            .await
            .map_err(|e| format!("写入响应体失败: {}", e))?;
    }
    socket
        .flush()
        .await
        .map_err(|e| format!("刷新响应失败: {}", e))?;
    Ok(())
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "m3u8" => "application/vnd.apple.mpegurl",
        "ts" => "video/mp2t",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn reset_output_dir(output_dir: &Path) -> Result<(), String> {
    if output_dir.exists() {
        std::fs::remove_dir_all(output_dir).map_err(|e| format!("清理旧媒体目录失败: {}", e))?;
    }
    std::fs::create_dir_all(output_dir).map_err(|e| format!("创建媒体目录失败: {}", e))
}

fn prepare_gateway_input(
    protocol: &str,
    prepared_url: &str,
    output_dir: &Path,
) -> Result<PreparedGatewayInput, String> {
    if protocol == "gb28181"
        && prepared_url
            .to_ascii_lowercase()
            .starts_with("gb28181+udp://")
    {
        let parsed = url::Url::parse(prepared_url)
            .map_err(|e| format!("解析 GB28181 媒体地址失败: {}", e))?;
        let host = if parsed.host_str().unwrap_or_default().is_empty() {
            "0.0.0.0".to_string()
        } else {
            parsed.host_str().unwrap_or("0.0.0.0").to_string()
        };
        let port = parsed
            .port()
            .ok_or_else(|| "GB28181 媒体地址缺少端口".to_string())?;
        let payload = parsed
            .query_pairs()
            .find(|(key, _)| key == "payload")
            .map(|(_, value)| value.to_string())
            .unwrap_or_else(|| "96".to_string());
        let encoding = parsed
            .query_pairs()
            .find(|(key, _)| key == "encoding")
            .map(|(_, value)| value.to_string())
            .unwrap_or_else(|| "MP2P".to_string());
        let sdp_path = output_dir.join("input.sdp");
        let sdp = format!(
            "v=0\r\n\
             o=- 0 0 IN IP4 {host}\r\n\
             s=GB28181\r\n\
             c=IN IP4 {host}\r\n\
             t=0 0\r\n\
             m=video {port} RTP/AVP {payload}\r\n\
             a=rtpmap:{payload} {encoding}/90000\r\n\
             a=recvonly\r\n",
        );
        std::fs::write(&sdp_path, sdp).map_err(|e| format!("写入 GB28181 SDP 文件失败: {}", e))?;

        return Ok(PreparedGatewayInput {
            display_source: prepared_url.to_string(),
            ffmpeg_input: sdp_path.to_string_lossy().to_string(),
            protocol_whitelist: Some("file,udp,rtp".to_string()),
        });
    }

    Ok(PreparedGatewayInput {
        display_source: prepared_url.to_string(),
        ffmpeg_input: prepared_url.to_string(),
        protocol_whitelist: None,
    })
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
            let mut query_pairs = parsed.query_pairs_mut();
            for (key, value) in params {
                query_pairs.append_pair(&key, &value);
            }
            drop(query_pairs);
            parsed.to_string()
        }
        _ => url.to_string(),
    }
}

fn resolve_rtsp_transport(protocol: &str, prepared_url: &str, config: &Value) -> String {
    let lower_url = prepared_url.to_lowercase();
    if protocol != "rtsp" && !lower_url.starts_with("rtsp://") {
        return "tcp".to_string();
    }

    match config.get("transport").and_then(|value| value.as_str()) {
        Some(value) if value.eq_ignore_ascii_case("udp") => "udp".to_string(),
        _ => "tcp".to_string(),
    }
}

fn detect_rtsp_timeout_flag(ffmpeg_path: &Path) -> &'static str {
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
            if let Some(ver_part) = version_str.split_whitespace().nth(2) {
                if let Some(major) = ver_part
                    .split('.')
                    .next()
                    .and_then(|value| value.parse::<u32>().ok())
                {
                    if major >= 8 {
                        return "-timeout";
                    }
                }
            }
        }
        "-stimeout"
    })
}

fn run_hls_pipeline(
    session_id: &str,
    protocol: &str,
    ffmpeg_input: &str,
    rtsp_transport: &str,
    protocol_whitelist: Option<&str>,
    ffmpeg_path: &Path,
    playlist_path: &Path,
    segment_pattern: &Path,
    app: &AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
    startup_tx: oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let mut cmd = std::process::Command::new(ffmpeg_path);
    cmd.args(["-hide_banner", "-loglevel", "warning", "-nostats"]);

    let lower_url = ffmpeg_input.to_lowercase();
    let is_rtmp =
        protocol == "rtmp" || lower_url.starts_with("rtmp://") || lower_url.starts_with("rtmps://");

    if protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        cmd.args(["-rtsp_transport", rtsp_transport]);
        let flag = detect_rtsp_timeout_flag(ffmpeg_path);
        cmd.args([flag, "5000000"]);
    } else if is_rtmp {
        cmd.args(["-rtmp_live", "live", "-rw_timeout", "15000000"]);
    } else if protocol == "srt" || lower_url.starts_with("srt://") {
        cmd.args(["-rw_timeout", "15000000"]);
    } else {
        cmd.args(["-rw_timeout", "5000000"]);
    }

    let (analyze_duration, probe_size) = if is_rtmp {
        ("8000000", "5000000")
    } else {
        ("3000000", "2000000")
    };
    cmd.args([
        "-analyzeduration",
        analyze_duration,
        "-probesize",
        probe_size,
    ]);

    if !is_rtmp {
        cmd.args(["-fflags", "nobuffer", "-flags", "low_delay"]);
    } else {
        cmd.args(["-fflags", "+discardcorrupt"]);
    }

    if let Some(whitelist) = protocol_whitelist {
        cmd.args(["-protocol_whitelist", whitelist]);
    }
    cmd.args(["-i", ffmpeg_input]);
    cmd.args(["-map", "0:v:0", "-map", "0:a?"]);

    if cfg!(target_os = "macos") {
        cmd.args([
            "-c:v",
            "h264_videotoolbox",
            "-realtime",
            "1",
            "-b:v",
            "4000k",
        ]);
    } else {
        cmd.args([
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
        ]);
    }

    cmd.args(["-g", "25", "-keyint_min", "25", "-sc_threshold", "0"]);
    cmd.args(["-c:a", "aac", "-ac", "1", "-ar", "44100", "-b:a", "96k"]);
    cmd.args([
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+append_list+independent_segments+omit_endlist",
        "-hls_segment_filename",
        &segment_pattern.to_string_lossy(),
        &playlist_path.to_string_lossy(),
    ]);

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 FFmpeg HLS 网关失败: {}", e))?;

    let stderr = child.stderr.take();
    let sid = session_id.to_string();
    let protocol_name = protocol.to_string();
    let app_clone = app.clone();
    let stderr_handle = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = Vec::new();
            for line in reader.lines() {
                match line {
                    Ok(value) if !value.trim().is_empty() => lines.push(value),
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            if !lines.is_empty() {
                emit_protocol_message(
                    &app_clone,
                    &protocol_name,
                    "info",
                    format!("FFmpeg HLS stderr ({} lines)", lines.len()),
                    lines.join("\n"),
                );
            }
            log::debug!("HLS gateway stderr drained for {}", sid);
        }
    });

    let shutdown_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let wait_flag = shutdown_flag.clone();
    std::thread::spawn(move || {
        let _ = shutdown_rx.blocking_recv();
        wait_flag.store(true, std::sync::atomic::Ordering::Relaxed);
    });

    let mut startup_tx = Some(startup_tx);
    let mut started = false;
    let mut status_error: Option<String> = None;

    loop {
        if shutdown_flag.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            break;
        }

        if !started && playlist_path.exists() {
            if std::fs::metadata(playlist_path)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false)
            {
                started = true;
                if let Some(tx) = startup_tx.take() {
                    let _ = tx.send(Ok(()));
                }
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    status_error = Some(format!("FFmpeg HLS 进程退出异常: {}", status));
                }
                break;
            }
            Ok(None) => {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(error) => {
                status_error = Some(format!("等待 FFmpeg HLS 进程状态失败: {}", error));
                break;
            }
        }
    }

    let _ = stderr_handle.join();

    if !started {
        let message = status_error.unwrap_or_else(|| "本地 HLS 网关未生成播放列表".to_string());
        if let Some(tx) = startup_tx.take() {
            let _ = tx.send(Err(message.clone()));
        }
        emit_stream_error(app, session_id, &message);
        return Err(message);
    }

    if let Some(error) = status_error {
        emit_stream_error(app, session_id, &error);
        return Err(error);
    }

    Ok(())
}

fn emit_protocol_message(
    app: &AppHandle,
    protocol: &str,
    direction: &str,
    summary: String,
    detail: String,
) {
    let message = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: direction.to_string(),
        protocol: protocol.to_string(),
        summary,
        detail,
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &message);
}

fn emit_stream_error(app: &AppHandle, session_id: &str, error: &str) {
    let event = StreamEvent {
        session_id: session_id.to_string(),
        event_type: "error".to_string(),
        data: Some(error.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{prepare_gateway_input, prepare_input_url, resolve_rtsp_transport};

    #[test]
    fn prepare_rtsp_url_injects_credentials() {
        let config = serde_json::json!({
            "username": "admin",
            "password": "secret",
        });

        let prepared = prepare_input_url("rtsp", "rtsp://192.168.1.10:554/live", &config);

        assert!(prepared.starts_with("rtsp://admin:secret@192.168.1.10:554/live"));
    }

    #[test]
    fn prepare_srt_url_preserves_existing_query_and_adds_missing_fields() {
        let config = serde_json::json!({
            "latency": 250,
            "streamId": "#!::r=live/test",
            "mode": "caller",
        });

        let prepared = prepare_input_url(
            "srt",
            "srt://example.com:9000?passphrase=test-pass",
            &config,
        );

        assert!(prepared.contains("passphrase=test-pass"));
        assert!(prepared.contains("latency=250"));
        assert!(prepared.contains("streamid=%23%21%3A%3Ar%3Dlive%2Ftest"));
        assert!(prepared.contains("mode=caller"));
    }

    #[test]
    fn resolve_rtsp_transport_prefers_explicit_udp() {
        let config = serde_json::json!({
            "transport": "udp",
        });

        let transport = resolve_rtsp_transport("rtsp", "rtsp://example.com/live", &config);

        assert_eq!(transport, "udp");
    }

    #[test]
    fn resolve_rtsp_transport_defaults_to_tcp_for_non_rtsp_inputs() {
        let config = serde_json::json!({
            "transport": "udp",
        });

        let transport = resolve_rtsp_transport("onvif", "http://127.0.0.1/stream.m3u8", &config);

        assert_eq!(transport, "tcp");
    }

    #[test]
    fn prepare_gb28181_gateway_input_generates_local_sdp() {
        let temp_dir =
            std::env::temp_dir().join(format!("protoforge-gb28181-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("temp dir");

        let prepared = prepare_gateway_input(
            "gb28181",
            "gb28181+udp://0.0.0.0:6000?payload=98&encoding=PS",
            &temp_dir,
        )
        .expect("prepared gateway input");

        let sdp_path = PathBuf::from(&prepared.ffmpeg_input);
        let sdp = std::fs::read_to_string(&sdp_path).expect("sdp contents");

        assert_eq!(
            prepared.display_source,
            "gb28181+udp://0.0.0.0:6000?payload=98&encoding=PS"
        );
        assert_eq!(prepared.protocol_whitelist.as_deref(), Some("file,udp,rtp"));
        assert_eq!(
            sdp_path.file_name().and_then(|value| value.to_str()),
            Some("input.sdp")
        );
        assert!(sdp.contains("m=video 6000 RTP/AVP 98"));
        assert!(sdp.contains("a=rtpmap:98 PS/90000"));

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn prepare_gateway_input_passthrough_keeps_non_gb_sources() {
        let temp_dir =
            std::env::temp_dir().join(format!("protoforge-gateway-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("temp dir");

        let prepared = prepare_gateway_input("rtsp", "rtsp://example.com/live", &temp_dir)
            .expect("prepared gateway input");

        assert_eq!(prepared.display_source, "rtsp://example.com/live");
        assert_eq!(prepared.ffmpeg_input, "rtsp://example.com/live");
        assert!(prepared.protocol_whitelist.is_none());

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
