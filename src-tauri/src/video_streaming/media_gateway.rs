//! 本地媒体网关
//! 将 RTSP / RTMP / SRT / ONVIF / GB28181 等源流统一转为本地 HLS，
//! 供前端播放器通过 http://127.0.0.1:<port>/videostream/<session>/index.m3u8 访问。

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Semaphore, oneshot};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::ffmpeg_manager;
use super::state::{GenerationTagged, ProtocolMessage, StreamEvent};

#[derive(Clone)]
struct GatewayServer {
    port: u16,
    root_dir: PathBuf,
}

struct GenerationEntry<T> {
    generation: u64,
    value: T,
}

struct GatewaySession {
    shutdown: CancellationToken,
    task: JoinHandle<()>,
    output_dir: Arc<Mutex<Option<PathBuf>>>,
}

struct PreparedGatewayInput {
    display_source: String,
    ffmpeg_input: String,
    protocol_whitelist: Option<String>,
}

struct PipelineArgs {
    session_id: String,
    generation: u64,
    outer_generation: u64,
    protocol: String,
    ffmpeg_input: String,
    rtsp_transport: String,
    protocol_whitelist: Option<String>,
    ffmpeg_path: PathBuf,
    playlist_path: PathBuf,
    segment_pattern: PathBuf,
    playback_url: String,
    app: AppHandle,
}

const MAX_GATEWAY_CONNECTIONS: usize = 64;
const ACCEPT_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const SOCKET_IDLE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REQUEST_HEADER_BYTES: usize = 16 * 1024;
const FILE_CHUNK_SIZE: usize = 64 * 1024;
const STDERR_MAX_LINES: usize = 200;
const STDERR_MAX_BYTES: usize = 256 * 1024;
const SESSION_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const SESSION_TASK_REAP_TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
const OUTPUT_CLEANUP_RETRY_DELAYS: [Duration; 4] = [
    Duration::from_millis(250),
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(10),
];

static SERVER_START_LOCK: std::sync::LazyLock<Arc<Mutex<()>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(())));
static SERVER_STATE: std::sync::LazyLock<Arc<Mutex<Option<GatewayServer>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));
static GATEWAY_SESSIONS: std::sync::LazyLock<
    Arc<Mutex<HashMap<String, GenerationEntry<GatewaySession>>>>,
> = std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));
static SESSION_OPERATIONS: std::sync::LazyLock<Mutex<HashMap<String, Weak<Mutex<()>>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_SESSION_GENERATION: AtomicU64 = AtomicU64::new(1);

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
    if root_dir.exists()
        && let Err(error) = std::fs::remove_dir_all(&root_dir)
    {
        log::warn!(
            "Failed to sweep stale media gateway directory {}: {}",
            root_dir.display(),
            error
        );
    }
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
    outer_generation: u64,
    protocol: String,
    url: String,
    config: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let operation = session_operation(&session_id).await;
    let _operation_guard = operation.lock().await;

    let previous = {
        let mut sessions = GATEWAY_SESSIONS.lock().await;
        sessions.remove(&session_id).map(|entry| {
            entry.value.shutdown.cancel();
            entry.value
        })
    };
    if let Some(previous) = previous {
        reap_gateway_session(previous, SESSION_TASK_REAP_TIMEOUT).await;
    }

    let generation = next_session_generation();
    let shutdown = CancellationToken::new();
    let (gate_tx, gate_rx) = oneshot::channel();
    let (prepared_tx, prepared_rx) = oneshot::channel::<Result<String, String>>();
    let (startup_tx, startup_rx) = oneshot::channel::<Result<(), String>>();
    let supervisor_app = app.clone();
    let output_dir = Arc::new(Mutex::new(None));

    {
        let mut sessions = GATEWAY_SESSIONS.lock().await;
        let supervisor_session_id = session_id.clone();
        let supervisor_shutdown = shutdown.clone();
        let supervisor_output_dir = output_dir.clone();
        let task = tokio::spawn(async move {
            supervise_hls_session(
                gate_rx,
                supervisor_session_id,
                generation,
                outer_generation,
                protocol,
                url,
                config,
                supervisor_app,
                supervisor_shutdown,
                supervisor_output_dir,
                prepared_tx,
                startup_tx,
            )
            .await;
        });
        sessions.insert(
            session_id.clone(),
            GenerationEntry {
                generation,
                value: GatewaySession {
                    shutdown: shutdown.clone(),
                    task,
                    output_dir,
                },
            },
        );
    }
    let _ = gate_tx.send(());
    drop(_operation_guard);

    let playback_url = match tokio::time::timeout(SESSION_STARTUP_TIMEOUT, prepared_rx).await {
        Ok(Ok(Ok(playback_url))) => playback_url,
        Ok(Ok(Err(error))) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            return Err(error);
        }
        Ok(Err(_)) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            return Err("本地 HLS 网关启动失败：准备信号丢失".to_string());
        }
        Err(_) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            return Err("本地 HLS 网关准备超时".to_string());
        }
    };

    match tokio::time::timeout(SESSION_STARTUP_TIMEOUT, startup_rx).await {
        Ok(Ok(Ok(()))) => {
            let event = StreamEvent {
                session_id: session_id.clone(),
                generation: Some(outer_generation),
                event_type: "connected".to_string(),
                data: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            };
            if emit_stream_event_if_current(&app, &session_id, generation, &event).await {
                Ok(playback_url)
            } else {
                Err("本地 HLS 网关启动已被更新的会话取代".to_string())
            }
        }
        Ok(Ok(Err(error))) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            Err(error)
        }
        Ok(Err(_)) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            Err("本地 HLS 网关启动失败：启动信号丢失".to_string())
        }
        Err(_) => {
            stop_hls_generation(&session_id, Some(generation)).await;
            Err("本地 HLS 网关启动超时，未生成播放列表".to_string())
        }
    }
}

