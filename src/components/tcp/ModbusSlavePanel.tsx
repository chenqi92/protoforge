// Modbus 从站 (Slave) 面板 — 模拟 Modbus 设备，自动响应主站请求
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Cpu, RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Play, Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import * as mbSvc from "@/services/modbusService";
import * as svcSerial from "@/services/serialService";
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
    <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
      {/* Badge */}
      <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm bg-violet-600">
        <Cpu className="w-3.5 h-3.5" />
        <span>Slave</span>
      </div>

      {/* Transport toggle */}
      <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/60 p-0.5 shrink-0">
        {(["tcp", "rtu"] as ModbusTransport[]).map((tp) => (
          <button
            key={tp}
            onClick={() => !running && onTransportChange(tp)}
            disabled={running}
            className={cn(
              "h-6 px-2.5 rounded-[4px] text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-all",
              transport === tp
                ? "bg-bg-primary text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-secondary disabled:opacity-50"
            )}
          >
            {tp.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Connection inputs */}
      {transport === "tcp" ? (
        <>
          <input
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            placeholder="0.0.0.0"
            disabled={running}
            className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
          />
          <div className="h-5 w-px shrink-0 bg-border-default/70" />
          <input
            value={port}
            onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
            placeholder="502"
            type="number"
            disabled={running}
            className="h-7 w-[70px] bg-transparent px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
          />
        </>
      ) : (
        <>
          <div className="relative flex-1 min-w-0">
            <select
              value={portName}
              onChange={(e) => onPortNameChange(e.target.value)}
              disabled={running}
              className="h-7 w-full appearance-none bg-transparent pl-2 pr-6 text-[var(--fs-sm)] font-mono text-text-primary outline-none disabled:opacity-60 cursor-pointer"
            >
              <option value="">{t('serial.selectPort')}</option>
              {serialPorts.map((p) => (
                <option key={p.portName} value={p.portName}>
                  {p.portName}{p.description ? ` — ${p.description}` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
          </div>
          <button
            onClick={onRefreshPorts}
            disabled={running || loadingPorts}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 transition-colors"
            title={t('serial.refresh')}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loadingPorts && "animate-spin")} />
          </button>
          <div className="h-5 w-px shrink-0 bg-border-default/70" />
          <div className="relative">
            <select
              value={String(serialConfig.baudRate)}
              onChange={(e) => onSerialConfigChange({ baudRate: Number(e.target.value) as SerialPortConfig["baudRate"] })}
              disabled={running}
              className="h-7 w-[86px] appearance-none bg-transparent pl-2 pr-5 text-[var(--fs-xs)] font-mono text-text-secondary outline-none disabled:opacity-60 cursor-pointer"
            >
              {BAUD_RATES.map((r) => (
                <option key={r} value={String(r)}>{r}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
          </div>
        </>
      )}

      <div className="h-5 w-px shrink-0 bg-border-default/70" />

      {/* Unit ID */}
      <div className="flex h-7 items-center gap-1 shrink-0">
        <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide text-text-tertiary whitespace-nowrap">
          {t('serial.modbusslave.unitId', '从站地址')}
        </span>
        <input
          type="number"
          min={1}
          max={247}
          value={unitId}
          onChange={(e) => onUnitIdChange(Math.max(1, Math.min(247, parseInt(e.target.value) || 1)))}
          disabled={running}
          className="h-6 w-12 rounded-[4px] border border-border-default/60 bg-bg-secondary/60 px-1 text-center text-[var(--fs-xs)] font-mono text-text-primary outline-none disabled:opacity-60"
        />
      </div>

      {/* Start/Stop button */}
      <button
        onClick={onToggle}
        disabled={starting || (!running && transport === "tcp" && !host) || (!running && transport === "rtu" && !portName)}
        className={cn(
          "wb-primary-btn min-w-[80px] px-3",
          running
            ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
            : starting
              ? "bg-violet-600 cursor-wait opacity-70"
              : "bg-gradient-to-r from-violet-600 to-purple-700 hover:from-violet-700 hover:to-purple-800 hover:shadow-md"
        )}
      >
        {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
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

export function ModbusSlavePanel({ sessionKey }: { sessionKey: string }) {
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
        } else if (ev.eventType === 'stopped') {
          setRunning(false);
          setStartedAt(null);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {/* ── Connection bar ── */}
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

      {/* ── Register bank ── */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden" style={{ minHeight: 0, maxHeight: '55%' }}>
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border-default/40 px-3 py-1.5 bg-bg-secondary/40 flex-wrap">
          {/* Tab buttons */}
          <div className="flex items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/60 p-0.5">
            {TABS.map(({ key, labelKey }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setEditingAddr(null); }}
                className={cn(
                  "h-6 px-2.5 rounded-[4px] text-[var(--fs-xxs)] font-semibold transition-all whitespace-nowrap",
                  activeTab === key
                    ? "bg-bg-primary text-text-primary shadow-xs"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-border-default/50 shrink-0" />

          {/* Address range + page nav */}
          <div className="flex items-center gap-1.5 text-[var(--fs-xxs)] text-text-tertiary font-mono">
            <span>{t('serial.modbusslave.addressRange', '地址范围')}:</span>
            <span className="font-semibold text-text-secondary">
              {pageStart.toString(16).padStart(4, '0').toUpperCase()}
              {' – '}
              {Math.min(pageEnd, MAX_ADDR).toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex h-6 w-6 items-center justify-center rounded-[4px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="w-12 text-center text-[var(--fs-xxs)] text-text-disabled">
              {page + 1}/{maxPage + 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              disabled={page === maxPage}
              className="flex h-6 w-6 items-center justify-center rounded-[4px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="ml-auto" />

          {/* Bulk fill dropdown */}
          <div className="relative group">
            <button className="flex h-6 items-center gap-1 px-2 rounded-[4px] border border-border-default/60 bg-bg-secondary/60 text-[var(--fs-xxs)] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              {t('serial.modbusslave.fillAll', '批量填充')}
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 z-10 hidden group-hover:block min-w-[120px] rounded-[var(--radius-md)] border border-border-default bg-bg-primary shadow-lg py-1">
              {([
                ['zero', t('serial.modbusslave.fillZero', '全部清零')],
                ['one',  t('serial.modbusslave.fillOne',  '全部置1')],
                ['increment', t('serial.modbusslave.fillIncrement', '递增填充')],
                ['random', t('serial.modbusslave.fillRandom', '随机填充')],
              ] as const).map(([action, label]) => (
                <button
                  key={action}
                  onClick={() => handleBulkFill(action)}
                  className="block w-full px-3 py-1 text-left text-[var(--fs-xs)] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Register table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-[var(--fs-xs)]">
            <thead className="sticky top-0 bg-bg-secondary/80 backdrop-blur-sm z-[1]">
              <tr className="border-b border-border-default/40">
                <th className="w-[90px] px-3 py-1.5 text-left font-semibold text-text-tertiary uppercase tracking-wide text-[var(--fs-xxs)]">
                  {t('serial.modbusslave.address', '地址')}
                </th>
                {isRegTab ? (
                  <>
                    <th className="px-3 py-1.5 text-left font-semibold text-text-tertiary uppercase tracking-wide text-[var(--fs-xxs)]">
                      {t('serial.modbusslave.value', '十进制值')}
                    </th>
                    <th className="w-[80px] px-3 py-1.5 text-left font-semibold text-text-tertiary uppercase tracking-wide text-[var(--fs-xxs)]">
                      十六进制
                    </th>
                    <th className="w-[140px] px-3 py-1.5 text-left font-semibold text-text-tertiary uppercase tracking-wide text-[var(--fs-xxs)]">
                      二进制
                    </th>
                  </>
                ) : (
                  <th className="px-3 py-1.5 text-left font-semibold text-text-tertiary uppercase tracking-wide text-[var(--fs-xxs)]">
                    {t('serial.modbusslave.status', '状态')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {addresses.map((addr) => {
                const prefix = addrPrefix(activeTab);
                const addrDisplay = `${prefix}${(addr + 1).toString().padStart(4, '0')}`;
                const isEditable = activeTab === 'holding' || activeTab === 'coil' || activeTab === 'discrete';

                if (isRegTab) {
                  const val = activeTab === 'holding' ? getHolding(addr) : getInput(addr);
                  const isEditing = editingAddr === addr;
                  return (
                    <tr
                      key={addr}
                      className={cn(
                        "border-b border-border-default/20 hover:bg-bg-hover/30 transition-colors",
                        !isEditable && "opacity-70"
                      )}
                    >
                      <td className="px-3 py-1 font-mono text-text-tertiary text-[var(--fs-xxs)]">
                        {addrDisplay}
                      </td>
                      <td className="px-3 py-1">
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
                              className="w-20 h-6 rounded-[4px] border border-accent/60 bg-accent-soft px-1 text-center text-[var(--fs-xs)] font-mono text-text-primary outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => { setEditingAddr(addr); setEditingVal(String(val)); }}
                              className="cursor-text font-mono text-text-primary hover:text-accent transition-colors select-none"
                            >
                              {val}
                            </span>
                          )
                        ) : (
                          <span className="font-mono text-text-secondary">{val}</span>
                        )}
                      </td>
                      <td className="px-3 py-1 font-mono text-text-tertiary text-[var(--fs-xxs)]">
                        0x{val.toString(16).toUpperCase().padStart(4, '0')}
                      </td>
                      <td className="px-3 py-1 font-mono text-text-disabled text-[var(--fs-xxs)] tracking-wider">
                        {val.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim()}
                      </td>
                    </tr>
                  );
                } else {
                  const val = activeTab === 'coil' ? getCoil(addr) : getDiscrete(addr);
                  return (
                    <tr
                      key={addr}
                      className="border-b border-border-default/20 hover:bg-bg-hover/30 transition-colors"
                    >
                      <td className="px-3 py-1 font-mono text-text-tertiary text-[var(--fs-xxs)]">
                        {addrDisplay}
                      </td>
                      <td className="px-3 py-1">
                        {isEditable ? (
                          <button
                            onClick={() => toggleBool(addr, activeTab)}
                            className={cn(
                              "h-6 min-w-[52px] px-2.5 rounded-[4px] text-[var(--fs-xxs)] font-semibold transition-all",
                              val
                                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40"
                                : "bg-bg-secondary/60 text-text-tertiary border border-border-default/60"
                            )}
                          >
                            {val ? 'ON' : 'OFF'}
                          </button>
                        ) : (
                          <span className={cn(
                            "inline-flex h-6 items-center px-2.5 rounded-[4px] text-[var(--fs-xxs)] font-semibold",
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
                }
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Request log ── */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden">
        {/* Log header */}
        <div className="flex shrink-0 items-center justify-between px-3 py-1.5 border-b border-border-default/40 bg-bg-secondary/40">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide text-text-tertiary">
            {t('serial.modbusslave.requestLog', '请求日志')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[var(--fs-xxs)] text-text-disabled">
              {requestCount} {requestCount === 1 ? 'req' : 'reqs'}
            </span>
            <button
              onClick={() => { setRequestLog([]); setRequestCount(0); }}
              className="flex h-5 w-5 items-center justify-center rounded-[4px] text-text-disabled hover:text-text-secondary hover:bg-bg-hover transition-colors"
              title="清空日志"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto min-h-0 font-mono text-[var(--fs-xxs)]">
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
                    "flex items-center gap-3 px-3 py-0.5 hover:bg-bg-hover/30 transition-colors",
                    ev.eventType === 'error' && "bg-red-500/5 text-red-500"
                  )}
                >
                  <span className="shrink-0 text-text-disabled w-[100px]">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {ev.eventType === 'error' ? (
                    <span className="text-red-500">{ev.rawHex}</span>
                  ) : (
                    <>
                      <span className="shrink-0 text-violet-500 font-semibold w-[180px]">
                        {fcLabel(ev.functionCode)}
                      </span>
                      {ev.clientAddr && (
                        <span className="shrink-0 text-text-tertiary w-[130px]">{ev.clientAddr}</span>
                      )}
                      {ev.startAddress !== undefined && (
                        <span className="text-text-secondary">
                          addr {ev.startAddress}
                          {ev.quantity !== undefined && ev.quantity > 1 ? `+${ev.quantity}` : ''}
                        </span>
                      )}
                      {ev.rawHex && (
                        <span className="ml-auto text-text-disabled truncate max-w-[200px]">{ev.rawHex}</span>
                      )}
                    </>
                  )}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* ── Stats bar ── */}
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
    </div>
  );
}
