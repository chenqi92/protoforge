import { useState, useEffect, useRef, useCallback } from "react";
import { Zap, Send as SendIcon, X, Plug, Trash2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { WsMessage, WsEvent } from "@/types/ws";

export function WsWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const tabId = activeTab?.id;

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // 监听滚动判断是否在底部
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  // 监听 WebSocket 事件
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
            break;
          case "message":
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                direction: "received",
                data: event.data || "",
                dataType: (event.dataType as "text" | "binary") || "text",
                timestamp: event.timestamp,
                size: event.size || 0,
              },
            ]);
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            // 添加错误消息到消息列表
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                direction: "received",
                data: `⚠ 错误: ${event.data}`,
                dataType: "text",
                timestamp: event.timestamp,
                size: 0,
              },
            ]);
            break;
        }
      });
    };

    setup();
    return () => { unlisten?.(); };
  }, [tabId]);

  if (!activeTab) return null;
  const url = activeTab.wsUrl || "ws://localhost:8080";

  const handleConnect = async () => {
    if (connected) {
      const { wsDisconnect } = await import("@/services/wsService");
      await wsDisconnect(activeTab.id);
      setConnected(false);
    } else {
      setConnecting(true);
      try {
        const { wsConnect } = await import("@/services/wsService");
        await wsConnect(activeTab.id, url);
      } catch (err: unknown) {
        setConnecting(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            direction: "received",
            data: `⚠ 连接失败: ${errMsg}`,
            dataType: "text",
            timestamp: new Date().toISOString(),
            size: 0,
          },
        ]);
      }
    }
  };

  const handleSend = async () => {
    if (!connected || !message.trim()) return;
    try {
      const { wsSend } = await import("@/services/wsService");
      await wsSend(activeTab.id, message);
      // 添加已发送消息
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: "sent",
          data: message,
          dataType: "text",
          timestamp: new Date().toISOString(),
          size: new Blob([message]).size,
        },
      ]);
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: "received",
          data: `⚠ 发送失败: ${errMsg}`,
          dataType: "text",
          timestamp: new Date().toISOString(),
          size: 0,
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* Top Connection Bar */}
      <div className="shrink-0 p-4 pb-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          {/* Protocol Badge */}
          <div className="relative h-full shrink-0">
            <div className="flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-amber-500 min-w-[90px] shadow-sm">
              <Zap className="w-3.5 h-3.5" />
              WS
            </div>
          </div>

          {/* URL Input */}
          <input
            value={url}
            onChange={(e) => updateTab(activeTab.id, { wsUrl: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="输入 WebSocket 地址，如 ws://localhost:8080/ws"
            disabled={connected}
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-60"
          />

          {/* Connect Button */}
          <button
            onClick={handleConnect}
            disabled={connecting}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
              connected
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md active:scale-[0.98]"
                : connecting
                  ? "bg-amber-400 cursor-wait"
                  : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 hover:shadow-md active:scale-[0.98]"
            )}
          >
            {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
            {connected ? "断开" : connecting ? "连接中..." : "连接"}
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        <div className="flex-1 flex flex-col bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
          {/* Status Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/40 border-b border-border-default shrink-0">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full transition-colors",
                connected
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"
                  : "bg-text-disabled"
              )} />
              <span className="text-[13px] font-medium text-text-secondary">
                {connected ? "已连接" : connecting ? "连接中..." : "未连接"}
              </span>
              {messages.length > 0 && (
                <span className="text-[11px] text-text-tertiary ml-2">
                  {messages.length} 条消息
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!autoScroll && messages.length > 0 && (
                <button
                  onClick={() => {
                    setAutoScroll(true);
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-accent hover:bg-accent-soft rounded-md transition-colors"
                >
                  <ArrowDown className="w-3 h-3" />
                  滚到底部
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                  title="清空消息"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto p-5 bg-bg-input/30"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4 border border-border-default shadow-sm">
                  <Zap className="w-8 h-8 opacity-20 text-amber-500" />
                </div>
                <p className="text-[14px] font-medium text-text-secondary">WebSocket 调试</p>
                <p className="text-[12px] mt-1">连接到服务器开始收发消息</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "sent" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[75%] px-4 py-2.5 rounded-2xl text-[13px] font-mono break-words shadow-sm",
                      m.direction === "sent"
                        ? "bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-100 rounded-tr-sm"
                        : m.data.startsWith("⚠")
                          ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 rounded-tl-sm"
                          : "bg-bg-elevated border border-border-default text-text-secondary rounded-tl-sm"
                    )}>
                      <div className="whitespace-pre-wrap break-all" style={{ userSelect: "text" }}>{m.data}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] opacity-50">{formatTime(m.timestamp)}</span>
                        {m.size > 0 && <span className="text-[10px] opacity-40">{formatSize(m.size)}</span>}
                        {m.dataType === "binary" && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-bg-tertiary rounded text-text-tertiary font-sans">BIN</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Message Input Bar */}
          <div className="shrink-0 p-3 bg-bg-secondary/20 border-t border-border-default">
            <div className="flex items-end gap-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息内容... (Enter 发送, Shift+Enter 换行)"
                disabled={!connected}
                className="flex-1 max-h-[120px] min-h-[44px] h-[44px] p-3 text-[13px] font-mono bg-bg-input border border-border-default rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all outline-none resize-y disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSend}
                disabled={!connected || !message.trim()}
                className="h-[44px] px-5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0"
              >
                <SendIcon className="w-4 h-4" />
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
