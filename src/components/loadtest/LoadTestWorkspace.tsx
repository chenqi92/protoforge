import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Flame, Play, Square, Settings2, Activity, BarChart3, Clock,
  AlertTriangle, Zap, TrendingUp, ChevronDown, ChevronUp,
  Plus, Trash2, Download, Gauge, Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { MetricsChart } from "./MetricsChart";
import { ErrorSamplesPanel } from "./ErrorSamplesPanel";
import type { MetricsSnapshot, LoadTestComplete, LoadTestConfig, RequestRecord } from "@/types/loadtest";

type DurationMode = "duration" | "requests";
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type BodyMode = "none" | "json" | "raw";
type AuthMode = "none" | "bearer" | "basic";

const LOAD_TEST_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];
// Forge method-token text colors for the .pf-mtag method tag (text-only, per prototype).
const LOAD_TEST_METHOD_CLASSES: Record<HttpMethod, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  DELETE: "text-method-delete",
  PATCH: "text-method-patch",
};
const MAX_RETAINED_SNAPSHOTS = 3_600;
const LISTENER_RETRY_MS = 1_000;

export const LoadTestWorkspace = memo(function LoadTestWorkspace({ sessionId }: { sessionId?: string }) {
  const testId = useRef(sessionId ?? crypto.randomUUID()).current;
  return <LoadTestPanel tabId={testId} />;
});

LoadTestWorkspace.displayName = "LoadTestWorkspace";

