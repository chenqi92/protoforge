import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Flame, Play, Square, Settings2, Activity, BarChart3, Clock,
  AlertTriangle, Zap, TrendingUp, ChevronDown, ChevronUp,
  Plus, Trash2, Download, Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricsChart } from "./MetricsChart";
import type { MetricsSnapshot, LoadTestComplete, LoadTestConfig } from "@/types/loadtest";

type DurationMode = "duration" | "requests";
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type BodyMode = "none" | "json" | "raw";
type AuthMode = "none" | "bearer" | "basic";

export function LoadTestWorkspace() {
  // 自管理 ID，不依赖 AppTab（独立窗口可用）
  const testId = useRef(crypto.randomUUID()).current;
  return <LoadTestPanel tabId={testId} />;
}

function LoadTestPanel({ tabId }: { tabId: string }) {
  // ─── Config ───
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [concurrency, setConcurrency] = useState(10);
  const [durationMode, setDurationMode] = useState<DurationMode>("duration");
  const [durationSecs, setDurationSecs] = useState(10);
  const [totalRequests, setTotalRequests] = useState(100);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [rpsLimit, setRpsLimit] = useState<number | null>(null);
  const [rpsEnabled, setRpsEnabled] = useState(false);

  // Advanced config
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [bodyMode, setBodyMode] = useState<BodyMode>("none");
  const [bodyContent, setBodyContent] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUser, setBasicUser] = useState("");
  const [basicPass, setBasicPass] = useState("");

  // ─── Runtime ───
  const [running, setRunning] = useState(false);
  const [snapshots, setSnapshots] = useState<MetricsSnapshot[]>([]);
  const [summary, setSummary] = useState<LoadTestComplete | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<"rps" | "latency">("rps");

  const applyPrefill = useCallback((prefill: Partial<LoadTestConfig> | null) => {
    if (!prefill) return;

    if (prefill.url) setUrl(prefill.url);
    if (prefill.method) setMethod(prefill.method as HttpMethod);
    if (prefill.timeoutMs) setTimeoutMs(prefill.timeoutMs);

    if (prefill.headers && Object.keys(prefill.headers).length > 0) {
      const h = Object.entries(prefill.headers).map(([key, value]) => ({ key, value }));
      setHeaders([...h, { key: "", value: "" }]);
      setShowAdvanced(true);
    }

    if (prefill.body) {
      if (prefill.body.type === "json" && prefill.body.data) {
        setBodyMode("json");
        setBodyContent(prefill.body.data);
        setShowAdvanced(true);
      } else if (prefill.body.type === "raw" && prefill.body.content) {
        setBodyMode("raw");
        setBodyContent(prefill.body.content);
        setShowAdvanced(true);
      }
    }

    if (prefill.auth) {
      if (prefill.auth.type === "bearer" && prefill.auth.token) {
        setAuthMode("bearer");
        setBearerToken(prefill.auth.token);
        setShowAdvanced(true);
      } else if (prefill.auth.type === "basic" && prefill.auth.username) {
        setAuthMode("basic");
        setBasicUser(prefill.auth.username);
        setBasicPass(prefill.auth.password || "");
        setShowAdvanced(true);
      }
    }
  }, []);

  // ─── Read prefill config from bridge ───
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { popLoadTestConfig, subscribeLoadTestPrefill } = await import("@/lib/loadTestBridge");
      applyPrefill(popLoadTestConfig());
      cleanup = subscribeLoadTestPrefill((prefill) => applyPrefill(prefill));
    })();

    return () => {
      cleanup?.();
    };
  }, [applyPrefill]);

  // Listen events
  useEffect(() => {
    let unMetrics: (() => void) | null = null;
    let unComplete: (() => void) | null = null;
    const setup = async () => {
      const { onLoadTestMetrics, onLoadTestComplete } = await import("@/services/loadTestService");
      unMetrics = await onLoadTestMetrics((s) => {
        if (s.testId !== tabId) return;
        setSnapshots((prev) => [...prev, s]);
        setLatestMetrics(s);
      });
      unComplete = await onLoadTestComplete((r) => {
        if (r.testId !== tabId) return;
        setSummary(r);
        setRunning(false);
      });
    };
    setup();
    return () => { unMetrics?.(); unComplete?.(); };
  }, [tabId]);

  // ─── Build config ───
  const buildConfig = useCallback((): LoadTestConfig => {
    const h: Record<string, string> = {};
    for (const { key, value } of headers) {
      if (key.trim()) h[key.trim()] = value;
    }

    let body: LoadTestConfig["body"] = undefined;
    if (bodyMode === "json" && bodyContent.trim()) {
      body = { type: "json", data: bodyContent };
    } else if (bodyMode === "raw" && bodyContent.trim()) {
      body = { type: "raw", content: bodyContent, contentType: "text/plain" };
    }

    let auth: LoadTestConfig["auth"] = undefined;
    if (authMode === "bearer" && bearerToken.trim()) {
      auth = { type: "bearer", token: bearerToken };
    } else if (authMode === "basic" && basicUser.trim()) {
      auth = { type: "basic", username: basicUser, password: basicPass };
    }

    return {
      url, method, headers: h, body, auth,
      concurrency, timeoutMs,
      ...(durationMode === "duration" ? { durationSecs } : { totalRequests }),
      ...(rpsEnabled && rpsLimit ? { rpsLimit } : {}),
    };
  }, [url, method, headers, bodyMode, bodyContent, authMode, bearerToken, basicUser, basicPass, concurrency, timeoutMs, durationMode, durationSecs, totalRequests, rpsEnabled, rpsLimit]);

  const handleStart = useCallback(async () => {
    setError(null); setSnapshots([]); setSummary(null); setLatestMetrics(null); setRunning(true);
    try {
      const { startLoadTest } = await import("@/services/loadTestService");
      await startLoadTest(tabId, buildConfig());
    } catch (err: unknown) {
      setRunning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tabId, buildConfig]);

  const handleStop = useCallback(async () => {
    try {
      const { stopLoadTest } = await import("@/services/loadTestService");
      await stopLoadTest(tabId);
    } catch { /* ignore */ }
  }, [tabId]);

  // ─── Export ───
  const handleExportJson = useCallback(() => {
    const data = { config: buildConfig(), summary, snapshots };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `loadtest-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(u);
  }, [summary, snapshots, buildConfig]);

  const handleExportCsv = useCallback(() => {
    if (snapshots.length === 0) return;
    const csvHeaders = ["elapsed_secs","total_requests","total_errors","rps","avg_latency_ms","min_latency_ms","max_latency_ms","p50_ms","p95_ms","p99_ms"];
    const rows = snapshots.map(s => [s.elapsedSecs,s.totalRequests,s.totalErrors,s.rps.toFixed(2),s.avgLatencyMs.toFixed(2),s.minLatencyMs,s.maxLatencyMs,s.p50Ms,s.p95Ms,s.p99Ms].join(","));
    const csv = [csvHeaders.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `loadtest-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(u);
  }, [snapshots]);

  // ─── Progress ───
  const progress = useMemo(() => {
    if (!running || !latestMetrics) return null;
    if (durationMode === "duration") {
      const pct = Math.min(100, (latestMetrics.elapsedSecs / durationSecs) * 100);
      const remaining = Math.max(0, durationSecs - latestMetrics.elapsedSecs);
      return { pct, label: `剩余 ${remaining}s` };
    } else {
      const pct = Math.min(100, (latestMetrics.totalRequests / totalRequests) * 100);
      const remaining = Math.max(0, totalRequests - latestMetrics.totalRequests);
      return { pct, label: `剩余 ${remaining} 次` };
    }
  }, [running, latestMetrics, durationMode, durationSecs, totalRequests]);

  const errorRate = latestMetrics
    ? latestMetrics.totalRequests > 0
      ? ((latestMetrics.totalErrors / latestMetrics.totalRequests) * 100).toFixed(1)
      : "0.0"
    : "—";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-transparent p-3">
      <div className="shrink-0">
        <div className="wb-tool-strip">
          <div className="wb-tool-strip-main flex-1 flex-nowrap">
            <div className="wb-target-bar">
              <div className="wb-target-chip bg-gradient-to-r from-rose-500 to-pink-500">
                <span className="wb-target-chip-icon">
                  <Flame className="h-3.5 w-3.5" />
                </span>
                HTTP 压测
              </div>
              <div className="wb-target-field">
                <span className="wb-target-field-label">目标 URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="输入压测目标 URL"
                  disabled={running}
                  className="wb-target-field-input"
                />
              </div>
            </div>
          </div>

          <div className="wb-tool-strip-actions flex-nowrap">
            <span className="wb-tool-chip">{running ? "运行中" : "待启动"}</span>
            <button
              onClick={running ? handleStop : handleStart}
              disabled={!url.trim()}
              className={cn(
                "wb-primary-btn",
                running
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600"
              )}
            >
              {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {running ? "停止" : "开始压测"}
            </button>
          </div>
        </div>

        <div className="wb-panel mt-3 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-default/70 pb-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text-primary">
                <Settings2 className="h-3.5 w-3.5 text-rose-500" />
                运行配置
              </div>
              <div className="mt-1 text-[11px] text-text-tertiary">控制方法、并发、结束条件、超时与限速策略。</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="wb-ghost-btn"
              >
                {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                高级配置
              </button>
              {(summary || snapshots.length > 0) && (
                <>
                  <button onClick={handleExportJson} className="wb-ghost-btn hover:text-rose-600 hover:bg-rose-500/5" title="导出 JSON">
                    <Download className="w-3 h-3" />JSON
                  </button>
                  <button onClick={handleExportCsv} className="wb-ghost-btn hover:text-rose-600 hover:bg-rose-500/5" title="导出 CSV">
                    <Download className="w-3 h-3" />CSV
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-3 pt-3 sm:grid-cols-2 xl:grid-cols-5">
            <ControlBlock label="请求方法" icon={<Flame className="h-3 w-3" />}>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as HttpMethod)}
                disabled={running}
                className="cfg-select w-full font-semibold"
              >
                {(["GET", "POST", "PUT", "DELETE", "PATCH"] as const).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </ControlBlock>

            <ControlBlock label="并发数" icon={<Settings2 className="h-3 w-3" />}>
              <input type="number" value={concurrency} onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} max={500} className="cfg-input w-full text-left" />
            </ControlBlock>

            <ControlBlock label="结束条件" className="sm:col-span-2" icon={<Clock className="h-3 w-3" />}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="wb-tool-segment">
                  <button onClick={() => setDurationMode("duration")} disabled={running} className={cn(durationMode === "duration" && "is-active")}>持续时间</button>
                  <button onClick={() => setDurationMode("requests")} disabled={running} className={cn(durationMode === "requests" && "is-active")}>请求数</button>
                </div>
                {durationMode === "duration" ? (
                  <>
                    <input type="number" value={durationSecs} onChange={(e) => setDurationSecs(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-20 text-left" />
                    <span className="text-[11px] text-text-tertiary">秒</span>
                  </>
                ) : (
                  <>
                    <input type="number" value={totalRequests} onChange={(e) => setTotalRequests(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-24 text-left" />
                    <span className="text-[11px] text-text-tertiary">次请求</span>
                  </>
                )}
              </div>
            </ControlBlock>

            <ControlBlock label="超时" icon={<Clock className="h-3 w-3" />}>
              <div className="flex items-center gap-2">
                <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Math.max(1000, parseInt(e.target.value) || 1000))} disabled={running} min={1000} className="cfg-input w-full text-left" />
                <span className="text-[11px] text-text-tertiary">ms</span>
              </div>
            </ControlBlock>

            <ControlBlock label="限速策略" icon={<Gauge className="h-3 w-3" />}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <input type="checkbox" checked={rpsEnabled} onChange={(e) => setRpsEnabled(e.target.checked)} disabled={running} className="h-3.5 w-3.5 accent-rose-500" />
                  启用 RPS 限制
                </label>
                {rpsEnabled ? (
                  <div className="flex items-center gap-2">
                    <input type="number" value={rpsLimit ?? 100} onChange={(e) => setRpsLimit(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-full text-left" />
                    <span className="text-[11px] text-text-tertiary">req/s</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-text-disabled">未启用速率限制，请求将以最大吞吐发送。</div>
                )}
              </div>
            </ControlBlock>
          </div>
        </div>

        {/* ── Advanced Config Panel ── */}
        {showAdvanced && (
          <div className="wb-panel mt-3 p-3 animate-in slide-in-from-top-1 duration-150">
            <div className="grid gap-3 xl:grid-cols-[1.35fr_0.95fr_0.95fr]">
              <AdvancedSection title="请求头 (Headers)">
                {headers.map((h, i) => (
                  <div key={i} className="mb-2 flex items-center gap-2">
                    <input value={h.key} onChange={(e) => { const n = [...headers]; n[i].key = e.target.value; setHeaders(n); }} disabled={running} placeholder="Header Key" className="cfg-input flex-1 text-left" />
                    <input value={h.value} onChange={(e) => { const n = [...headers]; n[i].value = e.target.value; setHeaders(n); }} disabled={running} placeholder="Header Value" className="cfg-input flex-1 text-left" />
                    <button onClick={() => setHeaders(headers.filter((_, j) => j !== i))} disabled={running || headers.length <= 1} className="wb-icon-btn shrink-0 hover:text-red-500 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
                <button onClick={() => setHeaders([...headers, { key: "", value: "" }])} disabled={running} className="wb-ghost-btn"><Plus className="w-3 h-3" />添加请求头</button>
              </AdvancedSection>

              <AdvancedSection title="请求体 (Body)">
                <div className="wb-tool-segment mb-2">
                  {(["none", "json", "raw"] as const).map((m) => (
                    <button key={m} onClick={() => setBodyMode(m)} disabled={running} className={cn(bodyMode === m && "is-active")}>
                      {m === "none" ? "无" : m.toUpperCase()}
                    </button>
                  ))}
                </div>
                {bodyMode !== "none" ? (
                  <textarea
                    value={bodyContent}
                    onChange={(e) => setBodyContent(e.target.value)}
                    disabled={running}
                    placeholder={bodyMode === "json" ? '{"key": "value"}' : "raw body content"}
                    rows={8}
                    className="w-full resize-y rounded-[12px] border border-border-default bg-bg-input px-3 py-2 text-[12px] font-mono outline-none focus:border-rose-500 disabled:opacity-60"
                  />
                ) : (
                  <div className="flex min-h-[178px] items-center justify-center rounded-[12px] border border-dashed border-border-default/80 bg-bg-secondary/35 px-4 text-center text-[11px] text-text-disabled">
                    无需请求体时可保持为空；切换到 JSON 或 RAW 后可在这里填写压测负载。
                  </div>
                )}
              </AdvancedSection>

              <AdvancedSection title="认证 (Auth)">
                <div className="wb-tool-segment mb-2">
                  {(["none", "bearer", "basic"] as const).map((m) => (
                    <button key={m} onClick={() => setAuthMode(m)} disabled={running} className={cn(authMode === m && "is-active")}>
                      {m === "none" ? "无" : m === "bearer" ? "Bearer Token" : "Basic Auth"}
                    </button>
                  ))}
                </div>
                {authMode === "bearer" ? (
                  <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={running} placeholder="输入 Bearer Token" className="cfg-input w-full text-left" />
                ) : authMode === "basic" ? (
                  <div className="flex flex-col gap-2">
                    <input value={basicUser} onChange={(e) => setBasicUser(e.target.value)} disabled={running} placeholder="用户名" className="cfg-input w-full text-left" />
                    <input type="password" value={basicPass} onChange={(e) => setBasicPass(e.target.value)} disabled={running} placeholder="密码" className="cfg-input w-full text-left" />
                  </div>
                ) : (
                  <div className="flex min-h-[178px] items-center justify-center rounded-[12px] border border-dashed border-border-default/80 bg-bg-secondary/35 px-4 text-center text-[11px] text-text-disabled">
                    当前请求不附带认证信息；如需压测鉴权接口，可切换到 Bearer 或 Basic。
                  </div>
                )}
              </AdvancedSection>
            </div>
          </div>
        )}

        {/* ── Progress Bar ── */}
        {progress && (
          <div className="mt-3 px-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <span className="text-[11px] text-text-tertiary tabular-nums min-w-[72px] text-right">{progress.pct.toFixed(1)}% · {progress.label}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="min-h-[360px] flex-1 pt-3">
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Metrics Cards */}
        {(latestMetrics || summary) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <MetricCard label="RPS" value={summary ? summary.avgRps.toFixed(1) : latestMetrics ? latestMetrics.rps.toFixed(1) : "—"} icon={<Zap className="w-4 h-4" />} color="rose" sub={summary ? "平均" : "当前"} />
            <MetricCard label="平均延迟" value={`${(summary?.avgLatencyMs ?? latestMetrics?.avgLatencyMs ?? 0).toFixed(1)} ms`} icon={<Activity className="w-4 h-4" />} color="blue" sub={`P95: ${summary?.p95Ms ?? latestMetrics?.p95Ms ?? 0}ms`} />
            <MetricCard label="错误率" value={summary ? summary.totalRequests > 0 ? `${((summary.totalErrors / summary.totalRequests) * 100).toFixed(1)}%` : "0%" : `${errorRate}%`} icon={<AlertTriangle className="w-4 h-4" />} color={Number(errorRate) > 5 ? "red" : "emerald"} sub={`${summary?.totalErrors ?? latestMetrics?.totalErrors ?? 0} 错误`} />
            <MetricCard label="总请求" value={String(summary?.totalRequests ?? latestMetrics?.totalRequests ?? 0)} icon={<TrendingUp className="w-4 h-4" />} color="violet" sub={summary ? `${summary.totalDurationSecs.toFixed(1)}s` : running ? "运行中..." : "就绪"} />
          </div>
        )}

        {/* Charts */}
        {snapshots.length >= 2 && (
          <div className="wb-panel mb-3 overflow-hidden panel">
            <div className="flex items-center gap-1 px-4 py-2.5 bg-bg-secondary/40 border-b border-border-default">
              <BarChart3 className="w-4 h-4 text-text-tertiary mr-1" />
              <button onClick={() => setChartTab("rps")} className={cn("px-3 py-1 text-[12px] font-medium rounded-md transition-all", chartTab === "rps" ? "bg-rose-500/10 text-rose-600" : "text-text-tertiary hover:text-text-secondary")}>RPS</button>
              <button onClick={() => setChartTab("latency")} className={cn("px-3 py-1 text-[12px] font-medium rounded-md transition-all", chartTab === "latency" ? "bg-blue-500/10 text-blue-600" : "text-text-tertiary hover:text-text-secondary")}>延迟</button>
            </div>
            <div className="p-4">
              <MetricsChart data={snapshots} type={chartTab} height={220} />
            </div>
          </div>
        )}

        {/* Status Code Distribution */}
        {(latestMetrics || summary) && <StatusCodeBar codes={(summary ?? latestMetrics)!.statusCodes} />}

        {/* Empty State */}
        {!running && !summary && snapshots.length === 0 && !error && (
          <div className="wb-panel flex flex-col items-center justify-center px-6 py-16 text-text-disabled">
            <div className="w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center mb-5 border border-border-default shadow-sm">
              <Flame className="w-10 h-10 opacity-20 text-rose-500" />
            </div>
            <p className="text-[16px] font-semibold text-text-secondary">HTTP 压力测试</p>
            <p className="text-[13px] mt-1.5 text-text-tertiary">配置目标 URL、并发数和持续时间，然后点击「开始压测」</p>
            <div className="mt-6 grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
              <div className="wb-subpanel p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                  <Flame className="h-3.5 w-3.5 text-rose-500" />
                  目标与方法
                </div>
                <div className="mt-1 text-[10px] text-text-tertiary">先填写 URL，并选择要压测的 HTTP 方法。</div>
              </div>
              <div className="wb-subpanel p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                  <Zap className="h-3.5 w-3.5 text-rose-500" />
                  并发与时长
                </div>
                <div className="mt-1 text-[10px] text-text-tertiary">设置并发数、持续时间或请求数，决定压测强度。</div>
              </div>
              <div className="wb-subpanel p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                  <BarChart3 className="h-3.5 w-3.5 text-rose-500" />
                  结果分析
                </div>
                <div className="mt-1 text-[10px] text-text-tertiary">运行后会展示 RPS、延迟分布、错误率和状态码统计。</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function ControlBlock({
  icon,
  label,
  className,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("wb-subpanel p-3", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
        {icon ? <span className="text-text-tertiary">{icon}</span> : null}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wb-subpanel p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, icon, color, sub }: { label: string; value: string; icon: React.ReactNode; color: string; sub: string }) {
  const cm: Record<string, { bg: string; text: string; iconBg: string }> = {
    rose:    { bg: "from-rose-500/5 to-pink-500/5",       text: "text-rose-600",    iconBg: "bg-rose-500/10" },
    blue:    { bg: "from-blue-500/5 to-indigo-500/5",     text: "text-blue-600",    iconBg: "bg-blue-500/10" },
    emerald: { bg: "from-emerald-500/5 to-green-500/5",   text: "text-emerald-600", iconBg: "bg-emerald-500/10" },
    red:     { bg: "from-red-500/5 to-orange-500/5",      text: "text-red-600",     iconBg: "bg-red-500/10" },
    violet:  { bg: "from-violet-500/5 to-purple-500/5",   text: "text-violet-600",  iconBg: "bg-violet-500/10" },
  };
  const c = cm[color] || cm.rose;
  return (
    <div className={cn("wb-panel bg-gradient-to-br p-4 panel", c.bg)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", c.iconBg, c.text)}>{icon}</div>
      </div>
      <div className={cn("text-[22px] font-bold tabular-nums", c.text)}>{value}</div>
      <div className="text-[11px] text-text-disabled mt-1">{sub}</div>
    </div>
  );
}

function StatusCodeBar({ codes }: { codes: Record<number, number> }) {
  const entries = Object.entries(codes).map(([k, v]) => ({ code: Number(k), count: v })).sort((a, b) => b.count - a.count);
  if (entries.length === 0) return null;
  const total = entries.reduce((a, e) => a + e.count, 0);
  const maxCount = entries[0].count;

  const getColor = (c: number) => {
    if (c === 0) return "bg-gray-400";
    if (c < 200) return "bg-cyan-400";
    if (c < 300) return "bg-emerald-500";
    if (c < 400) return "bg-amber-500";
    if (c < 500) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="wb-panel overflow-hidden panel">
      <div className="px-4 py-2.5 bg-bg-secondary/40 border-b border-border-default flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-text-tertiary" />
        <span className="text-[13px] font-medium text-text-secondary">状态码分布</span>
        <span className="text-[11px] text-text-disabled ml-auto">{total} 请求</span>
      </div>
      <div className="p-4 space-y-2">
        {entries.map((e) => (
          <div key={e.code} className="flex items-center gap-3">
            <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded text-white min-w-[48px] text-center", getColor(e.code))}>{e.code === 0 ? "ERR" : e.code}</span>
            <div className="flex-1 h-5 bg-bg-input rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-500", getColor(e.code), "opacity-70")} style={{ width: `${(e.count / maxCount) * 100}%` }} />
            </div>
            <span className="text-[12px] font-mono text-text-secondary tabular-nums min-w-[60px] text-right">
              {e.count} <span className="text-text-disabled text-[10px]">({((e.count / total) * 100).toFixed(1)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