pub async fn stop_hls_session(session_id: &str) {
    stop_hls_generation(session_id, None).await;
}

#[cfg(test)]
pub(crate) async fn install_test_hls_session(session_id: &str) {
    let operation = session_operation(session_id).await;
    let _operation_guard = operation.lock().await;
    let previous = {
        let mut sessions = GATEWAY_SESSIONS.lock().await;
        sessions.remove(session_id).map(|entry| {
            entry.value.shutdown.cancel();
            entry.value
        })
    };
    if let Some(previous) = previous {
        reap_gateway_session(previous, SESSION_TASK_REAP_TIMEOUT).await;
    }

    let shutdown = CancellationToken::new();
    let task_shutdown = shutdown.clone();
    let task = tokio::spawn(async move {
        task_shutdown.cancelled().await;
    });
    GATEWAY_SESSIONS.lock().await.insert(
        session_id.to_string(),
        GenerationEntry {
            generation: next_session_generation(),
            value: GatewaySession {
                shutdown,
                task,
                output_dir: Arc::new(Mutex::new(None)),
            },
        },
    );
}

#[cfg(test)]
pub(crate) async fn has_test_hls_session(session_id: &str) -> bool {
    GATEWAY_SESSIONS.lock().await.contains_key(session_id)
}

async fn session_operation(session_id: &str) -> Arc<Mutex<()>> {
    let mut operations = SESSION_OPERATIONS.lock().await;
    operations.retain(|_, operation| operation.strong_count() > 0);
    if let Some(operation) = operations.get(session_id).and_then(Weak::upgrade) {
        return operation;
    }

    let operation = Arc::new(Mutex::new(()));
    operations.insert(session_id.to_string(), Arc::downgrade(&operation));
    operation
}

fn next_session_generation() -> u64 {
    NEXT_SESSION_GENERATION.fetch_add(1, Ordering::Relaxed)
}

fn take_generation_if_current<T>(
    entries: &mut HashMap<String, GenerationEntry<T>>,
    session_id: &str,
    generation: u64,
) -> Option<GenerationEntry<T>> {
    if entries
        .get(session_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        entries.remove(session_id)
    } else {
        None
    }
}

async fn remove_generation_if_current(session_id: &str, generation: u64) {
    let mut sessions = GATEWAY_SESSIONS.lock().await;
    let _ = take_generation_if_current(&mut sessions, session_id, generation);
}

async fn stop_hls_generation(session_id: &str, expected_generation: Option<u64>) {
    let operation = session_operation(session_id).await;
    let _operation_guard = operation.lock().await;
    let session = {
        let mut sessions = GATEWAY_SESSIONS.lock().await;
        let Some(current_generation) = sessions.get(session_id).map(|entry| entry.generation)
        else {
            return;
        };
        if expected_generation.is_some_and(|expected| expected != current_generation) {
            return;
        }

        let session = sessions
            .remove(session_id)
            .expect("gateway session disappeared while locked");
        session.value.shutdown.cancel();
        session.value
    };
    reap_gateway_session(session, SESSION_TASK_REAP_TIMEOUT).await;
}

async fn serve(listener: TcpListener, root_dir: PathBuf) -> Result<(), String> {
    let permits = Arc::new(Semaphore::new(MAX_GATEWAY_CONNECTIONS));
    loop {
        let permit = permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "媒体网关连接限制器已关闭".to_string())?;
        let (socket, _addr) =
            match tokio::time::timeout(ACCEPT_IDLE_TIMEOUT, listener.accept()).await {
                Ok(Ok(connection)) => connection,
                Ok(Err(error)) => return Err(format!("媒体网关 accept 失败: {error}")),
                Err(_) => {
                    drop(permit);
                    continue;
                }
            };
        let root = root_dir.clone();
        tauri::async_runtime::spawn(async move {
            let _permit = permit;
            if let Err(error) = handle_connection(socket, root).await {
                log::debug!("Media gateway request error: {}", error);
            }
        });
    }
}

