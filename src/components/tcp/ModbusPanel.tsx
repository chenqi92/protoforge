// Modbus 调试面板 — 支持 TCP 和 RTU 两种传输方式
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Cpu, Plug, X, RefreshCw, Trash2,
  ChevronDown, ArrowRight, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import * as mbSvc from "@/services/modbusService";
import * as svcSerial from "@/services/serialService";
import { useActivityLogStore } from "@/stores/activityLogStore";
import type { SerialPortInfo, SerialPortConfig, ModbusTransport, ModbusFunctionCode, ModbusTransaction, ModbusResponse } from "@/types/serial";
import { MODBUS_FUNCTION_CODES, DEFAULT_SERIAL_CONFIG, BAUD_RATES } from "@/types/serial";

// ═══════════════════════════════════════════
//  Modbus 功能码元数据（含 i18n key）
// ═══════════════════════════════════════════

const FC_I18N_KEY: Record<ModbusFunctionCode, string> = {
  1: "serial.modbus.fc1",
  2: "serial.modbus.fc2",
  3: "serial.modbus.fc3",
  4: "serial.modbus.fc4",
  5: "serial.modbus.fc5",
  6: "serial.modbus.fc6",
  15: "serial.modbus.fc15",
  16: "serial.modbus.fc16",
};

// FC05 线圈写入值需要转换为 Modbus 标准格式
function encodeCoilValue(v: number): number {
  return v !== 0 ? 0xFF00 : 0x0000;
}

// ── 格式化耗时显示 ──
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ═══════════════════════════════════════════
//  Modbus 连接栏
// ═══════════════════════════════════════════

interface ModbusConnectionBarProps {
  transport: ModbusTransport;
  onTransportChange: (t: ModbusTransport) => void;
  // TCP
  host: string;
  port: number;
  onHostChange: (v: string) => void;
  onPortChange: (v: number) => void;
  // RTU
  portName: string;
  serialConfig: SerialPortConfig;
  serialPorts: SerialPortInfo[];
  loadingPorts: boolean;
  onPortNameChange: (v: string) => void;
  onSerialConfigChange: (c: Partial<SerialPortConfig>) => void;
  onRefreshPorts: () => void;
  // 连接状态
  connected: boolean;
  connecting: boolean;
  onToggle: () => void;
}

