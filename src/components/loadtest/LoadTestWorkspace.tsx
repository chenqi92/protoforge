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

  // ─── Read prefill config from bridge ───
  useEffect(() => {
    (async () => {
      const { popLoadTestConfig } = await import("@/lib/loadTestBridge");
      const prefill = popLoadTestConfig();
      if (!prefill) return;

      if (prefill.url) setUrl(prefill.url);
      if (prefill.method) setMethod(prefill.method as HttpMethod);
      if (prefill.timeoutMs) setTimeoutMs(prefill.timeoutMs);

      // Headers
      if (prefill.headers && Object.keys(prefill.headers).length > 0) {
        const h = Object.entries(prefill.headers).map(([key, value]) => ({ key, value }));
        setHeaders([...h, { key: "", value: "" }]);
        setShowAdvanced(true);
      }

      // Body
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

      // Auth
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
    })();
  }, []); // run once on mount

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
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* ── Top Config Bar ── */}
      <div className="shrink-0 p-4 pb-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-rose-500/30 focus-within:border-rose-500 transition-all p-1">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
            disabled={running}
            className="h-full px-3 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-rose-500 border-none outline-none cursor-pointer disabled:opacity-60 appearance-none text-center min-w-[80px]"
          >
            {(["GET", "POST", "PUT", "DELETE", "PATCH"] as const).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="输入目标 URL"
            disabled={running}
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-60"
          />
          <button
            onClick={running ? handleStop : handleStart}
            disabled={!url.trim()}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all active:scale-[0.98]",
              running
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
                : "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 hover:shadow-md disabled:opacity-50"
            )}
          >
            {running ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {running ? "停止" : "开始压测"}
          </button>
        </div>

        {/* Config Row */}
        <div className="flex items-center gap-4 mt-2 px-1 flex-wrap">
          <ConfigItem icon={<Settings2 />} label="并发数">
            <input type="number" value={concurrency} onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} max={500} className="cfg-input w-16" />
          </ConfigItem>

          <div className="w-px h-4 bg-border-default" />

          <div className="flex items-center gap-2">
            <div className="flex bg-bg-secondary p-0.5 rounded-md">
              <button onClick={() => setDurationMode("duration")} disabled={running} className={cn("px-2.5 py-1 text-[11px] font-medium rounded transition-all", durationMode === "duration" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary")}>持续时间</button>
              <button onClick={() => setDurationMode("requests")} disabled={running} className={cn("px-2.5 py-1 text-[11px] font-medium rounded transition-all", durationMode === "requests" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary")}>请求数</button>
            </div>
            {durationMode === "duration" ? (
              <ConfigItem label="" bare><input type="number" value={durationSecs} onChange={(e) => setDurationSecs(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-16" /><span className="text-[11px] text-text-tertiary">秒</span></ConfigItem>
            ) : (
              <ConfigItem label="" bare><input type="number" value={totalRequests} onChange={(e) => setTotalRequests(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-20" /><span className="text-[11px] text-text-tertiary">次</span></ConfigItem>
            )}
          </div>

          <div className="w-px h-4 bg-border-default" />

          <ConfigItem icon={<Clock />} label="超时">
            <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Math.max(1000, parseInt(e.target.value) || 1000))} disabled={running} min={1000} className="cfg-input w-20" />
            <span className="text-[11px] text-text-tertiary">ms</span>
          </ConfigItem>

          <div className="w-px h-4 bg-border-default" />

          <div className="flex items-center gap-1.5">
            <Gauge className="w-3 h-3 text-text-tertiary" />
            <label className="text-[11px] text-text-tertiary flex items-center gap-1">
              <input type="checkbox" checked={rpsEnabled} onChange={(e) => setRpsEnabled(e.target.checked)} disabled={running} className="w-3 h-3 accent-rose-500" />
              限速
            </label>
            {rpsEnabled && (
              <>
                <input type="number" value={rpsLimit ?? 100} onChange={(e) => setRpsLimit(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-20" />
                <span className="text-[11px] text-text-tertiary">req/s</span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="h-7 px-2.5 flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-bg-hover rounded-md transition-colors"
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              高级配置
            </button>
            {(summary || snapshots.length > 0) && (
              <>
                <button onClick={handleExportJson} className="h-7 px-2.5 flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-rose-600 hover:bg-rose-500/5 rounded-md transition-colors" title="导出 JSON">
                  <Download className="w-3 h-3" />JSON
                </button>
                <button onClick={handleExportCsv} className="h-7 px-2.5 flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-rose-600 hover:bg-rose-500/5 rounded-md transition-colors" title="导出 CSV">
                  <Download className="w-3 h-3" />CSV
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Advanced Config Panel ── */}
        {showAdvanced && (
          <div className="mt-2 bg-bg-primary rounded-xl border border-border-default p-3 space-y-3 animate-in slide-in-from-top-1 duration-150">
            {/* Headers */}
            <AdvancedSection title="请求头 (Headers)">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <input value={h.key} onChange={(e) => { const n = [...headers]; n[i].key = e.target.value; setHeaders(n); }} disabled={running} placeholder="Key" className="cfg-input flex-1" />
                  <input value={h.value} onChange={(e) => { const n = [...headers]; n[i].value = e.target.value; setHeaders(n); }} disabled={running} placeholder="Value" className="cfg-input flex-1" />
                  <button onClick={() => setHeaders(headers.filter((_, j) => j !== i))} disabled={running || headers.length <= 1} className="w-6 h-6 flex items-center justify-center text-text-disabled hover:text-red-500 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <button onClick={() => setHeaders([...headers, { key: "", value: "" }])} disabled={running} className="text-[11px] text-accent hover:underline flex items-center gap-0.5"><Plus className="w-3 h-3" />添加</button>
            </AdvancedSection>

            {/* Body */}
            <AdvancedSection title="请求体 (Body)">
              <div className="flex items-center gap-1 mb-2">
                {(["none", "json", "raw"] as const).map((m) => (
                  <button key={m} onClick={() => setBodyMode(m)} disabled={running} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-all", bodyMode === m ? "bg-rose-500/10 text-rose-600" : "text-text-tertiary hover:bg-bg-hover")}>
                    {m === "none" ? "无" : m.toUpperCase()}
                  </button>
                ))}
              </div>
              {bodyMode !== "none" && (
                <textarea
                  value={bodyContent}
                  onChange={(e) => setBodyContent(e.target.value)}
                  disabled={running}
                  placeholder={bodyMode === "json" ? '{"key": "value"}' : "raw body content"}
                  rows={4}
                  className="w-full px-3 py-2 text-[12px] font-mono bg-bg-input border border-border-default rounded-lg outline-none focus:border-rose-500 resize-y disabled:opacity-60"
                />
              )}
            </AdvancedSection>

            {/* Auth */}
            <AdvancedSection title="认证 (Auth)">
              <div className="flex items-center gap-1 mb-2">
                {(["none", "bearer", "basic"] as const).map((m) => (
                  <button key={m} onClick={() => setAuthMode(m)} disabled={running} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-all", authMode === m ? "bg-rose-500/10 text-rose-600" : "text-text-tertiary hover:bg-bg-hover")}>
                    {m === "none" ? "无" : m === "bearer" ? "Bearer Token" : "Basic Auth"}
                  </button>
                ))}
              </div>
              {authMode === "bearer" && (
                <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={running} placeholder="输入 Bearer Token" className="cfg-input w-full" />
              )}
              {authMode === "basic" && (
                <div className="flex items-center gap-2">
                  <input value={basicUser} onChange={(e) => setBasicUser(e.target.value)} disabled={running} placeholder="用户名" className="cfg-input flex-1" />
                  <input type="password" value={basicPass} onChange={(e) => setBasicPass(e.target.value)} disabled={running} placeholder="密码" className="cfg-input flex-1" />
                </div>
              )}
            </AdvancedSection>
          </div>
        )}

        {/* ── Progress Bar ── */}
        {progress && (
          <div className="mt-2 px-1">
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
      <div className="flex-1 overflow-auto p-4 pt-2">
        {error && (
          <div className="mb-3 px-4 py-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-[13px] text-red-600 dark:text-red-400 flex items-center gap-2">
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
          <div className="bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden mb-3 panel">
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
          <div className="flex flex-col items-center justify-center py-20 text-text-disabled">
            <div className="w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center mb-5 border border-border-default shadow-sm">
              <Flame className="w-10 h-10 opacity-20 text-rose-500" />
            </div>
            <p className="text-[16px] font-semibold text-text-secondary">HTTP 压力测试</p>
            <p className="text-[13px] mt-1.5 text-text-tertiary">配置目标 URL、并发数和持续时间，然后点击「开始压测」</p>
            <div className="flex items-center gap-6 mt-6 text-[12px] text-text-disabled">
              <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> 实时 RPS</span>
              <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> 延迟分布</span>
              <span className="flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" /> 状态码统计</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function ConfigItem({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode; bare?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className="w-3.5 h-3.5 text-text-tertiary [&>svg]:w-3 [&>svg]:h-3">{icon}</span>}
      {label && <label className="text-[11px] text-text-tertiary font-medium">{label}</label>}
      {children}
    </div>
  );
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-text-tertiary mb-1.5 uppercase tracking-wider">{title}</div>
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
    <div className={cn("bg-gradient-to-br border border-border-default rounded-xl p-4 panel shadow-sm", c.bg)}>
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
    <div className="bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
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
