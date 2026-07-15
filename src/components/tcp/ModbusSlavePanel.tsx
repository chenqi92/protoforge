// Modbus 从站 (Slave) 面板 — 模拟 Modbus 设备，自动响应主站请求
import { useState, useEffect, useRef, useCallback } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  Cpu, RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  Trash2, Play, Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import * as mbSvc from "@/services/modbusService";
import * as svcSerial from "@/services/serialService";
import { isConnectionRegistered, registerConnection, unregisterConnection } from '@/lib/connectionRegistry';
import { ProtocolSidebarSection } from "./ProtocolWorkbench";
import type {
  SerialPortInfo, SerialPortConfig, ModbusTransport, ModbusSlaveEvent,
  ModbusSlaveInitialBank, ModbusSlaveStatus,
} from "@/types/serial";
import { DEFAULT_SERIAL_CONFIG, BAUD_RATES } from "@/types/serial";

// ═══════════════════════════════════════════
//  Register bank tabs
// ═══════════════════════════════════════════

type RegTab = 'holding' | 'coil' | 'discrete' | 'input';

const PAGE_SIZE = 16;
const MAX_ADDR = 65535;

interface ModbusSlaveBankMaps {
  holdingRegisters: Map<number, number>;
  coils: Map<number, boolean>;
  inputRegisters: Map<number, number>;
  discreteInputs: Map<number, boolean>;
}

function emptyBankMaps(): ModbusSlaveBankMaps {
  return {
    holdingRegisters: new Map(),
    coils: new Map(),
    inputRegisters: new Map(),
    discreteInputs: new Map(),
  };
}

function cloneBankMaps(bank: ModbusSlaveBankMaps): ModbusSlaveBankMaps {
  return {
    holdingRegisters: new Map(bank.holdingRegisters),
    coils: new Map(bank.coils),
    inputRegisters: new Map(bank.inputRegisters),
    discreteInputs: new Map(bank.discreteInputs),
  };
}

// A session can be remounted while an IPC is still in flight. Keeping the
// queue outside the component preserves physical write order across remounts.
const slaveBankMutationQueues = new Map<string, Promise<void>>();

function enqueueSlaveBankMutation(connId: string, mutation: () => Promise<void>): Promise<void> {
  const previous = slaveBankMutationQueues.get(connId) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(mutation);
  const tail = operation.catch(() => {});
  slaveBankMutationQueues.set(connId, tail);
  void tail.then(() => {
    if (slaveBankMutationQueues.get(connId) === tail) {
      slaveBankMutationQueues.delete(connId);
    }
  });
  return operation;
}

