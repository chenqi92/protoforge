// Mock Server 模块
// 基于 hyper 实现本地 HTTP Mock 服务器
// 支持通配符路由匹配、动态响应模板、延迟模拟

use bytes::Bytes;
use http_body_util::Full;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

// ═══════════════════════════════════════════
//  数据结构
// ═══════════════════════════════════════════

/// Mock 路由规则
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRoute {
    pub id: String,
    /// HTTP 方法，None 表示匹配所有方法
    pub method: Option<String>,
    /// 路由模式：支持 :param、*、**
    pub pattern: String,
    /// 响应状态码
    pub status_code: u16,
    /// 响应头
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 响应体模板（支持 {{}} 变量插值）
    pub body_template: String,
    /// 延迟毫秒数
    pub delay_ms: Option<u64>,
    /// 路由优先级（数值越大优先级越高）
    #[serde(default)]
    pub priority: i32,
    /// 是否启用
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 可选描述
    #[serde(default)]
    pub description: String,
}

fn default_true() -> bool {
    true
}

/// 请求命中日志
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRequestLog {
    pub id: String,
    pub session_id: String,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub query: String,
    pub request_headers: Vec<(String, String)>,
    pub request_body: Option<String>,
    pub matched_route_id: Option<String>,
    pub matched_pattern: Option<String>,
    pub response_status: u16,
    pub response_body: String,
    pub delay_ms: u64,
    pub duration_ms: u64,
}

/// 服务器状态信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockServerStatusInfo {
    pub session_id: String,
    pub running: bool,
    pub port: u16,
    pub route_count: usize,
    pub log_count: usize,
    pub total_hits: u64,
}

// ═══════════════════════════════════════════
//  状态管理
// ═══════════════════════════════════════════

#[derive(Clone)]
pub struct MockServerSession {
    pub running: Arc<AtomicBool>,
    pub abort_handle: Arc<Mutex<Option<tokio::task::AbortHandle>>>,
    pub port: Arc<Mutex<u16>>,
    pub routes: Arc<Mutex<Vec<MockRoute>>>,
    pub logs: Arc<Mutex<VecDeque<MockRequestLog>>>,
    pub total_hits: Arc<std::sync::atomic::AtomicU64>,
}

impl MockServerSession {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            abort_handle: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(3100)),
            routes: Arc::new(Mutex::new(Vec::new())),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            total_hits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
}

pub struct MockServerState {
    pub sessions: Arc<Mutex<HashMap<String, MockServerSession>>>,
}

impl MockServerState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

async fn get_or_create_session(
    state: &MockServerState,
    session_id: &str,
) -> MockServerSession {
    let mut sessions = state.sessions.lock().await;
    sessions
        .entry(session_id.to_string())
        .or_insert_with(MockServerSession::new)
        .clone()
}

async fn get_session(
    state: &MockServerState,
    session_id: &str,
) -> Option<MockServerSession> {
    state.sessions.lock().await.get(session_id).cloned()
}

// ═══════════════════════════════════════════
//  路由匹配引擎
// ═══════════════════════════════════════════

/// 路由匹配结果
#[derive(Debug)]
struct RouteMatch {
    route_id: String,
    params: HashMap<String, String>,
}

