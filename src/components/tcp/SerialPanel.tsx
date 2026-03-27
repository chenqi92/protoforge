// 串口调试面板 — 独立完整的串口通信工作区
import { useState, useEffect, useRef, useCallback } from "react";
import { Usb, RefreshCw, X, History, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MessageLog } from "./MessageLog";
import { SendPanel } from "./SendPanel";
import { StatsBar } from "./StatsBar";
import * as svc from "@/services/serialService";
import { asciiToHex } from "@/services/tcpService";
import { useActivityLogStore } from "@/stores/activityLogStore";
import type { TcpMessage, DataFormat, ConnectionStats, SendHistoryItem, QuickCommand } from "@/types/tcp";
import type {
  SerialPortInfo, SerialPortConfig, SerialEvent, RecentSerialConfig,
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
  const [sendFormat, setSendFormat] = useState<DataFormat>("ascii");
  const [displayFormat, setDisplayFormat] = useState<DataFormat>("ascii");
  const [sendHistory, setSendHistory] = useState<SendHistoryItem[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);
  const [appendNewline, setAppendNewline] = useState(false);
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
        source: "serial", direction: "sent",
        summary: msg.data.length > 120 ? msg.data.slice(0, 120) + "..." : msg.data,
        rawData: msg.data,
      });
    } else if (msg.direction === "received") {
      setStats((s) => ({ ...s, receivedBytes: s.receivedBytes + msg.size, receivedCount: s.receivedCount + 1 }));
      useActivityLogStore.getState().addEntry({
        source: "serial", direction: "received",
        summary: msg.data.length > 120 ? msg.data.slice(0, 120) + "..." : msg.data,
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
      const normalized = { name: command.name.trim(), data: command.data, format: command.format };
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
//  串口配置栏
// ═══════════════════════════════════════════

interface SerialConnectionBarProps {
  portName: string;
  config: SerialPortConfig;
  ports: SerialPortInfo[];
  loadingPorts: boolean;
  open: boolean;
  opening: boolean;
  onPortNameChange: (v: string) => void;
  onConfigChange: (c: Partial<SerialPortConfig>) => void;
  onRefreshPorts: () => void;
  onToggle: () => void;
}

function SerialConnectionBar({
  portName, config, ports, loadingPorts, open, opening,
  onPortNameChange, onConfigChange, onRefreshPorts, onToggle,
}: SerialConnectionBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: port selector + open/close */}
      <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
        <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[var(--fs-xs)] font-semibold text-white shadow-sm bg-amber-500">
          <Usb className="w-3.5 h-3.5" />
          <span>Serial</span>
        </div>

        <div className="relative flex-1 min-w-0">
          <select
            value={portName}
            onChange={(e) => onPortNameChange(e.target.value)}
            disabled={open}
            className="h-7 w-full appearance-none bg-transparent pl-2 pr-6 text-[var(--fs-sm)] font-mono text-text-primary outline-none disabled:opacity-60 cursor-pointer"
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
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 transition-colors"
          title={t('serial.refresh', '刷新串口列表')}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loadingPorts && "animate-spin")} />
        </button>

        <button
          onClick={onToggle}
          disabled={opening || (!portName && !open)}
          className={cn(
            "wb-primary-btn min-w-[80px] px-3",
            open
              ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
              : opening
                ? "bg-amber-500 cursor-wait opacity-70"
                : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 hover:shadow-md"
          )}
        >
          {open ? <X className="w-3.5 h-3.5" /> : <Usb className="w-3.5 h-3.5" />}
          {open ? t('serial.close', '关闭') : opening ? t('serial.opening', '打开中...') : t('serial.open', '打开')}
        </button>
      </div>

      {/* Row 2: baud rate + data bits + stop bits + parity + flow control */}
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/40 px-3 py-1.5 flex-wrap">
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
      <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "appearance-none bg-transparent pr-4 pl-1 text-[var(--fs-xs)] font-mono text-text-secondary outline-none disabled:opacity-50 cursor-pointer",
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
        <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide">
          {t('serial.recentConfigs', '最近')}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {recent.map((r, i) => (
          <div
            key={i}
            className="group flex items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40"
          >
            <button
              onClick={() => onLoad(r)}
              className="h-[22px] px-2 text-[var(--fs-xxs)] font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors"
            >
              {r.portName} · {r.config.baudRate}
            </button>
            <button
              onClick={() => onRemove(r)}
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

export function SerialPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const portId = useRef(`serial:${sessionKey}`).current;
  const state = useSerialState();

  const [portName, setPortName] = useState("");
  const [config, setConfig] = useState<SerialPortConfig>({ ...DEFAULT_SERIAL_CONFIG });
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [connectedSince, setConnectedSince] = useState<string | undefined>();
  const [recentConfigs, setRecentConfigs] = useState<RecentSerialConfig[]>(loadRecentConfigs);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 初始化：枚举串口 ──
  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const list = await svc.serialListPorts();
      setPorts(list);
      // 如果当前选中的端口不在列表中，清空选择
      if (portName && !list.some((p) => p.portName === portName)) {
        setPortName("");
      }
    } catch {
      // 不强制报错，端口列表刷新是辅助功能
    } finally {
      setLoadingPorts(false);
    }
  }, [portName]);

  useEffect(() => { refreshPorts(); }, []);

  // ── 事件监听 ──
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await svc.onSerialEvent((event: SerialEvent) => {
        if (event.portId !== portId) return;
        switch (event.eventType) {
          case "opened":
            setOpen(true);
            setOpening(false);
            setConnectedSince(new Date().toISOString());
            state.systemMessage(`[OK] ${t('serial.system.opened', '串口已打开')} ${portName}`);
            break;
          case "data":
            state.addMessage({
              id: crypto.randomUUID(), direction: "received",
              data: event.data || "", rawHex: event.rawHex || "",
              encoding: "utf8", timestamp: event.timestamp, size: event.size || 0,
            });
            break;
          case "closed":
            setOpen(false);
            setOpening(false);
            setConnectedSince(undefined);
            state.systemMessage(`[CLOSED] ${t('serial.system.closed', '串口已关闭')}`);
            break;
          case "error":
            setOpen(false);
            setOpening(false);
            setConnectedSince(undefined);
            state.systemMessage(`[WARN] ${t('serial.system.error', '错误')}: ${event.data}`);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => { disposed = true; unlisten?.(); };
  }, [portId, state.addMessage, state.systemMessage, portName, t]);

  // ── 定时发送 ──
  useEffect(() => {
    if (state.timerEnabled && open && state.message.trim()) {
      timerRef.current = setInterval(() => handleSend(), state.timerInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.timerEnabled, open, state.timerInterval, state.message, state.sendFormat]);

  // ── 打开 / 关闭 ──
  const handleToggle = async () => {
    if (open) {
      await svc.serialClose(portId);
      setOpen(false);
      setConnectedSince(undefined);
      state.systemMessage(`[CLOSED] ${t('serial.system.closed', '串口已关闭')}`);
    } else {
      if (!portName) return;
      setOpening(true);
      saveRecentConfig(portName, config);
      setRecentConfigs(loadRecentConfigs());
      try {
        await svc.serialOpen(portId, portName, config);
      } catch (err: unknown) {
        setOpening(false);
        state.systemMessage(`[WARN] ${t('serial.system.openFailed', '打开失败')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // ── 发送数据 ──
  const handleSend = async () => {
    if (!open || !state.message.trim()) return;
    const data = state.appendNewline ? state.message + "\n" : state.message;
    try {
      await svc.serialSend(portId, data, state.sendFormat);
      const size = new TextEncoder().encode(data).length;
      state.addMessage({
        id: crypto.randomUUID(), direction: "sent",
        data, rawHex: asciiToHex(data), encoding: "utf8",
        timestamp: new Date().toISOString(), size,
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
      <div className="shrink-0 space-y-2 pb-3">
        <SerialConnectionBar
          portName={portName}
          config={config}
          ports={ports}
          loadingPorts={loadingPorts}
          open={open}
          opening={opening}
          onPortNameChange={setPortName}
          onConfigChange={(partial) => setConfig((c) => ({ ...c, ...partial }))}
          onRefreshPorts={refreshPorts}
          onToggle={handleToggle}
        />
        <div className="px-0.5">
          <RecentSerialConfigs
            recent={recentConfigs}
            onLoad={handleLoadRecent}
            onRemove={handleRemoveRecent}
          />
        </div>
      </div>

      <div className="wb-workbench-stack min-h-0 flex-1">
        <MessageLog
          messages={state.messages}
          onClear={() => { state.setMessages([]); state.resetStats(); }}
          displayFormat={state.displayFormat}
          setDisplayFormat={state.setDisplayFormat}
          connected={open}
          statusText={statusText}
          stats={state.stats}
          embedded
        />
        <SendPanel
          message={state.message} setMessage={state.setMessage}
          sendFormat={state.sendFormat} setSendFormat={state.setSendFormat}
          connected={open} onSend={handleSend}
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
          appendNewline={state.appendNewline}
          onAppendNewlineChange={state.setAppendNewline}
          embedded
        />
      </div>
      <StatsBar
        stats={state.stats}
        connected={open}
        statusText={statusText}
        connectedSince={connectedSince}
      />
    </div>
  );
}
