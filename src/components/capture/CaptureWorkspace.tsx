// 抓包工作区 — 类似 Chrome DevTools Network 面板
// 提供代理控制、请求列表、详情面板等功能

import { memo, useDeferredValue, useEffect, useCallback, useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Trash2, Shield, Search,
  ArrowUpDown, X, Lightbulb, Clock, Globe,
  Send, Cpu, Copy, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useCaptureStore, getCaptureStore, destroyCaptureStore } from "@/stores/captureStore";
import type { CapturedEntry } from "@/types/capture";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useAppStore } from "@/stores/appStore";
import type { HttpMethod, KeyValue } from "@/types/http";

// ── HTTP Method → Forge .pf-mtag tone class ──
function methodTagClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET": return "m-get";
    case "POST": return "m-post";
    case "PUT": return "m-put";
    case "DELETE": return "m-del";
    case "PATCH": return "m-patch";
    case "HEAD": return "m-head";
    case "OPTIONS": return "m-opt";
    default: return "text-text-tertiary";
  }
}

const MAX_VISIBLE_CAPTURE_ENTRIES = 500;

// ── 状态码颜色 (Forge status tokens) ──
function statusColor(status?: number): string {
  if (!status) return "text-text-disabled";
  if (status < 300) return "text-success";
  if (status < 400) return "text-warning";
  return "text-error";
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

// ── 抓包条目 → 完整 raw HTTP 报文（请求行 + 响应行，供协议解析器使用）──
function buildRawEntryText(entry: CapturedEntry): string {
  const httpVer = entry.httpVersion?.replace("HTTP_", "HTTP/").replace("_", ".") || "HTTP/1.1";
  const pathAndQuery = (() => {
    try {
      const u = new URL(entry.url);
      return u.pathname + u.search;
    } catch {
      return entry.path?.startsWith("/") ? entry.path : `/${entry.path || ""}`;
    }
  })();

  const lines: string[] = [];
  lines.push(`${entry.method} ${pathAndQuery} ${httpVer}`);
  for (const [k, v] of entry.requestHeaders) lines.push(`${k}: ${v}`);
  lines.push("");
  if (entry.requestBody) lines.push(entry.requestBody);

  lines.push("");
  lines.push(`${httpVer} ${entry.status ?? "?"} ${entry.statusText ?? ""}`.trimEnd());
  for (const [k, v] of entry.responseHeaders) lines.push(`${k}: ${v}`);
  lines.push("");
  if (entry.responseBody) lines.push(entry.responseBody);

  return lines.join("\n");
}

// ── 抓包条目 → cURL（从 method/url/headers/body 直接构建，签名与 CapturedEntry 对齐）──
function buildCurlFromEntry(entry: CapturedEntry): string {
  const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const parts: string[] = ["curl"];
  const method = (entry.method || "GET").toUpperCase();
  if (method !== "GET") parts.push(`-X ${method}`);

  for (const [k, v] of entry.requestHeaders) {
    const lk = k.toLowerCase();
    // 跳过 HTTP/2 伪首部（:method/:path/...），cURL 不接受
    if (lk.startsWith(":")) continue;
    parts.push(`-H ${sq(`${k}: ${v}`)}`);
  }

  if (entry.requestBody) parts.push(`--data-raw ${sq(entry.requestBody)}`);

  parts.push(sq(entry.url));
  return parts.join(" \\\n  ");
}

// ── 抓包条目 → HTTP 工作区预填项 ──
function entryToHttpPrefill(entry: CapturedEntry): {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  bodyType: "none" | "raw";
  rawBody: string;
} {
  const allowed: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  const upper = (entry.method || "GET").toUpperCase() as HttpMethod;
  const method = allowed.includes(upper) ? upper : "GET";
  const headers: KeyValue[] = entry.requestHeaders
    .filter(([k]) => !k.startsWith(":"))
    .map(([key, value]) => ({ key, value, enabled: true }));
  headers.push({ key: "", value: "", enabled: true });
  const rawBody = entry.requestBody || "";
  return {
    method,
    url: entry.url,
    headers,
    bodyType: rawBody ? "raw" : "none",
    rawBody,
  };
}

export const CaptureWorkspace = memo(function CaptureWorkspace({ sessionId }: { sessionId: string }) {
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
  const exportCaCert = useCaptureStore(sessionId, (s) => s.exportCaCert);
  const storeError = useCaptureStore(sessionId, (s) => s.error);

  const { showMenu, MenuComponent } = useContextMenu();

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
    const store = getCaptureStore(sessionId);
    const { refreshStatus: refresh, loadEntries: load, initListener: init } = store.getState();
    refresh();
    load();
    const unlistenPromise = init();
    return () => {
      unlistenPromise.then((fn) => fn());
      destroyCaptureStore(sessionId);
    };
  }, [sessionId]);

  useEffect(() => {
    setPortInput(String(port));
  }, [port]);

  // 自动滚动到底部
  useEffect(() => {
    if (!listEndRef.current || listEndRef.current.offsetParent === null) {
      return;
    }
    listEndRef.current.scrollIntoView({ behavior: "smooth" });
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
      getCaptureStore(sessionId).getState().loadEntries();
    }, 2000);
    return () => clearInterval(interval);
  }, [running, sessionId]);

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
        toast.error(t('capture.startProxyFailed', '启动代理失败: ') + String(e));
      }
    }
  }, [running, portInput, startCapture, stopCapture, t]);

  const handleExportCA = useCallback(async () => {
    try {
      const path = await exportCaCert();
      setCaPath(path);
    } catch (e) {
      toast.error(t('capture.exportCertFailed', '导出证书失败: ') + String(e));
    }
  }, [exportCaCert, t]);

  const proxyServiceRef = useRef<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState("");
  const [showBrowserInput, setShowBrowserInput] = useState(false);
  const deferredFilter = useDeferredValue(filter);

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
      toast.error(t('capture.openBrowserFailed', '打开浏览器失败: ') + String(e));
    }
  }, [running, browserUrl, portInput, t]);

  // 请求行右键菜单 — 对齐原型 RequestRow context menu
  const handleRowContextMenu = useCallback((e: React.MouseEvent, entry: CapturedEntry) => {
    const items: ContextMenuEntry[] = [
      {
        id: "replay",
        label: t('capture.menu.replay', '重放请求'),
        icon: <Send className="h-3.5 w-3.5" />,
        onClick: () => {
          // 暂无代理重放后端 — 与原型一致，提示占位
          toast(t('capture.menu.replay', '重放请求'));
        },
      },
      {
        id: "editInHttp",
        label: t('capture.menu.editInHttp', '在 HTTP 中编辑重发'),
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: () => {
          const store = useAppStore.getState();
          const prefill = entryToHttpPrefill(entry);
          const tabId = store.addTab("http");
          store.updateHttpConfig(tabId, {
            method: prefill.method,
            url: prefill.url,
            headers: prefill.headers,
            bodyType: prefill.bodyType,
            rawBody: prefill.rawBody,
            ...(prefill.bodyType === "raw"
              ? { rawContentType: entry.requestContentType || "text/plain" }
              : {}),
          });
        },
      },
      {
        id: "sendToParser",
        label: t('capture.menu.sendToParser', '发送到协议解析器'),
        icon: <Cpu className="h-3.5 w-3.5" />,
        onClick: () => {
          window.dispatchEvent(
            new CustomEvent("parse-protocol", { detail: { data: buildRawEntryText(entry) } })
          );
        },
      },
      {
        id: "copyCurl",
        label: t('capture.menu.copyCurl', '复制为 cURL'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: () => {
          copyTextToClipboard(buildCurlFromEntry(entry))
            .then(() => toast.success(t('common.copied', '已复制')))
            .catch(() => toast.error(String(t('common.copy', '复制'))));
        },
      },
      { type: "divider" },
      {
        id: "breakpoint",
        label: t('capture.menu.breakpoint', '添加断点'),
        icon: <Shield className="h-3.5 w-3.5" />,
        onClick: () => {
          // 暂无断点后端 — 与原型一致，提示占位
          toast(t('capture.menu.breakpoint', '添加断点'));
        },
      },
    ];
    showMenu(e, items);
  }, [showMenu, t]);

  // 过滤后的条目
  const filteredEntries = useMemo(() => (
    deferredFilter
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(deferredFilter.toLowerCase()) ||
            e.method.toLowerCase().includes(deferredFilter.toLowerCase()) ||
            (e.status && String(e.status).includes(deferredFilter)) ||
            e.host.toLowerCase().includes(deferredFilter.toLowerCase())
        )
      : entries
  ), [deferredFilter, entries]);

  const visibleEntries = useMemo(() => {
    const latestEntries = [...filteredEntries].reverse().slice(0, MAX_VISIBLE_CAPTURE_ENTRIES);
    if (!selectedEntryId || latestEntries.some((entry) => entry.id === selectedEntryId)) {
      return latestEntries;
    }

    const selected = filteredEntries.find((entry) => entry.id === selectedEntryId);
    return selected ? [...latestEntries, selected] : latestEntries;
  }, [filteredEntries, selectedEntryId]);

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) || null;

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="shrink-0 space-y-2">
        <div className="wb-request-shell">
          <span className={cn("wb-request-prefix", running ? "bg-success" : "bg-text-disabled")}>
            {running ? <Play className="h-3.5 w-3.5" fill="currentColor" /> : <Square className="h-3.5 w-3.5" fill="currentColor" />}
            {running ? t('capture.proxyRunning') : t('capture.proxyStopped')}
          </span>

          <div className="wb-inline-field w-[110px]">
            <span>{t('capture.port')}</span>
            <input
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              disabled={running}
              className="text-center"
            />
          </div>

          <div className="wb-request-main">
            <span className="wb-request-label">{t('capture.filter', { defaultValue: '过滤' })}</span>
            <Search className="h-3.5 w-3.5 text-text-disabled" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('capture.filterPlaceholder')}
              className="wb-request-input"
            />
          </div>

          <div className="wb-request-actions">
            <button
              onClick={clearEntries}
              className="wb-icon-btn"
              title={t('capture.clear')}
            >
              <Trash2 className="h-3.5 w-3.5" />
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
                    className="wb-field h-7 w-[280px] pf-text-xs font-mono px-2"
                    autoFocus
                  />
                  <button onClick={handleOpenBrowser} className="wb-primary-btn h-7 px-3 pf-text-xs">
                    <Play className="h-3 w-3" fill="currentColor" />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleToggleCapture}
              className={cn(
                "wb-primary-btn",
                running ? "bg-error hover:bg-error/90" : "bg-accent hover:bg-accent-hover"
              )}
            >
              {running ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
              {running ? t('capture.stopCapture') : t('capture.startCapture')}
            </button>
          </div>
        </div>

        <div className="wb-request-secondary">
          <span className="pf-status-chip">
            <span className={cn("pf-dot", running ? "s-live" : "s-idle")} />
            {running ? t('capture.proxyRunning') : t('capture.proxyStopped')}
          </span>
          <span className="pf-pill">
            <Globe className="h-3 w-3" />
            127.0.0.1:{port}
          </span>
          <span className="pf-pill">
            {t('capture.requestCount', { count: filteredEntries.length })}
          </span>
          {running ? (
            <span className="pf-pill">
              <Globe className="h-3 w-3" />
              {t('capture.browserProxyReady', { defaultValue: '浏览器代理可用' })}
            </span>
          ) : null}
          {caTrusted !== null ? (
            <span className={cn("pf-pill", caTrusted ? "ok" : "warn")}>
              <Shield className="h-3 w-3" />
              {caTrusted ? t('capture.caTrustedTitle') : t('capture.caNotTrustedTitle')}
            </span>
          ) : null}
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
            <div className="mt-2 pf-rounded-md border border-error/30 bg-error/10 px-4 py-2.5 pf-text-xs text-error flex items-center gap-2">
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
              "mt-3 pf-rounded-md border px-4 py-3 pf-text-xs",
              caTrusted
                ? "border-success/20 bg-success/5"
                : "border-warning/30 bg-warning/[0.08]"
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  "shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center",
                  caTrusted ? "bg-success/20" : "bg-warning/20"
                )}>
                  <Shield className={cn("w-3.5 h-3.5", caTrusted ? "text-success" : "text-warning")} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn("font-semibold mb-1", caTrusted ? "text-success" : "text-warning")}>
                    {caTrusted ? t('capture.caTrustedTitle') : t('capture.caNotTrustedTitle')}
                  </div>
                  <p className="text-text-tertiary pf-text-xxs mb-2 leading-relaxed">
                    {caTrusted ? t('capture.caTrustedDesc') : t('capture.caNotTrustedDesc')}
                  </p>
                  {caPath && (
                    <code className={cn(
                      "font-mono pf-text-xxs px-1.5 py-0.5 pf-rounded-xs break-all",
                      caTrusted ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 pf-rounded-md bg-warning hover:bg-warning/90 text-white pf-text-xxs font-semibold transition-colors shadow-sm"
                      >
                        <Shield className="w-3 h-3" />
                        {t('capture.installCaCert')}
                      </button>
                      <button
                        onClick={handleExportCA}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 pf-rounded-md bg-bg-tertiary hover:bg-bg-hover text-text-secondary pf-text-xxs font-medium transition-colors"
                      >
                        {t('capture.exportCaCert')}
                      </button>
                      <span className="text-text-disabled pf-text-xxs">{t('capture.installCaCertHint')}</span>
                    </div>
                  )}
                  {caInstallStatus && (
                    <div className={cn(
                      "mt-2 px-2.5 py-1.5 pf-rounded-md pf-text-xxs",
                      caInstallStatus.ok
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-error/10 text-error border border-error/20"
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
                  <div className="pf-text-sm font-semibold text-text-primary">{t('capture.requestCount', { count: filteredEntries.length })}</div>
                  <div className="pf-text-xs text-text-tertiary">{t('capture.emptyDesc')}</div>
                </div>
                <span className="wb-tool-chip">{running ? t('capture.listening', { port: portInput }) : t('capture.awaitingStart')}</span>
              </div>
              <div className="flex items-center h-[26px] border-b border-border-default pf-text-xxs font-semibold text-text-tertiary uppercase tracking-[0.05em] select-none shrink-0 px-3">
                <span className="w-[54px] shrink-0">{t('capture.method')}</span>
                <span className="w-[52px] shrink-0 text-center">{t('capture.status')}</span>
                <span className="flex-1 min-w-0">Host / Path</span>
                <span className="w-[76px] shrink-0">{t('http.type')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.size')}</span>
                <span className="w-[70px] shrink-0 text-right">{t('capture.duration')}</span>
              </div>
              {/* 请求列表 — 倒序排列，最新在最上方 */}
              <div className="flex-1 overflow-auto">
                {visibleEntries.map((entry) => (
                  <RequestRow
                    key={entry.id}
                    entry={entry}
                    isSelected={entry.id === selectedEntryId}
                    onSelect={setSelectedEntry}
                    onContextMenu={handleRowContextMenu}
                  />
                ))}
                {filteredEntries.length > MAX_VISIBLE_CAPTURE_ENTRIES && (
                  <div className="px-3 py-2 text-center pf-text-xxs text-text-disabled">
                    {t('capture.truncatedHint', '仅渲染最近 {{max}} 条请求，共 {{total}} 条', { max: MAX_VISIBLE_CAPTURE_ENTRIES, total: filteredEntries.length })}
                  </div>
                )}
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
      {MenuComponent}
    </div>
  );
});

CaptureWorkspace.displayName = "CaptureWorkspace";

// ── 空状态 ──
function EmptyState({ running, port, embedded = false }: { running: boolean; port: number; embedded?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex h-full items-center justify-center", !embedded && "wb-panel")}>
      <div className="w-full max-w-3xl px-6 py-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/5 flex items-center justify-center border border-border-default/60">
          <ArrowUpDown className="w-7 h-7 text-accent/40" />
        </div>
        {running ? (
          <>
            <h3 className="pf-text-md font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="pf-text-sm text-text-tertiary mb-4">
              {t('capture.proxyRunning')} <code className="font-mono text-accent bg-accent/5 px-1.5 py-0.5 rounded pf-text-xs">127.0.0.1:{port}</code> {t('capture.proxyRunningOn')}
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2">
              <div className="border-t border-border-default/60 pt-3 pf-text-xs text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded bg-bg-tertiary px-2 py-0.5 pf-text-xxs font-mono">{t('capture.httpProxy')}</span>
                  <span className="font-mono text-text-primary">127.0.0.1:{port}</span>
                </div>
                <p className="mt-2 pf-text-xxs text-text-disabled">{t('capture.proxyHint')}</p>
              </div>
              <div className="border-t border-border-default/60 pt-3 pf-text-xs text-text-tertiary">
                <p className="font-medium text-text-secondary">{t('capture.general')}</p>
                <div className="mt-2 flex items-start gap-1.5 pf-text-xxs text-text-disabled">
                  <Lightbulb className="w-3 h-3 text-warning shrink-0 mt-[1px]" />
                  <span>{t('capture.httpsHint')}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="pf-text-md font-semibold text-text-primary mb-1">
              {t('capture.emptyTitle')}
            </h3>
            <p className="pf-text-sm text-text-tertiary">
              {t('capture.emptyState')}
            </p>
            <div className="mt-6 grid gap-4 text-left sm:grid-cols-3">
              <div className="border-t border-border-default/60 pt-3">
                <div className="pf-text-xs font-semibold text-text-secondary">{t('capture.emptyStep1')}</div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('capture.emptyStep1Desc')}</div>
              </div>
              <div className="border-t border-border-default/60 pt-3">
                <div className="pf-text-xs font-semibold text-text-secondary">{t('capture.emptyStep2')}</div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('capture.emptyStep2Desc')}</div>
              </div>
              <div className="border-t border-border-default/60 pt-3">
                <div className="pf-text-xs font-semibold text-text-secondary">{t('capture.emptyStep3')}</div>
                <div className="mt-1 pf-text-xxs text-text-tertiary">{t('capture.emptyStep3Desc')}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 请求行 ──
const RequestRow = memo(function RequestRow({
  entry,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  entry: CapturedEntry;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: CapturedEntry) => void;
}) {
  const onClick = useCallback(() => onSelect(entry.id), [entry.id, onSelect]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => onContextMenu(e, entry), [entry, onContextMenu]);
  const mtagClass = methodTagClass(entry.method);

  // 精简 content-type 显示
  const shortType = entry.contentType
    ? entry.contentType.split(";")[0].replace("application/", "").replace("text/", "")
    : "—";

  return (
    <div
      onClick={onClick}
      onContextMenu={handleContextMenu}
      className={cn(
        "flex items-center h-[30px] px-3 cursor-pointer transition-colors border-b border-border-subtle/40",
        isSelected
          ? "bg-accent-soft text-text-primary"
          : entry.completed
          ? "hover:bg-bg-hover text-text-secondary"
          : "text-text-disabled animate-pulse"
      )}
    >
      <span className="w-[54px] shrink-0">
        <span className={cn("pf-mtag pf-text-3xs", mtagClass)}>{entry.method}</span>
      </span>
      <span className={cn("w-[52px] shrink-0 text-center font-mono pf-text-xxs font-semibold tabular-nums", statusColor(entry.status))}>
        {entry.status || <Clock className="inline w-3 h-3 text-text-disabled animate-pulse" />}
      </span>
      <span className="flex-1 min-w-0 truncate font-mono pf-text-xxs" title={entry.url}>
        <span className="text-text-tertiary">{entry.host}</span>
        <span className="text-text-primary">{entry.path?.startsWith("/") ? entry.path : entry.path ? `/${entry.path}` : ""}</span>
      </span>
      <span className="w-[76px] shrink-0 truncate pf-text-xxs text-text-tertiary" title={entry.contentType || ""}>
        {shortType}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono pf-text-xxs tabular-nums text-text-tertiary">
        {formatSize(entry.responseSize)}
      </span>
      <span className="w-[70px] shrink-0 text-right font-mono pf-text-xxs tabular-nums text-text-tertiary">
        {formatDuration(entry.durationMs)}
      </span>
    </div>
  );
});
RequestRow.displayName = "RequestRow";

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
        <div className="flex items-center gap-2 pf-text-xs">
          <span className={cn("pf-mtag pf-text-3xs", methodTagClass(entry.method))}>
            {entry.method}
          </span>
          <span className="font-mono pf-text-xxs text-text-secondary truncate max-w-[400px]" title={entry.url}>
            {entry.url}
          </span>
          <span className={cn("font-mono pf-text-xxs font-medium", statusColor(entry.status))}>
            {entry.status} {entry.statusText}
          </span>
          <span className="text-text-disabled pf-text-xxs">·</span>
          <span className="font-mono pf-text-xxs text-text-disabled">{formatDuration(entry.durationMs)}</span>
          <span className="text-text-disabled pf-text-xxs">·</span>
          <span className="font-mono pf-text-xxs text-text-disabled">{formatSize(entry.responseSize)}</span>
        </div>
        <button
          onClick={onClose}
          className="mr-1 flex h-7 w-7 items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 左右分栏：Request | Response */}
      <div className="flex-1 flex min-h-0">
        {/* Request 面板 */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border-default/50">
          <BurpTabStrip label="Request" activeTab={reqTab} onChange={setReqTab} color="text-accent" />
          <div className="flex-1 overflow-auto">
            {reqTab === "raw" && <RawView type="request" entry={entry} />}
            {reqTab === "headers" && <HeadersTableView headers={entry.requestHeaders} />}
            {reqTab === "hex" && <HexView data={entry.requestBodyRaw} />}
          </div>
        </div>
        {/* Response 面板 */}
        <div className="flex-1 flex flex-col min-w-0">
          <BurpTabStrip label="Response" activeTab={resTab} onChange={setResTab} color="text-success" />
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
    <div className="shrink-0 flex items-center gap-0.5 border-b border-border-default px-2.5 h-[33px]">
      <span className={cn("pf-text-xs font-semibold mr-2", color)}>{label}</span>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "h-full px-2.5 pf-text-sm font-medium transition-colors relative",
            activeTab === tab.id
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <div className="absolute bottom-[-1px] left-2 right-2 h-[2px] bg-accent rounded-full" />
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
      className="p-3 pf-text-xxs font-mono text-text-secondary whitespace-pre-wrap break-all select-text leading-[1.6] cursor-text"
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
      <div className="p-4 text-center text-text-disabled pf-text-xs">
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
            "flex pf-text-xxs font-mono px-3 py-1.5 select-text cursor-text",
            i > 0 && "border-t border-border-subtle/40",
            i % 2 === 0 ? "bg-transparent" : "bg-bg-secondary/30"
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
      <div className="p-4 text-center text-text-disabled pf-text-xs">
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
      className="p-3 pf-text-xxs font-mono text-text-secondary leading-[1.6] select-text cursor-text whitespace-pre"
      style={{ userSelect: "text", WebkitUserSelect: "text" }}
    >
      {lines.join("\n")}
    </pre>
  );
}
