// 串口调试面板 — 独立完整的串口通信工作区
import { useState, useEffect, useRef, useCallback } from "react";
import { Usb, RefreshCw, X, History, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SendPanel } from "./SendPanel";
import { ProtocolSidebarSection, ProtocolWorkbench } from "./ProtocolWorkbench";
import { StatsBar } from "./StatsBar";
import * as svc from "@/services/serialService";
import { estimateRawHex, measurePayloadSize, normalizeSendEncoding } from "@/services/tcpService";
import { useActivityLogStore } from "@/stores/activityLogStore";
import type { TcpMessage, DataFormat, ConnectionStats, SendHistoryItem, QuickCommand } from "@/types/tcp";
import { LineEnding, LINE_ENDING_MAP } from "@/types/tcp";
import { isConnectionRegistered, registerConnection, unregisterConnection } from '@/lib/connectionRegistry';
import type {
  SerialPortInfo, SerialPortConfig, SerialConnectionStatus, SerialEvent, RecentSerialConfig, SerialSignals,
} from "@/types/serial";
import {
  BAUD_RATES, DATA_BITS_OPTIONS, STOP_BITS_OPTIONS, DEFAULT_SERIAL_CONFIG,
} from "@/types/serial";


// ═══════════════════════════════════════════
//  最近串口配置 — localStorage
// ═══════════════════════════════════════════

const RC_KEY = "pf:recent-serial-configs";
const MAX_RECENT = 6;

function loadRecentConfigs(): RecentSerialConfig[] {
  try { return JSON.parse(localStorage.getItem(RC_KEY) || "[]"); } catch { return []; }
}

function saveRecentConfig(portName: string, config: SerialPortConfig) {
  const list = loadRecentConfigs().filter(
    (r) => !(r.portName === portName && r.config.baudRate === config.baudRate)
  );
  localStorage.setItem(RC_KEY, JSON.stringify([{ portName, config }, ...list].slice(0, MAX_RECENT)));
}

// ═══════════════════════════════════════════
//  共用 Hook — 消息管理 & 统计
// ═══════════════════════════════════════════

function useSerialState() {
  const [messages, setMessages] = useState<TcpMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sendFormat, setSendFormat] = useState<DataFormat>("text");
  const [displayFormat, setDisplayFormat] = useState<DataFormat>("auto");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [sendHistory, setSendHistory] = useState<SendHistoryItem[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);
  const [lineEnding, setLineEnding] = useState<LineEnding>('none');
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerInterval, setTimerInterval] = useState(1000);
  const [stats, setStats] = useState<ConnectionStats>({ sentBytes: 0, receivedBytes: 0, sentCount: 0, receivedCount: 0 });

  const addMessage = useCallback((
    msg: TcpMessage,
    options?: { recordActivity?: boolean },
  ) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      return next.length > 5000 ? next.slice(-5000) : next;
    });
    if (msg.direction === "sent") {
      setStats((s) => ({ ...s, sentBytes: s.sentBytes + msg.size, sentCount: s.sentCount + 1 }));
      if (options?.recordActivity !== false) {
        useActivityLogStore.getState().addEntry({
          source: "serial", direction: "sent",
          summary: msg.data.length > 120 ? msg.data.slice(0, 120) + "..." : msg.data,
          rawData: msg.data,
        });
      }
    } else if (msg.direction === "received") {
      setStats((s) => ({ ...s, receivedBytes: s.receivedBytes + msg.size, receivedCount: s.receivedCount + 1 }));
      if (options?.recordActivity !== false) {
        useActivityLogStore.getState().addEntry({
          source: "serial", direction: "received",
          summary: msg.data.length > 120 ? msg.data.slice(0, 120) + "..." : msg.data,
          rawData: msg.data,
        });
      }
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
      const normalized = { name: command.name.trim(), data: command.data, format: command.format };
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
    lineEnding, setLineEnding,
    timerEnabled, setTimerEnabled,
    timerInterval, setTimerInterval, stats, setStats,
    addMessage, addToHistory, systemMessage, resetStats, saveQuickCommand,
  };
}

// ═══════════════════════════════════════════
//  串口配置栏
// ═══════════════════════════════════════════

interface SerialConnectionBarProps {
  portName: string;
  config: SerialPortConfig;
  ports: SerialPortInfo[];
  loadingPorts: boolean;
  listenerReady: boolean;
  open: boolean;
  opening: boolean;
  onPortNameChange: (v: string) => void;
  onConfigChange: (c: Partial<SerialPortConfig>) => void;
  onRefreshPorts: () => void;
  onToggle: () => void;
}

