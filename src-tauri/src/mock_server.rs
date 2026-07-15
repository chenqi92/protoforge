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
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

const MAX_MOCK_REQUEST_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_MOCK_PROXY_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_MOCK_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_MOCK_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_MOCK_RESPONSE_HEADER_BYTES: usize = 64 * 1024;
const MAX_MOCK_LOG_BODY_BYTES: usize = 256 * 1024;
const MAX_MOCK_LOG_TOTAL_BYTES: usize = 32 * 1024 * 1024;
const MAX_MOCK_LOG_ENTRIES: usize = 2_000;
const MAX_MOCK_COMPLETED_TOMBSTONES: usize = 4_096;
const MOCK_JS_LOOP_ITERATION_LIMIT: u64 = 1_000_000;
const MOCK_JS_RECURSION_LIMIT: usize = 128;
const MOCK_JS_STACK_SIZE_LIMIT: usize = 2_048;
const MAX_MOCK_CONNECTIONS: usize = 128;
const MOCK_HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MOCK_BODY_READ_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MOCK_CONNECTION_LIFETIME: Duration = Duration::from_secs(5 * 60);

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
    /// 条件响应示例列表
    #[serde(default)]
    pub examples: Vec<MockExample>,
    /// JS 脚本动态响应（非空时优先于 template/examples/sequence）
    #[serde(default)]
    pub script: Option<String>,
    /// 响应序列（每次请求依次返回不同响应）
    #[serde(default)]
    pub sequence: Vec<SequenceItem>,
    /// 序列用完后是否循环（默认 true）
    #[serde(default = "default_true")]
    pub sequence_loop: bool,
}

/// 条件响应示例
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockExample {
    pub id: String,
    pub name: String,
    pub match_condition: MatchCondition,
    pub status_code: u16,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body_template: String,
    pub delay_ms: Option<u64>,
}

/// 匹配条件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MatchCondition {
    /// 按请求头匹配
    Header { name: String, value: String },
    /// 请求体包含指定文本
    BodyContains { value: String },
    /// JSON Path 匹配
    BodyJsonPath { path: String, value: String },
    /// 请求体正则匹配
    BodyRegex { pattern: String },
    /// 默认匹配（总是命中）
    Default,
}

/// 响应序列中的单项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceItem {
    #[serde(default = "generate_id")]
    pub id: String,
    pub status_code: u16,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body_template: String,
    pub delay_ms: Option<u64>,
}

fn default_true() -> bool {
    true
}

fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 持久化配置（数据库行）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockServerConfig {
    pub id: String,
    pub session_label: String,
    pub port: u16,
    pub routes_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_target: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 请求命中日志
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRequestLog {
    pub id: String,
    pub session_id: String,
    pub instance_generation: u64,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub query: String,
    pub request_headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_route_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    pub instance_generation: u64,
    pub running: bool,
    pub port: u16,
    pub route_count: usize,
    pub log_count: usize,
    pub total_hits: u64,
}

// ═══════════════════════════════════════════
//  状态管理
// ═══════════════════════════════════════════

struct StartReservation {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
}

enum MockServerPhase {
    Stopped,
    Starting {
        generation: u64,
        cancel: CancellationToken,
        start_finished: CancellationToken,
    },
    Running {
        generation: u64,
        cancel: CancellationToken,
        task: JoinHandle<()>,
    },
    Stopping {
        generation: u64,
        stop_finished: CancellationToken,
    },
}

struct MockServerLifecycle {
    next_generation: u64,
    phase: MockServerPhase,
    destroyed: bool,
}

enum MockServerStopAction {
    None,
    StopStarting {
        generation: u64,
        cancel: CancellationToken,
        start_finished: CancellationToken,
        stop_finished: CancellationToken,
    },
    StopRunning {
        generation: u64,
        cancel: CancellationToken,
        task: JoinHandle<()>,
        stop_finished: CancellationToken,
    },
    WaitForStop {
        stop_finished: CancellationToken,
    },
}

impl MockServerLifecycle {
    fn new() -> Self {
        Self {
            next_generation: 1,
            phase: MockServerPhase::Stopped,
            destroyed: false,
        }
    }

    fn reserve_start(&mut self) -> Result<StartReservation, String> {
        if self.destroyed {
            return Err("Mock Server 会话已销毁".to_string());
        }
        let state_name = match &self.phase {
            MockServerPhase::Stopped => None,
            MockServerPhase::Starting { .. } => Some("正在启动"),
            MockServerPhase::Running { .. } => Some("已在运行"),
            MockServerPhase::Stopping { .. } => Some("正在停止"),
        };
        if let Some(state_name) = state_name {
            return Err(format!("Mock Server {}", state_name));
        }

        let generation = self.next_generation;
        self.next_generation = self.next_generation.wrapping_add(1).max(1);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        self.phase = MockServerPhase::Starting {
            generation,
            cancel: cancel.clone(),
            start_finished: finished.clone(),
        };
        Ok(StartReservation {
            generation,
            cancel,
            finished,
        })
    }

    fn install_running(
        &mut self,
        reservation: &StartReservation,
        task: JoinHandle<()>,
    ) -> Result<(), JoinHandle<()>> {
        let can_install = matches!(
            &self.phase,
            MockServerPhase::Starting { generation, .. }
                if *generation == reservation.generation && !reservation.cancel.is_cancelled()
        );
        if !can_install {
            return Err(task);
        }

        self.phase = MockServerPhase::Running {
            generation: reservation.generation,
            cancel: reservation.cancel.clone(),
            task,
        };
        Ok(())
    }

    fn mark_start_failed(&mut self, generation: u64) {
        if matches!(
            &self.phase,
            MockServerPhase::Starting {
                generation: current,
                ..
            } if *current == generation
        ) {
            self.phase = MockServerPhase::Stopped;
        }
    }

    fn mark_running_finished(&mut self, generation: u64) {
        // A task from an older generation must never clear a replacement. During an
        // explicit stop the stopper owns the JoinHandle and completes the transition.
        if matches!(
            &self.phase,
            MockServerPhase::Running {
                generation: current,
                ..
            } if *current == generation
        ) {
            self.phase = MockServerPhase::Stopped;
        }
    }

    fn begin_stop(&mut self) -> MockServerStopAction {
        match std::mem::replace(&mut self.phase, MockServerPhase::Stopped) {
            MockServerPhase::Stopped => MockServerStopAction::None,
            MockServerPhase::Starting {
                generation,
                cancel,
                start_finished,
            } => {
                let stop_finished = CancellationToken::new();
                self.phase = MockServerPhase::Stopping {
                    generation,
                    stop_finished: stop_finished.clone(),
                };
                cancel.cancel();
                MockServerStopAction::StopStarting {
                    generation,
                    cancel,
                    start_finished,
                    stop_finished,
                }
            }
            MockServerPhase::Running {
                generation,
                cancel,
                task,
            } => {
                let stop_finished = CancellationToken::new();
                self.phase = MockServerPhase::Stopping {
                    generation,
                    stop_finished: stop_finished.clone(),
                };
                cancel.cancel();
                MockServerStopAction::StopRunning {
                    generation,
                    cancel,
                    task,
                    stop_finished,
                }
            }
            MockServerPhase::Stopping {
                generation,
                stop_finished,
            } => {
                self.phase = MockServerPhase::Stopping {
                    generation,
                    stop_finished: stop_finished.clone(),
                };
                MockServerStopAction::WaitForStop { stop_finished }
            }
        }
    }

    fn begin_destroy(&mut self) -> MockServerStopAction {
        self.destroyed = true;
        self.begin_stop()
    }

    fn complete_stop(&mut self, generation: u64) {
        let should_complete = matches!(
            &self.phase,
            MockServerPhase::Stopping {
                generation: current,
                ..
            } if *current == generation
        );
        if !should_complete {
            return;
        }

        let MockServerPhase::Stopping { stop_finished, .. } =
            std::mem::replace(&mut self.phase, MockServerPhase::Stopped)
        else {
            unreachable!("phase was checked while holding the lifecycle lock")
        };
        stop_finished.cancel();
    }

    fn is_running(&self) -> bool {
        matches!(&self.phase, MockServerPhase::Running { .. })
    }
}

struct StartFinishedGuard {
    lifecycle: Arc<Mutex<MockServerLifecycle>>,
    generation: u64,
    finished: CancellationToken,
    armed: bool,
}

impl StartFinishedGuard {
    fn new(
        lifecycle: Arc<Mutex<MockServerLifecycle>>,
        generation: u64,
        finished: CancellationToken,
    ) -> Self {
        Self {
            lifecycle,
            generation,
            finished,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.finished.cancel();
    }
}

impl Drop for StartFinishedGuard {
    fn drop(&mut self) {
        self.finished.cancel();
        if !self.armed {
            return;
        }

        let lifecycle = self.lifecycle.clone();
        let generation = self.generation;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                lifecycle.lock().await.mark_start_failed(generation);
            });
        }
    }
}