async fn handle_connection(mut socket: TcpStream, root_dir: PathBuf) -> Result<(), String> {
    let request = read_http_request(&mut socket, SOCKET_IDLE_TIMEOUT).await?;
    if request.is_empty() {
        return Ok(());
    }

    let request = std::str::from_utf8(&request).map_err(|_| "非法 HTTP 请求编码".to_string())?;
    let mut lines = request.lines();
    let request_line = lines.next().ok_or("非法 HTTP 请求")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    let range_header = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("range")
            .then(|| value.trim().to_string())
    });
    if method != "GET" && method != "HEAD" {
        write_response(
            &mut socket,
            405,
            "text/plain; charset=utf-8",
            b"Method Not Allowed",
            method == "HEAD",
            &[],
            SOCKET_IDLE_TIMEOUT,
        )
        .await?;
        return Ok(());
    }

    let path = raw_path.split('?').next().unwrap_or("/");
    let target = match resolve_request_path(&root_dir, path) {
        Ok(target) => target,
        Err(_) => {
            write_response(
                &mut socket,
                404,
                "text/plain; charset=utf-8",
                b"Not Found",
                method == "HEAD",
                &[],
                SOCKET_IDLE_TIMEOUT,
            )
            .await?;
            return Ok(());
        }
    };
    let target = match canonical_media_target(&root_dir, &target).await? {
        Some(target) => target,
        None => {
            write_response(
                &mut socket,
                404,
                "text/plain; charset=utf-8",
                b"Not Found",
                method == "HEAD",
                &[],
                SOCKET_IDLE_TIMEOUT,
            )
            .await?;
            return Ok(());
        }
    };
    let mut file = match tokio::fs::File::open(&target).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            write_response(
                &mut socket,
                404,
                "text/plain; charset=utf-8",
                b"Not Found",
                method == "HEAD",
                &[],
                SOCKET_IDLE_TIMEOUT,
            )
            .await?;
            return Ok(());
        }
        Err(error) => return Err(format!("打开媒体文件失败: {error}")),
    };
    let metadata = file
        .metadata()
        .await
        .map_err(|error| format!("读取媒体文件信息失败: {error}"))?;
    if !metadata.is_file() {
        write_response(
            &mut socket,
            404,
            "text/plain; charset=utf-8",
            b"Not Found",
            method == "HEAD",
            &[],
            SOCKET_IDLE_TIMEOUT,
        )
        .await?;
        return Ok(());
    }

    let file_len = metadata.len();
    let requested_range = match range_header.as_deref() {
        Some(value) => match parse_byte_range(value, file_len) {
            Ok(range) => Some(range),
            Err(()) => {
                let content_range = format!("bytes */{file_len}");
                write_response(
                    &mut socket,
                    416,
                    "text/plain; charset=utf-8",
                    b"Range Not Satisfiable",
                    method == "HEAD",
                    &[("Content-Range", content_range.as_str())],
                    SOCKET_IDLE_TIMEOUT,
                )
                .await?;
                return Ok(());
            }
        },
        None => None,
    };

    let content_type = content_type_for_path(&target);
    let (status, start, content_len, content_range) = if let Some(range) = requested_range {
        let content_len = range.end - range.start + 1;
        (
            206,
            range.start,
            content_len,
            Some(format!("bytes {}-{}/{}", range.start, range.end, file_len)),
        )
    } else {
        (200, 0, file_len, None)
    };
    let mut extra_headers = vec![("Accept-Ranges", "bytes")];
    if let Some(content_range) = content_range.as_deref() {
        extra_headers.push(("Content-Range", content_range));
    }
    write_response_headers(
        &mut socket,
        status,
        content_type,
        content_len,
        &extra_headers,
        SOCKET_IDLE_TIMEOUT,
    )
    .await?;
    if method != "HEAD" && content_len > 0 {
        stream_file_range(
            &mut file,
            &mut socket,
            start,
            content_len,
            SOCKET_IDLE_TIMEOUT,
        )
        .await?;
    }
    flush_with_timeout(&mut socket, SOCKET_IDLE_TIMEOUT).await?;
    Ok(())
}

async fn read_http_request<R>(reader: &mut R, idle_timeout: Duration) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        let read = tokio::time::timeout(idle_timeout, reader.read(&mut chunk))
            .await
            .map_err(|_| "读取 HTTP 请求超时".to_string())?
            .map_err(|error| format!("读取请求失败: {error}"))?;
        if read == 0 {
            return Ok(request);
        }
        if request.len().saturating_add(read) > MAX_REQUEST_HEADER_BYTES {
            return Err("HTTP 请求头过大".to_string());
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(request);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

fn parse_byte_range(value: &str, file_len: u64) -> Result<ByteRange, ()> {
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') || file_len == 0 {
        return Err(());
    }
    let (start, end) = spec.split_once('-').ok_or(())?;
    match (start.trim(), end.trim()) {
        ("", "") => Err(()),
        ("", suffix) => {
            let suffix = suffix.parse::<u64>().map_err(|_| ())?;
            if suffix == 0 {
                return Err(());
            }
            let length = suffix.min(file_len);
            Ok(ByteRange {
                start: file_len - length,
                end: file_len - 1,
            })
        }
        (start, end) => {
            let start = start.parse::<u64>().map_err(|_| ())?;
            if start >= file_len {
                return Err(());
            }
            let end = if end.is_empty() {
                file_len - 1
            } else {
                end.parse::<u64>().map_err(|_| ())?.min(file_len - 1)
            };
            if end < start {
                return Err(());
            }
            Ok(ByteRange { start, end })
        }
    }
}

fn resolve_request_path(root_dir: &Path, request_path: &str) -> Result<PathBuf, String> {
    let mut path = root_dir.to_path_buf();
    let mut segments = request_path.trim_start_matches('/').split('/');

    match segments.next() {
        Some("videostream") => {}
        _ => return Err("非法媒体路径".to_string()),
    }

    for segment in segments {
        if segment.is_empty() || segment.contains('\\') || segment.contains(':') {
            return Err("非法媒体路径".to_string());
        }
        let mut components = Path::new(segment).components();
        let normal = match (components.next(), components.next()) {
            (Some(Component::Normal(normal)), None) => normal,
            _ => return Err("非法媒体路径".to_string()),
        };
        path.push(normal);
    }

    Ok(path)
}

async fn canonical_media_target(root_dir: &Path, target: &Path) -> Result<Option<PathBuf>, String> {
    let canonical_root = tokio::fs::canonicalize(root_dir)
        .await
        .map_err(|error| format!("解析媒体根目录失败: {error}"))?;
    let canonical_target = match tokio::fs::canonicalize(target).await {
        Ok(target) => target,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("解析媒体文件路径失败: {error}")),
    };
    if canonical_target.starts_with(&canonical_root) {
        Ok(Some(canonical_target))
    } else {
        Ok(None)
    }
}