/// 将路由 pattern 的段与请求路径的段进行匹配
fn match_route(pattern: &str, method: &str, req_method: &str, req_path: &str) -> Option<HashMap<String, String>> {
    // 检查方法匹配
    if !method.is_empty() && !method.eq_ignore_ascii_case(req_method) {
        return None;
    }

    // 剥离 pattern 中的 query string（用户可能误写 /api/get?key=val）
    let pattern_path = pattern.split('?').next().unwrap_or(pattern);
    let pattern_trimmed = pattern_path.trim_start_matches('/');
    let path_trimmed = req_path.trim_start_matches('/');

    // 根路径 "/" 的特殊处理
    let pattern_segments: Vec<&str> = if pattern_trimmed.is_empty() {
        vec![]
    } else {
        pattern_trimmed.split('/').collect()
    };
    let path_segments: Vec<&str> = if path_trimmed.is_empty() {
        vec![]
    } else {
        path_trimmed.split('/').collect()
    };

    let mut params = HashMap::new();
    let mut pi = 0; // pattern index
    let mut si = 0; // segment index

    while pi < pattern_segments.len() {
        let pat = pattern_segments[pi];

        if pat == "**" {
            // ** 匹配剩余所有段
            let rest: Vec<&str> = path_segments[si..].to_vec();
            params.insert("**".to_string(), rest.join("/"));
            return Some(params);
        }

        if si >= path_segments.len() {
            return None; // 路径段已用完但 pattern 还有
        }

        if pat.starts_with(':') {
            // :param 捕获单段
            let param_name = &pat[1..];
            params.insert(param_name.to_string(), path_segments[si].to_string());
        } else if pat == "*" {
            // * 匹配单段（不捕获命名参数）
            params.insert(format!("*{}", pi), path_segments[si].to_string());
        } else if pat != path_segments[si] {
            return None; // 精确匹配失败
        }

        pi += 1;
        si += 1;
    }

    // 两边都用完才算完全匹配
    if si == path_segments.len() {
        Some(params)
    } else {
        None
    }
}

/// 在路由列表中查找最佳匹配
fn find_best_match(routes: &[MockRoute], req_method: &str, req_path: &str) -> Option<RouteMatch> {
    let mut best: Option<(i32, RouteMatch, usize)> = None; // (priority, match, specificity)

    for route in routes {
        if !route.enabled {
            continue;
        }

        let method_str = route.method.as_deref().unwrap_or("");
        if let Some(params) = match_route(&route.pattern, method_str, req_method, req_path) {
            // 计算特异性：精确段越多越优先
            let specificity = route
                .pattern
                .split('/')
                .filter(|s| !s.starts_with(':') && *s != "*" && *s != "**")
                .count();

            let should_replace = match &best {
                None => true,
                Some((bp, _, bs)) => {
                    if route.priority != *bp {
                        route.priority > *bp
                    } else {
                        specificity > *bs
                    }
                }
            };

            if should_replace {
                best = Some((
                    route.priority,
                    RouteMatch {
                        route_id: route.id.clone(),
                        params,
                    },
                    specificity,
                ));
            }
        }
    }

    best.map(|(_, m, _)| m)
}

// ═══════════════════════════════════════════
//  模板引擎
// ═══════════════════════════════════════════

/// 处理响应体模板，替换 {{}} 中的变量
fn render_template(
    template: &str,
    req_method: &str,
    req_path: &str,
    query_params: &HashMap<String, String>,
    path_params: &HashMap<String, String>,
    req_headers: &HashMap<String, String>,
    req_body: &Option<String>,
) -> String {
    // 无模板变量时直接返回
    if !template.contains("{{") {
        return template.to_string();
    }

    let mut output = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        // 拷贝 {{ 之前的文本
        output.push_str(&rest[..start]);

        let after_open = &rest[start + 2..];
        if let Some(end) = after_open.find("}}") {
            let expr = after_open[..end].trim();
            let replacement = evaluate_template_expr(
                expr,
                req_method,
                req_path,
                query_params,
                path_params,
                req_headers,
                req_body,
            );
            output.push_str(&replacement);
            rest = &after_open[end + 2..];
        } else {
            // 没有匹配的 }}，原样保留
            output.push_str("{{");
            rest = after_open;
        }
    }

    // 拷贝剩余文本
    output.push_str(rest);
    output
}

