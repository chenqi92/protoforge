// 压测引擎模块
// 使用 tokio 并发调度，复用 http_client::execute_request，实时推送指标

use crate::http_client::{self, AuthConfig, HttpRequest, RequestBody};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};

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
    pub duration_secs: Option<u64>,    // 持续时间模式
    pub total_requests: Option<u64>,   // 总请求数模式
    pub timeout_ms: Option<u64>,
    pub rps_limit: Option<u64>,        // 每秒最大请求数限制
    // Advanced mode
    pub mode: Option<String>,          // "constant" | "ramp" | "step" | "spike"
    pub ramp_duration_secs: Option<u64>,  // ramp 模式: 从 1 线性增长到 concurrency 的时间
    pub step_interval_secs: Option<u64>, // step 模式: 每隔多少秒增加一步
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
}

// ═══════════════════════════════════════════
//  全局压测状态管理
// ═══════════════════════════════════════════

pub(crate) struct TestHandle {
    stop_flag: Arc<AtomicBool>,
    abort_handle: tokio::task::AbortHandle,
}

pub struct LoadTestState {
    pub tests: Arc<Mutex<HashMap<String, TestHandle>>>,
}

impl LoadTestState {
    pub fn new() -> Self {
        Self {
            tests: Arc::new(Mutex::new(HashMap::new())),
        }
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

// ═══════════════════════════════════════════
//  Worker spawner (reusable for all modes)
// ═══════════════════════════════════════════

fn spawn_worker(
    config: LoadTestConfig,
    stop_flag: Arc<AtomicBool>,
    total_requests: Arc<AtomicU64>,
    total_errors: Arc<AtomicU64>,
    latencies: Arc<Mutex<Vec<u64>>>,
    status_codes: Arc<Mutex<HashMap<u16, u64>>>,
    window_requests: Arc<AtomicU64>,
    window_latencies: Arc<Mutex<Vec<u64>>>,
    start_time: Instant,
    concurrency: usize,
) -> tokio::task::JoinHandle<()> {
    let total_limit = config.total_requests;
    let duration_limit = config.duration_secs;
    let per_worker_rps = config.rps_limit.map(|r| (r as f64 / concurrency as f64).max(1.0));

    tokio::spawn(async move {
        let mut last_send = Instant::now();
        loop {
            if stop_flag.load(Ordering::Relaxed) { break; }
            if let Some(dur) = duration_limit {
                if start_time.elapsed().as_secs() >= dur { break; }
            }
            if let Some(limit) = total_limit {
                if total_requests.load(Ordering::Relaxed) >= limit { break; }
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
                ssl_verify: None,
                proxy: None,
            };

            if let Some(rps) = per_worker_rps {
                let interval = Duration::from_secs_f64(1.0 / rps);
                let elapsed = last_send.elapsed();
                if elapsed < interval {
                    tokio::time::sleep(interval - elapsed).await;
                }
                last_send = Instant::now();
            }

            let req_start = Instant::now();
            let result = http_client::execute_request(req).await;
            let latency = req_start.elapsed().as_millis() as u64;

            total_requests.fetch_add(1, Ordering::Relaxed);
            window_requests.fetch_add(1, Ordering::Relaxed);

            match result {
                Ok(resp) => {
                    let mut codes = status_codes.lock().await;
                    *codes.entry(resp.status).or_insert(0) += 1;
                    drop(codes);
                    if resp.status >= 400 {
                        total_errors.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Err(_) => {
                    total_errors.fetch_add(1, Ordering::Relaxed);
                    let mut codes = status_codes.lock().await;
                    *codes.entry(0).or_insert(0) += 1;
                    drop(codes);
                }
            }

            latencies.lock().await.push(latency);
            window_latencies.lock().await.push(latency);
        }
    })
}

/// 全量延迟上限：超过此数量时删除最旧的 10% 条目，避免内存无限增长
const MAX_LATENCIES: usize = 200_000;

// ═══════════════════════════════════════════
//  压测引擎核心
// ═══════════════════════════════════════════

pub async fn start_load_test(
    app: tauri::AppHandle,
    state: &LoadTestState,
    test_id: String,
    config: LoadTestConfig,
) -> Result<(), String> {
    // 先停止已有的同 ID 测试
    stop_load_test(state, &test_id).await.ok();

    let stop_flag = Arc::new(AtomicBool::new(false));
    let concurrency = config.concurrency.max(1) as usize;

    // 共享计数器
    let total_requests = Arc::new(AtomicU64::new(0));
    let total_errors = Arc::new(AtomicU64::new(0));
    let latencies: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::with_capacity(10_000)));
    let status_codes: Arc<Mutex<HashMap<u16, u64>>> = Arc::new(Mutex::new(HashMap::new()));
    // 每秒窗口计数器
    let window_requests = Arc::new(AtomicU64::new(0));
    let window_latencies: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::with_capacity(1_000)));

