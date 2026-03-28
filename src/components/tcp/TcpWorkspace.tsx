// TCP/UDP 工作区 — 上下分栏布局
// 上方消息日志（主区域） + 下方紧凑发送栏
import { useState, useEffect, useRef, useCallback } from "react";
import { Server, Radio, Square, Monitor, History, X, Usb, Cpu, Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ConnectionBar } from "./ConnectionBar";
import { SendPanel } from "./SendPanel";
import { MessageLog } from "./MessageLog";
import { ClientList } from "./ClientList";
import { StatsBar } from "./StatsBar";
import { SerialPanel } from "./SerialPanel";
import { ModbusPanel } from "./ModbusPanel";
import { ModbusSlavePanel } from "./ModbusSlavePanel";
import * as svc from "@/services/tcpService";
import { useActivityLogStore } from "@/stores/activityLogStore";
import type {
  SocketMode, DataFormat, TcpMessage, TcpEvent,
  TcpServerClient, ConnectionStats, SendHistoryItem, QuickCommand,
} from "@/types/tcp";
import { LineEnding, LINE_ENDING_MAP } from "@/types/tcp";
import { registerConnection, unregisterConnection } from '@/lib/connectionRegistry';

// ═══════════════════════════════════════════
//  Recent Connections — localStorage 存储
// ═══════════════════════════════════════════

type RecentConn = { host: string; port: number };

function rcKey(mode: SocketMode) {
  return `pf:recent-conn:${mode}`;
}

function saveRecentConn(mode: SocketMode, host: string, port: number) {
  const list: RecentConn[] = JSON.parse(localStorage.getItem(rcKey(mode)) || "[]");
  const deduped = list.filter((r) => !(r.host === host && r.port === port));
  localStorage.setItem(rcKey(mode), JSON.stringify([{ host, port }, ...deduped].slice(0, 8)));
}

function useRecentConns(mode: SocketMode) {
  const [recent, setRecent] = useState<RecentConn[]>(() =>
    JSON.parse(localStorage.getItem(rcKey(mode)) || "[]")
  );
  const save = useCallback((host: string, port: number) => {
    saveRecentConn(mode, host, port);
    setRecent(JSON.parse(localStorage.getItem(rcKey(mode)) || "[]"));
  }, [mode]);
  const remove = useCallback((host: string, port: number) => {
    const list: RecentConn[] = JSON.parse(localStorage.getItem(rcKey(mode)) || "[]");
    const updated = list.filter((r) => !(r.host === host && r.port === port));
    localStorage.setItem(rcKey(mode), JSON.stringify(updated));
    setRecent(updated);
  }, [mode]);
  return { recent, save, remove };
}

