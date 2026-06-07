// 网络抓包代理模块
// 基于 hudsucker 实现 MITM HTTP/HTTPS 代理
// 通过 Tauri Event 将捕获的请求/响应实时推送到前端

use base64::Engine as _;
use bytes::Bytes;
use http::header::{CONTENT_LENGTH, HeaderName, HeaderValue};
use http::uri::Uri;
use http_body_util::{BodyExt, Empty, Full};
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tokio::sync::{Mutex, oneshot};

// ═══════════════════════════════════════════
//  数据结构
// ═══════════════════════════════════════════

/// 单个捕获条目（后端 → 前端推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedEntry {
    pub session_id: String,
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub request_headers: Vec<(String, String)>,
    pub response_headers: Vec<(String, String)>,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
    /// base64 编码的原始 request body 字节（用于 Hex 视图）
    pub request_body_raw: Option<String>,
    /// base64 编码的原始 response body 字节（用于 Hex 视图）
    pub response_body_raw: Option<String>,
    pub content_type: Option<String>,
    /// 请求的 Content-Type
    pub request_content_type: Option<String>,
    pub request_size: usize,
    pub response_size: usize,
    pub duration_ms: u64,
    pub timestamp: String,
    pub completed: bool,
    /// HTTP 版本 (如 "HTTP/1.1")
    pub http_version: Option<String>,
}

/// 代理状态信息（返回给前端查询）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatusInfo {
    pub session_id: String,
    pub running: bool,
    pub port: u16,
    pub entry_count: usize,
}

/// 断点匹配规则（前端 ↔ 后端）
/// method/host/path 任一为空表示通配；命中需同时满足所有非空字段。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointRule {
    pub id: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    pub enabled: bool,
}

/// 命中断点后被挂起的请求（后端 → 前端推送 / 查询）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedRequest {
    pub session_id: String,
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub request_headers: Vec<(String, String)>,
    pub request_body: Option<String>,
    pub timestamp: String,
}

/// 放行时携带的修改（全部可选，缺省即按原样转发）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeModification {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<Vec<(String, String)>>,
    #[serde(default)]
    pub body: Option<String>,
}

/// 判断请求是否命中某条断点规则
fn breakpoint_matches(rule: &BreakpointRule, method: &str, host: &str, path: &str) -> bool {
    if !rule.enabled {
        return false;
    }
    if let Some(m) = rule.method.as_deref() {
        let m = m.trim();
        if !m.is_empty() && !m.eq_ignore_ascii_case(method) {
            return false;
        }
    }
    if let Some(h) = rule.host.as_deref() {
        let h = h.trim();
        if !h.is_empty() && !host.to_ascii_lowercase().contains(&h.to_ascii_lowercase()) {
            return false;
        }
    }
    if let Some(p) = rule.path.as_deref() {
        let p = p.trim();
        if !p.is_empty() && !path.contains(p) {
            return false;
        }
    }
    // 规则全为空（且 enabled）视为匹配所有请求
    true
}

/// HeaderMap → Vec<(name, value)>（用于展示 / 推送）
fn headers_to_vec(headers: &http::HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect()
}

/// Vec<(name, value)> → HeaderMap（跳过 HTTP/2 伪首部及非法首部）
fn vec_to_headers(pairs: &[(String, String)]) -> http::HeaderMap {
    let mut map = http::HeaderMap::new();
    for (k, v) in pairs {
        if k.starts_with(':') {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            map.append(name, val);
        }
    }
    map
}

// ═══════════════════════════════════════════
//  代理状态管理
// ═══════════════════════════════════════════

#[derive(Clone)]
pub struct ProxySessionState {
    pub running: Arc<AtomicBool>,
    pub abort_handle: Arc<Mutex<Option<tokio::task::AbortHandle>>>,
    pub port: Arc<Mutex<u16>>,
    /// 使用 VecDeque 以便 O(1) 移除最旧条目（而非 Vec::remove(0) 的 O(n)）
    pub entries: Arc<Mutex<VecDeque<CapturedEntry>>>,
    /// 当前生效的断点规则
    pub breakpoints: Arc<Mutex<Vec<BreakpointRule>>>,
    /// 命中断点后被挂起、等待放行的请求（按 paused_id 索引）。
    /// 请求信息与放行通道存在同一项里，保证插入/移除原子，避免双锁竞态。
    pub paused: Arc<Mutex<HashMap<String, PausedSlot>>>,
}