/// 计算模板表达式的值
fn evaluate_template_expr(
    expr: &str,
    req_method: &str,
    req_path: &str,
    query_params: &HashMap<String, String>,
    path_params: &HashMap<String, String>,
    req_headers: &HashMap<String, String>,
    req_body: &Option<String>,
) -> String {
    // request.method
    if expr == "request.method" {
        return req_method.to_string();
    }
    // request.path
    if expr == "request.path" {
        return req_path.to_string();
    }
    // request.body
    if expr == "request.body" {
        return req_body.clone().unwrap_or_default();
    }
    // request.params.<name>
    if let Some(param_name) = expr.strip_prefix("request.params.") {
        return path_params.get(param_name).cloned().unwrap_or_default();
    }
    // request.query.<name>
    if let Some(query_name) = expr.strip_prefix("request.query.") {
        return query_params.get(query_name).cloned().unwrap_or_default();
    }
    // request.headers.<name>
    if let Some(header_name) = expr.strip_prefix("request.headers.") {
        return req_headers.get(header_name).cloned().unwrap_or_default();
    }

    // 内置动态变量
    if expr == "$randomUUID" {
        return uuid::Uuid::new_v4().to_string();
    }
    if expr == "$timestamp" {
        return chrono::Utc::now().timestamp().to_string();
    }
    if expr == "$isoTimestamp" {
        return chrono::Utc::now().to_rfc3339();
    }
    // $randomInt 或 $randomInt(min,max)
    if expr == "$randomInt" {
        return format!("{}", fastrand_u32(0, 1000));
    }
    if let Some(args) = expr.strip_prefix("$randomInt(") {
        if let Some(args) = args.strip_suffix(')') {
            let parts: Vec<&str> = args.split(',').collect();
            if parts.len() == 2 {
                let min: u32 = parts[0].trim().parse().unwrap_or(0);
                let max: u32 = parts[1].trim().parse().unwrap_or(1000);
                return format!("{}", fastrand_u32(min, max));
            }
        }
    }
    if expr == "$randomFloat" {
        return format!("{:.4}", fastrand_f64());
    }
    if expr == "$randomBoolean" {
        return if fastrand_u32(0, 2) == 0 {
            "true"
        } else {
            "false"
        }
        .to_string();
    }
    // Faker 风格变量
    if expr == "$faker.name" {
        return pick_random(&FAKE_NAMES);
    }
    if expr == "$faker.email" {
        let name = pick_random(&FAKE_NAMES).to_lowercase().replace(' ', ".");
        return format!("{}@example.com", name);
    }
    if expr == "$faker.phone" {
        return format!(
            "+1-{}-{}-{}",
            fastrand_u32(200, 999),
            fastrand_u32(200, 999),
            fastrand_u32(1000, 9999)
        );
    }
    if expr == "$faker.address" {
        return format!(
            "{} {} St, Anytown, US {}",
            fastrand_u32(100, 9999),
            pick_random(&FAKE_STREETS),
            fastrand_u32(10000, 99999)
        );
    }
    if expr == "$faker.company" {
        return pick_random(&FAKE_COMPANIES);
    }
    if expr == "$faker.sentence" {
        return pick_random(&FAKE_SENTENCES);
    }

    // 未识别的表达式原样返回
    format!("{{{{{}}}}}", expr)
}

/// 简易 URL 解码（处理 %XX 编码）
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte as char);
                    continue;
                }
            }
            result.push('%');
            result.push_str(&hex);
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

// 简易伪随机（不需要 rand crate）
// 使用原子计数器 + 时间戳避免同一请求内重复
static RAND_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn fastrand_u32(min: u32, max: u32) -> u32 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    let counter = RAND_COUNTER.fetch_add(1, Ordering::Relaxed);
    // 简易混合哈希
    let mixed = nanos.wrapping_mul(6364136223846793005).wrapping_add(counter.wrapping_mul(1442695040888963407));
    let range = (max - min).max(1) as u64;
    min + ((mixed >> 16) % range) as u32
}

fn fastrand_f64() -> f64 {
    fastrand_u32(0, 1_000_000) as f64 / 1_000_000.0
}

fn pick_random(list: &[&str]) -> String {
    let idx = fastrand_u32(0, list.len() as u32) as usize;
    list.get(idx).unwrap_or(&list[0]).to_string()
}

static FAKE_NAMES: &[&str] = &[
    "Alice Johnson", "Bob Smith", "Charlie Brown", "Diana Prince",
    "Edward Norton", "Fiona Apple", "George Lucas", "Hannah Montana",
    "Ivan Petrov", "Julia Roberts",
];

static FAKE_STREETS: &[&str] = &[
    "Main", "Oak", "Pine", "Elm", "Maple", "Cedar", "Birch", "Walnut",
];

static FAKE_COMPANIES: &[&str] = &[
    "Acme Corp", "Globex Inc", "Initech", "Umbrella Corp",
    "Stark Industries", "Wayne Enterprises", "Cyberdyne Systems",
];