#[derive(Clone)]
pub struct MockServerSession {
    instance_generation: u64,
    lifecycle: Arc<Mutex<MockServerLifecycle>>,
    pub port: Arc<Mutex<u16>>,
    pub routes: Arc<Mutex<Vec<MockRoute>>>,
    pub logs: Arc<Mutex<VecDeque<MockRequestLog>>>,
    log_bytes: Arc<AtomicUsize>,
    pub total_hits: Arc<std::sync::atomic::AtomicU64>,
    /// 代理转发目标 URL（不匹配时转发）
    pub proxy_target: Arc<Mutex<Option<String>>>,
    /// 路由命中计数器（用于响应序列）
    pub hit_counters: Arc<Mutex<HashMap<String, u64>>>,
}

impl MockServerSession {
    fn new(instance_generation: u64) -> Self {
        Self {
            instance_generation,
            lifecycle: Arc::new(Mutex::new(MockServerLifecycle::new())),
            port: Arc::new(Mutex::new(3100)),
            routes: Arc::new(Mutex::new(Vec::new())),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            log_bytes: Arc::new(AtomicUsize::new(0)),
            total_hits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            proxy_target: Arc::new(Mutex::new(None)),
            hit_counters: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
struct MockServerTombstone {
    instance_generation: u64,
    finished: CancellationToken,
}

struct MockServerRegistry {
    sessions: HashMap<String, MockServerSession>,
    tombstones: HashMap<String, MockServerTombstone>,
    completed_tombstone_order: VecDeque<(String, u64)>,
    next_instance_generation: u64,
}

impl MockServerRegistry {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            tombstones: HashMap::new(),
            completed_tombstone_order: VecDeque::new(),
            next_instance_generation: 1,
        }
    }

    fn allocate_generation(&mut self) -> u64 {
        let generation = self.next_instance_generation;
        self.next_instance_generation = self.next_instance_generation.wrapping_add(1).max(1);
        generation
    }

    fn insert_new_session(&mut self, session_id: &str) -> MockServerSession {
        let session = MockServerSession::new(self.allocate_generation());
        self.sessions
            .insert(session_id.to_string(), session.clone());
        session
    }

    fn remove_session_if_generation(&mut self, session_id: &str, generation: u64) -> bool {
        let is_current = self
            .sessions
            .get(session_id)
            .is_some_and(|session| session.instance_generation == generation);
        if is_current {
            self.sessions.remove(session_id);
        }
        is_current
    }

    fn record_completed_tombstone(&mut self, session_id: &str, generation: u64) {
        self.completed_tombstone_order
            .push_back((session_id.to_string(), generation));
        while self.completed_tombstone_order.len() > MAX_MOCK_COMPLETED_TOMBSTONES {
            let Some((evicted_id, evicted_generation)) = self.completed_tombstone_order.pop_front()
            else {
                break;
            };
            let should_evict = self.tombstones.get(&evicted_id).is_some_and(|tombstone| {
                tombstone.instance_generation == evicted_generation
                    && tombstone.finished.is_cancelled()
            });
            if should_evict {
                self.tombstones.remove(&evicted_id);
            }
        }
    }
}

#[derive(Clone)]
pub struct MockServerState {
    sessions: Arc<Mutex<MockServerRegistry>>,
}

impl MockServerState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(MockServerRegistry::new())),
        }
    }
}

async fn get_or_create_start_session(
    state: &MockServerState,
    session_id: &str,
) -> Result<MockServerSession, String> {
    let mut registry = state.sessions.lock().await;
    if let Some(tombstone) = registry.tombstones.get(session_id) {
        if !tombstone.finished.is_cancelled() {
            return Err("Mock Server 会话正在销毁".to_string());
        }
        registry.tombstones.remove(session_id);
    }
    if let Some(session) = registry.sessions.get(session_id) {
        return Ok(session.clone());
    }
    Ok(registry.insert_new_session(session_id))
}

async fn get_session(state: &MockServerState, session_id: &str) -> Option<MockServerSession> {
    state
        .sessions
        .lock()
        .await
        .sessions
        .get(session_id)
        .cloned()
}

async fn get_active_session(
    state: &MockServerState,
    session_id: &str,
) -> Option<MockServerSession> {
    let registry = state.sessions.lock().await;
    if registry.tombstones.contains_key(session_id) {
        return None;
    }
    registry.sessions.get(session_id).cloned()
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
fn match_route(
    pattern: &str,
    method: &str,
    req_method: &str,
    req_path: &str,
) -> Option<HashMap<String, String>> {
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
    let mixed = nanos
        .wrapping_mul(6364136223846793005)
        .wrapping_add(counter.wrapping_mul(1442695040888963407));
    let (lo, hi) = if min > max { (max, min) } else { (min, max) };
    let range = hi.saturating_sub(lo).max(1) as u64;
    lo + ((mixed >> 16) % range) as u32
}

fn fastrand_f64() -> f64 {
    fastrand_u32(0, 1_000_000) as f64 / 1_000_000.0
}

fn pick_random(list: &[&str]) -> String {
    if list.is_empty() {
        return String::new();
    }
    let idx = fastrand_u32(0, list.len() as u32) as usize;
    list.get(idx).unwrap_or(&list[0]).to_string()
}

static FAKE_NAMES: &[&str] = &[
    "Alice Johnson",
    "Bob Smith",
    "Charlie Brown",
    "Diana Prince",
    "Edward Norton",
    "Fiona Apple",
    "George Lucas",
    "Hannah Montana",
    "Ivan Petrov",
    "Julia Roberts",
];

static FAKE_STREETS: &[&str] = &[
    "Main", "Oak", "Pine", "Elm", "Maple", "Cedar", "Birch", "Walnut",
];

static FAKE_COMPANIES: &[&str] = &[
    "Acme Corp",
    "Globex Inc",
    "Initech",
    "Umbrella Corp",
    "Stark Industries",
    "Wayne Enterprises",
    "Cyberdyne Systems",
];

static FAKE_SENTENCES: &[&str] = &[
    "The quick brown fox jumps over the lazy dog.",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    "All that glitters is not gold.",
    "To be or not to be, that is the question.",
];

fn validate_response_headers(headers: &HashMap<String, String>) -> Result<(), String> {
    let mut total_bytes = 0usize;
    for (name, value) in headers {
        total_bytes = total_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
        if total_bytes > MAX_MOCK_RESPONSE_HEADER_BYTES {
            return Err(format!(
                "响应头超过 {} KiB 上限",
                MAX_MOCK_RESPONSE_HEADER_BYTES / 1024
            ));
        }
        http::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("非法响应头名称: {}", name))?;
        http::header::HeaderValue::from_str(value)
            .map_err(|_| format!("响应头 {} 包含非法值", name))?;
    }
    Ok(())
}

fn validate_configured_response(
    label: &str,
    status_code: u16,
    body: &str,
    headers: &HashMap<String, String>,
) -> Result<(), String> {
    StatusCode::from_u16(status_code).map_err(|_| format!("{} 的状态码无效", label))?;
    if body.len() > MAX_MOCK_RESPONSE_BODY_BYTES {
        return Err(format!(
            "{} 的响应体超过 {} MiB 上限",
            label,
            MAX_MOCK_RESPONSE_BODY_BYTES / (1024 * 1024)
        ));
    }
    validate_response_headers(headers).map_err(|error| format!("{}: {}", label, error))
}

fn validate_mock_routes(routes: &[MockRoute]) -> Result<(), String> {
    for route in routes {
        let label = format!("路由 {}", route.id);
        validate_configured_response(
            &label,
            route.status_code,
            &route.body_template,
            &route.headers,
        )?;
        if let Some(script) = &route.script
            && script.len() > MAX_MOCK_SCRIPT_BYTES
        {
            return Err(format!(
                "{} 的脚本超过 {} KiB 上限",
                label,
                MAX_MOCK_SCRIPT_BYTES / 1024
            ));
        }
        for example in &route.examples {
            validate_configured_response(
                &format!("{} 示例 {}", label, example.id),
                example.status_code,
                &example.body_template,
                &example.headers,
            )?;
        }
        for item in &route.sequence {
            validate_configured_response(
                &format!("{} 序列项 {}", label, item.id),
                item.status_code,
                &item.body_template,
                &item.headers,
            )?;
        }
    }
    Ok(())
}

fn normalize_mock_response(
    status: &mut u16,
    body: &mut String,
    headers: &mut HashMap<String, String>,
) -> bool {
    let error = if StatusCode::from_u16(*status).is_err() {
        Some("Mock 响应状态码无效".to_string())
    } else if body.len() > MAX_MOCK_RESPONSE_BODY_BYTES {
        Some(format!(
            "Mock 响应体超过 {} MiB 上限",
            MAX_MOCK_RESPONSE_BODY_BYTES / (1024 * 1024)
        ))
    } else {
        validate_response_headers(headers).err()
    };

    let Some(error) = error else {
        return false;
    };
    *status = StatusCode::INTERNAL_SERVER_ERROR.as_u16();
    *body = serde_json::json!({"error": error}).to_string();
    headers.clear();
    true
}

