// 网络抓包代理模块
// 基于 hudsucker 实现 MITM HTTP/HTTPS 代理
// 通过 Tauri Event 将捕获的请求/响应实时推送到前端

use base64::Engine as _;
use bytes::Bytes;
use futures_util::StreamExt;
use http::header::{CONTENT_LENGTH, HeaderName, HeaderValue, TRANSFER_ENCODING};
use http::uri::Uri;
use http_body_util::{BodyExt, Empty, Full};
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::body::Body as HttpBody,
    hyper::{Request, Response},
    rcgen::{CertificateParams, Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::Emitter;
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

// ═══════════════════════════════════════════
//  数据结构
// ═══════════════════════════════════════════

/// 单个捕获条目（后端 → 前端推送）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedEntry {
    pub session_id: String,
    /// Monotonic per-session publication sequence used as a strict clear/listener fence.
    pub capture_seq: u64,
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
    pub request_headers: Vec<(String, String)>,
    pub response_headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
    /// base64 编码的原始 request body 字节（用于 Hex 视图）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body_raw: Option<String>,
    /// base64 编码的原始 response body 字节（用于 Hex 视图）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// 请求的 Content-Type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_content_type: Option<String>,
    pub request_size: usize,
    pub response_size: usize,
    pub duration_ms: u64,
    pub timestamp: String,
    pub completed: bool,
    /// HTTP 版本 (如 "HTTP/1.1")
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    pub timestamp: String,
}