static FAKE_SENTENCES: &[&str] = &[
    "The quick brown fox jumps over the lazy dog.",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    "All that glitters is not gold.",
    "To be or not to be, that is the question.",
];

// ═══════════════════════════════════════════
//  HTTP 请求处理
// ═══════════════════════════════════════════

async fn handle_mock_request(
    req: Request<hyper::body::Incoming>,
    routes: Arc<Mutex<Vec<MockRoute>>>,
    logs: Arc<Mutex<VecDeque<MockRequestLog>>>,
    total_hits: Arc<std::sync::atomic::AtomicU64>,
    session_id: String,
    app: tauri::AppHandle,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start = std::time::Instant::now();
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let query_str = req.uri().query().unwrap_or("").to_string();

    // CORS preflight 自动响应���无需配置路由）
    if method == "OPTIONS" {
        return Ok(Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "*")
            .header("Access-Control-Allow-Headers", "*")
            .header("Access-Control-Max-Age", "86400")
            .body(Full::new(Bytes::new()))
            .unwrap());
    }

    // 解析 query params（含 URL 解码）
    let query_params: HashMap<String, String> = query_str
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next().unwrap_or("");
            Some((
                url_decode(key),
                url_decode(value),
            ))
        })
        .collect();

    // 解析请求头
    let req_headers: HashMap<String, String> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let header_vec: Vec<(String, String)> = req_headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

    // 读取请求体
    use http_body_util::BodyExt;
    let body_bytes = req.into_body().collect().await.map(|c| c.to_bytes()).ok();
    let req_body = body_bytes
        .as_ref()
        .map(|b| String::from_utf8_lossy(b).to_string());

    // 查找匹配路由
    let routes_lock = routes.lock().await;
    let route_match = find_best_match(&routes_lock, &method, &path);

    let (status, response_body, matched_route_id, matched_pattern, delay_ms, response_headers) =
        if let Some(rm) = &route_match {
            let route = routes_lock.iter().find(|r| r.id == rm.route_id).unwrap();
            let body = render_template(
                &route.body_template,
                &method,
                &path,
                &query_params,
                &rm.params,
                &req_headers,
                &req_body,
            );
            let delay = route.delay_ms.unwrap_or(0);
            (
                route.status_code,
                body,
                Some(route.id.clone()),
                Some(route.pattern.clone()),
                delay,
                route.headers.clone(),
            )
        } else {
            (
                404,
                serde_json::json!({
                    "error": "No matching mock route",
                    "method": method,
                    "path": path
                })
                .to_string(),
                None,
                None,
                0u64,
                HashMap::new(),
            )
        };

    drop(routes_lock);

    // 延迟模拟
    if delay_ms > 0 {
        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    total_hits.fetch_add(1, Ordering::Relaxed);

    // 构建日志条目
    let log_entry = MockRequestLog {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        method: method.clone(),
        path: path.clone(),
        query: query_str,
        request_headers: header_vec,
        request_body: req_body,
        matched_route_id,
        matched_pattern,
        response_status: status,
        response_body: response_body.clone(),
        delay_ms,
        duration_ms,
    };

    // 记录日志（最多保留 2000 条）
    {
        let mut log_lock = logs.lock().await;
        if log_lock.len() >= 2000 {
            log_lock.pop_front();
        }
        log_lock.push_back(log_entry.clone());
    }

    // 推送事件到前端
    let _ = app.emit("mock-server-hit", &log_entry);

    // 构建 HTTP 响应
    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut builder = Response::builder().status(status_code);

    // 设置默认 Content-Type
    if !response_headers.contains_key("content-type") && !response_headers.contains_key("Content-Type") {
        builder = builder.header("Content-Type", "application/json; charset=utf-8");
    }

    // 设置自定义响应头
    for (key, value) in &response_headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    // CORS 头（方便开发调试）
    builder = builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "*")
        .header("Access-Control-Allow-Headers", "*");

    Ok(builder
        .body(Full::new(Bytes::from(response_body)))
        .unwrap_or_else(|_| {
            Response::new(Full::new(Bytes::from("Internal Server Error")))
        }))
}