fn truncate_log_body(value: &str) -> String {
    const SUFFIX: &str = "\n… [truncated]";
    if value.len() <= MAX_MOCK_LOG_BODY_BYTES {
        return value.to_string();
    }

    let mut end = MAX_MOCK_LOG_BODY_BYTES.saturating_sub(SUFFIX.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = String::with_capacity(MAX_MOCK_LOG_BODY_BYTES);
    truncated.push_str(&value[..end]);
    truncated.push_str(SUFFIX);
    truncated
}

fn mock_log_estimated_bytes(log: &MockRequestLog) -> usize {
    let mut total = log
        .id
        .len()
        .saturating_add(log.session_id.len())
        .saturating_add(log.timestamp.len())
        .saturating_add(log.method.len())
        .saturating_add(log.path.len())
        .saturating_add(log.query.len())
        .saturating_add(log.response_body.len());
    for (name, value) in &log.request_headers {
        total = total.saturating_add(name.len()).saturating_add(value.len());
    }
    for value in [
        log.request_body.as_deref(),
        log.matched_route_id.as_deref(),
        log.matched_pattern.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        total = total.saturating_add(value.len());
    }
    total
}

fn internal_error_response() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "application/json; charset=utf-8")
        .body(Full::new(Bytes::from_static(
            br#"{"error":"Internal Server Error"}"#,
        )))
        .expect("static internal-error response must be valid")
}

fn build_mock_http_response(
    status: u16,
    response_body: String,
    response_headers: &HashMap<String, String>,
) -> Response<Full<Bytes>> {
    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut builder = Response::builder().status(status_code);
    if !response_headers
        .keys()
        .any(|key| key.eq_ignore_ascii_case("content-type"))
    {
        builder = builder.header("Content-Type", "application/json; charset=utf-8");
    }
    for (key, value) in response_headers {
        builder = builder.header(key.as_str(), value.as_str());
    }
    builder = builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "*")
        .header("Access-Control-Allow-Headers", "*");

    builder
        .body(Full::new(Bytes::from(response_body)))
        .unwrap_or_else(|error| {
            log::warn!("构建 Mock HTTP 响应失败: {}", error);
            internal_error_response()
        })
}

// ═══════════════════════════════════════════
//  HTTP 请求处理
// ═══════════════════════════════════════════

async fn handle_mock_request(
    req: Request<hyper::body::Incoming>,
    routes: Arc<Mutex<Vec<MockRoute>>>,
    logs: Arc<Mutex<VecDeque<MockRequestLog>>>,
    log_bytes: Arc<AtomicUsize>,
    total_hits: Arc<std::sync::atomic::AtomicU64>,
    hit_counters: Arc<Mutex<HashMap<String, u64>>>,
    proxy_target: Arc<Mutex<Option<String>>>,
    session_id: String,
    instance_generation: u64,
    app: Option<tauri::AppHandle>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let start = std::time::Instant::now();
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let query_str = req.uri().query().unwrap_or("").to_string();

    // CORS preflight 自动响应
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
            Some((url_decode(key), url_decode(value)))
        })
        .collect();

    // 解析请求头
    let req_headers: HashMap<String, String> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let header_vec: Vec<(String, String)> = req_headers
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    // 读取请求体。Mock 脚本和日志都需要实体化数据，因此在分配前强制限制大小，
    // 避免分块请求或伪造的 Content-Length 导致无界内存增长。
    use http_body_util::BodyExt;
    let mut incoming = req.into_body();
    let mut body_bytes = Vec::new();
    loop {
        let frame = match tokio::time::timeout(MOCK_BODY_READ_IDLE_TIMEOUT, incoming.frame()).await
        {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(_) => {
                return Ok(Response::builder()
                    .status(StatusCode::REQUEST_TIMEOUT)
                    .header("Content-Type", "application/json; charset=utf-8")
                    .body(Full::new(Bytes::from_static(
                        br#"{"error":"Request body read timed out"}"#,
                    )))
                    .expect("static request-timeout response must be valid"));
            }
        };
        let frame = frame?;
        let Ok(data) = frame.into_data() else {
            continue;
        };
        if data.len() > MAX_MOCK_REQUEST_BODY_BYTES.saturating_sub(body_bytes.len()) {
            return Ok(Response::builder()
                .status(StatusCode::PAYLOAD_TOO_LARGE)
                .header("Content-Type", "application/json; charset=utf-8")
                .body(Full::new(Bytes::from_static(
                    br#"{"error":"Request body exceeds the 2 MiB limit"}"#,
                )))
                .expect("static payload-too-large response must be valid"));
        }
        body_bytes.extend_from_slice(&data);
    }
    let req_body = Some(String::from_utf8_lossy(&body_bytes).to_string());

    // 查找匹配路由
    let routes_lock = routes.lock().await;
    let route_match = find_best_match(&routes_lock, &method, &path);

    let (
        mut status,
        mut response_body,
        matched_route_id,
        matched_pattern,
        mut delay_ms,
        mut response_headers,
    ) = if let Some(rm) = &route_match {
        let route = routes_lock.iter().find(|r| r.id == rm.route_id).unwrap();

        // 响应优先级: script > sequence > examples > 基础字段
        let has_script = route
            .script
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

        if has_script {
            // JS 脚本动态响应
            let script = route.script.clone().unwrap();
            let route_id = route.id.clone();
            let route_pattern = route.pattern.clone();
            let m = method.clone();
            let p = path.clone();
            let qp = query_params.clone();
            let pp = rm.params.clone();
            let rh = req_headers.clone();
            let rb = req_body.clone();
            drop(routes_lock);

            // Execute inside the owned connection task. Boa has strict loop,
            // recursion, stack, input and output limits below, so stop can wait
            // for this task instead of detaching an unkillable blocking worker.
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                execute_mock_script(&script, &m, &p, &qp, &pp, &rh, &rb)
            })) {
                Ok(Ok(result)) => (
                    result.status,
                    result.body,
                    Some(route_id),
                    Some(route_pattern),
                    0u64,
                    result.headers,
                ),
                Ok(Err(e)) => (
                    500,
                    serde_json::json!({"error": "Script error", "detail": e}).to_string(),
                    Some(route_id),
                    Some(route_pattern),
                    0u64,
                    HashMap::new(),
                ),
                Err(_) => (
                    500,
                    serde_json::json!({"error": "Script panic"}).to_string(),
                    Some(route_id),
                    Some(route_pattern),
                    0u64,
                    HashMap::new(),
                ),
            }
        } else if !route.sequence.is_empty() {
            // 响应序列 — 先克隆数据再释放 routes_lock，避免双锁死锁
            let route_id = route.id.clone();
            let route_pattern = route.pattern.clone();
            let sequence = route.sequence.clone();
            let sequence_loop = route.sequence_loop;
            let params = rm.params.clone();
            drop(routes_lock);

            let mut counters = hit_counters.lock().await;
            let count = counters.entry(route_id.clone()).or_insert(0);
            let idx = if sequence_loop {
                (*count % sequence.len() as u64) as usize
            } else {
                (*count).min(sequence.len() as u64 - 1) as usize
            };
            *count += 1;
            drop(counters);

            let seq = &sequence[idx];
            let body = render_template(
                &seq.body_template,
                &method,
                &path,
                &query_params,
                &params,
                &req_headers,
                &req_body,
            );
            (
                seq.status_code,
                body,
                Some(route_id),
                Some(route_pattern),
                seq.delay_ms.unwrap_or(0),
                seq.headers.clone(),
            )
        } else if !route.examples.is_empty() {
            // 条件响应
            let route_id = route.id.clone();
            let route_pattern = route.pattern.clone();
            if let Some(ex) = select_example(&route.examples, &req_headers, &req_body) {
                let body = render_template(
                    &ex.body_template,
                    &method,
                    &path,
                    &query_params,
                    &rm.params,
                    &req_headers,
                    &req_body,
                );
                let result = (
                    ex.status_code,
                    body,
                    Some(route_id),
                    Some(route_pattern),
                    ex.delay_ms.unwrap_or(0),
                    ex.headers.clone(),
                );
                drop(routes_lock);
                result
            } else {
                // 无 example 匹配，用基础字段
                let body = render_template(
                    &route.body_template,
                    &method,
                    &path,
                    &query_params,
                    &rm.params,
                    &req_headers,
                    &req_body,
                );
                let result = (
                    route.status_code,
                    body,
                    Some(route_id),
                    Some(route_pattern),
                    route.delay_ms.unwrap_or(0),
                    route.headers.clone(),
                );
                drop(routes_lock);
                result
            }
        } else {
            // 基础字段
            let body = render_template(
                &route.body_template,
                &method,
                &path,
                &query_params,
                &rm.params,
                &req_headers,
                &req_body,
            );
            let result = (
                route.status_code,
                body,
                Some(route.id.clone()),
                Some(route.pattern.clone()),
                route.delay_ms.unwrap_or(0),
                route.headers.clone(),
            );
            drop(routes_lock);
            result
        }
    } else {
        drop(routes_lock);
        // 无匹配路由：尝试代理转发
        let target = proxy_target.lock().await.clone();
        if let Some(target_url) = target {
            match proxy_forward(
                &target_url,
                &method,
                &path,
                &query_str,
                &req_headers,
                &req_body,
            )
            .await
            {
                Ok((s, h, b)) => (s, b, None, Some(format!("→ {}", target_url)), 0u64, h),
                Err(e) => (
                    502,
                    serde_json::json!({"error": "Proxy forward failed", "detail": e}).to_string(),
                    None,
                    None,
                    0u64,
                    HashMap::new(),
                ),
            }
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
        }
    };

    if normalize_mock_response(&mut status, &mut response_body, &mut response_headers) {
        delay_ms = 0;
    }

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
        instance_generation,
        timestamp: chrono::Utc::now().to_rfc3339(),
        method: method.clone(),
        path: path.clone(),
        query: query_str,
        request_headers: header_vec,
        request_body: req_body.as_deref().map(truncate_log_body),
        matched_route_id,
        matched_pattern,
        response_status: status,
        response_body: truncate_log_body(&response_body),
        delay_ms,
        duration_ms,
    };

    // 同时限制条数与总估算字节，避免 2000 个大响应把内存放大到 GiB 级。
    {
        let mut log_lock = logs.lock().await;
        let entry_bytes = mock_log_estimated_bytes(&log_entry);
        let mut current_bytes = log_bytes.load(Ordering::Relaxed);
        while !log_lock.is_empty()
            && (log_lock.len() >= MAX_MOCK_LOG_ENTRIES
                || current_bytes.saturating_add(entry_bytes) > MAX_MOCK_LOG_TOTAL_BYTES)
        {
            if let Some(removed) = log_lock.pop_front() {
                current_bytes = current_bytes.saturating_sub(mock_log_estimated_bytes(&removed));
            }
        }
        if entry_bytes <= MAX_MOCK_LOG_TOTAL_BYTES {
            log_lock.push_back(log_entry.clone());
            current_bytes = current_bytes.saturating_add(entry_bytes);
        }
        log_bytes.store(current_bytes, Ordering::Relaxed);
    }

    // 推送事件到前端
    if let Some(app) = app {
        let _ = app.emit("mock-server-hit", &log_entry);
    }

    Ok(build_mock_http_response(
        status,
        response_body,
        &response_headers,
    ))
}