    let tid = test_id.clone();
    let sf = stop_flag.clone();
    let app_clone = app.clone();
    let tests = state.tests.clone();

    let task = tokio::spawn(async move {
        let start_time = Instant::now();

        // spawn worker tasks with dynamic concurrency for advanced modes
        let mode = config.mode.clone().unwrap_or_else(|| "constant".into());
        let max_concurrency = config.concurrency.max(1) as usize;
        let mut worker_handles = Vec::new();

        // Determine initial workers and schedule additional workers for ramp/step modes
        let initial_workers = match mode.as_str() {
            "ramp" | "step" => 1usize,
            "spike" => {
                // Spike: wait half duration then unleash full concurrency
                0 // workers will be spawned after delay
            }
            _ => max_concurrency, // constant
        };

        for _ in 0..initial_workers {
            let config = config.clone();
            let sf = sf.clone();
            let total_req = total_requests.clone();
            let total_err = total_errors.clone();
            let lats = latencies.clone();
            let codes = status_codes.clone();
            let win_req = window_requests.clone();
            let win_lats = window_latencies.clone();
            let handle = spawn_worker(config, sf, total_req, total_err, lats, codes, win_req, win_lats, start_time, concurrency);
            worker_handles.push(handle);
        }

        // For ramp/step/spike, spawn additional workers over time
        if mode != "constant" {
            let config_clone = config.clone();
            let sf_clone = sf.clone();
            let tr = total_requests.clone();
            let te = total_errors.clone();
            let la = latencies.clone();
            let sc = status_codes.clone();
            let wr = window_requests.clone();
            let wl = window_latencies.clone();
            let mode_clone = mode.clone();
            // 收集动态 spawn 的 worker 句柄，避免句柄泄漏
            let dynamic_handles: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
            let dh = dynamic_handles.clone();

            let ramp_task = tokio::spawn(async move {
                match mode_clone.as_str() {
                    "ramp" => {
                        let ramp_secs = config_clone.ramp_duration_secs.unwrap_or(10).max(1);
                        let workers_to_add = max_concurrency.saturating_sub(1);
                        if workers_to_add > 0 {
                            let interval_ms = (ramp_secs * 1000) / workers_to_add as u64;
                            for _ in 0..workers_to_add {
                                tokio::time::sleep(Duration::from_millis(interval_ms)).await;
                                if sf_clone.load(Ordering::Relaxed) { break; }
                                let h = spawn_worker(config_clone.clone(), sf_clone.clone(), tr.clone(), te.clone(), la.clone(), sc.clone(), wr.clone(), wl.clone(), start_time, concurrency);
                                dh.lock().await.push(h);
                            }
                        }
                    }
                    "step" => {
                        let step_interval = config_clone.step_interval_secs.unwrap_or(5).max(1);
                        let steps = max_concurrency.saturating_sub(1);
                        for _ in 0..steps {
                            tokio::time::sleep(Duration::from_secs(step_interval)).await;
                            if sf_clone.load(Ordering::Relaxed) { break; }
                            let h = spawn_worker(config_clone.clone(), sf_clone.clone(), tr.clone(), te.clone(), la.clone(), sc.clone(), wr.clone(), wl.clone(), start_time, concurrency);
                            dh.lock().await.push(h);
                        }
                    }
                    "spike" => {
                        // Wait half the duration then unleash all workers at once
                        let half = config_clone.duration_secs.unwrap_or(10) / 2;
                        tokio::time::sleep(Duration::from_secs(half)).await;
                        if !sf_clone.load(Ordering::Relaxed) {
                            for _ in 0..max_concurrency {
                                let h = spawn_worker(config_clone.clone(), sf_clone.clone(), tr.clone(), te.clone(), la.clone(), sc.clone(), wr.clone(), wl.clone(), start_time, concurrency);
                                dh.lock().await.push(h);
                            }
                        }
                    }
                    _ => {}
                }
            });
            worker_handles.push(ramp_task);

            // 等待动态 worker 完成的任务
            let dh_final = dynamic_handles;
            let sf_waiter = sf.clone();
            let waiter = tokio::spawn(async move {
                // 等待 stop 信号后回收所有动态 worker
                loop {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    if sf_waiter.load(Ordering::Relaxed) {
                        let handles = dh_final.lock().await;
                        for h in handles.iter() {
                            h.abort();
                        }
                        break;
                    }
                }
            });
            worker_handles.push(waiter);
        }

        // 定时器每秒汇总指标
        let metrics_task = {
            let sf = sf.clone();
            let total_req = total_requests.clone();
            let total_err = total_errors.clone();
            let lats = latencies.clone();
            let codes = status_codes.clone();
            let win_req = window_requests.clone();
            let win_lats = window_latencies.clone();
            let tid = tid.clone();
            let app = app_clone.clone();

            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                interval.tick().await; // skip first immediate tick

                loop {
                    interval.tick().await;
                    if sf.load(Ordering::Relaxed) {
                        break;
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
                    let global_min = all_lats.iter().copied().min().unwrap_or(0);
                    let global_max = all_lats.iter().copied().max().unwrap_or(0);
                    drop(all_lats);

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
                    };

                    let _ = app.emit("loadtest-metrics", snapshot);
                }
            })
        };

