// 抓包工作区 — 类似 Chrome DevTools Network 面板
// 提供代理控制、请求列表、详情面板等功能

import { useEffect, useCallback, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Trash2, Shield, Search,
  ArrowUpDown, X, Lightbulb, Clock, Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useCaptureStore, destroyCaptureStore } from "@/stores/captureStore";
import type { CapturedEntry } from "@/types/capture";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";

// ── HTTP Method 颜色 ──
const methodColors: Record<string, { text: string; bg: string }> = {
  GET: { text: "text-emerald-600", bg: "bg-emerald-500/15" },
  POST: { text: "text-amber-600", bg: "bg-amber-500/15" },
  PUT: { text: "text-blue-600", bg: "bg-blue-500/15" },
  DELETE: { text: "text-red-600", bg: "bg-red-500/15" },
  PATCH: { text: "text-violet-600", bg: "bg-violet-500/15" },
  HEAD: { text: "text-cyan-600", bg: "bg-cyan-500/15" },
  OPTIONS: { text: "text-gray-600", bg: "bg-gray-500/15" },
};

// ── 状态码颜色 ──
function statusColor(status?: number): string {
  if (!status) return "text-text-disabled";
  if (status < 300) return "text-emerald-600";
  if (status < 400) return "text-amber-600";
  return "text-red-500";
}