// ═══════════════════════════════════════════
//  Mock Server 生命周期
// ═══════════════════════════════════════════

#[derive(Clone)]
struct MockServerRuntime {
    routes: Arc<Mutex<Vec<MockRoute>>>,
    logs: Arc<Mutex<VecDeque<MockRequestLog>>>,
    log_bytes: Arc<AtomicUsize>,
    total_hits: Arc<std::sync::atomic::AtomicU64>,
    hit_counters: Arc<Mutex<HashMap<String, u64>>>,
    proxy_target: Arc<Mutex<Option<String>>>,
    session_id: String,
    instance_generation: u64,
    app: Option<tauri::AppHandle>,
}

#[derive(Clone, Copy)]
struct MockServerLimits {
    max_connections: usize,
    header_read_timeout: Duration,
    connection_lifetime: Duration,
}

impl MockServerLimits {
    const PRODUCTION: Self = Self {
        max_connections: MAX_MOCK_CONNECTIONS,
        header_read_timeout: MOCK_HEADER_READ_TIMEOUT,
        connection_lifetime: MOCK_CONNECTION_LIFETIME,
    };
}

async fn serve_mock_connection(
    stream: tokio::net::TcpStream,
    runtime: MockServerRuntime,
    cancel: CancellationToken,
    limits: MockServerLimits,
) {
    let svc = service_fn(move |req| {
        handle_mock_request(
            req,
            runtime.routes.clone(),
            runtime.logs.clone(),
            runtime.log_bytes.clone(),
            runtime.total_hits.clone(),
            runtime.hit_counters.clone(),
            runtime.proxy_target.clone(),
            runtime.session_id.clone(),
            runtime.instance_generation,
            runtime.app.clone(),
        )
    });

    let io = TokioIo::new(stream);
    let mut builder = http1::Builder::new();
    builder
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(limits.header_read_timeout);
    let connection = builder.serve_connection(io, svc);

    tokio::select! {
        biased;
        _ = cancel.cancelled() => {}
        result = tokio::time::timeout(limits.connection_lifetime, connection) => {
            match result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => log::debug!("Mock Server 连接处理错误: {}", error),
                Err(_) => log::debug!("Mock Server 连接超过最大存活时间，已关闭"),
            }
        }
    }
}

async fn drain_mock_connections(connections: &mut JoinSet<()>) {
    connections.abort_all();
    while let Some(result) = connections.join_next().await {
        if let Err(error) = result
            && !error.is_cancelled()
        {
            log::debug!("Mock Server 连接任务异常结束: {}", error);
        }
    }
}

async fn serve_mock_listener(
    listener: TcpListener,
    runtime: MockServerRuntime,
    cancel: CancellationToken,
    limits: MockServerLimits,
) {
    let semaphore = Arc::new(Semaphore::new(limits.max_connections.max(1)));
    let mut connections = JoinSet::new();
    let mut consecutive_accept_errors = 0usize;

    'server: loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            Some(result) = connections.join_next(), if !connections.is_empty() => {
                if let Err(error) = result
                    && !error.is_cancelled()
                {
                    log::debug!("Mock Server 连接任务异常结束: {}", error);
                }
            }
            permit = semaphore.clone().acquire_owned() => {
                let Ok(permit) = permit else {
                    break;
                };
                let accepted = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break 'server,
                    accepted = listener.accept() => accepted,
                };

                match accepted {
                    Ok((stream, _)) => {
                        consecutive_accept_errors = 0;
                        let runtime = runtime.clone();
                        let cancel = cancel.clone();
                        connections.spawn(async move {
                            let _permit = permit;
                            serve_mock_connection(stream, runtime, cancel, limits).await;
                        });
                    }
                    Err(error) => {
                        drop(permit);
                        consecutive_accept_errors += 1;
                        log::error!("Mock Server accept 错误: {}", error);
                        if consecutive_accept_errors >= 10 {
                            log::error!("Mock Server 连续 accept 失败，服务器将停止");
                            break;
                        }
                        tokio::select! {
                            biased;
                            _ = cancel.cancelled() => break,
                            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
                        }
                    }
                }
            }
        }
    }

    // Cancelling first interrupts handlers that are waiting on upstream I/O. Aborting
    // the JoinSet then guarantees no accepted socket or request task survives stop.
    cancel.cancel();
    drain_mock_connections(&mut connections).await;
}

fn bind_error(port: u16, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::AddrInUse {
        format!("端口 {} 已被占用，请更换端口", port)
    } else if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!("端口 {} 需要更高权限（请使用 1024 以上端口）", port)
    } else {
        format!("端口 {} 绑定失败: {}", port, error)
    }
}

/// 启动 Mock Server
pub async fn start_mock_server(
    app: tauri::AppHandle,
    state: &MockServerState,
    session_id: &str,
    port: u16,
    routes: Vec<MockRoute>,
) -> Result<MockServerStatusInfo, String> {
    validate_mock_routes(&routes)?;
    let session = get_or_create_start_session(state, session_id).await?;

    // Reserve the session before any await that can bind a socket. This is the CAS
    // point that rejects concurrent starts for the same ID, regardless of port.
    let reservation = session.lifecycle.lock().await.reserve_start()?;
    let mut start_finished = StartFinishedGuard::new(
        session.lifecycle.clone(),
        reservation.generation,
        reservation.finished.clone(),
    );

    // 更新路由
    *session.routes.lock().await = routes;
    *session.port.lock().await = port;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::select! {
        biased;
        _ = reservation.cancel.cancelled() => {
            return Err("Mock Server 启动已取消".to_string());
        }
        result = TcpListener::bind(addr) => {
            match result {
                Ok(listener) => listener,
                Err(error) => {
                    session.lifecycle.lock().await.mark_start_failed(reservation.generation);
                    return Err(bind_error(port, error));
                }
            }
        }
    };

    let actual_port = listener
        .local_addr()
        .map(|addr| addr.port())
        .unwrap_or(port);
    *session.port.lock().await = actual_port;

    let runtime = MockServerRuntime {
        routes: session.routes.clone(),
        logs: session.logs.clone(),
        log_bytes: session.log_bytes.clone(),
        total_hits: session.total_hits.clone(),
        hit_counters: session.hit_counters.clone(),
        proxy_target: session.proxy_target.clone(),
        session_id: session_id.to_string(),
        instance_generation: session.instance_generation,
        app: Some(app),
    };
    let lifecycle = session.lifecycle.clone();
    let cancel = reservation.cancel.clone();
    let generation = reservation.generation;
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();

    // The start gate prevents the worker from finishing before its JoinHandle has
    // atomically replaced Starting. Stop therefore always finds a reapable owner.
    let task = tokio::spawn(async move {
        if start_rx.await.is_ok() {
            log::info!("Mock Server 启动在 127.0.0.1:{}", actual_port);
            serve_mock_listener(listener, runtime, cancel, MockServerLimits::PRODUCTION).await;
            lifecycle.lock().await.mark_running_finished(generation);
            log::info!("Mock Server 已停止");
        }
    });

    let mut lifecycle = session.lifecycle.lock().await;
    match lifecycle.install_running(&reservation, task) {
        Ok(()) => {
            let _ = start_tx.send(());
            start_finished.disarm();
        }
        Err(task) => {
            drop(lifecycle);
            drop(start_tx);
            let _ = task.await;
            return Err("Mock Server 启动已取消".to_string());
        }
    }

    drop(lifecycle);
    Ok(status_for_session(session_id, &session).await)
}

