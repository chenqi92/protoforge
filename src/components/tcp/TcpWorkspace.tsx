// TCP/UDP 工作区 — 上下分栏布局
// 上方消息日志（主区域） + 下方紧凑发送栏
import { memo, useState, useEffect, useRef, useCallback } from "react";
import { Server, Radio, Square, Monitor, History, X, Usb, Cpu, Columns2, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ConnectionBar } from "./ConnectionBar";
import { SendPanel } from "./SendPanel";
import { ClientList } from "./ClientList";
import { StatsBar } from "./StatsBar";
import { SerialPanel } from "./SerialPanel";
import { ModbusPanel } from "./ModbusPanel";
import { ModbusSlavePanel } from "./ModbusSlavePanel";
import { ProtocolSidebarSection, ProtocolWorkbench } from "./ProtocolWorkbench";
import * as svc from "@/services/tcpService";
import { useActivityLogStore } from "@/stores/activityLogStore";
import { useAppStore } from "@/stores/appStore";
import type {
  SocketMode, DataFormat, TcpMessage, TcpEvent,
  TcpServerClient, ConnectionStats, SendHistoryItem, QuickCommand,
} from "@/types/tcp";
import { LineEnding, LINE_ENDING_MAP } from "@/types/tcp";
import { DEFAULT_TCP_TOOL_MODE } from "@/types/toolSession";
import {
  getActiveConnectionLabelsForKeys,
  hasActiveConnectionsForKeys,
  registerConnection,
  unregisterConnection,
} from '@/lib/connectionRegistry';

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
        <span className="pf-text-xxs font-semibold uppercase tracking-wide">{t('tcp.recentConnections', '最近')}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {recent.map((r, i) => (
          <div key={i} className="group flex items-center pf-rounded-sm border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40">
            <button
              onClick={() => onLoad(r.host, r.port)}
              className="h-[22px] px-2 pf-text-xxs font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors"
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
};

function getModeCategoryLabel(mode: SocketMode, t: ReturnType<typeof useTranslation>["t"]) {
  if (mode.startsWith("tcp")) return t('tcp.connectionOriented');
  if (mode.startsWith("udp")) return t('tcp.connectionless');
  if (mode === "serial") return t('tcp.serialPort', '串口通信');
  if (mode === "modbus") return t('tcp.modbusBus', 'Modbus 总线');
  if (mode === "modbus-slave") return t('tcp.modbusSlaveMode', '从站模式');
  return "";
}

function ProtocolModePanel({
  mode,
  sessionKey,
  compact = false,
  udpPeerTargetAddr,
  onUdpServerTargetChange,
}: {
  mode: SocketMode;
  sessionKey: string;
  compact?: boolean;
  udpPeerTargetAddr?: string;
  onUdpServerTargetChange?: (targetAddr: string) => void;
}) {
  switch (mode) {
    case "tcp-client":
      return <TcpClientPanel sessionKey={sessionKey} compact={compact} />;
    case "tcp-server":
      return <TcpServerPanel sessionKey={sessionKey} compact={compact} />;
    case "udp-client":
      return <UdpClientPanel sessionKey={sessionKey} compact={compact} pairTargetAddr={udpPeerTargetAddr} />;
    case "udp-server":
      return <UdpServerPanel sessionKey={sessionKey} compact={compact} onTargetChange={onUdpServerTargetChange} />;
    case "serial":
      return <SerialPanel sessionKey={sessionKey} />;
    case "modbus":
      return <ModbusPanel sessionKey={sessionKey} compact={compact} />;
    case "modbus-slave":
      return <ModbusSlavePanel sessionKey={sessionKey} compact={compact} />;
    default:
      return null;
  }
}

export const TcpWorkspace = memo(function TcpWorkspace({
  sessionId,
  initialMode = DEFAULT_TCP_TOOL_MODE,
}: {
  sessionId?: string;
  initialMode?: SocketMode;
}) {
  const { t } = useTranslation();
  const updateToolSession = useAppStore((s) => s.updateToolSession);
  const [mode, setMode] = useState<SocketMode>(initialMode);
  const [splitView, setSplitView] = useState(false);
  const [udpPeerTargetAddr, setUdpPeerTargetAddr] = useState("127.0.0.1:9000");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [modeMenuPos, setModeMenuPos] = useState({ top: 0, left: 0 });
  const sessionKey = useRef(sessionId ?? crypto.randomUUID()).current;
  const splitKey = `${sessionKey}-split`;
  const modeMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const activeMode = MODES.find((item) => item.value === mode) || MODES[0];
  const canSplit = mode in SPLIT_PAIR;
  const pairedMode = canSplit ? MODES.find((item) => item.value === SPLIT_PAIR[mode]) ?? null : null;

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!sessionId) return;
    updateToolSession("tcpudp", sessionId, { tcpMode: mode });
  }, [mode, sessionId, updateToolSession]);

  const handleModeChange = useCallback(async (nextMode: SocketMode) => {
    if (nextMode === mode) return;

    const relatedSessionKeys = [sessionKey, splitKey];
    if (hasActiveConnectionsForKeys(relatedSessionKeys)) {
      const labels = getActiveConnectionLabelsForKeys(relatedSessionKeys);
      const message = `当前会话存在活跃连接：\n${labels.join("\n")}\n\n切换类型会断开当前会话，是否继续？`;
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      const ok = await confirm(message, { title: "切换连接类型", kind: "warning" });
      if (!ok) return;
    }

    if (!(nextMode in SPLIT_PAIR)) {
      setSplitView(false);
    }
    setMode(nextMode);
  }, [mode, sessionKey, splitKey]);

  const toggleModeMenu = useCallback((anchor?: HTMLElement | null) => {
    const anchorEl = anchor ?? modeMenuAnchorRef.current;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setModeMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 240) });
    }
    setShowModeMenu((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent p-3">
      <div className="shrink-0 space-y-2">
        <div className="wb-request-shell">
          <button
            ref={modeMenuAnchorRef}
            onClick={(event) => toggleModeMenu(event.currentTarget)}
            className="wb-protocol-dropdown"
            title={t('tcp.switchType', '切换类型')}
          >
            <span className="wb-protocol-dropdown-icon bg-accent text-white">
              {activeMode.icon}
            </span>
            <span className="wb-protocol-dropdown-label">{t(activeMode.labelKey)}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <div className="wb-request-main">
            <span className="wb-request-label">{t('common.description', { defaultValue: '说明' })}</span>
            <div className="truncate pf-text-sm text-text-secondary">{t(activeMode.hintKey)}</div>
          </div>
          <div className="wb-request-actions">
            {canSplit ? (
              <button
                onClick={() => setSplitView((v) => !v)}
                className={cn(
                  "wb-ghost-btn px-2.5",
                  splitView && "bg-accent-soft text-accent border-accent/40"
                )}
                title={splitView ? t('tcp.splitViewActive', '双端') : t('tcp.splitView', '双端视图')}
              >
                <Columns2 className="w-3 h-3" />
                {splitView ? t('tcp.splitViewActive', '双端') : t('tcp.splitView', '双端视图')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="wb-request-secondary">
          <span className="wb-request-meta">
            <span className="wb-request-meta-dot bg-accent" />
            {getModeCategoryLabel(mode, t)}
          </span>
          {pairedMode ? (
            <span className="wb-request-meta">
              <Columns2 className="h-3 w-3" />
              双端配对 · {t(pairedMode.labelKey)}
            </span>
          ) : null}
          {canSplit && (
            <span className="pf-text-xs text-text-tertiary">
              {splitView ? t('tcp.splitViewHint', { defaultValue: '当前已开启双端联调视图' }) : t('tcp.splitViewGuide', { defaultValue: '需要模拟双端链路时可开启双端视图' })}
            </span>
          )}
        </div>
      </div>

      {showModeMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowModeMenu(false)} />
          <div
            className="wb-protocol-menu fixed z-[221] w-[240px]"
            style={{ top: modeMenuPos.top, left: modeMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('tcp.switchType', '切换类型')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {MODES.map((item) => (
                <button
                  key={item.value}
                  onClick={() => {
                    handleModeChange(item.value);
                    setShowModeMenu(false);
                  }}
                  className={cn("wb-protocol-menu-item", item.value === mode && "bg-bg-hover")}
                >
                  <span className={cn(
                    "wb-protocol-menu-icon",
                    item.value === mode ? "bg-accent-soft text-accent" : "bg-bg-secondary text-text-secondary"
                  )}>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block pf-text-sm font-medium text-text-primary">{t(item.labelKey)}</span>
                    <span className="block pf-text-xxs text-text-tertiary">{t(item.hintKey)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div className={cn(
        "flex min-h-0 flex-1 pt-3",
        splitView && canSplit ? "flex-row gap-0" : "flex-col"
      )}>
        <div className={cn("flex min-h-0 min-w-0 flex-col", splitView && canSplit ? "basis-[56%]" : "flex-1")}>
          <ProtocolModePanel
            mode={mode}
            sessionKey={sessionKey}
            udpPeerTargetAddr={udpPeerTargetAddr}
            onUdpServerTargetChange={setUdpPeerTargetAddr}
          />
        </div>

        {(() => {
          const splitActive = splitView && canSplit;
          const secondMode = SPLIT_PAIR[mode] ?? mode;
          if (!splitActive) {
            return null;
          }
          return (
            <div className="flex min-h-0 min-w-0 basis-[44%] flex-col overflow-hidden border-l border-border-default/40">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2.5 pb-2.5 pt-0">
                <ProtocolModePanel
                  mode={secondMode}
                  sessionKey={splitKey}
                  compact
                  udpPeerTargetAddr={udpPeerTargetAddr}
                  onUdpServerTargetChange={setUdpPeerTargetAddr}
                />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

TcpWorkspace.displayName = "TcpWorkspace";

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
    <div className="flex items-center gap-2 pf-rounded-md border border-border-default/80 bg-bg-primary px-3 py-2">
      <span className="shrink-0 pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 flex-1 bg-transparent pf-text-sm font-mono text-text-primary outline-none placeholder:text-text-disabled"
      />
    </div>
  );
}

function normalizeUdpLoopbackHost(host: string): string {
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

function normalizeMessageEncoding(format: DataFormat): "utf8" | "hex" | "base64" | "gbk" {
  if (format === "hex" || format === "base64" || format === "gbk") {
    return format;
  }
  return "utf8";
}

function createSentMessage(data: string, format: DataFormat, extra?: Partial<TcpMessage>): TcpMessage {
  return {
    id: crypto.randomUUID(),
    direction: "sent",
    data,
    rawHex: svc.estimateRawHex(data, format),
    encoding: normalizeMessageEncoding(format),
    timestamp: new Date().toISOString(),
    size: svc.measurePayloadSize(data, format),
    ...extra,
  };
}

// ═══════════════════════════════════════════
//  共用 Hook: 消息管理、统计、发送选项
// ═══════════════════════════════════════════

function useSocketState() {
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sendFormat, setSendFormat] = useState<DataFormat>("text");
  const [displayFormat, setDisplayFormat] = useState<DataFormat>("auto");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [sendHistory, setSendHistory] = useState<SendHistoryItem[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([
    { id: "hb", name: "Heartbeat", data: "PING", format: "text" },
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

  useEffect(() => {
    if (messages.length === 0) {
      setSelectedMessageId(null);
      return;
    }
    setSelectedMessageId((current) => (
      current && messages.some((item) => item.id === current)
        ? current
        : messages[messages.length - 1]?.id ?? null
    ));
  }, [messages]);

  return {
    messages, setMessages, message, setMessage,
    sendFormat, setSendFormat, displayFormat, setDisplayFormat,
    selectedMessageId, setSelectedMessageId,
    sendHistory, setSendHistory, quickCommands, setQuickCommands,
    lineEnding, setLineEnding, timerEnabled, setTimerEnabled,
    timerInterval, setTimerInterval, stats, setStats,
    addMessage, addToHistory, systemMessage, resetStats, saveQuickCommand,
  };
}

// ═══════════════════════════════════════════
//  TCP Client Panel — 上下分栏
// ═══════════════════════════════════════════

function TcpClientPanel({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
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
      await svc.tcpSend(connectionId, data, svc.normalizeSendEncoding(state.sendFormat));
      state.addMessage(createSentMessage(data, state.sendFormat));
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProtocolWorkbench
        sidebar={
          <>
          <ProtocolSidebarSection
            title={t('tcp.sidebar.connection', '连接设置')}
            description={t('tcp.sidebar.connectionDesc', '配置目标地址、端口和自动重连策略。')}
            compact={compact}
            showDescriptionInCompact={compact}
          >
              <div className="space-y-3">
                <ConnectionBar
                  mode="tcp-client" host={host} port={port}
                  connected={connected} connecting={connecting}
                  onHostChange={setHost} onPortChange={setPort}
                  onToggle={handleConnect}
                  compact={compact}
                />
                {!compact ? (
                  <div className="flex items-center justify-between gap-3">
                    <RecentConnections
                      mode="tcp-client"
                      recent={recent}
                      onLoad={(h, p) => { setHost(h); setPort(p); }}
                      onRemove={removeRecent}
                    />
                    <button
                      onClick={() => setAutoReconnect((v) => !v)}
                      className={cn(
                        "shrink-0 flex items-center gap-1.5 h-[22px] px-2 pf-rounded-sm border pf-text-xxs font-medium transition-all",
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
                ) : null}
              </div>
            </ProtocolSidebarSection>
          </>
        }
        compact={compact}
        messages={state.messages}
        selectedMessageId={state.selectedMessageId}
        onSelectMessage={(message) => state.setSelectedMessageId(message.id)}
        onClearMessages={() => { state.setMessages([]); state.resetStats(); }}
        displayFormat={state.displayFormat}
        setDisplayFormat={state.setDisplayFormat}
        connected={connected}
        statusText={connected ? `${host}:${port} ${t('tcp.system.connected')}` : connecting ? t('tcp.system.connecting') : t('tcp.system.waitingConnection')}
        stats={state.stats}
        sendPanel={(
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
            layout="sidebar"
            compact={compact}
          />
        )}
      />
      {!compact ? (
        <StatsBar
          stats={state.stats}
          connected={connected}
          statusText={connected ? `${host}:${port}` : connecting ? t('tcp.system.connecting') : t('tcp.system.idle', '空闲')}
          connectedSince={connectedSince}
          autoReconnect={autoReconnect && !connected}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════
//  TCP Server Panel — 上下分栏 + ClientList
// ═══════════════════════════════════════════

function TcpServerPanel({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
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
        await svc.tcpServerSend(serverId, selectedClientId, data, svc.normalizeSendEncoding(state.sendFormat));
        state.addMessage(createSentMessage(data, state.sendFormat, { clientId: selectedClientId }));
      } else {
        const count = await svc.tcpServerBroadcast(serverId, data, svc.normalizeSendEncoding(state.sendFormat));
        state.addMessage(createSentMessage(data, state.sendFormat, {
          remoteAddr: `${t('tcp.system.broadcast')} · ${count}`,
        }));
      }
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProtocolWorkbench
        sidebar={
          <>
          <ProtocolSidebarSection
            title={t('tcp.sidebar.connection', '连接设置')}
            description={t('tcp.sidebar.serverConnectionDesc', '配置监听地址与端口，并管理最近使用的服务端配置。')}
            compact={compact}
            showDescriptionInCompact={compact}
          >
              <div className="space-y-3">
                <ConnectionBar
                  mode="tcp-server" host={host} port={port}
                  connected={running} connecting={starting}
                  onHostChange={setHost} onPortChange={setPort}
                  onToggle={handleToggle}
                  compact={compact}
                />
                {!compact ? (
                  <RecentConnections
                    mode="tcp-server" recent={recent}
                    onLoad={(h, p) => { setHost(h); setPort(p); }}
                    onRemove={removeRecent}
                  />
                ) : null}
              </div>
            </ProtocolSidebarSection>
            {clients.length > 0 && (
              <ClientList
                clients={clients}
                selectedClientId={selectedClientId}
                onSelectClient={setSelectedClientId}
                compact={compact}
              />
            )}
          </>
        }
        compact={compact}
        messages={state.messages}
        selectedMessageId={state.selectedMessageId}
        onSelectMessage={(message) => state.setSelectedMessageId(message.id)}
        onClearMessages={() => { state.setMessages([]); state.resetStats(); }}
        displayFormat={state.displayFormat}
        setDisplayFormat={state.setDisplayFormat}
        connected={running}
        statusText={running ? `${host}:${port} ${t('tcp.system.listening')} · ${t('tcp.clientList.connections', { count: clients.length })}` : starting ? t('tcp.system.startingServer') : t('tcp.system.waitingServer')}
        stats={state.stats}
        sendPanel={(
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
            layout="sidebar"
            compact={compact}
          />
        )}
      />
      {!compact ? (
        <StatsBar
          stats={state.stats}
          connected={running}
          statusText={running ? `${host}:${port} · ${clients.length} ${t('tcp.clientList.clients', '客户端')}` : starting ? t('tcp.system.startingServer') : t('tcp.system.idle', '空闲')}
          connectedSince={connectedSince}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Client Panel — 上下分栏
// ═══════════════════════════════════════════

function UdpClientPanel({
  sessionKey,
  compact = false,
  pairTargetAddr,
}: {
  sessionKey: string;
  compact?: boolean;
  pairTargetAddr?: string;
}) {
  const { t } = useTranslation();
  const socketId = useRef(`udp-client:${sessionKey}`).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9001);
  const [targetAddr, setTargetAddr] = useState(pairTargetAddr ?? "127.0.0.1:9000");
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoTargetRef = useRef(pairTargetAddr ?? "127.0.0.1:9000");
  const targetCustomizedRef = useRef(false);
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("udp-client");

  useEffect(() => {
    if (!pairTargetAddr) return;
    setTargetAddr((current) => {
      const shouldSync = !targetCustomizedRef.current || current === autoTargetRef.current;
      autoTargetRef.current = pairTargetAddr;
      return shouldSync ? pairTargetAddr : current;
    });
  }, [pairTargetAddr]);

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
      await svc.udpSendTo(socketId, data, targetAddr, svc.normalizeSendEncoding(state.sendFormat));
      state.addMessage(createSentMessage(data, state.sendFormat, { remoteAddr: targetAddr }));
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTargetChange = (value: string) => {
    targetCustomizedRef.current = !!pairTargetAddr && value !== pairTargetAddr;
    if (!value.trim()) {
      targetCustomizedRef.current = false;
    }
    setTargetAddr(value);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProtocolWorkbench
        sidebar={
          <ProtocolSidebarSection
            title={t('tcp.sidebar.connection', '连接设置')}
            description={t('tcp.sidebar.udpClientDesc', '先绑定本地地址，再配置默认目标地址用于快速发包。')}
            compact={compact}
            showDescriptionInCompact={compact}
          >
            <div className="space-y-3">
              <ConnectionBar
                mode="udp-client" host={host} port={port}
                connected={bound} connecting={binding}
                onHostChange={setHost} onPortChange={setPort}
                onToggle={handleBind}
                compact={compact}
              />
              {!compact ? (
                <RecentConnections
                  mode="udp-client"
                  recent={recent}
                  onLoad={(h, p) => { setHost(h); setPort(p); }}
                  onRemove={removeRecent}
                />
              ) : null}
              <AddressField
                label={t('tcp.targetAddress')}
                value={targetAddr}
                onChange={handleTargetChange}
                placeholder={t('tcp.targetAddrPlaceholder')}
              />
            </div>
          </ProtocolSidebarSection>
        }
        compact={compact}
        messages={state.messages}
        selectedMessageId={state.selectedMessageId}
        onSelectMessage={(message) => state.setSelectedMessageId(message.id)}
        onClearMessages={() => { state.setMessages([]); state.resetStats(); }}
        displayFormat={state.displayFormat}
        setDisplayFormat={state.setDisplayFormat}
        connected={bound}
        statusText={bound ? `${host}:${port} ${t('tcp.system.bound')} · ${t('tcp.targetAddress')} ${targetAddr}` : binding ? t('tcp.system.bindingUdp') : t('tcp.system.waitingUdp')}
        stats={state.stats}
        sendPanel={(
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
            layout="sidebar"
            compact={compact}
          />
        )}
      />
      {!compact ? (
        <StatsBar
          stats={state.stats}
          connected={bound}
          statusText={bound ? `${host}:${port}` : binding ? t('tcp.system.bindingUdp') : t('tcp.system.idle', '空闲')}
          connectedSince={connectedSince}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════
//  UDP Server Panel — 上下分栏
// ═══════════════════════════════════════════

function UdpServerPanel({
  sessionKey,
  compact = false,
  onTargetChange,
}: {
  sessionKey: string;
  compact?: boolean;
  onTargetChange?: (targetAddr: string) => void;
}) {
  const { t } = useTranslation();
  const socketId = useRef(`udp-server:${sessionKey}`).current;
  const state = useSocketState();
  const [bound, setBound] = useState(false);
  const [binding, setBinding] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState(9000);
  const [replyAddr, setReplyAddr] = useState("");
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { recent, save: saveRecent, remove: removeRecent } = useRecentConns("udp-server");

  useEffect(() => {
    onTargetChange?.(`${normalizeUdpLoopbackHost(host)}:${port}`);
  }, [host, onTargetChange, port]);

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
      await svc.udpSendTo(socketId, data, replyAddr, svc.normalizeSendEncoding(state.sendFormat));
      state.addMessage(createSentMessage(data, state.sendFormat, { remoteAddr: replyAddr }));
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('tcp.system.sendFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProtocolWorkbench
        sidebar={
          <ProtocolSidebarSection
            title={t('tcp.sidebar.connection', '连接设置')}
            description={t('tcp.sidebar.udpServerDesc', '监听入站数据并维护当前回复地址，便于快速回包。')}
            compact={compact}
            showDescriptionInCompact={compact}
          >
            <div className="space-y-3">
              <ConnectionBar
                mode="udp-server" host={host} port={port}
                connected={bound} connecting={binding}
                onHostChange={setHost} onPortChange={setPort}
                onToggle={handleBind}
                compact={compact}
              />
              {!compact ? (
                <RecentConnections
                  mode="udp-server"
                  recent={recent}
                  onLoad={(h, p) => { setHost(h); setPort(p); }}
                  onRemove={removeRecent}
                />
              ) : null}
              {bound && (
                <AddressField
                  label={t('tcp.replyAddress')}
                  value={replyAddr}
                  onChange={setReplyAddr}
                  placeholder={t('tcp.replyAddrPlaceholder')}
                />
              )}
            </div>
          </ProtocolSidebarSection>
        }
        compact={compact}
        messages={state.messages}
        selectedMessageId={state.selectedMessageId}
        onSelectMessage={(message) => state.setSelectedMessageId(message.id)}
        onClearMessages={() => { state.setMessages([]); state.resetStats(); }}
        displayFormat={state.displayFormat}
        setDisplayFormat={state.setDisplayFormat}
        connected={bound}
        statusText={bound ? `${host}:${port} ${t('tcp.system.listening')} · ${t('tcp.replyAddress')} ${replyAddr || t('tcp.system.waitingSource')}` : binding ? t('tcp.system.bindingUdpServer') : t('tcp.system.waitingUdpServer')}
        stats={state.stats}
        sendPanel={(
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
            layout="sidebar"
            compact={compact}
          />
        )}
      />
      {!compact ? (
        <StatsBar
          stats={state.stats}
          connected={bound}
          statusText={bound ? `${host}:${port}` : binding ? t('tcp.system.bindingUdpServer') : t('tcp.system.idle', '空闲')}
          connectedSince={connectedSince}
        />
      ) : null}
    </div>
  );
}
