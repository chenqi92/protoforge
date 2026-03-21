// 网络抓包代理模块
// 基于 hudsucker 实现 MITM HTTP/HTTPS 代理
// 通过 Tauri Event 将捕获的请求/响应实时推送到前端

use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use http::uri::Uri;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

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
    pub content_type: Option<String>,
    pub request_size: usize,
    pub response_size: usize,
    pub duration_ms: u64,
    pub timestamp: String,
    pub completed: bool,
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
}

impl ProxySessionState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            abort_handle: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(9090)),
            entries: Arc::new(Mutex::new(VecDeque::new())),
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
    request_body_size: usize,
    start_time: std::time::Instant,
}

/// hudsucker 为每个请求/响应对克隆 handler 实例
/// 因此使用实例级 current_request 字段存储请求元数据
#[derive(Clone)]
struct CaptureHandler {
    app: tauri::AppHandle,
    session_id: String,
    entries: Arc<Mutex<VecDeque<CapturedEntry>>>,
    current_request: Arc<Mutex<Option<RequestMeta>>>,
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
                return format!("http://{}{}", host_str, uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/"));
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
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        let method = req.method().to_string();
        let url = extract_url(&req);

        // 跳过 CONNECT 请求本身（HTTPS 隧道建立阶段）
        if method == "CONNECT" {
            return req.into();
        }

        let host = extract_host(&url);
        let path = extract_path(&url);

        // 提取请求头
        let request_headers: Vec<(String, String)> = req
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("<binary>").to_string()))
            .collect();

        let request_body_size = req
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);

        let entry_id = uuid::Uuid::new_v4().to_string();

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
            content_type: None,
            request_size: request_body_size,
            response_size: 0,
            duration_ms: 0,
            timestamp: now_iso(),
            completed: false,
        };

        let _ = self.app.emit("capture-event", &pending_entry);

        // 存入当前实例的 request 元数据
        let meta = RequestMeta {
            id: entry_id,
            method,
            url,
            host,
            path,
            request_headers,
            request_body_size,
            start_time: std::time::Instant::now(),
        };
        *self.current_request.lock().await = Some(meta);

        req.into()
    }

    async fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        res: Response<Body>,
    ) -> Response<Body> {
        let status = res.status().as_u16();
        let status_text = res
            .status()
            .canonical_reason()
            .unwrap_or("")
            .to_string();

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

        let response_size = res
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);

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
                request_body: None,
                response_body: None,
                content_type,
                request_size: meta.request_body_size,
                response_size,
                duration_ms,
                timestamp: now_iso(),
                completed: true,
            };

            // 推送完整条目到前端
            let _ = self.app.emit("capture-event", &entry);

            // 存入历史列表（限制最大 5000 条）
            let mut entries = self.entries.lock().await;
            if entries.len() >= 5000 {
                entries.pop_front(); // VecDeque O(1) 操作
            }
            entries.push_back(entry);
        }

        res
    }
}

// ═══════════════════════════════════════════
//  CA 证书管理
// ═══════════════════════════════════════════

/// 获取或生成 CA 证书，返回 (cert_pem, key_pem, cert_path)
/// SECURITY TODO: 私钥文件当前以明文储存，未设置严格文件权限。
/// 在多用户 Windows 系统上，应考虑使用 ACL 限制访问或使用系统密钥库。
fn get_or_create_ca(app_data_dir: &PathBuf) -> Result<(String, String, PathBuf), String> {
    let ca_dir = app_data_dir.join("proxy-ca");
    let cert_path = ca_dir.join("protoforge-ca.crt");
    let key_path = ca_dir.join("protoforge-ca.key");

    // 如果已有证书，直接加载
    if cert_path.exists() && key_path.exists() {
        let cert_pem = std::fs::read_to_string(&cert_path)
            .map_err(|e| format!("读取 CA 证书失败: {}", e))?;
        let key_pem = std::fs::read_to_string(&key_path)
            .map_err(|e| format!("读取 CA 私钥失败: {}", e))?;
        return Ok((cert_pem, key_pem, cert_path));
    }

    // 生成新的 CA 证书
    std::fs::create_dir_all(&ca_dir)
        .map_err(|e| format!("创建 CA 目录失败: {}", e))?;

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

    let key_pair = KeyPair::generate()
        .map_err(|e| format!("生成密钥对失败: {}", e))?;
    let cert = params.self_signed(&key_pair)
        .map_err(|e| format!("自签名证书失败: {}", e))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    std::fs::write(&cert_path, &cert_pem)
        .map_err(|e| format!("写入 CA 证书失败: {}", e))?;
    std::fs::write(&key_path, &key_pem)
        .map_err(|e| format!("写入 CA 私钥失败: {}", e))?;

    log::info!("已生成新的 CA 证书: {:?}", cert_path);

    Ok((cert_pem, key_pem, cert_path))
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
    let key_pair = KeyPair::from_pem(&key_pem)
        .map_err(|e| format!("解析 CA 私钥失败: {}", e))?;
    let issuer = Issuer::from_ca_cert_pem(&cert_pem, key_pair)
        .map_err(|e| format!("解析 CA 证书失败: {}", e))?;
    let ca = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());

    let handler = CaptureHandler {
        app: app.clone(),
        session_id: session_id.to_string(),
        entries: session.entries.clone(),
        current_request: Arc::new(Mutex::new(None)),
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

/// 导出 CA 证书路径
pub async fn export_ca_cert(state: &ProxyState) -> Result<String, String> {
    let path = state.ca_cert_path.lock().await;
    match &*path {
        Some(p) => Ok(p.to_string_lossy().to_string()),
        None => Err("CA 证书尚未生成，请先启动代理".to_string()),
    }
}