async fn write_response(
    socket: &mut (impl AsyncWrite + Unpin),
    status: u16,
    content_type: &str,
    body: &[u8],
    head_only: bool,
    extra_headers: &[(&str, &str)],
    idle_timeout: Duration,
) -> Result<(), String> {
    write_response_headers(
        socket,
        status,
        content_type,
        body.len() as u64,
        extra_headers,
        idle_timeout,
    )
    .await?;
    if !head_only {
        write_all_with_timeout(socket, body, idle_timeout).await?;
    }
    flush_with_timeout(socket, idle_timeout).await
}

async fn write_response_headers(
    socket: &mut (impl AsyncWrite + Unpin),
    status: u16,
    content_type: &str,
    content_len: u64,
    extra_headers: &[(&str, &str)],
    idle_timeout: Duration,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        404 => "Not Found",
        405 => "Method Not Allowed",
        416 => "Range Not Satisfiable",
        _ => "Internal Server Error",
    };

    let mut headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {content_len}\r\nContent-Type: {content_type}\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
    );
    for (name, value) in extra_headers {
        headers.push_str(name);
        headers.push_str(": ");
        headers.push_str(value);
        headers.push_str("\r\n");
    }
    headers.push_str("\r\n");
    write_all_with_timeout(socket, headers.as_bytes(), idle_timeout)
        .await
        .map_err(|error| format!("写入响应头失败: {error}"))
}

async fn write_all_with_timeout<W>(
    writer: &mut W,
    bytes: &[u8],
    idle_timeout: Duration,
) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    tokio::time::timeout(idle_timeout, writer.write_all(bytes))
        .await
        .map_err(|_| "写入 HTTP 响应超时".to_string())?
        .map_err(|error| error.to_string())
}

async fn flush_with_timeout<W>(writer: &mut W, idle_timeout: Duration) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    tokio::time::timeout(idle_timeout, writer.flush())
        .await
        .map_err(|_| "刷新 HTTP 响应超时".to_string())?
        .map_err(|error| format!("刷新响应失败: {error}"))
}

async fn stream_file_range<W>(
    file: &mut tokio::fs::File,
    writer: &mut W,
    start: u64,
    length: u64,
    idle_timeout: Duration,
) -> Result<u64, String>
where
    W: AsyncWrite + Unpin,
{
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| format!("定位媒体文件失败: {error}"))?;
    let mut remaining = length;
    let mut written = 0u64;
    let mut buffer = vec![0u8; FILE_CHUNK_SIZE];
    while remaining > 0 {
        let requested = remaining.min(buffer.len() as u64) as usize;
        let read = tokio::time::timeout(idle_timeout, file.read(&mut buffer[..requested]))
            .await
            .map_err(|_| "读取媒体文件超时".to_string())?
            .map_err(|error| format!("读取媒体文件失败: {error}"))?;
        if read == 0 {
            return Err("媒体文件在传输期间被截断".to_string());
        }
        write_all_with_timeout(writer, &buffer[..read], idle_timeout).await?;
        remaining -= read as u64;
        written += read as u64;
    }
    Ok(written)
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