// ═══════════════════════════════════════════
//  Mock Server 生命周期
// ═══════════════════════════════════════════

/// 启动 Mock Server
pub async fn start_mock_server(
    app: tauri::AppHandle,
    state: &MockServerState,
    session_id: &str,
    port: u16,
    routes: Vec<MockRoute>,
) -> Result<(), String> {
    let session = get_or_create_session(state, session_id).await;

    if session.running.load(Ordering::SeqCst) {
        return Err("Mock Server 已在运行".to_string());
    }

    // 更新路由
    *session.routes.lock().await = routes;
    *session.port.lock().await = port;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await.map_err(|e| {
        let hint = if e.kind() == std::io::ErrorKind::AddrInUse {
            format!("端口 {} 已被占用，请更换端口", port)
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!("端口 {} 需要更高权限（请使用 1024 以上端口）", port)
        } else {
            format!("端口 {} 绑定失败: {}", port, e)
        };
        hint
    })?;

    session.running.store(true, Ordering::SeqCst);

    let running = session.running.clone();
    let routes_arc = session.routes.clone();
    let logs_arc = session.logs.clone();
    let total_hits = session.total_hits.clone();
    let sid = session_id.to_string();
    let abort_handle_store = session.abort_handle.clone();

    let task = tokio::spawn(async move {
        log::info!("Mock Server 启动在 127.0.0.1:{}", port);

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let io = TokioIo::new(stream);
                    let routes = routes_arc.clone();
                    let logs = logs_arc.clone();
                    let hits = total_hits.clone();
                    let sid = sid.clone();
                    let app = app.clone();

                    tokio::spawn(async move {
                        let svc = service_fn(move |req| {
                            handle_mock_request(
                                req,
                                routes.clone(),
                                logs.clone(),
                                hits.clone(),
                                sid.clone(),
                                app.clone(),
                            )
                        });

                        if let Err(e) = http1::Builder::new()
                            .serve_connection(io, svc)
                            .await
                        {
                            log::debug!("Mock Server 连接处理错误: {}", e);
                        }
                    });
                }
                Err(e) => {
                    // abort() 会导致 accept 返回错误，正常退出
                    if !running.load(Ordering::SeqCst) {
                        break;
                    }
                    log::error!("Mock Server accept 错误: {}", e);
                }
            }
        }

        running.store(false, Ordering::SeqCst);
        log::info!("Mock Server 已停止");
    });

    *abort_handle_store.lock().await = Some(task.abort_handle());

    Ok(())
}

/// 停止 Mock Server
pub async fn stop_mock_server(
    state: &MockServerState,
    session_id: &str,
) -> Result<(), String> {
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

    log::info!("Mock Server 已停止 (session: {})", session_id);
    Ok(())
}

/// 热更新路由（无需重启服务器）
pub async fn update_routes(
    state: &MockServerState,
    session_id: &str,
    routes: Vec<MockRoute>,
) -> Result<(), String> {
    let session = get_or_create_session(state, session_id).await;
    *session.routes.lock().await = routes;
    Ok(())
}

/// 获取请求日志
pub async fn get_logs(
    state: &MockServerState,
    session_id: &str,
) -> Vec<MockRequestLog> {
    if let Some(session) = get_session(state, session_id).await {
        session.logs.lock().await.iter().cloned().collect()
    } else {
        Vec::new()
    }
}

/// 清除请求日志
pub async fn clear_logs(state: &MockServerState, session_id: &str) {
    if let Some(session) = get_session(state, session_id).await {
        session.logs.lock().await.clear();
        session.total_hits.store(0, Ordering::Relaxed);
    }
}

/// 获取服务器状态
pub async fn get_status(
    state: &MockServerState,
    session_id: &str,
) -> MockServerStatusInfo {
    let session = get_or_create_session(state, session_id).await;
    MockServerStatusInfo {
        session_id: session_id.to_string(),
        running: session.running.load(Ordering::SeqCst),
        port: *session.port.lock().await,
        route_count: session.routes.lock().await.len(),
        log_count: session.logs.lock().await.len(),
        total_hits: session.total_hits.load(Ordering::Relaxed),
    }
}
