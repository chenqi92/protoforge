// 抓包工作区 — 类似 Chrome DevTools Network 面板
// 提供代理控制、请求列表、详情面板等功能

import { useEffect, useCallback, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Trash2, Shield, Search,
  ChevronDown, ChevronRight, ArrowUpDown, X, Lightbulb, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

export function CaptureWorkspace() {
  const running = useCaptureStore((s) => s.running);
  const entries = useCaptureStore((s) => s.entries);
  const selectedEntryId = useCaptureStore((s) => s.selectedEntryId);
  const filter = useCaptureStore((s) => s.filter);
  const detailTab = useCaptureStore((s) => s.detailTab);
  const port = useCaptureStore((s) => s.port);

  const startCapture = useCaptureStore((s) => s.startCapture);
  const stopCapture = useCaptureStore((s) => s.stopCapture);
  const clearEntries = useCaptureStore((s) => s.clearEntries);
  const setFilter = useCaptureStore((s) => s.setFilter);
  const setSelectedEntry = useCaptureStore((s) => s.setSelectedEntry);
  const setDetailTab = useCaptureStore((s) => s.setDetailTab);
  const refreshStatus = useCaptureStore((s) => s.refreshStatus);
  const exportCaCert = useCaptureStore((s) => s.exportCaCert);
  const initListener = useCaptureStore((s) => s.initListener);

  const [portInput, setPortInput] = useState(String(port));
  const [caPath, setCaPath] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  // 初始化事件监听
  useEffect(() => {
    refreshStatus();
    const unlistenPromise = initListener();
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [initListener, refreshStatus]);

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
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── 工具栏 ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border-default bg-bg-secondary/30">
        {/* 开始/停止 */}
        <button
          onClick={handleToggleCapture}
          className={cn(
            "h-7 px-3 flex items-center gap-1.5 rounded-md text-[12px] font-semibold transition-all active:scale-[0.97]",
            running
              ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
              : "bg-accent text-white hover:bg-accent-hover"
          )}
        >
          {running ? (
            <>
              <Square className="w-3 h-3" fill="currentColor" />
              停止
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" fill="currentColor" />
              开始抓包
            </>
          )}
        </button>

        {/* 清空 */}
        <button
          onClick={clearEntries}
          className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="清空列表"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-[1px] h-4 bg-border-default shrink-0" />

        {/* 端口 */}
        <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
          <span>端口</span>
          <input
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            disabled={running}
            className={cn(
              "w-[60px] h-6 px-2 text-[11px] font-mono bg-bg-primary border border-border-default rounded-md outline-none text-text-primary text-center",
              "focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          />
        </div>

        <div className="flex-1" />

        {/* 过滤 */}
        <div className="relative group">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled group-focus-within:text-accent transition-colors" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤请求..."
            className="w-[200px] h-6 pl-7 pr-2 text-[11px] bg-bg-primary border border-border-default rounded-md outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary placeholder:text-text-tertiary transition-all"
          />
        </div>

        <div className="w-[1px] h-4 bg-border-default shrink-0" />

        {/* CA 证书导出 */}
        <button
          onClick={handleExportCA}
          className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="导出 CA 证书（用于 HTTPS 解密）"
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">CA 证书</span>
        </button>

        {/* 计数 */}
        <span className="text-[10px] text-text-disabled tabular-nums">
          {filteredEntries.length} 条
        </span>
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
            <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-amber-700">
                  CA 证书路径：<code className="font-mono text-[10px] bg-amber-500/10 px-1 py-0.5 rounded">{caPath}</code>
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
        <div className="h-[2px] bg-accent/20 relative overflow-hidden shrink-0">
          <motion.div
            className="h-full bg-accent w-1/3 absolute rounded-full"
            animate={{ x: ["-100%", "400%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}

      {/* ── 主内容区 ── */}
      {entries.length === 0 ? (
        <EmptyState running={running} port={parseInt(portInput, 10)} />
      ) : (
        <PanelGroup orientation="vertical">
          <Panel defaultSize="60" minSize="30">
            <div className="h-full flex flex-col overflow-hidden">
              {/* 表头 */}
              <div className="flex items-center h-7 bg-bg-tertiary/30 border-b border-border-subtle text-[10px] font-semibold text-text-disabled uppercase tracking-wider select-none shrink-0 px-3">
                <span className="w-[60px] shrink-0">方法</span>
                <span className="flex-1 min-w-0">URL</span>
                <span className="w-[60px] shrink-0 text-center">状态</span>
                <span className="w-[80px] shrink-0 text-right">类型</span>
                <span className="w-[70px] shrink-0 text-right">大小</span>
                <span className="w-[70px] shrink-0 text-right">耗时</span>
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
              <PanelResizeHandle className="h-[1px] bg-border-default relative shrink-0 cursor-row-resize hover:bg-accent active:bg-accent transition-colors" />
              <Panel defaultSize="40" minSize="20">
                <DetailPanel
                  entry={selectedEntry}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedEntry(null)}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      )}
    </div>
  );
}

// ── 空状态 ──
function EmptyState({ running, port }: { running: boolean; port: number }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/5 flex items-center justify-center">
          <ArrowUpDown className="w-7 h-7 text-accent/40" />
        </div>
        {running ? (
          <>
            <h3 className="text-[14px] font-semibold text-text-primary mb-1">
              等待流量...
            </h3>
            <p className="text-[12px] text-text-tertiary mb-4">
              代理已在 <code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded text-[11px]">127.0.0.1:{port}</code> 上运行
            </p>
            <div className="bg-bg-secondary rounded-lg p-4 text-left text-[11px] text-text-tertiary space-y-2">
              <p className="font-medium text-text-secondary">配置你的浏览器或系统代理：</p>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-bg-tertiary rounded text-[10px] font-mono">HTTP 代理</span>
                <span className="font-mono text-text-primary">127.0.0.1:{port}</span>
              </div>
              <p className="text-[10px] text-text-disabled">
                <div className="flex items-start gap-1.5">
                  <Lightbulb className="w-3 h-3 text-amber-500 shrink-0 mt-[1px]" />
                  <span>如需抓取 HTTPS，请先安装并信任 CA 证书（点击工具栏 &quot;CA 证书&quot;）</span>
                </div>
              </p>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-[14px] font-semibold text-text-primary mb-1">
              网络抓包
            </h3>
            <p className="text-[12px] text-text-tertiary">
              点击 <span className="text-accent font-medium">&quot;开始抓包&quot;</span> 启动本地 HTTP 代理，然后配置浏览器代理以捕获流量
            </p>
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
        "flex items-center h-[30px] px-3 text-[11px] cursor-pointer transition-colors border-b border-border-subtle/50",
        isSelected
          ? "bg-accent/5 text-text-primary"
          : entry.completed
          ? "hover:bg-bg-hover text-text-secondary"
          : "text-text-disabled animate-pulse"
      )}
    >
      <span className="w-[60px] shrink-0">
        <span className={cn("text-[10px] font-bold px-1 py-[1px] rounded", mc.text, mc.bg)}>
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
}: {
  entry: CapturedEntry;
  activeTab: "headers" | "body" | "preview";
  onTabChange: (tab: "headers" | "body" | "preview") => void;
  onClose: () => void;
}) {
  const tabs = [
    { id: "headers" as const, label: "Headers" },
    { id: "body" as const, label: "Body" },
    { id: "preview" as const, label: "Preview" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* 详情头部 */}
      <div className="flex items-center shrink-0 border-b border-border-default">
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
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t-full"
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
          className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors mr-1"
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
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary uppercase tracking-wider hover:text-text-primary transition-colors mb-1"
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
            <div className="bg-bg-secondary/50 rounded-md border border-border-subtle overflow-hidden">
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
  return (
    <div className="space-y-3">
      {entry.requestBody ? (
        <div>
          <h4 className="text-[10px] font-semibold text-text-disabled uppercase tracking-wider mb-1">Request Body</h4>
          <pre className="bg-bg-secondary/50 rounded-md border border-border-subtle p-3 text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all overflow-auto max-h-[200px]">
            {entry.requestBody}
          </pre>
        </div>
      ) : (
        <div className="text-[11px] text-text-disabled">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-1">Request Body</h4>
          <p>无请求体</p>
        </div>
      )}
      {entry.responseBody ? (
        <div>
          <h4 className="text-[10px] font-semibold text-text-disabled uppercase tracking-wider mb-1">Response Body</h4>
          <pre className="bg-bg-secondary/50 rounded-md border border-border-subtle p-3 text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all overflow-auto max-h-[300px]">
            {entry.responseBody}
          </pre>
        </div>
      ) : (
        <div className="text-[11px] text-text-disabled">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-1">Response Body</h4>
          <p>响应体抓取暂不支持（仅记录 Headers 和元数据）</p>
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
