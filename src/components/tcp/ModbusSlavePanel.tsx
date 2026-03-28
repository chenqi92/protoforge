// Modbus 从站 (Slave) 面板 — 模拟 Modbus 设备，自动响应主站请求
import { useState, useEffect, useRef, useCallback } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  Cpu, RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Play, Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import * as mbSvc from "@/services/modbusService";
import * as svcSerial from "@/services/serialService";
import { registerConnection, unregisterConnection } from '@/lib/connectionRegistry';
import { ProtocolSidebarSection } from "./ProtocolWorkbench";
import type {
  SerialPortInfo, SerialPortConfig, ModbusTransport, ModbusSlaveEvent,
} from "@/types/serial";
import { DEFAULT_SERIAL_CONFIG, BAUD_RATES } from "@/types/serial";

// ═══════════════════════════════════════════
//  Register bank tabs
// ═══════════════════════════════════════════

type RegTab = 'holding' | 'coil' | 'discrete' | 'input';

const PAGE_SIZE = 16;
const MAX_ADDR = 65535;

// ── Modbus addressing prefix ──
function addrPrefix(tab: RegTab): string {
  switch (tab) {
    case 'holding': return '4x';
    case 'coil':    return '0x';
    case 'discrete':return '1x';
    case 'input':   return '3x';
  }
}

// ── FC label for request log ──
function fcLabel(fc?: number): string {
  if (fc === undefined) return '—';
  const map: Record<number, string> = {
    1: 'FC01 Read Coils',
    2: 'FC02 Read Discrete Inputs',
    3: 'FC03 Read Holding Registers',
    4: 'FC04 Read Input Registers',
    5: 'FC05 Write Single Coil',
    6: 'FC06 Write Single Register',
    15: 'FC15 Write Multiple Coils',
    16: 'FC16 Write Multiple Registers',
  };
  return map[fc] ?? `FC${fc}`;
}

// ═══════════════════════════════════════════
//  Connection bar (slave variant)
// ═══════════════════════════════════════════

interface SlaveConnectionBarProps {
  transport: ModbusTransport;
  onTransportChange: (t: ModbusTransport) => void;
  host: string;
  port: number;
  onHostChange: (v: string) => void;
  onPortChange: (v: number) => void;
  portName: string;
  serialConfig: SerialPortConfig;
  serialPorts: SerialPortInfo[];
  loadingPorts: boolean;
  onPortNameChange: (v: string) => void;
  onSerialConfigChange: (c: Partial<SerialPortConfig>) => void;
  onRefreshPorts: () => void;
  unitId: number;
  onUnitIdChange: (v: number) => void;
  running: boolean;
  starting: boolean;
  onToggle: () => void;
}