async fn execute_stop_action(
    lifecycle: Arc<Mutex<MockServerLifecycle>>,
    action: MockServerStopAction,
) {
    match action {
        MockServerStopAction::None => {}
        MockServerStopAction::WaitForStop { stop_finished } => {
            stop_finished.cancelled().await;
        }
        MockServerStopAction::StopStarting {
            generation,
            cancel,
            start_finished,
            stop_finished: _,
        } => {
            cancel.cancel();
            start_finished.cancelled().await;
            lifecycle.lock().await.complete_stop(generation);
        }
        MockServerStopAction::StopRunning {
            generation,
            cancel,
            task,
            stop_finished: _,
        } => {
            cancel.cancel();
            let _ = task.await;
            lifecycle.lock().await.complete_stop(generation);
        }
    }
}

fn owned_stop_finished(action: &MockServerStopAction) -> Option<CancellationToken> {
    match action {
        MockServerStopAction::StopStarting { stop_finished, .. }
        | MockServerStopAction::StopRunning { stop_finished, .. } => Some(stop_finished.clone()),
        MockServerStopAction::None | MockServerStopAction::WaitForStop { .. } => None,
    }
}

/// 停止 Mock Server，但保留会话配置与日志供当前工作台再次启动。
pub async fn stop_mock_server(state: &MockServerState, session_id: &str) -> Result<(), String> {
    let Some(session) = get_session(state, session_id).await else {
        return Ok(());
    };

    let action = session.lifecycle.lock().await.begin_stop();
    if matches!(action, MockServerStopAction::None) {
        return Ok(());
    }
    if let Some(wait_for_stop) = owned_stop_finished(&action) {
        // A detached coordinator owns cleanup so cancellation of this command cannot
        // strand the lifecycle in Stopping or leak the listener task.
        let lifecycle = session.lifecycle.clone();
        tokio::spawn(execute_stop_action(lifecycle, action));
        wait_for_stop.cancelled().await;
    } else {
        execute_stop_action(session.lifecycle.clone(), action).await;
    }

    log::info!("Mock Server 已停止 (session: {})", session_id);
    Ok(())
}

enum MockServerDestroyPreparation {
    Done,
    Wait(CancellationToken),
    Start {
        instance_generation: u64,
        finished: CancellationToken,
        lifecycle: Arc<Mutex<MockServerLifecycle>>,
        stop_action: MockServerStopAction,
    },
}

async fn prepare_mock_server_destroy(
    state: &MockServerState,
    session_id: &str,
) -> MockServerDestroyPreparation {
    let mut registry = state.sessions.lock().await;
    if let Some(tombstone) = registry.tombstones.get(session_id) {
        return if tombstone.finished.is_cancelled() {
            MockServerDestroyPreparation::Done
        } else {
            MockServerDestroyPreparation::Wait(tombstone.finished.clone())
        };
    }

    let Some(session) = registry.sessions.get(session_id).cloned() else {
        let instance_generation = registry.allocate_generation();
        let finished = CancellationToken::new();
        finished.cancel();
        registry.tombstones.insert(
            session_id.to_string(),
            MockServerTombstone {
                instance_generation,
                finished,
            },
        );
        registry.record_completed_tombstone(session_id, instance_generation);
        return MockServerDestroyPreparation::Done;
    };

    // Hold the registry lock until the exact session lifecycle is tombstoned. A
    // concurrent start therefore either reserves before this point and is cancelled
    // below, or sees the tombstone and cannot attach to the retiring instance.
    let stop_action = session.lifecycle.lock().await.begin_destroy();
    let finished = CancellationToken::new();
    registry.tombstones.insert(
        session_id.to_string(),
        MockServerTombstone {
            instance_generation: session.instance_generation,
            finished: finished.clone(),
        },
    );
    MockServerDestroyPreparation::Start {
        instance_generation: session.instance_generation,
        finished,
        lifecycle: session.lifecycle,
        stop_action,
    }
}

async fn finalize_mock_server_destroy(
    sessions: Arc<Mutex<MockServerRegistry>>,
    session_id: String,
    instance_generation: u64,
    finished: CancellationToken,
) {
    let mut registry = sessions.lock().await;
    registry.remove_session_if_generation(&session_id, instance_generation);
    if let Some(tombstone) = registry.tombstones.get(&session_id)
        && tombstone.instance_generation == instance_generation
    {
        tombstone.finished.cancel();
        registry.record_completed_tombstone(&session_id, instance_generation);
    }
    // Always wake callers waiting on this exact destroy generation, even if a later
    // registry mutation already replaced its tombstone. The generation CAS above
    // ensures this stale cleanup cannot remove the replacement session.
    finished.cancel();
}

/// 销毁 Mock Server 会话：停止并回收精确实例，然后从会话表移除。
pub async fn destroy_mock_server(state: &MockServerState, session_id: &str) -> Result<(), String> {
    match prepare_mock_server_destroy(state, session_id).await {
        MockServerDestroyPreparation::Done => Ok(()),
        MockServerDestroyPreparation::Wait(finished) => {
            finished.cancelled().await;
            Ok(())
        }
        MockServerDestroyPreparation::Start {
            instance_generation,
            finished,
            lifecycle,
            stop_action,
        } => {
            let sessions = state.sessions.clone();
            let owned_session_id = session_id.to_string();
            let wait_for_destroy = finished.clone();
            tokio::spawn(async move {
                execute_stop_action(lifecycle, stop_action).await;
                finalize_mock_server_destroy(
                    sessions,
                    owned_session_id,
                    instance_generation,
                    finished,
                )
                .await;
            });
            wait_for_destroy.cancelled().await;
            log::info!("Mock Server 会话已销毁 (session: {})", session_id);
            Ok(())
        }
    }
}

/// 热更新路由（无需重启服务器）
pub async fn update_routes(
    state: &MockServerState,
    session_id: &str,
    routes: Vec<MockRoute>,
) -> Result<(), String> {
    validate_mock_routes(&routes)?;
    let session = get_active_session(state, session_id)
        .await
        .ok_or_else(|| "Mock Server 会话不存在或已销毁".to_string())?;
    *session.routes.lock().await = routes;
    Ok(())
}

/// 获取请求日志
pub async fn get_logs(state: &MockServerState, session_id: &str) -> Vec<MockRequestLog> {
    if let Some(session) = get_active_session(state, session_id).await {
        session.logs.lock().await.iter().cloned().collect()
    } else {
        Vec::new()
    }
}

/// 清除请求日志
pub async fn clear_logs(state: &MockServerState, session_id: &str) {
    if let Some(session) = get_active_session(state, session_id).await {
        let mut logs = session.logs.lock().await;
        logs.clear();
        session.log_bytes.store(0, Ordering::Relaxed);
        drop(logs);
        session.total_hits.store(0, Ordering::Relaxed);
    }
}

/// 获取服务器状态
async fn status_for_session(session_id: &str, session: &MockServerSession) -> MockServerStatusInfo {
    let running = session.lifecycle.lock().await.is_running();
    let port = *session.port.lock().await;
    let route_count = session.routes.lock().await.len();
    let log_count = session.logs.lock().await.len();

    MockServerStatusInfo {
        session_id: session_id.to_string(),
        instance_generation: session.instance_generation,
        running,
        port,
        route_count,
        log_count,
        total_hits: session.total_hits.load(Ordering::Relaxed),
    }
}

pub async fn get_status(state: &MockServerState, session_id: &str) -> MockServerStatusInfo {
    let Some(session) = get_active_session(state, session_id).await else {
        return MockServerStatusInfo {
            session_id: session_id.to_string(),
            instance_generation: 0,
            running: false,
            port: 3100,
            route_count: 0,
            log_count: 0,
            total_hits: 0,
        };
    };
    status_for_session(session_id, &session).await
}

/// 设置代理转发目标
pub async fn set_proxy_target(
    state: &MockServerState,
    session_id: &str,
    target: Option<String>,
) -> Result<(), String> {
    let session = get_active_session(state, session_id)
        .await
        .ok_or_else(|| "Mock Server 会话不存在或已销毁".to_string())?;
    *session.proxy_target.lock().await = target;
    Ok(())
}

// ═══════════════════════════════════════════
//  条件匹配引擎
// ═══════════════════════════════════════════