        // 等待所有 worker 完成
        for h in worker_handles {
            let _ = h.await;
        }

        // 停止指标任务
        sf.store(true, Ordering::Relaxed);
        metrics_task.abort();

        // 计算最终汇总
        let total_duration = start_time.elapsed().as_secs_f64();
        let req_count = total_requests.load(Ordering::Relaxed);
        let err_count = total_errors.load(Ordering::Relaxed);
        let mut all_lats = latencies.lock().await;
        // 截断超量延迟记录（保护排序内存）
        let lat_len = all_lats.len();
        if lat_len > MAX_LATENCIES {
            all_lats.drain(..lat_len - MAX_LATENCIES);
        }
        all_lats.sort_unstable();

        let avg_lat = if all_lats.is_empty() {
            0.0
        } else {
            all_lats.iter().sum::<u64>() as f64 / all_lats.len() as f64
        };

        let complete = LoadTestComplete {
            test_id: tid.clone(),
            total_requests: req_count,
            total_errors: err_count,
            total_duration_secs: total_duration,
            avg_rps: if total_duration > 0.0 { req_count as f64 / total_duration } else { 0.0 },
            avg_latency_ms: avg_lat,
            min_latency_ms: all_lats.first().copied().unwrap_or(0),
            max_latency_ms: all_lats.last().copied().unwrap_or(0),
            p50_ms: percentile(&all_lats, 50.0),
            p95_ms: percentile(&all_lats, 95.0),
            p99_ms: percentile(&all_lats, 99.0),
            status_codes: status_codes.lock().await.clone(),
        };

        let _ = app_clone.emit("loadtest-complete", complete);
        tests.lock().await.remove(&tid);
    });

    let handle = TestHandle {
        stop_flag,
        abort_handle: task.abort_handle(),
    };
    state.tests.lock().await.insert(test_id, handle);

    Ok(())
}

pub async fn stop_load_test(state: &LoadTestState, test_id: &str) -> Result<(), String> {
    let mut tests = state.tests.lock().await;
    if let Some(handle) = tests.remove(test_id) {
        handle.stop_flag.store(true, Ordering::Relaxed);
        // Give workers a moment to finish gracefully
        tokio::time::sleep(Duration::from_millis(100)).await;
        handle.abort_handle.abort();
    }
    Ok(())
}