function SerialConnectionBar({
  portName, config, ports, loadingPorts, listenerReady, open, opening,
  onPortNameChange, onConfigChange, onRefreshPorts, onToggle,
}: SerialConnectionBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: port selector + open/close */}
      <div className="flex min-h-[38px] items-center gap-2 pf-rounded-md border border-border-default/80 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
        <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 pf-rounded-sm px-3 pf-text-xs font-semibold text-white shadow-sm bg-accent">
          <Usb className="w-3.5 h-3.5" />
          <span>Serial</span>
        </div>

        <div className="relative flex-1 min-w-0">
          <select
            value={portName}
            onChange={(e) => onPortNameChange(e.target.value)}
            disabled={open}
            className="h-7 w-full appearance-none bg-transparent pl-2 pr-6 pf-text-sm font-mono text-text-primary outline-none disabled:opacity-60 cursor-pointer"
          >
            <option value="">{t('serial.selectPort', '选择串口')}</option>
            {ports.map((p) => (
              <option key={p.portName} value={p.portName}>
                {p.portName}{p.description ? ` — ${p.description}` : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
        </div>

        <button
          onClick={onRefreshPorts}
          disabled={open || loadingPorts}
          className="flex h-7 w-7 shrink-0 items-center justify-center pf-rounded-sm text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50 transition-colors"
          title={t('serial.refresh', '刷新串口列表')}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loadingPorts && "animate-spin")} />
        </button>

        <button
          onClick={onToggle}
          disabled={!listenerReady || opening || (!portName && !open)}
          className={cn(
            "wb-primary-btn min-w-[80px] px-3",
            open
              ? "bg-error hover:bg-error/90 hover:shadow-md"
              : opening
                ? "bg-warning cursor-wait opacity-70"
                : "bg-accent hover:bg-accent-hover hover:shadow-md"
          )}
        >
          {open ? <X className="w-3.5 h-3.5" /> : <Usb className="w-3.5 h-3.5" />}
          {open ? t('serial.close', '关闭') : opening ? t('serial.opening', '打开中...') : t('serial.open', '打开')}
        </button>
      </div>

      {/* Row 2: baud rate + data bits + stop bits + parity + flow control */}
      <div className="flex items-center gap-2 pf-rounded-md border border-border-default/60 bg-bg-secondary/40 px-3 py-1.5 flex-wrap">
        <ConfigSelect
          label={t('serial.baudRate', '波特率')}
          value={String(config.baudRate)}
          onChange={(v) => onConfigChange({ baudRate: Number(v) as SerialPortConfig["baudRate"] })}
          disabled={open}
          options={BAUD_RATES.map((r) => ({ value: String(r), label: String(r) }))}
          width="w-[88px]"
        />
        <ConfigDivider />
        <ConfigSelect
          label={t('serial.dataBits', '数据位')}
          value={String(config.dataBits)}
          onChange={(v) => onConfigChange({ dataBits: Number(v) as SerialPortConfig["dataBits"] })}
          disabled={open}
          options={DATA_BITS_OPTIONS.map((b) => ({ value: String(b), label: String(b) }))}
          width="w-[56px]"
        />
        <ConfigDivider />
        <ConfigSelect
          label={t('serial.stopBits', '停止位')}
          value={String(config.stopBits)}
          onChange={(v) => onConfigChange({ stopBits: Number(v) as SerialPortConfig["stopBits"] })}
          disabled={open}
          options={STOP_BITS_OPTIONS.map((b) => ({ value: String(b), label: String(b) }))}
          width="w-[56px]"
        />
        <ConfigDivider />
        <ConfigSelect
          label={t('serial.parity', '校验位')}
          value={config.parity}
          onChange={(v) => onConfigChange({ parity: v as SerialPortConfig["parity"] })}
          disabled={open}
          options={[
            { value: "none",  label: t('serial.parityNone', '无') },
            { value: "even",  label: t('serial.parityEven', '偶') },
            { value: "odd",   label: t('serial.parityOdd', '奇') },
          ]}
          width="w-[60px]"
        />
        <ConfigDivider />
        <ConfigSelect
          label={t('serial.flowControl', '流控')}
          value={config.flowControl}
          onChange={(v) => onConfigChange({ flowControl: v as SerialPortConfig["flowControl"] })}
          disabled={open}
          options={[
            { value: "none",     label: t('serial.flowNone', '无') },
            { value: "software", label: "XON/XOFF" },
            { value: "hardware", label: "RTS/CTS" },
          ]}
          width="w-[88px]"
        />
      </div>
    </div>
  );
}

function ConfigDivider() {
  return <div className="h-4 w-px shrink-0 bg-border-default/60" />;
}