fn evaluate_condition(
    condition: &MatchCondition,
    req_headers: &HashMap<String, String>,
    req_body: &Option<String>,
) -> bool {
    match condition {
        MatchCondition::Default => true,
        MatchCondition::Header { name, value } => req_headers
            .get(&name.to_lowercase())
            .map(|v| v == value)
            .unwrap_or(false),
        MatchCondition::BodyContains { value } => req_body
            .as_ref()
            .map(|b| b.contains(value))
            .unwrap_or(false),
        MatchCondition::BodyJsonPath { path, value } => {
            let Some(body) = req_body.as_ref() else {
                return false;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
                return false;
            };
            // 将 dot.path 转为 JSON pointer /path
            let pointer = if path.starts_with('/') {
                path.clone()
            } else {
                format!("/{}", path.replace('.', "/"))
            };
            json.pointer(&pointer)
                .map(|v| {
                    let v_str = match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    v_str == *value
                })
                .unwrap_or(false)
        }
        MatchCondition::BodyRegex { pattern } => {
            let Some(body) = req_body.as_ref() else {
                return false;
            };
            regex_lite::Regex::new(pattern)
                .map(|re| re.is_match(body))
                .unwrap_or(false)
        }
    }
}

/// 根据条件从 examples 中选择响应（Default 条件总是最后匹配）
fn select_example<'a>(
    examples: &'a [MockExample],
    req_headers: &HashMap<String, String>,
    req_body: &Option<String>,
) -> Option<&'a MockExample> {
    // 先匹配具体条件
    examples
        .iter()
        .find(|ex| {
            !matches!(ex.match_condition, MatchCondition::Default)
                && evaluate_condition(&ex.match_condition, req_headers, req_body)
        })
        // 再 fallback 到 Default
        .or_else(|| {
            examples
                .iter()
                .find(|ex| matches!(ex.match_condition, MatchCondition::Default))
        })
}

// ═══════════════════════════════════════════
//  JS 脚本执行引擎
// ═══════════════════════════════════════════

/// 脚本执行结果
#[derive(Debug)]
struct MockScriptResult {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// 执行 Mock 脚本（Boa JS 引擎）
fn execute_mock_script(
    script: &str,
    req_method: &str,
    req_path: &str,
    query_params: &HashMap<String, String>,
    path_params: &HashMap<String, String>,
    req_headers: &HashMap<String, String>,
    req_body: &Option<String>,
) -> Result<MockScriptResult, String> {
    use boa_engine::{Context, Source};

    if script.len() > MAX_MOCK_SCRIPT_BYTES {
        return Err(format!(
            "脚本超过 {} KiB 上限",
            MAX_MOCK_SCRIPT_BYTES / 1024
        ));
    }

    let mut ctx = Context::default();
    let limits = ctx.runtime_limits_mut();
    limits.set_loop_iteration_limit(MOCK_JS_LOOP_ITERATION_LIMIT);
    limits.set_recursion_limit(MOCK_JS_RECURSION_LIMIT);
    limits.set_stack_size_limit(MOCK_JS_STACK_SIZE_LIMIT);

    // 构建 mock.request 对象 JSON
    let request_json = serde_json::json!({
        "method": req_method,
        "path": req_path,
        "query": query_params,
        "params": path_params,
        "headers": req_headers,
        "body": req_body.clone().unwrap_or_default(),
    });

    // 注入全局变量: mock = { request: {...}, response: { status: 200, headers: {}, body: "" } }
    let setup_script = format!(
        r#"var mock = {{
            request: {},
            response: {{ status: 200, headers: {{}}, body: "" }}
        }};"#,
        serde_json::to_string(&request_json).unwrap_or_default()
    );

    ctx.eval(Source::from_bytes(&setup_script))
        .map_err(|e| format!("脚本初始化失败: {}", e))?;

    // 执行用户脚本
    ctx.eval(Source::from_bytes(script))
        .map_err(|e| format!("脚本执行失败: {}", e))?;

    let status_number = ctx
        .eval(Source::from_bytes("Number(mock.response.status)"))
        .map_err(|error| format!("读取脚本状态码失败: {}", error))?
        .as_number()
        .unwrap_or(f64::NAN);
    let status = if status_number.is_finite()
        && status_number.fract() == 0.0
        && (0.0..=u16::MAX as f64).contains(&status_number)
    {
        status_number as u16
    } else {
        0
    };

    let headers_value = ctx
        .eval(Source::from_bytes(
            "JSON.stringify(mock.response.headers || {})",
        ))
        .map_err(|error| format!("读取脚本响应头失败: {}", error))?;
    let headers_json = if let Some(value) = headers_value.as_string() {
        if value.len() > MAX_MOCK_RESPONSE_HEADER_BYTES {
            return Err(format!(
                "脚本响应头超过 {} KiB 上限",
                MAX_MOCK_RESPONSE_HEADER_BYTES / 1024
            ));
        }
        let value = value.to_std_string_escaped();
        if value.len() > MAX_MOCK_RESPONSE_HEADER_BYTES {
            return Err(format!(
                "脚本响应头超过 {} KiB 上限",
                MAX_MOCK_RESPONSE_HEADER_BYTES / 1024
            ));
        }
        value
    } else {
        "{}".to_string()
    };
    let headers: HashMap<String, String> = serde_json::from_str(&headers_json)
        .map_err(|error| format!("脚本响应头必须是字符串键值对象: {}", error))?;
    validate_response_headers(&headers)?;

    let body_value = ctx
        .eval(Source::from_bytes(
            "typeof mock.response.body === 'string' \
             ? mock.response.body : JSON.stringify(mock.response.body)",
        ))
        .map_err(|error| format!("读取脚本响应体失败: {}", error))?;
    let body = if let Some(value) = body_value.as_string() {
        if value.len() > MAX_MOCK_RESPONSE_BODY_BYTES {
            return Err(format!(
                "脚本响应体超过 {} MiB 上限",
                MAX_MOCK_RESPONSE_BODY_BYTES / (1024 * 1024)
            ));
        }
        let value = value.to_std_string_escaped();
        if value.len() > MAX_MOCK_RESPONSE_BODY_BYTES {
            return Err(format!(
                "脚本响应体超过 {} MiB 上限",
                MAX_MOCK_RESPONSE_BODY_BYTES / (1024 * 1024)
            ));
        }
        value
    } else {
        "null".to_string()
    };

    Ok(MockScriptResult {
        status,
        headers,
        body,
    })
}

// ═══════════════════════════════════════════
//  代理转发
// ═══════════════════════════════════════════

fn append_proxy_response_chunk(buffer: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if chunk.len() > MAX_MOCK_PROXY_RESPONSE_BYTES.saturating_sub(buffer.len()) {
        return Err(format!(
            "代理响应超过 {} MiB 上限",
            MAX_MOCK_PROXY_RESPONSE_BYTES / (1024 * 1024)
        ));
    }
    buffer.extend_from_slice(chunk);
    Ok(())
}

async fn proxy_forward(
    target: &str,
    method: &str,
    path: &str,
    query: &str,
    headers: &HashMap<String, String>,
    body: &Option<String>,
) -> Result<(u16, HashMap<String, String>, String), String> {
    let url = if query.is_empty() {
        format!("{}{}", target.trim_end_matches('/'), path)
    } else {
        format!("{}{}?{}", target.trim_end_matches('/'), path, query)
    };

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建代理客户端失败: {}", error))?;
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        "HEAD" => client.head(&url),
        _ => client.get(&url),
    };

    for (key, value) in headers {
        // 跳过 host 头（使用目标地址的 host）
        if key.to_lowercase() != "host" {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    if let Some(b) = body {
        req = req.body(b.clone());
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("代理转发失败: {}", e))?;
    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    if resp
        .content_length()
        .is_some_and(|length| length > MAX_MOCK_PROXY_RESPONSE_BYTES as u64)
    {
        return Err(format!(
            "代理响应超过 {} MiB 上限",
            MAX_MOCK_PROXY_RESPONSE_BYTES / (1024 * 1024)
        ));
    }

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut resp_bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取代理响应失败: {}", error))?;
        append_proxy_response_chunk(&mut resp_bytes, &chunk)?;
    }
    let resp_body = String::from_utf8_lossy(&resp_bytes).into_owned();

    Ok((status, resp_headers, resp_body))
}

// ═══════════════════════════════════════════
//  SQLite 持久化
// ═══════════════════════════════════════════

pub async fn save_mock_config(
    pool: &sqlx::SqlitePool,
    config: &MockServerConfig,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO mock_server_configs (id, session_label, port, routes_json, proxy_target, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_label = excluded.session_label,
           port = excluded.port,
           routes_json = excluded.routes_json,
           proxy_target = excluded.proxy_target,
           updated_at = excluded.updated_at"
    )
    .bind(&config.id)
    .bind(&config.session_label)
    .bind(config.port as i64)
    .bind(&config.routes_json)
    .bind(&config.proxy_target)
    .bind(&config.created_at)
    .bind(&config.updated_at)
    .execute(pool)
    .await
    .map_err(|e| format!("保存 Mock 配置失败: {}", e))?;
    Ok(())
}