function RecentConnections({recent, onLoad, onRemove,
}: {
  mode: SocketMode;
  recent: RecentConn[];
  onLoad: (host: string, port: number) => void;
  onRemove: (host: string, port: number) => void;
}) {
  const { t } = useTranslation();
  if (recent.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap px-0.5">
      <div className="flex items-center gap-1 text-text-disabled shrink-0">
        <History className="w-3 h-3" />
        <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide">{t('tcp.recentConnections', '最近')}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {recent.map((r, i) => (
          <div key={i} className="group flex items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40">
            <button
              onClick={() => onLoad(r.host, r.port)}
              className="h-[22px] px-2 text-[var(--fs-xxs)] font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors"
            >
              {r.host}:{r.port}
            </button>
            <button
              onClick={() => onRemove(r.host, r.port)}
              className="hidden group-hover:flex h-[22px] w-5 items-center justify-center text-text-disabled hover:text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Mode Tab --
const MODES: { value: SocketMode; labelKey: string; hintKey: string; icon: React.ReactNode }[] = [
  { value: "tcp-client", labelKey: "tcp.modes.tcpClient", hintKey: "tcp.modes.tcpClientHint", icon: <Monitor className="w-3.5 h-3.5" /> },
  { value: "tcp-server", labelKey: "tcp.modes.tcpServer", hintKey: "tcp.modes.tcpServerHint", icon: <Server className="w-3.5 h-3.5" /> },
  { value: "udp-client", labelKey: "tcp.modes.udpClient", hintKey: "tcp.modes.udpClientHint", icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "udp-server", labelKey: "tcp.modes.udpServer", hintKey: "tcp.modes.udpServerHint", icon: <Square className="w-3.5 h-3.5" /> },
  { value: "serial",     labelKey: "tcp.modes.serial",    hintKey: "tcp.modes.serialHint",    icon: <Usb className="w-3.5 h-3.5" /> },
  { value: "modbus",       labelKey: "tcp.modes.modbus",       hintKey: "tcp.modes.modbusHint",       icon: <Cpu className="w-3.5 h-3.5" /> },
  { value: "modbus-slave", labelKey: "tcp.modes.modbusSlave",  hintKey: "tcp.modes.modbusSlaveHint",  icon: <Cpu className="w-3.5 h-3.5" /> },
];

const SPLIT_PAIR: Partial<Record<SocketMode, SocketMode>> = {
  'tcp-client':   'tcp-server',
  'tcp-server':   'tcp-client',
  'udp-client':   'udp-server',
  'udp-server':   'udp-client',
  'modbus':       'modbus-slave',
  'modbus-slave': 'modbus',
  'serial':       'serial',
};

export function TcpWorkspace({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SocketMode>("tcp-client");
  const [splitView, setSplitView] = useState(false);
  const sessionKey = useRef(sessionId ?? crypto.randomUUID()).current;
  const secondaryEverShownRef = useRef(false);
  const lastSplittableModeRef = useRef<SocketMode | null>(null);
  const activeMode = MODES.find((item) => item.value === mode) || MODES[0];
  const canSplit = mode in SPLIT_PAIR;

  // Auto-reset split when switching to a non-splittable mode
  useEffect(() => {
    if (!canSplit) setSplitView(false);
  }, [mode, canSplit]);

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
          {canSplit && (
            <button
              onClick={() => setSplitView((v) => !v)}
              className={cn(
                "wb-tool-chip cursor-pointer transition-colors",
                splitView && "bg-accent-soft text-accent border-accent/40"
              )}
              title={splitView ? t('tcp.splitViewActive', '双端') : t('tcp.splitView', '双端视图')}
            >
              <Columns2 className="w-3 h-3" />
              {splitView ? t('tcp.splitViewActive', '双端') : t('tcp.splitView', '双端视图')}
            </button>
          )}
          <span className="wb-tool-chip">
            {mode.startsWith("tcp")
              ? t('tcp.connectionOriented')
              : mode.startsWith("udp")
                ? t('tcp.connectionless')
                : mode === "serial"
                  ? t('tcp.serialPort', '串口通信')
                  : mode === "modbus"
                    ? t('tcp.modbusBus', 'Modbus 总线')
                    : mode === "modbus-slave" ? t('tcp.modbusSlaveMode', '从站模式') : ''}
          </span>
        </div>
      </div>

      <div className={cn(
        "flex min-h-0 flex-1 pt-3",
        splitView && canSplit ? "flex-row gap-0" : "flex-col"
      )}>
        {/* Primary panel */}
        <div className={cn("flex min-h-0 flex-col", splitView && canSplit ? "flex-1" : "flex-1")}>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "tcp-client" && "hidden")}>
            <TcpClientPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "tcp-server" && "hidden")}>
            <TcpServerPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "udp-client" && "hidden")}>
            <UdpClientPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "udp-server" && "hidden")}>
            <UdpServerPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "serial" && "hidden")}>
            <SerialPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "modbus" && "hidden")}>
            <ModbusPanel sessionKey={sessionKey} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", mode !== "modbus-slave" && "hidden")}>
            <ModbusSlavePanel sessionKey={sessionKey} />
          </div>
        </div>

        {/*
          Secondary split panel — once mounted, never unmount (CSS hidden when inactive)
          This preserves connection state when split view is toggled off
        */}
        {(() => {
          const splitActive = splitView && canSplit;
          // Track the last splittable mode to preserve which secondary panel was active
          if (splitActive) {
            secondaryEverShownRef.current = true;
            lastSplittableModeRef.current = mode;
          }
          if (!secondaryEverShownRef.current) return null;

          // Use the last known splittable mode for rendering the secondary panels
          // This avoids re-rendering when we switch to a non-splittable mode
          const renderMode = splitActive ? mode : (lastSplittableModeRef.current ?? mode);
          const secondMode = SPLIT_PAIR[renderMode];
          const splitKey = `${sessionKey}-split`;
          const headerMode = MODES.find((m) => m.value === secondMode);

          return (
            <>
              <div className={cn("w-px bg-border-default/40 shrink-0", !splitActive && "hidden")} />
              <div className={cn(
                "flex min-h-0 flex-1 flex-col border-l border-border-default/40 overflow-hidden",
                !splitActive && "hidden"
              )}>
                {/* Split panel header */}
                <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-bg-secondary/50 border-b border-border-default/40 text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wide">
                  {headerMode?.icon}
                  {t(headerMode?.labelKey ?? '')}
                </div>
                {/* Secondary panels — always mounted, CSS hidden when not the active secondary */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "tcp-client" && "hidden")}>
                    <TcpClientPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "tcp-server" && "hidden")}>
                    <TcpServerPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "udp-client" && "hidden")}>
                    <UdpClientPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "udp-server" && "hidden")}>
                    <UdpServerPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "serial" && "hidden")}>
                    <SerialPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "modbus" && "hidden")}>
                    <ModbusPanel sessionKey={splitKey} />
                  </div>
                  <div className={cn("flex min-h-0 flex-1 flex-col", secondMode !== "modbus-slave" && "hidden")}>
                    <ModbusSlavePanel sessionKey={splitKey} />
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>
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
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary px-3 py-2">
      <span className="shrink-0 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 flex-1 bg-transparent text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled"
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
  const [lineEnding, setLineEnding] = useState<LineEnding>('none');
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerInterval, setTimerInterval] = useState(1000);
  const [stats, setStats] = useState<ConnectionStats>({ sentBytes: 0, receivedBytes: 0, sentCount: 0, receivedCount: 0 });

  const addMessage = useCallback((msg: TcpMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      return next.length > 5000 ? next.slice(-5000) : next;
    });
    if (msg.direction === "sent") {
      setStats((s) => ({ ...s, sentBytes: s.sentBytes + msg.size, sentCount: s.sentCount + 1 }));
      useActivityLogStore.getState().addEntry({
        source: 'tcp', direction: 'sent',
        summary: msg.data.length > 120 ? msg.data.slice(0, 120) + '...' : msg.data,
        rawData: msg.data,
      });
    } else if (msg.direction === "received") {
      setStats((s) => ({ ...s, receivedBytes: s.receivedBytes + msg.size, receivedCount: s.receivedCount + 1 }));
      useActivityLogStore.getState().addEntry({
        source: 'tcp', direction: 'received',
        summary: msg.data.length > 120 ? msg.data.slice(0, 120) + '...' : msg.data,
        rawData: msg.data,
      });
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
    lineEnding, setLineEnding, timerEnabled, setTimerEnabled,
    timerInterval, setTimerInterval, stats, setStats,
    addMessage, addToHistory, systemMessage, resetStats, saveQuickCommand,
  };
}

