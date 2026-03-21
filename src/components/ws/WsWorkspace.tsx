import { useState, useEffect, useRef, useCallback } from "react";
import { Zap, Send as SendIcon, X, Plug, Trash2, ArrowDown, AlertTriangle, Search, Settings2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { InlineJsonViewer } from "@/components/ui/ResponseViewer";
import type { WsMessage, WsEvent } from "@/types/ws";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher, type RequestKind } from "@/components/request/RequestProtocolSwitcher";

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
  const [sendMode, setSendMode] = useState<"text" | "binary">("text");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const tabId = activeTab?.id;

  // 自动滚动
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
  }, []);

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
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      const { onWsEvent } = await import("@/services/wsService");
      unlisten = await onWsEvent((event: WsEvent) => {
        if (event.connectionId !== tabId) return;
        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            reconnectCountRef.current = 0; // 连接成功后重置重连计数
            if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
            break;
          case "message":
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(),
              direction: "received",
              data: event.data || "",
              dataType: (event.dataType as "text" | "binary") || "text",
              timestamp: event.timestamp,
              size: event.size || 0,
            }]);
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            // 仅在非正常断开时自动重连（error 或 server_close）
            if (autoReconnect && event.reason !== "normal" && !reconnectTimerRef.current) {
              reconnectCountRef.current += 1;
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                doConnect();
              }, 3000);
            }
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received",
              data: `[ERROR] ${t('ws.error')}: ${event.data}`, dataType: "text",
              timestamp: event.timestamp, size: 0,
            }]);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, autoReconnect]);

  if (!activeTab) return null;
  const url = activeTab.wsUrl || "ws://localhost:8080";

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
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "received",
        data: `[ERROR] ${t('ws.connectionFailed')}: ${errMsg}`, dataType: "text",
        timestamp: new Date().toISOString(), size: 0,
      }]);
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
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), direction: "sent",
          data: bytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
          dataType: "binary", timestamp: new Date().toISOString(), size: bytes.length,
        }]);
      } else {
        const { wsSend } = await import("@/services/wsService");
        await wsSend(activeTab.id, message);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), direction: "sent", data: message,
          dataType: "text", timestamp: new Date().toISOString(), size: new Blob([message]).size,
        }]);
      }
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "received",
        data: `[ERROR] ${t('ws.sendFailed')}: ${errMsg}`, dataType: "text",
        timestamp: new Date().toISOString(), size: 0,
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { return ts; }
  };

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  // 消息过滤
  const filteredMessages = searchQuery
    ? messages.filter(m => m.data.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

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
      name: kind === "graphql" ? "GraphQL Request" : kind === "sse" ? "SSE Stream" : "Untitled Request",
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
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-disabled">{t('ws.customHeaders')}</h4>
                <button onClick={addHeader} className="text-[10px] text-accent hover:underline">+ {t('ws.addHeader')}</button>
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
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                <input type="checkbox" checked={autoReconnect} onChange={() => setAutoReconnect(!autoReconnect)} className="accent-accent" />
                <RefreshCw className="w-3 h-3" /> {t('ws.autoReconnect')}
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                <input type="checkbox" checked={heartbeatEnabled} onChange={() => setHeartbeatEnabled(!heartbeatEnabled)} className="accent-accent" />
                {t('ws.heartbeat')}
              </label>
              {heartbeatEnabled && (
                <>
                  <input value={heartbeatInterval} onChange={(e) => setHeartbeatInterval(Math.max(1, parseInt(e.target.value) || 30))} className="wb-field-sm w-14 text-center" />
                  <span className="text-[10px] text-text-disabled">{t('ws.seconds')}</span>
                  <input value={heartbeatMsg} onChange={(e) => setHeartbeatMsg(e.target.value)} className="wb-field-sm w-24" placeholder="ping" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden px-3 pb-3 pt-1.5">
        <div className="wb-panel flex flex-1 flex-col overflow-hidden">
          {/* Status Header with search */}
          <div className="wb-panel-header shrink-0">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className={cn("h-2 w-2 rounded-[3px] transition-colors", connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-text-disabled")} />
              <span className="text-[12px] font-medium text-text-secondary">
                {connected ? t('ws.connected') : connecting ? t('ws.connecting') : t('ws.disconnected')}
              </span>
              {messages.length > 0 && <span className="text-[11px] text-text-tertiary ml-2">{filteredMessages.length}/{messages.length}</span>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              {/* 搜索框 */}
              <div className="wb-search w-[200px] max-w-full">
                <Search className="w-3 h-3 text-text-disabled" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('ws.searchMessages')} className="min-w-0 flex-1" />
                {searchQuery && <button onClick={() => setSearchQuery("")} className="text-text-disabled hover:text-text-primary"><X className="w-3 h-3" /></button>}
              </div>
              {!autoScroll && messages.length > 0 && (
                <button onClick={() => { setAutoScroll(true); messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="wb-ghost-btn px-2.5 text-[11px] text-accent">
                  <ArrowDown className="w-3 h-3" /> {t('ws.scrollToBottom')}
                </button>
              )}
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="wb-icon-btn hover:text-red-500" title={t('ws.clearMessages')}><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-bg-secondary/12 p-4">
            {filteredMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-border-default bg-bg-secondary shadow-sm">
                  <Zap className="w-8 h-8 opacity-20 text-amber-500" />
                </div>
                <p className="text-[14px] font-medium text-text-secondary">{searchQuery ? t('commandPalette.noResults') : t('ws.emptyTitle')}</p>
                <p className="text-[12px] mt-1">{searchQuery ? '' : t('ws.emptyDesc')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMessages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "sent" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[75%] rounded-[12px] px-4 py-2.5 text-[13px] font-mono break-words shadow-sm",
                      m.direction === "sent"
                        ? "rounded-tr-[8px] border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-orange-500/10 text-amber-900 dark:text-amber-100"
                        : m.data.startsWith("[ERROR]")
                          ? "rounded-tl-[8px] border border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                          : "rounded-tl-[8px] border border-border-default bg-bg-elevated text-text-secondary"
                    )}>
                      <div className="whitespace-pre-wrap break-all" style={{ userSelect: "text" }}>
                        {m.data.startsWith("[ERROR]") ? (
                          <span className="flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                            <span><InlineJsonViewer data={m.data.replace(/^\[ERROR\]\s*/, '')} /></span>
                          </span>
                        ) : (
                          <InlineJsonViewer data={m.data} />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] opacity-50">{formatTime(m.timestamp)}</span>
                        {m.size > 0 && <span className="text-[10px] opacity-40">{formatSize(m.size)}</span>}
                        {m.dataType === "binary" && <span className="rounded-[7px] bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-sans text-text-tertiary">BIN</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="shrink-0 border-t border-border-default/70 bg-bg-secondary/18 p-2">
            <div className="flex items-stretch gap-2">
              {/* Send mode toggle */}
              <div className="flex shrink-0 flex-col gap-1">
                <button onClick={() => setSendMode(sendMode === "text" ? "binary" : "text")} className={cn("wb-field-sm h-10 min-w-[62px] px-3 font-semibold", sendMode === "binary" ? "border-violet-300 bg-violet-500/10 text-violet-600" : "text-text-tertiary")}>
                  {sendMode === "text" ? "TEXT" : "HEX"}
                </button>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={sendMode === "binary" ? t('tcp.sendPanel.hexPlaceholder') : t('ws.messagePlaceholder')}
                disabled={!connected}
                className="wb-textarea h-10 min-h-10 max-h-[108px] flex-1 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!connected || !message.trim()}
                className="wb-primary-btn h-10 min-w-[84px] bg-amber-500 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendIcon className="w-4 h-4" /> {t('ws.send')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
