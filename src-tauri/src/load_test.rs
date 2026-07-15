// 压测引擎模块
// 使用 tokio 并发调度，复用 http_client::execute_request，实时推送指标

use crate::http_client::{self, AuthConfig, HttpRequest, RequestBody};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

// ═══════════════════════════════════════════
//  配置和数据结构
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestConfig {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<RequestBody>,
    pub auth: Option<AuthConfig>,
    pub concurrency: u32,
    pub duration_secs: Option<u64>,  // 持续时间模式
    pub total_requests: Option<u64>, // 总请求数模式
    pub timeout_ms: Option<u64>,
    pub rps_limit: Option<u64>, // 每秒最大请求数限制
    // Advanced mode
    pub mode: Option<String>, // "constant" | "ramp" | "step" | "spike"
    pub ramp_duration_secs: Option<u64>, // ramp 模式: 从 1 线性增长到 concurrency 的时间
    pub step_interval_secs: Option<u64>, // step 模式: 每隔多少秒增加一步
    pub latency_threshold_ms: Option<u64>, // 延迟阈值断言: 超过此值视为失败
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    pub seq: u64,
    pub elapsed_ms: u64,
    pub status: u16,
    pub latency_ms: u64,
    pub bytes: u64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_msg: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub test_id: String,
    pub timestamp: String,
    pub elapsed_secs: u64,
    pub total_requests: u64,
    pub total_errors: u64,
    pub rps: f64,
    pub avg_latency_ms: f64,
    pub min_latency_ms: u64,
    pub max_latency_ms: u64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub status_codes: HashMap<u16, u64>,
    // ── Advanced statistics ──
    pub bytes_downloaded: u64,
    pub active_connections: u32,
    pub ttfb_avg_ms: f64,
    pub latency_points: Vec<f64>,
    pub error_samples: Vec<RequestRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestComplete {
    pub test_id: String,
    pub total_requests: u64,
    pub total_errors: u64,
    pub total_duration_secs: f64,
    pub avg_rps: f64,
    pub avg_latency_ms: f64,
    pub min_latency_ms: u64,
    pub max_latency_ms: u64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub status_codes: HashMap<u16, u64>,
    // ── Advanced statistics ──
    pub total_bytes_downloaded: u64,
    pub avg_throughput_bps: f64,
}

// ═══════════════════════════════════════════
//  全局压测状态管理
// ═══════════════════════════════════════════

pub(crate) struct TestHandle {
    generation: u64,
    cancel: CancellationToken,
    finished: CancellationToken,
}

pub struct LoadTestState {
    pub tests: Arc<Mutex<HashMap<String, TestHandle>>>,
    lifecycle: Mutex<()>,
    next_generation: AtomicU64,
}

impl LoadTestState {
    pub fn new() -> Self {
        Self {
            tests: Arc::new(Mutex::new(HashMap::new())),
            lifecycle: Mutex::new(()),
            next_generation: AtomicU64::new(1),
        }
    }
}

struct CompletionGuard(CancellationToken);

impl Drop for CompletionGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn percentile(sorted: &[u64], pct: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 * pct / 100.0).ceil() as usize).saturating_sub(1);
    let idx = idx.min(sorted.len() - 1);
    sorted[idx]
}

/// 全局延迟分位数的最大样本数。超过上限后使用 Algorithm R 蓄水池采样，
/// 让测试全程的每个请求都有相同概率留在样本中；请求数、总和和极值仍精确累计。
const MAX_LATENCY_SAMPLES: usize = 200_000;

struct BoundedLatencyStats {
    samples: Vec<u64>,
    sample_limit: usize,
    count: u64,
    sum: u128,
    min: Option<u64>,
    max: Option<u64>,
}

impl BoundedLatencyStats {
    fn new(sample_limit: usize) -> Self {
        Self {
            samples: Vec::with_capacity(sample_limit.min(10_000)),
            sample_limit,
            count: 0,
            sum: 0,
            min: None,
            max: None,
        }
    }

    fn record(&mut self, latency: u64) {
        self.count = self.count.saturating_add(1);
        self.sum = self.sum.saturating_add(latency as u128);
        self.min = Some(self.min.map_or(latency, |current| current.min(latency)));
        self.max = Some(self.max.map_or(latency, |current| current.max(latency)));

        if self.samples.len() < self.sample_limit {
            self.samples.push(latency);
        } else if self.sample_limit > 0 {
            // Algorithm R: replace one existing item only when the random index
            // falls inside the reservoir, keeping a uniform sample of all records.
            let index = rand::thread_rng().gen_range(0..self.count);
            if index < self.sample_limit as u64 {
                self.samples[index as usize] = latency;
            }
        }
    }

