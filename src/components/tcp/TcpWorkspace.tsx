import { useState, useEffect, useRef, useCallback } from "react";
import { Network, Send as SendIcon, X, Plug, Trash2, ArrowDown, Server, Monitor, Radio, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type AppTab } from "@/stores/appStore";
import type { TcpMessage, TcpEvent, TcpServerClient } from "@/types/tcp";

export function TcpWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);

  if (!activeTab) return null;
  const isTcp = activeTab.protocol === "tcp";

  return isTcp ? <TcpPanel tab={activeTab} updateTab={updateTab} /> : <UdpPanel tab={activeTab} updateTab={updateTab} />;
}

// ═══════════════════════════════════════════
//  TCP Panel (Client + Server)
// ═══════════════════════════════════════════

type TcpModeType = "client" | "server";

function TcpPanel({ tab, updateTab }: { tab: AppTab; updateTab: (id: string, updates: Partial<AppTab>) => void }) {
  const [mode, setMode] = useState<TcpModeType>("client");

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* Mode Tabs */}
      <div className="shrink-0 px-4 pt-3 pb-0">
        <div className="flex items-center gap-1 bg-bg-secondary p-1 rounded-lg w-fit">
          <button
            onClick={() => setMode("client")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium rounded-md transition-all",
              mode === "client" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Monitor className="w-3.5 h-3.5" />
            客户端
          </button>
          <button
            onClick={() => setMode("server")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium rounded-md transition-all",
              mode === "server" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Server className="w-3.5 h-3.5" />
            服务端
          </button>
        </div>
      </div>

      {mode === "client" ? <TcpClientView tab={tab} updateTab={updateTab} /> : <TcpServerView tab={tab} updateTab={updateTab} />}
    </div>
  );
}

// ── TCP Client View ──

function TcpClientView({ tab, updateTab }: { tab: AppTab; updateTab: (id: string, updates: Partial<AppTab>) => void }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const host = tab.tcpHost || "localhost";
  const port = tab.tcpPort || 8080;

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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const { onTcpEvent } = await import("@/services/tcpService");
      unlisten = await onTcpEvent((event: TcpEvent) => {
        if (event.connectionId !== tab.id) return;
        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            break;
          case "data":
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received", data: event.data || "",
              encoding: "utf8", timestamp: event.timestamp, size: event.size || 0,
            }]);
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received", data: `⚠ 错误: ${event.data}`,
              encoding: "utf8", timestamp: event.timestamp, size: 0,
            }]);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [tab.id]);

  const handleConnect = async () => {
    if (connected) {
      const { tcpDisconnect } = await import("@/services/tcpService");
      await tcpDisconnect(tab.id);
      setConnected(false);
    } else {
      setConnecting(true);
      try {
        const { tcpConnect } = await import("@/services/tcpService");
        await tcpConnect(tab.id, host, port);
      } catch (err: unknown) {
        setConnecting(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), direction: "received", data: `⚠ 连接失败: ${errMsg}`,
          encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
        }]);
      }
    }
  };

  const handleSend = async () => {
    if (!connected || !message.trim()) return;
    try {
      const { tcpSend } = await import("@/services/tcpService");
      await tcpSend(tab.id, message);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "sent", data: message,
        encoding: "utf8", timestamp: new Date().toISOString(), size: new Blob([message]).size,
      }]);
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "received", data: `⚠ 发送失败: ${errMsg}`,
        encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      {/* Connection Bar */}
      <div className="shrink-0 p-4 pb-2 pt-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          <div className="relative h-full shrink-0">
            <div className="flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-blue-500 min-w-[90px] shadow-sm">
              <Network className="w-3.5 h-3.5" />
              TCP
            </div>
          </div>
          <input
            value={host}
            onChange={(e) => updateTab(tab.id, { tcpHost: e.target.value })}
            placeholder="主机地址"
            disabled={connected}
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary border-r border-border-default disabled:opacity-60"
          />
          <input
            value={port}
            onChange={(e) => updateTab(tab.id, { tcpPort: parseInt(e.target.value) || 0 })}
            placeholder="端口"
            type="number"
            disabled={connected}
            className="w-24 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary text-center disabled:opacity-60"
          />
          <button
            onClick={handleConnect}
            disabled={connecting}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
              connected
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md active:scale-[0.98]"
                : connecting
                  ? "bg-blue-400 cursor-wait"
                  : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:shadow-md active:scale-[0.98]"
            )}
          >
            {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
            {connected ? "断开" : connecting ? "连接中..." : "连接"}
          </button>
        </div>
      </div>

      {/* Messages + Input */}
      <MessagePanel
        messages={messages}
        setMessages={setMessages}
        message={message}
        setMessage={setMessage}
        connected={connected}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        messagesEndRef={messagesEndRef}
        messagesContainerRef={messagesContainerRef}
        handleScroll={handleScroll}
        handleSend={handleSend}
        handleKeyDown={handleKeyDown}
        accentColor="blue"
        icon={<Network className="w-8 h-8 opacity-20 text-blue-500" />}
        emptyTitle="TCP 客户端"
        emptyDesc="连接到 TCP 服务器开始收发数据"
      />
    </>
  );
}