function ModbusConnectionBar({
  transport, onTransportChange,
  host, port, onHostChange, onPortChange,
  portName, serialConfig, serialPorts, loadingPorts,
  onPortNameChange, onSerialConfigChange, onRefreshPorts,
  connected, connecting, onToggle,
}: ModbusConnectionBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: transport selector + connection inputs + toggle */}
      <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
        {/* Badge */}
        <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm bg-violet-500">
          <Cpu className="w-3.5 h-3.5" />
          <span>Modbus</span>
        </div>

        {/* Transport toggle */}
        <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/60 p-0.5 shrink-0">
          {(["tcp", "rtu"] as ModbusTransport[]).map((tp) => (
            <button
              key={tp}
              onClick={() => !connected && onTransportChange(tp)}
              disabled={connected}
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
              placeholder={t('tcp.hostPlaceholder', '主机地址')}
              disabled={connected}
              className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
            />
            <div className="h-5 w-px shrink-0 bg-border-default/70" />
            <input
              value={port}
              onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
              placeholder="502"
              type="number"
              disabled={connected}
              className="h-7 w-[70px] bg-transparent px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
            />
          </>
        ) : (
          <>
            {/* RTU: port dropdown */}
            <div className="relative flex-1 min-w-0">
              <select
                value={portName}
                onChange={(e) => onPortNameChange(e.target.value)}
                disabled={connected}
                className="h-7 w-full appearance-none bg-transparent pl-2 pr-6 text-[var(--fs-sm)] font-mono text-text-primary outline-none disabled:opacity-60 cursor-pointer"
              >
                <option value="">{t('serial.selectPort', '选择串口')}</option>
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
              disabled={connected || loadingPorts}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 transition-colors"
              title={t('serial.refresh', '刷新串口列表')}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loadingPorts && "animate-spin")} />
            </button>
            <div className="h-5 w-px shrink-0 bg-border-default/70" />
            {/* Baud rate quick select for RTU */}
            <div className="relative">
              <select
                value={String(serialConfig.baudRate)}
                onChange={(e) => onSerialConfigChange({ baudRate: Number(e.target.value) as SerialPortConfig["baudRate"] })}
                disabled={connected}
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

        {/* Connect button */}
        <button
          onClick={onToggle}
          disabled={connecting || (!connected && transport === "tcp" && !host) || (!connected && transport === "rtu" && !portName)}
          className={cn(
            "wb-primary-btn min-w-[80px] px-3",
            connected
              ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
              : connecting
                ? "bg-violet-500 cursor-wait opacity-70"
                : "bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 hover:shadow-md"
          )}
        >
          {connected ? <X className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
          {connected
            ? t('tcp.disconnect', '断开')
            : connecting
              ? t('tcp.connecting', '连接中...')
              : t('tcp.connect', '连接')}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  功能码执行区
// ═══════════════════════════════════════════

interface ModbusFunctionPanelProps {
  connected: boolean;
  executing: boolean;
  unitId: number;
  functionCode: ModbusFunctionCode;
  startAddress: number;
  quantity: number;
  valuesText: string;
  onUnitIdChange: (v: number) => void;
  onFunctionCodeChange: (v: ModbusFunctionCode) => void;
  onStartAddressChange: (v: number) => void;
  onQuantityChange: (v: number) => void;
  onValuesTextChange: (v: string) => void;
  onExecute: () => void;
}

function ModbusFunctionPanel({
  connected, executing,
  unitId, functionCode, startAddress, quantity, valuesText,
  onUnitIdChange, onFunctionCodeChange, onStartAddressChange, onQuantityChange, onValuesTextChange,
  onExecute,
}: ModbusFunctionPanelProps) {
  const { t } = useTranslation();
  const fcDef = MODBUS_FUNCTION_CODES.find((f) => f.code === functionCode)!;

  return (
    <div className="shrink-0 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-3 space-y-3">
      {/* Row 1: unit ID + FC selector */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Unit ID */}
        <div className="flex items-center gap-2">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
            {t('serial.modbus.unitId', '从站地址')}
          </label>
          <input
            type="number"
            min={0} max={247}
            value={unitId}
            onChange={(e) => onUnitIdChange(Math.min(247, Math.max(0, parseInt(e.target.value) || 0)))}
            disabled={executing}
            className="h-7 w-[60px] rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted disabled:opacity-60"
          />
        </div>

        <div className="h-4 w-px bg-border-default/60 shrink-0" />

        {/* Function code */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
            {t('serial.modbus.functionCode', '功能码')}
          </label>
          <div className="relative flex-1 min-w-0">
            <select
              value={functionCode}
              onChange={(e) => onFunctionCodeChange(Number(e.target.value) as ModbusFunctionCode)}
              disabled={executing}
              className="h-7 w-full appearance-none rounded-[6px] border border-border-default/60 bg-bg-secondary/40 pl-2 pr-6 text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-60 cursor-pointer"
            >
              {MODBUS_FUNCTION_CODES.map((f) => (
                <option key={f.code} value={f.code}>
                  {t(FC_I18N_KEY[f.code], `FC${String(f.code).padStart(2, "0")}`)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
          </div>
        </div>
      </div>

      {/* Row 2: start address + quantity */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
            {t('serial.modbus.startAddress', '起始地址')}
          </label>
          <input
            type="number"
            min={0} max={65535}
            value={startAddress}
            onChange={(e) => onStartAddressChange(Math.min(65535, Math.max(0, parseInt(e.target.value) || 0)))}
            disabled={executing}
            className="h-7 w-[80px] rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted disabled:opacity-60"
          />
        </div>

        {!fcDef.isSingle && (
          <>
            <div className="h-4 w-px bg-border-default/60 shrink-0" />
            <div className="flex items-center gap-2">
              <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
                {t('serial.modbus.quantity', '数量')}
              </label>
              <input
                type="number"
                min={1} max={fcDef.maxQuantity}
                value={quantity}
                onChange={(e) => onQuantityChange(Math.min(fcDef.maxQuantity, Math.max(1, parseInt(e.target.value) || 1)))}
                disabled={executing || fcDef.isSingle}
                className="h-7 w-[70px] rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted disabled:opacity-60"
              />
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Execute button */}
        <button
          onClick={onExecute}
          disabled={!connected || executing}
          className={cn(
            "wb-primary-btn px-4",
            connected && !executing
              ? "bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 hover:shadow-md"
              : "opacity-50 cursor-not-allowed"
          )}
        >
          {executing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {t('serial.modbus.executing', '执行中...')}
            </>
          ) : (
            <>
              <ArrowRight className="w-3.5 h-3.5" />
              {t('serial.modbus.execute', '执行')}
            </>
          )}
        </button>
      </div>

      {/* Write values (只在写功能码时显示) */}
      {fcDef.isWrite && (
        <div className="space-y-1">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.values', '写入值 (十进制，空格分隔)')}
            {fcDef.isSingle && functionCode === 5 && (
              <span className="ml-2 normal-case font-normal text-text-tertiary">
                {t('serial.modbus.coilHint', '线圈: 1 = ON, 0 = OFF')}
              </span>
            )}
          </label>
          <input
            value={valuesText}
            onChange={(e) => onValuesTextChange(e.target.value)}
            disabled={executing}
            placeholder={
              functionCode === 5
                ? "1"
                : functionCode === 6
                  ? "1234"
                  : "100 200 300"
            }
            className="h-8 w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-3 text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted disabled:opacity-60"
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  响应寄存器表格
// ═══════════════════════════════════════════

function ModbusResponseTable({
  transaction,
}: {
  transaction: ModbusTransaction | undefined;
}) {
  const { t } = useTranslation();
  if (!transaction) return null;
  const resp = transaction.response;
  const isCoil = transaction.functionCode === 1 || transaction.functionCode === 2;

  const rows: { address: number; value: number }[] = [];
  if (resp?.registers) {
    resp.registers.forEach((v, i) => rows.push({ address: transaction.startAddress + i, value: v }));
  } else if (resp?.coils) {
    resp.coils.forEach((v, i) => rows.push({ address: transaction.startAddress + i, value: v ? 1 : 0 }));
  }

  return (
    <div className="shrink-0 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30">
        <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
          {t('serial.modbus.responseRegisters', '响应寄存器')}
        </span>
        <div className="flex items-center gap-2">
          {transaction.success ? (
            <span className="flex items-center gap-1 text-[var(--fs-xxs)] text-emerald-500">
              <CheckCircle2 className="w-3 h-3" />
              {formatDuration(transaction.durationMs)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[var(--fs-xxs)] text-red-500">
              <AlertCircle className="w-3 h-3" />
              {transaction.error}
            </span>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
          <table className="w-full text-[var(--fs-xs)] font-mono">
            <thead className="sticky top-0 bg-bg-secondary/80 backdrop-blur-sm">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-text-disabled w-[80px]">
                  {t('serial.modbus.index', '索引')}
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-text-disabled w-[100px]">
                  {t('serial.modbus.address', '地址')}
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-text-disabled">
                  {t('serial.modbus.decimal', '值')}
                </th>
                {!isCoil && (
                  <th className="px-3 py-1.5 text-left font-semibold text-text-disabled w-[100px]">
                    Hex
                  </th>
                )}
                {!isCoil && (
                  <th className="px-3 py-1.5 text-left font-semibold text-text-disabled w-[120px]">
                    Binary
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border-default/30 hover:bg-bg-hover/50 transition-colors">
                  <td className="px-3 py-1.5 text-text-tertiary">{i}</td>
                  <td className="px-3 py-1.5 text-text-secondary">
                    {row.address} (0x{row.address.toString(16).toUpperCase().padStart(4, "0")})
                  </td>
                  <td className={cn("px-3 py-1.5 font-medium", isCoil && (row.value ? "text-emerald-500" : "text-text-tertiary"))}>
                    {isCoil ? (row.value ? "ON" : "OFF") : row.value}
                  </td>
                  {!isCoil && (
                    <td className="px-3 py-1.5 text-text-tertiary">
                      0x{row.value.toString(16).toUpperCase().padStart(4, "0")}
                    </td>
                  )}
                  {!isCoil && (
                    <td className="px-3 py-1.5 text-text-tertiary tabular-nums">
                      {row.value.toString(2).padStart(16, "0")}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : transaction.error ? (
        <div className="px-3 py-4 text-[var(--fs-sm)] text-red-400 text-center">{transaction.error}</div>
      ) : resp?.writeCount !== undefined ? (
        <div className="px-3 py-3 text-[var(--fs-sm)] text-emerald-500 text-center">
          ✓ {t('serial.modbus.wrote', '已写入')} {resp.writeCount} {t('serial.modbus.registers', '个寄存器')}
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════
//  事务日志
// ═══════════════════════════════════════════

function ModbusTransactionLog({
  transactions,
}: {
  transactions: ModbusTransaction[];
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transactions.length]);

  if (transactions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--fs-sm)] text-text-disabled">
        {t('serial.modbus.noTransactions', '暂无事务记录')}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-1 py-1">
      {transactions.map((tx) => (
        <div
          key={tx.id}
          className={cn(
            "mx-1 rounded-[6px] border px-3 py-2 text-[var(--fs-xs)] font-mono",
            tx.success
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-red-500/20 bg-red-500/5"
          )}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              {tx.success
                ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                : <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />}
              <span className="font-semibold text-text-primary">
                {t(FC_I18N_KEY[tx.functionCode], `FC${String(tx.functionCode).padStart(2, "0")}`)}
              </span>
              <span className="text-text-tertiary">
                UID:{tx.unitId} · Addr:{tx.startAddress}{tx.quantity > 1 ? `+${tx.quantity}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-3 text-text-disabled shrink-0">
              <span>{formatDuration(tx.durationMs)}</span>
              <span>{new Date(tx.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>
          <div className="flex gap-3 text-text-tertiary">
            <span className="text-[var(--fs-xxs)] uppercase tracking-wide shrink-0 text-text-disabled">
              {t('serial.modbus.request', 'REQ')}
            </span>
            <span className="truncate">{tx.requestHex || "—"}</span>
          </div>
          {tx.response && (
            <div className="flex gap-3 text-text-tertiary mt-0.5">
              <span className="text-[var(--fs-xxs)] uppercase tracking-wide shrink-0 text-text-disabled">
                {t('serial.modbus.response', 'RSP')}
              </span>
              <span className="truncate">{tx.response.rawHex || "—"}</span>
            </div>
          )}
          {tx.error && (
            <div className="mt-0.5 text-red-400">{tx.error}</div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ═══════════════════════════════════════════
//  ModbusPanel 主体
// ═══════════════════════════════════════════

export function ModbusPanel({ sessionKey }: { sessionKey: string }) {
  const { t } = useTranslation();
  const connId = useRef(`modbus:${sessionKey}`).current;

  // ── 连接状态 ──
  const [transport, setTransport] = useState<ModbusTransport>("tcp");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // ── TCP 配置 ──
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(502);

  // ── RTU 配置 ──
  const [portName, setPortName] = useState("");
  const [serialConfig, setSerialConfig] = useState<SerialPortConfig>({ ...DEFAULT_SERIAL_CONFIG });
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  // ── 功能码表单 ──
  const [unitId, setUnitId] = useState(1);
  const [functionCode, setFunctionCode] = useState<ModbusFunctionCode>(3);
  const [startAddress, setStartAddress] = useState(0);
  const [quantity, setQuantity] = useState(10);
  const [valuesText, setValuesText] = useState("");
  const [executing, setExecuting] = useState(false);

  // ── 结果 ──
  const [transactions, setTransactions] = useState<ModbusTransaction[]>([]);
  const [lastTransaction, setLastTransaction] = useState<ModbusTransaction | undefined>();

  // ── 枚举串口 ──
  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const list = await svcSerial.serialListPorts();
      setSerialPorts(list);
    } catch { /* ignore */ }
    finally { setLoadingPorts(false); }
  }, []);

  useEffect(() => { refreshPorts(); }, []);

  // ── 连接事件监听 ──
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const listener = await mbSvc.onModbusEvent((event) => {
        if (event.connId !== connId) return;
        switch (event.eventType) {
          case "connected":
            setConnected(true);
            setConnecting(false);
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            break;
        }
      });
      if (disposed) { listener(); return; }
      unlisten = listener;
    };
    setup();
    return () => { disposed = true; unlisten?.(); };
  }, [connId]);

  // ── 连接 / 断开 ──
  const handleToggleConnection = async () => {
    if (connected) {
      if (transport === "tcp") {
        await mbSvc.modbusTcpDisconnect(connId).catch(() => {});
      } else {
        await mbSvc.modbusRtuClose(connId).catch(() => {});
      }
      setConnected(false);
    } else {
      setConnecting(true);
      try {
        if (transport === "tcp") {
          await mbSvc.modbusTcpConnect(connId, host, port);
        } else {
          await mbSvc.modbusRtuOpen(connId, portName, serialConfig);
        }
        // 某些后端实现同步连接，不会推送 "connected" 事件
        setConnected(true);
        setConnecting(false);
      } catch (err: unknown) {
        setConnecting(false);
        const tx: ModbusTransaction = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          unitId, functionCode,
          startAddress, quantity,
          requestHex: "",
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0, success: false,
        };
        addTransaction(tx);
      }
    }
  };

  // ── 执行功能码 ──
  const handleExecute = async () => {
    if (!connected || executing) return;
    const fcDef = MODBUS_FUNCTION_CODES.find((f) => f.code === functionCode)!;

    // 解析写入值
    let values: number[] = [];
    if (fcDef.isWrite) {
      const parsed = valuesText.trim().split(/\s+/).map((v) => parseInt(v, 10));
      if (parsed.some(isNaN)) {
        const errTx: ModbusTransaction = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          unitId, functionCode, startAddress, quantity,
          requestHex: "",
          error: t('serial.modbus.invalidValues', '写入值格式错误，请输入十进制整数（空格分隔）'),
          durationMs: 0, success: false,
        };
        addTransaction(errTx);
        return;
      }
      // FC05: 线圈值需要转换为 0xFF00 / 0x0000
      values = functionCode === 5
        ? [encodeCoilValue(parsed[0] ?? 0)]
        : parsed;
    }

    const execQuantity = fcDef.isSingle ? 1 : quantity;
    setExecuting(true);
    const startTs = Date.now();
    try {
      const resp: ModbusResponse = await mbSvc.modbusExecute(
        connId, unitId, functionCode, startAddress, execQuantity, values
      );
      const durationMs = Date.now() - startTs;
      const tx: ModbusTransaction = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        unitId, functionCode, startAddress, quantity: execQuantity,
        requestHex: "",
        response: resp,
        durationMs,
        success: true,
      };
      addTransaction(tx);
      useActivityLogStore.getState().addEntry({
        source: "modbus", direction: "sent",
        summary: `${t(FC_I18N_KEY[functionCode])} UID:${unitId} Addr:${startAddress} ×${execQuantity}`,
        rawData: resp.rawHex,
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTs;
      const errTx: ModbusTransaction = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        unitId, functionCode, startAddress, quantity: execQuantity,
        requestHex: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs, success: false,
      };
      addTransaction(errTx);
    } finally {
      setExecuting(false);
    }
  };

  const addTransaction = useCallback((tx: ModbusTransaction) => {
    setTransactions((prev) => {
      const next = [tx, ...prev].slice(0, 500);
      return next;
    });
    setLastTransaction(tx);
  }, []);

  const statusText = connected
    ? transport === "tcp" ? `${host}:${port}` : portName
    : connecting
      ? t('tcp.connecting', '连接中...')
      : t('tcp.system.idle', '空闲');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* 连接栏 */}
      <div className="shrink-0">
        <ModbusConnectionBar
          transport={transport}
          onTransportChange={setTransport}
          host={host} port={port}
          onHostChange={setHost} onPortChange={setPort}
          portName={portName} serialConfig={serialConfig}
          serialPorts={serialPorts} loadingPorts={loadingPorts}
          onPortNameChange={setPortName}
          onSerialConfigChange={(p) => setSerialConfig((c) => ({ ...c, ...p }))}
          onRefreshPorts={refreshPorts}
          connected={connected} connecting={connecting}
          onToggle={handleToggleConnection}
        />
      </div>

      {/* 功能码执行区 */}
      <ModbusFunctionPanel
        connected={connected} executing={executing}
        unitId={unitId} functionCode={functionCode}
        startAddress={startAddress} quantity={quantity}
        valuesText={valuesText}
        onUnitIdChange={setUnitId}
        onFunctionCodeChange={(fc) => {
          setFunctionCode(fc);
          // 切换到单寄存器写时重置 quantity
          const def = MODBUS_FUNCTION_CODES.find((f) => f.code === fc)!;
          if (def.isSingle) setQuantity(1);
        }}
        onStartAddressChange={setStartAddress}
        onQuantityChange={setQuantity}
        onValuesTextChange={setValuesText}
        onExecute={handleExecute}
      />

      {/* 最近响应寄存器表格 */}
      <ModbusResponseTable transaction={lastTransaction} />

      {/* 事务日志 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30 shrink-0">
          <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
            {t('serial.modbus.transactionLog', '事务日志')}
            {transactions.length > 0 && (
              <span className="ml-2 text-text-disabled font-normal">({transactions.length})</span>
            )}
          </span>
          {transactions.length > 0 && (
            <button
              onClick={() => { setTransactions([]); setLastTransaction(undefined); }}
              className="flex items-center gap-1 text-[var(--fs-xxs)] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t('serial.modbus.clearLog', '清空')}
            </button>
          )}
        </div>
        <ModbusTransactionLog transactions={[...transactions].reverse()} />
      </div>

      {/* 底部统计栏 */}
      <div className="h-7 flex items-center gap-4 px-4 bg-bg-secondary/50 border-t border-border-default/50 text-[var(--fs-xs)] font-medium shrink-0 select-none">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full transition-colors",
            connected ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-text-disabled"
          )} />
          <span className={cn("transition-colors", connected ? "text-emerald-600 dark:text-emerald-400" : "text-text-tertiary")}>
            {statusText}
          </span>
        </div>
        <div className="w-[1px] h-3 bg-border-default" />
        <span className="text-text-tertiary">
          {t('serial.modbus.transport', '传输方式')}: {transport.toUpperCase()}
        </span>
        <div className="w-[1px] h-3 bg-border-default" />
        <span className="text-text-tertiary">
          {t('serial.modbus.transactions', '事务')}: {transactions.length}
        </span>
        {transactions.length > 0 && (
          <>
            <div className="w-[1px] h-3 bg-border-default" />
            <span className={cn("font-medium", transactions.filter((t) => t.success).length === transactions.length ? "text-emerald-500" : "text-amber-500")}>
              ✓ {transactions.filter((tx) => tx.success).length} / {transactions.length}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