    fn average(&self) -> f64 {
        if self.count == 0 {
            0.0
        } else {
            self.sum as f64 / self.count as f64
        }
    }

    fn min(&self) -> u64 {
        self.min.unwrap_or(0)
    }

    fn max(&self) -> u64 {
        self.max.unwrap_or(0)
    }
}

// ═══════════════════════════════════════════
//  Worker spawner (reusable for all modes)
// ═══════════════════════════════════════════

struct ActiveWorkerGuard(Arc<AtomicU32>);

impl ActiveWorkerGuard {
    fn new(active_count: Arc<AtomicU32>) -> Self {
        active_count.fetch_add(1, Ordering::Relaxed);
        Self(active_count)
    }
}

impl Drop for ActiveWorkerGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

fn claim_request_slot(issued_requests: &AtomicU64, total_limit: Option<u64>) -> bool {
    let Some(limit) = total_limit else {
        return true;
    };
    issued_requests
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |issued| {
            (issued < limit).then_some(issued + 1)
        })
        .is_ok()
}

struct GlobalRateLimiter {
    interval: Duration,
    next_slot: Mutex<Instant>,
}

impl GlobalRateLimiter {
    fn new(rps: u64) -> Self {
        Self {
            interval: Duration::from_secs_f64(1.0 / rps as f64),
            next_slot: Mutex::new(Instant::now()),
        }
    }

    async fn reserve_slot(&self) -> Instant {
        let mut next_slot = self.next_slot.lock().await;
        let now = Instant::now();
        let reserved = (*next_slot).max(now);
        *next_slot = reserved + self.interval;
        reserved
    }

    async fn wait(&self, cancel: &CancellationToken) -> bool {
        let slot = self.reserve_slot().await;
        tokio::select! {
            biased;
            _ = cancel.cancelled() => false,
            _ = tokio::time::sleep_until(slot) => true,
        }
    }
}

async fn run_worker(
    config: LoadTestConfig,
    cancel: CancellationToken,
    rate_limiter: Option<Arc<GlobalRateLimiter>>,
    issued_requests: Arc<AtomicU64>,
    total_requests: Arc<AtomicU64>,
    total_errors: Arc<AtomicU64>,
    latencies: Arc<Mutex<BoundedLatencyStats>>,
    status_codes: Arc<Mutex<HashMap<u16, u64>>>,
    window_requests: Arc<AtomicU64>,
    window_latencies: Arc<Mutex<Vec<u64>>>,
    start_time: Instant,
    // ── Advanced stats counters ──
    window_bytes: Arc<AtomicU64>,
    total_bytes: Arc<AtomicU64>,
    window_ttfb: Arc<Mutex<Vec<f64>>>,
    window_lat_points: Arc<Mutex<Vec<f64>>>,
    active_count: Arc<AtomicU32>,
    error_samples: Arc<Mutex<VecDeque<RequestRecord>>>,
) {
    let total_limit = config.total_requests;
    let duration_limit = config.duration_secs;

    let _active_guard = ActiveWorkerGuard::new(active_count);
    loop {
        if cancel.is_cancelled() {
            break;
        }
        if let Some(dur) = duration_limit {
            if start_time.elapsed().as_secs() >= dur {
                cancel.cancel();
                break;
            }
        }
        // Claim before starting the request. Checking the completed counter is
        // racy under concurrency and can overshoot the configured total by up
        // to one request per worker.
        if !claim_request_slot(&issued_requests, total_limit) {
            break;
        }

        if let Some(rate_limiter) = &rate_limiter {
            if !rate_limiter.wait(&cancel).await {
                break;
            }
        }

        let req = HttpRequest {
            method: config.method.clone(),
            url: config.url.clone(),
            headers: config.headers.clone(),
            query_params: HashMap::new(),
            body: config.body.clone(),
            auth: config.auth.clone(),
            timeout_ms: config.timeout_ms.or(Some(30000)),
            follow_redirects: Some(true),
            max_redirects: None,
            ssl_verify: None,
            proxy: None,
        };

        let req_start = Instant::now();
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            result = http_client::execute_request(req) => result,
        };
        let latency = req_start.elapsed().as_millis() as u64;

        let completed_requests = total_requests.fetch_add(1, Ordering::Relaxed) + 1;
        window_requests.fetch_add(1, Ordering::Relaxed);

        match result {
            Ok(resp) => {
                // 字节数 & TTFB
                window_bytes.fetch_add(resp.body_size, Ordering::Relaxed);
                total_bytes.fetch_add(resp.body_size, Ordering::Relaxed);
                if let Some(ttfb) = resp.timing.ttfb_ms {
                    window_ttfb.lock().await.push(ttfb);
                }

                let mut codes = status_codes.lock().await;
                *codes.entry(resp.status).or_insert(0) += 1;
                drop(codes);
                if resp.status >= 400 {
                    total_errors.fetch_add(1, Ordering::Relaxed);
                    // Record error sample
                    let seq = total_requests.load(Ordering::Relaxed);
                    let mut samples = error_samples.lock().await;
                    if samples.len() >= 20 {
                        samples.pop_front();
                    }
                    samples.push_back(RequestRecord {
                        seq,
                        elapsed_ms: start_time.elapsed().as_millis() as u64,
                        status: resp.status,
                        latency_ms: latency,
                        bytes: resp.body_size,
                        success: false,
                        error_msg: Some(format!("HTTP {}", resp.status)),
                    });
                } else if let Some(threshold) = config.latency_threshold_ms {
                    if latency > threshold {
                        total_errors.fetch_add(1, Ordering::Relaxed);
                        let seq = total_requests.load(Ordering::Relaxed);
                        let mut samples = error_samples.lock().await;
                        if samples.len() >= 20 {
                            samples.pop_front();
                        }
                        samples.push_back(RequestRecord {
                            seq,
                            elapsed_ms: start_time.elapsed().as_millis() as u64,
                            status: resp.status,
                            latency_ms: latency,
                            bytes: resp.body_size,
                            success: false,
                            error_msg: Some(format!(
                                "Latency {}ms > {}ms threshold",
                                latency, threshold
                            )),
                        });
                    }
                }
            }
            Err(e) => {
                total_errors.fetch_add(1, Ordering::Relaxed);
                let mut codes = status_codes.lock().await;
                *codes.entry(0).or_insert(0) += 1;
                drop(codes);
                // Record error sample
                let seq = total_requests.load(Ordering::Relaxed);
                let mut samples = error_samples.lock().await;
                if samples.len() >= 20 {
                    samples.pop_front();
                }
                samples.push_back(RequestRecord {
                    seq,
                    elapsed_ms: start_time.elapsed().as_millis() as u64,
                    status: 0,
                    latency_ms: latency,
                    bytes: 0,
                    success: false,
                    error_msg: Some(e.to_string()),
                });
            }
        }

        latencies.lock().await.record(latency);
        window_latencies.lock().await.push(latency);

        // 散点数据（采样限制）
        {
            let mut pts = window_lat_points.lock().await;
            if pts.len() < 200 {
                pts.push(latency as f64);
            }
        }

        if total_limit.is_some_and(|limit| completed_requests >= limit) {
            cancel.cancel();
        }
    }
}