#[allow(clippy::too_many_arguments)]
async fn supervise_hls_session(
    gate_rx: oneshot::Receiver<()>,
    session_id: String,
    generation: u64,
    outer_generation: u64,
    protocol: String,
    url: String,
    config: Option<String>,
    app: AppHandle,
    shutdown: CancellationToken,
    output_dir: Arc<Mutex<Option<PathBuf>>>,
    prepared_tx: oneshot::Sender<Result<String, String>>,
    startup_tx: oneshot::Sender<Result<(), String>>,
) {
    let _ = gate_rx.await;

    let mut prepared_tx = Some(prepared_tx);
    let mut startup_tx = Some(startup_tx);
    let result = async {
        if shutdown.is_cancelled() {
            return Err("本地 HLS 网关启动已取消".to_string());
        }

        let ffmpeg_path = tokio::select! {
            _ = shutdown.cancelled() => return Err("本地 HLS 网关启动已取消".to_string()),
            result = ffmpeg_manager::ensure_ffmpeg(&app) => result?,
        };
        let server = tokio::select! {
            _ = shutdown.cancelled() => return Err("本地 HLS 网关启动已取消".to_string()),
            result = ensure_server(&app) => result?,
        };
        let public_dir = format!("session-{}", uuid::Uuid::new_v4().simple());
        let session_output_dir = server.root_dir.join(&public_dir);
        *output_dir.lock().await = Some(session_output_dir.clone());
        reset_output_dir(&session_output_dir)?;

        if shutdown.is_cancelled() {
            return Err("本地 HLS 网关启动已取消".to_string());
        }

        let player_config = parse_player_config(config.as_deref());
        let prepared_url = prepare_input_url(&protocol, &url, &player_config);
        let gateway_input =
            prepare_gateway_input(&protocol, &prepared_url, &session_output_dir)?;
        let rtsp_transport = resolve_rtsp_transport(&protocol, &prepared_url, &player_config);
        let playlist_path = session_output_dir.join("index.m3u8");
        let segment_pattern = session_output_dir.join("segment-%05d.ts");
        let playback_url = format!(
            "hls:http://127.0.0.1:{}/videostream/{}/index.m3u8",
            server.port, public_dir
        );

        if !emit_protocol_message_if_current(
            &app,
            &session_id,
            generation,
            outer_generation,
            &protocol,
            "info",
            format!("本地 HLS 网关启动: {}", gateway_input.display_source),
            format!(
                "输入源: {}\nFFmpeg 输入: {}\nRTSP 传输: {}\n输出目录: {}\n本地播放地址: http://127.0.0.1:{}/videostream/{}/index.m3u8",
                gateway_input.display_source,
                gateway_input.ffmpeg_input,
                rtsp_transport,
                session_output_dir.display(),
                server.port,
                public_dir,
            ),
        )
        .await
        {
            return Err("本地 HLS 网关启动已被更新的会话取代".to_string());
        }

        let pipeline_args = PipelineArgs {
            session_id: session_id.clone(),
            generation,
            outer_generation,
            protocol: protocol.clone(),
            ffmpeg_input: gateway_input.ffmpeg_input,
            rtsp_transport,
            protocol_whitelist: gateway_input.protocol_whitelist,
            ffmpeg_path,
            playlist_path,
            segment_pattern,
            playback_url,
            app: app.clone(),
        };
        run_hls_pipeline(
            pipeline_args,
            shutdown.clone(),
            prepared_tx.take().expect("prepared sender available"),
            startup_tx.take().expect("startup sender available"),
        )
        .await
    }
    .await;

    if let Err(error) = &result {
        if let Some(tx) = prepared_tx.take() {
            let _ = tx.send(Err(error.clone()));
        }
        if let Some(tx) = startup_tx.take() {
            let _ = tx.send(Err(error.clone()));
        }
        if !shutdown.is_cancelled()
            && emit_stream_error_if_current(&app, &session_id, generation, outer_generation, error)
                .await
        {
            log::warn!("HLS gateway [{}] stopped with error: {}", session_id, error);
        }
    } else if !shutdown.is_cancelled() {
        let event = StreamEvent {
            session_id: session_id.clone(),
            generation: Some(outer_generation),
            event_type: "disconnected".to_string(),
            data: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        let _ = emit_stream_event_if_current(&app, &session_id, generation, &event).await;
    }

    cleanup_output_dir(&output_dir).await;
    remove_generation_if_current(&session_id, generation).await;
}

async fn reap_gateway_session(session: GatewaySession, timeout: Duration) {
    let GatewaySession {
        shutdown: _,
        mut task,
        output_dir,
    } = session;
    if tokio::time::timeout(timeout, &mut task).await.is_err() {
        task.abort();
        let _ = task.await;
    }
    cleanup_output_dir(&output_dir).await;
}

async fn cleanup_output_dir(output_dir: &Arc<Mutex<Option<PathBuf>>>) {
    if attempt_output_cleanup(output_dir, OUTPUT_CLEANUP_TIMEOUT, |path| async move {
        tokio::fs::remove_dir_all(path).await
    })
    .await
    {
        return;
    }

    let retry_output_dir = output_dir.clone();
    tokio::spawn(async move {
        for delay in OUTPUT_CLEANUP_RETRY_DELAYS {
            tokio::time::sleep(delay).await;
            if attempt_output_cleanup(
                &retry_output_dir,
                OUTPUT_CLEANUP_TIMEOUT,
                |path| async move { tokio::fs::remove_dir_all(path).await },
            )
            .await
            {
                return;
            }
        }
        if let Some(path) = retry_output_dir.lock().await.as_ref() {
            log::warn!(
                "Media gateway directory remains after cleanup retries: {}",
                path.display()
            );
        }
    });
}

async fn attempt_output_cleanup<F, Fut>(
    output_dir: &Arc<Mutex<Option<PathBuf>>>,
    timeout: Duration,
    remove: F,
) -> bool
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: Future<Output = std::io::Result<()>>,
{
    let Some(path) = output_dir.lock().await.clone() else {
        return true;
    };
    let removed = match tokio::time::timeout(timeout, remove(path.clone())).await {
        Ok(Ok(())) => true,
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => true,
        Ok(Err(error)) => {
            log::debug!(
                "Failed to clean media gateway directory {}: {error}",
                path.display()
            );
            false
        }
        Err(_) => {
            log::debug!(
                "Timed out cleaning media gateway directory {}",
                path.display()
            );
            false
        }
    };
    if removed {
        let mut current = output_dir.lock().await;
        if current.as_ref() == Some(&path) {
            current.take();
        }
    }
    removed
}

async fn run_hls_pipeline(
    args: PipelineArgs,
    shutdown: CancellationToken,
    prepared_tx: oneshot::Sender<Result<String, String>>,
    startup_tx: oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(&args.ffmpeg_path);
    cmd.args(["-hide_banner", "-loglevel", "warning", "-nostats"]);

    let lower_url = args.ffmpeg_input.to_lowercase();
    let is_rtmp = args.protocol == "rtmp"
        || lower_url.starts_with("rtmp://")
        || lower_url.starts_with("rtmps://");

    if args.protocol == "rtsp" || lower_url.starts_with("rtsp://") {
        cmd.args(["-rtsp_transport", &args.rtsp_transport]);
        let flag = detect_rtsp_timeout_flag(&args.ffmpeg_path);
        cmd.args([flag, "5000000"]);
    } else if is_rtmp {
        cmd.args(["-rtmp_live", "live", "-rw_timeout", "15000000"]);
    } else if args.protocol == "srt" || lower_url.starts_with("srt://") {
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

    if let Some(whitelist) = args.protocol_whitelist.as_deref() {
        cmd.args(["-protocol_whitelist", whitelist]);
    }
    cmd.args(["-i", &args.ffmpeg_input]);
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
        &args.segment_pattern.to_string_lossy(),
        &args.playlist_path.to_string_lossy(),
    ]);

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("启动 FFmpeg HLS 网关失败: {error}");
            let _ = prepared_tx.send(Err(message.clone()));
            let _ = startup_tx.send(Err(message.clone()));
            return Err(message);
        }
    };
    let stderr = child.stderr.take();
    let mut stderr_task = tauri::async_runtime::spawn(async move {
        match stderr {
            Some(stderr) => drain_stderr(stderr).await,
            None => BoundedStderrTail::new(STDERR_MAX_LINES, STDERR_MAX_BYTES),
        }
    });

    if prepared_tx.send(Ok(args.playback_url.clone())).is_err() {
        let _ = terminate_child(&mut child).await;
        let _ = startup_tx.send(Err("本地 HLS 网关启动调用已取消".to_string()));
        let _ = stderr_task.await;
        return Err("本地 HLS 网关启动调用已取消".to_string());
    }

    let mut startup_tx = Some(startup_tx);
    let mut started = false;
    let mut status_error: Option<String> = None;
    let mut stopped = false;
    let mut poll = tokio::time::interval(Duration::from_millis(100));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            biased;
            _ = shutdown.cancelled() => {
                stopped = true;
                if let Err(error) = terminate_child(&mut child).await {
                    status_error = Some(error);
                }
                break;
            }
            status = child.wait() => {
                match status {
                    Ok(status) => {
                        if !status.success() {
                            status_error = Some(format!("FFmpeg HLS 进程退出异常: {status}"));
                        }
                    }
                    Err(error) => {
                        status_error = Some(format!("等待 FFmpeg HLS 进程状态失败: {error}"));
                        let _ = terminate_child(&mut child).await;
                    }
                }
                break;
            }
            _ = poll.tick() => {
                if !started
                    && tokio::fs::metadata(&args.playlist_path)
                        .await
                        .map(|metadata| metadata.len() > 0)
                        .unwrap_or(false)
                {
                    started = true;
                    if let Some(tx) = startup_tx.take()
                        && tx.send(Ok(())).is_err()
                    {
                        status_error = Some("本地 HLS 网关启动调用已取消".to_string());
                        let _ = terminate_child(&mut child).await;
                        break;
                    }
                }
            }
        }
    }

    let stderr_tail = match tokio::time::timeout(Duration::from_secs(2), &mut stderr_task).await {
        Ok(Ok(tail)) => tail,
        Ok(Err(error)) => {
            log::debug!("HLS gateway stderr task failed: {error}");
            BoundedStderrTail::new(STDERR_MAX_LINES, STDERR_MAX_BYTES)
        }
        Err(_) => {
            stderr_task.abort();
            let _ = stderr_task.await;
            BoundedStderrTail::new(STDERR_MAX_LINES, STDERR_MAX_BYTES)
        }
    };
    if !stderr_tail.is_empty() {
        let (line_count, detail) = stderr_tail.render();
        let _ = emit_protocol_message_if_current(
            &args.app,
            &args.session_id,
            args.generation,
            args.outer_generation,
            &args.protocol,
            "info",
            format!("FFmpeg HLS stderr ({line_count} lines)"),
            detail,
        )
        .await;
    }

    if !started {
        let message = if stopped {
            "本地 HLS 网关启动已取消".to_string()
        } else {
            status_error.unwrap_or_else(|| "本地 HLS 网关未生成播放列表".to_string())
        };
        if let Some(tx) = startup_tx.take() {
            let _ = tx.send(Err(message.clone()));
        }
        return if stopped { Ok(()) } else { Err(message) };
    }

    if let Some(error) = status_error {
        return Err(error);
    }

    Ok(())
}

