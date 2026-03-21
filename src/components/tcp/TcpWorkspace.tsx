// TCP/UDP 工作区 — 完全重新设计
// 四模式 Tab + 左右分栏布局
import { useState, useEffect, useRef, useCallback } from "react";
import { Server, Radio, Square, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
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
const MODES: { value: SocketMode; labelKey: string; hintKey: string; icon: React.ReactNode }[] = [
  { value: "tcp-client", labelKey: "tcp.modes.tcpClient", hintKey: "tcp.modes.tcpClientHint", icon: <Monitor className="w-3.5 h-3.5" /> },
  { value: "tcp-server", labelKey: "tcp.modes.tcpServer", hintKey: "tcp.modes.tcpServerHint", icon: <Server className="w-3.5 h-3.5" /> },
  { value: "udp-client", labelKey: "tcp.modes.udpClient", hintKey: "tcp.modes.udpClientHint", icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "udp-server", labelKey: "tcp.modes.udpServer", hintKey: "tcp.modes.udpServerHint", icon: <Square className="w-3.5 h-3.5" /> },
];

export function TcpWorkspace({ sessionId: _sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SocketMode>("tcp-client");
  const activeMode = MODES.find((item) => item.value === mode) || MODES[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent p-3">
      <div className="wb-tool-strip shrink-0">
        <div className="wb-tool-strip-main">
          <div className="wb-tool-segment">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={cn(mode === m.value && "is-active")}
              >
                {m.icon}
                {t(m.labelKey)}
              </button>
            ))}
          </div>
          <span className="wb-tool-inline-note">{t(activeMode.hintKey)}</span>
        </div>

        <div className="wb-tool-strip-actions">
          <span className="wb-tool-chip">{mode.startsWith("tcp") ? t('tcp.connectionOriented') : t('tcp.connectionless')}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-3">
        {mode === "tcp-client" && <TcpClientPanel />}
        {mode === "tcp-server" && <TcpServerPanel />}
        {mode === "udp-client" && <UdpClientPanel />}
        {mode === "udp-server" && <UdpServerPanel />}
      </div>
    </div>
  );
}