async function waitForSlaveBankMutations(connId: string): Promise<void> {
  while (true) {
    const tail = slaveBankMutationQueues.get(connId);
    if (!tail) return;
    await tail;
    if (slaveBankMutationQueues.get(connId) === tail) return;
  }
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(2000, 100 * 2 ** Math.min(attempt, 5)));
  });
}

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
        <div className="col-span-2 flex items-center gap-2 pf-rounded-md border border-border-default/60 bg-bg-secondary/35 p-1">
          <div className="flex h-8 shrink-0 items-center justify-center gap-1.5 pf-rounded-sm bg-accent-soft text-accent px-2.5 pf-text-xs font-semibold">
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
              <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
              <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
              <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
                  className="flex h-10 w-10 shrink-0 items-center justify-center pf-rounded-md border border-border-default/60 bg-bg-secondary/35 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  title={t('serial.refresh')}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingPorts && "animate-spin")} />
                </button>
              </div>
            </label>
            <label className="space-y-1">
              <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
          <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbusslave.unitId', '从站地址')}
          </span>
          <input
            type="number"
            min={transport === 'tcp' ? 0 : 1}
            max={transport === 'tcp' ? 255 : 247}
            value={unitId}
            onChange={(e) => {
              const min = transport === 'tcp' ? 0 : 1;
              const max = transport === 'tcp' ? 255 : 247;
              onUnitIdChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)));
            }}
            disabled={running}
            className="wb-field w-full"
          />
        </label>
        <div className="space-y-1">
          <span className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.transport', '传输')}
          </span>
          <div className="flex h-10 items-center pf-rounded-md border border-border-default/60 bg-bg-secondary/35 px-3 pf-text-xs font-medium text-text-secondary">
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
  const connId = `modbus-slave-${sessionKey}`;
  const initiallyRunning = isConnectionRegistered(sessionKey, connId);

  // ── Connection state ──
  const [transport, setTransport] = useState<ModbusTransport>('tcp');
  const [host, setHost] = useState('0.0.0.0');
  const [port, setPort] = useState(502);
  const [portName, setPortName] = useState('');
  const [serialConfig, setSerialConfig] = useState<SerialPortConfig>(DEFAULT_SERIAL_CONFIG);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [unitId, setUnitId] = useState(1);
  const [running, setRunning] = useState(initiallyRunning);
  const [starting, setStarting] = useState(false);

  // ── Register bank state ──
  // Use Map<address, value> for sparse storage
  const [holdingRegs, setHoldingRegs] = useState<Map<number, number>>(new Map());
  const [coils, setCoils] = useState<Map<number, boolean>>(new Map());
  const [discreteInputs, setDiscreteInputs] = useState<Map<number, boolean>>(new Map());
  const [inputRegs, setInputRegs] = useState<Map<number, number>>(new Map());
  const displayedBankRef = useRef<ModbusSlaveBankMaps>(emptyBankMaps());
  const desiredBankRef = useRef<ModbusSlaveBankMaps>(emptyBankMaps());
  const activeGenerationRef = useRef<string | null>(null);

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<RegTab>('holding');
  const [page, setPage] = useState(0);

  // ── Request log ──
  const [requestLog, setRequestLog] = useState<ModbusSlaveEvent[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const lifecycleEpochRef = useRef(0);
  const statusEpochRef = useRef(0);
  const statusRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ── Stats ──
  const [requestCount, setRequestCount] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(initiallyRunning ? new Date() : null);
  const [uptime, setUptime] = useState('');

  // ── Inline edit state ──
  const [editingAddr, setEditingAddr] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState('');

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

  const applyAuthoritativeStatus = useCallback((status: ModbusSlaveStatus | null) => {
    if (!status) {
      activeGenerationRef.current = null;
      desiredBankRef.current = cloneBankMaps(displayedBankRef.current);
      setRunning(false);
      setStarting(false);
      setStartedAt(null);
      unregisterConnection(sessionKey, connId);
      return;
    }
    setTransport(status.transport);
    if (status.transport === 'tcp') {
      setHost(status.host);
      setPort(status.port);
    } else {
      setPortName(status.portName);
      setSerialConfig({
        baudRate: status.baudRate,
        dataBits: status.dataBits,
        stopBits: status.stopBits,
        parity: status.parity,
        flowControl: status.flowControl,
      });
    }
    const bank: ModbusSlaveBankMaps = {
      holdingRegisters: new Map(status.holdingRegisters.map(({ address, value }) => [address, value])),
      coils: new Map(status.coils.map(({ address, value }) => [address, value])),
      inputRegisters: new Map(status.inputRegisters.map(({ address, value }) => [address, value])),
      discreteInputs: new Map(status.discreteInputs.map(({ address, value }) => [address, value])),
    };
    displayedBankRef.current = bank;
    desiredBankRef.current = cloneBankMaps(bank);
    activeGenerationRef.current = status.generation;
    setUnitId(status.unitId);
    setHoldingRegs(bank.holdingRegisters);
    setCoils(bank.coils);
    setInputRegs(bank.inputRegisters);
    setDiscreteInputs(bank.discreteInputs);
    setRunning(status.running);
    setStarting(false);
    setStartedAt(new Date(status.startedAt));
    registerConnection(sessionKey, connId, 'Modbus Slave');
  }, [connId, sessionKey]);

  const refreshAuthoritativeStatus = useCallback(async (expectedEpoch?: number) => {
    const refreshEpoch = expectedEpoch ?? ++statusEpochRef.current;
    const status = await mbSvc.modbusSlaveStatus(connId);
    if (mountedRef.current && statusEpochRef.current === refreshEpoch) {
      applyAuthoritativeStatus(status);
    }
  }, [applyAuthoritativeStatus, connId]);

  const scheduleAuthoritativeStatusRefresh = useCallback(() => {
    if (statusRefreshTimerRef.current) clearTimeout(statusRefreshTimerRef.current);
    const scheduledEpoch = statusEpochRef.current;
    statusRefreshTimerRef.current = setTimeout(() => {
      statusRefreshTimerRef.current = null;
      void (async () => {
        await waitForSlaveBankMutations(connId);
        if (!mountedRef.current || statusEpochRef.current !== scheduledEpoch) return;
        await refreshAuthoritativeStatus();
      })().catch(() => {});
    }, 30);
  }, [connId, refreshAuthoritativeStatus]);

  const hydrateAuthoritativeStatus = useCallback(async (
    expectedGeneration?: string,
    expectedLifecycleEpoch = lifecycleEpochRef.current,
  ) => {
    const hydrateEpoch = ++statusEpochRef.current;
    let attempt = 0;
    const isCurrent = () => mountedRef.current
      && lifecycleEpochRef.current === expectedLifecycleEpoch
      && statusEpochRef.current === hydrateEpoch;

    while (isCurrent()) {
      try {
        await waitForSlaveBankMutations(connId);
        if (!isCurrent()) return;
        const status = await mbSvc.modbusSlaveStatus(connId);
        if (!isCurrent()) return;
        if (expectedGeneration && (
          activeGenerationRef.current !== expectedGeneration
          || status?.generation !== expectedGeneration
        )) {
          return;
        }
        applyAuthoritativeStatus(status);
        return;
      } catch {
        if (!isCurrent()) return;
        await retryDelay(attempt);
        attempt += 1;
      }
    }
  }, [applyAuthoritativeStatus, connId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusRefreshTimerRef.current) clearTimeout(statusRefreshTimerRef.current);
    };
  }, []);

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
      let attempt = 0;
      while (!disposed) {
        try {
          const fn = await mbSvc.onModbusSlaveEvent((ev) => {
            if (disposed) return;
            if (ev.connId !== connId) return;
            if (ev.eventType === 'started') {
              const startedLifecycleEpoch = ++lifecycleEpochRef.current;
              activeGenerationRef.current = ev.generation ?? null;
              desiredBankRef.current = cloneBankMaps(displayedBankRef.current);
              setRunning(true);
              setStarting(false);
              setStartedAt(new Date());
              registerConnection(sessionKey, connId, 'Modbus Slave');
              void hydrateAuthoritativeStatus(ev.generation, startedLifecycleEpoch);
            } else if (
              ev.generation
              && activeGenerationRef.current
              && ev.generation !== activeGenerationRef.current
            ) {
              return;
            } else if (ev.eventType === 'stopped') {
              lifecycleEpochRef.current += 1;
              statusEpochRef.current += 1;
              activeGenerationRef.current = null;
              desiredBankRef.current = cloneBankMaps(displayedBankRef.current);
              setRunning(false);
              setStartedAt(null);
              unregisterConnection(sessionKey, connId);
            } else if (ev.eventType === 'request') {
              setRequestCount((c) => c + 1);
              setRequestLog((prev) => [...prev.slice(-499), ev]);
              // Auto scroll
              setTimeout(() => {
                if (!logEndRef.current || logEndRef.current.offsetParent === null) {
                  return;
                }
                logEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }, 50);
              // Request events can arrive after a stop/restart or out of order.
              // Re-read the generation-checked backend snapshot for writes instead
              // of replaying event values into local state.
              if ([5, 6, 15, 16].includes(ev.functionCode ?? -1)) {
                scheduleAuthoritativeStatusRefresh();
              }
            } else if (ev.eventType === 'error') {
              setRequestLog((prev) => [...prev.slice(-499), ev]);
            }
          });
          if (disposed) {
            fn();
          } else {
            unlisten = fn;
            // Events emitted while listener registration was failing are not
            // replayed. Re-read the backend immediately after every successful
            // attachment to close that observation gap.
            void hydrateAuthoritativeStatus(undefined, lifecycleEpochRef.current);
          }
          return;
        } catch {
          await retryDelay(attempt);
          attempt += 1;
        }
      }
    };
    void setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [connId, hydrateAuthoritativeStatus, scheduleAuthoritativeStatusRefresh, sessionKey]);

  // Rehydrate the authoritative backend listener and sparse banks after a
  // workspace remount. Local registry state alone cannot restore bank data.
  useEffect(() => {
    void hydrateAuthoritativeStatus(undefined, lifecycleEpochRef.current);
  }, [hydrateAuthoritativeStatus]);

  // ── Auto-scroll log ──
  useEffect(() => {
    if (!logEndRef.current || logEndRef.current.offsetParent === null) {
      return;
    }
    logEndRef.current.scrollIntoView({ behavior: 'auto' });
  }, [requestLog]);

  // ── Toggle start/stop ──
  const handleToggle = useCallback(async () => {
    const actionEpoch = ++lifecycleEpochRef.current;
    statusEpochRef.current += 1;
    if (running) {
      try {
        const expectedGeneration = activeGenerationRef.current;
        if (!expectedGeneration) throw new Error('Modbus Slave 状态尚未恢复');
        await mbSvc.modbusSlaveStop(connId, expectedGeneration);
        if (lifecycleEpochRef.current === actionEpoch) {
          activeGenerationRef.current = null;
          desiredBankRef.current = cloneBankMaps(displayedBankRef.current);
          unregisterConnection(sessionKey, connId);
          setRunning(false);
          setStartedAt(null);
        }
      } catch (err) {
        void hydrateAuthoritativeStatus(undefined, lifecycleEpochRef.current);
        toast.error(t('serial.modbusslave.stopFailed', 'Modbus Slave 停止失败') + ': ' + String(err));
      }
    } else {
      setStarting(true);
      try {
        const bank = displayedBankRef.current;
        const initialBank = {
          holdingRegisters: Array.from(bank.holdingRegisters, ([address, value]) => ({ address, value })),
          coils: Array.from(bank.coils, ([address, value]) => ({ address, value })),
          inputRegisters: Array.from(bank.inputRegisters, ([address, value]) => ({ address, value })),
          discreteInputs: Array.from(bank.discreteInputs, ([address, value]) => ({ address, value })),
        };
        const generation = transport === 'tcp'
          ? await mbSvc.modbusSlaveStartTcp(connId, host, port, unitId, initialBank)
          : await mbSvc.modbusSlaveStartRtu(connId, portName, serialConfig, unitId, initialBank);
        if (lifecycleEpochRef.current === actionEpoch) {
          activeGenerationRef.current = generation;
          setRunning(true);
          setStarting(false);
          setStartedAt(new Date());
          registerConnection(sessionKey, connId, 'Modbus Slave');
          void hydrateAuthoritativeStatus(generation, actionEpoch);
        }
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
        toast.error(t('serial.modbusslave.startFailed', 'Modbus Slave 启动失败') + ': ' + String(err));
      }
    }
  }, [running, transport, connId, host, port, unitId, portName, serialConfig, sessionKey, t, hydrateAuthoritativeStatus]);

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

  const applyRunningBankUpdate = useCallback(async (updates: Partial<ModbusSlaveInitialBank>) => {
    const updateEpoch = ++statusEpochRef.current;
    // Capture the generation before entering the per-connection queue. Reading
    // it inside the queued closure could bind an old edit to a replacement
    // slave that started while the edit was waiting.
    const expectedGeneration = activeGenerationRef.current;
    let failure: unknown;
    if (!expectedGeneration) {
      failure = new Error('Modbus Slave 状态尚未恢复');
    } else {
      try {
        await enqueueSlaveBankMutation(
          connId,
          () => mbSvc.modbusSlaveApplyBatch(connId, expectedGeneration, updates),
        );
      } catch (err) {
        failure = err;
      }
    }
    try {
      // A later user action may already be queued. Wait until the session queue
      // is fully drained so at least the newest operation publishes one final,
      // generation-checked snapshot.
      await waitForSlaveBankMutations(connId);
      await refreshAuthoritativeStatus(updateEpoch);
    } catch (err) {
      failure ??= err;
    }
    if (mountedRef.current && failure !== undefined) {
      toast.error(t('serial.modbusslave.updateFailed', '更新从站数据失败') + ': ' + String(failure));
    }
  }, [connId, refreshAuthoritativeStatus, t]);

  // ── Commit edit ──
  const commitEdit = useCallback(async (addr: number, raw: string) => {
    setEditingAddr(null);
    if (activeTab === 'holding') {
      const v = Math.max(0, Math.min(65535, parseInt(raw) || 0));
      if (running) {
        desiredBankRef.current.holdingRegisters.set(addr, v);
        await applyRunningBankUpdate({ holdingRegisters: [{ address: addr, value: v }] });
      } else {
        const bank = cloneBankMaps(displayedBankRef.current);
        bank.holdingRegisters.set(addr, v);
        displayedBankRef.current = bank;
        desiredBankRef.current = cloneBankMaps(bank);
        setHoldingRegs(bank.holdingRegisters);
      }
    } else if (activeTab === 'input') {
      const v = Math.max(0, Math.min(65535, parseInt(raw) || 0));
      if (running) {
        desiredBankRef.current.inputRegisters.set(addr, v);
        await applyRunningBankUpdate({ inputRegisters: [{ address: addr, value: v }] });
      } else {
        const bank = cloneBankMaps(displayedBankRef.current);
        bank.inputRegisters.set(addr, v);
        displayedBankRef.current = bank;
        desiredBankRef.current = cloneBankMaps(bank);
        setInputRegs(bank.inputRegisters);
      }
    }
  }, [activeTab, applyRunningBankUpdate, running]);

  // ── Toggle coil/discrete ──
  const toggleBool = useCallback(async (addr: number, tab: RegTab) => {
    if (tab === 'coil') {
      const source = running ? desiredBankRef.current : displayedBankRef.current;
      const newVal = !(source.coils.get(addr) ?? false);
      if (running) {
        desiredBankRef.current.coils.set(addr, newVal);
        await applyRunningBankUpdate({ coils: [{ address: addr, value: newVal }] });
      } else {
        const bank = cloneBankMaps(displayedBankRef.current);
        bank.coils.set(addr, newVal);
        displayedBankRef.current = bank;
        desiredBankRef.current = cloneBankMaps(bank);
        setCoils(bank.coils);
      }
    } else if (tab === 'discrete') {
      const source = running ? desiredBankRef.current : displayedBankRef.current;
      const newVal = !(source.discreteInputs.get(addr) ?? false);
      if (running) {
        desiredBankRef.current.discreteInputs.set(addr, newVal);
        await applyRunningBankUpdate({ discreteInputs: [{ address: addr, value: newVal }] });
      } else {
        const bank = cloneBankMaps(displayedBankRef.current);
        bank.discreteInputs.set(addr, newVal);
        displayedBankRef.current = bank;
        desiredBankRef.current = cloneBankMaps(bank);
        setDiscreteInputs(bank.discreteInputs);
      }
    }
  }, [applyRunningBankUpdate, running]);

  // ── Bulk fill ──
  const handleBulkFill = useCallback(async (action: 'zero' | 'one' | 'increment' | 'random') => {
    if (activeTab === 'holding' || activeTab === 'input') {
      const entries = addresses.map((addr, i) => {
        let value = 0;
        if (action === 'one') value = 1;
        else if (action === 'increment') value = i;
        else if (action === 'random') value = Math.floor(Math.random() * 65536);
        return { address: addr, value };
      });
      if (running) {
        const target = activeTab === 'holding'
          ? desiredBankRef.current.holdingRegisters
          : desiredBankRef.current.inputRegisters;
        entries.forEach(({ address, value }) => target.set(address, value));
        await applyRunningBankUpdate(activeTab === 'holding'
          ? { holdingRegisters: entries }
          : { inputRegisters: entries });
        return;
      }
      const bank = cloneBankMaps(displayedBankRef.current);
      const target = activeTab === 'holding' ? bank.holdingRegisters : bank.inputRegisters;
      entries.forEach(({ address, value }) => target.set(address, value));
      displayedBankRef.current = bank;
      desiredBankRef.current = cloneBankMaps(bank);
      if (activeTab === 'holding') setHoldingRegs(bank.holdingRegisters);
      else setInputRegs(bank.inputRegisters);
    } else {
      const entries = addresses.map((addr) => {
        let value = false;
        if (action === 'one') value = true;
        else if (action === 'increment') value = addr % 2 === 0;
        else if (action === 'random') value = Math.random() > 0.5;
        return { address: addr, value };
      });
      if (running) {
        const target = activeTab === 'coil'
          ? desiredBankRef.current.coils
          : desiredBankRef.current.discreteInputs;
        entries.forEach(({ address, value }) => target.set(address, value));
        await applyRunningBankUpdate(activeTab === 'coil'
          ? { coils: entries }
          : { discreteInputs: entries });
        return;
      }
      const bank = cloneBankMaps(displayedBankRef.current);
      const target = activeTab === 'coil' ? bank.coils : bank.discreteInputs;
      entries.forEach(({ address, value }) => target.set(address, value));
      displayedBankRef.current = bank;
      desiredBankRef.current = cloneBankMaps(bank);
      if (activeTab === 'coil') setCoils(bank.coils);
      else setDiscreteInputs(bank.discreteInputs);
    }
  }, [activeTab, addresses, applyRunningBankUpdate, running]);

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
    // A simulator operator must be able to seed both writable holding
    // registers and read-only-from-the-master input registers.
    const isEditable = activeTab === 'holding' || activeTab === 'input';
    const isEditing = editingAddr === addr;

    return (
      <tr
        key={addr}
        className={cn(
          "border-b border-border-default/20 transition-colors hover:bg-bg-hover/30",
          !isEditable && "opacity-70"
        )}
      >
        <td className="px-2.5 py-0.5 font-mono pf-text-3xs text-text-tertiary">
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
                className="h-5 w-[68px] pf-rounded-xs border border-accent/60 bg-accent-soft px-1 text-center pf-text-xxs font-mono text-text-primary outline-none"
              />
            ) : (
              <span
                onClick={() => { setEditingAddr(addr); setEditingVal(String(val)); }}
                className="cursor-text select-none font-mono pf-text-xxs text-text-primary transition-colors hover:text-accent"
              >
                {val}
              </span>
            )
          ) : (
            <span className="font-mono pf-text-xxs text-text-secondary">{val}</span>
          )}
        </td>
        <td className="w-[72px] px-2.5 py-0.5 font-mono pf-text-3xs text-text-tertiary">
          0x{val.toString(16).toUpperCase().padStart(4, '0')}
        </td>
        <td className="w-[118px] px-2.5 py-0.5 font-mono pf-text-3xs tracking-[0.12em] text-text-disabled">
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
        <td className="px-2.5 py-0.5 font-mono pf-text-3xs text-text-tertiary">
          {addrDisplay}
        </td>
        <td className="px-2.5 py-0.5">
          {isEditable ? (
            <button
              onClick={() => toggleBool(addr, activeTab)}
              className={cn(
                "h-5 min-w-[44px] pf-rounded-xs border px-2 pf-text-3xs font-semibold transition-all",
                val
                  ? "border-success/40 bg-success/20 text-success"
                  : "border-border-default/60 bg-bg-secondary/60 text-text-tertiary"
              )}
            >
              {val ? 'ON' : 'OFF'}
            </button>
          ) : (
            <span className={cn(
              "inline-flex h-5 items-center pf-rounded-xs px-2 pf-text-3xs font-semibold",
              val
                ? "bg-success/10 text-success"
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
                onTransportChange={(nextTransport) => {
                  setTransport(nextTransport);
                  setUnitId((current) => nextTransport === 'rtu'
                    ? Math.max(1, Math.min(247, current))
                    : Math.max(0, Math.min(255, current)));
                }}
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
                        "pf-rounded-md border px-3 py-2 text-left pf-text-xs font-semibold transition-all",
                        activeTab === key
                          ? "border-accent/50 bg-accent-soft text-accent"
                          : "border-border-default/60 bg-bg-secondary/20 text-text-secondary hover:bg-bg-hover"
                      )}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>

                <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2.5">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.addressRange', '地址范围')}
                  </div>
                  <div className="mt-1 font-mono pf-text-xs font-semibold text-text-secondary">
                    {pageStart.toString(16).padStart(4, '0').toUpperCase()} - {Math.min(pageEnd, MAX_ADDR).toString(16).padStart(4, '0').toUpperCase()}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      aria-label={t('serial.modbusslave.prevPage', '上一页')}
                      className="flex h-8 w-8 items-center justify-center pf-rounded-sm border border-border-default/60 bg-bg-primary text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex-1 text-center pf-text-xxs text-text-disabled">
                      {page + 1}/{maxPage + 1}
                    </div>
                    <button
                      onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                      disabled={page === maxPage}
                      aria-label={t('serial.modbusslave.nextPage', '下一页')}
                      className="flex h-8 w-8 items-center justify-center pf-rounded-sm border border-border-default/60 bg-bg-primary text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
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
                        className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2 pf-text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
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
                <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.statusLabel', '状态')}
                  </div>
                  <div className={cn("mt-1 flex items-center gap-1.5 pf-text-xs font-semibold", running ? "text-success" : starting ? "text-warning" : "text-text-secondary")}>
                    <span className={cn("pf-dot", running ? "s-live" : starting ? "s-conn" : "s-idle")} />
                    {running
                      ? t('serial.modbusslave.started', '从站已启动')
                      : starting
                        ? t('serial.modbusslave.slaveStarting', '启动中...')
                        : t('serial.modbusslave.stopped', '从站已停止')}
                  </div>
                </div>
                <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.unitId', '从站地址')}
                  </div>
                  <div className="mt-1 pf-text-xs font-semibold text-text-secondary">
                    {unitId}
                  </div>
                </div>
                <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                    {t('serial.modbusslave.requestLog', '请求日志')}
                  </div>
                  <div className="mt-1 pf-text-xs font-semibold text-text-secondary">
                    {requestCount}
                  </div>
                </div>
                <div className="pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                  <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                    {t(activeTabMeta.labelKey)}
                  </div>
                  <div className="mt-1 pf-text-xs font-semibold text-text-secondary">
                    {addrPrefix(activeTab)} · {pageStart.toString(16).padStart(4, '0').toUpperCase()}
                  </div>
                </div>
                {uptime ? (
                  <div className="col-span-2 pf-rounded-md border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="pf-text-3xs uppercase tracking-[0.08em] text-text-disabled">
                      Uptime
                    </div>
                    <div className="mt-1 pf-text-xs font-semibold text-text-secondary">{uptime}</div>
                  </div>
                ) : null}
              </div>
            </ProtocolSidebarSection>
          </div>
        </div>

        <div className="min-h-0 h-full overflow-hidden">
          <PanelGroup orientation="vertical">
            <Panel defaultSize={56} minSize={34}>
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-[var(--radius-md)] border border-b-0 border-border-default/80 bg-bg-primary">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default/40 bg-bg-secondary/40 px-3 py-1.5">
                  <div>
                    <div className="pf-text-xxs font-semibold text-text-secondary">
                      {t(activeTabMeta.labelKey)}
                    </div>
                    <div className="mt-0.5 pf-text-3xs text-text-tertiary">
                      {t('serial.modbusslave.addressRange', '地址范围')}: {pageStart.toString(16).padStart(4, '0').toUpperCase()} - {Math.min(pageEnd, MAX_ADDR).toString(16).padStart(4, '0').toUpperCase()}
                    </div>
                  </div>
                  <div className="pf-text-3xs text-text-disabled">
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
                        <table className="w-full pf-text-xxs">
                          <thead className="sticky top-0 z-[1] bg-bg-secondary/80 backdrop-blur-sm">
                            <tr className="border-b border-border-default/40">
                              <th className="w-[82px] px-2.5 py-1 text-left pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                {t('serial.modbusslave.address', '地址')}
                              </th>
                              {isRegTab ? (
                                <>
                                  <th className="px-2.5 py-1 text-left pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    {t('serial.modbusslave.value', '十进制值')}
                                  </th>
                                  <th className="w-[72px] px-2.5 py-1 text-left pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    {t('serial.modbusslave.hex', '十六进制')}
                                  </th>
                                  <th className="w-[118px] px-2.5 py-1 text-left pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                                    {t('serial.modbusslave.binary', '二进制')}
                                  </th>
                                </>
                              ) : (
                                <th className="px-2.5 py-1 text-left pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
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
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-b-[var(--radius-md)] border border-t-0 border-border-default/80 bg-bg-primary">
                <div className="flex shrink-0 items-center justify-between border-b border-border-default/40 bg-bg-secondary/40 px-3 py-1.5">
                  <span className="pf-text-xxs font-semibold uppercase tracking-wide text-text-tertiary">
                    {t('serial.modbusslave.requestLog', '请求日志')}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="pf-text-xxs text-text-disabled">
                      {requestCount} {requestCount === 1 ? 'req' : 'reqs'}
                    </span>
                    <button
                      onClick={() => { setRequestLog([]); setRequestCount(0); }}
                      className="flex h-5 w-5 items-center justify-center pf-rounded-xs text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      title={t('serial.modbusslave.clearLog', '清空日志')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto font-mono pf-text-xxs">
                  {requestLog.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-border-default/60 bg-bg-secondary/60">
                        <Cpu className="h-5 w-5 text-text-disabled" />
                      </div>
                      <p className="pf-text-sm font-semibold text-text-secondary font-sans">
                        {running
                          ? t('serial.modbusslave.noRequests', '暂无请求记录，从站已就绪')
                          : t('serial.modbusslave.stopped', '从站已停止')}
                      </p>
                      <p className="mt-1 pf-text-xxs text-text-tertiary font-sans">
                        {t('serial.modbusslave.browserDesc', '切换寄存器区、翻页并批量写入当前页的数据。')}
                      </p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {requestLog.map((ev, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center gap-3 px-3 py-0.5 transition-colors hover:bg-bg-hover/30",
                            ev.eventType === 'error' && "bg-error/5 text-error"
                          )}
                        >
                          <span className="w-[100px] shrink-0 text-text-disabled">
                            {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          {ev.eventType === 'error' ? (
                            <span className="text-error">{ev.rawHex}</span>
                          ) : (
                            <>
                              <span className="w-[180px] shrink-0 font-semibold text-method-post">
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
        <div className="h-7 flex items-center gap-4 px-4 bg-bg-secondary/60 border-t border-border-default pf-text-xs font-medium shrink-0 select-none rounded-b-[var(--radius-md)]">
        <div className="flex items-center gap-1.5">
          <span className={cn("pf-dot", running ? "s-live" : starting ? "s-conn" : "s-idle")} />
          <span className={cn("transition-colors", running ? "text-success" : starting ? "text-warning" : "text-text-tertiary")}>
            {running
              ? t('serial.modbusslave.started', '从站已启动')
              : starting
                ? t('serial.modbusslave.slaveStarting', '启动中...')
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