async fn terminate_child(child: &mut tokio::process::Child) -> Result<(), String> {
    match child.try_wait() {
        Ok(Some(_)) => return Ok(()),
        Ok(None) => {}
        Err(error) => return Err(format!("检查 FFmpeg HLS 进程状态失败: {error}")),
    }
    if let Err(error) = child.start_kill()
        && error.kind() != std::io::ErrorKind::InvalidInput
    {
        return Err(format!("终止 FFmpeg HLS 进程失败: {error}"));
    }
    tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| "等待 FFmpeg HLS 进程退出超时".to_string())?
        .map(|_| ())
        .map_err(|error| format!("回收 FFmpeg HLS 进程失败: {error}"))
}

#[derive(Debug)]
struct BoundedStderrTail {
    lines: VecDeque<Vec<u8>>,
    current: VecDeque<u8>,
    completed_bytes: usize,
    max_lines: usize,
    max_bytes: usize,
}

impl BoundedStderrTail {
    fn new(max_lines: usize, max_bytes: usize) -> Self {
        Self {
            lines: VecDeque::new(),
            current: VecDeque::new(),
            completed_bytes: 0,
            max_lines,
            max_bytes,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if byte == b'\n' {
                self.finish_line();
            } else {
                self.current.push_back(byte);
                self.trim_to_limits();
            }
        }
    }

    fn finish(&mut self) {
        self.finish_line();
    }

    fn finish_line(&mut self) {
        if self.current.back() == Some(&b'\r') {
            self.current.pop_back();
        }
        if self.current.is_empty() {
            return;
        }
        let line: Vec<u8> = self.current.drain(..).collect();
        self.completed_bytes += line.len();
        self.lines.push_back(line);
        self.trim_to_limits();
    }