const MAX_LOAD_TEST_CONCURRENCY: u32 = 1_000;
const MAX_LOAD_TEST_RPS: u64 = 1_000_000;

fn validated_concurrency(config: &LoadTestConfig) -> Result<usize, String> {
    if config.concurrency == 0 {
        return Err("并发数必须大于 0".to_string());
    }
    if config.concurrency > MAX_LOAD_TEST_CONCURRENCY {
        return Err(format!(
            "并发数不能超过 {MAX_LOAD_TEST_CONCURRENCY}（当前为 {}）",
            config.concurrency
        ));
    }
    if config.rps_limit == Some(0) {
        return Err("RPS 限制必须大于 0".to_string());
    }
    if config.rps_limit.is_some_and(|rps| rps > MAX_LOAD_TEST_RPS) {
        return Err(format!("RPS 限制不能超过 {MAX_LOAD_TEST_RPS}"));
    }
    if config.total_requests == Some(0) {
        return Err("总请求数必须大于 0".to_string());
    }
    if config.duration_secs == Some(0) {
        return Err("持续时间必须大于 0 秒".to_string());
    }
    Ok(config.concurrency as usize)
}

type WorkerFuture = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

#[derive(Clone, Copy)]
struct ScheduleTiming {
    ramp_duration: Duration,
    step_interval: Duration,
    spike_delay: Duration,
}

impl ScheduleTiming {
    fn from_config(config: &LoadTestConfig) -> Self {
        Self {
            ramp_duration: Duration::from_secs(config.ramp_duration_secs.unwrap_or(10).max(1)),
            step_interval: Duration::from_secs(config.step_interval_secs.unwrap_or(5).max(1)),
            spike_delay: Duration::from_secs(config.duration_secs.unwrap_or(10)) / 2,
        }
    }
}

async fn wait_for_schedule(delay: Duration, cancel: &CancellationToken) -> bool {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(delay) => true,
    }
}