function LoadTestPanel({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  // ─── Config ───
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [concurrency, setConcurrency] = useState(10);
  const [durationMode, setDurationMode] = useState<DurationMode>("duration");
  const [durationSecs, setDurationSecs] = useState(10);
  const [totalRequests, setTotalRequests] = useState(100);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [rpsLimit, setRpsLimit] = useState<number | null>(null);
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [latencyThreshold, setLatencyThreshold] = useState(500);
  const [rpsEnabled, setRpsEnabled] = useState(false);

  // Advanced config
  const [showConfig, setShowConfig] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMethodMenu, setShowMethodMenu] = useState(false);
  const [methodMenuPos, setMethodMenuPos] = useState({ top: 0, left: 0 });
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
  const [errorSamples, setErrorSamples] = useState<RequestRecord[]>([]);
  const [summary, setSummary] = useState<LoadTestComplete | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<"rps" | "latency" | "error" | "throughput" | "concurrency" | "scatter" | "errorSamples">("rps");
  const methodMenuAnchorRef = useRef<HTMLButtonElement>(null);

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
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const { popLoadTestConfig, subscribeLoadTestPrefill } = await import("@/lib/loadTestBridge");
      if (disposed) return;
      applyPrefill(popLoadTestConfig());
      const unsubscribe = subscribeLoadTestPrefill((prefill) => {
        if (!disposed) applyPrefill(prefill);
      });
      if (disposed) unsubscribe();
      else cleanup = unsubscribe;
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [applyPrefill]);

  // Listen events
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const activeUnlisteners: Array<() => void> = [];

    const clearListeners = () => {
      for (const unlisten of activeUnlisteners.splice(0)) unlisten();
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void setup();
      }, LISTENER_RETRY_MS);
    };

    const setup = async () => {
      try {
        const { onLoadTestMetrics, onLoadTestComplete } = await import("@/services/loadTestService");
        if (disposed) return;

        const listeners = await Promise.allSettled([
          onLoadTestMetrics((s) => {
            if (disposed || s.testId !== tabId) return;
            setSnapshots((prev) => {
              const next = [...prev, s];
              return next.length > MAX_RETAINED_SNAPSHOTS
                ? next.slice(-MAX_RETAINED_SNAPSHOTS)
                : next;
            });
            setLatestMetrics(s);
            if (s.errorSamples && s.errorSamples.length > 0) {
              setErrorSamples((prev) => {
                const next = [...prev, ...s.errorSamples];
                return next.length > 200 ? next.slice(-200) : next;
              });
            }
          }),
          onLoadTestComplete((r) => {
            if (disposed || r.testId !== tabId) return;
            setSummary(r);
            setRunning(false);
          }),
        ]);

        const installed = listeners.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        if (disposed || listeners.some((result) => result.status === "rejected")) {
          for (const unlisten of installed) unlisten();
          scheduleRetry();
          return;
        }

        activeUnlisteners.push(...installed);
      } catch {
        scheduleRetry();
      }
    };
    void setup();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearListeners();
    };
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
      ...(thresholdEnabled && latencyThreshold > 0 ? { latencyThresholdMs: latencyThreshold } : {}),
    };
  }, [url, method, headers, bodyMode, bodyContent, authMode, bearerToken, basicUser, basicPass, concurrency, timeoutMs, durationMode, durationSecs, totalRequests, rpsEnabled, rpsLimit, thresholdEnabled, latencyThreshold]);

  const handleStart = useCallback(async () => {
    setError(null); setSnapshots([]); setErrorSamples([]); setSummary(null); setLatestMetrics(null); setRunning(true);
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
  const handleExportJson = useCallback(async () => {
    const data = { config: buildConfig(), summary, snapshots };
    const defaultName = `loadtest-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, JSON.stringify(data, null, 2));
  }, [summary, snapshots, buildConfig]);

  const handleExportCsv = useCallback(async () => {
    if (snapshots.length === 0) return;
    const csvHeaders = ["elapsed_secs","total_requests","total_errors","rps","avg_latency_ms","min_latency_ms","max_latency_ms","p50_ms","p95_ms","p99_ms","bytes_downloaded","active_connections","ttfb_avg_ms"];
    const rows = snapshots.map(s => [s.elapsedSecs,s.totalRequests,s.totalErrors,s.rps.toFixed(2),s.avgLatencyMs.toFixed(2),s.minLatencyMs,s.maxLatencyMs,s.p50Ms,s.p95Ms,s.p99Ms,s.bytesDownloaded,s.activeConnections,s.ttfbAvgMs.toFixed(2)].join(","));
    const csv = [csvHeaders.join(","), ...rows].join("\n");
    const defaultName = `loadtest-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, csv);
  }, [snapshots]);

  // ─── Progress ───
  const progress = useMemo(() => {
    if (!running || !latestMetrics) return null;
    if (durationMode === "duration") {
      const pct = Math.min(100, (latestMetrics.elapsedSecs / durationSecs) * 100);
      const remaining = Math.max(0, durationSecs - latestMetrics.elapsedSecs);
      return { pct, label: t('loadtest.remainingTime', { time: remaining }) };
    } else {
      const pct = Math.min(100, (latestMetrics.totalRequests / totalRequests) * 100);
      const remaining = Math.max(0, totalRequests - latestMetrics.totalRequests);
      return { pct, label: t('loadtest.remainingRequests', { count: remaining }) };
    }
  }, [running, latestMetrics, durationMode, durationSecs, totalRequests]);

  const errorRate = latestMetrics
    ? latestMetrics.totalRequests > 0
      ? ((latestMetrics.totalErrors / latestMetrics.totalRequests) * 100).toFixed(1)
      : "0.0"
    : "—";

  const toggleMethodMenu = useCallback((anchor?: HTMLElement | null) => {
    const anchorEl = anchor ?? methodMenuAnchorRef.current;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setMethodMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 200) });
    }
    setShowMethodMenu((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-transparent p-3">
      <div className="shrink-0 space-y-2">
        <div className="wb-request-shell">
          <button
            ref={methodMenuAnchorRef}
            onClick={(event) => toggleMethodMenu(event.currentTarget)}
            className="wb-protocol-dropdown"
            title={t('loadtest.method')}
          >
            <span className="wb-protocol-dropdown-icon text-accent">
              <Flame className="h-3.5 w-3.5" />
            </span>
            <span className={cn("wb-protocol-dropdown-label pf-mtag pf-text-3xs", LOAD_TEST_METHOD_CLASSES[method])}>{method}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <div className="wb-request-main">
            <span className="wb-request-label">{t('loadtest.targetUrl')}</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('loadtest.urlPlaceholder')}
              disabled={running}
              className="wb-request-input disabled:opacity-60"
            />
          </div>
          <div className="wb-request-actions">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="wb-ghost-btn"
              title={t('loadtest.configTitle')}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {showConfig ? t('common.hide', { defaultValue: '收起' }) : t('common.show', { defaultValue: '展开' })}
            </button>
            <button
              onClick={running ? handleStop : handleStart}
              disabled={!url.trim()}
              className={cn(
                "wb-primary-btn",
                running
                  ? "bg-error hover:bg-error/90"
                  : "bg-accent hover:bg-accent-hover"
              )}
            >
              {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {running ? t('loadtest.stop') : t('loadtest.start')}
            </button>
          </div>
        </div>

        <div className="wb-request-secondary">
          <span className={cn("pf-pill", running ? "info" : "")}>
            <span className={cn("pf-dot", running ? "s-run" : "s-idle")} />
            {running ? t('loadtest.running') : t('loadtest.idle')}
          </span>
          <span className="wb-request-meta">
            <Settings2 className="h-3 w-3" />
            {t('loadtest.concurrency')} {concurrency}
          </span>
          <span className="wb-request-meta">
            <Clock className="h-3 w-3" />
            {durationMode === "duration"
              ? `${durationSecs}s`
              : `${totalRequests} ${t('loadtest.requests')}`}
          </span>
          {progress ? <span className="wb-request-meta">{progress.label}</span> : null}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="wb-request-meta transition-colors hover:bg-bg-hover"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {t('loadtest.advancedConfig')}
          </button>
          {(summary || snapshots.length > 0) && (
            <>
              <button onClick={handleExportJson} className="wb-request-meta transition-colors hover:bg-bg-hover" title={t('loadtest.exportJson')}>
                <Download className="w-3 h-3" /> JSON
              </button>
              <button onClick={handleExportCsv} className="wb-request-meta transition-colors hover:bg-bg-hover" title={t('loadtest.exportCsv')}>
                <Download className="w-3 h-3" /> CSV
              </button>
            </>
          )}
        </div>

        {showMethodMenu ? (
          <>
            <div className="fixed inset-0 z-[220]" onClick={() => setShowMethodMenu(false)} />
            <div
              className="wb-protocol-menu fixed z-[221] w-[200px]"
              style={{ top: methodMenuPos.top, left: methodMenuPos.left }}
            >
              <div className="px-2.5 pb-0.5 pt-1.5 pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-disabled">
                {t('loadtest.method')}
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                {LOAD_TEST_METHODS.map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setMethod(item);
                      setShowMethodMenu(false);
                    }}
                    className={cn("wb-protocol-menu-item", item === method && "bg-bg-hover")}
                  >
                    <span className="wb-protocol-menu-icon text-accent">
                      <Flame className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block pf-mtag pf-text-3xs", LOAD_TEST_METHOD_CLASSES[item])}>{item}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <div className="wb-panel p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2 pf-text-sm font-semibold text-text-primary">
              <Settings2 className="h-3.5 w-3.5 text-accent" />
              {t('loadtest.configTitle')}
            </div>
            <span className="pf-text-xs text-text-tertiary">
              {showAdvanced ? t('loadtest.advancedConfig') : t('loadtest.basicConfig', { defaultValue: '基础配置' })}
            </span>
          </div>

          {showConfig && (
          <>
          <div className="grid gap-3 pt-3 sm:grid-cols-2 xl:grid-cols-5">
            <ControlBlock label={t('loadtest.concurrency')} icon={<Settings2 className="h-3 w-3" />}>
              <input type="number" value={concurrency} onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} max={500} className="cfg-input w-full text-left" />
            </ControlBlock>

            <ControlBlock label={t('loadtest.endCondition')} className="sm:col-span-2" icon={<Clock className="h-3 w-3" />}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="wb-tool-segment">
                  <button onClick={() => setDurationMode("duration")} disabled={running} className={cn(durationMode === "duration" && "is-active")}>{t('loadtest.duration')}</button>
                  <button onClick={() => setDurationMode("requests")} disabled={running} className={cn(durationMode === "requests" && "is-active")}>{t('loadtest.requestCount')}</button>
                </div>
                {durationMode === "duration" ? (
                  <>
                    <input type="number" value={durationSecs} onChange={(e) => setDurationSecs(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-20 text-left" />
                    <span className="pf-text-xs text-text-tertiary">{t('loadtest.seconds')}</span>
                  </>
                ) : (
                  <>
                    <input type="number" value={totalRequests} onChange={(e) => setTotalRequests(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-24 text-left" />
                    <span className="pf-text-xs text-text-tertiary">{t('loadtest.requests')}</span>
                  </>
                )}
              </div>
            </ControlBlock>

            <ControlBlock label={t('loadtest.timeout')} icon={<Clock className="h-3 w-3" />}>
              <div className="flex items-center gap-2">
                <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Math.max(1000, parseInt(e.target.value) || 1000))} disabled={running} min={1000} className="cfg-input w-full text-left" />
                <span className="pf-text-xs text-text-tertiary">ms</span>
              </div>
            </ControlBlock>

            <ControlBlock label={t('loadtest.rateLimit')} icon={<Gauge className="h-3 w-3" />}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 pf-text-xs text-text-secondary">
                  <input type="checkbox" checked={rpsEnabled} onChange={(e) => setRpsEnabled(e.target.checked)} disabled={running} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                  {t('loadtest.enableRpsLimit')}
                </label>
                {rpsEnabled ? (
                  <div className="flex items-center gap-2">
                    <input type="number" value={rpsLimit ?? 100} onChange={(e) => setRpsLimit(Math.max(1, parseInt(e.target.value) || 1))} disabled={running} min={1} className="cfg-input w-full text-left" />
                    <span className="pf-text-xs text-text-tertiary">req/s</span>
                  </div>
                ) : (
                  <div className="pf-text-xs text-text-disabled">{t('loadtest.noRateLimitDesc')}</div>
                )}
              </div>
            </ControlBlock>

            <ControlBlock label={t('loadtest.latencyThreshold', '延迟阈值')} icon={<AlertTriangle className="h-3 w-3" />}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 pf-text-xs text-text-secondary">
                  <input type="checkbox" checked={thresholdEnabled} onChange={(e) => setThresholdEnabled(e.target.checked)} disabled={running} className="h-3.5 w-3.5 accent-[var(--color-warning)]" />
                  {t('loadtest.enableThreshold', '启用延迟阈值断言')}
                </label>
                {thresholdEnabled ? (
                  <div className="flex items-center gap-2">
                    <input type="number" value={latencyThreshold} onChange={(e) => setLatencyThreshold(Math.max(1, parseInt(e.target.value) || 500))} disabled={running} min={1} className="cfg-input w-full text-left" />
                    <span className="pf-text-xs text-text-tertiary">ms</span>
                  </div>
                ) : (
                  <div className="pf-text-xs text-text-disabled">{t('loadtest.noThresholdDesc', '未启用延迟阈值，仅状态码 ≥ 400 视为失败')}</div>
                )}
              </div>
            </ControlBlock>
          </div>
          {showAdvanced && (
            <div className="mt-3 border-t border-border-default/60 pt-3 animate-in slide-in-from-top-1 duration-150">
              <div className="grid gap-3 xl:grid-cols-[1.35fr_0.95fr_0.95fr]">
                <AdvancedSection title={t('loadtest.headersTitle')}>
                  {headers.map((h, i) => (
                    <div key={i} className="mb-2 flex items-center gap-2">
                      <input value={h.key} onChange={(e) => { const n = [...headers]; n[i].key = e.target.value; setHeaders(n); }} disabled={running} placeholder="Header Key" className="cfg-input flex-1 text-left" />
                      <input value={h.value} onChange={(e) => { const n = [...headers]; n[i].value = e.target.value; setHeaders(n); }} disabled={running} placeholder="Header Value" className="cfg-input flex-1 text-left" />
                      <button onClick={() => setHeaders(headers.filter((_, j) => j !== i))} disabled={running || headers.length <= 1} aria-label={t('common.delete')} className="wb-icon-btn shrink-0 hover:text-error disabled:opacity-50"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button onClick={() => setHeaders([...headers, { key: "", value: "" }])} disabled={running} className="wb-ghost-btn"><Plus className="w-3 h-3" />{t('loadtest.addHeader')}</button>
                </AdvancedSection>

                <AdvancedSection title={t('loadtest.bodyTitle')}>
                  <div className="wb-tool-segment mb-2">
                    {(["none", "json", "raw"] as const).map((m) => (
                      <button key={m} onClick={() => setBodyMode(m)} disabled={running} className={cn(bodyMode === m && "is-active")}>
                        {m === "none" ? t('loadtest.bodyNone') : m.toUpperCase()}
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
                      className="w-full resize-y pf-rounded-md border border-border-default bg-bg-input px-3 py-2 pf-text-sm font-mono outline-none focus:border-accent disabled:opacity-60"
                    />
                  ) : (
                    <div className="flex min-h-[178px] items-center justify-center pf-rounded-md border border-dashed border-border-default/80 bg-bg-secondary/20 px-4 text-center pf-text-xs text-text-disabled">
                      {t('loadtest.bodyEmptyHint')}
                    </div>
                  )}
                </AdvancedSection>

                <AdvancedSection title={t('loadtest.authTitle')}>
                  <div className="wb-tool-segment mb-2">
                    {(["none", "bearer", "basic"] as const).map((m) => (
                      <button key={m} onClick={() => setAuthMode(m)} disabled={running} className={cn(authMode === m && "is-active")}>
                        {m === "none" ? t('loadtest.authNone') : m === "bearer" ? "Bearer Token" : "Basic Auth"}
                      </button>
                    ))}
                  </div>
                  {authMode === "bearer" ? (
                    <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} disabled={running} placeholder={t('loadtest.bearerPlaceholder')} className="cfg-input w-full text-left" />
                  ) : authMode === "basic" ? (
                    <div className="flex flex-col gap-2">
                      <input value={basicUser} onChange={(e) => setBasicUser(e.target.value)} disabled={running} placeholder={t('loadtest.usernamePlaceholder')} className="cfg-input w-full text-left" />
                      <input type="password" value={basicPass} onChange={(e) => setBasicPass(e.target.value)} disabled={running} placeholder={t('loadtest.passwordPlaceholder')} className="cfg-input w-full text-left" />
                    </div>
                  ) : (
                    <div className="flex min-h-[178px] items-center justify-center pf-rounded-md border border-dashed border-border-default/80 bg-bg-secondary/20 px-4 text-center pf-text-xs text-text-disabled">
                      {t('loadtest.authEmptyHint')}
                    </div>
                  )}
                </AdvancedSection>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* ── Progress Bar ── */}
        {progress && (
          <div className="mt-3 px-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-2 bg-bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <span className="pf-text-xs text-text-tertiary tabular-nums min-w-[72px] text-right">{progress.pct.toFixed(1)}% · {progress.label}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-col pt-3 pb-6 mt-3">
        {error && (
          <div className="mb-3 flex items-center gap-2 pf-rounded-md border border-error/25 bg-error/10 px-4 py-2.5 pf-text-base text-error">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {/* Metrics Cards */}
        {(latestMetrics || summary) && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3">
            <MetricCard label="RPS" value={summary ? summary.avgRps.toFixed(1) : latestMetrics ? latestMetrics.rps.toFixed(1) : "—"} icon={<Zap className="w-4 h-4" />} color="rose" sub={summary ? t('loadtest.average') : t('loadtest.current')} />
            <MetricCard label={t('loadtest.avgLatency')} value={`${(summary?.avgLatencyMs ?? latestMetrics?.avgLatencyMs ?? 0).toFixed(1)} ms`} icon={<Activity className="w-4 h-4" />} color="blue" sub={`P50: ${summary?.p50Ms ?? latestMetrics?.p50Ms ?? 0}ms · P95: ${summary?.p95Ms ?? latestMetrics?.p95Ms ?? 0}ms`} />
            <MetricCard label={t('loadtest.errorRate')} value={summary ? summary.totalRequests > 0 ? `${((summary.totalErrors / summary.totalRequests) * 100).toFixed(1)}%` : "0%" : `${errorRate}%`} icon={<AlertTriangle className="w-4 h-4" />} color={Number(errorRate) > 5 ? "red" : "emerald"} sub={t('loadtest.errors', { count: summary?.totalErrors ?? latestMetrics?.totalErrors ?? 0 })} />
            <MetricCard label={t('loadtest.totalRequests')} value={String(summary?.totalRequests ?? latestMetrics?.totalRequests ?? 0)} icon={<TrendingUp className="w-4 h-4" />} color="violet" sub={summary ? `${summary.totalDurationSecs.toFixed(1)}s` : running ? t('loadtest.runningStatus') : t('loadtest.readyStatus')} />
            <MetricCard label={t('loadtest.throughput')} value={formatBytes(summary ? summary.avgThroughputBps : latestMetrics?.bytesDownloaded ?? 0)} icon={<Wifi className="w-4 h-4" />} color="cyan" sub={summary ? t('loadtest.average') + "/s" : t('loadtest.current') + "/s"} />
            <MetricCard label="TTFB" value={`${(latestMetrics?.ttfbAvgMs ?? 0).toFixed(1)} ms`} icon={<Clock className="w-4 h-4" />} color="amber" sub={`${t('loadtest.concurrency')}: ${latestMetrics?.activeConnections ?? 0}`} />
          </div>
        )}

        {/* Charts */}
        {snapshots.length >= 2 && (
          <div className="wb-panel mb-3 overflow-hidden panel">
            <div className="flex items-center gap-1 px-3 h-[33px] border-b border-border-default overflow-x-auto">
              <BarChart3 className="w-3.5 h-3.5 text-text-tertiary mr-1 shrink-0" />
              {([
                { key: "rps" as const, label: "RPS", activeColor: "text-accent" },
                { key: "latency" as const, label: t('loadtest.latency'), activeColor: "text-info" },
                { key: "error" as const, label: t('loadtest.errorRate'), activeColor: "text-error" },
                { key: "throughput" as const, label: t('loadtest.throughput'), activeColor: "text-method-head" },
                { key: "concurrency" as const, label: t('loadtest.concurrency'), activeColor: "text-success" },
                { key: "scatter" as const, label: t('loadtest.scatterPlot'), activeColor: "text-accent" },
                ...(errorSamples.length > 0 ? [{ key: "errorSamples" as const, label: t('loadtest.errorSamples', '错误样本'), activeColor: "text-error" }] : []),
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setChartTab(tab.key)}
                  className={cn(
                    "relative px-3 py-1 pf-text-sm font-medium transition-colors whitespace-nowrap",
                    chartTab === tab.key ? tab.activeColor : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {tab.label}
                  {tab.key === "errorSamples" && <span className="ml-1 pf-text-3xs bg-error/15 text-error px-1.5 py-0.5 rounded-full tabular-nums">{errorSamples.length}</span>}
                  {chartTab === tab.key ? <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" /> : null}
                </button>
              ))}
            </div>
            <div className="p-3">
              {chartTab === "errorSamples" ? (
                <ErrorSamplesPanel samples={errorSamples} />
              ) : (
                <MetricsChart data={snapshots} type={chartTab} height={220} />
              )}
            </div>
          </div>
        )}

        {/* Status Code Distribution */}
        {(latestMetrics || summary) && <StatusCodeBar codes={(summary ?? latestMetrics)!.statusCodes} />}

        {/* Empty State */}
        {!running && !summary && snapshots.length === 0 && !error && (
          <div className="wb-panel flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-text-disabled">
            <div className="w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center mb-5 border border-border-default shadow-sm">
              <Flame className="w-10 h-10 opacity-20 text-accent" />
            </div>
            <p className="pf-text-xl font-semibold text-text-secondary">{t('loadtest.emptyTitle')}</p>
            <p className="pf-text-base mt-1.5 text-text-tertiary">{t('loadtest.emptyDesc')}</p>
            <div className="mt-6 grid w-full max-w-3xl gap-4 text-left sm:grid-cols-3">
              <div className="border-t border-border-default/60 pt-3">
                <div className="flex items-center gap-2 pf-text-xs font-semibold text-text-secondary">
                  <Flame className="h-3.5 w-3.5 text-accent" />
                  {t('loadtest.emptyTarget')}
                </div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('loadtest.emptyTargetDesc')}</div>
              </div>
              <div className="border-t border-border-default/60 pt-3">
                <div className="flex items-center gap-2 pf-text-xs font-semibold text-text-secondary">
                  <Zap className="h-3.5 w-3.5 text-accent" />
                  {t('loadtest.emptyConcurrency')}
                </div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('loadtest.emptyConcurrencyDesc')}</div>
              </div>
              <div className="border-t border-border-default/60 pt-3">
                <div className="flex items-center gap-2 pf-text-xs font-semibold text-text-secondary">
                  <BarChart3 className="h-3.5 w-3.5 text-accent" />
                  {t('loadtest.emptyResult')}
                </div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('loadtest.emptyResultDesc')}</div>
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
    <div className={cn("pf-rounded-md border border-border-default/60 bg-bg-secondary/24 p-3", className)}>
      <div className="mb-2 flex items-center gap-1.5 pf-text-xs font-semibold text-text-secondary">
        {icon ? <span className="text-text-tertiary">{icon}</span> : null}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/24 p-3">
      <div className="mb-2 pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function MetricCard({ label, value, icon, color, sub }: { label: string; value: string; icon: React.ReactNode; color: string; sub: string }) {
  // Forge .metric look: neutral surface, mlabel (11px uppercase) over a 22px mono
  // mval. Per prototype only the semantically-loaded cards tint the value; the
  // rest stay text-primary. `icon` kept as a faint glyph beside the label.
  const valueTone: Record<string, string> = {
    rose:    "text-accent",
    blue:    "text-text-primary",
    emerald: "text-success",
    red:     "text-error",
    violet:  "text-text-primary",
    cyan:    "text-text-primary",
    amber:   "text-text-primary",
  };
  const tone = valueTone[color] ?? "text-text-primary";
  return (
    <div className="pf-rounded-md border border-border-default bg-bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-1.5 pf-text-xxs font-semibold uppercase tracking-[0.05em] text-text-tertiary">
        <span className="text-text-disabled [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-0.5 pf-text-3xl font-bold tabular-nums font-mono tracking-tight leading-tight", tone)}>{value}</div>
      <div className="pf-text-xxs text-text-disabled mt-0.5 truncate">{sub}</div>
    </div>
  );
}

function StatusCodeBar({ codes }: { codes: Record<number, number> }) {
  const { t } = useTranslation();
  const entries = Object.entries(codes).map(([k, v]) => ({ code: Number(k), count: v })).sort((a, b) => b.count - a.count);
  if (entries.length === 0) return null;
  const total = entries.reduce((a, e) => a + e.count, 0);
  const maxCount = entries[0].count;

  // Forge status-token mapping. `bar` is the solid token used for the meter fill;
  // `badge` keeps the code legible as token-text over a soft token surface (matches
  // the capture status pill + prototype's semantic-text coding — no white-on-solid).
  const codeTone = (c: number): { bar: string; badge: string } => {
    if (c === 0) return { bar: "bg-method-options", badge: "text-text-tertiary bg-bg-tertiary" };
    if (c < 200) return { bar: "bg-method-head", badge: "text-method-head bg-method-head/10" };
    if (c < 300) return { bar: "bg-success", badge: "text-success bg-success/10" };
    if (c < 400) return { bar: "bg-warning", badge: "text-warning bg-warning/10" };
    if (c < 500) return { bar: "bg-accent", badge: "text-accent bg-accent-soft" };
    return { bar: "bg-error", badge: "text-error bg-error/10" };
  };

  return (
    <div className="wb-panel overflow-hidden panel">
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-2.5">
        <BarChart3 className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="pf-text-sm font-semibold text-text-primary">{t('loadtest.statusCodeDist')}</span>
        <span className="pf-text-xs tabular-nums text-text-tertiary ml-auto">{t('loadtest.totalRequestsLabel', { count: total })}</span>
      </div>
      <div className="p-3 space-y-2">
        {entries.map((e) => {
          const tone = codeTone(e.code);
          return (
          <div key={e.code} className="flex items-center gap-3">
            <span className={cn("pf-text-3xs font-bold px-2 py-0.5 pf-rounded-xs font-mono min-w-[48px] text-center tabular-nums", tone.badge)}>{e.code === 0 ? "ERR" : e.code}</span>
            <div className="flex-1 h-4 bg-bg-inset rounded overflow-hidden">
              <div className={cn("h-full rounded transition-[width] duration-300", tone.bar, "opacity-80")} style={{ width: `${(e.count / maxCount) * 100}%` }} /></div>
            <span className="pf-text-xs font-mono text-text-secondary tabular-nums min-w-[60px] text-right">
              {e.count} <span className="text-text-disabled pf-text-3xs">({((e.count / total) * 100).toFixed(1)}%)</span>
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