    fn trim_to_limits(&mut self) {
        while self.lines.len() > self.max_lines || self.retained_bytes() > self.max_bytes {
            if let Some(line) = self.lines.pop_front() {
                self.completed_bytes = self.completed_bytes.saturating_sub(line.len());
            } else if self.current.pop_front().is_none() {
                break;
            }
        }
    }

    fn retained_bytes(&self) -> usize {
        let completed_separators = self.lines.len().saturating_sub(1);
        let current_separator = usize::from(!self.lines.is_empty() && !self.current.is_empty());
        self.completed_bytes
            .saturating_add(self.current.len())
            .saturating_add(completed_separators)
            .saturating_add(current_separator)
    }

    fn is_empty(&self) -> bool {
        self.lines.is_empty() && self.current.is_empty()
    }

    fn render(mut self) -> (usize, String) {
        self.finish();
        let line_count = self.lines.len();
        let mut rendered = String::new();
        for (index, line) in self.lines.into_iter().enumerate() {
            if index > 0 {
                rendered.push('\n');
            }
            rendered.push_str(&String::from_utf8_lossy(&line));
        }
        (line_count, rendered)
    }
}

async fn drain_stderr(mut stderr: tokio::process::ChildStderr) -> BoundedStderrTail {
    let mut tail = BoundedStderrTail::new(STDERR_MAX_LINES, STDERR_MAX_BYTES);
    let mut buffer = [0u8; 8192];
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => tail.push(&buffer[..read]),
            Err(error) => {
                log::debug!("Failed to drain HLS gateway stderr: {error}");
                break;
            }
        }
    }
    tail.finish();
    tail
}

fn emit_protocol_message(
    app: &AppHandle,
    session_id: &str,
    outer_generation: u64,
    protocol: &str,
    direction: &str,
    summary: String,
    detail: String,
) {
    let message = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        direction: direction.to_string(),
        protocol: protocol.to_string(),
        summary,
        detail,
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit(
        "videostream-protocol-msg",
        &GenerationTagged::new(&message, outer_generation),
    );
}

#[allow(clippy::too_many_arguments)]
async fn emit_protocol_message_if_current(
    app: &AppHandle,
    session_id: &str,
    generation: u64,
    outer_generation: u64,
    protocol: &str,
    direction: &str,
    summary: String,
    detail: String,
) -> bool {
    let sessions = GATEWAY_SESSIONS.lock().await;
    if sessions
        .get(session_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        emit_protocol_message(
            app,
            session_id,
            outer_generation,
            protocol,
            direction,
            summary,
            detail,
        );
        true
    } else {
        false
    }
}