/// A paused request disappeared without an explicit successful resume from the UI.
/// Publishing the removal keeps a live frontend from retaining a stale breakpoint card.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedRemoval {
    pub session_id: String,
    pub request_id: String,
    pub reason: PausedRemovalReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PausedRemovalReason {
    Timeout,
    Stopped,
    Disconnected,
    Destroyed,
    Resumed,
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

pub struct ProxySessionState {
    destroyed: Arc<AtomicBool>,
    /// Starting and Running are both exclusive reservations for a session.  Keeping the
    /// generation and cancellation/abort primitive in the same mutex prevents two starts from
    /// racing and prevents an older start from overwriting a newer server's handle.
    lifecycle: Arc<Mutex<ProxyLifecycle>>,
    pub port: Arc<Mutex<u16>>,
    /// 使用 VecDeque 以便 O(1) 移除最旧条目（而非 Vec::remove(0) 的 O(n)）
    entries: Arc<Mutex<RetainedCaptures>>,
    /// 当前生效的断点规则
    pub breakpoints: Arc<Mutex<Vec<BreakpointRule>>>,
    /// 命中断点后被挂起、等待放行的请求（按 paused_id 索引）。
    /// 请求信息与放行通道存在同一项里，保证插入/移除原子，避免双锁竞态。
    paused: Arc<Mutex<PausedRequests>>,
}

impl Clone for ProxySessionState {
    fn clone(&self) -> Self {
        Self {
            lifecycle: self.lifecycle.clone(),
            destroyed: self.destroyed.clone(),
            port: self.port.clone(),
            entries: self.entries.clone(),
            breakpoints: self.breakpoints.clone(),
            paused: self.paused.clone(),
        }
    }
}

#[derive(Default)]
struct RetainedCaptures {
    entries: VecDeque<CapturedEntry>,
    last_sequence: u64,
    total_bytes: usize,
}

enum ProxyLifecycle {
    Stopped,
    Starting {
        generation: Uuid,
        cancel: CancellationToken,
        finished: CancellationToken,
    },
    Running {
        generation: Uuid,
        cancel: CancellationToken,
        abort_handle: tokio::task::AbortHandle,
        task_finished: CancellationToken,
        stop_finished: CancellationToken,
    },
    Stopping {
        generation: Uuid,
        finished: CancellationToken,
    },
}

enum ProxyStopAction {
    None,
    WaitForStarting(CancellationToken),
    WaitForStopping(CancellationToken),
    AbortRunning {
        generation: Uuid,
        abort_handle: tokio::task::AbortHandle,
        task_finished: CancellationToken,
        stop_finished: CancellationToken,
    },
}

/// Cancellation-safe completion signal for the detached proxy task. Its Drop runs when the task
/// finishes normally or is aborted, allowing stop cleanup to bound graceful shutdown reliably.
struct TaskCompletionSignal(CancellationToken);

impl Drop for TaskCompletionSignal {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

/// 一个被挂起请求的完整状态：展示信息 + 放行通道
pub struct PausedSlot {
    pub info: PausedRequest,
    pub tx: oneshot::Sender<Option<ResumeModification>>,
    charged_bytes: usize,
}

#[derive(Default)]
struct PausedRequests {
    slots: HashMap<String, PausedSlot>,
    total_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PausedInsertError {
    CountLimit,
    ByteLimit,
    Duplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PauseInstallResult {
    Installed,
    NotCurrent,
    AtCapacity,
}

impl ProxySessionState {
    pub fn new() -> Self {
        Self {
            destroyed: Arc::new(AtomicBool::new(false)),
            lifecycle: Arc::new(Mutex::new(ProxyLifecycle::Stopped)),
            port: Arc::new(Mutex::new(9090)),
            entries: Arc::new(Mutex::new(RetainedCaptures::default())),
            breakpoints: Arc::new(Mutex::new(Vec::new())),
            paused: Arc::new(Mutex::new(PausedRequests::default())),
        }
    }

    async fn reserve_start(&self) -> Result<(Uuid, CancellationToken, CancellationToken), String> {
        if self.destroyed.load(Ordering::Acquire) {
            return Err("抓包会话已销毁".to_string());
        }
        let mut lifecycle = self.lifecycle.lock().await;
        if self.destroyed.load(Ordering::Acquire) {
            return Err("抓包会话已销毁".to_string());
        }
        if !matches!(*lifecycle, ProxyLifecycle::Stopped) {
            return Err("代理已在启动或运行".to_string());
        }

        let generation = Uuid::new_v4();
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        *lifecycle = ProxyLifecycle::Starting {
            generation,
            cancel: cancel.clone(),
            finished: finished.clone(),
        };
        Ok((generation, cancel, finished))
    }

    async fn fail_start(&self, generation: Uuid) {
        let mut lifecycle = self.lifecycle.lock().await;
        let finished = match &*lifecycle {
            ProxyLifecycle::Starting {
                generation: current,
                finished,
                ..
            } if *current == generation => Some(finished.clone()),
            _ => None,
        };
        if let Some(finished) = finished {
            *lifecycle = ProxyLifecycle::Stopped;
            drop(lifecycle);
            finished.cancel();
        }
    }

    async fn is_running(&self) -> bool {
        matches!(*self.lifecycle.lock().await, ProxyLifecycle::Running { .. })
    }

    async fn cancel_server(&self) -> ProxyStopAction {
        let mut lifecycle = self.lifecycle.lock().await;
        match &*lifecycle {
            ProxyLifecycle::Stopped => ProxyStopAction::None,
            ProxyLifecycle::Starting {
                cancel, finished, ..
            } => {
                cancel.cancel();
                ProxyStopAction::WaitForStarting(finished.clone())
            }
            ProxyLifecycle::Running {
                generation,
                cancel,
                abort_handle,
                task_finished,
                stop_finished,
                ..
            } => {
                let generation = *generation;
                let cancel = cancel.clone();
                let action = ProxyStopAction::AbortRunning {
                    generation,
                    abort_handle: abort_handle.clone(),
                    task_finished: task_finished.clone(),
                    stop_finished: stop_finished.clone(),
                };
                *lifecycle = ProxyLifecycle::Stopping {
                    generation,
                    finished: stop_finished.clone(),
                };
                cancel.cancel();
                action
            }
            ProxyLifecycle::Stopping { finished, .. } => {
                ProxyStopAction::WaitForStopping(finished.clone())
            }
        }
    }

    async fn finish_stop(&self, generation: Uuid) {
        let mut lifecycle = self.lifecycle.lock().await;
        let finished = match &*lifecycle {
            ProxyLifecycle::Stopping {
                generation: current,
                finished,
            } if *current == generation => Some(finished.clone()),
            _ => None,
        };
        if let Some(finished) = finished {
            *lifecycle = ProxyLifecycle::Stopped;
            drop(lifecycle);
            finished.cancel();
        }
    }
}

#[derive(Default)]
struct SessionRegistry {
    active: HashMap<String, ProxySessionState>,
    destroyed_ids: HashSet<String>,
    destroyed_order: VecDeque<String>,
}

impl SessionRegistry {
    fn remember_destroyed_with_limit(&mut self, session_id: &str, limit: usize) {
        if limit == 0 || !self.destroyed_ids.insert(session_id.to_string()) {
            return;
        }
        self.destroyed_order.push_back(session_id.to_string());
        while self.destroyed_order.len() > limit {
            if let Some(expired) = self.destroyed_order.pop_front() {
                self.destroyed_ids.remove(&expired);
            }
        }
    }

    fn remember_destroyed(&mut self, session_id: &str) {
        self.remember_destroyed_with_limit(session_id, MAX_DESTROYED_SESSION_TOMBSTONES);
    }
}

pub struct ProxyState {
    registry: Arc<Mutex<SessionRegistry>>,
    pub ca_cert_path: Arc<Mutex<Option<PathBuf>>>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(Mutex::new(SessionRegistry::default())),
            ca_cert_path: Arc::new(Mutex::new(None)),
        }
    }
}

/// Only an explicit start may create backend session state. Destroyed UUIDs are not reusable:
/// UI sessions use fresh UUIDs, and rejecting reuse prevents an old queued start from reviving a
/// tool that has already closed. The registry lock linearizes start against destroy.
async fn get_or_create_session_for_start(
    state: &ProxyState,
    session_id: &str,
) -> Result<ProxySessionState, String> {
    let mut registry = state.registry.lock().await;
    if registry.destroyed_ids.contains(session_id) {
        return Err("抓包会话已销毁，请使用新的会话 ID".to_string());
    }
    Ok(registry
        .active
        .entry(session_id.to_string())
        .or_insert_with(ProxySessionState::new)
        .clone())
}

async fn get_session(state: &ProxyState, session_id: &str) -> Option<ProxySessionState> {
    state.registry.lock().await.active.get(session_id).cloned()
}

async fn get_session_for_write(
    state: &ProxyState,
    session_id: &str,
) -> Result<ProxySessionState, String> {
    let registry = state.registry.lock().await;
    if let Some(session) = registry.active.get(session_id) {
        return Ok(session.clone());
    }
    if registry.destroyed_ids.contains(session_id) {
        Err("抓包会话已销毁".to_string())
    } else {
        Err("抓包会话不存在，请先启动代理".to_string())
    }
}

/// Atomically tombstone and detach exactly the currently mapped generation. A concurrent caller
/// may create a replacement only after this map operation completes; cleanup retains only the old
/// Arc-backed state and can therefore never stop or erase that replacement.
async fn take_session_for_destroy(
    state: &ProxyState,
    session_id: &str,
) -> Option<ProxySessionState> {
    let mut registry = state.registry.lock().await;
    registry.remember_destroyed(session_id);
    let session = registry.active.remove(session_id);
    if let Some(session) = &session {
        session.destroyed.store(true, Ordering::Release);
    }
    session
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

/// Per-request storage intentionally clears itself when cloned.  hudsucker clones the configured
/// handler once for every request (including multiplexed HTTP/2 requests), then invokes request
/// and response callbacks on that clone.  Sharing this slot through an Arc would therefore let
/// concurrent requests overwrite/take each other's metadata.
#[derive(Default)]
struct RequestPairState {
    current: Option<RequestMeta>,
}

impl Clone for RequestPairState {
    fn clone(&self) -> Self {
        Self::default()
    }
}

struct CaptureHandler {
    app: tauri::AppHandle,
    session_id: String,
    generation: Uuid,
    destroyed: Arc<AtomicBool>,
    lifecycle: Arc<Mutex<ProxyLifecycle>>,
    cancel: CancellationToken,
    entries: Arc<Mutex<RetainedCaptures>>,
    request_pair: RequestPairState,
    breakpoints: Arc<Mutex<Vec<BreakpointRule>>>,
    paused: Arc<Mutex<PausedRequests>>,
}

impl Clone for CaptureHandler {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            session_id: self.session_id.clone(),
            generation: self.generation,
            destroyed: self.destroyed.clone(),
            lifecycle: self.lifecycle.clone(),
            cancel: self.cancel.clone(),
            entries: self.entries.clone(),
            request_pair: self.request_pair.clone(),
            breakpoints: self.breakpoints.clone(),
            paused: self.paused.clone(),
        }
    }
}

impl CaptureHandler {
    fn lifecycle_is_current(&self, lifecycle: &ProxyLifecycle) -> bool {
        !self.destroyed.load(Ordering::Acquire)
            && lifecycle_allows_generation(lifecycle, self.generation, &self.cancel)
    }

    async fn is_current(&self) -> bool {
        let lifecycle = self.lifecycle.lock().await;
        self.lifecycle_is_current(&lifecycle)
    }

    /// Serialize the retained-state update and event against the lifecycle transition.  Once stop
    /// changes Running to Stopping, no handler from that generation can publish into a restarted
    /// session, even if hudsucker's connection task outlives the listener task.
    async fn publish_capture_if_current(&self, mut entry: CapturedEntry) -> bool {
        let lifecycle = self.lifecycle.lock().await;
        if !self.lifecycle_is_current(&lifecycle) {
            return false;
        }

        {
            let mut retained = self.entries.lock().await;
            sequence_and_upsert(&mut retained, &mut entry);
        }
        if let Err(error) = self.app.emit("capture-event", &entry) {
            log::error!("[CAPTURE] emit 失败: {:?}", error);
        }
        true
    }

    async fn install_pause_if_current(
        &self,
        paused_id: String,
        paused: PausedRequest,
        handler_body_bytes: usize,
        tx: oneshot::Sender<Option<ResumeModification>>,
    ) -> PauseInstallResult {
        let lifecycle = self.lifecycle.lock().await;
        if !self.lifecycle_is_current(&lifecycle) {
            return PauseInstallResult::NotCurrent;
        }

        let mut retained = self.paused.lock().await;
        if let Err(error) = try_insert_paused_with_limits(
            &mut retained,
            paused_id.clone(),
            paused,
            handler_body_bytes,
            tx,
            MAX_PAUSED_REQUESTS,
            MAX_PAUSED_CAPTURE_BYTES,
        ) {
            log::warn!(
                "[CAPTURE] 挂起队列达到限制，安全直通请求: session={}, reason={:?}",
                self.session_id,
                error
            );
            return PauseInstallResult::AtCapacity;
        }
        if let Some(slot) = retained.slots.get(&paused_id) {
            if let Err(error) = self.app.emit("capture-breakpoint", &slot.info) {
                log::error!("[CAPTURE] emit breakpoint 失败: {:?}", error);
            }
        }
        PauseInstallResult::Installed
    }

    async fn publish_completed(
        &self,
        meta: RequestMeta,
        status: u16,
        status_text: String,
        response_headers: Vec<(String, String)>,
        response_body: Option<String>,
        response_body_raw: Option<String>,
        content_type: Option<String>,
        response_size: usize,
    ) {
        let entry = CapturedEntry {
            session_id: self.session_id.clone(),
            capture_seq: 0,
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
            response_body,
            request_body_raw: meta.request_body_raw,
            response_body_raw,
            content_type,
            request_content_type: meta.request_content_type,
            request_size: meta.request_body_size,
            response_size,
            duration_ms: meta.start_time.elapsed().as_millis() as u64,
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
        self.publish_capture_if_current(entry).await;
    }
}

fn lifecycle_allows_generation(
    lifecycle: &ProxyLifecycle,
    generation: Uuid,
    cancel: &CancellationToken,
) -> bool {
    matches!(
        lifecycle,
        ProxyLifecycle::Running {
            generation: current,
            ..
        } if *current == generation && !cancel.is_cancelled()
    )
}

const MAX_CAPTURED_ENTRIES: usize = 5000;
const MAX_RETAINED_CAPTURE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CAPTURE_BODY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PAUSED_REQUESTS: usize = 64;
/// Includes the map's displayed copy plus request body/metadata retained by the blocked handler.
const MAX_PAUSED_CAPTURE_BYTES: usize = 32 * 1024 * 1024;
const MAX_DESTROYED_SESSION_TOMBSTONES: usize = 4096;

fn header_contains_token(headers: &http::HeaderMap, name: &str, token: &str) -> bool {
    headers.get_all(name).iter().any(|value| {
        value
            .as_bytes()
            .split(|byte| *byte == b',')
            .any(|value| value.trim_ascii().eq_ignore_ascii_case(token.as_bytes()))
    })
}

fn is_websocket_upgrade(req: &Request<Body>) -> bool {
    header_contains_token(req.headers(), "connection", "upgrade")
        && header_contains_token(req.headers(), "upgrade", "websocket")
}

fn should_buffer_body(body: &Body) -> bool {
    body.size_hint()
        .upper()
        .is_some_and(|upper| upper <= MAX_CAPTURE_BODY_BYTES)
}

fn hinted_body_size(body: &Body) -> usize {
    let hint = body.size_hint();
    usize::try_from(hint.upper().unwrap_or_else(|| hint.lower())).unwrap_or(usize::MAX)
}

fn append_capped_body(buffer: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<(), String> {
    if chunk.len() > limit.saturating_sub(buffer.len()) {
        return Err(format!("响应体超过抓包上限 {} 字节", limit));
    }
    buffer.extend_from_slice(chunk);
    Ok(())
}

fn decode_capped_replay_body(raw: Option<&str>, text: Option<&str>) -> Result<Vec<u8>, String> {
    let limit = MAX_CAPTURE_BODY_BYTES as usize;
    if let Some(raw) = raw {
        // Reject clearly oversized base64 before allocating its decoded buffer.
        let max_encoded_len = limit.div_ceil(3).saturating_mul(4);
        if raw.len() > max_encoded_len {
            return Err(format!("重放请求体超过上限 {} 字节", limit));
        }
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .map_err(|error| format!("解析请求体 base64 失败: {}", error))?;
        if decoded.len() > limit {
            return Err(format!("重放请求体超过上限 {} 字节", limit));
        }
        return Ok(decoded);
    }

    match text {
        Some(text) if text.len() > limit => Err(format!("重放请求体超过上限 {} 字节", limit)),
        Some(text) => Ok(text.as_bytes().to_vec()),
        None => Ok(Vec::new()),
    }
}

fn replace_request_body(headers: &mut http::HeaderMap, new_body: String) -> Bytes {
    let bytes = Bytes::from(new_body.into_bytes());
    headers.remove(CONTENT_LENGTH);
    headers.remove(TRANSFER_ENCODING);
    // A usize always has a valid decimal HeaderValue representation.
    let value = HeaderValue::from_str(&bytes.len().to_string())
        .expect("decimal body length must be a valid header value");
    headers.insert(CONTENT_LENGTH, value);
    bytes
}

fn string_heap_bytes(value: &String) -> usize {
    value.capacity()
}

fn optional_string_heap_bytes(value: &Option<String>) -> usize {
    value.as_ref().map_or(0, string_heap_bytes)
}

fn header_pairs_heap_bytes(headers: &Vec<(String, String)>) -> usize {
    headers
        .iter()
        .map(|(name, value)| string_heap_bytes(name).saturating_add(string_heap_bytes(value)))
        .sum::<usize>()
        .saturating_add(
            headers
                .capacity()
                .saturating_mul(std::mem::size_of::<(String, String)>()),
        )
}

/// Approximate retained heap cost closely: struct storage, every owned string payload, and the
/// heap-resident header tuple arrays. Capacities (rather than lengths) account for spare allocated
/// space. This intentionally counts text and base64 previews separately because both are retained
/// allocations.
fn captured_entry_bytes(entry: &CapturedEntry) -> usize {
    std::mem::size_of::<CapturedEntry>()
        .saturating_add(string_heap_bytes(&entry.session_id))
        .saturating_add(string_heap_bytes(&entry.id))
        .saturating_add(string_heap_bytes(&entry.method))
        .saturating_add(string_heap_bytes(&entry.url))
        .saturating_add(string_heap_bytes(&entry.host))
        .saturating_add(string_heap_bytes(&entry.path))
        .saturating_add(optional_string_heap_bytes(&entry.status_text))
        .saturating_add(header_pairs_heap_bytes(&entry.request_headers))
        .saturating_add(header_pairs_heap_bytes(&entry.response_headers))
        .saturating_add(optional_string_heap_bytes(&entry.request_body))
        .saturating_add(optional_string_heap_bytes(&entry.response_body))
        .saturating_add(optional_string_heap_bytes(&entry.request_body_raw))
        .saturating_add(optional_string_heap_bytes(&entry.response_body_raw))
        .saturating_add(optional_string_heap_bytes(&entry.content_type))
        .saturating_add(optional_string_heap_bytes(&entry.request_content_type))
        .saturating_add(string_heap_bytes(&entry.timestamp))
        .saturating_add(optional_string_heap_bytes(&entry.http_version))
}

/// Charge both the data retained in the paused map and the request data kept alive in the
/// blocked handler for up to five minutes. Header pairs and routing strings exist in both places;
/// a buffered body exists as raw Bytes in the handler and, for UTF-8, as a displayed String in
/// the map.
fn paused_request_charged_bytes(info: &PausedRequest, handler_body_bytes: usize) -> usize {
    let displayed = std::mem::size_of::<(String, PausedSlot)>()
        // The HashMap key duplicates paused request id.
        .saturating_add(string_heap_bytes(&info.id))
        .saturating_add(string_heap_bytes(&info.session_id))
        .saturating_add(string_heap_bytes(&info.id))
        .saturating_add(string_heap_bytes(&info.method))
        .saturating_add(string_heap_bytes(&info.url))
        .saturating_add(string_heap_bytes(&info.host))
        .saturating_add(string_heap_bytes(&info.path))
        .saturating_add(header_pairs_heap_bytes(&info.request_headers))
        .saturating_add(optional_string_heap_bytes(&info.request_body))
        .saturating_add(string_heap_bytes(&info.timestamp));

    let blocked_handler = string_heap_bytes(&info.id)
        .saturating_add(string_heap_bytes(&info.method))
        .saturating_add(string_heap_bytes(&info.url))
        .saturating_add(string_heap_bytes(&info.host))
        .saturating_add(string_heap_bytes(&info.path))
        // Approximate the handler's HeaderMap using the display clone retained in PausedRequest.
        .saturating_add(header_pairs_heap_bytes(&info.request_headers))
        .saturating_add(handler_body_bytes);

    displayed.saturating_add(blocked_handler)
}

fn try_insert_paused_with_limits(
    retained: &mut PausedRequests,
    paused_id: String,
    info: PausedRequest,
    handler_body_bytes: usize,
    tx: oneshot::Sender<Option<ResumeModification>>,
    max_count: usize,
    max_bytes: usize,
) -> Result<(), PausedInsertError> {
    if retained.slots.contains_key(&paused_id) {
        return Err(PausedInsertError::Duplicate);
    }
    if retained.slots.len() >= max_count {
        return Err(PausedInsertError::CountLimit);
    }
    let charged_bytes = paused_request_charged_bytes(&info, handler_body_bytes);
    if charged_bytes > max_bytes.saturating_sub(retained.total_bytes) {
        return Err(PausedInsertError::ByteLimit);
    }

    retained.total_bytes = retained.total_bytes.saturating_add(charged_bytes);
    retained.slots.insert(
        paused_id,
        PausedSlot {
            info,
            tx,
            charged_bytes,
        },
    );
    Ok(())
}

fn remove_paused(retained: &mut PausedRequests, paused_id: &str) -> Option<PausedSlot> {
    let slot = retained.slots.remove(paused_id)?;
    retained.total_bytes = retained.total_bytes.saturating_sub(slot.charged_bytes);
    Some(slot)
}

fn drain_paused(retained: &mut PausedRequests) -> HashMap<String, PausedSlot> {
    retained.total_bytes = 0;
    std::mem::take(&mut retained.slots)
}

fn evict_retained_to_limits(retained: &mut RetainedCaptures, max_count: usize, max_bytes: usize) {
    while retained.entries.len() > max_count || retained.total_bytes > max_bytes {
        let Some(oldest) = retained.entries.pop_front() else {
            retained.total_bytes = 0;
            break;
        };
        retained.total_bytes = retained
            .total_bytes
            .saturating_sub(captured_entry_bytes(&oldest));
    }
}

/// Insert a new pending entry or replace the retained version of an existing request. Retained
/// state is always updated before its corresponding event is published and bounded by count and
/// aggregate heap budget.
fn upsert_retained_entry_with_limits(
    retained: &mut RetainedCaptures,
    entry: CapturedEntry,
    max_count: usize,
    max_bytes: usize,
) {
    let new_size = captured_entry_bytes(&entry);
    if let Some(index) = retained
        .entries
        .iter()
        .position(|existing| existing.id == entry.id)
    {
        let old_size = captured_entry_bytes(&retained.entries[index]);
        retained.total_bytes = retained.total_bytes.saturating_sub(old_size);
        retained.entries[index] = entry;
    } else {
        retained.entries.push_back(entry);
    }
    retained.total_bytes = retained.total_bytes.saturating_add(new_size);
    evict_retained_to_limits(retained, max_count, max_bytes);
}

fn upsert_retained_entry(retained: &mut RetainedCaptures, entry: CapturedEntry) {
    upsert_retained_entry_with_limits(
        retained,
        entry,
        MAX_CAPTURED_ENTRIES,
        MAX_RETAINED_CAPTURE_BYTES,
    );
}

fn sequence_and_upsert(retained: &mut RetainedCaptures, entry: &mut CapturedEntry) {
    retained.last_sequence = retained.last_sequence.saturating_add(1);
    entry.capture_seq = retained.last_sequence;
    upsert_retained_entry(retained, entry.clone());
}

fn clear_retained(retained: &mut RetainedCaptures) -> u64 {
    // Replacing the deque also releases its backing allocation instead of retaining capacity for
    // thousands of cleared entries.
    retained.entries = VecDeque::new();
    retained.total_bytes = 0;
    retained.last_sequence
}

fn paused_removal_payload(
    session_id: &str,
    request_id: String,
    reason: PausedRemovalReason,
) -> PausedRemoval {
    PausedRemoval {
        session_id: session_id.to_string(),
        request_id,
        reason,
    }
}

fn emit_paused_removal<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    session_id: &str,
    request_id: String,
    reason: PausedRemovalReason,
) {
    let payload = paused_removal_payload(session_id, request_id, reason);
    if let Err(error) = app.emit("capture:paused-removed", payload) {
        log::error!("[CAPTURE] emit paused removal 失败: {:?}", error);
    }
}

async fn finalize_pending_entries_on_stop(app: &tauri::AppHandle, session: &ProxySessionState) {
    let completed = {
        let mut retained = session.entries.lock().await;
        finalize_pending_retained(&mut retained)
    };

    for entry in completed {
        if let Err(error) = app.emit("capture-event", &entry) {
            log::error!("[CAPTURE] emit stopped entry 失败: {:?}", error);
        }
    }
}

fn finalize_pending_retained(retained: &mut RetainedCaptures) -> Vec<CapturedEntry> {
    let mut completed = Vec::new();
    for index in 0..retained.entries.len() {
        if retained.entries[index].completed {
            continue;
        }
        retained.last_sequence = retained.last_sequence.saturating_add(1);
        let sequence = retained.last_sequence;
        let entry = &mut retained.entries[index];
        entry.capture_seq = sequence;
        entry.status = Some(499);
        entry.status_text = Some("Proxy Stopped".to_string());
        entry.completed = true;
        completed.push(entry.clone());
    }
    retained.total_bytes = retained.entries.iter().map(captured_entry_bytes).sum();
    evict_retained_to_limits(retained, MAX_CAPTURED_ENTRIES, MAX_RETAINED_CAPTURE_BYTES);
    completed
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

        // CONNECT and WebSocket upgrades do not have a matching handle_response callback in
        // hudsucker's routing path, so capturing either would retain a pending row forever.
        if method == "CONNECT" {
            log::info!("[CAPTURE] CONNECT 隧道请求，跳过捕获: {}", url);
            return req.into();
        }
        if is_websocket_upgrade(&req) {
            log::info!("[CAPTURE] WebSocket upgrade 请求，跳过 HTTP 捕获: {}", url);
            return req.into();
        }
        if !self.is_current().await {
            return req.into();
        }

        let mut host = extract_host(&url);
        let mut path = extract_path(&url);
        let http_version = format!("{:?}", req.version());
        let entry_id = uuid::Uuid::new_v4().to_string();

        // Only buffer when Body's authoritative upper bound fits the capture budget.  Large or
        // unknown/chunked bodies remain streaming and are forwarded untouched.
        let (mut parts, body) = req.into_parts();
        let hinted_size = hinted_body_size(&body);
        let (mut body_bytes, mut streaming_body) = if should_buffer_body(&body) {
            match body.collect().await {
                Ok(collected) => (Some(collected.to_bytes()), None),
                Err(error) => {
                    log::warn!("[CAPTURE] 读取请求体失败，转发空体: {}", error);
                    // The failed stream has already been consumed and cannot be reconstructed.
                    // Clear framing so an empty fallback cannot carry a stale CL/TE pair.
                    parts.headers.remove(CONTENT_LENGTH);
                    parts.headers.remove(TRANSFER_ENCODING);
                    (Some(Bytes::new()), None)
                }
            }
        } else {
            (None, Some(body))
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
                request_body: body_bytes
                    .as_ref()
                    .and_then(|bytes| String::from_utf8(bytes.to_vec()).ok()),
                timestamp: now_iso(),
            };

            let handler_body_bytes = body_bytes.as_ref().map_or(0, Bytes::len);
            if self
                .install_pause_if_current(paused_id.clone(), paused, handler_body_bytes, tx)
                .await
                != PauseInstallResult::Installed
            {
                let forwarded_body = match (body_bytes, streaming_body) {
                    (Some(bytes), _) => Body::from(Full::new(bytes)),
                    (None, Some(body)) => body,
                    (None, None) => Body::empty(),
                };
                return Request::from_parts(parts, forwarded_body).into();
            }
            log::info!(
                "[CAPTURE] 请求命中断点，已挂起: id={}, {} {}",
                paused_id,
                method,
                url
            );

            // 阻塞当前请求直到收到放行信号（其它连接在各自任务中并行处理，不受影响）。
            // 5 分钟超时兜底：避免被遗忘的挂起请求长期占用浏览器连接。
            // Ok(Ok(m)) 收到放行(可能带修改)；Ok(Err) 通道被关闭；Err 超时 —— 后两者按原样放行。
            let (modification, removal_reason) = tokio::select! {
                biased;
                _ = self.cancel.cancelled() => (None, Some(PausedRemovalReason::Stopped)),
                result = tokio::time::timeout(std::time::Duration::from_secs(300), rx) => {
                    match result {
                    Ok(Ok(m)) => (m, None),
                    Ok(Err(_)) => (None, Some(PausedRemovalReason::Disconnected)),
                    Err(_) => {
                        log::warn!("[CAPTURE] 断点挂起超时，自动放行: id={}", paused_id);
                        (None, Some(PausedRemovalReason::Timeout))
                    }
                    }
                }
            };

            // 清理挂起状态（resume/stop 可能已移除，remove 幂等）
            {
                let mut retained = self.paused.lock().await;
                remove_paused(&mut retained, &paused_id);
            }
            if let Some(reason) = removal_reason {
                emit_paused_removal(&self.app, &self.session_id, paused_id.clone(), reason);
            }

            if let Some(m) = modification {
                if let Some(new_method) = m.method {
                    if let Ok(parsed) = http::Method::from_bytes(new_method.as_bytes()) {
                        parts.method = parsed;
                        method = new_method;
                    } else {
                        log::warn!("[CAPTURE] 忽略无效断点 method 修改: {}", new_method);
                    }
                }
                if let Some(new_url) = m.url {
                    if let Ok(uri) = new_url.parse::<Uri>() {
                        parts.uri = uri;
                        host = extract_host(&new_url);
                        path = extract_path(&new_url);
                        url = new_url;
                    } else {
                        log::warn!("[CAPTURE] 忽略无效断点 URL 修改: {}", new_url);
                    }
                }
                if let Some(new_headers) = m.headers {
                    parts.headers = vec_to_headers(&new_headers);
                }
                if let Some(new_body) = m.body {
                    let bytes = replace_request_body(&mut parts.headers, new_body);
                    streaming_body = None;
                    body_bytes = Some(bytes);
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

        let req_body_size = body_bytes.as_ref().map_or(hinted_size, |bytes| bytes.len());
        let (req_body_text, req_body_raw) = match body_bytes.as_ref() {
            Some(bytes) if !bytes.is_empty() && bytes.len() as u64 <= MAX_CAPTURE_BODY_BYTES => (
                String::from_utf8(bytes.to_vec()).ok(),
                Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            ),
            _ => (None, None),
        };

        let forwarded_body = match (body_bytes, streaming_body) {
            (Some(bytes), _) => Body::from(Full::new(bytes)),
            (None, Some(body)) => body,
            (None, None) => Body::empty(),
        };
        let new_req = Request::from_parts(parts, forwarded_body);

        // 先推送"请求进行中"状态给前端
        let pending_entry = CapturedEntry {
            session_id: self.session_id.clone(),
            capture_seq: 0,
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
        let published = self.publish_capture_if_current(pending_entry).await;

        // 存入当前实例的 request 元数据
        if published {
            self.request_pair.current = Some(RequestMeta {
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
            });
        }

        new_req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        // A stopped/older generation must transparently pass through any response from a
        // hudsucker connection task that survived listener shutdown.
        if self.request_pair.current.is_none() || !self.is_current().await {
            self.request_pair.current = None;
            return res;
        }

        let status = res.status().as_u16();
        let status_text = res.status().canonical_reason().unwrap_or("").to_string();

        // Buffer only responses with an authoritative bounded upper size.  Unknown or large
        // responses retain their original streaming body and only expose the size hint.
        let (res_body_text, res_body_raw, response_size, new_res) = {
            let (mut parts, body) = res.into_parts();
            let hinted_size = hinted_body_size(&body);
            if should_buffer_body(&body) {
                match body.collect().await {
                    Ok(collected) => {
                        let bytes = collected.to_bytes();
                        let size = bytes.len();
                        let raw_b64 = (!bytes.is_empty())
                            .then(|| base64::engine::general_purpose::STANDARD.encode(&bytes));
                        let text = (!bytes.is_empty())
                            .then(|| String::from_utf8(bytes.to_vec()).ok())
                            .flatten();
                        let new_body = Body::from(Full::new(bytes));
                        (text, raw_b64, size, Response::from_parts(parts, new_body))
                    }
                    Err(error) => {
                        log::warn!("[CAPTURE] 读取响应体失败，转发空体: {}", error);
                        parts.headers.remove(CONTENT_LENGTH);
                        parts.headers.remove(TRANSFER_ENCODING);
                        (
                            None,
                            None,
                            0,
                            Response::from_parts(parts, Body::from(Empty::new())),
                        )
                    }
                }
            } else {
                (None, None, hinted_size, Response::from_parts(parts, body))
            }
        };

        let response_headers = headers_to_vec(new_res.headers());
        let content_type = new_res
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        // 取出当前实例的请求元数据
        let meta_opt = self.request_pair.current.take();

        if let Some(meta) = meta_opt {
            self.publish_completed(
                meta,
                status,
                status_text,
                response_headers,
                res_body_text,
                res_body_raw,
                content_type,
                response_size,
            )
            .await;
        }

        new_res
    }

    async fn handle_error(
        &mut self,
        _ctx: &HttpContext,
        error: hyper_util::client::legacy::Error,
    ) -> Response<Body> {
        log::error!("[CAPTURE] 转发请求失败: {}", error);
        if let Some(meta) = self.request_pair.current.take() {
            self.publish_completed(
                meta,
                http::StatusCode::BAD_GATEWAY.as_u16(),
                "Bad Gateway".to_string(),
                Vec::new(),
                None,
                None,
                None,
                0,
            )
            .await;
        }

        Response::builder()
            .status(http::StatusCode::BAD_GATEWAY)
            .body(Body::empty())
            .expect("static 502 response must be valid")
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

static CA_FILE_LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

fn validate_ca_pair(cert_pem: &str, key_pem: &str) -> Result<(), String> {
    let key_pair =
        KeyPair::from_pem(key_pem).map_err(|error| format!("解析 CA 私钥失败: {}", error))?;
    let (_, pem) = x509_parser::pem::parse_x509_pem(cert_pem.as_bytes())
        .map_err(|error| format!("解析 CA 证书 PEM 失败: {}", error))?;
    let (_, certificate) = x509_parser::parse_x509_certificate(&pem.contents)
        .map_err(|error| format!("解析 CA X.509 证书失败: {}", error))?;
    if !certificate.is_ca() {
        return Err("CA 证书缺少有效的 CA BasicConstraints".to_string());
    }
    certificate
        .verify_signature(None)
        .map_err(|error| format!("CA 自签名校验失败: {}", error))?;
    if certificate.public_key().subject_public_key.data.as_ref() != key_pair.public_key_raw() {
        return Err("CA 证书与私钥不匹配".to_string());
    }
    Ok(())
}

struct TempCaFiles {
    cert: PathBuf,
    key: PathBuf,
}

impl Drop for TempCaFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.cert);
        let _ = std::fs::remove_file(&self.key);
    }
}

fn write_secure_temp(path: &std::path::Path, contents: &str) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("创建 CA 临时文件失败 {:?}: {}", path, error))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("写入 CA 临时文件失败 {:?}: {}", path, error))?;
    file.sync_all()
        .map_err(|error| format!("同步 CA 临时文件失败 {:?}: {}", path, error))?;
    lock_down_private_key(path)
}