async fn run_worker_schedule<F>(
    mode: &str,
    max_concurrency: usize,
    timing: ScheduleTiming,
    cancel: CancellationToken,
    spawn_worker: F,
) where
    F: Fn() -> WorkerFuture,
{
    let mut workers = tokio::task::JoinSet::new();
    let spawn = |workers: &mut tokio::task::JoinSet<()>| {
        workers.spawn(spawn_worker());
    };

    match mode {
        "ramp" => {
            spawn(&mut workers);
            let workers_to_add = max_concurrency.saturating_sub(1);
            let interval = if workers_to_add == 0 {
                Duration::ZERO
            } else {
                timing.ramp_duration.div_f64(workers_to_add as f64)
            };
            for _ in 0..workers_to_add {
                if !wait_for_schedule(interval, &cancel).await {
                    break;
                }
                spawn(&mut workers);
            }
        }
        "step" => {
            spawn(&mut workers);
            for _ in 0..max_concurrency.saturating_sub(1) {
                if !wait_for_schedule(timing.step_interval, &cancel).await {
                    break;
                }
                spawn(&mut workers);
            }
        }
        "spike" => {
            if wait_for_schedule(timing.spike_delay, &cancel).await {
                for _ in 0..max_concurrency {
                    spawn(&mut workers);
                }
            }
        }
        _ => {
            for _ in 0..max_concurrency {
                spawn(&mut workers);
            }
        }
    }

    while workers.join_next().await.is_some() {}
}

async fn remove_test_if_generation(
    tests: &Mutex<HashMap<String, TestHandle>>,
    test_id: &str,
    generation: u64,
) -> bool {
    let mut tests = tests.lock().await;
    if tests
        .get(test_id)
        .is_some_and(|handle| handle.generation == generation)
    {
        tests.remove(test_id);
        true
    } else {
        false
    }
}

async fn stop_existing_test(state: &LoadTestState, test_id: &str) {
    let handle = state.tests.lock().await.remove(test_id);
    if let Some(handle) = handle {
        handle.cancel.cancel();
        handle.finished.cancelled().await;
    }
}

// ═══════════════════════════════════════════
//  压测引擎核心
// ═══════════════════════════════════════════