/// 一个被挂起请求的完整状态：展示信息 + 放行通道
pub struct PausedSlot {
    pub info: PausedRequest,
    pub tx: oneshot::Sender<Option<ResumeModification>>,
}

impl ProxySessionState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            abort_handle: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(9090)),
            entries: Arc::new(Mutex::new(VecDeque::new())),
            breakpoints: Arc::new(Mutex::new(Vec::new())),
            paused: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub struct ProxyState {
    pub sessions: Arc<Mutex<HashMap<String, ProxySessionState>>>,
    pub ca_cert_path: Arc<Mutex<Option<PathBuf>>>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            ca_cert_path: Arc::new(Mutex::new(None)),
        }
    }
}

async fn get_or_create_session(state: &ProxyState, session_id: &str) -> ProxySessionState {
    let mut sessions = state.sessions.lock().await;
    sessions
        .entry(session_id.to_string())
        .or_insert_with(ProxySessionState::new)
        .clone()
}

async fn get_session(state: &ProxyState, session_id: &str) -> Option<ProxySessionState> {
    state.sessions.lock().await.get(session_id).cloned()
}

// ═══════════════════════════════════════════
//  HTTP Handler — 捕获请求/响应
// ═══════════════════════════════════════════

/// 每次请求的临时元数据
struct RequestMeta {
    id: String,
    method: String,
    url: String,
    host: String,
    path: String,
    request_headers: Vec<(String, String)>,
    request_body_text: Option<String>,
    request_body_raw: Option<String>,
    request_content_type: Option<String>,
    request_body_size: usize,
    start_time: std::time::Instant,
    http_version: String,
}

/// hudsucker 为每个请求/响应对克隆 handler 实例
/// 因此使用实例级 current_request 字段存储请求元数据
#[derive(Clone)]
struct CaptureHandler {
    app: tauri::AppHandle,
    session_id: String,
    entries: Arc<Mutex<VecDeque<CapturedEntry>>>,
    current_request: Arc<Mutex<Option<RequestMeta>>>,
    breakpoints: Arc<Mutex<Vec<BreakpointRule>>>,
    paused: Arc<Mutex<HashMap<String, PausedSlot>>>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 从 http::Request 中提取完整 URL
fn extract_url(req: &Request<Body>) -> String {
    let uri = req.uri();
    // CONNECT 请求的 URI 是 authority 形式 (host:port)
    if req.method() == http::Method::CONNECT {
        return format!("https://{}", uri);
    }
    // 如果 URI 没有 scheme，尝试从 Host header 构建
    if uri.scheme().is_none() {
        if let Some(host) = req.headers().get("host") {
            if let Ok(host_str) = host.to_str() {
                return format!(
                    "http://{}{}",
                    host_str,
                    uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/")
                );
            }
        }
    }
    uri.to_string()
}

fn extract_host(url: &str) -> String {
    url.parse::<Uri>()
        .ok()
        .and_then(|u| u.host().map(|h| h.to_string()))
        .unwrap_or_default()
}

fn extract_path(url: &str) -> String {
    url.parse::<Uri>()
        .ok()
        .map(|u| u.path().to_string())
        .unwrap_or_else(|| "/".to_string())
}

impl HttpHandler for CaptureHandler {
    // NOTE: hudsucker 为每个连接克隆一个 handler 实例（通过 Clone trait）
    // handle_request 和 handle_response 在同一个实例上成对调用
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        let mut method = req.method().to_string();
        let mut url = extract_url(&req);

        log::info!(
            "[CAPTURE] 收到请求: {} {} (session={})",
            method,
            url,
            self.session_id
        );

        // 跳过 CONNECT 请求本身（HTTPS 隧道建立阶段）
        if method == "CONNECT" {
            log::info!("[CAPTURE] CONNECT 隧道请求，跳过捕获: {}", url);
            return req.into();
        }

        let mut host = extract_host(&url);
        let mut path = extract_path(&url);
        let http_version = format!("{:?}", req.version());
        let entry_id = uuid::Uuid::new_v4().to_string();

        // 拆分请求，读取 body（限制最大 2MB 避免内存爆炸）
        let (mut parts, body) = req.into_parts();
        let mut body_bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => Bytes::new(),
        };

        // ── 断点拦截：命中规则时挂起请求，等待前端放行/修改 ──
        let matched = {
            let rules = self.breakpoints.lock().await;
            rules
                .iter()
                .any(|r| breakpoint_matches(r, &method, &host, &path))
        };