/// 获取或生成 CA 证书，返回 (cert_pem, key_pem, cert_path)
fn get_or_create_ca(app_data_dir: &PathBuf) -> Result<(String, String, PathBuf), String> {
    let _guard = CA_FILE_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .map_err(|_| "CA 文件锁已损坏".to_string())?;
    let ca_dir = app_data_dir.join("proxy-ca");
    let cert_path = ca_dir.join("protoforge-ca.crt");
    let key_path = ca_dir.join("protoforge-ca.key");

    match (cert_path.exists(), key_path.exists()) {
        (true, false) | (false, true) => {
            return Err("CA 文件不完整：证书与私钥必须同时存在".to_string());
        }
        (true, true) => {
            // Ensure a legacy key is secured before reading it, then reject corrupt/mismatched
            // pairs rather than silently creating an unusable MITM authority.
            lock_down_private_key(&key_path)?;
            let cert_pem = std::fs::read_to_string(&cert_path)
                .map_err(|e| format!("读取 CA 证书失败: {}", e))?;
            let key_pem = std::fs::read_to_string(&key_path)
                .map_err(|e| format!("读取 CA 私钥失败: {}", e))?;
            validate_ca_pair(&cert_pem, &key_pem)?;
            return Ok((cert_pem, key_pem, cert_path));
        }
        (false, false) => {}
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
    validate_ca_pair(&cert_pem, &key_pem)?;

    let nonce = Uuid::new_v4();
    let temp = TempCaFiles {
        cert: ca_dir.join(format!(".protoforge-ca-{nonce}.crt.tmp")),
        key: ca_dir.join(format!(".protoforge-ca-{nonce}.key.tmp")),
    };
    write_secure_temp(&temp.cert, &cert_pem)?;
    write_secure_temp(&temp.key, &key_pem)?;

    // Validate the bytes actually persisted before either final path becomes visible.
    let persisted_cert = std::fs::read_to_string(&temp.cert)
        .map_err(|error| format!("回读 CA 临时证书失败: {}", error))?;
    let persisted_key = std::fs::read_to_string(&temp.key)
        .map_err(|error| format!("回读 CA 临时私钥失败: {}", error))?;
    validate_ca_pair(&persisted_cert, &persisted_key)?;

    std::fs::rename(&temp.cert, &cert_path)
        .map_err(|error| format!("发布 CA 证书失败: {}", error))?;
    if let Err(error) = std::fs::rename(&temp.key, &key_path) {
        let rollback = std::fs::remove_file(&cert_path);
        return Err(match rollback {
            Ok(()) => format!("发布 CA 私钥失败（证书已回滚）: {}", error),
            Err(rollback_error) => format!(
                "发布 CA 私钥失败且证书回滚失败: {}; {}",
                error, rollback_error
            ),
        });
    }
    lock_down_private_key(&key_path)?;

    log::info!("已生成新的 CA 证书: {:?}", cert_path);

    Ok((cert_pem, key_pem, cert_path))
}

/// 限制私钥文件权限，仅允许当前用户访问。
/// - Windows: 通过 icacls 移除继承权限并仅授权当前用户完全控制
/// - Unix: chmod 0600
fn lock_down_private_key(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // icacls <path> /inheritance:r   — 移除所有继承的 ACE
        // icacls <path> /grant:r "%USERNAME%:(F)" — 仅当前用户完全控制
        let path_str = path.to_string_lossy();
        let username = std::env::var("USERNAME").unwrap_or_default();
        if username.is_empty() {
            return Err("无法获取 USERNAME，不能安全设置 CA 私钥 ACL".to_string());
        }

        let remove_inherit = std::process::Command::new("icacls")
            .args([path_str.as_ref(), "/inheritance:r"])
            .output()
            .map_err(|error| format!("icacls 移除继承权限失败: {}", error))?;
        if !remove_inherit.status.success() {
            return Err(format!(
                "icacls 移除继承权限失败: {}",
                String::from_utf8_lossy(&remove_inherit.stderr)
            ));
        }

        let grant_user = std::process::Command::new("icacls")
            .args([path_str.as_ref(), "/grant:r", &format!("{}:(F)", username)])
            .output()
            .map_err(|error| format!("icacls 授权失败: {}", error))?;
        if !grant_user.status.success() {
            return Err(format!(
                "icacls 授权失败: {}",
                String::from_utf8_lossy(&grant_user.stderr)
            ));
        }
        log::info!("[CAPTURE] 已限制私钥文件权限: 仅用户 {} 可访问", username);
        Ok(())
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("设置 CA 私钥权限 0600 失败: {}", error))?;
        log::info!("[CAPTURE] 已限制私钥文件权限: 0600");
        Ok(())
    }

    #[cfg(not(any(unix, target_os = "windows")))]
    {
        Ok(())
    }
}

