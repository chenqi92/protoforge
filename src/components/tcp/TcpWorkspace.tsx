// TCP/UDP 工作区 — 完全重新设计
// 四模式 Tab + 左右分栏布局
import { useState, useEffect, useRef, useCallback } from "react";
import { Server, Radio, Square, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectionBar } from "./ConnectionBar";
import { SendPanel } from "./SendPanel";
import { MessageLog } from "./MessageLog";
import { ClientList } from "./ClientList";
import * as svc from "@/services/tcpService";
import type {
  SocketMode, DataFormat, TcpMessage, TcpEvent,
  TcpServerClient, ConnectionStats, SendHistoryItem, QuickCommand,
} from "@/types/tcp";

// ── Mode Tab 配置 ──
const MODES: { value: SocketMode; label: string; icon: React.ReactNode }[] = [
  { value: "tcp-client", label: "TCP 客户端", icon: <Monitor className="w-3.5 h-3.5" /> },
  { value: "tcp-server", label: "TCP 服务端", icon: <Server className="w-3.5 h-3.5" /> },
  { value: "udp-client", label: "UDP 客户端", icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "udp-server", label: "UDP 服务端", icon: <Square className="w-3.5 h-3.5" /> },
];

export function TcpWorkspace() {
  const [mode, setMode] = useState<SocketMode>("tcp-client");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      {/* ── Mode Tabs ── */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="inline-flex items-center gap-1 rounded-[14px] border border-border-default/75 bg-bg-primary/72 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[11px] font-semibold transition-all",
                mode === m.value
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-tertiary hover:bg-bg-hover/75 hover:text-text-secondary"
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active Panel ── */}
      {mode === "tcp-client" && <TcpClientPanel />}
      {mode === "tcp-server" && <TcpServerPanel />}
      {mode === "udp-client" && <UdpClientPanel />}
      {mode === "udp-server" && <UdpServerPanel />}
    </div>
  );
}

function WorkspaceSplit({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[304px_minmax(0,1fr)] gap-3">
      <div className="min-h-0 overflow-auto">{sidebar}</div>
      <div className="min-h-0">{children}</div>
    </div>
  );
}

function AddressField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[14px] border border-border-default/75 bg-bg-primary/72 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <span className="shrink-0 text-[11px] font-medium text-text-tertiary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 flex-1 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-tertiary"
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  共用 Hook: 消息管理、统计、发送选项
// ═══════════════════════════════════════════