        if matched {
            let paused_id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel::<Option<ResumeModification>>();

            let paused = PausedRequest {
                session_id: self.session_id.clone(),
                id: paused_id.clone(),
                method: method.clone(),
                url: url.clone(),
                host: host.clone(),
                path: path.clone(),
                request_headers: headers_to_vec(&parts.headers),
                request_body: String::from_utf8(body_bytes.to_vec()).ok(),
                timestamp: now_iso(),
            };

            self.paused.lock().await.insert(
                paused_id.clone(),
                PausedSlot {
                    info: paused.clone(),
                    tx,
                },
            );

            log::info!(
                "[CAPTURE] 请求命中断点，已挂起: id={}, {} {}",
                paused_id,
                method,
                url
            );
            if let Err(e) = self.app.emit("capture-breakpoint", &paused) {
                log::error!("[CAPTURE] emit breakpoint 失败: {:?}", e);
            }

            // 阻塞当前请求直到收到放行信号（其它连接在各自任务中并行处理，不受影响）。
            // 5 分钟超时兜底：避免被遗忘的挂起请求长期占用浏览器连接。
            // Ok(Ok(m)) 收到放行(可能带修改)；Ok(Err) 通道被关闭；Err 超时 —— 后两者按原样放行。
            let modification =
                match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
                    Ok(Ok(m)) => m,
                    Ok(Err(_)) => None,
                    Err(_) => {
                        log::warn!("[CAPTURE] 断点挂起超时，自动放行: id={}", paused_id);
                        None
                    }
                };

            // 清理挂起状态（resume/stop 可能已移除，remove 幂等）
            self.paused.lock().await.remove(&paused_id);