pub async fn start_load_test(
    app: tauri::AppHandle,
    state: &LoadTestState,
    test_id: String,
    config: LoadTestConfig,
) -> Result<(), String> {
    let concurrency = validated_concurrency(&config)?;
    // Serialize lifecycle operations so concurrent same-ID starts cannot both
    // observe an empty slot and run overlapping generations.
    let _lifecycle = state.lifecycle.lock().await;
    stop_existing_test(state, &test_id).await;

    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);
    let cancel = CancellationToken::new();
    let finished = CancellationToken::new();

    // 共享计数器
    let issued_requests = Arc::new(AtomicU64::new(0));
    let rate_limiter = config
        .rps_limit
        .map(|rps| Arc::new(GlobalRateLimiter::new(rps)));
    let total_requests = Arc::new(AtomicU64::new(0));
    let total_errors = Arc::new(AtomicU64::new(0));
    let latencies = Arc::new(Mutex::new(BoundedLatencyStats::new(MAX_LATENCY_SAMPLES)));
    let status_codes: Arc<Mutex<HashMap<u16, u64>>> = Arc::new(Mutex::new(HashMap::new()));
    // 每秒窗口计数器
    let window_requests = Arc::new(AtomicU64::new(0));
    let window_latencies: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::with_capacity(1_000)));
    // ── Advanced stats counters ──
    let window_bytes = Arc::new(AtomicU64::new(0));
    let total_bytes = Arc::new(AtomicU64::new(0));
    let window_ttfb: Arc<Mutex<Vec<f64>>> = Arc::new(Mutex::new(Vec::with_capacity(1_000)));
    let window_lat_points: Arc<Mutex<Vec<f64>>> = Arc::new(Mutex::new(Vec::with_capacity(200)));
    let active_count = Arc::new(AtomicU32::new(0));
    let error_samples: Arc<Mutex<VecDeque<RequestRecord>>> =
        Arc::new(Mutex::new(VecDeque::with_capacity(20)));

    let tid = test_id.clone();
    let task_cancel = cancel.clone();
    let task_finished = finished.clone();
    let app_clone = app.clone();
    let tests = state.tests.clone();
    let (start_gate, start_gate_rx) = tokio::sync::oneshot::channel();

    let task = tokio::spawn(async move {
        let _completion_guard = CompletionGuard(task_finished);
        if start_gate_rx.await.is_err() {
            return;
        }
        let start_time = Instant::now();

        let mode = config.mode.clone().unwrap_or_else(|| "constant".into());
        let schedule_timing = ScheduleTiming::from_config(&config);
        let worker_factory = {
            let worker_config = config.clone();
            let worker_cancel = task_cancel.clone();
            let rate_limiter = rate_limiter.clone();
            let issued_requests = issued_requests.clone();
            let total_requests = total_requests.clone();
            let total_errors = total_errors.clone();
            let latencies = latencies.clone();
            let status_codes = status_codes.clone();
            let window_requests = window_requests.clone();
            let window_latencies = window_latencies.clone();
            let window_bytes = window_bytes.clone();
            let total_bytes = total_bytes.clone();
            let window_ttfb = window_ttfb.clone();
            let window_lat_points = window_lat_points.clone();
            let active_count = active_count.clone();
            let error_samples = error_samples.clone();
            move || {
                Box::pin(run_worker(
                    worker_config.clone(),
                    worker_cancel.clone(),
                    rate_limiter.clone(),
                    issued_requests.clone(),
                    total_requests.clone(),
                    total_errors.clone(),
                    latencies.clone(),
                    status_codes.clone(),
                    window_requests.clone(),
                    window_latencies.clone(),
                    start_time,
                    window_bytes.clone(),
                    total_bytes.clone(),
                    window_ttfb.clone(),
                    window_lat_points.clone(),
                    active_count.clone(),
                    error_samples.clone(),
                )) as WorkerFuture
            }
        };

        // A deadline cancels pending HTTP transports rather than waiting for
        // their individual request timeout to elapse.
        let deadline_task = config.duration_secs.map(|duration| {
            let deadline_cancel = task_cancel.clone();
            tokio::spawn(async move {
                tokio::select! {
                    biased;
                    _ = deadline_cancel.cancelled() => {}
                    _ = tokio::time::sleep(Duration::from_secs(duration)) => {
                        deadline_cancel.cancel();
                    }
                }
            })
        });

        // 定时器每秒汇总指标
        let metrics_task = {
            let metrics_cancel = task_cancel.clone();
            let total_req = total_requests.clone();
            let total_err = total_errors.clone();
            let lats = latencies.clone();
            let codes = status_codes.clone();
            let win_req = window_requests.clone();
            let win_lats = window_latencies.clone();
            let win_bytes = window_bytes.clone();
            let win_ttfb = window_ttfb.clone();
            let win_lp = window_lat_points.clone();
            let ac = active_count.clone();
            let err_samples = error_samples.clone();
            let tid = tid.clone();
            let app = app_clone.clone();

            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                interval.tick().await; // skip first immediate tick

                loop {
                    tokio::select! {
                        biased;
                        _ = metrics_cancel.cancelled() => break,
                        _ = interval.tick() => {}
                    }

                    let elapsed = start_time.elapsed().as_secs();
                    let req_count = total_req.load(Ordering::Relaxed);
                    let err_count = total_err.load(Ordering::Relaxed);

                    // 窗口 RPS
                    let win_count = win_req.swap(0, Ordering::Relaxed);
                    let rps = win_count as f64;

                    // 窗口延迟
                    let mut win_data = win_lats.lock().await;
                    let mut win_sorted = win_data.clone();
                    win_data.clear();
                    drop(win_data);

                    win_sorted.sort_unstable();

                    let avg_lat = if win_sorted.is_empty() {
                        0.0
                    } else {
                        win_sorted.iter().sum::<u64>() as f64 / win_sorted.len() as f64
                    };

                    // 全量延迟统计 (min/max)
                    let all_lats = lats.lock().await;
                    let global_min = all_lats.min();
                    let global_max = all_lats.max();
                    drop(all_lats);

                    // ── Advanced: bytes / ttfb / scatter / active ──
                    let win_bytes_val = win_bytes.swap(0, Ordering::Relaxed);
                    let active_conn = ac.load(Ordering::Relaxed);

                    let mut ttfb_data = win_ttfb.lock().await;
                    let ttfb_avg = if ttfb_data.is_empty() {
                        0.0
                    } else {
                        ttfb_data.iter().sum::<f64>() / ttfb_data.len() as f64
                    };
                    ttfb_data.clear();
                    drop(ttfb_data);

                    let mut lat_pts = win_lp.lock().await;
                    let scatter_points = lat_pts.clone();
                    lat_pts.clear();
                    drop(lat_pts);

                    // Error samples
                    let mut es_data = err_samples.lock().await;
                    let err_vec: Vec<RequestRecord> = es_data.drain(..).collect();
                    drop(es_data);

                    let snapshot = MetricsSnapshot {
                        test_id: tid.clone(),
                        timestamp: now_iso(),
                        elapsed_secs: elapsed,
                        total_requests: req_count,
                        total_errors: err_count,
                        rps,
                        avg_latency_ms: avg_lat,
                        min_latency_ms: global_min,
                        max_latency_ms: global_max,
                        p50_ms: percentile(&win_sorted, 50.0),
                        p95_ms: percentile(&win_sorted, 95.0),
                        p99_ms: percentile(&win_sorted, 99.0),
                        status_codes: codes.lock().await.clone(),
                        bytes_downloaded: win_bytes_val,
                        active_connections: active_conn,
                        ttfb_avg_ms: ttfb_avg,
                        latency_points: scatter_points,
                        error_samples: err_vec,
                    };

                    let _ = app.emit("loadtest-metrics", snapshot);
                }
            })
        };

        run_worker_schedule(
            &mode,
            concurrency,
            schedule_timing,
            task_cancel.clone(),
            worker_factory,
        )
        .await;

        // Natural completion and external stop converge here. All workers have
        // been joined before auxiliary tasks and the registry are finalized.
        task_cancel.cancel();
        if let Some(deadline_task) = deadline_task {
            let _ = deadline_task.await;
        }
        let _ = metrics_task.await;

        // 发送最终 snapshot，确保 X 轴覆盖完整测试时长
        {
            let elapsed = start_time.elapsed().as_secs();
            let req_count = total_requests.load(Ordering::Relaxed);
            let err_count = total_errors.load(Ordering::Relaxed);
            let win_req = window_requests.swap(0, Ordering::Relaxed);
            let rps = win_req as f64; // last window
            let mut wl = window_latencies.lock().await;
            let mut wl_sorted = wl.clone();
            wl_sorted.sort_unstable();
            let avg_lat = if wl_sorted.is_empty() {
                0.0
            } else {
                wl_sorted.iter().sum::<u64>() as f64 / wl_sorted.len() as f64
            };
            wl.clear();
            drop(wl);
            let all_lats_snap = latencies.lock().await;
            let global_min = all_lats_snap.min();
            let global_max = all_lats_snap.max();
            drop(all_lats_snap);
            let win_bytes_val = window_bytes.swap(0, Ordering::Relaxed);
            let active_conn = active_count.load(Ordering::Relaxed);
            let mut ttfb_data = window_ttfb.lock().await;
            let ttfb_avg = if ttfb_data.is_empty() {
                0.0
            } else {
                ttfb_data.iter().sum::<f64>() / ttfb_data.len() as f64
            };
            ttfb_data.clear();
            drop(ttfb_data);
            let mut lat_pts = window_lat_points.lock().await;
            let scatter_points = lat_pts.clone();
            lat_pts.clear();
            drop(lat_pts);
            let mut es_data = error_samples.lock().await;
            let err_vec: Vec<RequestRecord> = es_data.drain(..).collect();
            drop(es_data);
            let final_snapshot = MetricsSnapshot {
                test_id: tid.clone(),
                timestamp: now_iso(),
                elapsed_secs: elapsed,
                total_requests: req_count,
                total_errors: err_count,
                rps,
                avg_latency_ms: avg_lat,
                min_latency_ms: global_min,
                max_latency_ms: global_max,
                p50_ms: percentile(&wl_sorted, 50.0),
                p95_ms: percentile(&wl_sorted, 95.0),
                p99_ms: percentile(&wl_sorted, 99.0),
                status_codes: status_codes.lock().await.clone(),
                bytes_downloaded: win_bytes_val,
                active_connections: active_conn,
                ttfb_avg_ms: ttfb_avg,
                latency_points: scatter_points,
                error_samples: err_vec,
            };
            let _ = app.emit("loadtest-metrics", final_snapshot);
        }

        // 计算最终汇总
        let total_duration = start_time.elapsed().as_secs_f64();
        let req_count = total_requests.load(Ordering::Relaxed);
        let err_count = total_errors.load(Ordering::Relaxed);
        let all_lats = latencies.lock().await;
        let avg_lat = all_lats.average();
        let min_lat = all_lats.min();
        let max_lat = all_lats.max();
        let mut latency_sample = all_lats.samples.clone();
        drop(all_lats);
        latency_sample.sort_unstable();

        let total_dl = total_bytes.load(Ordering::Relaxed);
        let avg_throughput = if total_duration > 0.0 {
            total_dl as f64 / total_duration
        } else {
            0.0
        };

        let complete = LoadTestComplete {
            test_id: tid.clone(),
            total_requests: req_count,
            total_errors: err_count,
            total_duration_secs: total_duration,
            avg_rps: if total_duration > 0.0 {
                req_count as f64 / total_duration
            } else {
                0.0
            },
            avg_latency_ms: avg_lat,
            min_latency_ms: min_lat,
            max_latency_ms: max_lat,
            p50_ms: percentile(&latency_sample, 50.0),
            p95_ms: percentile(&latency_sample, 95.0),
            p99_ms: percentile(&latency_sample, 99.0),
            status_codes: status_codes.lock().await.clone(),
            total_bytes_downloaded: total_dl,
            avg_throughput_bps: avg_throughput,
        };

        let _ = app_clone.emit("loadtest-complete", complete);
        remove_test_if_generation(tests.as_ref(), &tid, generation).await;
    });

    let handle = TestHandle {
        generation,
        cancel: cancel.clone(),
        finished: finished.clone(),
    };
    state.tests.lock().await.insert(test_id.clone(), handle);
    if start_gate.send(()).is_err() {
        cancel.cancel();
        finished.cancelled().await;
        remove_test_if_generation(state.tests.as_ref(), &test_id, generation).await;
        return Err("压测任务启动失败".to_string());
    }
    // The registry owns lifecycle control through cancel/finished. Dropping the
    // join handle detaches only the root supervisor, never its structured child set.
    drop(task);

    Ok(())
}