function ConfigSelect({
  label, value, onChange, options, disabled, width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled: boolean;
  width: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "appearance-none bg-transparent pr-4 pl-1 pf-text-xs font-mono text-text-secondary outline-none disabled:opacity-50 cursor-pointer",
            width
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  最近配置列表
// ═══════════════════════════════════════════

function RecentSerialConfigs({
  recent, onLoad, onRemove,
}: {
  recent: RecentSerialConfig[];
  onLoad: (r: RecentSerialConfig) => void;
  onRemove: (r: RecentSerialConfig) => void;
}) {
  const { t } = useTranslation();
  if (recent.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap px-0.5">
      <div className="flex items-center gap-1 text-text-disabled shrink-0">
        <History className="w-3 h-3" />
        <span className="pf-text-xxs font-semibold uppercase tracking-wide">
          {t('serial.recentConfigs', '最近')}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {recent.map((r, i) => (
          <div
            key={i}
            className="group flex items-center pf-rounded-sm border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40"
          >
            <button
              onClick={() => onLoad(r)}
              className="h-[22px] px-2 pf-text-xxs font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors"
            >
              {r.portName} · {r.config.baudRate}
            </button>
            <button
              onClick={() => onRemove(r)}
              aria-label={t('common.delete')}
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

// ═══════════════════════════════════════════
//  SerialPanel 主体
// ═══════════════════════════════════════════

const MAX_PENDING_SERIAL_GENERATIONS = 4;
const MAX_PENDING_SERIAL_EVENTS_PER_GENERATION = 256;
const MAX_PENDING_SERIAL_BYTES_PER_GENERATION = 1024 * 1024;

interface PendingSerialDataBuffer {
  events: Array<{ event: SerialEvent; recordActivity: boolean }>;
  bytes: number;
  dropped: number;
}

function serialEventByteSize(event: SerialEvent): number {
  const payloadBytes = event.rawHex
    ? Math.ceil(event.rawHex.replace(/\s/g, "").length / 2)
    : new TextEncoder().encode(event.data ?? "").byteLength;
  const declaredBytes = event.size !== undefined && Number.isFinite(event.size)
    ? Math.max(0, Math.trunc(event.size))
    : 0;
  return Math.max(payloadBytes, declaredBytes);
}

export function SerialPanel({ sessionKey }: { sessionKey: string; compact?: boolean }) {
  const { t } = useTranslation();
  const portId = useRef(`serial:${sessionKey}`).current;
  const serialConsumerId = useRef(`serial-consumer:${crypto.randomUUID()}`).current;
  const state = useSerialState();

  const [portName, setPortName] = useState("");
  const [config, setConfig] = useState<SerialPortConfig>({ ...DEFAULT_SERIAL_CONFIG });
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [open, setOpen] = useState(() => isConnectionRegistered(sessionKey, portId));
  const [opening, setOpening] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [generationReady, setGenerationReady] = useState(false);
  const [recoveryRequest, setRecoveryRequest] = useState(0);
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const [recentConfigs, setRecentConfigs] = useState<RecentSerialConfig[]>(loadRecentConfigs);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentGenerationRef = useRef<string | null>(null);
  const retiredGenerationsRef = useRef(new Set<string>());
  const mismatchedGenerationsRef = useRef(new Set<string>());
  const latestObservedGenerationRef = useRef<string | null>(null);
  const pendingDataByGenerationRef = useRef(new Map<string, PendingSerialDataBuffer>());
  const initialRecoveryPendingRef = useRef(true);
  const liveGenerationEventEpochRef = useRef(0);
  const listenerReadyRef = useRef(false);
  const generationReadyRef = useRef(false);
  const lifecycleEpochRef = useRef(0);
  const signalsEpochRef = useRef(0);
  const dtrEpochRef = useRef(0);
  const rtsEpochRef = useRef(0);
  const desiredDtrRef = useRef(false);
  const desiredRtsRef = useRef(false);
  const dtrPendingRef = useRef(false);
  const rtsPendingRef = useRef(false);
  const portNameRef = useRef(portName);
  portNameRef.current = portName;

  // ── DTR/RTS 信号控制 ──
  const [dtr, setDtr] = useState(false);
  const [rts, setRts] = useState(false);
  const [dtrBusy, setDtrBusy] = useState(false);
  const [rtsBusy, setRtsBusy] = useState(false);

  // ── CTS/DSR/RI/CD 信号状态 ──
  const [signals, setSignals] = useState<SerialSignals>({ cts: false, dsr: false, ri: false, cd: false });

  const appendReceivedEvent = useCallback((
    event: SerialEvent,
    recordActivity: boolean,
  ) => {
    state.addMessage({
      id: crypto.randomUUID(),
      direction: "received",
      data: event.data || "",
      rawHex: event.rawHex || "",
      encoding: "utf8",
      timestamp: event.timestamp,
      size: event.size || 0,
    }, { recordActivity });
  }, [state.addMessage]);

  const bufferReceivedEvent = useCallback((
    event: SerialEvent,
    recordActivity: boolean,
  ) => {
    const buffers = pendingDataByGenerationRef.current;
    let buffer = buffers.get(event.generation);
    if (!buffer) {
      if (buffers.size >= MAX_PENDING_SERIAL_GENERATIONS) {
        const oldestGeneration = buffers.keys().next().value;
        if (oldestGeneration !== undefined) buffers.delete(oldestGeneration);
      }
      buffer = { events: [], bytes: 0, dropped: 0 };
      buffers.set(event.generation, buffer);
    }

    const eventBytes = serialEventByteSize(event);
    if (
      buffer.events.length >= MAX_PENDING_SERIAL_EVENTS_PER_GENERATION
      || eventBytes > MAX_PENDING_SERIAL_BYTES_PER_GENERATION
      || buffer.bytes + eventBytes > MAX_PENDING_SERIAL_BYTES_PER_GENERATION
    ) {
      buffer.dropped += 1;
      return;
    }
    buffer.events.push({ event, recordActivity });
    buffer.bytes += eventBytes;
  }, []);

  const flushReceivedEvents = useCallback((generation: string) => {
    const buffer = pendingDataByGenerationRef.current.get(generation);
    pendingDataByGenerationRef.current.delete(generation);
    if (!buffer) return;
    for (const item of buffer.events) {
      appendReceivedEvent(item.event, item.recordActivity);
    }
    if (buffer.dropped > 0) {
      state.systemMessage(
        `[WARN] ${t("serial.system.bufferOverflow", "串口恢复期间接收缓存已满，已丢弃 {{count}} 个数据包", { count: buffer.dropped })}`,
      );
    }
  }, [appendReceivedEvent, state.systemMessage, t]);

  const discardAllReceivedBuffers = useCallback(() => {
    pendingDataByGenerationRef.current.clear();
  }, []);

  const applyOpenStatus = useCallback((
    status: SerialConnectionStatus,
    expectedSignalsEpoch?: number,
    expectedDtrEpoch?: number,
    expectedRtsEpoch?: number,
  ) => {
    if (!listenerReadyRef.current) {
      initialRecoveryPendingRef.current = true;
      generationReadyRef.current = false;
      setGenerationReady(false);
      return;
    }
    currentGenerationRef.current = status.generation;
    latestObservedGenerationRef.current = status.generation;
    generationReadyRef.current = true;
    setGenerationReady(true);
    retiredGenerationsRef.current.delete(status.generation);
    for (const generation of pendingDataByGenerationRef.current.keys()) {
      if (generation !== status.generation) {
        retiredGenerationsRef.current.add(generation);
        pendingDataByGenerationRef.current.delete(generation);
      }
    }
    for (const generation of mismatchedGenerationsRef.current) {
      if (generation !== status.generation) retiredGenerationsRef.current.add(generation);
    }
    mismatchedGenerationsRef.current.clear();
    setPortName(status.portName);
    setConfig(status.config);
    if (
      expectedDtrEpoch === undefined
      || (!dtrPendingRef.current && dtrEpochRef.current === expectedDtrEpoch)
    ) {
      desiredDtrRef.current = status.dtr;
      setDtr(status.dtr);
    }
    if (
      expectedRtsEpoch === undefined
      || (!rtsPendingRef.current && rtsEpochRef.current === expectedRtsEpoch)
    ) {
      desiredRtsRef.current = status.rts;
      setRts(status.rts);
    }
    if (expectedSignalsEpoch === undefined || signalsEpochRef.current === expectedSignalsEpoch) {
      setSignals(status.signals);
    }
    setConnectedSince(status.connectedSince);
    setOpening(false);
    setOpen(true);
    registerConnection(sessionKey, portId, `Serial ${status.portName}`);
    // Status is the generation authority. Replay only the matching generation,
    // in original delivery order, after it has been confirmed.
    flushReceivedEvents(status.generation);
  }, [flushReceivedEvents, portId, sessionKey]);

  const markControlSessionClosed = useCallback(() => {
    const retiredGeneration = currentGenerationRef.current;
    if (retiredGeneration) retiredGenerationsRef.current.add(retiredGeneration);
    initialRecoveryPendingRef.current = false;
    lifecycleEpochRef.current += 1;
    signalsEpochRef.current += 1;
    dtrEpochRef.current += 1;
    rtsEpochRef.current += 1;
    currentGenerationRef.current = null;
    latestObservedGenerationRef.current = null;
    generationReadyRef.current = false;
    discardAllReceivedBuffers();
    mismatchedGenerationsRef.current.clear();
    dtrPendingRef.current = false;
    rtsPendingRef.current = false;
    desiredDtrRef.current = false;
    desiredRtsRef.current = false;
    setDtrBusy(false);
    setRtsBusy(false);
    setGenerationReady(false);
    setDtr(false);
    setRts(false);
    setSignals({ cts: false, dsr: false, ri: false, cd: false });
    setOpen(false);
    setOpening(false);
    setConnectedSince(undefined);
    unregisterConnection(sessionKey, portId);
  }, [discardAllReceivedBuffers, portId, sessionKey]);

  const adoptReplacementStatus = useCallback((status: SerialConnectionStatus) => {
    const retiredGeneration = currentGenerationRef.current;
    if (retiredGeneration && retiredGeneration !== status.generation) {
      retiredGenerationsRef.current.add(retiredGeneration);
    }
    initialRecoveryPendingRef.current = false;
    lifecycleEpochRef.current += 1;
    signalsEpochRef.current += 1;
    dtrEpochRef.current += 1;
    rtsEpochRef.current += 1;
    dtrPendingRef.current = false;
    rtsPendingRef.current = false;
    setDtrBusy(false);
    setRtsBusy(false);
    applyOpenStatus(status);
  }, [applyOpenStatus]);

  // ── 初始化：枚举串口 ──
  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const list = await svc.serialListPorts();
      setPorts(list);
    } catch {
      // 不强制报错，端口列表刷新是辅助功能
    } finally {
      setLoadingPorts(false);
    }
  }, []);

  useEffect(() => { refreshPorts(); }, []);

  // React remounts and temporarily unavailable IPC must recover from the
  // backend rather than trusting the renderer-only connection registry.
  useEffect(() => {
    if (!listenerReady) return;
    if (!initialRecoveryPendingRef.current && (!open || generationReady)) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const recoveryEpoch = lifecycleEpochRef.current;
    const recoverySignalsEpoch = signalsEpochRef.current;
    const recoveryDtrEpoch = dtrEpochRef.current;
    const recoveryRtsEpoch = rtsEpochRef.current;
    let retryDelay = 50;

    const recover = async () => {
      const requestEventEpoch = liveGenerationEventEpochRef.current;
      try {
        const status = await svc.serialGetStatus(portId);
        if (disposed || lifecycleEpochRef.current !== recoveryEpoch) return;
        const latestObservedGeneration = latestObservedGenerationRef.current;
        if (
          liveGenerationEventEpochRef.current !== requestEventEpoch
          && (
            !status?.open
            || (
              latestObservedGeneration !== null
              && status.generation !== latestObservedGeneration
            )
          )
        ) {
          // The snapshot raced a first event from another generation. Query
          // once more; only that later result may classify buffered data as
          // current or stale.
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void recover();
          }, 0);
          return;
        }
        if (!status?.open) {
          initialRecoveryPendingRef.current = false;
          markControlSessionClosed();
          return;
        }
        initialRecoveryPendingRef.current = false;
        const observedGeneration = currentGenerationRef.current;
        if (observedGeneration && observedGeneration !== status.generation) {
          adoptReplacementStatus(status);
        } else {
          applyOpenStatus(
            status,
            recoverySignalsEpoch,
            recoveryDtrEpoch,
            recoveryRtsEpoch,
          );
        }
      } catch {
        if (disposed || lifecycleEpochRef.current !== recoveryEpoch) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void recover();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 2_000);
      }
    };

    void recover();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [adoptReplacementStatus, applyOpenStatus, generationReady, listenerReady, markControlSessionClosed, open, portId, recoveryRequest]);

  // ── 事件监听 ──
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 100;
    const setup = async () => {
      let listener: () => void;
      try {
        listener = await svc.onSerialEvent(serialConsumerId, portId, (
          event: SerialEvent,
          delivery: svc.SerialEventDelivery,
        ) => {
        if (event.portId !== portId) return;
        if (retiredGenerationsRef.current.has(event.generation)) return;

        if (event.eventType === "opened") {
          const previousGeneration = currentGenerationRef.current;
          if (previousGeneration === event.generation && generationReadyRef.current) {
            // serialOpen may return its authoritative snapshot before the
            // corresponding event reaches this listener.
            return;
          }
          if (previousGeneration && previousGeneration !== event.generation) {
            retiredGenerationsRef.current.add(previousGeneration);
            pendingDataByGenerationRef.current.delete(previousGeneration);
          }
          if (latestObservedGenerationRef.current !== event.generation) {
            latestObservedGenerationRef.current = event.generation;
            liveGenerationEventEpochRef.current += 1;
          }
          initialRecoveryPendingRef.current = true;
          lifecycleEpochRef.current += 1;
          dtrEpochRef.current += 1;
          rtsEpochRef.current += 1;
          currentGenerationRef.current = event.generation;
          generationReadyRef.current = false;
          setGenerationReady(false);
          setRecoveryRequest((value) => value + 1);
          setOpen(true);
          setOpening(false);
          setConnectedSince(event.timestamp);
          dtrPendingRef.current = false;
          rtsPendingRef.current = false;
          setDtrBusy(false);
          setRtsBusy(false);
          desiredDtrRef.current = false;
          desiredRtsRef.current = false;
          setDtr(false);
          setRts(false);
          // Do not reset input signals here: if delivery crosses threads, a
          // same-generation initial signals event may already have arrived.
          state.systemMessage(`[OK] ${t('serial.system.opened', '串口已打开')} ${portNameRef.current}`);
          registerConnection(sessionKey, portId, `Serial ${portNameRef.current}`);
          return;
        }

        const currentGeneration = currentGenerationRef.current;
        if (currentGeneration === null) {
          // On remount the opened event predates this listener. A live event is
          // sufficient to adopt its generation until the status snapshot lands.
          if (event.eventType === "data" || event.eventType === "signals") {
            currentGenerationRef.current = event.generation;
            if (latestObservedGenerationRef.current !== event.generation) {
              latestObservedGenerationRef.current = event.generation;
              liveGenerationEventEpochRef.current += 1;
            }
            initialRecoveryPendingRef.current = true;
            generationReadyRef.current = false;
            setGenerationReady(false);
            setRecoveryRequest((value) => value + 1);
          }
        } else if (event.generation !== currentGeneration) {
          if (event.eventType === "closed" || event.eventType === "error") {
            const invalidatesCandidate = (
              latestObservedGenerationRef.current === event.generation
              || mismatchedGenerationsRef.current.has(event.generation)
              || pendingDataByGenerationRef.current.has(event.generation)
            );
            retiredGenerationsRef.current.add(event.generation);
            mismatchedGenerationsRef.current.delete(event.generation);
            pendingDataByGenerationRef.current.delete(event.generation);
            if (invalidatesCandidate) {
              latestObservedGenerationRef.current = currentGeneration;
              liveGenerationEventEpochRef.current += 1;
              initialRecoveryPendingRef.current = true;
              generationReadyRef.current = false;
              setGenerationReady(false);
              setRecoveryRequest((value) => value + 1);
            }
            return;
          }
          const firstObservation = latestObservedGenerationRef.current !== event.generation;
          const recoveryWasPending = initialRecoveryPendingRef.current;
          mismatchedGenerationsRef.current.add(event.generation);
          if (firstObservation) {
            latestObservedGenerationRef.current = event.generation;
            liveGenerationEventEpochRef.current += 1;
          }
          if (event.eventType === "data") {
            bufferReceivedEvent(event, delivery.recordActivity);
          }
          initialRecoveryPendingRef.current = true;
          generationReadyRef.current = false;
          setGenerationReady(false);
          if (firstObservation || !recoveryWasPending) {
            setRecoveryRequest((value) => value + 1);
          }
          return;
        }

        switch (event.eventType) {
          case "data":
            if (!generationReadyRef.current) {
              bufferReceivedEvent(event, delivery.recordActivity);
              return;
            }
            appendReceivedEvent(event, delivery.recordActivity);
            break;
          case "closed":
            retiredGenerationsRef.current.add(event.generation);
            markControlSessionClosed();
            state.systemMessage(`[CLOSED] ${t('serial.system.closed', '串口已关闭')}`);
            break;
          case "error":
            retiredGenerationsRef.current.add(event.generation);
            markControlSessionClosed();
            state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${event.data}`);
            break;
          case "signals":
            if (event.signals) {
              signalsEpochRef.current += 1;
              setSignals(event.signals);
            }
            break;
        }
        });
      } catch {
        if (disposed) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void setup();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 2_000);
        return;
      }
      if (disposed) { listener(); return; }
      unlisten = listener;
      listenerReadyRef.current = true;
      setListenerReady(true);
      initialRecoveryPendingRef.current = true;
      generationReadyRef.current = false;
      setGenerationReady(false);
      setRecoveryRequest((value) => value + 1);
    };
    void setup();
    return () => {
      disposed = true;
      listenerReadyRef.current = false;
      setListenerReady(false);
      generationReadyRef.current = false;
      setGenerationReady(false);
      if (retryTimer) clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [appendReceivedEvent, bufferReceivedEvent, markControlSessionClosed, portId, serialConsumerId, sessionKey, state.systemMessage, t]);

  // ── 定时发送 ──
  useEffect(() => {
    if (state.timerEnabled && listenerReady && open && generationReady && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, listenerReady, open, generationReady, state.timerInterval, state.message, state.sendFormat, state.lineEnding]);

  // ── 打开 / 关闭 ──
  const handleToggle = async () => {
    if (!listenerReadyRef.current) return;
    if (open) {
      initialRecoveryPendingRef.current = false;
      const actionEpoch = ++lifecycleEpochRef.current;
      const closingGeneration = currentGenerationRef.current;
      try {
        if (closingGeneration) {
          const closed = await svc.serialCloseGeneration(portId, closingGeneration);
          if (!closed) throw new Error(t('serial.sessionReplaced', '串口会话已被替换'));
        } else {
          await svc.serialClose(portId);
        }
        // The closed event normally wins and advances the epoch. This fallback
        // covers listener setup failures without overwriting a newer open.
        if (
          lifecycleEpochRef.current === actionEpoch
          && currentGenerationRef.current === closingGeneration
        ) {
          markControlSessionClosed();
        }
      } catch (err: unknown) {
        state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${err instanceof Error ? err.message : String(err)}`);
        try {
          const status = await svc.serialGetStatus(portId);
          if (lifecycleEpochRef.current === actionEpoch) {
            if (status?.open) {
              if (closingGeneration && status.generation !== closingGeneration) {
                adoptReplacementStatus(status);
              } else {
                dtrEpochRef.current += 1;
                rtsEpochRef.current += 1;
                dtrPendingRef.current = false;
                rtsPendingRef.current = false;
                setDtrBusy(false);
                setRtsBusy(false);
                applyOpenStatus(status);
              }
            } else {
              markControlSessionClosed();
            }
          }
        } catch {
          if (lifecycleEpochRef.current === actionEpoch) {
            dtrEpochRef.current += 1;
            rtsEpochRef.current += 1;
            dtrPendingRef.current = false;
            rtsPendingRef.current = false;
            setDtrBusy(false);
            setRtsBusy(false);
            initialRecoveryPendingRef.current = true;
            generationReadyRef.current = false;
            setGenerationReady(false);
            setRecoveryRequest((value) => value + 1);
          }
        }
      }
    } else {
      if (!portName) return;
      initialRecoveryPendingRef.current = false;
      const actionEpoch = ++lifecycleEpochRef.current;
      const actionSignalsEpoch = signalsEpochRef.current;
      dtrEpochRef.current += 1;
      rtsEpochRef.current += 1;
      dtrPendingRef.current = false;
      rtsPendingRef.current = false;
      setDtrBusy(false);
      setRtsBusy(false);
      generationReadyRef.current = false;
      setGenerationReady(false);
      latestObservedGenerationRef.current = null;
      discardAllReceivedBuffers();
      desiredDtrRef.current = false;
      desiredRtsRef.current = false;
      setOpening(true);
      saveRecentConfig(portName, config);
      setRecentConfigs(loadRecentConfigs());
      try {
        const status = await svc.serialOpen(portId, portName, config);
        // The backend event can be missed while a listener is being replaced
        // during startup. The command returns the same generation snapshot as
        // the event, but only apply it if no newer lifecycle event/action won.
        if (lifecycleEpochRef.current === actionEpoch) {
          if (status.open) {
            applyOpenStatus(status, actionSignalsEpoch);
          } else {
            markControlSessionClosed();
          }
        }
      } catch (err: unknown) {
        if (lifecycleEpochRef.current === actionEpoch) setOpening(false);
        state.systemMessage(`[WARN] ${t('serial.system.openFailed', '打开失败')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // ── DTR/RTS 切换 ──
  const readSerialStatusWithRetry = async (): Promise<SerialConnectionStatus | null | undefined> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await svc.serialGetStatus(portId);
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      }
    }
    return undefined;
  };

  const handleToggleDtr = async () => {
    if (!listenerReadyRef.current || dtrPendingRef.current || !generationReady) return;
    const generation = currentGenerationRef.current;
    if (!generation) return;
    const newVal = !desiredDtrRef.current;
    desiredDtrRef.current = newVal;
    dtrPendingRef.current = true;
    setDtrBusy(true);
    const actionEpoch = ++dtrEpochRef.current;
    const lifecycleEpoch = lifecycleEpochRef.current;
    try {
      await svc.serialSetDtr(portId, generation, newVal);
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const status = await readSerialStatusWithRetry();
    if (
      dtrEpochRef.current !== actionEpoch
      || lifecycleEpochRef.current !== lifecycleEpoch
      || currentGenerationRef.current !== generation
    ) return;

    if (status === undefined) {
      state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${t('serial.statusUnavailable', '无法确认串口控制线状态，正在重新同步')}`);
      let closedExpectedGeneration = false;
      try {
        closedExpectedGeneration = await svc.serialCloseGeneration(portId, generation);
      } catch {
        // Keep the visible session in an unknown state and let the recovery
        // effect retry. Never retire a generation unless close was confirmed.
      }
      if (
        dtrEpochRef.current !== actionEpoch
        || lifecycleEpochRef.current !== lifecycleEpoch
        || currentGenerationRef.current !== generation
      ) return;
      dtrEpochRef.current += 1;
      dtrPendingRef.current = false;
      setDtrBusy(false);
      if (closedExpectedGeneration) {
        markControlSessionClosed();
      } else {
        initialRecoveryPendingRef.current = true;
        generationReadyRef.current = false;
        setGenerationReady(false);
        setRecoveryRequest((value) => value + 1);
      }
      return;
    }

    if (status?.open && status.generation === generation) {
      dtrEpochRef.current += 1;
      dtrPendingRef.current = false;
      setDtrBusy(false);
      desiredDtrRef.current = status.dtr;
      setDtr(status.dtr);
    } else if (status?.open) {
      adoptReplacementStatus(status);
    } else {
      markControlSessionClosed();
    }
  };

  const handleToggleRts = async () => {
    if (!listenerReadyRef.current || rtsPendingRef.current || !generationReady) return;
    const generation = currentGenerationRef.current;
    if (!generation) return;
    const newVal = !desiredRtsRef.current;
    desiredRtsRef.current = newVal;
    rtsPendingRef.current = true;
    setRtsBusy(true);
    const actionEpoch = ++rtsEpochRef.current;
    const lifecycleEpoch = lifecycleEpochRef.current;
    try {
      await svc.serialSetRts(portId, generation, newVal);
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const status = await readSerialStatusWithRetry();
    if (
      rtsEpochRef.current !== actionEpoch
      || lifecycleEpochRef.current !== lifecycleEpoch
      || currentGenerationRef.current !== generation
    ) return;

    if (status === undefined) {
      state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${t('serial.statusUnavailable', '无法确认串口控制线状态，正在重新同步')}`);
      let closedExpectedGeneration = false;
      try {
        closedExpectedGeneration = await svc.serialCloseGeneration(portId, generation);
      } catch {
        // Recovery polling below owns the unknown-state reconciliation.
      }
      if (
        rtsEpochRef.current !== actionEpoch
        || lifecycleEpochRef.current !== lifecycleEpoch
        || currentGenerationRef.current !== generation
      ) return;
      rtsEpochRef.current += 1;
      rtsPendingRef.current = false;
      setRtsBusy(false);
      if (closedExpectedGeneration) {
        markControlSessionClosed();
      } else {
        initialRecoveryPendingRef.current = true;
        generationReadyRef.current = false;
        setGenerationReady(false);
        setRecoveryRequest((value) => value + 1);
      }
      return;
    }

    if (status?.open && status.generation === generation) {
      rtsEpochRef.current += 1;
      rtsPendingRef.current = false;
      setRtsBusy(false);
      desiredRtsRef.current = status.rts;
      setRts(status.rts);
    } else if (status?.open) {
      adoptReplacementStatus(status);
    } else {
      markControlSessionClosed();
    }
  };

  // ── 发送数据 ──
  const handleSend = async () => {
    const generation = currentGenerationRef.current;
    if (
      !listenerReadyRef.current
      || !open
      || !generationReady
      || !generation
      || !state.message.trim()
    ) return;
    const suffix = LINE_ENDING_MAP[state.lineEnding];
    const data = suffix ? state.message + suffix : state.message;
    try {
      await svc.serialSend(portId, generation, data, normalizeSendEncoding(state.sendFormat));
      state.addMessage({
        id: crypto.randomUUID(), direction: "sent",
        data, rawHex: estimateRawHex(data, state.sendFormat),
        encoding: state.sendFormat === "hex" ? "hex" : state.sendFormat === "base64" ? "base64" : state.sendFormat === "gbk" ? "gbk" : "utf8",
        timestamp: new Date().toISOString(), size: measurePayloadSize(data, state.sendFormat),
      });
      state.addToHistory(state.message, state.sendFormat);
      if (!state.timerEnabled) state.setMessage("");
    } catch (err: unknown) {
      state.systemMessage(`[WARN] ${t('serial.system.sendFailed', '发送失败')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleLoadRecent = (r: RecentSerialConfig) => {
    if (open) return;
    setPortName(r.portName);
    setConfig(r.config);
  };

  const handleRemoveRecent = (target: RecentSerialConfig) => {
    const list = loadRecentConfigs().filter(
      (r) => !(r.portName === target.portName && r.config.baudRate === target.config.baudRate)
    );
    localStorage.setItem(RC_KEY, JSON.stringify(list));
    setRecentConfigs(list);
  };

  const statusText = open
    ? `${portName} · ${config.baudRate}`
    : opening
      ? t('serial.opening', '打开中...')
      : t('tcp.system.idle', '空闲');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ProtocolWorkbench
        sidebar={
          <>
            <ProtocolSidebarSection
              title={t('tcp.sidebar.connection', '连接设置')}
              description={t('tcp.sidebar.serialConnectionDesc', '选择串口、配置波特率与数据位，并管理最近的串口配置。')}
              showDescriptionInCompact
            >
              <div className="space-y-3">
                <SerialConnectionBar
                  portName={portName}
                  config={config}
                  ports={ports}
                  loadingPorts={loadingPorts}
                  listenerReady={listenerReady}
                  open={open}
                  opening={opening}
                  onPortNameChange={setPortName}
                  onConfigChange={(partial) => setConfig((c) => ({ ...c, ...partial }))}
                  onRefreshPorts={refreshPorts}
                  onToggle={handleToggle}
                />
                <RecentSerialConfigs
                  recent={recentConfigs}
                  onLoad={handleLoadRecent}
                  onRemove={handleRemoveRecent}
                />
              </div>
            </ProtocolSidebarSection>

            {open && (
              <ProtocolSidebarSection
                title={t('serial.signals', '信号')}
                description={t('tcp.sidebar.serialSignalDesc', '查看 CTS/DSR/RI/CD 状态，并直接切换 DTR/RTS。')}
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={handleToggleDtr}
                      disabled={!listenerReady || !generationReady || dtrBusy}
                      className={cn(
                        "h-[22px] px-2 pf-rounded-xs pf-text-xxs font-semibold uppercase tracking-wide border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        dtr
                          ? "bg-success/15 border-success/40 text-success"
                          : "border-border-default/60 text-text-disabled hover:text-text-secondary hover:border-border-default"
                      )}
                      title="Data Terminal Ready"
                    >
                      DTR
                    </button>
                    <button
                      onClick={handleToggleRts}
                      disabled={!listenerReady || !generationReady || rtsBusy}
                      className={cn(
                        "h-[22px] px-2 pf-rounded-xs pf-text-xxs font-semibold uppercase tracking-wide border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        rts
                          ? "bg-success/15 border-success/40 text-success"
                          : "border-border-default/60 text-text-disabled hover:text-text-secondary hover:border-border-default"
                      )}
                      title="Request To Send"
                    >
                      RTS
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(['cts', 'dsr', 'ri', 'cd'] as const).map((sig) => (
                      <div key={sig} className="flex items-center gap-2 pf-rounded-sm border border-border-default/60 bg-bg-secondary/35 px-2.5 py-2">
                        <span className={cn("pf-dot", signals[sig] ? "s-ok" : "s-idle")} />
                        <span className="pf-text-xxs font-semibold uppercase tracking-wide text-text-secondary">
                          {sig.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </ProtocolSidebarSection>
            )}
          </>
        }
        messages={state.messages}
        selectedMessageId={state.selectedMessageId}
        onSelectMessage={(message) => state.setSelectedMessageId(message.id)}
        onClearMessages={() => { state.setMessages([]); state.resetStats(); }}
        displayFormat={state.displayFormat}
        setDisplayFormat={state.setDisplayFormat}
        connected={open}
        statusText={statusText}
        stats={state.stats}
        sendPanel={(
          <SendPanel
            message={state.message} setMessage={state.setMessage}
            sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
            connected={listenerReady && open && generationReady} onSend={handleSend}
            sendHistory={state.sendHistory}
            onClearHistory={() => state.setSendHistory([])}
            onLoadHistory={(item) => { state.setMessage(item.data); state.setSendFormat(item.format); }}
            quickCommands={state.quickCommands}
            onSaveQuickCommand={state.saveQuickCommand}
            onDeleteQuickCommand={(id) => state.setQuickCommands((prev) => prev.filter((c) => c.id !== id))}
            onLoadQuickCommand={(cmd) => { state.setMessage(cmd.data); state.setSendFormat(cmd.format); }}
            sendTargetLabel={open ? portName : undefined}
            sendTargetHint={open ? `${config.baudRate} ${config.dataBits}${config.parity === "none" ? "N" : config.parity === "even" ? "E" : "O"}${config.stopBits}` : undefined}
            timerEnabled={state.timerEnabled} timerInterval={state.timerInterval}
            onTimerToggle={() => state.setTimerEnabled(!state.timerEnabled)}
            onTimerIntervalChange={(v) => state.setTimerInterval(v)}
            lineEnding={state.lineEnding}
            onLineEndingChange={state.setLineEnding}
            embedded
            layout="sidebar"
          />
        )}
      />
      <StatsBar
        stats={state.stats}
        connected={open}
        statusText={statusText}
        connectedSince={connectedSince}
      />
    </div>
  );
}