// ═══════════════════════════════════════════
//  代理生命周期
// ═══════════════════════════════════════════

async fn bind_proxy_listener(
    addr: SocketAddr,
    cancel: &CancellationToken,
) -> Result<tokio::net::TcpListener, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("代理启动已取消".to_string()),
        result = tokio::net::TcpListener::bind(addr) => {
            result.map_err(|error| format!("绑定代理端口失败: {}", error))
        }
    }
}

/// 启动 MITM 代理
pub async fn start_proxy(
    app: tauri::AppHandle,
    state: &ProxyState,
    session_id: &str,
    port: u16,
    app_data_dir: PathBuf,
) -> Result<(), String> {
    let session = get_or_create_session_for_start(state, session_id).await?;
    let (generation, start_cancel, start_finished) = session.reserve_start().await?;

    // 获取或生成 CA 证书
    let (cert_pem, key_pem, cert_path) = match get_or_create_ca(&app_data_dir) {
        Ok(ca) => ca,
        Err(error) => {
            session.fail_start(generation).await;
            return Err(error);
        }
    };

    if start_cancel.is_cancelled() {
        session.fail_start(generation).await;
        return Err("代理启动已取消".to_string());
    }

    // 保存证书路径
    *state.ca_cert_path.lock().await = Some(cert_path);

    // 创建 RcgenAuthority
    let key_pair = match KeyPair::from_pem(&key_pem) {
        Ok(key_pair) => key_pair,
        Err(error) => {
            session.fail_start(generation).await;
            return Err(format!("解析 CA 私钥失败: {}", error));
        }
    };
    let issuer = match Issuer::from_ca_cert_pem(&cert_pem, key_pair) {
        Ok(issuer) => issuer,
        Err(error) => {
            session.fail_start(generation).await;
            return Err(format!("解析 CA 证书失败: {}", error));
        }
    };
    let ca = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());
    let run_cancel = CancellationToken::new();

    let handler = CaptureHandler {
        app: app.clone(),
        session_id: session_id.to_string(),
        generation,
        destroyed: session.destroyed.clone(),
        lifecycle: session.lifecycle.clone(),
        cancel: run_cancel.clone(),
        entries: session.entries.clone(),
        request_pair: RequestPairState::default(),
        breakpoints: session.breakpoints.clone(),
        paused: session.paused.clone(),
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Bind before constructing/spawning the proxy so success means the requested port is already
    // exclusively owned.  `Proxy::start` otherwise performs the bind inside the detached task and
    // start_proxy would report a false success for an occupied port.
    let listener = match bind_proxy_listener(addr, &start_cancel).await {
        Ok(listener) => listener,
        Err(error) => {
            session.fail_start(generation).await;
            return Err(error);
        }
    };

    let proxy = Proxy::builder()
        .with_listener(listener)
        .with_ca(ca)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler)
        .with_graceful_shutdown(run_cancel.clone().cancelled_owned())
        .build()
        .map_err(|e| format!("创建代理失败: {}", e));
    let proxy = match proxy {
        Ok(proxy) => proxy,
        Err(error) => {
            session.fail_start(generation).await;
            return Err(error);
        }
    };

    // Do not let the detached task enter Proxy::start until its AbortHandle is atomically installed
    // as Running.  A concurrent stop of Starting cancels the reservation and this task instead.
    let (run_tx, run_rx) = oneshot::channel::<()>();
    let lifecycle = session.lifecycle.clone();
    let task_finished = CancellationToken::new();
    let task_finished_guard = task_finished.clone();
    let stop_finished = CancellationToken::new();
    let natural_stop_finished = stop_finished.clone();

    let task = tokio::spawn(async move {
        let _completion = TaskCompletionSignal(task_finished_guard);
        if run_rx.await.is_err() {
            return;
        }
        log::info!("代理服务器启动在 127.0.0.1:{}", port);
        if let Err(e) = proxy.start().await {
            log::error!("代理服务器错误: {}", e);
        }
        let mut lifecycle = lifecycle.lock().await;
        let was_current = matches!(
            &*lifecycle,
            ProxyLifecycle::Running {
                generation: current,
                ..
            } if *current == generation
        );
        if was_current {
            *lifecycle = ProxyLifecycle::Stopped;
        }
        drop(lifecycle);
        if was_current {
            natural_stop_finished.cancel();
        }
        log::info!("代理服务器已停止");
    });

    let abort_handle = task.abort_handle();
    {
        // Keep the reported port and Running transition consistent for status readers.
        let mut stored_port = session.port.lock().await;
        let mut lifecycle = session.lifecycle.lock().await;
        let still_current = matches!(
            &*lifecycle,
            ProxyLifecycle::Starting {
                generation: current,
                cancel,
                ..
            } if *current == generation && !cancel.is_cancelled()
        );
        if !still_current {
            drop(lifecycle);
            drop(stored_port);
            task.abort();
            let _ = task.await;
            // A stop can cancel Starting after the listener has bound but
            // before this Running commit. Release the reservation only after
            // the listener task has been reaped; otherwise the session would
            // remain stuck in a cancelled Starting state forever.
            session.fail_start(generation).await;
            return Err("代理启动已取消".to_string());
        }

        *stored_port = port;
        *lifecycle = ProxyLifecycle::Running {
            generation,
            cancel: run_cancel,
            abort_handle,
            task_finished: task_finished.clone(),
            stop_finished,
        };
    }
    start_finished.cancel();

    if run_tx.send(()).is_err() {
        match session.cancel_server().await {
            ProxyStopAction::AbortRunning {
                generation,
                abort_handle,
                task_finished,
                ..
            } => {
                abort_handle.abort();
                task_finished.cancelled().await;
                session.finish_stop(generation).await;
            }
            ProxyStopAction::WaitForStopping(finished) => finished.cancelled().await,
            ProxyStopAction::None | ProxyStopAction::WaitForStarting(_) => {}
        }
        return Err("代理任务启动失败".to_string());
    }

    Ok(())
}