            if let Some(m) = modification {
                if let Some(new_method) = m.method {
                    if let Ok(parsed) = http::Method::from_bytes(new_method.as_bytes()) {
                        parts.method = parsed;
                    }
                    method = new_method;
                }
                if let Some(new_url) = m.url {
                    if let Ok(uri) = new_url.parse::<Uri>() {
                        parts.uri = uri;
                    }
                    host = extract_host(&new_url);
                    path = extract_path(&new_url);
                    url = new_url;
                }
                if let Some(new_headers) = m.headers {
                    parts.headers = vec_to_headers(&new_headers);
                }
                if let Some(new_body) = m.body {
                    body_bytes = Bytes::from(new_body.into_bytes());
                }
                // body / headers 可能已变，重算 content-length 保证转发正确
                parts.headers.remove(CONTENT_LENGTH);
                if !body_bytes.is_empty() {
                    if let Ok(val) = HeaderValue::from_str(&body_bytes.len().to_string()) {
                        parts.headers.insert(CONTENT_LENGTH, val);
                    }
                }
                log::info!(
                    "[CAPTURE] 断点放行(已修改): id={}, {} {}",
                    paused_id,
                    method,
                    url
                );
            } else {
                log::info!("[CAPTURE] 断点放行: id={}, {} {}", paused_id, method, url);
            }
        }

        // 提取最终请求头 / content-type（与实际转发内容保持一致）
        let request_headers = headers_to_vec(&parts.headers);
        let request_content_type = parts
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let req_body_size = body_bytes.len();
        let (req_body_text, req_body_raw) = if req_body_size > 0 && req_body_size <= 2 * 1024 * 1024
        {
            (
                String::from_utf8(body_bytes.to_vec()).ok(),
                Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)),
            )
        } else {
            (None, None)
        };

        let new_req = Request::from_parts(parts, Body::from(Full::new(body_bytes)));

        // 先推送"请求进行中"状态给前端
        let pending_entry = CapturedEntry {
            session_id: self.session_id.clone(),
            id: entry_id.clone(),
            method: method.clone(),
            url: url.clone(),
            host: host.clone(),
            path: path.clone(),
            status: None,
            status_text: None,
            request_headers: request_headers.clone(),
            response_headers: vec![],
            request_body: None,
            response_body: None,
            request_body_raw: None,
            response_body_raw: None,
            content_type: None,
            request_content_type: request_content_type.clone(),
            request_size: req_body_size,
            response_size: 0,
            duration_ms: 0,
            timestamp: now_iso(),
            completed: false,
            http_version: Some(http_version.clone()),
        };

        log::info!(
            "[CAPTURE] 推送 pending entry: id={}, session={}, url={}",
            entry_id,
            self.session_id,
            url
        );
        let emit_result = self.app.emit("capture-event", &pending_entry);
        if let Err(e) = &emit_result {
            log::error!("[CAPTURE] emit 失败: {:?}", e);
        }

        // 存入当前实例的 request 元数据
        let meta = RequestMeta {
            id: entry_id,
            method,
            url,
            host,
            path,
            request_headers,
            request_body_text: req_body_text,
            request_body_raw: req_body_raw,
            request_content_type,
            request_body_size: req_body_size,
            start_time: std::time::Instant::now(),
            http_version,
        };
        *self.current_request.lock().await = Some(meta);

        new_req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let status = res.status().as_u16();
        let status_text = res.status().canonical_reason().unwrap_or("").to_string();

        let response_headers: Vec<(String, String)> = res
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
            .collect();

        let content_type = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // 读取响应 body（限制最大 2MB）
        let (res_body_text, res_body_raw, response_size, new_res) = {
            let (parts, body) = res.into_parts();
            match body.collect().await {
                Ok(collected) => {
                    let bytes = collected.to_bytes();
                    let size = bytes.len();
                    let raw_b64 = if size > 0 && size <= 2 * 1024 * 1024 {
                        Some(base64::engine::general_purpose::STANDARD.encode(&bytes))
                    } else {
                        None
                    };
                    let text = if size > 0 && size <= 2 * 1024 * 1024 {
                        String::from_utf8(bytes.to_vec()).ok()
                    } else {
                        None
                    };
                    let new_body = Body::from(Full::new(bytes));
                    (text, raw_b64, size, Response::from_parts(parts, new_body))
                }
                Err(_) => {
                    let new_body = Body::from(Empty::new());
                    (None, None, 0, Response::from_parts(parts, new_body))
                }
            }
        };

        // 取出当前实例的请求元数据
        let meta_opt = self.current_request.lock().await.take();

        if let Some(meta) = meta_opt {
            let duration_ms = meta.start_time.elapsed().as_millis() as u64;

            let entry = CapturedEntry {
                session_id: self.session_id.clone(),
                id: meta.id,
                method: meta.method,
                url: meta.url,
                host: meta.host,
                path: meta.path,
                status: Some(status),
                status_text: Some(status_text),
                request_headers: meta.request_headers,
                response_headers,
                request_body: meta.request_body_text,
                response_body: res_body_text,
                request_body_raw: meta.request_body_raw,
                response_body_raw: res_body_raw,
                content_type,
                request_content_type: meta.request_content_type,
                request_size: meta.request_body_size,
                response_size,
                duration_ms,
                timestamp: now_iso(),
                completed: true,
                http_version: Some(meta.http_version),
            };

            log::info!(
                "[CAPTURE] 推送 completed entry: id={}, session={}, status={}, url={}",
                entry.id,
                self.session_id,
                status,
                entry.url
            );
            // 推送完整条目到前端
            let emit_result = self.app.emit("capture-event", &entry);
            if let Err(e) = &emit_result {
                log::error!("[CAPTURE] emit 失败: {:?}", e);
            }

            // 存入历史列表（限制最大 5000 条）
            let mut entries = self.entries.lock().await;
            if entries.len() >= 5000 {
                entries.pop_front(); // VecDeque O(1) 操作
            }
            entries.push_back(entry);
        }

        new_res
    }
}

/// 通过代理发送测试请求，验证代理是否正常工作
pub async fn test_proxy_connection(port: u16) -> Result<String, String> {
    // 构建一个通过代理发送的 HTTP 请求
    let proxy_url = format!("http://127.0.0.1:{}", port);
    log::info!("[CAPTURE] 测试代理连接: proxy={}", proxy_url);

    let proxy = reqwest::Proxy::http(&proxy_url).map_err(|e| format!("创建代理配置失败: {}", e))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    match client.get("http://httpbin.org/get").send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            log::info!("[CAPTURE] 代理测试成功: status={}", status);
            Ok(format!("代理连通性测试成功: HTTP {}", status))
        }
        Err(e) => {
            log::error!("[CAPTURE] 代理测试失败: {}", e);
            Err(format!("代理测试失败: {}", e))
        }
    }
}

// ═══════════════════════════════════════════
//  CA 证书管理
// ═══════════════════════════════════════════