pub async fn load_mock_config(
    pool: &sqlx::SqlitePool,
    id: &str,
) -> Result<Option<MockServerConfig>, String> {
    let row = sqlx::query_as::<_, (String, String, i64, String, Option<String>, String, String)>(
        "SELECT id, session_label, port, routes_json, proxy_target, created_at, updated_at FROM mock_server_configs WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("加载 Mock 配置失败: {}", e))?;

    Ok(row.map(
        |(id, label, port, routes_json, proxy_target, created_at, updated_at)| MockServerConfig {
            id,
            session_label: label,
            port: port as u16,
            routes_json,
            proxy_target,
            created_at,
            updated_at,
        },
    ))
}

pub async fn list_mock_configs(pool: &sqlx::SqlitePool) -> Result<Vec<MockServerConfig>, String> {
    let rows = sqlx::query_as::<_, (String, String, i64, String, Option<String>, String, String)>(
        "SELECT id, session_label, port, routes_json, proxy_target, created_at, updated_at FROM mock_server_configs ORDER BY updated_at DESC"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("列出 Mock 配置失败: {}", e))?;

    Ok(rows
        .into_iter()
        .map(
            |(id, label, port, routes_json, proxy_target, created_at, updated_at)| {
                MockServerConfig {
                    id,
                    session_label: label,
                    port: port as u16,
                    routes_json,
                    proxy_target,
                    created_at,
                    updated_at,
                }
            },
        )
        .collect())
}

pub async fn delete_mock_config(pool: &sqlx::SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM mock_server_configs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("删除 Mock 配置失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn test_runtime() -> MockServerRuntime {
        MockServerRuntime {
            routes: Arc::new(Mutex::new(Vec::new())),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            log_bytes: Arc::new(AtomicUsize::new(0)),
            total_hits: Arc::new(AtomicU64::new(0)),
            hit_counters: Arc::new(Mutex::new(HashMap::new())),
            proxy_target: Arc::new(Mutex::new(None)),
            session_id: "test-session".to_string(),
            instance_generation: 1,
            app: None,
        }
    }

    async fn spawn_test_server(
        limits: MockServerLimits,
    ) -> (SocketAddr, CancellationToken, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let cancel = CancellationToken::new();
        let worker_cancel = cancel.clone();
        let worker = tokio::spawn(async move {
            serve_mock_listener(listener, test_runtime(), worker_cancel, limits).await;
        });
        (address, cancel, worker)
    }

    #[test]
    fn lifecycle_reservation_is_exclusive_and_generation_bound() {
        let mut lifecycle = MockServerLifecycle::new();
        let first = lifecycle.reserve_start().unwrap();
        assert!(lifecycle.reserve_start().is_err());

        lifecycle.mark_start_failed(first.generation);
        let second = lifecycle.reserve_start().unwrap();
        assert!(second.generation > first.generation);

        // Cleanup from generation one cannot clear generation two's Starting state.
        lifecycle.mark_running_finished(first.generation);
        lifecycle.mark_start_failed(first.generation);
        assert!(lifecycle.reserve_start().is_err());

        lifecycle.mark_start_failed(second.generation);
        assert!(lifecycle.reserve_start().is_ok());
    }

    #[test]
    fn stopping_a_start_blocks_replacement_until_start_finishes() {
        let mut lifecycle = MockServerLifecycle::new();
        let reservation = lifecycle.reserve_start().unwrap();

        let MockServerStopAction::StopStarting {
            generation,
            cancel,
            start_finished,
            stop_finished: _,
        } = lifecycle.begin_stop()
        else {
            panic!("expected a Starting stop action");
        };
        assert_eq!(generation, reservation.generation);
        assert!(cancel.is_cancelled());
        assert!(lifecycle.reserve_start().is_err());

        let MockServerStopAction::WaitForStop { stop_finished } = lifecycle.begin_stop() else {
            panic!("a concurrent stop must wait for the owner");
        };
        start_finished.cancel();
        lifecycle.complete_stop(generation);
        assert!(stop_finished.is_cancelled());
        assert!(lifecycle.reserve_start().is_ok());
    }

    #[tokio::test]
    async fn dropped_start_guard_releases_its_generation() {
        let lifecycle = Arc::new(Mutex::new(MockServerLifecycle::new()));
        let reservation = lifecycle.lock().await.reserve_start().unwrap();
        let guard = StartFinishedGuard::new(
            lifecycle.clone(),
            reservation.generation,
            reservation.finished,
        );
        drop(guard);

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if lifecycle.lock().await.reserve_start().is_ok() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("dropping a start future must release Starting");
    }

    #[tokio::test]
    async fn stopping_a_run_cancels_and_reaps_its_owned_worker() {
        let mut lifecycle = MockServerLifecycle::new();
        let reservation = lifecycle.reserve_start().unwrap();
        let worker_cancel = reservation.cancel.clone();
        let worker = tokio::spawn(async move {
            worker_cancel.cancelled().await;
        });
        lifecycle.install_running(&reservation, worker).unwrap();
        assert!(lifecycle.is_running());

        let MockServerStopAction::StopRunning {
            generation,
            cancel,
            task,
            stop_finished: _,
        } = lifecycle.begin_stop()
        else {
            panic!("expected a Running stop action");
        };
        assert!(cancel.is_cancelled());
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("worker should stop promptly")
            .expect("worker should exit cleanly");
        lifecycle.complete_stop(generation);
        assert!(lifecycle.reserve_start().is_ok());
    }

    #[test]
    fn proxy_response_accumulator_rejects_the_first_byte_over_limit() {
        let mut response = vec![0; MAX_MOCK_PROXY_RESPONSE_BYTES - 1];
        append_proxy_response_chunk(&mut response, &[1]).unwrap();
        assert_eq!(response.len(), MAX_MOCK_PROXY_RESPONSE_BYTES);
        assert!(append_proxy_response_chunk(&mut response, &[2]).is_err());
    }

    fn run_test_script(script: &str) -> Result<MockScriptResult, String> {
        execute_mock_script(
            script,
            "GET",
            "/test",
            &HashMap::new(),
            &HashMap::new(),
            &HashMap::new(),
            &None,
        )
    }

    #[test]
    fn mock_script_limits_infinite_loops_and_recursion() {
        let loop_error = run_test_script("while (true) {}").unwrap_err();
        assert!(
            loop_error.contains("Maximum loop iteration limit"),
            "{loop_error}"
        );

        let recursion_error = run_test_script("function f() { return f(); } f();").unwrap_err();
        assert!(
            recursion_error.to_lowercase().contains("recursive"),
            "{recursion_error}"
        );
    }

    #[test]
    fn mock_script_extracts_status_headers_and_json_body() {
        let result = run_test_script(
            "mock.response.status = 201; \
             mock.response.headers = {'X-Test': 'yes'}; \
             mock.response.body = {ok: true};",
        )
        .unwrap();
        assert_eq!(result.status, 201);
        assert_eq!(
            result.headers.get("X-Test").map(String::as_str),
            Some("yes")
        );
        assert_eq!(result.body, r#"{"ok":true}"#);
    }

    #[test]
    fn mock_script_and_rendered_responses_are_size_bounded() {
        let script = format!(
            "mock.response.body = 'x'.repeat({});",
            MAX_MOCK_RESPONSE_BODY_BYTES + 1
        );
        let script_error = run_test_script(&script).unwrap_err();
        assert!(script_error.contains("响应体超过"), "{script_error}");

        let mut status = 200;
        let mut rendered = "x".repeat(MAX_MOCK_RESPONSE_BODY_BYTES + 1);
        let mut headers = HashMap::new();
        assert!(normalize_mock_response(
            &mut status,
            &mut rendered,
            &mut headers
        ));
        assert_eq!(status, 500);
        assert!(rendered.len() < 1024);
    }

    #[test]
    fn invalid_custom_header_fallback_is_explicit_500() {
        let headers = HashMap::from([("X-Bad".to_string(), "line one\nline two".to_string())]);
        let response = build_mock_http_response(200, "ok".to_string(), &headers);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn retained_log_bodies_are_utf8_safe_and_bounded() {
        let input = format!("{}界", "x".repeat(MAX_MOCK_LOG_BODY_BYTES));
        let truncated = truncate_log_body(&input);
        assert!(truncated.len() <= MAX_MOCK_LOG_BODY_BYTES);
        assert!(truncated.ends_with("[truncated]"));
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }

    #[tokio::test]
    async fn oversized_request_body_returns_413_and_server_reaps() {
        let limits = MockServerLimits {
            max_connections: 4,
            header_read_timeout: Duration::from_secs(2),
            connection_lifetime: Duration::from_secs(5),
        };
        let (address, cancel, worker) = spawn_test_server(limits).await;
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("http://{address}/upload"))
            .body(vec![b'x'; MAX_MOCK_REQUEST_BODY_BYTES + 1])
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);

        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(2), worker)
            .await
            .expect("server should stop promptly")
            .expect("server task should exit cleanly");
    }

    #[tokio::test]
    async fn connection_limit_queues_n_plus_one_slow_client_and_stop_closes_all() {
        let limits = MockServerLimits {
            max_connections: 2,
            header_read_timeout: Duration::from_secs(5),
            connection_lifetime: Duration::from_secs(10),
        };
        let (address, cancel, worker) = spawn_test_server(limits).await;

        let mut first = tokio::net::TcpStream::connect(address).await.unwrap();
        first.write_all(b"GET / HTTP/1.1\r\nHost:").await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut second = tokio::net::TcpStream::connect(address).await.unwrap();
        second.write_all(b"GET / HTTP/1.1\r\nHost:").await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut third = tokio::net::TcpStream::connect(address).await.unwrap();
        third
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0u8; 256];
        assert!(
            tokio::time::timeout(Duration::from_millis(150), third.read(&mut response))
                .await
                .is_err(),
            "the N+1 connection must wait for a permit"
        );

        drop(first);
        let count = tokio::time::timeout(Duration::from_secs(2), third.read(&mut response))
            .await
            .expect("queued connection should be accepted after a permit is released")
            .unwrap();
        assert!(String::from_utf8_lossy(&response[..count]).contains("404"));

        cancel.cancel();
        tokio::time::timeout(Duration::from_secs(2), worker)
            .await
            .expect("server should reap all connection tasks")
            .expect("server task should exit cleanly");
        let closed = tokio::time::timeout(Duration::from_secs(1), second.read(&mut response))
            .await
            .expect("accepted slow socket should be closed on stop");
        assert!(matches!(closed, Ok(0) | Err(_)));
    }

    #[tokio::test]
    async fn concurrent_public_stops_reap_listener_and_accepted_socket() {
        let state = MockServerState::new();
        let session = get_or_create_start_session(&state, "stop-test")
            .await
            .unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        *session.port.lock().await = address.port();

        let reservation = session.lifecycle.lock().await.reserve_start().unwrap();
        let worker_cancel = reservation.cancel.clone();
        let worker = tokio::spawn(async move {
            serve_mock_listener(
                listener,
                test_runtime(),
                worker_cancel,
                MockServerLimits {
                    max_connections: 2,
                    header_read_timeout: Duration::from_secs(5),
                    connection_lifetime: Duration::from_secs(10),
                },
            )
            .await;
        });
        session
            .lifecycle
            .lock()
            .await
            .install_running(&reservation, worker)
            .unwrap();

        let mut slow_client = tokio::net::TcpStream::connect(address).await.unwrap();
        slow_client
            .write_all(b"GET / HTTP/1.1\r\nHost:")
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        let (first, second) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(
                stop_mock_server(&state, "stop-test"),
                stop_mock_server(&state, "stop-test")
            )
        })
        .await
        .expect("both stop callers should observe completion");
        first.unwrap();
        second.unwrap();
        assert!(!get_status(&state, "stop-test").await.running);

        let closed = tokio::time::timeout(Duration::from_secs(1), slow_client.read(&mut [0u8; 1]))
            .await
            .expect("stop should close accepted sockets");
        assert!(matches!(closed, Ok(0) | Err(_)));
        let replacement = TcpListener::bind(address)
            .await
            .expect("stop should release the listening socket");
        drop(replacement);
    }

    #[tokio::test]
    async fn destroy_reclaims_session_map_and_passive_status_cannot_revive_it() {
        let state = MockServerState::new();
        let old_session = get_or_create_start_session(&state, "destroy-test")
            .await
            .unwrap();
        let old_generation = old_session.instance_generation;

        destroy_mock_server(&state, "destroy-test").await.unwrap();
        {
            let registry = state.sessions.lock().await;
            assert_eq!(registry.sessions.len(), 0);
            assert!(!registry.sessions.contains_key("destroy-test"));
            let tombstone = registry.tombstones.get("destroy-test").unwrap();
            assert_eq!(tombstone.instance_generation, old_generation);
            assert!(tombstone.finished.is_cancelled());
        }

        let status = get_status(&state, "destroy-test").await;
        assert_eq!(status.instance_generation, 0);
        assert!(!status.running);
        assert_eq!(status.route_count, 0);
        assert!(
            !state
                .sessions
                .lock()
                .await
                .sessions
                .contains_key("destroy-test"),
            "passive status reads must not recreate a destroyed session"
        );
        assert!(old_session.lifecycle.lock().await.reserve_start().is_err());
    }

    #[tokio::test]
    async fn completed_tombstones_are_bounded_and_eviction_cannot_revive_sessions() {
        let state = MockServerState::new();
        let evicted_id = "evicted-session";
        {
            let mut registry = state.sessions.lock().await;
            for index in 0..(MAX_MOCK_COMPLETED_TOMBSTONES + 32) {
                let session_id = if index == 0 {
                    evicted_id.to_string()
                } else {
                    format!("closed-session-{index}")
                };
                let generation = registry.allocate_generation();
                let finished = CancellationToken::new();
                finished.cancel();
                registry.tombstones.insert(
                    session_id.clone(),
                    MockServerTombstone {
                        instance_generation: generation,
                        finished,
                    },
                );
                registry.record_completed_tombstone(&session_id, generation);
            }
            assert!(
                registry.tombstones.len() <= MAX_MOCK_COMPLETED_TOMBSTONES,
                "completed tombstone map must remain bounded"
            );
            assert_eq!(
                registry.completed_tombstone_order.len(),
                MAX_MOCK_COMPLETED_TOMBSTONES
            );
            assert!(!registry.tombstones.contains_key(evicted_id));
        }

        assert!(!get_status(&state, evicted_id).await.running);
        assert!(get_logs(&state, evicted_id).await.is_empty());
        clear_logs(&state, evicted_id).await;
        assert!(update_routes(&state, evicted_id, Vec::new()).await.is_err());
        assert!(
            set_proxy_target(&state, evicted_id, Some("http://example.test".into()))
                .await
                .is_err()
        );
        assert!(state.sessions.lock().await.sessions.is_empty());

        let replacement = get_or_create_start_session(&state, evicted_id)
            .await
            .expect("only an explicit start may recreate an evicted ID");
        assert_eq!(
            state
                .sessions
                .lock()
                .await
                .sessions
                .get(evicted_id)
                .map(|session| session.instance_generation),
            Some(replacement.instance_generation)
        );
    }

    #[tokio::test]
    async fn destroy_start_race_is_tombstoned_and_stale_cleanup_preserves_replacement() {
        let state = MockServerState::new();
        let old_session = get_or_create_start_session(&state, "destroy-race")
            .await
            .unwrap();
        let old_generation = old_session.instance_generation;
        assert_eq!(
            get_status(&state, "destroy-race").await.instance_generation,
            old_generation
        );
        let reservation = old_session.lifecycle.lock().await.reserve_start().unwrap();
        let worker_cancel = reservation.cancel.clone();
        let release_worker = CancellationToken::new();
        let worker_release = release_worker.clone();
        let worker = tokio::spawn(async move {
            worker_cancel.cancelled().await;
            worker_release.cancelled().await;
        });
        old_session
            .lifecycle
            .lock()
            .await
            .install_running(&reservation, worker)
            .unwrap();

        let destroy_state = state.clone();
        let destroy =
            tokio::spawn(async move { destroy_mock_server(&destroy_state, "destroy-race").await });
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let destroying = state
                    .sessions
                    .lock()
                    .await
                    .tombstones
                    .get("destroy-race")
                    .is_some_and(|tombstone| !tombstone.finished.is_cancelled());
                if destroying {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("destroy should publish its tombstone before waiting for the worker");

        let race_error = match get_or_create_start_session(&state, "destroy-race").await {
            Ok(_) => panic!("a start racing an in-progress destroy must not replace the session"),
            Err(error) => error,
        };
        assert!(race_error.contains("正在销毁"), "{race_error}");

        release_worker.cancel();
        destroy
            .await
            .expect("destroy task should not panic")
            .unwrap();
        assert!(
            !state
                .sessions
                .lock()
                .await
                .sessions
                .contains_key("destroy-race")
        );

        let replacement = get_or_create_start_session(&state, "destroy-race")
            .await
            .unwrap();
        assert_ne!(replacement.instance_generation, old_generation);
        assert_eq!(
            get_status(&state, "destroy-race").await.instance_generation,
            replacement.instance_generation
        );
        assert!(old_session.lifecycle.lock().await.reserve_start().is_err());

        let stale_finished = CancellationToken::new();
        finalize_mock_server_destroy(
            state.sessions.clone(),
            "destroy-race".to_string(),
            old_generation,
            stale_finished,
        )
        .await;
        let registry = state.sessions.lock().await;
        assert_eq!(
            registry
                .sessions
                .get("destroy-race")
                .map(|session| session.instance_generation),
            Some(replacement.instance_generation),
            "cleanup from the old generation must not delete its replacement"
        );
    }
}