async fn complete_running_stop(
    app: tauri::AppHandle,
    session: ProxySessionState,
    session_id: String,
    generation: Uuid,
    abort_handle: tokio::task::AbortHandle,
    task_finished: CancellationToken,
) {
    // Release all breakpoint waits before awaiting hudsucker's connection tasks.
    release_paused_requests(&app, &session, &session_id, PausedRemovalReason::Stopped).await;
    finalize_pending_entries_on_stop(&app, &session).await;

    // The lifecycle transition already cancelled hudsucker's graceful-shutdown token.  Let it
    // stop accepting and wind down connection tasks, but bound the wait so a wedged upstream
    // cannot make the stop command hang forever.  Generation gates make any fallback-surviving
    // connection task read-only with respect to this session.
    if tokio::time::timeout(std::time::Duration::from_secs(5), task_finished.cancelled())
        .await
        .is_err()
    {
        log::warn!("[CAPTURE] 代理优雅停止超时，强制终止 listener task");
        abort_handle.abort();
        task_finished.cancelled().await;
    }
    session.finish_stop(generation).await;
    log::info!("代理服务器已停止");
}

async fn release_paused_requests(
    app: &tauri::AppHandle,
    session: &ProxySessionState,
    session_id: &str,
    reason: PausedRemovalReason,
) {
    let paused = {
        let mut retained = session.paused.lock().await;
        drain_paused(&mut retained)
    };
    for (_, slot) in paused {
        let request_id = slot.info.id.clone();
        let _ = slot.tx.send(None);
        emit_paused_removal(app, session_id, request_id, reason);
    }
}

async fn stop_session_state(
    app: &tauri::AppHandle,
    session: ProxySessionState,
    session_id: &str,
) -> Result<(), String> {
    match session.cancel_server().await {
        ProxyStopAction::None => Ok(()),
        ProxyStopAction::WaitForStarting(finished) => {
            finished.cancelled().await;
            Ok(())
        }
        ProxyStopAction::WaitForStopping(finished) => {
            finished.cancelled().await;
            Ok(())
        }
        ProxyStopAction::AbortRunning {
            generation,
            abort_handle,
            task_finished,
            stop_finished,
        } => {
            let completion = stop_finished.clone();
            tokio::spawn(complete_running_stop(
                app.clone(),
                session,
                session_id.to_string(),
                generation,
                abort_handle,
                task_finished,
            ));
            completion.cancelled().await;
            Ok(())
        }
    }
}

/// 停止代理
pub async fn stop_proxy(
    app: &tauri::AppHandle,
    state: &ProxyState,
    session_id: &str,
) -> Result<(), String> {
    let Some(session) = get_session(state, session_id).await else {
        return Ok(());
    };
    stop_session_state(app, session, session_id).await
}