// ── 格式化大小 ──
function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── 格式化耗时 ──
function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function CaptureWorkspace({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const running = useCaptureStore(sessionId, (s) => s.running);
  const entries = useCaptureStore(sessionId, (s) => s.entries);
  const selectedEntryId = useCaptureStore(sessionId, (s) => s.selectedEntryId);
  const filter = useCaptureStore(sessionId, (s) => s.filter);
  const detailTab = useCaptureStore(sessionId, (s) => s.detailTab);
  const port = useCaptureStore(sessionId, (s) => s.port);

  const startCapture = useCaptureStore(sessionId, (s) => s.startCapture);
  const stopCapture = useCaptureStore(sessionId, (s) => s.stopCapture);
  const clearEntries = useCaptureStore(sessionId, (s) => s.clearEntries);
  const setFilter = useCaptureStore(sessionId, (s) => s.setFilter);
  const setSelectedEntry = useCaptureStore(sessionId, (s) => s.setSelectedEntry);
  const setDetailTab = useCaptureStore(sessionId, (s) => s.setDetailTab);
  const refreshStatus = useCaptureStore(sessionId, (s) => s.refreshStatus);
  const loadEntries = useCaptureStore(sessionId, (s) => s.loadEntries);
  const exportCaCert = useCaptureStore(sessionId, (s) => s.exportCaCert);
  const initListener = useCaptureStore(sessionId, (s) => s.initListener);
  const storeError = useCaptureStore(sessionId, (s) => s.error);

  const [portInput, setPortInput] = useState(String(port));
  const [caPath, setCaPath] = useState<string | null>(null);
  const [caInstallStatus, setCaInstallStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [caTrusted, setCaTrusted] = useState<boolean | null>(null); // null = 未检查
  const listEndRef = useRef<HTMLDivElement>(null);

  // 检查 CA 是否已信任
  const checkCaTrust = useCallback(async () => {
    try {
      const trusted = await invoke<boolean>("proxy_check_ca_trusted");
      setCaTrusted(trusted);
      if (trusted) {
        // 证书已安装，自动获取路径
        try {
          const path = await invoke<string>("proxy_export_ca");
          setCaPath(path);
        } catch { /* ignore */ }
      }
    } catch {
      setCaTrusted(false);
    }
  }, []);

  // 初始化事件监听
  useEffect(() => {
    refreshStatus();
    loadEntries();
    const unlistenPromise = initListener();
    return () => {
      unlistenPromise.then((fn) => fn());
      destroyCaptureStore(sessionId);
    };
  }, [initListener, loadEntries, refreshStatus, sessionId]);

  useEffect(() => {
    setPortInput(String(port));
  }, [port]);

  // 自动滚动到底部
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  // 代理启动后检查 CA 信任状态
  useEffect(() => {
    if (running) {
      checkCaTrust();
    }
  }, [running, checkCaTrust]);

  // 轮询后备：每 2 秒从后端拉取条目（确保事件推送失败时也能展示）
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      loadEntries();
    }, 2000);
    return () => clearInterval(interval);
  }, [running, loadEntries]);

  const handleToggleCapture = useCallback(async () => {
    if (running) {
      // 停止抓包时清理浏览器
      if (proxyServiceRef.current) {
        try {
          await invoke("close_proxy_browser", { serviceName: proxyServiceRef.current });
        } catch (e) {
          console.warn("清理代理浏览器失败:", e);
        }
        proxyServiceRef.current = null;
      }
      await stopCapture();
    } else {
      const p = parseInt(portInput, 10);
      if (isNaN(p) || p < 1 || p > 65535) return;
      try {
        await startCapture(p);
      } catch (e) {
        console.error("启动代理失败:", e);
      }
    }
  }, [running, portInput, startCapture, stopCapture]);

  const handleExportCA = useCallback(async () => {
    try {
      const path = await exportCaCert();
      setCaPath(path);
    } catch (e) {
      console.error(e);
    }
  }, [exportCaCert]);

  const proxyServiceRef = useRef<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState("");
  const [showBrowserInput, setShowBrowserInput] = useState(false);

  const handleOpenBrowser = useCallback(async () => {
    if (!running) return;
    const urlToOpen = browserUrl.trim() || "https://www.example.com";
    try {
      const serviceName = await invoke<string>("open_proxy_browser", {
        url: urlToOpen,
        proxyPort: parseInt(portInput, 10),
      });
      proxyServiceRef.current = serviceName;
      setShowBrowserInput(false);
      setBrowserUrl("");
    } catch (e) {
      console.error("打开浏览器失败:", e);
    }
  }, [running, browserUrl, portInput]);

  // 过滤后的条目
  const filteredEntries = filter
    ? entries.filter(
        (e) =>
          e.url.toLowerCase().includes(filter.toLowerCase()) ||
          e.method.toLowerCase().includes(filter.toLowerCase()) ||
          (e.status && String(e.status).includes(filter)) ||
          e.host.toLowerCase().includes(filter.toLowerCase())
      )
    : entries;

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) || null;

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="wb-tool-strip shrink-0">
        <div className="wb-tool-strip-main">
          <span
            className={cn(
              "wb-tool-chip",
              running
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                : "text-text-tertiary"
            )}
          >
          <span className={cn("h-2 w-2 rounded-[3px]", running ? "bg-emerald-500" : "bg-text-disabled")} />
            {running ? t('capture.proxyRunning') : t('capture.proxyStopped')}
          </span>

          <div className="wb-tool-field w-[110px]">
            <span>{t('capture.port')}</span>
            <input
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              disabled={running}
              className="text-center"
            />
          </div>

          <div className="wb-search w-[220px]">
            <Search className="h-3.5 w-3.5 text-text-disabled" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('capture.filterPlaceholder')}
            />
          </div>
        </div>

        <div className="wb-tool-strip-actions">
          <span className="wb-tool-chip">{t('capture.requestCount', { count: filteredEntries.length })}</span>
          <button
            onClick={clearEntries}
            className="wb-ghost-btn"
            title={t('capture.clear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('capture.clear')}
          </button>
          <button
            onClick={handleExportCA}
            className="wb-ghost-btn"
            title={t('capture.caCert')}
          >
            <Shield className="h-3.5 w-3.5" />
            {t('capture.caCert')}
          </button>
          <div className="relative">
            <button
              onClick={() => running ? setShowBrowserInput(!showBrowserInput) : undefined}
              className={cn("wb-ghost-btn", !running && "opacity-50 cursor-not-allowed")}
              title={running ? t('capture.openBrowserHint') : t('capture.browserProxyNotRunning')}
            >
              <Globe className="h-3.5 w-3.5" />
              {t('capture.openBrowser')}
            </button>
            {showBrowserInput && running && (
              <div className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-primary p-1.5 shadow-lg">
                <input
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleOpenBrowser(); if (e.key === "Escape") setShowBrowserInput(false); }}
                  placeholder={t('capture.browserUrlPlaceholder')}
                  className="wb-field h-7 w-[280px] text-[var(--fs-xs)] font-mono px-2"
                  autoFocus
                />
                <button onClick={handleOpenBrowser} className="wb-primary-btn h-7 px-3 text-[var(--fs-xs)]">
                  <Play className="h-3 w-3" fill="currentColor" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleToggleCapture}
            className={cn(
              "wb-primary-btn",
              running ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:bg-accent-hover"
            )}
          >
            {running ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
            {running ? t('capture.stopCapture') : t('capture.startCapture')}
          </button>
        </div>
      </div>

      {/* 错误面板 */}
      <AnimatePresence>
        {storeError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[var(--fs-xs)] text-red-600 flex items-center gap-2">
              <X className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 break-all">{storeError}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CA 证书状态面板 — 根据安装状态显示不同样式 */}
      <AnimatePresence>
        {running && caTrusted !== null && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={cn(
              "mt-3 rounded-[10px] border px-4 py-3 text-[var(--fs-xs)]",
              caTrusted
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-orange-500/30 bg-gradient-to-r from-orange-500/10 to-amber-500/10"
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  "shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center",
                  caTrusted ? "bg-emerald-500/20" : "bg-orange-500/20"
                )}>
                  <Shield className={cn("w-3.5 h-3.5", caTrusted ? "text-emerald-600" : "text-orange-600")} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn("font-semibold mb-1", caTrusted ? "text-emerald-700" : "text-orange-700")}>
                    {caTrusted ? t('capture.caTrustedTitle') : t('capture.caNotTrustedTitle')}
                  </div>
                  <p className="text-text-tertiary text-[var(--fs-xxs)] mb-2 leading-relaxed">
                    {caTrusted ? t('capture.caTrustedDesc') : t('capture.caNotTrustedDesc')}
                  </p>
                  {caPath && (
                    <code className={cn(
                      "font-mono text-[var(--fs-xxs)] px-1.5 py-0.5 rounded break-all",
                      caTrusted ? "bg-emerald-500/10 text-emerald-700" : "bg-orange-500/10 text-orange-700"
                    )}>{caPath}</code>
                  )}
                  {!caTrusted && (
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={async () => {
                          try {
                            const msg = await invoke<string>("proxy_install_ca");
                            setCaInstallStatus({ ok: true, msg });
                            // 延迟重新检查信任状态
                            setTimeout(() => checkCaTrust(), 1500);
                          } catch (e) {
                            setCaInstallStatus({ ok: false, msg: String(e) });
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[var(--fs-xxs)] font-semibold transition-colors shadow-sm"
                      >
                        <Shield className="w-3 h-3" />
                        {t('capture.installCaCert')}
                      </button>
                      <button
                        onClick={handleExportCA}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-secondary text-[var(--fs-xxs)] font-medium transition-colors"
                      >
                        {t('capture.exportCaCert')}
                      </button>
                      <span className="text-text-disabled text-[var(--fs-xxs)]">{t('capture.installCaCertHint')}</span>
                    </div>
                  )}
                  {caInstallStatus && (
                    <div className={cn(
                      "mt-2 px-2.5 py-1.5 rounded-lg text-[var(--fs-xxs)]",
                      caInstallStatus.ok
                        ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-500 border border-red-500/20"
                    )}>
                      {caInstallStatus.msg}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setCaTrusted(null)}
                  className="text-text-tertiary hover:text-text-primary transition-colors px-1 mt-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 运行状态指示 */}
      {running && (
        <div className="relative mt-3 h-[2px] shrink-0 overflow-hidden rounded-full bg-accent/20">
          <motion.div
            className="h-full bg-accent w-1/3 absolute rounded-full"
            animate={{ x: ["-100%", "400%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}

      {/* ── 主内容区 ── */}
      <div className="min-h-0 flex-1 pt-3">
      {entries.length === 0 ? (
        <div className="wb-workbench-stack">
          <EmptyState running={running} port={parseInt(portInput, 10)} embedded />
        </div>
      ) : (
        <div className="wb-workbench-stack">
        <PanelGroup orientation="vertical">
          <Panel defaultSize="60" minSize="30" className="flex min-h-0 flex-col">
            <div className="flex h-full flex-col overflow-hidden">
              <div className="wb-pane-header shrink-0">
                <div>
                  <div className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('capture.requestCount', { count: filteredEntries.length })}</div>
                  <div className="text-[var(--fs-xs)] text-text-tertiary">{t('capture.emptyDesc')}</div>
                </div>
                <span className="wb-tool-chip">{running ? t('capture.listening', { port: portInput }) : t('capture.awaitingStart')}</span>
              </div>
              <div className="flex items-center h-8 bg-bg-secondary/36 border-b border-border-subtle text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wider select-none shrink-0 px-3">
                <span className="w-[60px] shrink-0">{t('capture.method')}</span>
                <span className="flex-1 min-w-0">URL</span>
                <span className="w-[60px] shrink-0 text-center">{t('capture.status')}</span>
                <span className="w-[80px] shrink-0 text-right">{t('capture.size')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.size')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.duration')}</span>
              </div>
              {/* 请求列表 — 倒序排列，最新在最上方 */}
              <div className="flex-1 overflow-auto">
                {[...filteredEntries].reverse().map((entry) => (
                  <RequestRow
                    key={entry.id}
                    entry={entry}
                    isSelected={entry.id === selectedEntryId}
                    onClick={() => setSelectedEntry(entry.id)}
                  />
                ))}
                <div ref={listEndRef} />
              </div>
            </div>
          </Panel>

          {selectedEntry && (
            <>
              <PanelResizeHandle className="wb-workbench-divider" />
              <Panel defaultSize="40" minSize="20" className="flex min-h-0 flex-col">
                <DetailPanel
                  entry={selectedEntry}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedEntry(null)}
                  embedded
                />
              </Panel>
            </>
          )}
        </PanelGroup>
        </div>
      )}
      </div>
    </div>
  );
}

// ── 空状态 ──
function EmptyState({ running, port, embedded = false }: { running: boolean; port: number; embedded?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex h-full items-center justify-center", !embedded && "wb-panel")}>
      <div className="w-full max-w-3xl px-6 py-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/5 flex items-center justify-center border border-border-default/70">
          <ArrowUpDown className="w-7 h-7 text-accent/40" />
        </div>
        {running ? (
          <>
            <h3 className="text-[var(--fs-md)] font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="text-[var(--fs-sm)] text-text-tertiary mb-4">
              {t('capture.proxyRunning')} <code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded text-[var(--fs-xs)]">127.0.0.1:{port}</code> {t('capture.proxyRunningOn')}
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2">
              <div className="border-t border-border-default/70 pt-3 text-[var(--fs-xs)] text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[var(--fs-xxs)] font-mono">{t('capture.httpProxy')}</span>
                  <span className="font-mono text-text-primary">127.0.0.1:{port}</span>
                </div>
                <p className="mt-2 text-[var(--fs-xxs)] text-text-disabled">{t('capture.proxyHint')}</p>
              </div>
              <div className="border-t border-border-default/70 pt-3 text-[var(--fs-xs)] text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-start gap-1.5 text-[var(--fs-xxs)] text-text-disabled">
                  <Lightbulb className="w-3 h-3 text-amber-500 shrink-0 mt-[1px]" />
                  <span>{t('capture.httpsHint')}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-[var(--fs-md)] font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="text-[var(--fs-sm)] text-text-tertiary">
              {t('capture.emptyState')}
            </p>
            <div className="mt-6 grid gap-4 text-left sm:grid-cols-3">
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[var(--fs-xs)] font-semibold text-text-secondary">{t('capture.emptyStep1')}</div>
                <div className="mt-1 text-[var(--fs-xxs)] text-text-tertiary">{t('capture.emptyStep1Desc')}</div>
              </div>
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[var(--fs-xs)] font-semibold text-text-secondary">{t('capture.emptyStep2')}</div>
                <div className="mt-1 text-[var(--fs-xxs)] text-text-tertiary">{t('capture.emptyStep2Desc')}</div>
              </div>
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[var(--fs-xs)] font-semibold text-text-secondary">{t('capture.emptyStep3')}</div>
                <div className="mt-1 text-[var(--fs-xxs)] text-text-tertiary">{t('capture.emptyStep3Desc')}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 请求行 ──
function RequestRow({
  entry,
  isSelected,
  onClick,
}: {
  entry: CapturedEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const mc = methodColors[entry.method] || { text: "text-text-tertiary", bg: "bg-gray-500/10" };

  // 精简 content-type 显示
  const shortType = entry.contentType
    ? entry.contentType.split(";")[0].replace("application/", "").replace("text/", "")
    : "—";

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center h-[34px] px-3 text-[var(--fs-xs)] cursor-pointer transition-colors border-b border-border-subtle/50",
        isSelected
          ? "bg-accent/5 text-text-primary"
          : entry.completed
          ? "hover:bg-bg-hover text-text-secondary"
          : "text-text-disabled animate-pulse"
      )}
    >
      <span className="w-[60px] shrink-0">
        <span className={cn("text-[var(--fs-xxs)] font-bold px-1.5 py-[2px] rounded-[8px]", mc.text, mc.bg)}>
          {entry.method}
        </span>
      </span>
      <span className="flex-1 min-w-0 truncate font-mono text-[var(--fs-xxs)]" title={entry.url}>
        {entry.path || entry.url}
      </span>
      <span className={cn("w-[60px] shrink-0 text-center font-mono text-[var(--fs-xxs)] font-medium", statusColor(entry.status))}>
        {entry.status || <Clock className="w-3 h-3 text-text-disabled animate-pulse" />}
      </span>
      <span className="w-[80px] shrink-0 text-right text-[var(--fs-xxs)] text-text-disabled truncate" title={entry.contentType || ""}>
        {shortType}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono text-[var(--fs-xxs)] tabular-nums text-text-disabled">
        {formatSize(entry.responseSize)}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono text-[var(--fs-xxs)] tabular-nums text-text-disabled">
        {formatDuration(entry.durationMs)}
      </span>
    </div>
  );
}

// ── Burp Suite 风格详情面板 ──
type BurpTab = "raw" | "headers" | "hex";

function DetailPanel({
  entry,
  onClose,
  embedded = false,
}: {
  entry: CapturedEntry;
  activeTab: "headers" | "body" | "preview";
  onTabChange: (tab: "headers" | "body" | "preview") => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [reqTab, setReqTab] = useState<BurpTab>("raw");
  const [resTab, setResTab] = useState<BurpTab>("raw");

  return (
    <div className={cn("h-full flex flex-col overflow-hidden bg-bg-primary", !embedded && "wb-panel")}>
      {/* 顶部状态栏 */}
      <div className={cn("shrink-0 flex items-center justify-between", embedded ? "wb-pane-header" : "wb-panel-header")}>
        <div className="flex items-center gap-2 text-[var(--fs-xs)]">
          <span className={cn("font-mono font-bold px-1.5 py-[1px] rounded-[6px]",
            methodColors[entry.method]?.text || "text-text-tertiary",
            methodColors[entry.method]?.bg || "bg-gray-500/10"
          )}>
            {entry.method}
          </span>
          <span className="font-mono text-[var(--fs-xxs)] text-text-secondary truncate max-w-[400px]" title={entry.url}>
            {entry.url}
          </span>
          <span className={cn("font-mono text-[var(--fs-xxs)] font-medium", statusColor(entry.status))}>
            {entry.status} {entry.statusText}
          </span>
          <span className="text-text-disabled text-[var(--fs-xxs)]">·</span>
          <span className="font-mono text-[var(--fs-xxs)] text-text-disabled">{formatDuration(entry.durationMs)}</span>
          <span className="text-text-disabled text-[var(--fs-xxs)]">·</span>
          <span className="font-mono text-[var(--fs-xxs)] text-text-disabled">{formatSize(entry.responseSize)}</span>
        </div>
        <button
          onClick={onClose}
          className="mr-1 flex h-7 w-7 items-center justify-center rounded-[8px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 左右分栏：Request | Response */}
      <div className="flex-1 flex min-h-0">
        {/* Request 面板 */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border-subtle">
          <BurpTabStrip label="Request" activeTab={reqTab} onChange={setReqTab} color="text-orange-500" />
          <div className="flex-1 overflow-auto">
            {reqTab === "raw" && <RawView type="request" entry={entry} />}
            {reqTab === "headers" && <HeadersTableView headers={entry.requestHeaders} />}
            {reqTab === "hex" && <HexView data={entry.requestBodyRaw} />}
          </div>
        </div>
        {/* Response 面板 */}
        <div className="flex-1 flex flex-col min-w-0">
          <BurpTabStrip label="Response" activeTab={resTab} onChange={setResTab} color="text-emerald-500" />
          <div className="flex-1 overflow-auto">
            {resTab === "raw" && <RawView type="response" entry={entry} />}
            {resTab === "headers" && <HeadersTableView headers={entry.responseHeaders} />}
            {resTab === "hex" && <HexView data={entry.responseBodyRaw} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 条 ──
function BurpTabStrip({
  label,
  activeTab,
  onChange,
  color,
}: {
  label: string;
  activeTab: BurpTab;
  onChange: (tab: BurpTab) => void;
  color: string;
}) {
  const tabs: { id: BurpTab; label: string }[] = [
    { id: "raw", label: "Raw" },
    { id: "headers", label: "Headers" },
    { id: "hex", label: "Hex" },
  ];

  return (
    <div className="shrink-0 flex items-center gap-0.5 border-b border-border-subtle px-2 h-8 bg-bg-secondary/30">
      <span className={cn("text-[var(--fs-xs)] font-bold mr-2", color)}>{label}</span>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "h-full px-2.5 text-[var(--fs-xxs)] font-medium transition-colors relative",
            activeTab === tab.id
              ? "text-text-primary"
              : "text-text-disabled hover:text-text-secondary"
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-accent rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Raw 视图 — 完整 HTTP 报文 ──
function RawView({ type, entry }: { type: "request" | "response"; entry: CapturedEntry }) {
  const isRequest = type === "request";

  // 构建 HTTP 报文
  const buildRaw = () => {
    const lines: string[] = [];

    if (isRequest) {
      // 请求行
      const pathAndQuery = (() => {
        try {
          const u = new URL(entry.url);
          return u.pathname + u.search;
        } catch {
          return entry.path || "/";
        }
      })();
      const httpVer = entry.httpVersion?.replace("HTTP_", "HTTP/").replace("_", ".") || "HTTP/1.1";
      lines.push(`${entry.method} ${pathAndQuery} ${httpVer}`);
      // 请求头
      for (const [key, value] of entry.requestHeaders) {
        lines.push(`${key}: ${value}`);
      }
      // 空行 + body
      lines.push("");
      if (entry.requestBody) {
        lines.push(entry.requestBody);
      }
    } else {
      // 状态行
      const httpVer = entry.httpVersion?.replace("HTTP_", "HTTP/").replace("_", ".") || "HTTP/1.1";
      lines.push(`${httpVer} ${entry.status || "?"} ${entry.statusText || ""}`);
      // 响应头
      for (const [key, value] of entry.responseHeaders) {
        lines.push(`${key}: ${value}`);
      }
      // 空行 + body
      lines.push("");
      if (entry.responseBody) {
        lines.push(entry.responseBody);
      }
    }

    return lines.join("\n");
  };

  const raw = buildRaw();

  return (
    <pre
      className="p-3 text-[var(--fs-xxs)] font-mono text-text-secondary whitespace-pre-wrap break-all select-text leading-[1.6] cursor-text"
      style={{ userSelect: "text", WebkitUserSelect: "text" }}
    >
      {raw || <span className="text-text-disabled italic">Empty</span>}
    </pre>
  );
}

// ── Headers 表格视图 ──
function HeadersTableView({ headers }: { headers: [string, string][] }) {
  if (headers.length === 0) {
    return (
      <div className="p-4 text-center text-text-disabled text-[var(--fs-xs)]">
        No headers
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      {headers.map(([key, value], i) => (
        <div
          key={`${key}-${i}`}
          className={cn(
            "flex text-[var(--fs-xxs)] font-mono px-3 py-1.5 select-text cursor-text",
            i > 0 && "border-t border-border-subtle/50",
            i % 2 === 0 ? "bg-transparent" : "bg-bg-secondary/20"
          )}
          style={{ userSelect: "text", WebkitUserSelect: "text" }}
        >
          <span className="text-accent/80 w-[180px] shrink-0 font-semibold">{key}</span>
          <span className="text-text-secondary break-all min-w-0">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Hex 视图 — 经典十六进制 dump ──
function HexView({ data }: { data?: string }) {
  if (!data) {
    return (
      <div className="p-4 text-center text-text-disabled text-[var(--fs-xs)]">
        No body data
      </div>
    );
  }

  // base64 → bytes
  const bytes = (() => {
    try {
      const binary = atob(data);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        arr[i] = binary.charCodeAt(i);
      }
      return arr;
    } catch {
      return new Uint8Array(0);
    }
  })();

  // 生成 hex dump 行
  const lines: string[] = [];
  const bytesPerLine = 16;
  const maxBytes = Math.min(bytes.length, 64 * 1024); // 限制最大 64KB 展示

  for (let offset = 0; offset < maxBytes; offset += bytesPerLine) {
    const chunk = bytes.slice(offset, offset + bytesPerLine);

    // 偏移量
    const offsetStr = offset.toString(16).padStart(8, "0");

    // Hex 部分
    const hexParts: string[] = [];
    for (let i = 0; i < bytesPerLine; i++) {
      if (i < chunk.length) {
        hexParts.push(chunk[i].toString(16).padStart(2, "0"));
      } else {
        hexParts.push("  ");
      }
    }
    const hexStr = hexParts.slice(0, 8).join(" ") + "  " + hexParts.slice(8).join(" ");

    // ASCII 部分
    const asciiStr = Array.from(chunk)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
      .join("");

    lines.push(`${offsetStr}  ${hexStr}  |${asciiStr.padEnd(bytesPerLine, " ")}|`);
  }

  if (bytes.length > maxBytes) {
    lines.push(`... (${bytes.length - maxBytes} more bytes truncated)`);
  }

  return (
    <pre
      className="p-3 text-[var(--fs-xxs)] font-mono text-text-secondary leading-[1.6] select-text cursor-text whitespace-pre"
      style={{ userSelect: "text", WebkitUserSelect: "text" }}
    >
      {lines.join("\n")}
    </pre>
  );
}