/// 获取或生成 CA 证书，返回 (cert_pem, key_pem, cert_path)
fn get_or_create_ca(app_data_dir: &PathBuf) -> Result<(String, String, PathBuf), String> {
    let ca_dir = app_data_dir.join("proxy-ca");
    let cert_path = ca_dir.join("protoforge-ca.crt");
    let key_path = ca_dir.join("protoforge-ca.key");

    // 如果已有证书，直接加载
    if cert_path.exists() && key_path.exists() {
        // 确保已有私钥文件权限正确（可能是旧版本创建的）
        lock_down_private_key(&key_path);

        let cert_pem =
            std::fs::read_to_string(&cert_path).map_err(|e| format!("读取 CA 证书失败: {}", e))?;
        let key_pem =
            std::fs::read_to_string(&key_path).map_err(|e| format!("读取 CA 私钥失败: {}", e))?;
        return Ok((cert_pem, key_pem, cert_path));
    }

    // 生成新的 CA 证书
    std::fs::create_dir_all(&ca_dir).map_err(|e| format!("创建 CA 目录失败: {}", e))?;

    let mut params = CertificateParams::new(Vec::<String>::new())
        .map_err(|e| format!("创建证书参数失败: {}", e))?;
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.distinguished_name.push(
        rcgen::DnType::CommonName,
        rcgen::DnValue::Utf8String("ProtoForge CA".to_string()),
    );
    params.distinguished_name.push(
        rcgen::DnType::OrganizationName,
        rcgen::DnValue::Utf8String("ProtoForge".to_string()),
    );

    let key_pair = KeyPair::generate().map_err(|e| format!("生成密钥对失败: {}", e))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("自签名证书失败: {}", e))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    std::fs::write(&cert_path, &cert_pem).map_err(|e| format!("写入 CA 证书失败: {}", e))?;
    std::fs::write(&key_path, &key_pem).map_err(|e| format!("写入 CA 私钥失败: {}", e))?;

    // 写入后立即限制私钥文件访问权限
    lock_down_private_key(&key_path);

    log::info!("已生成新的 CA 证书: {:?}", cert_path);

    Ok((cert_pem, key_pem, cert_path))
}

/// 限制私钥文件权限，仅允许当前用户访问。
/// - Windows: 通过 icacls 移除继承权限并仅授权当前用户完全控制
/// - Unix: chmod 0600
fn lock_down_private_key(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        // icacls <path> /inheritance:r   — 移除所有继承的 ACE
        // icacls <path> /grant:r "%USERNAME%:(F)" — 仅当前用户完全控制
        let path_str = path.to_string_lossy();
        let username = std::env::var("USERNAME").unwrap_or_default();
        if username.is_empty() {
            log::warn!("[CAPTURE] 无法获取 USERNAME，跳过私钥 ACL 设置");
            return;
        }

        let remove_inherit = std::process::Command::new("icacls")
            .args([path_str.as_ref(), "/inheritance:r"])
            .output();
        if let Err(e) = remove_inherit {
            log::warn!("[CAPTURE] icacls 移除继承权限失败: {}", e);
            return;
        }

        let grant_user = std::process::Command::new("icacls")
            .args([path_str.as_ref(), "/grant:r", &format!("{}:(F)", username)])
            .output();
        match grant_user {
            Ok(output) if output.status.success() => {
                log::info!("[CAPTURE] 已限制私钥文件权限: 仅用户 {} 可访问", username);
            }
            Ok(output) => {
                log::warn!(
                    "[CAPTURE] icacls 授权失败: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            Err(e) => {
                log::warn!("[CAPTURE] icacls 执行失败: {}", e);
            }
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
            log::warn!("[CAPTURE] 设置私钥文件权限失败: {}", e);
        } else {
            log::info!("[CAPTURE] 已限制私钥文件权限: 0600");
        }
    }
}

// ═══════════════════════════════════════════
//  代理生命周期
// ═══════════════════════════════════════════