/// Permanently release one mapped capture session. Normal stop intentionally retains history;
/// destroy is reserved for tool-tab closure and drops the old generation's retained resources.
pub async fn destroy_session(
    app: &tauri::AppHandle,
    state: &ProxyState,
    session_id: &str,
) -> Result<(), String> {
    let Some(session) = take_session_for_destroy(state, session_id).await else {
        return Ok(());
    };

    stop_session_state(app, session.clone(), session_id).await?;
    // A stopped session can still contain stale paused slots from an earlier failure; make destroy
    // idempotently release them before dropping the final state owned by this function.
    release_paused_requests(app, &session, session_id, PausedRemovalReason::Destroyed).await;
    {
        let mut retained = session.entries.lock().await;
        clear_retained(&mut retained);
    }
    session.breakpoints.lock().await.clear();
    Ok(())
}

/// 获取代理状态
pub async fn get_status(state: &ProxyState, session_id: &str) -> ProxyStatusInfo {
    let Some(session) = get_session(state, session_id).await else {
        return ProxyStatusInfo {
            session_id: session_id.to_string(),
            running: false,
            port: 9090,
            entry_count: 0,
        };
    };
    let entry_count = session.entries.lock().await.entries.len();
    let port = *session.port.lock().await;

    ProxyStatusInfo {
        session_id: session_id.to_string(),
        running: session.is_running().await,
        port,
        entry_count,
    }
}

/// 获取所有已捕获条目
pub async fn get_entries(state: &ProxyState, session_id: &str) -> Vec<CapturedEntry> {
    let Some(session) = get_session(state, session_id).await else {
        return Vec::new();
    };

    session
        .entries
        .lock()
        .await
        .entries
        .iter()
        .cloned()
        .collect()
}

/// Clear retained entries and return the last sequence linearized before the clear.  Events with a
/// sequence at or below this fence may still be queued in Tauri, but the frontend can reject them.
pub async fn clear_entries(state: &ProxyState, session_id: &str) -> Result<u64, String> {
    let session = get_session_for_write(state, session_id).await?;
    let mut retained = session.entries.lock().await;
    if session.destroyed.load(Ordering::Acquire) {
        return Err("抓包会话已销毁".to_string());
    }
    Ok(clear_retained(&mut retained))
}

// ═══════════════════════════════════════════
//  断点 / 重放
// ═══════════════════════════════════════════

/// 设置断点规则（整组替换）；可在代理运行中实时调整
pub async fn set_breakpoints(
    state: &ProxyState,
    session_id: &str,
    patterns: Vec<BreakpointRule>,
) -> Result<(), String> {
    let session = get_session_for_write(state, session_id).await?;
    let mut breakpoints = session.breakpoints.lock().await;
    if session.destroyed.load(Ordering::Acquire) {
        return Err("抓包会话已销毁".to_string());
    }
    *breakpoints = patterns;
    Ok(())
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
            .slots
            .values()
            .map(|slot| slot.info.clone())
            .collect(),
        None => Vec::new(),
    }
}