function SlaveConnectionBar({
  transport, onTransportChange,
  host, port, onHostChange, onPortChange,
  portName, serialConfig, serialPorts, loadingPorts,
  onPortNameChange, onSerialConfigChange, onRefreshPorts,
  unitId, onUnitIdChange,
  running, starting, onToggle,
}: SlaveConnectionBarProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 p-1">
          <div className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-violet-600 px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm">
            <Cpu className="h-3.5 w-3.5" />
            <span>Slave</span>
          </div>
          <SegmentedControl
            value={transport}
            onChange={onTransportChange}
            disabled={running}
            size="sm"
            className="flex-1"
            options={[
              { value: 'tcp' as ModbusTransport, label: 'Modbus TCP' },
              { value: 'rtu' as ModbusTransport, label: 'Modbus RTU' },
            ]}
          />
        </div>

        {transport === "tcp" ? (
          <>
            <label className="col-span-2 space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                Host
              </span>
              <input
                value={host}
                onChange={(e) => onHostChange(e.target.value)}
                placeholder="0.0.0.0"
                disabled={running}
                className="wb-field w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                Port
              </span>
              <input
                value={port}
                onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
                placeholder="502"
                type="number"
                disabled={running}
                className="wb-field w-full"
              />
            </label>
          </>
        ) : (
          <>
            <label className="col-span-2 space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('serial.selectPort')}
              </span>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <select
                    value={portName}
                    onChange={(e) => onPortNameChange(e.target.value)}
                    disabled={running}
                    className="wb-field wb-native-select w-full appearance-none pr-8"
                  >
                    <option value="">{t('serial.selectPort')}</option>
                    {serialPorts.map((p) => (
                      <option key={p.portName} value={p.portName}>
                        {p.portName}{p.description ? ` — ${p.description}` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
                </div>
                <button
                  onClick={onRefreshPorts}
                  disabled={running || loadingPorts}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  title={t('serial.refresh')}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingPorts && "animate-spin")} />
                </button>
              </div>
            </label>
            <label className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                Baud
              </span>
              <div className="relative">
                <select
                  value={String(serialConfig.baudRate)}
                  onChange={(e) => onSerialConfigChange({ baudRate: Number(e.target.value) as SerialPortConfig["baudRate"] })}
                  disabled={running}
                  className="wb-field wb-native-select w-full appearance-none pr-8"
                >
                  {BAUD_RATES.map((r) => (
                    <option key={r} value={String(r)}>{r}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
              </div>
            </label>
          </>
        )}

        <label className="space-y-1">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbusslave.unitId', '从站地址')}
          </span>
          <input
            type="number"
            min={1}
            max={247}
            value={unitId}
            onChange={(e) => onUnitIdChange(Math.max(1, Math.min(247, parseInt(e.target.value) || 1)))}
            disabled={running}
            className="wb-field w-full"
          />
        </label>
        <div className="space-y-1">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.transport', '传输')}
          </span>
          <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 px-3 text-[var(--fs-xs)] font-medium text-text-secondary">
            {transport === "tcp"
              ? "TCP Server"
              : `RTU · ${serialConfig.dataBits}${serialConfig.parity === "none" ? "N" : serialConfig.parity === "even" ? "E" : "O"}${serialConfig.stopBits}`}
          </div>
        </div>
      </div>

      <button
        onClick={onToggle}
        disabled={starting || (!running && transport === "tcp" && !host) || (!running && transport === "rtu" && !portName)}
        className={cn(
          "wb-primary-btn h-10 w-full justify-center px-3",
          running
            ? "bg-error hover:bg-error/90 hover:shadow-md"
            : starting
              ? "bg-warning cursor-wait opacity-70"
              : "bg-accent hover:bg-accent-hover hover:shadow-md"
        )}
      >
        {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {starting
          ? t('serial.modbusslave.slaveStarting', '启动中...')
          : running
            ? t('serial.modbusslave.slaveStop', '停止从站')
            : t('serial.modbusslave.slaveStart', '启动从站')}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Main ModbusSlavePanel
// ═══════════════════════════════════════════

export function ModbusSlavePanel({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
  const { t } = useTranslation();

  // ── Connection state ──
  const [transport, setTransport] = useState<ModbusTransport>('tcp');
  const [host, setHost] = useState('0.0.0.0');
  const [port, setPort] = useState(502);
  const [portName, setPortName] = useState('');
  const [serialConfig, setSerialConfig] = useState<SerialPortConfig>(DEFAULT_SERIAL_CONFIG);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [unitId, setUnitId] = useState(1);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);

  // ── Register bank state ──
  // Use Map<address, value> for sparse storage
  const [holdingRegs, setHoldingRegs] = useState<Map<number, number>>(new Map());
  const [coils, setCoils] = useState<Map<number, boolean>>(new Map());
  const [discreteInputs, setDiscreteInputs] = useState<Map<number, boolean>>(new Map());
  const [inputRegs, setInputRegs] = useState<Map<number, number>>(new Map());

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<RegTab>('holding');
  const [page, setPage] = useState(0);

  // ── Request log ──
  const [requestLog, setRequestLog] = useState<ModbusSlaveEvent[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Stats ──
  const [requestCount, setRequestCount] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [uptime, setUptime] = useState('');

  // ── Inline edit state ──
  const [editingAddr, setEditingAddr] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState('');

  const connId = `modbus-slave-${sessionKey}`;

  // ── Refresh serial ports ──
  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const ports = await svcSerial.serialListPorts();
      setSerialPorts(ports);
    } catch {
      // ignore
    } finally {
      setLoadingPorts(false);
    }
  }, []);

  useEffect(() => {
    if (transport === 'rtu') refreshPorts();
  }, [transport, refreshPorts]);

  // ── Uptime ticker ──
  useEffect(() => {
    if (!startedAt) { setUptime(''); return; }
    const tick = () => {
      const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setUptime(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // ── Subscribe to slave events ──
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const fn = await mbSvc.onModbusSlaveEvent((ev) => {
        if (ev.connId !== connId) return;
        if (ev.eventType === 'started') {
          setRunning(true);
          setStarting(false);
          setStartedAt(new Date());
          registerConnection(sessionKey, connId, 'Modbus Slave');
        } else if (ev.eventType === 'stopped') {
          setRunning(false);
          setStartedAt(null);
          unregisterConnection(sessionKey, connId);
        } else if (ev.eventType === 'request') {
          setRequestCount((c) => c + 1);
          setRequestLog((prev) => [...prev.slice(-499), ev]);
          // Auto scroll
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          // If it's a write, update local register state
          if (ev.functionCode !== undefined && ev.values !== undefined && ev.startAddress !== undefined) {
            const fc = ev.functionCode;
            if (fc === 5 || fc === 15) {
              // coil write
              setCoils((prev) => {
                const next = new Map(prev);
                ev.values!.forEach((v, i) => next.set(ev.startAddress! + i, v !== 0));
                return next;
              });
            } else if (fc === 6 || fc === 16) {
              // holding register write
              setHoldingRegs((prev) => {
                const next = new Map(prev);
                ev.values!.forEach((v, i) => next.set(ev.startAddress! + i, v));
                return next;
              });
            }
          }
        } else if (ev.eventType === 'error') {
          setRequestLog((prev) => [...prev.slice(-499), ev]);
        }
      });
      if (disposed) { fn(); return; }
      unlisten = fn;
    };
    setup();
    return () => {
      disposed = true;
      unlisten?.();
      unregisterConnection(sessionKey, connId);
      mbSvc.modbusSlaveStopTcp(connId).catch(() => {});
      mbSvc.modbusSlaveStopRtu(connId).catch(() => {});
    };
  }, [connId]);

  // ── Auto-scroll log ──
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [requestLog]);

  // ── Toggle start/stop ──
  const handleToggle = useCallback(async () => {
    if (running) {
      try {
        unregisterConnection(sessionKey, connId);
        if (transport === 'tcp') await mbSvc.modbusSlaveStopTcp(connId);
        else await mbSvc.modbusSlaveStopRtu(connId);
        setRunning(false);
        setStartedAt(null);
      } catch (err) {
        console.error('Stop slave failed', err);
      }
    } else {
      setStarting(true);
      try {
        if (transport === 'tcp') {
          await mbSvc.modbusSlaveStartTcp(connId, host, port, unitId);
        } else {
          await mbSvc.modbusSlaveStartRtu(connId, portName, serialConfig, unitId);
        }
        // backend will fire 'started' event; we set running/starting there
      } catch (err) {
        setStarting(false);
        setRequestLog((prev) => [
          ...prev,
          {
            connId,
            eventType: 'error',
            timestamp: new Date().toISOString(),
            rawHex: String(err),
          } as ModbusSlaveEvent,
        ]);
      }
    }
  }, [running, transport, connId, host, port, unitId, portName, serialConfig]);

  // ── Page helpers ──
  const pageStart = page * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE - 1;
  const maxPage = Math.floor(MAX_ADDR / PAGE_SIZE);

  const addresses = Array.from({ length: PAGE_SIZE }, (_, i) => pageStart + i);

  // ── Get current bank value ──
  function getHolding(addr: number): number { return holdingRegs.get(addr) ?? 0; }
  function getCoil(addr: number): boolean { return coils.get(addr) ?? false; }
  function getDiscrete(addr: number): boolean { return discreteInputs.get(addr) ?? false; }
  function getInput(addr: number): number { return inputRegs.get(addr) ?? 0; }

  // ── Commit edit ──
  const commitEdit = useCallback(async (addr: number, raw: string) => {
    setEditingAddr(null);
    if (activeTab === 'holding') {
      const v = Math.max(0, Math.min(65535, parseInt(raw) || 0));
      setHoldingRegs((prev) => new Map(prev).set(addr, v));
      if (running) {
        try { await mbSvc.modbusSlaveSetHoldingReg(connId, addr, v); } catch { /* ignore */ }
      }
    } else if (activeTab === 'input') {
      const v = Math.max(0, Math.min(65535, parseInt(raw) || 0));
      setInputRegs((prev) => new Map(prev).set(addr, v));
      if (running) {
        try { await mbSvc.modbusSlaveSetInputReg(connId, addr, v); } catch { /* ignore */ }
      }
    }
  }, [activeTab, connId, running]);

  // ── Toggle coil/discrete ──
  const toggleBool = useCallback(async (addr: number, tab: RegTab) => {
    if (tab === 'coil') {
      const newVal = !getCoil(addr);
      setCoils((prev) => new Map(prev).set(addr, newVal));
      if (running) {
        try { await mbSvc.modbusSlaveSetCoil(connId, addr, newVal); } catch { /* ignore */ }
      }
    } else if (tab === 'discrete') {
      const newVal = !getDiscrete(addr);
      setDiscreteInputs((prev) => new Map(prev).set(addr, newVal));
      if (running) {
        try { await mbSvc.modbusSlaveSetDiscreteInput(connId, addr, newVal); } catch { /* ignore */ }
      }
    }
  }, [coils, discreteInputs, connId, running]);

  // ── Bulk fill ──
  const handleBulkFill = useCallback((action: 'zero' | 'one' | 'increment' | 'random') => {
    if (activeTab === 'holding' || activeTab === 'input') {
      const setter = activeTab === 'holding' ? setHoldingRegs : setInputRegs;
      setter((prev) => {
        const next = new Map(prev);
        addresses.forEach((addr, i) => {
          let v = 0;
          if (action === 'zero') v = 0;
          else if (action === 'one') v = 1;
          else if (action === 'increment') v = i;
          else v = Math.floor(Math.random() * 65536);
          next.set(addr, v);
          if (running) {
            const fn = activeTab === 'holding' ? mbSvc.modbusSlaveSetHoldingReg : mbSvc.modbusSlaveSetInputReg;
            fn(connId, addr, v).catch(() => { /* ignore */ });
          }
        });
        return next;
      });
    } else {
      const setter = activeTab === 'coil' ? setCoils : setDiscreteInputs;
      const ipcFn = activeTab === 'coil' ? mbSvc.modbusSlaveSetCoil : mbSvc.modbusSlaveSetDiscreteInput;
      setter((prev) => {
        const next = new Map(prev);
        addresses.forEach((addr) => {
          let v = false;
          if (action === 'zero') v = false;
          else if (action === 'one') v = true;
          else if (action === 'increment') v = addr % 2 === 0;
          else v = Math.random() > 0.5;
          next.set(addr, v);
          if (running) {
            ipcFn(connId, addr, v).catch(() => { /* ignore */ });
          }
        });
        return next;
      });
    }
  }, [activeTab, addresses, connId, running]);

  const isRegTab = activeTab === 'holding' || activeTab === 'input';

  const TABS: { key: RegTab; labelKey: string }[] = [
    { key: 'holding',  labelKey: 'serial.modbusslave.holdingRegs' },
    { key: 'coil',     labelKey: 'serial.modbusslave.coils' },
    { key: 'discrete', labelKey: 'serial.modbusslave.discreteInputs' },
    { key: 'input',    labelKey: 'serial.modbusslave.inputRegs' },
  ];
  const activeTabMeta = TABS.find((tab) => tab.key === activeTab)!;
  const columnSize = compact ? addresses.length : Math.ceil(addresses.length / 2);
  const addressColumns = Array.from({ length: Math.ceil(addresses.length / columnSize) }, (_, index) =>
    addresses.slice(index * columnSize, (index + 1) * columnSize)
  );

  const renderRegisterRow = (addr: number) => {
    const prefix = addrPrefix(activeTab);
    const addrDisplay = `${prefix}${(addr + 1).toString().padStart(4, '0')}`;
    const val = activeTab === 'holding' ? getHolding(addr) : getInput(addr);
    const isEditable = activeTab === 'holding';
    const isEditing = editingAddr === addr;

    return (
      <tr
        key={addr}
        className={cn(
          "border-b border-border-default/20 transition-colors hover:bg-bg-hover/30",
          !isEditable && "opacity-70"
        )}
      >
        <td className="px-2.5 py-0.5 font-mono text-[var(--fs-3xs)] text-text-tertiary">
          {addrDisplay}
        </td>
        <td className="px-2.5 py-0.5">
          {isEditable ? (
            isEditing ? (
              <input
                autoFocus
                type="number"
                min={0}
                max={65535}
                value={editingVal}
                onChange={(e) => setEditingVal(e.target.value)}
                onBlur={() => commitEdit(addr, editingVal)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(addr, editingVal);
                  if (e.key === 'Escape') setEditingAddr(null);
                }}
                className="h-5 w-[68px] rounded-[var(--radius-xs)] border border-accent/60 bg-accent-soft px-1 text-center text-[var(--fs-xxs)] font-mono text-text-primary outline-none"
              />
            ) : (
              <span
                onClick={() => { setEditingAddr(addr); setEditingVal(String(val)); }}
                className="cursor-text select-none font-mono text-[var(--fs-xxs)] text-text-primary transition-colors hover:text-accent"
              >
                {val}
              </span>
            )
          ) : (
            <span className="font-mono text-[var(--fs-xxs)] text-text-secondary">{val}</span>
          )}
        </td>
        <td className="w-[72px] px-2.5 py-0.5 font-mono text-[var(--fs-3xs)] text-text-tertiary">
          0x{val.toString(16).toUpperCase().padStart(4, '0')}
        </td>
        <td className="w-[118px] px-2.5 py-0.5 font-mono text-[var(--fs-3xs)] tracking-[0.12em] text-text-disabled">
          {val.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim()}
        </td>
      </tr>
    );
  };

  const renderBoolRow = (addr: number) => {
    const prefix = addrPrefix(activeTab);
    const addrDisplay = `${prefix}${(addr + 1).toString().padStart(4, '0')}`;
    const isEditable = activeTab === 'coil' || activeTab === 'discrete';
    const val = activeTab === 'coil' ? getCoil(addr) : getDiscrete(addr);

    return (
      <tr
        key={addr}
        className="border-b border-border-default/20 transition-colors hover:bg-bg-hover/30"
      >
        <td className="px-2.5 py-0.5 font-mono text-[var(--fs-3xs)] text-text-tertiary">
          {addrDisplay}
        </td>
        <td className="px-2.5 py-0.5">
          {isEditable ? (
            <button
              onClick={() => toggleBool(addr, activeTab)}
              className={cn(
                "h-5 min-w-[44px] rounded-[var(--radius-xs)] border px-2 text-[var(--fs-3xs)] font-semibold transition-all",
                val
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "border-border-default/60 bg-bg-secondary/60 text-text-tertiary"
              )}
            >
              {val ? 'ON' : 'OFF'}
            </button>
          ) : (
            <span className={cn(
              "inline-flex h-5 items-center rounded-[var(--radius-xs)] px-2 text-[var(--fs-3xs)] font-semibold",
              val
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "text-text-disabled"
            )}>
              {val ? 'ON' : 'OFF'}
            </span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className={cn("grid min-h-0 flex-1 gap-3", compact ? "xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]" : "xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]")}>
        <div className={cn("min-h-0 overflow-auto", compact ? "pr-0" : "pr-1")}>
          <div className={cn(compact ? "space-y-2.5" : "space-y-3")}>
            <ProtocolSidebarSection
              title={t('serial.modbusslave.sidebarTitle', '从站配置')}
              description={t('serial.modbusslave.sidebarDesc', '先配置 TCP/RTU 与从站地址，再启动从站模拟设备。')}
              compact={compact}
              showDescriptionInCompact={compact}
            >
              <SlaveConnectionBar
                transport={transport}
                onTransportChange={setTransport}
                host={host}
                port={port}
                onHostChange={setHost}
                onPortChange={setPort}
                portName={portName}
                serialConfig={serialConfig}
                serialPorts={serialPorts}
                loadingPorts={loadingPorts}
                onPortNameChange={setPortName}
                onSerialConfigChange={(c) => setSerialConfig((prev) => ({ ...prev, ...c }))}
                onRefreshPorts={refreshPorts}
                unitId={unitId}
                onUnitIdChange={setUnitId}
                running={running}
                starting={starting}
                onToggle={handleToggle}
              />
            </ProtocolSidebarSection>

            <ProtocolSidebarSection
              title={t('serial.modbusslave.browserTitle', '寄存器浏览')}
              description={t('serial.modbusslave.browserDesc', '切换寄存器区、翻页并批量写入当前页的数据。')}
              compact={compact}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {TABS.map(({ key, labelKey }) => (
                    <button
                      key={key}
                      onClick={() => { setActiveTab(key); setEditingAddr(null); }}
                      className={cn(
                        "rounded-[var(--radius-md)] border px-3 py-2 text-left text-[var(--fs-xs)] font-semibold transition-all",
                        activeTab === key
                          ? "border-violet-400/50 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                          : "border-border-default/60 bg-bg-secondary/20 text-text-secondary hover:bg-bg-hover"
                      )}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>

                <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2.5">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.addressRange', '地址范围')}
                  </div>
                  <div className="mt-1 font-mono text-[var(--fs-xs)] font-semibold text-text-secondary">
                    {pageStart.toString(16).padStart(4, '0').toUpperCase()} - {Math.min(pageEnd, MAX_ADDR).toString(16).padStart(4, '0').toUpperCase()}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-primary text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex-1 text-center text-[var(--fs-xxs)] text-text-disabled">
                      {page + 1}/{maxPage + 1}
                    </div>
                    <button
                      onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                      disabled={page === maxPage}
                      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-primary text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.fillAll', '批量填充')}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['zero', t('serial.modbusslave.fillZero', '全部清零')],
                      ['one',  t('serial.modbusslave.fillOne',  '全部置1')],
                      ['increment', t('serial.modbusslave.fillIncrement', '递增填充')],
                      ['random', t('serial.modbusslave.fillRandom', '随机填充')],
                    ] as const).map(([action, label]) => (
                      <button
                        key={action}
                        onClick={() => handleBulkFill(action)}
                        className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2 text-[var(--fs-xs)] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </ProtocolSidebarSection>

            <ProtocolSidebarSection
              title={t('serial.modbusslave.sessionTitle', '会话状态')}
              description={t('serial.modbusslave.statusDesc', '随时查看当前从站状态、活跃寄存器区与请求数量。')}
              compact={compact}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.statusLabel', '状态')}
                  </div>
                  <div className={cn("mt-1 text-[var(--fs-xs)] font-semibold", running ? "text-emerald-600 dark:text-emerald-400" : "text-text-secondary")}>
                    {running ? t('serial.modbusslave.started', '从站已启动') : t('serial.modbusslave.stopped', '从站已停止')}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.unitId', '从站地址')}
                  </div>
                  <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">
                    {unitId}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.requestLog', '请求日志')}
                  </div>
                  <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">
                    {requestCount}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                    {t(activeTabMeta.labelKey)}
                  </div>
                  <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">
                    {addrPrefix(activeTab)} · {pageStart.toString(16).padStart(4, '0').toUpperCase()}
                  </div>
                </div>
                {uptime ? (
                  <div className="col-span-2 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      Uptime
                    </div>
                    <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">{uptime}</div>
                  </div>
                ) : null}
              </div>
            </ProtocolSidebarSection>
          </div>
        </div>

        <div className="min-h-0 h-full overflow-hidden">
          <PanelGroup orientation="vertical">
            <Panel defaultSize={56} minSize={34}>
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-[var(--radius-md)] border border-b-0 border-border-default/75 bg-bg-primary">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default/40 bg-bg-secondary/40 px-3 py-1.5">
                  <div>
                    <div className="text-[var(--fs-xxs)] font-semibold text-text-secondary">
                      {t(activeTabMeta.labelKey)}
                    </div>
                    <div className="mt-0.5 text-[var(--fs-3xs)] text-text-tertiary">
                      {t('serial.modbusslave.addressRange', '地址范围')}: {pageStart.toString(16).padStart(4, '0').toUpperCase()} - {Math.min(pageEnd, MAX_ADDR).toString(16).padStart(4, '0').toUpperCase()}
                    </div>
                  </div>
                  <div className="text-[var(--fs-3xs)] text-text-disabled">
                    {running ? (transport === "tcp" ? `${host}:${port}` : portName || "RTU") : t('serial.modbusslave.stopped', '从站已停止')}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className={cn("grid min-h-full", compact ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
                    {addressColumns.map((column, columnIndex) => (
                      <div
                        key={columnIndex}
                        className={cn("min-w-0", columnIndex > 0 && !compact && "border-l border-border-default/20")}
                      >
                        <table className="w-full text-[var(--fs-xxs)]">
                          <thead className="sticky top-0 z-[1] bg-bg-secondary/80 backdrop-blur-sm">
                            <tr className="border-b border-border-default/40">
                              <th className="w-[82px] px-2.5 py-1 text-left text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                {t('serial.modbusslave.address', '地址')}
                              </th>
                              {isRegTab ? (
                                <>
                                  <th className="px-2.5 py-1 text-left text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    {t('serial.modbusslave.value', '十进制值')}
                                  </th>
                                  <th className="w-[72px] px-2.5 py-1 text-left text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    十六进制
                                  </th>
                                  <th className="w-[118px] px-2.5 py-1 text-left text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    二进制
                                  </th>
                                </>
                              ) : (
                                <th className="px-2.5 py-1 text-left text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                  {t('serial.modbusslave.status', '状态')}
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {column.map((addr) => (isRegTab ? renderRegisterRow(addr) : renderBoolRow(addr)))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="wb-workbench-divider wb-workbench-divider--flush" />

            <Panel defaultSize={44} minSize={18}>
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-b-[var(--radius-md)] border border-t-0 border-border-default/75 bg-bg-primary">
                <div className="flex shrink-0 items-center justify-between border-b border-border-default/40 bg-bg-secondary/40 px-3 py-1.5">
                  <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide text-text-tertiary">
                    {t('serial.modbusslave.requestLog', '请求日志')}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--fs-xxs)] text-text-disabled">
                      {requestCount} {requestCount === 1 ? 'req' : 'reqs'}
                    </span>
                    <button
                      onClick={() => { setRequestLog([]); setRequestCount(0); }}
                      className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      title="清空日志"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[var(--fs-xxs)]">
                  {requestLog.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8 text-text-disabled">
                      {t('serial.modbusslave.noRequests', '暂无请求记录，从站已就绪')}
                    </div>
                  ) : (
                    <div className="py-1">
                      {requestLog.map((ev, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center gap-3 px-3 py-0.5 transition-colors hover:bg-bg-hover/30",
                            ev.eventType === 'error' && "bg-red-500/5 text-red-500"
                          )}
                        >
                          <span className="w-[100px] shrink-0 text-text-disabled">
                            {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          {ev.eventType === 'error' ? (
                            <span className="text-red-500">{ev.rawHex}</span>
                          ) : (
                            <>
                              <span className="w-[180px] shrink-0 font-semibold text-violet-500">
                                {fcLabel(ev.functionCode)}
                              </span>
                              {ev.clientAddr ? (
                                <span className="w-[130px] shrink-0 text-text-tertiary">{ev.clientAddr}</span>
                              ) : null}
                              {ev.startAddress !== undefined ? (
                                <span className="text-text-secondary">
                                  addr {ev.startAddress}
                                  {ev.quantity !== undefined && ev.quantity > 1 ? `+${ev.quantity}` : ''}
                                </span>
                              ) : null}
                              {ev.rawHex ? (
                                <span className="ml-auto max-w-[200px] truncate text-text-disabled">{ev.rawHex}</span>
                              ) : null}
                            </>
                          )}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>

      {!compact ? (
        <div className="h-7 flex items-center gap-4 px-4 bg-bg-secondary/60 border-t border-border-default text-[var(--fs-xs)] font-medium shrink-0 select-none rounded-b-[var(--radius-md)]">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full transition-colors",
            running ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-text-disabled"
          )} />
          <span className={cn("transition-colors", running ? "text-emerald-600 dark:text-emerald-400" : "text-text-tertiary")}>
            {running
              ? t('serial.modbusslave.started', '从站已启动')
              : t('serial.modbusslave.stopped', '从站已停止')}
          </span>
        </div>
        <div className="w-[1px] h-3 bg-border-default" />
        <span className="text-text-tertiary">
          {requestCount} {t('serial.modbusslave.requestLog', '请求')}
        </span>
        {uptime && (
          <>
            <div className="w-[1px] h-3 bg-border-default" />
            <span className="text-text-disabled">{uptime}</span>
          </>
        )}
        </div>
      ) : null}
    </div>
  );
}