// ═══════════════════════════════════════════
//  TCP Client Panel — 上下分栏
// ═══════════════════════════════════════════

function TcpClientPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const connectionId = useRef(`tcp-client:${sessionKey}`).current;
  const state = useSocketState();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(8080);
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const [autoReconnect, setAutoReconnect] = useState(false);
  const autoReconnectRef = useRef(false);
  const hostRef = useRef(host);
  const portRef = useRef(port);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("tcp-client");

  useEffect(() => { autoReconnectRef.current = autoReconnect; }, [autoReconnect]);
  useEffect(() => { hostRef.current = host; }, [host]);
  useEffect(() => { portRef.current = port; }, [port]);

  useEffect(() => {
    svc.tcpListConnections().then((list) => {
      if (list.some((c) => c.connectionId === connectionId)) {
        setConnected(true);
        state.systemMessage(`[RESTORE] ${t('tcp.system.connectedTo')} (recovered)`);
      }
    }).catch(() => {});
  }, [connectionId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await svc.onTcpEvent((event: TcpEvent) => {
        if (event.connectionId !== connectionId) return;
        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            setConnectedSince(new Date().toISOString());
            state.systemMessage(`[OK] ${t('tcp.system.connectedTo')} ${event.data}`);
            registerConnection(sessionKey, connectionId, `TCP ${hostRef.current}:${portRef.current}`);
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
            setConnectedSince(undefined);
            state.systemMessage(`[CLOSED] ${t('tcp.system.disconnected')}`);
            unregisterConnection(sessionKey, connectionId);
            if (autoReconnectRef.current) {
              state.systemMessage(`[INFO] 2s 后自动重连...`);
              setTimeout(async () => {
                if (!autoReconnectRef.current) return;
                try {
                  setConnecting(true);
                  await svc.tcpConnect(connectionId, hostRef.current, portRef.current);
                } catch {
                  setConnecting(false);
                }
              }, 2000);
            }
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            setConnectedSince(undefined);
            state.systemMessage(`[WARN] ${t('tcp.system.error')}: ${event.data}`);
            unregisterConnection(sessionKey, connectionId);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => {
      disposed = true;
      unlisten?.();
      unregisterConnection(sessionKey, connectionId);
      svc.tcpDisconnect(connectionId).catch(() => {});
    };
  }, [connectionId, state.addMessage, state.systemMessage, t]);

  useEffect(() => {
    if (state.timerEnabled && connected && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, connected, state.timerInterval, state.message, state.sendFormat]);

  const handleConnect = async () => {
    if (connected) {
      unregisterConnection(sessionKey, connectionId);
      await svc.tcpDisconnect(connectionId);
      setConnected(false);
      setConnectedSince(undefined);
    } else {
      setConnecting(true);
      saveRecent(host, port);
      try {
        await svc.tcpConnect(connectionId, host, port);
      } catch (err: unknown) {
        setConnecting(false);
        state.systemMessage(`[WARN] ${t('tcp.system.connectFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!connected || !state.message.trim()) return;
    const data = state.message + LINE_ENDING_MAP[state.lineEnding];
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
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 pb-3">
        <ConnectionBar
          mode="tcp-client" host={host} port={port}
          connected={connected} connecting={connecting}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleConnect}
        />
        <div className="flex items-center justify-between gap-3 px-0.5">
          <RecentConnections
            mode="tcp-client"
            recent={recent}
            onLoad={(h, p) => { setHost(h); setPort(p); }}
            onRemove={removeRecent}
          />
          <button
            onClick={() => setAutoReconnect((v) => !v)}
            className={cn(
              "shrink-0 flex items-center gap-1.5 h-[22px] px-2 rounded-[6px] border text-[var(--fs-xxs)] font-medium transition-all",
              autoReconnect
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-default/60 bg-bg-secondary/40 text-text-tertiary hover:border-accent/30 hover:text-text-secondary"
            )}
            title={autoReconnect ? "关闭自动重连" : "开启自动重连"}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full transition-colors", autoReconnect ? "bg-accent" : "bg-text-disabled")} />
            {t('tcp.autoReconnect', '自动重连')}
          </button>
        </div>
      </div>

      <div className="wb-workbench-stack min-h-0 flex-1">
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
          lineEnding={state.lineEnding}
          onLineEndingChange={state.setLineEnding}
          embedded
        />
      </div>
      <StatsBar
        stats={state.stats}
        connected={connected}
        statusText={connected ? `${host}:${port}` : connecting ? t('tcp.system.connecting') : t('tcp.system.idle', '空闲')}
        connectedSince={connectedSince}
        autoReconnect={autoReconnect && !connected}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  TCP Server Panel — 上下分栏 + ClientList
// ═══════════════════════════════════════════

function TcpServerPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const serverId = useRef(`tcp-server:${sessionKey}`).current;
  const state = useSocketState();
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9000);
  const [clients, setClients] = useState<TcpServerClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedClient = selectedClientId ? clients.find((client) => client.id === selectedClientId) ?? null : null;
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("tcp-server");

  useEffect(() => {
    svc.tcpListServers().then((list) => {
      const server = list.find((s) => s.serverId === serverId);
      if (server) {
        setRunning(true);
        const restoredClients: TcpServerClient[] = server.clientIds.map((cid, i) => ({
          id: cid,
          remoteAddr: server.clientAddrs[i] || 'unknown',
          connectedAt: new Date().toISOString(),
        }));
        setClients(restoredClients);
        state.systemMessage(`[RESTORE] ${t('tcp.system.serverStarted')} (recovered, ${server.clientIds.length} clients)`);
      }
    }).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await svc.onTcpServerEvent((event: TcpEvent) => {
        if (event.connectionId !== serverId) return;
        switch (event.eventType) {
          case "started":
            setRunning(true);
            setStarting(false);
            setConnectedSince(new Date().toISOString());
            state.systemMessage(`[OK] ${t('tcp.system.serverStarted')} ${event.data}`);
            registerConnection(sessionKey, serverId, 'TCP Server');
            break;
          case "client-connected":
            if (event.clientId && event.remoteAddr) {
              setClients((prev) => [...prev, { id: event.clientId!, remoteAddr: event.remoteAddr!, connectedAt: event.timestamp }]);
              state.systemMessage(`[+] ${t('tcp.system.clientConnected')}: ${event.remoteAddr}`);
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
              state.systemMessage(`[-] ${t('tcp.system.clientDisconnected')}: ${event.clientId.slice(0, 8)}`);
            }
            break;
          case "error":
            state.systemMessage(`[WARN] ${t('tcp.system.error')}: ${event.data}`);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => {
      disposed = true;
      unlisten?.();
      unregisterConnection(sessionKey, serverId);
      svc.tcpServerStop(serverId).catch(() => {});
    };
  }, [serverId, state.addMessage, state.systemMessage, t]);

  useEffect(() => {
    if (state.timerEnabled && running && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, running, state.timerInterval, state.message, state.sendFormat]);

  const handleToggle = async () => {
    if (running) {
      unregisterConnection(sessionKey, serverId);
      await svc.tcpServerStop(serverId);
      setRunning(false);
      setClients([]);
      setConnectedSince(undefined);
      state.systemMessage(`[CLOSED] ${t('tcp.system.serverStopped')}`);
    } else {
      setStarting(true);
      saveRecent(host, port);
      try {
        await svc.tcpServerStart(serverId, host, port);
      } catch (err: unknown) {
        setStarting(false);
        state.systemMessage(`[WARN] ${t('tcp.system.startFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!running || !state.message.trim()) return;
    const data = state.message + LINE_ENDING_MAP[state.lineEnding];
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
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 pb-3">
        <ConnectionBar
          mode="tcp-server" host={host} port={port}
          connected={running} connecting={starting}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleToggle}
        />
        <RecentConnections
          mode="tcp-server" recent={recent}
          onLoad={(h, p) => { setHost(h); setPort(p); }}
          onRemove={removeRecent}
        />
        {clients.length > 0 && (
          <ClientList
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={setSelectedClientId}
            embedded
          />
        )}
      </div>

      <div className="wb-workbench-stack min-h-0 flex-1">
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
          lineEnding={state.lineEnding}
          onLineEndingChange={state.setLineEnding}
          embedded
        />
      </div>
      <StatsBar
        stats={state.stats}
        connected={running}
        statusText={running ? `${host}:${port} · ${clients.length} ${t('tcp.clientList.clients', '客户端')}` : starting ? t('tcp.system.startingServer') : t('tcp.system.idle', '空闲')}
        connectedSince={connectedSince}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Client Panel — 上下分栏
// ═══════════════════════════════════════════

function UdpClientPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const socketId = useRef(`udp-client:${sessionKey}`).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9001);
  const [targetAddr, setTargetAddr] = useState("127.0.0.1:9000");
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("udp-client");

  useEffect(() => {
    svc.udpListSockets().then((list) => {
      if (list.some((s) => s.socketId === socketId)) {
        setBound(true);
        state.systemMessage(`[RESTORE] ${t('tcp.system.bound')} (recovered)`);
      }
    }).catch(() => {});
  }, [socketId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await svc.onUdpEvent((event: TcpEvent) => {
        if (event.connectionId !== socketId) return;
        switch (event.eventType) {
          case "bound":
            setBound(true);
            setBinding(false);
            setConnectedSince(new Date().toISOString());
            state.systemMessage(`[OK] ${t('tcp.system.bound')} ${event.data}`);
            registerConnection(sessionKey, socketId, 'UDP Client');
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
            setConnectedSince(undefined);
            state.systemMessage(`[WARN] ${t('tcp.system.error')}: ${event.data}`);
            unregisterConnection(sessionKey, socketId);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => {
      disposed = true;
      unlisten?.();
      unregisterConnection(sessionKey, socketId);
      svc.udpClose(socketId).catch(() => {});
    };
  }, [socketId, state.addMessage, state.systemMessage, t]);

  useEffect(() => {
    if (state.timerEnabled && bound && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, bound, state.timerInterval, state.message, state.sendFormat]);

  const handleBind = async () => {
    if (bound) {
      unregisterConnection(sessionKey, socketId);
      await svc.udpClose(socketId);
      setBound(false);
      setConnectedSince(undefined);
      state.systemMessage(`[CLOSED] ${t('tcp.system.udpClosed')}`);
    } else {
      setBinding(true);
      saveRecent(host, port);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`[WARN] ${t('tcp.system.bindFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!bound || !state.message.trim() || !targetAddr.trim()) return;
    const data = state.message + LINE_ENDING_MAP[state.lineEnding];
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
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 pb-3">
        <ConnectionBar
          mode="udp-client" host={host} port={port}
          connected={bound} connecting={binding}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleBind}
        />
        <div className="px-0.5">
          <RecentConnections
            mode="udp-client"
            recent={recent}
            onLoad={(h, p) => { setHost(h); setPort(p); }}
            onRemove={removeRecent}
          />
        </div>
        {bound && (
          <AddressField
            label={t('tcp.targetAddress')}
            value={targetAddr}
            onChange={setTargetAddr}
            placeholder={t('tcp.targetAddrPlaceholder')}
          />
        )}
      </div>

      <div className="wb-workbench-stack min-h-0 flex-1">
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
          lineEnding={state.lineEnding}
          onLineEndingChange={state.setLineEnding}
          embedded
        />
      </div>
      <StatsBar
        stats={state.stats}
        connected={bound}
        statusText={bound ? `${host}:${port}` : binding ? t('tcp.system.bindingUdp') : t('tcp.system.idle', '空闲')}
        connectedSince={connectedSince}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Server Panel — 上下分栏
// ═══════════════════════════════════════════

function UdpServerPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const socketId = useRef(`udp-server:${sessionKey}`).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9002);
  const [replyAddr, setReplyAddr] = useState("");
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("udp-server");

  useEffect(() => {
    svc.udpListSockets().then((list) => {
      if (list.some((s) => s.socketId === socketId)) {
        setBound(true);
        state.systemMessage(`[RESTORE] ${t('tcp.system.udpServerBound')} (recovered)`);
      }
    }).catch(() => {});
  }, [socketId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await svc.onUdpEvent((event: TcpEvent) => {
        if (event.connectionId !== socketId) return;
        switch (event.eventType) {
          case "bound":
            setBound(true);
            setBinding(false);
            setConnectedSince(new Date().toISOString());
            state.systemMessage(`[OK] ${t('tcp.system.udpServerBound')} ${event.data}`);
            registerConnection(sessionKey, socketId, 'UDP Server');
            break;
          case "data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp,
              size: event.size || 0, remoteAddr: event.remoteAddr,
            });
            if (event.remoteAddr) {
              setReplyAddr((current) => current || event.remoteAddr || "");
            }
            break;
          case "error":
            setBound(false);
            setBinding(false);
            setConnectedSince(undefined);
            state.systemMessage(`[WARN] ${t('tcp.system.error')}: ${event.data}`);
            unregisterConnection(sessionKey, socketId);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => {
      disposed = true;
      unlisten?.();
      unregisterConnection(sessionKey, socketId);
      svc.udpClose(socketId).catch(() => {});
    };
  }, [socketId, state.addMessage, state.systemMessage, t]);

  useEffect(() => {
    if (state.timerEnabled && bound && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, bound, state.timerInterval, state.message, state.sendFormat]);

  const handleBind = async () => {
    if (bound) {
      unregisterConnection(sessionKey, socketId);
      await svc.udpClose(socketId);
      setBound(false);
      setConnectedSince(undefined);
      state.systemMessage(`[CLOSED] ${t('tcp.system.udpServerClosed')}`);
    } else {
      setBinding(true);
      saveRecent(host, port);
      try {
        await svc.udpBind(socketId, `${host}:${port}`);
      } catch (err: unknown) {
        setBinding(false);
        state.systemMessage(`[WARN] ${t('tcp.system.bindFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const handleSend = async () => {
    if (!bound || !state.message.trim() || !replyAddr.trim()) return;
    const data = state.message + LINE_ENDING_MAP[state.lineEnding];
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
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 pb-3">
        <ConnectionBar
          mode="udp-server" host={host} port={port}
          connected={bound} connecting={binding}
          onHostChange={setHost} onPortChange={setPort}
          onToggle={handleBind}
        />
        <div className="px-0.5">
          <RecentConnections
            mode="udp-server"
            recent={recent}
            onLoad={(h, p) => { setHost(h); setPort(p); }}
            onRemove={removeRecent}
          />
        </div>
        {bound && (
          <AddressField
            label={t('tcp.replyAddress')}
            value={replyAddr}
            onChange={setReplyAddr}
            placeholder={t('tcp.replyAddrPlaceholder')}
          />
        )}
      </div>

      <div className="wb-workbench-stack min-h-0 flex-1">
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
          lineEnding={state.lineEnding}
          onLineEndingChange={state.setLineEnding}
          embedded
        />
      </div>
      <StatsBar
        stats={state.stats}
        connected={bound}
        statusText={bound ? `${host}:${port}` : binding ? t('tcp.system.bindingUdpServer') : t('tcp.system.idle', '空闲')}
        connectedSince={connectedSince}
      />
    </div>
  );
}