// ── TCP Server View ──

function TcpServerView({ tab, updateTab }: { tab: AppTab; updateTab: (id: string, updates: Partial<AppTab>) => void }) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [clients, setClients] = useState<TcpServerClient[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const host = tab.tcpHost || "0.0.0.0";
  const port = tab.tcpPort || 9000;

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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const { onTcpServerEvent } = await import("@/services/tcpService");
      unlisten = await onTcpServerEvent((event: TcpEvent) => {
        if (event.connectionId !== tab.id) return;
        switch (event.eventType) {
          case "started":
            setRunning(true);
            setStarting(false);
            break;
          case "client-connected":
            if (event.clientId && event.remoteAddr) {
              setClients((prev) => [...prev, { id: event.clientId!, remoteAddr: event.remoteAddr!, connectedAt: event.timestamp }]);
              setMessages((prev) => [...prev, {
                id: crypto.randomUUID(), direction: "received", data: `🔗 客户端连接: ${event.remoteAddr}`,
                encoding: "utf8", timestamp: event.timestamp, size: 0, clientId: event.clientId,
              }]);
            }
            break;
          case "client-data":
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received", data: event.data || "",
              encoding: "utf8", timestamp: event.timestamp, size: event.size || 0, clientId: event.clientId,
            }]);
            break;
          case "client-disconnected":
            if (event.clientId) {
              setClients((prev) => prev.filter((c) => c.id !== event.clientId));
              setMessages((prev) => [...prev, {
                id: crypto.randomUUID(), direction: "received", data: `🔌 客户端断开: ${event.clientId?.slice(0, 8)}`,
                encoding: "utf8", timestamp: event.timestamp, size: 0, clientId: event.clientId,
              }]);
            }
            break;
          case "error":
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received", data: `⚠ 错误: ${event.data}`,
              encoding: "utf8", timestamp: event.timestamp, size: 0,
            }]);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [tab.id]);

  const handleStart = async () => {
    if (running) {
      const { tcpServerStop } = await import("@/services/tcpService");
      await tcpServerStop(tab.id);
      setRunning(false);
      setClients([]);
    } else {
      setStarting(true);
      try {
        const { tcpServerStart } = await import("@/services/tcpService");
        await tcpServerStart(tab.id, host, port);
      } catch (err: unknown) {
        setStarting(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), direction: "received", data: `⚠ 启动失败: ${errMsg}`,
          encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
        }]);
      }
    }
  };

  const handleBroadcast = async () => {
    if (!running || !message.trim()) return;
    try {
      const { tcpServerBroadcast } = await import("@/services/tcpService");
      const count = await tcpServerBroadcast(tab.id, message);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "sent", data: `[广播 → ${count} 客户端] ${message}`,
        encoding: "utf8", timestamp: new Date().toISOString(), size: new Blob([message]).size,
      }]);
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "received", data: `⚠ 广播失败: ${errMsg}`,
        encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleBroadcast(); }
  };

  return (
    <>
      {/* Bind Bar */}
      <div className="shrink-0 p-4 pb-2 pt-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          <div className="relative h-full shrink-0">
            <div className="flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-indigo-500 min-w-[110px] shadow-sm">
              <Server className="w-3.5 h-3.5" />
              TCP 服务端
            </div>
          </div>
          <input
            value={host}
            onChange={(e) => updateTab(tab.id, { tcpHost: e.target.value })}
            placeholder="绑定地址 (0.0.0.0)"
            disabled={running}
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary border-r border-border-default disabled:opacity-60"
          />
          <input
            value={port}
            onChange={(e) => updateTab(tab.id, { tcpPort: parseInt(e.target.value) || 0 })}
            placeholder="端口"
            type="number"
            disabled={running}
            className="w-24 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary text-center disabled:opacity-60"
          />
          <button
            onClick={handleStart}
            disabled={starting}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
              running
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md active:scale-[0.98]"
                : starting
                  ? "bg-indigo-400 cursor-wait"
                  : "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 hover:shadow-md active:scale-[0.98]"
            )}
          >
            {running ? <X className="w-4 h-4" /> : <Server className="w-4 h-4" />}
            {running ? "停止" : starting ? "启动中..." : "启动"}
          </button>
        </div>

        {/* Connected Clients */}
        {clients.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary font-medium">
              <Users className="w-3 h-3" />
              已连接 ({clients.length}):
            </span>
            {clients.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-secondary border border-border-default rounded-full text-[11px] font-mono text-text-secondary">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {c.remoteAddr}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Messages + Input */}
      <MessagePanel
        messages={messages}
        setMessages={setMessages}
        message={message}
        setMessage={setMessage}
        connected={running}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        messagesEndRef={messagesEndRef}
        messagesContainerRef={messagesContainerRef}
        handleScroll={handleScroll}
        handleSend={handleBroadcast}
        handleKeyDown={handleKeyDown}
        accentColor="indigo"
        icon={<Server className="w-8 h-8 opacity-20 text-indigo-500" />}
        emptyTitle="TCP 服务端"
        emptyDesc="启动服务器等待客户端连接"
        sendLabel="广播"
        inputPlaceholder="输入广播消息... (Enter 发送给所有客户端)"
      />
    </>
  );
}

