import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Loader2, ChevronDown, X, Trash2, ArrowUp, ArrowDown, Search, ChevronUp, Plug, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { WsMessage, WsEvent } from "@/types/ws";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher, type RequestKind } from "@/components/request/RequestProtocolSwitcher";
import { CodeEditor } from "@/components/common/CodeEditor";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { KVEditor } from "@/components/http/HttpWorkspace";

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
  const [configTab, setConfigTab] = useState<"message" | "params" | "headers" | "settings">("message");
  const [params, setParams] = useState<KVItem[]>([{ key: "", value: "", enabled: true }]);

  const currentUrl = activeTab?.wsUrl || "ws://localhost:8080";

  useEffect(() => {
    try {
      const urlObj = new URL(currentUrl);
      const urlParams = new URLSearchParams(urlObj.search);
      const newParams: KVItem[] = [];
      urlParams.forEach((value, key) => {
        newParams.push({ key, value, enabled: true });
      });
      newParams.push({ key: "", value: "", enabled: true });
      setParams(newParams);
    } catch {
      // ignore
    }
  }, [currentUrl]);

  const handleParamsChange = useCallback((newParams: KVItem[]) => {
    setParams(newParams);
    try {
      const urlObj = new URL(currentUrl);
      const urlParams = new URLSearchParams();
      newParams.filter(p => p.enabled && p.key.trim()).forEach(p => urlParams.append(p.key, p.value));
      urlObj.search = urlParams.toString();
      updateTab(activeTab!.id, { wsUrl: urlObj.toString() });
    } catch {}
  }, [currentUrl, activeTab?.id, updateTab]);

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
    setMessages((prev) => {
      const next = [...prev, message];
      return next.length > 5000 ? next.slice(-5000) : next;
    });
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

  const handleRequestKindChange = useCallback(async (kind: RequestKind) => {
    if (!activeTab || kind === activeTab.protocol) return;
    try {
      if (connected || connecting) {
        const { wsDisconnect } = await import("@/services/wsService");
        await wsDisconnect(activeTab.id);
      }
    } catch {}

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
              value={currentUrl}
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
            <button
              onClick={handleConnect}
              disabled={connecting}
              className={cn(
                "wb-primary-btn min-w-[88px]",
                connected ? "bg-error hover:bg-error/90" : connecting ? "bg-warning cursor-wait opacity-70" : "bg-accent hover:bg-accent-hover"
              )}
            >
              {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
              {connected ? t('ws.disconnect') : connecting ? t('ws.connecting') : t('ws.connect')}
            </button>
          </>
        )}
      />

      <div className="flex-1 overflow-hidden pb-3 pt-1.5 relative">
        <div className="http-workbench-shell h-full">
          <PanelGroup orientation="vertical" className="h-full !overflow-visible">
            <Panel defaultSize={40} minSize={20} className="http-workbench-section flex flex-col relative z-10">
            <div className="wb-tabs shrink-0 scrollbar-hide">
              <button onClick={() => setConfigTab("message")} className={cn("wb-tab", configTab === "message" && "wb-tab-active text-text-primary")}>{t('ws.message')}</button>
              <button onClick={() => setConfigTab("params")} className={cn("wb-tab", configTab === "params" && "wb-tab-active text-text-primary")}>{t('http.params')}</button>
              <button onClick={() => setConfigTab("headers")} className={cn("wb-tab", configTab === "headers" && "wb-tab-active text-text-primary")}>{t('http.headers', 'Headers')}</button>
              <button onClick={() => setConfigTab("settings")} className={cn("wb-tab", configTab === "settings" && "wb-tab-active text-text-primary")}>{t('ws.settings')}</button>
            </div>

            <div className="http-workbench-body">
              {configTab === "message" && (
                <div className="h-full flex flex-col relative">
                  <div className="flex-1 min-h-0 relative">
                    <CodeEditor
                      value={message}
                      onChange={(v: string) => setMessage(v)}
                      language={sendMode === "json" ? "json" : "plaintext"}
                    />
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <select
                      value={sendMode}
                      onChange={(e) => setSendMode(e.target.value as "json" | "text" | "binary")}
                      className="pointer-events-auto wb-native-select text-[var(--fs-xs)] font-semibold text-text-secondary uppercase tracking-wider h-7 px-2 focus:ring-0 cursor-pointer bg-bg-primary/90 backdrop-blur-md border border-border-default/50 hover:bg-bg-hover transition-colors rounded-[var(--radius-sm)]"
                    >
                      <option value="text">TEXT</option>
                      <option value="json">JSON</option>
                      <option value="binary">BINARY</option>
                    </select>
                    <button
                      onClick={handleSend}
                      disabled={!connected || !message.trim()}
                      className="pointer-events-auto inline-flex items-center justify-center gap-1.5 h-7 px-3.5 rounded-[var(--radius-sm)] bg-accent text-white text-[var(--fs-xs)] font-bold tracking-wide shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> {t('ws.send')}
                    </button>
                  </div>
                </div>
              )}
              {configTab === "params" && (
                <div className="px-3 py-0 h-full overflow-hidden">
                  <KVEditor
                    items={params}
                    onChange={handleParamsChange}
                    kp="Query Param"
                    vp="Value"
                  />
                </div>
              )}
              {configTab === "headers" && (
                <div className="px-3 py-0 h-full overflow-hidden">
                  <KVEditor
                    items={headers}
                    onChange={setHeaders}
                    kp="Header"
                    vp="Value"
                    showPresets
                  />
                </div>
              )}
              {configTab === "settings" && (
                <div className="p-4 space-y-5 overflow-auto h-full">
                  <div className="space-y-3 max-w-xl">
                    <label className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-border-default/50 bg-bg-secondary/20 hover:bg-bg-secondary/40 transition-colors cursor-pointer">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 text-amber-600">
                        <Loader2 className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-sm)] font-medium text-text-primary">{t('ws.autoReconnect')}</div>
                        <div className="text-[var(--fs-xs)] text-text-tertiary">Automatically attempt to reconnect if the connection drops</div>
                      </div>
                      <input type="checkbox" checked={autoReconnect} onChange={() => setAutoReconnect(!autoReconnect)} className="w-4 h-4 accent-amber-500 rounded border-border-default" />
                    </label>

                    <div className="rounded-[var(--radius-md)] border border-border-default/50 bg-bg-secondary/20 overflow-hidden">
                      <label className="flex items-center gap-3 p-3 hover:bg-bg-secondary/40 transition-colors cursor-pointer">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 text-blue-600">
                          <Zap className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--fs-sm)] font-medium text-text-primary">{t('ws.heartbeat')}</div>
                          <div className="text-[var(--fs-xs)] text-text-tertiary">Send periodic ping messages to keep connection alive</div>
                        </div>
                        <input type="checkbox" checked={heartbeatEnabled} onChange={() => setHeartbeatEnabled(!heartbeatEnabled)} className="w-4 h-4 accent-amber-500 rounded border-border-default" />
                      </label>
                      {heartbeatEnabled && (
                        <div className="p-3 bg-bg-secondary/10 border-t border-border-default/30 flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--fs-xs)] text-text-secondary">Interval</span>
                            <div className="relative">
                              <input value={heartbeatInterval} onChange={(e) => setHeartbeatInterval(Math.max(1, parseInt(e.target.value) || 30))} className="wb-field-sm w-20 text-center pr-6" />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fs-xxs)] text-text-disabled uppercase">s</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--fs-xs)] text-text-secondary">Message</span>
                            <input value={heartbeatMsg} onChange={(e) => setHeartbeatMsg(e.target.value)} className="wb-field-sm w-32 font-mono" placeholder="ping" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="http-workbench-divider relative z-20" />

          <Panel defaultSize={45} minSize={20} className="http-workbench-section flex flex-col relative z-0">
            <div className="http-response-head shrink-0 z-10 relative">
              <div className="http-response-tabs scrollbar-hide">
                <span className="http-response-tab is-active">{t('ws.messages') || 'Messages'}</span>
              </div>

              <div className="http-response-meta">
                <div className="wb-search w-[200px] max-w-full">
                  <Search className="w-3.5 h-3.5 text-text-disabled" />
                  <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('ws.searchMessages')} className="min-w-0 flex-1" />
                  {searchQuery && <button onClick={() => setSearchQuery("")} className="text-text-disabled hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>}
                </div>

                <span className={cn("http-response-status",
                  connected
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : connecting
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                      : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-300"
                )}>
                  <span className={cn("http-response-status-dot",
                    connected ? "bg-emerald-500" : connecting ? "bg-amber-500" : "bg-slate-400"
                  )} />
                  {connected ? t('ws.connected') : connecting ? t('ws.connecting') : t('ws.disconnected')}
                </span>

                <span className="http-response-meta-pill">
                  <span className="http-response-meta-label">Messages</span>
                  <span className="http-response-meta-value font-mono">{messages.length}</span>
                </span>

                <button onClick={() => setMessages([])} className="wb-icon-btn hover:bg-red-500/10 hover:text-red-500 transition-colors" title={t('ws.clearMessages')} disabled={messages.length === 0}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              ref={messagesContainerRef}
              className="flex-1 min-h-0 overflow-auto"
            >
              {filteredMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center px-6 text-text-disabled">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] border border-border-default bg-bg-secondary shadow-sm">
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
          </Panel>
        </PanelGroup>
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
          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-sky-500" />
        )}

        {/* 格式标签 */}
        {format && (
          <span className={cn(
            "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[var(--fs-xxs)] font-bold leading-none",
            format === "JSON" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
            format === "HEX" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" :
            "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
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
