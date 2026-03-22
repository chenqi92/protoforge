import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Zap, Send as SendIcon, X, Plug, Trash2, Search, Settings2, RefreshCw, ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { WsMessage } from "@/types/ws";
import type { WsEvent } from "@/types/ws";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher, type RequestKind } from "@/components/request/RequestProtocolSwitcher";
import { CodeEditor } from "@/components/common/CodeEditor";

interface KVItem { key: string; value: string; enabled: boolean }

export function WsWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const { t } = useTranslation();

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [sendMode, setSendMode] = useState<"json" | "text" | "binary">("text");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHeaders, setShowHeaders] = useState(false);
  const [headers, setHeaders] = useState<KVItem[]>([{ key: "", value: "", enabled: true }]);
  const [autoReconnect, setAutoReconnect] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(false);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [heartbeatMsg, setHeartbeatMsg] = useState("ping");
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoReconnectRef = useRef(autoReconnect);
  const connectedRef = useRef(false);
  const lastEventFingerprintRef = useRef<{ key: string; at: number } | null>(null);

  const tabId = activeTab?.id;

  useEffect(() => {
    autoReconnectRef.current = autoReconnect;
  }, [autoReconnect]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!tabId) return;
    let cancelled = false;

    const syncState = async () => {
      try {
        const { wsIsConnected } = await import("@/services/wsService");
        const isConnected = await wsIsConnected(tabId);
        if (cancelled) return;
        setConnected(isConnected);
        setConnecting(false);
      } catch {
        if (!cancelled) {
          setConnecting(false);
        }
      }
    };

    void syncState();
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  const appendMessage = useCallback((message: WsMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const pushWsEventMessage = useCallback((message: WsMessage) => {
    appendMessage(message);
  }, [appendMessage]);

  if (!activeTab) return null;
  const url = activeTab.wsUrl || "ws://localhost:8080";

  // 心跳定时器
  useEffect(() => {
    if (connected && heartbeatEnabled && heartbeatInterval > 0) {
      heartbeatTimerRef.current = setInterval(async () => {
        try {
          const { wsSend } = await import("@/services/wsService");
          if (tabId) await wsSend(tabId, heartbeatMsg);
        } catch {}
      }, heartbeatInterval * 1000);
    }
    return () => { if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current); };
  }, [connected, heartbeatEnabled, heartbeatInterval, heartbeatMsg, tabId]);

  // 监听 WS 事件
  useEffect(() => {
    if (!tabId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const { onWsEvent } = await import("@/services/wsService");
      const cleanup = await onWsEvent((event: WsEvent) => {
        if (disposed || event.connectionId !== tabId) return;

        const fingerprint = `${event.eventType}|${event.timestamp}|${event.dataType || ""}|${event.data || ""}|${event.reason || ""}`;
        const now = Date.now();
        if (lastEventFingerprintRef.current?.key === fingerprint && now - lastEventFingerprintRef.current.at < 250) {
          return;
        }
        lastEventFingerprintRef.current = { key: fingerprint, at: now };

        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            reconnectCountRef.current = 0;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            pushWsEventMessage({
              id: crypto.randomUUID(),
              kind: "status",
              title: t('ws.connectionSuccess'),
              status: "connected",
              data: event.data || url,
              dataType: "text",
              timestamp: event.timestamp,
              size: 0,
            });
            break;
          case "message":
            pushWsEventMessage({
              id: crypto.randomUUID(),
              kind: "message",
              direction: "received",
              title: t('ws.received'),
              data: event.data || "",
              dataType: (event.dataType as "text" | "binary") || "text",
              timestamp: event.timestamp,
              size: event.size || 0,
            });
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            if (event.reason !== "error" || connectedRef.current) {
              pushWsEventMessage({
                id: crypto.randomUUID(),
                kind: "status",
                title: t('ws.disconnected'),
                status: "disconnected",
                data: event.data || url,
                dataType: "text",
                timestamp: event.timestamp,
                size: 0,
              });
            }
            if (autoReconnectRef.current && event.reason !== "normal" && !reconnectTimerRef.current) {
              reconnectCountRef.current += 1;
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                void doConnect();
              }, 3000);
            }
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            pushWsEventMessage({
              id: crypto.randomUUID(),
              kind: "error",
              title: t('ws.error'),
              data: event.data || "",
              dataType: "text",
              timestamp: event.timestamp,
              size: 0,
            });
            break;
        }
      });

      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    };

    void setup();
    return () => {
      disposed = true;
      unlisten?.();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, t, pushWsEventMessage, url]);

  const doConnect = async () => {
    setConnecting(true);
    try {
      const { wsConnect } = await import("@/services/wsService");
      const headerMap: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key.trim()).forEach(h => { headerMap[h.key] = h.value; });
      await wsConnect(activeTab.id, url, Object.keys(headerMap).length > 0 ? headerMap : null);
    } catch (err: unknown) {
      setConnecting(false);
      const errMsg = err instanceof Error ? err.message : String(err);
      appendMessage({
        id: crypto.randomUUID(),
        kind: "error",
        title: t('ws.connectionFailed'),
        data: errMsg,
        dataType: "text",
        timestamp: new Date().toISOString(),
        size: 0,
      });
    }
  };

  const handleConnect = async () => {
    if (connected) {
      setAutoReconnect(false); // 手动断开时停止自动重连
      const { wsDisconnect } = await import("@/services/wsService");
      await wsDisconnect(activeTab.id);
      setConnected(false);
    } else {
      await doConnect();
    }
  };

  const handleSend = async () => {
    if (!connected || !message.trim()) return;
    try {
      if (sendMode === "binary") {
        // Parse hex string to bytes
        const { wsSendBinary } = await import("@/services/wsService");
        const bytes = message.trim().split(/\s+/).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
        await wsSendBinary(activeTab.id, bytes);
        appendMessage({
          id: crypto.randomUUID(), direction: "sent",
          kind: "message",
          title: t('ws.sent'),
          data: bytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
          dataType: "binary", timestamp: new Date().toISOString(), size: bytes.length,
        });
      } else {
        const { wsSend } = await import("@/services/wsService");
        await wsSend(activeTab.id, message);
        appendMessage({
          id: crypto.randomUUID(),
          kind: "message",
          direction: "sent",
          title: t('ws.sent'),
          data: message,
          dataType: "text",
          timestamp: new Date().toISOString(),
          size: new Blob([message]).size,
        });
      }
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendMessage({
        id: crypto.randomUUID(),
        kind: "error",
        title: t('ws.sendFailed'),
        data: errMsg,
        dataType: "text",
        timestamp: new Date().toISOString(),
        size: 0,
      });
    }
  };


  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { return ts; }
  };

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  const filteredMessages = useMemo(() => {
    if (!searchQuery) return messages;
    const normalized = searchQuery.toLowerCase();
    return messages.filter((messageItem) => {
      const haystack = `${messageItem.title} ${messageItem.data}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [messages, searchQuery]);

  const displayMessages = useMemo(() => [...filteredMessages].reverse(), [filteredMessages]);

  const addHeader = () => setHeaders([...headers, { key: "", value: "", enabled: true }]);
  const removeHeader = (i: number) => setHeaders(headers.filter((_, idx) => idx !== i));

  const handleRequestKindChange = useCallback(async (kind: RequestKind) => {
    if (!activeTab || kind === activeTab.protocol) return;
    try {
      if (connected || connecting) {
        const { wsDisconnect } = await import("@/services/wsService");
        await wsDisconnect(activeTab.id);
      }
    } catch {}
    setShowHeaders(false);

    if (kind === "ws") return;

    if (kind === "mqtt") {
      setTabProtocol(activeTab.id, "mqtt");
      return;
    }

    setTabProtocol(activeTab.id, "http");
    updateHttpConfig(activeTab.id, {
      requestMode: kind === "http" ? "rest" : kind,
      name: kind === "graphql" ? "GraphQL Request" : "Untitled Request",
      method: kind === "graphql" ? "POST" : "GET",
    });
  }, [activeTab, connected, connecting, setTabProtocol, updateHttpConfig]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Top Connection Bar */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab.protocol} onChange={handleRequestKindChange} />
        )}
        main={(
          <div className="flex min-w-0 flex-1 items-center">
            <input
              value={url}
              onChange={(e) => updateTab(activeTab.id, { wsUrl: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder={t('ws.placeholder')}
              disabled={connected}
              className="wb-request-input disabled:opacity-60"
            />
          </div>
        )}
        actions={(
          <>
            <div className="wb-request-toolgroup">
              <button onClick={() => setShowHeaders(!showHeaders)} className={cn("wb-icon-btn", showHeaders && "bg-amber-500/10 text-amber-600 border-amber-200")} title={t('ws.connectionSettings')}>
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className={cn(
                "wb-primary-btn min-w-[88px]",
                connected ? "bg-red-500 hover:bg-red-600" : connecting ? "bg-amber-400 cursor-wait" : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
              )}
            >
              {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
              {connected ? t('ws.disconnect') : connecting ? t('ws.connecting') : t('ws.connect')}
            </button>
          </>
        )}
      />

      {/* Headers / Settings Panel */}
      {showHeaders && (
        <div className="shrink-0 px-3 pb-1.5">
          <div className="space-y-2.5 rounded-[10px] border border-border-default/65 bg-bg-secondary/24 p-2.5">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <h4 className="text-[var(--fs-xxs)] font-bold uppercase tracking-wider text-text-disabled">{t('ws.customHeaders')}</h4>
                <button onClick={addHeader} className="text-[var(--fs-xxs)] text-accent hover:underline">+ {t('ws.addHeader')}</button>
              </div>
              {headers.map((h, i) => (
                <div key={i} className="mb-1 flex items-center gap-2">
                  <input type="checkbox" checked={h.enabled} onChange={() => { const c = [...headers]; c[i].enabled = !c[i].enabled; setHeaders(c); }} className="accent-accent" />
                  <input value={h.key} onChange={(e) => { const c = [...headers]; c[i].key = e.target.value; setHeaders(c); }} placeholder="Key" className="wb-field-sm min-w-0 flex-1" />
                  <input value={h.value} onChange={(e) => { const c = [...headers]; c[i].value = e.target.value; setHeaders(c); }} placeholder="Value" className="wb-field-sm min-w-0 flex-1" />
                  <button onClick={() => removeHeader(i)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-[var(--fs-xs)] text-text-secondary cursor-pointer">
                <input type="checkbox" checked={autoReconnect} onChange={() => setAutoReconnect(!autoReconnect)} className="accent-accent" />
                <RefreshCw className="w-3 h-3" /> {t('ws.autoReconnect')}
              </label>
              <label className="flex items-center gap-1.5 text-[var(--fs-xs)] text-text-secondary cursor-pointer">
                <input type="checkbox" checked={heartbeatEnabled} onChange={() => setHeartbeatEnabled(!heartbeatEnabled)} className="accent-accent" />
                {t('ws.heartbeat')}
              </label>
              {heartbeatEnabled && (
                <>
                  <input value={heartbeatInterval} onChange={(e) => setHeartbeatInterval(Math.max(1, parseInt(e.target.value) || 30))} className="wb-field-sm w-14 text-center" />
                  <span className="text-[var(--fs-xxs)] text-text-disabled">{t('ws.seconds')}</span>
                  <input value={heartbeatMsg} onChange={(e) => setHeartbeatMsg(e.target.value)} className="wb-field-sm w-24" placeholder="ping" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden px-3 pb-3 pt-0.5">
        <div className="wb-panel flex flex-1 flex-col overflow-hidden">
          {/* Status Header with search */}
          <div className="wb-panel-header shrink-0">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className={cn("h-2 w-2 rounded-[3px] transition-colors", connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-text-disabled")} />
              <span className="text-[var(--fs-sm)] font-medium text-text-secondary">
                {connected ? t('ws.connected') : connecting ? t('ws.connecting') : t('ws.disconnected')}
              </span>
              {messages.length > 0 && <span className="text-[var(--fs-xs)] text-text-tertiary ml-2">{filteredMessages.length}/{messages.length}</span>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              {/* 搜索框 */}
              <div className="wb-search w-[200px] max-w-full">
                <Search className="w-3 h-3 text-text-disabled" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('ws.searchMessages')} className="min-w-0 flex-1" />
                {searchQuery && <button onClick={() => setSearchQuery("")} className="text-text-disabled hover:text-text-primary"><X className="w-3 h-3" /></button>}
              </div>
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="wb-icon-btn hover:text-red-500" title={t('ws.clearMessages')}><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div
            ref={messagesContainerRef}
            className="flex-1 min-h-0 overflow-auto bg-bg-secondary/12"
          >
            {filteredMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center px-6 text-text-disabled">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-border-default bg-bg-secondary shadow-sm">
                  <Zap className="w-8 h-8 opacity-20 text-amber-500" />
                </div>
                <p className="text-[var(--fs-md)] font-medium text-text-secondary">{searchQuery ? t('commandPalette.noResults') : t('ws.emptyTitle')}</p>
                <p className="mt-1 text-[var(--fs-sm)]">{searchQuery ? '' : t('ws.emptyDesc')}</p>
              </div>
            ) : (
              <div className="divide-y divide-border-default/30">
                {displayMessages.map((item) => (
                  <WsMessageRow
                    key={item.id}
                    message={item}
                    formatTime={formatTime}
                    formatSize={formatSize}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Message Compose - Inside panel bottom */}
          <div className="shrink-0 border-t border-border-default/70 overflow-hidden">
            <div className="relative" style={{ height: 120 }}>
              <CodeEditor
                value={message}
                onChange={(v: string) => setMessage(v)}
                language={sendMode === "json" ? "json" : "plaintext"}
              />
              {/* Overlay controls at bottom */}
              <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between pointer-events-none">
                <select
                  value={sendMode}
                  onChange={(e) => setSendMode(e.target.value as "json" | "text" | "binary")}
                  className="pointer-events-auto wb-field-xs wb-native-select min-w-[68px] text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary bg-bg-primary/90 backdrop-blur-sm"
                >
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                  <option value="binary">Binary</option>
                </select>
                <button
                  onClick={handleSend}
                  disabled={!connected || !message.trim()}
                  className="pointer-events-auto inline-flex items-center justify-center gap-1.5 h-[26px] min-w-[60px] px-2.5 rounded-[9px] border-none bg-amber-500 text-white text-[var(--fs-xxs)] font-semibold shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                >
                  <SendIcon className="w-3 h-3" /> {t('ws.send')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 尝试格式化 JSON */
function tryFormatJson(data: string): { isJson: boolean; formatted: string } {
  try {
    const parsed = JSON.parse(data);
    return { isJson: true, formatted: JSON.stringify(parsed, null, 2) };
  } catch {
    return { isJson: false, formatted: data };
  }
}

/** 单行消息预览 */
function getWsMessageSummary(message: WsMessage, t: (key: string) => string) {
  if (message.kind === "status") {
    return message.status === "connected"
      ? `${t('ws.connectedTo')}: ${message.data}`
      : `${t('ws.disconnectedFrom')}: ${message.data}`;
  }

  if (message.kind === "error") {
    return message.data;
  }

  const compact = message.data.replace(/\s+/g, " ").trim();
  return compact || t('http.emptyValue');
}

/** 获取消息格式标签 (JSON/HEX/TEXT) */
function getWsMessageFormat(message: WsMessage) {
  if (message.kind !== "message") return null;
  if (message.dataType === "binary") return "HEX";

  try {
    JSON.parse(message.data);
    return "JSON";
  } catch {
    return "TEXT";
  }
}

/** 单条消息行 - 支持内联展开 */
function WsMessageRow({
  message,
  formatTime,
  formatSize,
}: {
  message: WsMessage;
  formatTime: (ts: string) => string;
  formatSize: (bytes: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const { isJson, formatted } = useMemo(() => tryFormatJson(message.data), [message.data]);
  const format = getWsMessageFormat(message);
  const preview = message.data.replace(/\n/g, ' ').slice(0, 200);

  // 状态消息行
  if (message.kind === "status" || message.kind === "error") {
    return (
      <div className="flex items-center gap-2.5 px-4 py-2 text-[var(--fs-xs)] text-text-tertiary">
        {message.kind === "status" && message.status === "connected" ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
        ) : message.kind === "error" ? (
          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
        )}
        <span className="flex-1 truncate">{getWsMessageSummary(message, t)}</span>
        <span className="shrink-0 font-mono text-[var(--fs-xxs)] text-text-disabled">
          {formatTime(message.timestamp)}
        </span>
      </div>
    );
  }

  // 数据消息行
  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50",
          expanded && "bg-bg-hover/30"
        )}
      >
        {/* 方向箭头 */}
        {message.direction === "sent" ? (
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-sky-500" />
        )}

        {/* 格式标签 */}
        {format && (
          <span className={cn(
            "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[var(--fs-xxs)] font-bold leading-none",
            format === "JSON" ? "border-emerald-200 bg-emerald-500/8 text-emerald-600 dark:border-emerald-500/25" :
            format === "HEX" ? "border-violet-200 bg-violet-500/8 text-violet-600 dark:border-violet-500/25" :
            "border-slate-200 bg-slate-500/8 text-slate-500 dark:border-slate-500/25"
          )}>
            {format}
          </span>
        )}

        {/* 内容摘要 */}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
          {preview}
        </span>

        {/* 大小 & 时间 */}
        <div className="flex shrink-0 items-center gap-2 text-[var(--fs-xxs)] text-text-disabled">
          {message.size > 0 && <span>{formatSize(message.size)}</span>}
          <span className="font-mono">{formatTime(message.timestamp)}</span>
        </div>

        {/* 展开/收起 */}
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
        }
      </button>

      {/* 内联展开详情 */}
      {expanded && (
        <div className="mx-4 mb-2 mt-0.5 rounded-lg border border-border-default/60 bg-bg-secondary/20 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border-default/40 px-3 py-1.5 text-[var(--fs-xxs)] text-text-tertiary">
            <span className="font-semibold">{isJson ? 'JSON' : message.dataType === 'binary' ? 'HEX' : 'TEXT'}</span>
            {message.size > 0 && <span className="ml-auto">{formatSize(message.size)}</span>}
          </div>
          <pre className={cn(
            "selectable overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-[1.6] text-text-primary max-h-[320px]",
          )}>
            {formatted}
          </pre>
        </div>
      )}
    </div>
  );
}