/// 启动 MITM 代理
pub async fn start_proxy(
    app: tauri::AppHandle,
    state: &ProxyState,
    session_id: &str,
    port: u16,
    app_data_dir: PathBuf,
) -> Result<(), String> {
    let session = get_or_create_session(state, session_id).await;

    // 防止重复启动
    if session.running.load(Ordering::SeqCst) {
        return Err("代理已在运行".to_string());
    }

    // 获取或生成 CA 证书
    let (cert_pem, key_pem, cert_path) = get_or_create_ca(&app_data_dir)?;

    // 保存证书路径
    *state.ca_cert_path.lock().await = Some(cert_path);

    // 创建 RcgenAuthority
    let key_pair = KeyPair::from_pem(&key_pem).map_err(|e| format!("解析 CA 私钥失败: {}", e))?;
    let issuer = Issuer::from_ca_cert_pem(&cert_pem, key_pair)
        .map_err(|e| format!("解析 CA 证书失败: {}", e))?;
    let ca = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());

    let handler = CaptureHandler {
        app: app.clone(),
        session_id: session_id.to_string(),
        entries: session.entries.clone(),
        current_request: Arc::new(Mutex::new(None)),
        breakpoints: session.breakpoints.clone(),
        paused: session.paused.clone(),
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let proxy = Proxy::builder()
        .with_addr(addr)
        .with_ca(ca)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler)
        .build()
        .map_err(|e| format!("创建代理失败: {}", e))?;

    *session.port.lock().await = port;
    session.running.store(true, Ordering::SeqCst);

    let running = session.running.clone();
    let abort_handle_store = session.abort_handle.clone();

    let task = tokio::spawn(async move {
        log::info!("代理服务器启动在 127.0.0.1:{}", port);
        if let Err(e) = proxy.start().await {
            log::error!("代理服务器错误: {}", e);
        }
        running.store(false, Ordering::SeqCst);
        log::info!("代理服务器已停止");
    });

    *abort_handle_store.lock().await = Some(task.abort_handle());

    Ok(())
}

/// 停止代理
pub async fn stop_proxy(state: &ProxyState, session_id: &str) -> Result<(), String> {
    let Some(session) = get_session(state, session_id).await else {
        return Ok(());
    };

    if !session.running.load(Ordering::SeqCst) {
        return Ok(());
    }

    // 释放所有挂起请求（按原样放行），避免连接任务在断点处永久阻塞
    {
        let mut paused = session.paused.lock().await;
        for (_, slot) in paused.drain() {
            let _ = slot.tx.send(None);
        }
    }

    let mut handle = session.abort_handle.lock().await;
    if let Some(h) = handle.take() {
        h.abort();
    }
    session.running.store(false, Ordering::SeqCst);

    log::info!("代理服务器已停止");
    Ok(())
}

/// 获取代理状态
pub async fn get_status(state: &ProxyState, session_id: &str) -> ProxyStatusInfo {
    let session = get_or_create_session(state, session_id).await;
    let entry_count = session.entries.lock().await.len();
    let port = *session.port.lock().await;

    ProxyStatusInfo {
        session_id: session_id.to_string(),
        running: session.running.load(Ordering::SeqCst),
        port,
        entry_count,
    }
}

/// 获取所有已捕获条目
pub async fn get_entries(state: &ProxyState, session_id: &str) -> Vec<CapturedEntry> {
    let Some(session) = get_session(state, session_id).await else {
        return Vec::new();
    };

    session.entries.lock().await.iter().cloned().collect()
}

/// 清空已捕获条目
pub async fn clear_entries(state: &ProxyState, session_id: &str) {
    if let Some(session) = get_session(state, session_id).await {
        session.entries.lock().await.clear();
    }
}

// ═══════════════════════════════════════════
//  断点 / 重放
// ═══════════════════════════════════════════

/// 设置断点规则（整组替换）；可在代理运行中实时调整
pub async fn set_breakpoints(state: &ProxyState, session_id: &str, patterns: Vec<BreakpointRule>) {
    let session = get_or_create_session(state, session_id).await;
    *session.breakpoints.lock().await = patterns;
}

/// 获取当前断点规则
pub async fn list_breakpoints(state: &ProxyState, session_id: &str) -> Vec<BreakpointRule> {
    match get_session(state, session_id).await {
        Some(session) => session.breakpoints.lock().await.clone(),
        None => Vec::new(),
    }
}

/// 获取当前被挂起、等待放行的请求
pub async fn list_paused(state: &ProxyState, session_id: &str) -> Vec<PausedRequest> {
    match get_session(state, session_id).await {
        Some(session) => session
            .paused
            .lock()
            .await
            .values()
            .map(|slot| slot.info.clone())
            .collect(),
        None => Vec::new(),
    }
}