fn emit_stream_error(app: &AppHandle, session_id: &str, outer_generation: u64, error: &str) {
    let event = StreamEvent {
        session_id: session_id.to_string(),
        generation: Some(outer_generation),
        event_type: "error".to_string(),
        data: Some(error.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);
}

async fn emit_stream_error_if_current(
    app: &AppHandle,
    session_id: &str,
    generation: u64,
    outer_generation: u64,
    error: &str,
) -> bool {
    let sessions = GATEWAY_SESSIONS.lock().await;
    if sessions
        .get(session_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        emit_stream_error(app, session_id, outer_generation, error);
        true
    } else {
        false
    }
}

async fn emit_stream_event_if_current(
    app: &AppHandle,
    session_id: &str,
    generation: u64,
    event: &StreamEvent,
) -> bool {
    let sessions = GATEWAY_SESSIONS.lock().await;
    if sessions
        .get(session_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        let _ = app.emit("videostream-event", event);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use tokio::io::AsyncWriteExt;
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    use super::{
        BoundedStderrTail, ByteRange, FILE_CHUNK_SIZE, GatewaySession, GenerationEntry,
        attempt_output_cleanup, canonical_media_target, parse_byte_range, prepare_gateway_input,
        prepare_input_url, read_http_request, reap_gateway_session, resolve_request_path,
        resolve_rtsp_transport, stream_file_range, take_generation_if_current, terminate_child,
    };

    #[test]
    fn byte_ranges_cover_bounded_open_and_suffix_forms() {
        assert_eq!(
            parse_byte_range("bytes=10-19", 100),
            Ok(ByteRange { start: 10, end: 19 })
        );
        assert_eq!(
            parse_byte_range("bytes=90-", 100),
            Ok(ByteRange { start: 90, end: 99 })
        );
        assert_eq!(
            parse_byte_range("bytes=-10", 100),
            Ok(ByteRange { start: 90, end: 99 })
        );
        assert_eq!(
            parse_byte_range("bytes=95-200", 100),
            Ok(ByteRange { start: 95, end: 99 })
        );
        assert!(parse_byte_range("bytes=100-", 100).is_err());
        assert!(parse_byte_range("bytes=0-1,4-5", 100).is_err());
        assert!(parse_byte_range("items=0-1", 100).is_err());
        assert!(parse_byte_range("bytes=0-", 0).is_err());
    }

    #[test]
    fn stderr_tail_is_bounded_by_lines_and_rendered_bytes() {
        let mut tail = BoundedStderrTail::new(3, 10);
        tail.push(b"1111\n2222\n3333\n4444\n");
        let (lines, rendered) = tail.render();

        assert!(lines <= 3);
        assert!(rendered.len() <= 10);
        assert!(rendered.ends_with("4444"));

        let mut long_line = BoundedStderrTail::new(10, 8);
        long_line.push(b"0123456789");
        let (_, rendered) = long_line.render();
        assert_eq!(rendered, "23456789");
    }

    #[test]
    fn old_generation_cannot_remove_replacement() {
        let mut entries = HashMap::new();
        entries.insert(
            "session".to_string(),
            GenerationEntry {
                generation: 2,
                value: "new",
            },
        );

        assert!(take_generation_if_current(&mut entries, "session", 1).is_none());
        assert_eq!(entries.get("session").map(|entry| entry.value), Some("new"));
        assert_eq!(
            take_generation_if_current(&mut entries, "session", 2).map(|entry| entry.value),
            Some("new")
        );
        assert!(!entries.contains_key("session"));
    }

    #[test]
    fn request_path_rejects_non_normal_and_windows_prefix_segments() {
        let root = PathBuf::from("/tmp/media-root");
        assert!(resolve_request_path(&root, "/videostream/session/index.m3u8").is_ok());
        assert!(resolve_request_path(&root, "/videostream/session/../secret").is_err());
        assert!(resolve_request_path(&root, "/videostream//secret").is_err());
        assert!(resolve_request_path(&root, "/videostream/C:/secret").is_err());
        assert!(resolve_request_path(&root, "/videostream/session\\secret").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn canonical_target_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "protoforge-media-gateway-symlink-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("root");
        let outside = base.join("outside.ts");
        tokio::fs::create_dir_all(&root).await.expect("create root");
        tokio::fs::write(&outside, b"outside")
            .await
            .expect("write outside file");
        let link = root.join("segment.ts");
        symlink(&outside, &link).expect("create symlink");

        assert!(
            canonical_media_target(&root, &link)
                .await
                .unwrap()
                .is_none()
        );
        let _ = tokio::fs::remove_dir_all(base).await;
    }

    #[tokio::test]
    async fn cleanup_timeout_retains_path_until_retry_succeeds() {
        let path = PathBuf::from("/tmp/protoforge-cleanup-retained");
        let output_dir = Arc::new(Mutex::new(Some(path.clone())));
        let removed = attempt_output_cleanup(&output_dir, Duration::from_millis(10), |_| {
            std::future::pending::<std::io::Result<()>>()
        })
        .await;
        assert!(!removed);
        assert_eq!(output_dir.lock().await.as_ref(), Some(&path));

        let removed =
            attempt_output_cleanup(&output_dir, Duration::from_secs(1), |_| async { Ok(()) }).await;
        assert!(removed);
        assert!(output_dir.lock().await.is_none());
    }

    #[tokio::test]
    async fn incomplete_request_hits_read_idle_timeout() {
        let (mut client, mut server) = tokio::io::duplex(64);
        client
            .write_all(b"GET /videostream/test/index.m3u8 HTTP/1.1\r\n")
            .await
            .expect("partial request");

        let error = read_http_request(&mut server, Duration::from_millis(20))
            .await
            .expect_err("request must time out without header terminator");
        assert!(error.contains("超时"));
    }

    #[tokio::test]
    async fn large_file_stream_is_chunked_and_slow_writer_times_out() {
        let path = std::env::temp_dir().join(format!(
            "protoforge-media-gateway-stream-{}",
            uuid::Uuid::new_v4()
        ));
        let data = vec![0x5a; FILE_CHUNK_SIZE * 3 + 17];
        tokio::fs::write(&path, &data)
            .await
            .expect("large test file");

        let mut file = tokio::fs::File::open(&path).await.expect("open test file");
        let mut sink = tokio::io::sink();
        let length = data.len() as u64 - 200;
        let copied = stream_file_range(&mut file, &mut sink, 100, length, Duration::from_secs(1))
            .await
            .expect("stream range");
        assert_eq!(copied, length);

        let mut file = tokio::fs::File::open(&path)
            .await
            .expect("reopen test file");
        let (mut blocked_writer, _unread_peer) = tokio::io::duplex(1);
        let error = stream_file_range(
            &mut file,
            &mut blocked_writer,
            0,
            64,
            Duration::from_millis(20),
        )
        .await
        .expect_err("blocked writer must time out");
        assert!(error.contains("超时"));

        let _ = tokio::fs::remove_file(path).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminating_child_waits_for_reap() {
        let mut command = tokio::process::Command::new("sh");
        command.args(["-c", "sleep 30"]);
        command.kill_on_drop(true);
        let mut child = command.spawn().expect("spawn sleeping child");

        terminate_child(&mut child).await.expect("terminate child");
        assert!(child.try_wait().expect("query child").is_some());
    }

    #[tokio::test]
    async fn hung_session_task_is_aborted_reaped_and_cleaned() {
        struct DropMarker(Arc<AtomicBool>);
        impl Drop for DropMarker {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let output_dir = std::env::temp_dir().join(format!(
            "protoforge-media-gateway-hung-{}",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&output_dir)
            .await
            .expect("create hung session output");
        tokio::fs::write(output_dir.join("segment.ts"), b"data")
            .await
            .expect("write hung session output");

        let dropped = Arc::new(AtomicBool::new(false));
        let task_dropped = dropped.clone();
        let task = tokio::spawn(async move {
            let _marker = DropMarker(task_dropped);
            std::future::pending::<()>().await;
        });
        tokio::task::yield_now().await;

        let session = GatewaySession {
            shutdown: CancellationToken::new(),
            task,
            output_dir: Arc::new(Mutex::new(Some(output_dir.clone()))),
        };
        reap_gateway_session(session, Duration::from_millis(20)).await;

        assert!(dropped.load(Ordering::SeqCst));
        assert!(!output_dir.exists());
    }

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
