// 抓包工作区 — 类似 Chrome DevTools Network 面板
// 提供代理控制、请求列表、详情面板等功能

import { useEffect, useCallback, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Trash2, Shield, Search,
  ChevronDown, ChevronRight, ArrowUpDown, X, Lightbulb, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useCaptureStore } from "@/stores/captureStore";
import type { CapturedEntry } from "@/types/capture";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";

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

  const [portInput, setPortInput] = useState(String(port));
  const [caPath, setCaPath] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  // 初始化事件监听
  useEffect(() => {
    refreshStatus();
    loadEntries();
    const unlistenPromise = initListener();
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [initListener, loadEntries, refreshStatus]);

  useEffect(() => {
    setPortInput(String(port));
  }, [port]);

  // 自动滚动到底部
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const handleToggleCapture = useCallback(async () => {
    if (running) {
      await stopCapture();
    } else {
      const p = parseInt(portInput, 10);
      if (isNaN(p) || p < 1 || p > 65535) return;
      await startCapture(p);
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

      {/* CA 证书提示 */}
      <AnimatePresence>
        {caPath && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex items-center justify-between rounded-[10px] border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[11px]">
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700">
                  {t('capture.caPath')}: <code className="font-mono text-[10px] bg-amber-500/10 px-1 py-0.5 rounded">{caPath}</code>
                </span>
              </div>
              <button
                onClick={() => setCaPath(null)}
                className="text-text-tertiary hover:text-text-primary transition-colors px-1"
              >
                <X className="w-3 h-3" />
              </button>
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
                  <div className="text-[12px] font-semibold text-text-primary">{t('capture.requestCount', { count: filteredEntries.length })}</div>
                  <div className="text-[11px] text-text-tertiary">{t('capture.emptyDesc')}</div>
                </div>
                <span className="wb-tool-chip">{running ? t('capture.listening', { port: portInput }) : t('capture.awaitingStart')}</span>
              </div>
              <div className="flex items-center h-8 bg-bg-secondary/36 border-b border-border-subtle text-[11px] font-semibold text-text-disabled uppercase tracking-wider select-none shrink-0 px-3">
                <span className="w-[60px] shrink-0">{t('capture.method')}</span>
                <span className="flex-1 min-w-0">URL</span>
                <span className="w-[60px] shrink-0 text-center">{t('capture.status')}</span>
                <span className="w-[80px] shrink-0 text-right">{t('capture.size')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.size')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.duration')}</span>
              </div>
              {/* 请求列表 */}
              <div className="flex-1 overflow-auto">
                {filteredEntries.map((entry) => (
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
            <h3 className="text-[14px] font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="text-[12px] text-text-tertiary mb-4">
              {t('capture.proxyRunning')} <code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded text-[11px]">127.0.0.1:{port}</code> {t('capture.proxyRunningOn')}
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2">
              <div className="border-t border-border-default/70 pt-3 text-[11px] text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[10px] font-mono">{t('capture.httpProxy')}</span>
                  <span className="font-mono text-text-primary">127.0.0.1:{port}</span>
                </div>
                <p className="mt-2 text-[10px] text-text-disabled">{t('capture.proxyHint')}</p>
              </div>
              <div className="border-t border-border-default/70 pt-3 text-[11px] text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-start gap-1.5 text-[10px] text-text-disabled">
                  <Lightbulb className="w-3 h-3 text-amber-500 shrink-0 mt-[1px]" />
                  <span>{t('capture.httpsHint')}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-[14px] font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="text-[12px] text-text-tertiary">
              {t('capture.emptyState')}
            </p>
            <div className="mt-6 grid gap-4 text-left sm:grid-cols-3">
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[11px] font-semibold text-text-secondary">{t('capture.emptyStep1')}</div>
                <div className="mt-1 text-[10px] text-text-tertiary">{t('capture.emptyStep1Desc')}</div>
              </div>
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[11px] font-semibold text-text-secondary">{t('capture.emptyStep2')}</div>
                <div className="mt-1 text-[10px] text-text-tertiary">{t('capture.emptyStep2Desc')}</div>
              </div>
              <div className="border-t border-border-default/70 pt-3">
                <div className="text-[11px] font-semibold text-text-secondary">{t('capture.emptyStep3')}</div>
                <div className="mt-1 text-[10px] text-text-tertiary">{t('capture.emptyStep3Desc')}</div>
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
        "flex items-center h-[34px] px-3 text-[11px] cursor-pointer transition-colors border-b border-border-subtle/50",
        isSelected
          ? "bg-accent/5 text-text-primary"
          : entry.completed
          ? "hover:bg-bg-hover text-text-secondary"
          : "text-text-disabled animate-pulse"
      )}
    >
      <span className="w-[60px] shrink-0">
        <span className={cn("text-[10px] font-bold px-1.5 py-[2px] rounded-[8px]", mc.text, mc.bg)}>
          {entry.method}
        </span>
      </span>
      <span className="flex-1 min-w-0 truncate font-mono text-[10px]" title={entry.url}>
        {entry.path || entry.url}
      </span>
      <span className={cn("w-[60px] shrink-0 text-center font-mono text-[10px] font-medium", statusColor(entry.status))}>
        {entry.status || <Clock className="w-3 h-3 text-text-disabled animate-pulse" />}
      </span>
      <span className="w-[80px] shrink-0 text-right text-[10px] text-text-disabled truncate" title={entry.contentType || ""}>
        {shortType}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono text-[10px] tabular-nums text-text-disabled">
        {formatSize(entry.responseSize)}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono text-[10px] tabular-nums text-text-disabled">
        {formatDuration(entry.durationMs)}
      </span>
    </div>
  );
}

// ── 详情面板 ──
function DetailPanel({
  entry,
  activeTab,
  onTabChange,
  onClose,
  embedded = false,
}: {
  entry: CapturedEntry;
  activeTab: "headers" | "body" | "preview";
  onTabChange: (tab: "headers" | "body" | "preview") => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const tabs = [
    { id: "headers" as const, label: "Headers" },
    { id: "body" as const, label: "Body" },
    { id: "preview" as const, label: "Preview" },
  ];

  return (
    <div className={cn("h-full flex flex-col overflow-hidden bg-bg-primary", !embedded && "wb-panel")}>
      {/* 详情头部 */}
      <div className={cn("shrink-0", embedded ? "wb-pane-header" : "wb-panel-header")}>
      <div className="flex items-center gap-0.5 px-3">
        {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "h-8 px-3 text-[11px] font-medium transition-colors relative",
                activeTab === tab.id
                  ? "text-accent"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="detail-tab-indicator"
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3 text-[10px] text-text-disabled">
          <span className={cn("font-mono font-medium", statusColor(entry.status))}>
            {entry.status} {entry.statusText}
          </span>
          <span>·</span>
          <span className="font-mono">{formatDuration(entry.durationMs)}</span>
        </div>
        <button
          onClick={onClose}
          className="mr-1 flex h-7 w-7 items-center justify-center rounded-[8px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 详情内容 */}
      <div className="flex-1 overflow-auto p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
          >
            {activeTab === "headers" && <HeadersView entry={entry} />}
            {activeTab === "body" && <BodyView entry={entry} />}
            {activeTab === "preview" && <PreviewView entry={entry} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Headers 视图 ──
function HeadersView({ entry }: { entry: CapturedEntry }) {
  const [showReqHeaders, setShowReqHeaders] = useState(true);
  const [showResHeaders, setShowResHeaders] = useState(true);

  return (
    <div className="space-y-3">
      {/* 概要 */}
      <div className="text-[11px] space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-text-disabled w-16 shrink-0">URL</span>
          <span className="font-mono text-text-primary break-all text-[10px]">{entry.url}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-disabled w-16 shrink-0">Method</span>
          <span className="font-mono text-text-primary">{entry.method}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-disabled w-16 shrink-0">Status</span>
          <span className={cn("font-mono font-medium", statusColor(entry.status))}>
            {entry.status ? `${entry.status} ${entry.statusText || ""}` : "Pending"}
          </span>
        </div>
      </div>

      <div className="h-[1px] bg-border-subtle" />

      {/* 请求头 */}
      <HeaderSection
        title="Request Headers"
        headers={entry.requestHeaders}
        expanded={showReqHeaders}
        onToggle={() => setShowReqHeaders(!showReqHeaders)}
      />

      {/* 响应头 */}
      {entry.responseHeaders.length > 0 && (
        <HeaderSection
          title="Response Headers"
          headers={entry.responseHeaders}
          expanded={showResHeaders}
          onToggle={() => setShowResHeaders(!showResHeaders)}
        />
      )}
    </div>
  );
}

function HeaderSection({
  title,
  headers,
  expanded,
  onToggle,
}: {
  title: string;
  headers: [string, string][];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-t border-border-default/70 pt-3">
      <button
        onClick={onToggle}
        className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        {title}
        <span className="text-text-disabled font-normal normal-case tracking-normal">
          ({headers.length})
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="overflow-hidden rounded-[8px] border border-border-default/65 bg-bg-secondary/28">
              {headers.map(([key, value], i) => (
                <div
                  key={`${key}-${i}`}
                  className={cn(
                    "flex text-[10px] font-mono px-2.5 py-1",
                    i > 0 && "border-t border-border-subtle/50"
                  )}
                >
                  <span className="text-accent/80 w-[180px] shrink-0 font-medium">{key}</span>
                  <span className="text-text-secondary break-all min-w-0">{value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Body 视图 ──
function BodyView({ entry }: { entry: CapturedEntry }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {entry.requestBody ? (
        <div className="border-t border-border-default/70 pt-3">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-disabled">Request Body</h4>
          <pre className="max-h-[200px] overflow-auto rounded-[8px] border border-border-default/65 bg-bg-secondary/28 p-3 text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all">
            {entry.requestBody}
          </pre>
        </div>
      ) : (
        <div className="border-t border-border-default/70 pt-3 text-[11px] text-text-disabled">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider">Request Body</h4>
          <p>{t('capture.noRequestBody')}</p>
        </div>
      )}
      {entry.responseBody ? (
        <div className="border-t border-border-default/70 pt-3">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-disabled">Response Body</h4>
          <pre className="max-h-[300px] overflow-auto rounded-[8px] border border-border-default/65 bg-bg-secondary/28 p-3 text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all">
            {entry.responseBody}
          </pre>
        </div>
      ) : (
        <div className="border-t border-border-default/70 pt-3 text-[11px] text-text-disabled">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider">Response Body</h4>
          <p>{t('capture.bodyNotSupported')}</p>
        </div>
      )}
    </div>
  );
}

// ── Preview 视图 ──
function PreviewView({ entry }: { entry: CapturedEntry }) {
  return (
    <div className="space-y-2 text-[11px]">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <InfoRow label="URL" value={entry.url} mono />
        <InfoRow label="Host" value={entry.host} mono />
        <InfoRow label="Path" value={entry.path} mono />
        <InfoRow label="Method" value={entry.method} />
        <InfoRow
          label="Status"
          value={entry.status ? `${entry.status} ${entry.statusText || ""}` : "Pending"}
          className={statusColor(entry.status)}
        />
        <InfoRow label="Content-Type" value={entry.contentType || "—"} />
        <InfoRow label="Request Size" value={formatSize(entry.requestSize)} />
        <InfoRow label="Response Size" value={formatSize(entry.responseSize)} />
        <InfoRow label="Duration" value={formatDuration(entry.durationMs)} />
        <InfoRow label="Timestamp" value={entry.timestamp} mono />
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-disabled w-24 shrink-0 text-[10px]">{label}</span>
      <span
        className={cn(
          "text-text-secondary break-all text-[10px]",
          mono && "font-mono",
          className
        )}
      >
        {value}
      </span>
    </div>
  );
}