/// 放行一个被挂起的请求；modified 为 Some 时按修改内容转发
pub async fn resume<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &ProxyState,
    session_id: &str,
    paused_id: &str,
    modified: Option<ResumeModification>,
) -> Result<(), String> {
    let session = get_session_for_write(state, session_id).await?;
    let slot = {
        let mut retained = session.paused.lock().await;
        remove_paused(&mut retained, paused_id)
    };
    match slot {
        Some(slot) => {
            if slot.tx.send(modified).is_err() {
                emit_paused_removal(
                    app,
                    session_id,
                    paused_id.to_string(),
                    PausedRemovalReason::Disconnected,
                );
                return Err("请求已断开，无法放行".to_string());
            }
            emit_paused_removal(
                app,
                session_id,
                paused_id.to_string(),
                PausedRemovalReason::Resumed,
            );
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
    let session = get_session_for_write(state, session_id).await?;
    if session.destroyed.load(Ordering::Acquire) {
        return Err("抓包会话已销毁".to_string());
    }

    let original = {
        let retained = session.entries.lock().await;
        retained
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .cloned()
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
    let body_bytes = decode_capped_replay_body(
        original.request_body_raw.as_deref(),
        original.request_body.as_deref(),
    )?;
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

    let response_limit = MAX_CAPTURE_BODY_BYTES as usize;
    if resp
        .content_length()
        .is_some_and(|length| length > MAX_CAPTURE_BODY_BYTES)
    {
        return Err(format!("重放响应体超过抓包上限 {} 字节", response_limit));
    }
    let mut response_stream = resp.bytes_stream();
    let mut resp_bytes = Vec::new();
    while let Some(chunk) = response_stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取响应失败: {}", error))?;
        append_capped_body(&mut resp_bytes, &chunk, response_limit)
            .map_err(|_| format!("重放响应体超过抓包上限 {} 字节", response_limit))?;
    }
    let duration_ms = start.elapsed().as_millis() as u64;
    let response_size = resp_bytes.len();
    let (response_body, response_body_raw) = if response_size > 0 {
        (
            String::from_utf8(resp_bytes.clone()).ok(),
            Some(base64::engine::general_purpose::STANDARD.encode(&resp_bytes)),
        )
    } else {
        (None, None)
    };

    let req_size = body_bytes.len();
    let (req_body_text, req_body_raw) = if req_size > 0 {
        (
            String::from_utf8(body_bytes.clone()).ok(),
            Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)),
        )
    } else {
        (None, None)
    };

    let mut entry = CapturedEntry {
        session_id: session_id.to_string(),
        capture_seq: 0,
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

    {
        let mut retained = session.entries.lock().await;
        if session.destroyed.load(Ordering::Acquire) {
            return Err("抓包会话已销毁".to_string());
        }
        sequence_and_upsert(&mut retained, &mut entry);
    }

    if session.destroyed.load(Ordering::Acquire) {
        return Err("抓包会话已销毁".to_string());
    }
    if let Err(e) = app.emit("capture-event", &entry) {
        log::error!("[CAPTURE] emit replay entry 失败: {:?}", e);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::Barrier as ThreadBarrier;
    use std::time::Instant;
    use tokio::sync::Barrier;

    fn request_meta(id: &str) -> RequestMeta {
        RequestMeta {
            id: id.to_string(),
            method: "GET".to_string(),
            url: format!("http://example.test/{id}"),
            host: "example.test".to_string(),
            path: format!("/{id}"),
            request_headers: Vec::new(),
            request_body_text: None,
            request_body_raw: None,
            request_content_type: None,
            request_body_size: 0,
            start_time: Instant::now(),
            http_version: "HTTP/1.1".to_string(),
        }
    }

    fn captured_entry(id: &str, completed: bool) -> CapturedEntry {
        CapturedEntry {
            session_id: "session".to_string(),
            capture_seq: 0,
            id: id.to_string(),
            method: "GET".to_string(),
            url: format!("http://example.test/{id}"),
            host: "example.test".to_string(),
            path: format!("/{id}"),
            status: completed.then_some(200),
            status_text: completed.then(|| "OK".to_string()),
            request_headers: Vec::new(),
            response_headers: Vec::new(),
            request_body: None,
            response_body: None,
            request_body_raw: None,
            response_body_raw: None,
            content_type: None,
            request_content_type: None,
            request_size: 0,
            response_size: 0,
            duration_ms: 0,
            timestamp: now_iso(),
            completed,
            http_version: Some("HTTP/1.1".to_string()),
        }
    }

    fn paused_request(id: &str, body_bytes: usize) -> PausedRequest {
        PausedRequest {
            session_id: "session".to_string(),
            id: id.to_string(),
            method: "POST".to_string(),
            url: format!("http://example.test/{id}"),
            host: "example.test".to_string(),
            path: format!("/{id}"),
            request_headers: vec![("content-type".to_string(), "text/plain".to_string())],
            request_body: Some("x".repeat(body_bytes)),
            timestamp: now_iso(),
        }
    }

    fn assert_retained_accounting(retained: &RetainedCaptures) {
        assert_eq!(
            retained.total_bytes,
            retained
                .entries
                .iter()
                .map(captured_entry_bytes)
                .sum::<usize>()
        );
    }

    fn assert_paused_accounting(retained: &PausedRequests) {
        assert_eq!(
            retained.total_bytes,
            retained
                .slots
                .values()
                .map(|slot| slot.charged_bytes)
                .sum::<usize>()
        );
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "protoforge-proxy-capture-{label}-{}",
                Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn request_round_trip(
        mut pair: RequestPairState,
        id: &'static str,
        barrier: Arc<Barrier>,
    ) -> Option<String> {
        pair.current = Some(request_meta(id));
        barrier.wait().await;
        tokio::task::yield_now().await;
        pair.current.take().map(|meta| meta.id)
    }

    #[tokio::test]
    async fn cloned_request_pairs_keep_concurrent_metadata_isolated() {
        let template = RequestPairState::default();
        let barrier = Arc::new(Barrier::new(2));

        let first = tokio::spawn(request_round_trip(
            template.clone(),
            "first",
            barrier.clone(),
        ));
        let second = tokio::spawn(request_round_trip(template.clone(), "second", barrier));
        let (first, second) = tokio::join!(first, second);

        assert_eq!(first.unwrap().as_deref(), Some("first"));
        assert_eq!(second.unwrap().as_deref(), Some("second"));
        assert!(template.current.is_none());
    }

    #[test]
    fn pending_is_retained_and_completed_replaces_the_same_entry() {
        let mut retained = RetainedCaptures::default();
        upsert_retained_entry(&mut retained, captured_entry("request", false));
        assert_eq!(retained.entries.len(), 1);
        assert!(!retained.entries[0].completed);
        assert_retained_accounting(&retained);

        upsert_retained_entry(&mut retained, captured_entry("request", true));
        assert_eq!(retained.entries.len(), 1);
        assert!(retained.entries[0].completed);
        assert_eq!(retained.entries[0].status, Some(200));
        assert_retained_accounting(&retained);
    }

    #[test]
    fn clear_fence_linearizes_sequences_with_retained_entries() {
        let mut retained = RetainedCaptures::default();
        let mut pending = captured_entry("request", false);
        sequence_and_upsert(&mut retained, &mut pending);
        let mut completed = captured_entry("request", true);
        sequence_and_upsert(&mut retained, &mut completed);

        assert_eq!(pending.capture_seq, 1);
        assert_eq!(completed.capture_seq, 2);
        assert_eq!(retained.entries.len(), 1);
        assert_retained_accounting(&retained);
        assert_eq!(clear_retained(&mut retained), 2);
        assert!(retained.entries.is_empty());
        assert_eq!(retained.total_bytes, 0);

        let mut after_clear = captured_entry("after", false);
        sequence_and_upsert(&mut retained, &mut after_clear);
        assert_eq!(after_clear.capture_seq, 3);

        let stopped = finalize_pending_retained(&mut retained);
        assert_eq!(stopped.len(), 1);
        assert_eq!(stopped[0].capture_seq, 4);
        assert_eq!(stopped[0].status, Some(499));
        assert!(stopped[0].completed);
        assert_retained_accounting(&retained);
    }

    #[test]
    fn websocket_upgrade_detection_is_case_insensitive_and_token_aware() {
        let websocket = Request::builder()
            .header("Connection", "keep-alive, UpGrAdE")
            .header("Upgrade", "WebSocket")
            .body(Body::empty())
            .unwrap();
        assert!(is_websocket_upgrade(&websocket));

        let missing_connection_token = Request::builder()
            .header("Connection", "keep-alive")
            .header("Upgrade", "websocket")
            .body(Body::empty())
            .unwrap();
        assert!(!is_websocket_upgrade(&missing_connection_token));

        let different_upgrade = Request::builder()
            .header("Connection", "upgrade")
            .header("Upgrade", "h2c")
            .body(Body::empty())
            .unwrap();
        assert!(!is_websocket_upgrade(&different_upgrade));
    }

    #[test]
    fn replaced_body_removes_transfer_encoding_and_sets_exact_content_length() {
        let mut headers = http::HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("99"));
        headers.insert(TRANSFER_ENCODING, HeaderValue::from_static("chunked"));

        let body = replace_request_body(&mut headers, "abc".to_string());

        assert_eq!(body, Bytes::from_static(b"abc"));
        assert_eq!(headers.get(CONTENT_LENGTH).unwrap(), "3");
        assert!(!headers.contains_key(TRANSFER_ENCODING));
    }

    #[test]
    fn replay_body_helpers_enforce_the_capture_budget() {
        let mut buffer = vec![0; MAX_CAPTURE_BODY_BYTES as usize - 1];
        append_capped_body(&mut buffer, &[1], MAX_CAPTURE_BODY_BYTES as usize).unwrap();
        assert!(append_capped_body(&mut buffer, &[2], MAX_CAPTURE_BODY_BYTES as usize).is_err());

        assert_eq!(
            decode_capped_replay_body(Some("YWJj"), None).unwrap(),
            b"abc"
        );
        let oversized = "x".repeat(MAX_CAPTURE_BODY_BYTES as usize + 1);
        assert!(decode_capped_replay_body(None, Some(&oversized)).is_err());
    }

    #[test]
    fn retained_entries_remain_bounded() {
        let mut retained = RetainedCaptures::default();
        for index in 0..=MAX_CAPTURED_ENTRIES {
            upsert_retained_entry(&mut retained, captured_entry(&index.to_string(), false));
        }

        assert_eq!(retained.entries.len(), MAX_CAPTURED_ENTRIES);
        assert_eq!(
            retained.entries.front().map(|entry| entry.id.as_str()),
            Some("1")
        );
        assert_eq!(
            retained.entries.back().map(|entry| entry.id.clone()),
            Some(MAX_CAPTURED_ENTRIES.to_string())
        );
        assert!(retained.total_bytes <= MAX_RETAINED_CAPTURE_BYTES);
        assert_retained_accounting(&retained);
    }

    #[test]
    fn retained_entries_evict_by_aggregate_bytes_and_keep_exact_accounting() {
        let mut retained = RetainedCaptures::default();
        let mut first = captured_entry("first", false);
        first.response_body = Some("a".repeat(512));
        let first_size = captured_entry_bytes(&first);

        let mut second = captured_entry("second", false);
        second.response_body_raw = Some("b".repeat(512));
        let second_size = captured_entry_bytes(&second);

        let mut third = captured_entry("third", false);
        third.request_headers = vec![("x-large".to_string(), "c".repeat(512))];
        let third_size = captured_entry_bytes(&third);
        let budget = second_size.saturating_add(third_size);

        upsert_retained_entry_with_limits(&mut retained, first, 10, budget);
        assert_retained_accounting(&retained);
        upsert_retained_entry_with_limits(&mut retained, second, 10, budget);
        assert_retained_accounting(&retained);
        upsert_retained_entry_with_limits(&mut retained, third, 10, budget);

        assert_eq!(retained.entries.len(), 2);
        assert_eq!(retained.entries.front().unwrap().id, "second");
        assert_eq!(retained.entries.back().unwrap().id, "third");
        assert_eq!(retained.total_bytes, budget);
        assert!(retained.total_bytes <= budget);
        assert_retained_accounting(&retained);

        let mut replacement = captured_entry("second", true);
        replacement.response_body = Some("z".repeat(64));
        upsert_retained_entry_with_limits(&mut retained, replacement, 10, budget);
        assert!(retained.entries.iter().any(|entry| entry.id == "second"));
        assert_retained_accounting(&retained);

        assert_eq!(clear_retained(&mut retained), 0);
        assert!(retained.entries.is_empty());
        assert_eq!(retained.total_bytes, 0);
        assert!(first_size > 0);
    }

    #[test]
    fn paused_requests_enforce_count_and_charged_byte_limits() {
        let mut retained = PausedRequests::default();
        let mut receivers = Vec::new();

        for index in 0..MAX_PAUSED_REQUESTS {
            let id = format!("paused-{index}");
            let (tx, rx) = oneshot::channel();
            try_insert_paused_with_limits(
                &mut retained,
                id.clone(),
                paused_request(&id, 0),
                0,
                tx,
                MAX_PAUSED_REQUESTS,
                MAX_PAUSED_CAPTURE_BYTES,
            )
            .unwrap();
            receivers.push(rx);
        }
        assert_eq!(retained.slots.len(), MAX_PAUSED_REQUESTS);
        assert!(retained.total_bytes <= MAX_PAUSED_CAPTURE_BYTES);
        assert_paused_accounting(&retained);

        let (tx, _rx) = oneshot::channel();
        assert_eq!(
            try_insert_paused_with_limits(
                &mut retained,
                "overflow".to_string(),
                paused_request("overflow", 0),
                0,
                tx,
                MAX_PAUSED_REQUESTS,
                MAX_PAUSED_CAPTURE_BYTES,
            ),
            Err(PausedInsertError::CountLimit)
        );

        let removed_charge = retained.slots["paused-0"].charged_bytes;
        remove_paused(&mut retained, "paused-0").unwrap();
        assert_eq!(
            retained.total_bytes,
            retained
                .slots
                .values()
                .map(|slot| slot.charged_bytes)
                .sum::<usize>()
        );
        assert!(removed_charge > 0);

        let drained = drain_paused(&mut retained);
        assert_eq!(drained.len(), MAX_PAUSED_REQUESTS - 1);
        assert!(retained.slots.is_empty());
        assert_eq!(retained.total_bytes, 0);
        drop(receivers);
    }

    #[test]
    fn paused_byte_charge_includes_display_and_blocked_handler_body_copies() {
        let body_bytes = MAX_CAPTURE_BODY_BYTES as usize;
        let first = paused_request("large-1", body_bytes);
        let first_charge = paused_request_charged_bytes(&first, body_bytes);
        assert!(first_charge >= body_bytes.saturating_mul(2));

        let mut retained = PausedRequests::default();
        let (first_tx, _first_rx) = oneshot::channel();
        try_insert_paused_with_limits(
            &mut retained,
            first.id.clone(),
            first,
            body_bytes,
            first_tx,
            10,
            first_charge,
        )
        .unwrap();
        assert_eq!(retained.total_bytes, first_charge);

        let second = paused_request("large-2", body_bytes);
        let (second_tx, _second_rx) = oneshot::channel();
        assert_eq!(
            try_insert_paused_with_limits(
                &mut retained,
                second.id.clone(),
                second,
                body_bytes,
                second_tx,
                10,
                first_charge,
            ),
            Err(PausedInsertError::ByteLimit)
        );
        assert_paused_accounting(&retained);
    }

    #[test]
    fn resumed_removal_event_payload_uses_the_typed_reason() {
        let payload = paused_removal_payload(
            "resume-session",
            "paused".to_string(),
            PausedRemovalReason::Resumed,
        );
        let payload = serde_json::to_value(payload).unwrap();
        assert_eq!(payload["sessionId"], "resume-session");
        assert_eq!(payload["requestId"], "paused");
        assert_eq!(payload["reason"], "resumed");
    }

    #[test]
    fn concurrent_ca_creation_publishes_one_valid_pair_without_temp_files() {
        const THREADS: usize = 8;
        let directory = TestDirectory::new("ca-concurrent");
        let root = directory.path().to_path_buf();
        let barrier = Arc::new(ThreadBarrier::new(THREADS));

        let workers: Vec<_> = (0..THREADS)
            .map(|_| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    get_or_create_ca(&root)
                })
            })
            .collect();

        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().expect("CA worker panicked").unwrap())
            .collect();
        let (expected_cert, expected_key, expected_path) = &results[0];
        for (cert, key, path) in &results[1..] {
            assert_eq!(cert, expected_cert);
            assert_eq!(key, expected_key);
            assert_eq!(path, expected_path);
        }
        validate_ca_pair(expected_cert, expected_key).unwrap();

        let ca_dir = root.join("proxy-ca");
        let names: Vec<_> = std::fs::read_dir(&ca_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2);
        assert!(ca_dir.join("protoforge-ca.crt").is_file());
        let key_path = ca_dir.join("protoforge-ca.key");
        assert!(key_path.is_file());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(key_path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn existing_ca_pair_is_rejected_when_the_private_key_does_not_match() {
        let directory = TestDirectory::new("ca-mismatch");
        let root = directory.path().to_path_buf();
        get_or_create_ca(&root).unwrap();

        let unrelated_key = KeyPair::generate().unwrap().serialize_pem();
        let key_path = root.join("proxy-ca/protoforge-ca.key");
        std::fs::write(&key_path, unrelated_key).unwrap();

        let error = get_or_create_ca(&root).unwrap_err();
        assert!(error.contains("证书与私钥不匹配"), "{error}");
    }

    #[tokio::test]
    async fn destroy_tombstone_detaches_only_the_exact_session_generation() {
        let state = ProxyState::new();
        let old = get_or_create_session_for_start(&state, "capture")
            .await
            .unwrap();
        let old_generation = Uuid::new_v4();
        let old_worker = tokio::spawn(std::future::pending::<()>());
        let old_cancel = CancellationToken::new();
        let old_task_finished = CancellationToken::new();
        let old_stop_finished = CancellationToken::new();
        *old.lifecycle.lock().await = ProxyLifecycle::Running {
            generation: old_generation,
            cancel: old_cancel.clone(),
            abort_handle: old_worker.abort_handle(),
            task_finished: old_task_finished.clone(),
            stop_finished: old_stop_finished.clone(),
        };

        let detached = take_session_for_destroy(&state, "capture")
            .await
            .expect("old session must be detached");
        assert!(Arc::ptr_eq(&detached.lifecycle, &old.lifecycle));
        assert!(detached.destroyed.load(Ordering::Acquire));
        assert!(detached.reserve_start().await.is_err());

        // Closed UUIDs are never reused, so delayed reads/writes/start cannot resurrect them.
        assert!(
            get_or_create_session_for_start(&state, "capture")
                .await
                .is_err()
        );
        assert!(
            set_breakpoints(&state, "capture", Vec::new())
                .await
                .is_err()
        );
        assert!(!get_status(&state, "capture").await.running);
        assert!(get_session(&state, "capture").await.is_none());

        // A legitimate new UI session uses a fresh UUID and owns independent state.
        let replacement = get_or_create_session_for_start(&state, "replacement")
            .await
            .unwrap();
        assert!(!Arc::ptr_eq(&replacement.lifecycle, &old.lifecycle));
        let (replacement_generation, _, _) = replacement.reserve_start().await.unwrap();

        let ProxyStopAction::AbortRunning {
            generation,
            abort_handle,
            task_finished,
            ..
        } = detached.cancel_server().await
        else {
            panic!("destroy must stop the detached running generation");
        };
        assert_eq!(generation, old_generation);
        assert!(old_cancel.is_cancelled());
        abort_handle.abort();
        assert!(old_worker.await.unwrap_err().is_cancelled());
        task_finished.cancel();
        detached.finish_stop(old_generation).await;

        let mapped = get_session(&state, "replacement").await.unwrap();
        assert!(Arc::ptr_eq(&mapped.lifecycle, &replacement.lifecycle));
        assert!(matches!(
            &*replacement.lifecycle.lock().await,
            ProxyLifecycle::Starting { generation, .. } if *generation == replacement_generation
        ));
    }

    #[tokio::test]
    async fn read_only_calls_never_create_and_destroy_of_unknown_id_blocks_late_start() {
        let state = ProxyState::new();
        let status = get_status(&state, "never-started").await;
        assert!(!status.running);
        assert_eq!(status.port, 9090);
        assert!(get_entries(&state, "never-started").await.is_empty());
        assert!(list_breakpoints(&state, "never-started").await.is_empty());
        assert!(list_paused(&state, "never-started").await.is_empty());
        assert!(state.registry.lock().await.active.is_empty());

        assert!(
            take_session_for_destroy(&state, "never-started")
                .await
                .is_none()
        );
        assert!(
            get_or_create_session_for_start(&state, "never-started")
                .await
                .is_err()
        );
        assert!(
            set_breakpoints(&state, "never-started", Vec::new())
                .await
                .is_err()
        );
        let registry = state.registry.lock().await;
        assert!(registry.active.is_empty());
        assert!(registry.destroyed_ids.contains("never-started"));
    }

    #[test]
    fn destroyed_session_tombstones_are_strictly_bounded() {
        let mut registry = SessionRegistry::default();
        registry.remember_destroyed_with_limit("first", 2);
        registry.remember_destroyed_with_limit("second", 2);
        registry.remember_destroyed_with_limit("third", 2);

        assert_eq!(registry.destroyed_ids.len(), 2);
        assert_eq!(registry.destroyed_order.len(), 2);
        assert!(!registry.destroyed_ids.contains("first"));
        assert!(registry.destroyed_ids.contains("second"));
        assert!(registry.destroyed_ids.contains("third"));

        // Repeated destroys neither duplicate nor grow the queue.
        registry.remember_destroyed_with_limit("third", 2);
        assert_eq!(registry.destroyed_ids.len(), 2);
        assert_eq!(registry.destroyed_order.len(), 2);
    }

    #[tokio::test]
    async fn concurrent_first_start_and_destroy_linearize_to_a_tombstone() {
        for index in 0..32 {
            let state = Arc::new(ProxyState::new());
            let barrier = Arc::new(Barrier::new(2));
            let session_id = format!("race-{index}");

            let start_state = state.clone();
            let start_barrier = barrier.clone();
            let start_id = session_id.clone();
            let start = tokio::spawn(async move {
                start_barrier.wait().await;
                get_or_create_session_for_start(&start_state, &start_id).await
            });
            let destroy_state = state.clone();
            let destroy_barrier = barrier.clone();
            let destroy_id = session_id.clone();
            let destroy = tokio::spawn(async move {
                destroy_barrier.wait().await;
                take_session_for_destroy(&destroy_state, &destroy_id).await
            });

            let started = start.await.unwrap();
            let detached = destroy.await.unwrap();
            if let Ok(started) = started {
                assert!(started.destroyed.load(Ordering::Acquire));
                assert!(detached.is_some());
            } else {
                assert!(detached.is_none());
            }
            let registry = state.registry.lock().await;
            assert!(!registry.active.contains_key(&session_id));
            assert!(registry.destroyed_ids.contains(&session_id));
        }
    }

    #[tokio::test]
    async fn lifecycle_rejects_double_start_and_stop_cancels_starting() {
        let session = ProxySessionState::new();
        let (generation, cancel, finished) = session.reserve_start().await.unwrap();
        assert!(session.reserve_start().await.is_err());

        assert!(matches!(
            session.cancel_server().await,
            ProxyStopAction::WaitForStarting(_)
        ));
        assert!(cancel.is_cancelled());
        assert!(!finished.is_cancelled());
        session.fail_start(generation).await;
        assert!(finished.is_cancelled());
        assert!(!session.is_running().await);
        assert!(session.reserve_start().await.is_ok());
    }

    #[tokio::test]
    async fn old_start_failure_cannot_clear_a_new_generation() {
        let session = ProxySessionState::new();
        let (old_generation, _, _) = session.reserve_start().await.unwrap();
        let action = session.cancel_server().await;
        assert!(matches!(action, ProxyStopAction::WaitForStarting(_)));
        session.fail_start(old_generation).await;
        let (new_generation, _, _) = session.reserve_start().await.unwrap();

        session.fail_start(old_generation).await;

        let lifecycle = session.lifecycle.lock().await;
        assert!(matches!(
            &*lifecycle,
            ProxyLifecycle::Starting { generation, .. } if *generation == new_generation
        ));
    }

    #[tokio::test]
    async fn stop_running_returns_the_current_abort_handle() {
        let session = ProxySessionState::new();
        let generation = Uuid::new_v4();
        let task = tokio::spawn(std::future::pending::<()>());
        let cancel = CancellationToken::new();
        let task_finished = CancellationToken::new();
        let stop_finished = CancellationToken::new();
        *session.lifecycle.lock().await = ProxyLifecycle::Running {
            generation,
            cancel: cancel.clone(),
            abort_handle: task.abort_handle(),
            task_finished: task_finished.clone(),
            stop_finished: stop_finished.clone(),
        };
        {
            let lifecycle = session.lifecycle.lock().await;
            assert!(lifecycle_allows_generation(&lifecycle, generation, &cancel));
            assert!(!lifecycle_allows_generation(
                &lifecycle,
                Uuid::new_v4(),
                &cancel
            ));
        }

        let ProxyStopAction::AbortRunning {
            generation: stopping_generation,
            abort_handle,
            ..
        } = session.cancel_server().await
        else {
            panic!("expected running stop action");
        };
        assert_eq!(stopping_generation, generation);
        assert!(cancel.is_cancelled());
        assert!(session.reserve_start().await.is_err());
        assert!(matches!(
            session.cancel_server().await,
            ProxyStopAction::WaitForStopping(_)
        ));
        abort_handle.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        task_finished.cancel();
        session.finish_stop(generation).await;
        assert!(stop_finished.is_cancelled());
        assert!(!session.is_running().await);
        assert!(session.reserve_start().await.is_ok());
    }

    #[tokio::test]
    async fn cross_renderer_start_is_blocked_until_stopping_barrier_finishes() {
        let session = ProxySessionState::new();
        let generation = Uuid::new_v4();
        let worker = tokio::spawn(std::future::pending::<()>());
        *session.lifecycle.lock().await = ProxyLifecycle::Running {
            generation,
            cancel: CancellationToken::new(),
            abort_handle: worker.abort_handle(),
            task_finished: CancellationToken::new(),
            stop_finished: CancellationToken::new(),
        };

        let ProxyStopAction::AbortRunning { abort_handle, .. } = session.cancel_server().await
        else {
            panic!("first renderer must own stop cleanup");
        };
        let ProxyStopAction::WaitForStopping(stop_barrier) = session.cancel_server().await else {
            panic!("second renderer must wait for the same stop cleanup");
        };

        assert!(session.reserve_start().await.is_err());
        let waiter = tokio::spawn(async move { stop_barrier.cancelled().await });
        session.finish_stop(generation).await;
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("stop barrier should open")
            .unwrap();
        assert!(session.reserve_start().await.is_ok());

        abort_handle.abort();
        assert!(worker.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn listener_bind_reports_an_occupied_port_before_start_returns() {
        let held = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = held.local_addr().unwrap();
        let error = bind_proxy_listener(addr, &CancellationToken::new())
            .await
            .unwrap_err();

        assert!(error.contains("绑定代理端口失败"));
    }

    #[tokio::test]
    async fn listener_bind_honors_an_already_cancelled_start() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let error = bind_proxy_listener(SocketAddr::from(([127, 0, 0, 1], 0)), &cancel)
            .await
            .unwrap_err();

        assert_eq!(error, "代理启动已取消");
    }
}