function useSocketState() {
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sendFormat, setSendFormat] = useState<DataFormat>("ascii");
  const [displayFormat, setDisplayFormat] = useState<DataFormat>("ascii");
  const [sendHistory, setSendHistory] = useState<SendHistoryItem[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([
    { id: "hb", name: "心跳", data: "PING", format: "ascii" },
    { id: "ack", name: "ACK", data: "06", format: "hex" },
  ]);
  const [appendNewline, setAppendNewline] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerInterval, setTimerInterval] = useState(1000);
  const [stats, setStats] = useState<ConnectionStats>({ sentBytes: 0, receivedBytes: 0, sentCount: 0, receivedCount: 0 });

  const addMessage = useCallback((msg: TcpMessage) => {
    setMessages((prev) => [...prev, msg]);
    if (msg.direction === "sent") {
      setStats((s) => ({ ...s, sentBytes: s.sentBytes + msg.size, sentCount: s.sentCount + 1 }));
    } else if (msg.direction === "received") {
      setStats((s) => ({ ...s, receivedBytes: s.receivedBytes + msg.size, receivedCount: s.receivedCount + 1 }));
    }
  }, []);

  const addToHistory = useCallback((data: string, format: DataFormat) => {
    setSendHistory((prev) => [
      { id: crypto.randomUUID(), data, format, timestamp: new Date().toISOString() },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const systemMessage = useCallback((text: string) => {
    addMessage({
      id: crypto.randomUUID(), direction: "system", data: text, rawHex: "",
      encoding: "utf8", timestamp: new Date().toISOString(), size: 0,
    });
  }, [addMessage]);

  const resetStats = useCallback(() => {
    setStats({ sentBytes: 0, receivedBytes: 0, sentCount: 0, receivedCount: 0 });
  }, []);

  return {
    messages, setMessages, message, setMessage,
    sendFormat, setSendFormat, displayFormat, setDisplayFormat,
    sendHistory, setSendHistory, quickCommands, setQuickCommands,
    appendNewline, setAppendNewline, timerEnabled, setTimerEnabled,
    timerInterval, setTimerInterval, stats, setStats,
    addMessage, addToHistory, systemMessage, resetStats,
  };
}

// ═══════════════════════════════════════════
//  TCP Client Panel
// ═══════════════════════════════════════════

function TcpClientPanel() {
  const connectionId = useRef(crypto.randomUUID()).current;
  const state = useSocketState();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(8080);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Event listener
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await svc.onTcpEvent((event: TcpEvent) => {
        if (event.connectionId !== connectionId) return;
        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            state.systemMessage(`✓ 已连接到 ${event.data}`);
            break;
          case "data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp, size: event.size || 0,
            });
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            state.systemMessage("✗ 连接已断开");
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            state.systemMessage(`⚠ 错误: ${event.data}`);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [connectionId]);

  // Timer
  useEffect(() => {
    if (state.timerEnabled && connected && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, connected, state.timerInterval, state.message, state.sendFormat]);

  const handleConnect = async () => {
    if (connected) {
      await svc.tcpDisconnect(connectionId);
      setConnected(false);
    } else {
      setConnecting(true);
      try {
        await svc.tcpConnect(connectionId, host, port);
      } catch (err: unknown) {
        setConnecting(false);
        state.systemMessage(`⚠ 连接失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!connected || !state.message.trim()) return;
    const data = state.appendNewline ? state.message + "\n" : state.message;
    try {
      await svc.tcpSend(connectionId, data, state.sendFormat);
      const rawHex = svc.asciiToHex(data);
      const size = state.sendFormat === "hex"
        ? data.replace(/[\s,]/g, "").replace(/0[xX]/g, "").length / 2
        : new TextEncoder().encode(data).length;
      state.addMessage({
        id: crypto.randomUUID(), direction: "sent",
        data, rawHex, encoding: "utf8",
        timestamp: new Date().toISOString(), size,
      });
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`⚠ 发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
      <div className="shrink-0 pb-3">
        <ConnectionBar
          mode="tcp-client" host={host} port={port}
          connected={connected} connecting={connecting}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleConnect}
        />
      </div>

      <WorkspaceSplit
        sidebar={(
          <SendPanel
            message={state.message} setMessage={state.setMessage}
            sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
            connected={connected} onSend={handleSend}
            sendHistory={state.sendHistory}
            onClearHistory={() => state.setSendHistory([])}
            onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
            quickCommands={state.quickCommands}
            onAddQuickCommand={() => {
              if (state.message.trim()) {
                const name = `指令${state.quickCommands.length + 1}`;
                state.setQuickCommands((prev) => [...prev, {
                  id: crypto.randomUUID(), name, data: state.message, format: state.sendFormat,
                }]);
              }
            }}
            onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
            onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
            timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
            onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
            onTimerIntervalChange={(v) => state.setTimerInterval(v)}
            appendNewline={state.appendNewline}
            onAppendNewlineChange={state.setAppendNewline}
          />
        )}
      >
        <div className="flex min-h-0 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={connected}
            statusText={connected ? `${host}:${port} 已连接` : connecting ? "正在建立连接..." : "等待建立连接"}
            stats={state.stats}
          />
        </div>
      </WorkspaceSplit>
    </div>
  );
}

// ═══════════════════════════════════════════
//  TCP Server Panel
// ═══════════════════════════════════════════

function TcpServerPanel() {
  const serverId = useRef(crypto.randomUUID()).current;
  const state = useSocketState();
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9000);
  const [clients, setClients] = useState<TcpServerClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await svc.onTcpServerEvent((event: TcpEvent) => {
        if (event.connectionId !== serverId) return;
        switch (event.eventType) {
          case "started":
            setRunning(true);
            setStarting(false);
            state.systemMessage(`✓ 服务器已启动 ${event.data}`);
            break;
          case "client-connected":
            if (event.clientId && event.remoteAddr) {
              setClients((prev) => [...prev, { id: event.clientId!, remoteAddr: event.remoteAddr!, connectedAt: event.timestamp }]);
              state.systemMessage(`🔗 客户端连接: ${event.remoteAddr}`);
            }
            break;
          case "client-data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp,
              size: event.size || 0, clientId: event.clientId,
            });
            break;
          case "client-disconnected":
            if (event.clientId) {
              setClients((prev) => prev.filter((c) => c.id !== event.clientId));
              state.systemMessage(`🔌 客户端断开: ${event.clientId.slice(0, 8)}`);
            }
            break;
          case "error":
            state.systemMessage(`⚠ 错误: ${event.data}`);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [serverId]);

  useEffect(() => {
    if (state.timerEnabled && running && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, running, state.timerInterval, state.message, state.sendFormat]);

  const handleToggle = async () => {
    if (running) {
      await svc.tcpServerStop(serverId);
      setRunning(false);
      setClients([]);
      state.systemMessage("✗ 服务器已停止");
    } else {
      setStarting(true);
      try {
        await svc.tcpServerStart(serverId, host, port);
      } catch (err: unknown) {
        setStarting(false);
        state.systemMessage(`⚠ 启动失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!running || !state.message.trim()) return;
    const data = state.appendNewline ? state.message + "\n" : state.message;
    try {
      if (selectedClientId) {
        await svc.tcpServerSend(serverId, selectedClientId, data, state.sendFormat);
        const size = new TextEncoder().encode(data).length;
        state.addMessage({
          id: crypto.randomUUID(), direction: "sent",
          data: `[→ ${selectedClientId.slice(0, 8)}] ${data}`, rawHex: svc.asciiToHex(data),
          encoding: "utf8", timestamp: new Date().toISOString(), size,
        });
      } else {
        const count = await svc.tcpServerBroadcast(serverId, data, state.sendFormat);
        const size = new TextEncoder().encode(data).length;
        state.addMessage({
          id: crypto.randomUUID(), direction: "sent",
          data: `[广播 → ${count} 客户端] ${data}`, rawHex: svc.asciiToHex(data),
          encoding: "utf8", timestamp: new Date().toISOString(), size,
        });
      }
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`⚠ 发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
      <div className="shrink-0 pb-3">
        <ConnectionBar
          mode="tcp-server" host={host} port={port}
          connected={running} connecting={starting}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleToggle}
        />
      </div>

      <WorkspaceSplit
        sidebar={(
          <div className="space-y-3">
            <ClientList clients={clients} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} />
            <SendPanel
              message={state.message} setMessage={state.setMessage}
              sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
              connected={running} onSend={handleSend}
              sendLabel={selectedClientId ? "发送" : "广播"}
              sendHistory={state.sendHistory}
              onClearHistory={() => state.setSendHistory([])}
              onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
              quickCommands={state.quickCommands}
              onAddQuickCommand={() => {
                if (state.message.trim()) {
                  state.setQuickCommands((prev) => [...prev, {
                    id: crypto.randomUUID(), name: `指令${prev.length + 1}`, data: state.message, format: state.sendFormat,
                  }]);
                }
              }}
              onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
              onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
              timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
              onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
              onTimerIntervalChange={(v) => state.setTimerInterval(v)}
              appendNewline={state.appendNewline}
              onAppendNewlineChange={state.setAppendNewline}
            />
          </div>
        )}
      >
        <div className="flex min-h-0 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={running}
            statusText={running ? `${host}:${port} 监听中 · ${clients.length} 个客户端` : starting ? "正在启动服务端..." : "等待启动服务端"}
            stats={state.stats}
          />
        </div>
      </WorkspaceSplit>
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Client Panel
// ═══════════════════════════════════════════

function UdpClientPanel() {
  const socketId = useRef(crypto.randomUUID()).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9001);
  const [targetAddr, setTargetAddr] = useState("127.0.0.1:9000");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await svc.onUdpEvent((event: TcpEvent) => {
        if (event.connectionId !== socketId) return;
        switch (event.eventType) {
          case "bound":
            setBound(true);
            setBinding(false);
            state.systemMessage(`✓ 已绑定 ${event.data}`);
            break;
          case "data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp,
              size: event.size || 0, remoteAddr: event.remoteAddr,
            });
            break;
          case "error":
            setBound(false);
            setBinding(false);
            state.systemMessage(`⚠ 错误: ${event.data}`);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [socketId]);

  useEffect(() => {
    if (state.timerEnabled && bound && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, bound, state.timerInterval, state.message, state.sendFormat]);

  const handleBind = async () => {
    if (bound) {
      await svc.udpClose(socketId);
      setBound(false);
      state.systemMessage("✗ UDP 已关闭");
    } else {
      setBinding(true);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`⚠ 绑定失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!bound || !state.message.trim() || !targetAddr.trim()) return;
    const data = state.appendNewline ? state.message + "\n" : state.message;
    try {
      await svc.udpSendTo(socketId, data, targetAddr, state.sendFormat);
      const size = new TextEncoder().encode(data).length;
      state.addMessage({
        id: crypto.randomUUID(), direction: "sent",
        data, rawHex: svc.asciiToHex(data), encoding: "utf8",
        timestamp: new Date().toISOString(), size, remoteAddr: targetAddr,
      });
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`⚠ 发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
      <div className="shrink-0 space-y-3 pb-3">
        <ConnectionBar
          mode="udp-client" host={host} port={port}
          connected={bound} connecting={binding}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleBind}
        />
        {/* Target address */}
        {bound && (
          <AddressField
            label="目标地址"
            value={targetAddr}
            onChange={setTargetAddr}
            placeholder="目标 IP:端口 (如 127.0.0.1:9000)"
          />
        )}
      </div>

      <WorkspaceSplit
        sidebar={(
          <SendPanel
            message={state.message} setMessage={state.setMessage}
            sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
            connected={bound} onSend={handleSend}
            sendHistory={state.sendHistory}
            onClearHistory={() => state.setSendHistory([])}
            onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
            quickCommands={state.quickCommands}
            onAddQuickCommand={() => {
              if (state.message.trim()) {
                state.setQuickCommands((prev) => [...prev, {
                  id: crypto.randomUUID(), name: `指令${prev.length + 1}`, data: state.message, format: state.sendFormat,
                }]);
              }
            }}
            onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
            onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
            timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
            onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
            onTimerIntervalChange={(v) => state.setTimerInterval(v)}
            appendNewline={state.appendNewline}
            onAppendNewlineChange={state.setAppendNewline}
          />
        )}
      >
        <div className="flex min-h-0 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={bound}
            statusText={bound ? `${host}:${port} 已绑定 · 目标 ${targetAddr}` : binding ? "正在绑定 UDP..." : "等待绑定 UDP"}
            stats={state.stats}
          />
        </div>
      </WorkspaceSplit>
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Server Panel
// ═══════════════════════════════════════════

function UdpServerPanel() {
  const socketId = useRef(crypto.randomUUID()).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9002);
  const [replyAddr, setReplyAddr] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await svc.onUdpEvent((event: TcpEvent) => {
        if (event.connectionId !== socketId) return;
        switch (event.eventType) {
          case "bound":
            setBound(true);
            setBinding(false);
            state.systemMessage(`✓ UDP 服务端已绑定 ${event.data}`);
            break;
          case "data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp,
              size: event.size || 0, remoteAddr: event.remoteAddr,
            });
            // 自动设置回复地址
            if (event.remoteAddr && !replyAddr) {
              setReplyAddr(event.remoteAddr);
            }
            break;
          case "error":
            setBound(false);
            setBinding(false);
            state.systemMessage(`⚠ 错误: ${event.data}`);
            break;
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [socketId]);

  useEffect(() => {
    if (state.timerEnabled && bound && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, bound, state.timerInterval, state.message, state.sendFormat]);

  const handleBind = async () => {
    if (bound) {
      await svc.udpClose(socketId);
      setBound(false);
      state.systemMessage("✗ UDP 服务端已关闭");
    } else {
      setBinding(true);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`⚠ 绑定失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!bound || !state.message.trim() || !replyAddr.trim()) return;
    const data = state.appendNewline ? state.message + "\n" : state.message;
    try {
      await svc.udpSendTo(socketId, data, replyAddr, state.sendFormat);
      const size = new TextEncoder().encode(data).length;
      state.addMessage({
        id: crypto.randomUUID(), direction: "sent",
        data, rawHex: svc.asciiToHex(data), encoding: "utf8",
        timestamp: new Date().toISOString(), size, remoteAddr: replyAddr,
      });
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`⚠ 发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
      <div className="shrink-0 space-y-3 pb-3">
        <ConnectionBar
          mode="udp-server" host={host} port={port}
          connected={bound} connecting={binding}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleBind}
        />
        {bound && (
          <AddressField
            label="回复地址"
            value={replyAddr}
            onChange={setReplyAddr}
            placeholder="接收到数据后自动填充，或手动输入 IP:端口"
          />
        )}
      </div>

      <WorkspaceSplit
        sidebar={(
          <SendPanel
            message={state.message} setMessage={state.setMessage}
            sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
            connected={bound && !!replyAddr} onSend={handleSend}
            sendLabel="回复"
            sendHistory={state.sendHistory}
            onClearHistory={() => state.setSendHistory([])}
            onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
            quickCommands={state.quickCommands}
            onAddQuickCommand={() => {
              if (state.message.trim()) {
                state.setQuickCommands((prev) => [...prev, {
                  id: crypto.randomUUID(), name: `指令${prev.length + 1}`, data: state.message, format: state.sendFormat,
                }]);
              }
            }}
            onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
            onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
            timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
            onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
            onTimerIntervalChange={(v) => state.setTimerInterval(v)}
            appendNewline={state.appendNewline}
            onAppendNewlineChange={state.setAppendNewline}
          />
        )}
      >
        <div className="flex min-h-0 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={bound}
            statusText={bound ? `${host}:${port} 监听中 · 回复 ${replyAddr || "等待来源地址"}` : binding ? "正在绑定 UDP 服务端..." : "等待启动 UDP 服务端"}
            stats={state.stats}
          />
        </div>
      </WorkspaceSplit>
    </div>
  );
}