/// 放行一个被挂起的请求；modified 为 Some 时按修改内容转发
pub async fn resume(
    state: &ProxyState,
    session_id: &str,
    paused_id: &str,
    modified: Option<ResumeModification>,
) -> Result<(), String> {
    let session = get_session(state, session_id).await.ok_or("会话不存在")?;
    let slot = session.paused.lock().await.remove(paused_id);
    match slot {
        Some(slot) => {
            slot.tx
                .send(modified)
                .map_err(|_| "请求已断开，无法放行".to_string())?;
            Ok(())
        }
        None => Err("请求不存在或已放行".to_string()),
    }
}

/// 重放一条已捕获的请求：按原始 method/url/headers/body 重新发起，
/// 将新响应构造为一条 CapturedEntry，推送给前端并加入抓包列表后返回。
pub async fn replay_entry(
    app: tauri::AppHandle,
    state: &ProxyState,
    session_id: &str,
    entry_id: &str,
) -> Result<CapturedEntry, String> {
    let session = get_session(state, session_id)
        .await
        .ok_or("会话不存在")?;

    let original = {
        let entries = session.entries.lock().await;
        entries.iter().find(|e| e.id == entry_id).cloned()
    }
    .ok_or("未找到要重放的请求")?;

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let method = reqwest::Method::from_bytes(original.method.as_bytes())
        .map_err(|e| format!("无效的请求方法: {}", e))?;

    let mut builder = client.request(method, &original.url);
    for (k, v) in &original.request_headers {
        // 跳过 HTTP/2 伪首部及由客户端自行管理的首部
        if k.starts_with(':') {
            continue;
        }
        let lk = k.to_ascii_lowercase();
        if matches!(
            lk.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "proxy-connection"
                | "transfer-encoding"
                | "accept-encoding"
        ) {
            continue;
        }
        builder = builder.header(k, v);
    }

    // 优先使用原始字节（base64），回退到文本
    let body_bytes: Vec<u8> = if let Some(raw) = &original.request_body_raw {
        base64::engine::general_purpose::STANDARD
            .decode(raw)
            .map_err(|e| format!("解析请求体 base64 失败: {}", e))?
    } else if let Some(text) = &original.request_body {
        text.clone().into_bytes()
    } else {
        Vec::new()
    };
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes.clone());
    }

    let start = std::time::Instant::now();
    let resp = builder
        .send()
        .await
        .map_err(|e| format!("重放请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let http_version = format!("{:?}", resp.version());
    let response_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
        .collect();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let resp_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let duration_ms = start.elapsed().as_millis() as u64;
    let response_size = resp_bytes.len();
    let (response_body, response_body_raw) = if response_size > 0 && response_size <= 2 * 1024 * 1024
    {
        (
            String::from_utf8(resp_bytes.to_vec()).ok(),
            Some(base64::engine::general_purpose::STANDARD.encode(&resp_bytes)),
        )
    } else {
        (None, None)
    };

    let req_size = body_bytes.len();
    let (req_body_text, req_body_raw) = if req_size > 0 && req_size <= 2 * 1024 * 1024 {
        (
            String::from_utf8(body_bytes.clone()).ok(),
            Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)),
        )
    } else {
        (None, None)
    };

    let entry = CapturedEntry {
        session_id: session_id.to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        method: original.method.clone(),
        url: original.url.clone(),
        host: original.host.clone(),
        path: original.path.clone(),
        status: Some(status),
        status_text: Some(status_text),
        request_headers: original.request_headers.clone(),
        response_headers,
        request_body: req_body_text,
        response_body,
        request_body_raw: req_body_raw,
        response_body_raw,
        content_type,
        request_content_type: original.request_content_type.clone(),
        request_size: req_size,
        response_size,
        duration_ms,
        timestamp: now_iso(),
        completed: true,
        http_version: Some(http_version),
    };

    if let Err(e) = app.emit("capture-event", &entry) {
        log::error!("[CAPTURE] emit replay entry 失败: {:?}", e);
    }

    {
        let mut entries = session.entries.lock().await;
        if entries.len() >= 5000 {
            entries.pop_front();
        }
        entries.push_back(entry.clone());
    }

    Ok(entry)
}

/// 导出 CA 证书路径
pub async fn export_ca_cert(state: &ProxyState) -> Result<String, String> {
    let path = state.ca_cert_path.lock().await;
    match &*path {
        Some(p) => Ok(p.to_string_lossy().to_string()),
        None => Err("CA 证书尚未生成，请先启动代理".to_string()),
    }
}