// ═══════════════════════════════════════════
//  UDP Panel
// ═══════════════════════════════════════════

function UdpPanel({ tab, updateTab }: { tab: AppTab; updateTab: (id: string, updates: Partial<AppTab>) => void }) {
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [message, setMessage] = useState("");
  const [targetAddr, setTargetAddr] = useState("127.0.0.1:9000");
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const host = tab.tcpHost || "0.0.0.0";
  const port = tab.tcpPort || 9001;

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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const { onUdpEvent } = await import("@/services/tcpService");
      unlisten = await onUdpEvent((event: TcpEvent) => {
        if (event.connectionId !== tab.id) return;
        switch (event.eventType) {
          case "bound":
            setBound(true);
            setBinding(false);
            break;
          case "data":
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", encoding: "utf8", timestamp: event.timestamp,
              size: event.size || 0, remoteAddr: event.remoteAddr,
            }]);
            break;
          case "error":
            setBound(false);
            setBinding(false);
            setMessages((prev) => [...prev, {
              id: crypto.randomUUID(), direction: "received",
              data: `⚠ 错误: ${event.data}`, encoding: "utf8", timestamp: event.timestamp, size: 0,
            }]);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [tab.id]);

  const handleBind = async () => {
    if (bound) {
      const { udpClose } = await import("@/services/tcpService");
      await udpClose(tab.id);
      setBound(false);
    } else {
      setBinding(true);
      try {
        const { udpBind } = await import("@/services/tcpService");
        await udpBind(tab.id, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), direction: "received", data: `⚠ 绑定失败: ${errMsg}`,
          encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
        }]);
      }
    }
  };

  const handleSend = async () => {
    if (!bound || !message.trim() || !targetAddr.trim()) return;
    try {
      const { udpSendTo } = await import("@/services/tcpService");
      await udpSendTo(tab.id, message, targetAddr);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "sent",
        data: message, encoding: "utf8", timestamp: new Date().toISOString(),
        size: new Blob([message]).size, remoteAddr: targetAddr,
      }]);
      setMessage("");
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), direction: "received", data: `⚠ 发送失败: ${errMsg}`,
        encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* Bind Bar */}
      <div className="shrink-0 p-4 pb-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          <div className="relative h-full shrink-0">
            <div className="flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-cyan-500 min-w-[90px] shadow-sm">
              <Radio className="w-3.5 h-3.5" />
              UDP
            </div>
          </div>
          <input
            value={host}
            onChange={(e) => updateTab(tab.id, { tcpHost: e.target.value })}
            placeholder="本地绑定地址"
            disabled={bound}
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary border-r border-border-default disabled:opacity-60"
          />
          <input
            value={port}
            onChange={(e) => updateTab(tab.id, { tcpPort: parseInt(e.target.value) || 0 })}
            placeholder="端口"
            type="number"
            disabled={bound}
            className="w-24 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary text-center disabled:opacity-60"
          />
          <button
            onClick={handleBind}
            disabled={binding}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
              bound
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md active:scale-[0.98]"
                : binding
                  ? "bg-cyan-400 cursor-wait"
                  : "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 hover:shadow-md active:scale-[0.98]"
            )}
          >
            {bound ? <X className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
            {bound ? "关闭" : binding ? "绑定中..." : "绑定"}
          </button>
        </div>

        {/* Target Address */}
        {bound && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-text-tertiary font-medium shrink-0">目标地址:</span>
            <input
              value={targetAddr}
              onChange={(e) => setTargetAddr(e.target.value)}
              placeholder="目标地址:端口 (如 127.0.0.1:9000)"
              className="flex-1 h-7 px-3 text-[12px] font-mono bg-bg-input border border-border-default rounded-md outline-none focus:border-accent transition-colors text-text-primary"
            />
          </div>
        )}
      </div>

      {/* Messages + Input */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        <div className="flex-1 flex flex-col bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
          {/* Status Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/40 border-b border-border-default shrink-0">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full transition-colors",
                bound ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-text-disabled"
              )} />
              <span className="text-[13px] font-medium text-text-secondary">
                {bound ? `已绑定 ${host}:${port}` : "未绑定"}
              </span>
              {messages.length > 0 && (
                <span className="text-[11px] text-text-tertiary ml-2">{messages.length} 条消息</span>
              )}
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto p-5 bg-bg-input/30">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4 border border-border-default shadow-sm">
                  <Radio className="w-8 h-8 opacity-20 text-cyan-500" />
                </div>
                <p className="text-[14px] font-medium text-text-secondary">UDP 数据报</p>
                <p className="text-[12px] mt-1">绑定端口后开始收发 UDP 数据</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "sent" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[75%] px-4 py-2.5 rounded-2xl text-[13px] font-mono break-words shadow-sm",
                      m.direction === "sent"
                        ? "bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 text-cyan-900 dark:text-cyan-100 rounded-tr-sm"
                        : m.data.startsWith("⚠")
                          ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 rounded-tl-sm"
                          : "bg-bg-elevated border border-border-default text-text-secondary rounded-tl-sm"
                    )}>
                      <div className="whitespace-pre-wrap break-all" style={{ userSelect: "text" }}>{m.data}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] opacity-50">{formatTime(m.timestamp)}</span>
                        {m.size > 0 && <span className="text-[10px] opacity-40">{formatSize(m.size)}</span>}
                        {m.remoteAddr && <span className="text-[10px] opacity-40">{m.direction === "received" ? "← " : "→ "}{m.remoteAddr}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 p-3 bg-bg-secondary/20 border-t border-border-default">
            <div className="flex items-end gap-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入数据内容... (Enter 发送)"
                disabled={!bound}
                className="flex-1 max-h-[120px] min-h-[44px] h-[44px] p-3 text-[13px] font-mono bg-bg-input border border-border-default rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all outline-none resize-y disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSend}
                disabled={!bound || !message.trim()}
                className="h-[44px] px-5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0"
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

// ═══════════════════════════════════════════
//  共用消息面板组件
// ═══════════════════════════════════════════

interface MessagePanelProps {
  messages: TcpMessage[];
  setMessages: React.Dispatch<React.SetStateAction<TcpMessage[]>>;
  message: string;
  setMessage: (v: string) => void;
  connected: boolean;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  accentColor: string;
  icon: React.ReactNode;
  emptyTitle: string;
  emptyDesc: string;
  sendLabel?: string;
  inputPlaceholder?: string;
}

function MessagePanel({
  messages, setMessages, message, setMessage, connected,
  autoScroll, setAutoScroll, messagesEndRef, messagesContainerRef,
  handleScroll, handleSend, handleKeyDown,
  accentColor, icon, emptyTitle, emptyDesc,
  sendLabel = "发送", inputPlaceholder = "输入消息内容... (Enter 发送, Shift+Enter 换行)",
}: MessagePanelProps) {
  const accentMap: Record<string, { sent: string; border: string; focus: string; btn: string; btnHover: string }> = {
    blue: { sent: "from-blue-500/10 to-indigo-500/10", border: "border-blue-500/20", focus: "focus:border-blue-500 focus:ring-blue-500/50", btn: "bg-blue-500", btnHover: "hover:bg-blue-600" },
    indigo: { sent: "from-indigo-500/10 to-purple-500/10", border: "border-indigo-500/20", focus: "focus:border-indigo-500 focus:ring-indigo-500/50", btn: "bg-indigo-500", btnHover: "hover:bg-indigo-600" },
  };
  const colors = accentMap[accentColor] || accentMap.blue;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
      <div className="flex-1 flex flex-col bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
        {/* Status */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/40 border-b border-border-default shrink-0">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full transition-colors",
              connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-text-disabled"
            )} />
            <span className="text-[13px] font-medium text-text-secondary">
              {connected ? "已连接" : "未连接"}
            </span>
            {messages.length > 0 && <span className="text-[11px] text-text-tertiary ml-2">{messages.length} 条消息</span>}
          </div>
          <div className="flex items-center gap-1">
            {!autoScroll && messages.length > 0 && (
              <button onClick={() => { setAutoScroll(true); messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-accent hover:bg-accent-soft rounded-md transition-colors">
                <ArrowDown className="w-3 h-3" /> 底部
              </button>
            )}
            {messages.length > 0 && (
              <button onClick={() => setMessages([])}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto p-5 bg-bg-input/30">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-disabled">
              <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4 border border-border-default shadow-sm">
                {icon}
              </div>
              <p className="text-[14px] font-medium text-text-secondary">{emptyTitle}</p>
              <p className="text-[12px] mt-1">{emptyDesc}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "sent" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[75%] px-4 py-2.5 rounded-2xl text-[13px] font-mono break-words shadow-sm",
                    m.direction === "sent"
                      ? `bg-gradient-to-br ${colors.sent} border ${colors.border} rounded-tr-sm`
                      : m.data.startsWith("⚠")
                        ? "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 rounded-tl-sm"
                        : m.data.startsWith("🔗") || m.data.startsWith("🔌")
                          ? "bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-300 rounded-tl-sm"
                          : "bg-bg-elevated border border-border-default text-text-secondary rounded-tl-sm"
                  )}>
                    <div className="whitespace-pre-wrap break-all" style={{ userSelect: "text" }}>{m.data}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] opacity-50">{formatTime(m.timestamp)}</span>
                      {m.size > 0 && <span className="text-[10px] opacity-40">{formatSize(m.size)}</span>}
                      {m.clientId && <span className="text-[10px] opacity-40">客户端: {m.clientId.slice(0, 8)}</span>}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 p-3 bg-bg-secondary/20 border-t border-border-default">
          <div className="flex items-end gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              disabled={!connected}
              className={cn(
                "flex-1 max-h-[120px] min-h-[44px] h-[44px] p-3 text-[13px] font-mono bg-bg-input border border-border-default rounded-xl transition-all outline-none resize-y disabled:opacity-50 disabled:cursor-not-allowed",
                colors.focus, "focus:ring-1"
              )}
            />
            <button
              onClick={handleSend}
              disabled={!connected || !message.trim()}
              className={cn(
                "h-[44px] px-5 text-white rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0",
                colors.btn, colors.btnHover
              )}
            >
              <SendIcon className="w-4 h-4" />
              {sendLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Utils ──

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