function WorkspaceSplit({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="wb-workbench-grid h-full min-h-0 flex-1">
      <div className="wb-workbench-sidebar">{sidebar}</div>
      <div className="wb-workbench-main">{children}</div>
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
    <div className="flex items-center gap-2 rounded-[11px] border border-border-default/75 bg-bg-primary/78 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 flex-1 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-disabled"
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
    { id: "hb", name: "Heartbeat", data: "PING", format: "ascii" },
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

  const saveQuickCommand = useCallback((command: { id?: string; name: string; data: string; format: DataFormat }) => {
    setQuickCommands((prev) => {
      const normalized = {
        name: command.name.trim(),
        data: command.data,
        format: command.format,
      };
      if (command.id) {
        return prev.map((item) => item.id === command.id ? { ...item, ...normalized } : item);
      }
      return [...prev, { id: crypto.randomUUID(), ...normalized }];
    });
  }, []);

  return {
    messages, setMessages, message, setMessage,
    sendFormat, setSendFormat, displayFormat, setDisplayFormat,
    sendHistory, setSendHistory, quickCommands, setQuickCommands,
    appendNewline, setAppendNewline, timerEnabled, setTimerEnabled,
    timerInterval, setTimerInterval, stats, setStats,
    addMessage, addToHistory, systemMessage, resetStats, saveQuickCommand,
  };
}

// ═══════════════════════════════════════════
//  TCP Client Panel
// ═══════════════════════════════════════════

function TcpClientPanel() {
  const { t } = useTranslation();
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
            state.systemMessage(`✓ ${t('tcp.system.connectedTo')} ${event.data}`);
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
            state.systemMessage(`✗ ${t('tcp.system.disconnected')}`);
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            state.systemMessage(`⚠ ${t('tcp.system.error')}: ${event.data}`);
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
        state.systemMessage(`⚠ ${t('tcp.system.connectFailed')}: ${err instanceof Error ? err.message : String(err)}`);
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
      state.systemMessage(`⚠ ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          <div className="flex min-h-0 flex-1 flex-col">
            <SendPanel
              message={state.message} setMessage={state.setMessage}
              sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
              connected={connected} onSend={handleSend}
              sendHistory={state.sendHistory}
              onClearHistory={() => state.setSendHistory([])}
              onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
              quickCommands={state.quickCommands}
              onSaveQuickCommand={state.saveQuickCommand}
              onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
              onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
              sendTargetLabel={connected ? `${host}:${port}` : undefined}
              sendTargetHint={connected ? t("tcp.sendPanel.directTargetHint") : undefined}
              timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
              onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
              onTimerIntervalChange={(v) => state.setTimerInterval(v)}
              appendNewline={state.appendNewline}
              onAppendNewlineChange={state.setAppendNewline}
              embedded
            />
          </div>
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={connected}
            statusText={connected ? `${host}:${port} ${t('tcp.system.connected')}` : connecting ? t('tcp.system.connecting') : t('tcp.system.waitingConnection')}
            stats={state.stats}
            embedded
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
  const { t } = useTranslation();
  const serverId = useRef(crypto.randomUUID()).current;
  const state = useSocketState();
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9000);
  const [clients, setClients] = useState<TcpServerClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedClient = selectedClientId ? clients.find((client) => client.id === selectedClientId) ?? null : null;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await svc.onTcpServerEvent((event: TcpEvent) => {
        if (event.connectionId !== serverId) return;
        switch (event.eventType) {
          case "started":
            setRunning(true);
            setStarting(false);
            state.systemMessage(`✓ ${t('tcp.system.serverStarted')} ${event.data}`);
            break;
          case "client-connected":
            if (event.clientId && event.remoteAddr) {
              setClients((prev) => [...prev, { id: event.clientId!, remoteAddr: event.remoteAddr!, connectedAt: event.timestamp }]);
              state.systemMessage(`🔗 ${t('tcp.system.clientConnected')}: ${event.remoteAddr}`);
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
              state.systemMessage(`🔌 ${t('tcp.system.clientDisconnected')}: ${event.clientId.slice(0, 8)}`);
            }
            break;
          case "error":
            state.systemMessage(`⚠ ${t('tcp.system.error')}: ${event.data}`);
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
      state.systemMessage(`✗ ${t('tcp.system.serverStopped')}`);
    } else {
      setStarting(true);
      try {
        await svc.tcpServerStart(serverId, host, port);
      } catch (err: unknown) {
        setStarting(false);
        state.systemMessage(`⚠ ${t('tcp.system.startFailed')}: ${err instanceof Error ? err.message : String(err)}`);
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
          data: `[${t('tcp.system.broadcast')} → ${count}] ${data}`, rawHex: svc.asciiToHex(data),
          encoding: "utf8", timestamp: new Date().toISOString(), size,
        });
      }
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`⚠ ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          <div className="flex h-full min-h-0 flex-1 flex-col">
            <ClientList clients={clients} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} embedded />
            {clients.length > 0 ? <div className="wb-pane-divider" /> : null}
            <div className="min-h-0 flex-1">
            <SendPanel
              message={state.message} setMessage={state.setMessage}
              sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
              connected={running} onSend={handleSend}
              sendLabel={selectedClientId ? t('tcp.send') : t('tcp.system.broadcast')}
              sendHistory={state.sendHistory}
              onClearHistory={() => state.setSendHistory([])}
              onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
              quickCommands={state.quickCommands}
              onSaveQuickCommand={state.saveQuickCommand}
              onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
              onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
              sendTargetLabel={selectedClient ? `${t("tcp.clientList.unicast")} · ${selectedClient.remoteAddr}` : t("tcp.sendPanel.broadcastAllClients")}
              sendTargetHint={selectedClient ? t("tcp.sendPanel.unicastHint") : t("tcp.sendPanel.broadcastHint")}
              timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
              onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
              onTimerIntervalChange={(v) => state.setTimerInterval(v)}
              appendNewline={state.appendNewline}
              onAppendNewlineChange={state.setAppendNewline}
              embedded
            />
            </div>
          </div>
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={running}
            statusText={running ? `${host}:${port} ${t('tcp.system.listening')} · ${t('tcp.clientList.connections', { count: clients.length })}` : starting ? t('tcp.system.startingServer') : t('tcp.system.waitingServer')}
            stats={state.stats}
            embedded
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
  const { t } = useTranslation();
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
            state.systemMessage(`✓ ${t('tcp.system.bound')} ${event.data}`);
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
            state.systemMessage(`⚠ ${t('tcp.system.error')}: ${event.data}`);
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
      state.systemMessage(`✗ ${t('tcp.system.udpClosed')}`);
    } else {
      setBinding(true);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`⚠ ${t('tcp.system.bindFailed')}: ${err instanceof Error ? err.message : String(err)}`);
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
      state.systemMessage(`⚠ ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            label={t('tcp.targetAddress')}
            value={targetAddr}
            onChange={setTargetAddr}
            placeholder={t('tcp.targetAddrPlaceholder')}
          />
        )}
      </div>

      <WorkspaceSplit
        sidebar={(
          <div className="flex min-h-0 flex-1 flex-col">
            <SendPanel
              message={state.message} setMessage={state.setMessage}
              sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
              connected={bound} onSend={handleSend}
              sendHistory={state.sendHistory}
              onClearHistory={() => state.setSendHistory([])}
              onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
              quickCommands={state.quickCommands}
              onSaveQuickCommand={state.saveQuickCommand}
              onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
              onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
              sendTargetLabel={bound ? targetAddr : undefined}
              sendTargetHint={bound ? t("tcp.sendPanel.directTargetHint") : undefined}
              timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
              onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
              onTimerIntervalChange={(v) => state.setTimerInterval(v)}
              appendNewline={state.appendNewline}
              onAppendNewlineChange={state.setAppendNewline}
              embedded
            />
          </div>
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={bound}
            statusText={bound ? `${host}:${port} ${t('tcp.system.bound')} · ${t('tcp.targetAddress')} ${targetAddr}` : binding ? t('tcp.system.bindingUdp') : t('tcp.system.waitingUdp')}
            stats={state.stats}
            embedded
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
  const { t } = useTranslation();
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
            state.systemMessage(`✓ ${t('tcp.system.udpServerBound')} ${event.data}`);
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
            state.systemMessage(`⚠ ${t('tcp.system.error')}: ${event.data}`);
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
      state.systemMessage(`✗ ${t('tcp.system.udpServerClosed')}`);
    } else {
      setBinding(true);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`⚠ ${t('tcp.system.bindFailed')}: ${err instanceof Error ? err.message : String(err)}`);
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
      state.systemMessage(`⚠ ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-3 pb-3">
        <ConnectionBar
          mode="udp-server" host={host} port={port}
          connected={bound} connecting={binding}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleBind}
        />
        {bound && (
          <AddressField
            label={t('tcp.replyAddress')}
            value={replyAddr}
            onChange={setReplyAddr}
            placeholder={t('tcp.replyAddrPlaceholder')}
          />
        )}
      </div>

      <WorkspaceSplit
        sidebar={(
          <div className="flex min-h-0 flex-1 flex-col">
            <SendPanel
              message={state.message} setMessage={state.setMessage}
              sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
              connected={bound && !!replyAddr} onSend={handleSend}
              sendLabel={t('tcp.reply')}
              sendHistory={state.sendHistory}
              onClearHistory={() => state.setSendHistory([])}
              onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
              quickCommands={state.quickCommands}
              onSaveQuickCommand={state.saveQuickCommand}
              onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
              onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
              sendTargetLabel={replyAddr || t("tcp.system.waitingSource")}
              sendTargetHint={replyAddr ? t("tcp.sendPanel.replyHint") : t("tcp.replyAddrPlaceholder")}
              timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
              onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
              onTimerIntervalChange={(v) => state.setTimerInterval(v)}
              appendNewline={state.appendNewline}
              onAppendNewlineChange={state.setAppendNewline}
              embedded
            />
          </div>
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageLog
            messages={state.messages}
            onClear={() => { state.setMessages([]); state.resetStats(); }}
            displayFormat={state.displayFormat}
            setDisplayFormat={state.setDisplayFormat}
            connected={bound}
            statusText={bound ? `${host}:${port} ${t('tcp.system.listening')} · ${t('tcp.replyAddress')} ${replyAddr || t('tcp.system.waitingSource')}` : binding ? t('tcp.system.bindingUdpServer') : t('tcp.system.waitingUdpServer')}
            stats={state.stats}
            embedded
          />
        </div>
      </WorkspaceSplit>
    </div>
  );
}