pub async fn stop_load_test(state: &LoadTestState, test_id: &str) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().await;
    stop_existing_test(state, test_id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;

    fn test_config(concurrency: u32) -> LoadTestConfig {
        LoadTestConfig {
            url: "http://127.0.0.1/".to_string(),
            method: "GET".to_string(),
            headers: HashMap::new(),
            body: None,
            auth: None,
            concurrency,
            duration_secs: Some(1),
            total_requests: None,
            timeout_ms: None,
            rps_limit: None,
            mode: None,
            ramp_duration_secs: None,
            step_interval_secs: None,
            latency_threshold_ms: None,
        }
    }

    #[test]
    fn bounded_latency_stats_caps_samples_and_keeps_exact_aggregates() {
        let mut stats = BoundedLatencyStats::new(3);
        for latency in 1..=10 {
            stats.record(latency);
        }

        assert_eq!(stats.samples.len(), 3);
        assert_eq!(stats.count, 10);
        assert_eq!(stats.sum, 55);
        assert_eq!(stats.average(), 5.5);
        assert_eq!(stats.min(), 1);
        assert_eq!(stats.max(), 10);
        assert!(
            stats
                .samples
                .iter()
                .all(|latency| (1..=10).contains(latency))
        );
    }

    #[test]
    fn bounded_latency_stats_supports_zero_sample_limit() {
        let mut stats = BoundedLatencyStats::new(0);
        stats.record(42);

        assert!(stats.samples.is_empty());
        assert_eq!(stats.average(), 42.0);
        assert_eq!(stats.min(), 42);
        assert_eq!(stats.max(), 42);
    }

    #[test]
    fn oversized_concurrency_is_rejected_with_clear_limit() {
        let error = validated_concurrency(&test_config(MAX_LOAD_TEST_CONCURRENCY + 1))
            .expect_err("oversized tests must be rejected before spawning");
        assert!(error.contains(&MAX_LOAD_TEST_CONCURRENCY.to_string()));
        assert!(error.contains("并发数不能超过"));
    }

    #[test]
    fn zero_sized_load_dimensions_are_rejected() {
        let error = validated_concurrency(&test_config(0)).expect_err("zero workers are invalid");
        assert!(error.contains("并发数"));

        let mut config = test_config(1);
        config.total_requests = Some(0);
        let error = validated_concurrency(&config).expect_err("zero requests are invalid");
        assert!(error.contains("总请求数"));

        let mut config = test_config(1);
        config.duration_secs = Some(0);
        let error = validated_concurrency(&config).expect_err("zero duration is invalid");
        assert!(error.contains("持续时间"));
    }

    #[tokio::test]
    async fn global_rps_limit_spaces_slots_across_workers() {
        let mut config = test_config(100);
        config.rps_limit = Some(10);

        validated_concurrency(&config).unwrap();
        let limiter = GlobalRateLimiter::new(config.rps_limit.unwrap());
        let first = limiter.reserve_slot().await;
        let second = limiter.reserve_slot().await;

        assert!(second.duration_since(first) >= Duration::from_millis(99));
    }

    #[test]
    fn zero_rps_limit_is_rejected() {
        let mut config = test_config(1);
        config.rps_limit = Some(0);

        let error = validated_concurrency(&config).expect_err("zero RPS would divide by zero");
        assert!(error.contains("RPS"));
        assert!(error.contains("大于 0"));
    }

    #[test]
    fn excessive_rps_limit_is_rejected() {
        let mut config = test_config(1);
        config.rps_limit = Some(MAX_LOAD_TEST_RPS + 1);

        let error = validated_concurrency(&config).expect_err("excessive RPS must be bounded");
        assert!(error.contains(&MAX_LOAD_TEST_RPS.to_string()));
    }

    #[test]
    fn concurrent_request_claims_never_overshoot_total_limit() {
        let issued = Arc::new(AtomicU64::new(0));
        let claimed = Arc::new(AtomicU64::new(0));
        let mut workers = Vec::new();
        for _ in 0..32 {
            let issued = issued.clone();
            let claimed = claimed.clone();
            workers.push(std::thread::spawn(move || {
                while claim_request_slot(&issued, Some(100)) {
                    claimed.fetch_add(1, Ordering::Relaxed);
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }

        assert_eq!(issued.load(Ordering::Relaxed), 100);
        assert_eq!(claimed.load(Ordering::Relaxed), 100);
    }

    #[tokio::test]
    async fn advanced_schedules_finish_and_join_every_worker() {
        let timing = ScheduleTiming {
            ramp_duration: Duration::from_millis(9),
            step_interval: Duration::from_millis(3),
            spike_delay: Duration::from_millis(3),
        };

        for mode in ["ramp", "step", "spike"] {
            let active = Arc::new(AtomicU32::new(0));
            let spawned = Arc::new(AtomicU32::new(0));
            let factory = {
                let active = active.clone();
                let spawned = spawned.clone();
                move || {
                    spawned.fetch_add(1, Ordering::Relaxed);
                    let active = active.clone();
                    Box::pin(async move {
                        let _guard = ActiveWorkerGuard::new(active);
                        tokio::time::sleep(Duration::from_millis(2)).await;
                    }) as WorkerFuture
                }
            };

            timeout(
                Duration::from_millis(250),
                run_worker_schedule(mode, 4, timing, CancellationToken::new(), factory),
            )
            .await
            .unwrap_or_else(|_| panic!("{mode} schedule must not self-deadlock"));
            assert_eq!(spawned.load(Ordering::Relaxed), 4, "mode={mode}");
            assert_eq!(active.load(Ordering::Relaxed), 0, "mode={mode}");
        }
    }

    #[tokio::test]
    async fn stop_waits_until_all_child_tasks_are_reaped() {
        let state = LoadTestState::new();
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        let active = Arc::new(AtomicU32::new(0));
        let supervisor_cancel = cancel.clone();
        let supervisor_root_cancel = cancel.clone();
        let supervisor_finished = finished.clone();
        let supervisor_active = active.clone();

        let supervisor = tokio::spawn(async move {
            let _completion = CompletionGuard(supervisor_finished);
            let factory = move || {
                let worker_cancel = supervisor_cancel.clone();
                let active = supervisor_active.clone();
                Box::pin(async move {
                    let _guard = ActiveWorkerGuard::new(active);
                    worker_cancel.cancelled().await;
                }) as WorkerFuture
            };
            run_worker_schedule(
                "ramp",
                4,
                ScheduleTiming {
                    ramp_duration: Duration::from_secs(60),
                    step_interval: Duration::ZERO,
                    spike_delay: Duration::ZERO,
                },
                supervisor_root_cancel,
                factory,
            )
            .await;
        });

        state.tests.lock().await.insert(
            "stop-test".to_string(),
            TestHandle {
                generation: 1,
                cancel: cancel.clone(),
                finished: finished.clone(),
            },
        );

        timeout(Duration::from_millis(100), async {
            while active.load(Ordering::Relaxed) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("all synthetic workers should start");

        timeout(
            Duration::from_millis(250),
            stop_load_test(&state, "stop-test"),
        )
        .await
        .expect("stop must join children promptly")
        .expect("stop command succeeds");
        supervisor.await.expect("supervisor should not panic");
        assert_eq!(active.load(Ordering::Relaxed), 0);
        assert!(state.tests.lock().await.is_empty());
    }

    #[tokio::test]
    async fn old_test_cleanup_cannot_remove_same_id_replacement() {
        let state = LoadTestState::new();
        let old_cancel = CancellationToken::new();
        let old_finished = CancellationToken::new();
        let new_cancel = CancellationToken::new();
        let new_finished = CancellationToken::new();

        state.tests.lock().await.insert(
            "same-id".to_string(),
            TestHandle {
                generation: 2,
                cancel: new_cancel,
                finished: new_finished,
            },
        );

        assert!(!remove_test_if_generation(state.tests.as_ref(), "same-id", 1).await);
        assert_eq!(
            state
                .tests
                .lock()
                .await
                .get("same-id")
                .map(|handle| handle.generation),
            Some(2)
        );

        // Keep these explicit to model an already-finished old generation and
        // ensure token state cannot influence the replacement registry entry.
        old_cancel.cancel();
        old_finished.cancel();
        assert_eq!(
            state
                .tests
                .lock()
                .await
                .get("same-id")
                .map(|handle| handle.generation),
            Some(2)
        );
    }
}
