// Modbus 调试面板 — 支持 TCP 和 RTU 两种传输方式
import { useState, useEffect, useRef, useCallback } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  Cpu, Plug, X, RefreshCw, Trash2,
  ChevronDown, ArrowRight, CheckCircle2, AlertCircle, Loader2, Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import * as mbSvc from "@/services/modbusService";
import * as svcSerial from "@/services/serialService";
import { registerConnection, unregisterConnection } from '@/lib/connectionRegistry';
import { useActivityLogStore } from "@/stores/activityLogStore";
import { ProtocolSidebarSection } from "./ProtocolWorkbench";
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 p-1">
          <div className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm">
            <Cpu className="h-3.5 w-3.5" />
            <span>Modbus</span>
          </div>
          <div className="flex flex-1 items-center rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-primary p-0.5">
            {(["tcp", "rtu"] as ModbusTransport[]).map((tp) => (
              <button
                key={tp}
                onClick={() => !connected && onTransportChange(tp)}
                disabled={connected}
                className={cn(
                  "h-7 flex-1 rounded-[var(--radius-sm)] text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-all",
                  transport === tp
                    ? "bg-violet-500/12 text-violet-600 shadow-xs dark:text-violet-300"
                    : "text-text-tertiary hover:text-text-secondary disabled:opacity-50"
                )}
              >
                {tp.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {transport === "tcp" ? (
          <>
            <label className="col-span-2 space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('tcp.hostPlaceholder', '主机地址')}
              </span>
              <input
                value={host}
                onChange={(e) => onHostChange(e.target.value)}
                placeholder={t('tcp.hostPlaceholder', '主机地址')}
                disabled={connected}
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
                disabled={connected}
                className="wb-field w-full"
              />
            </label>
            <div className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t("serial.modbus.transport", "传输")}
              </span>
              <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 px-3 text-[var(--fs-xs)] font-medium text-text-secondary">
                TCP · 502
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="col-span-2 space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('serial.selectPort', '选择串口')}
              </span>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <select
                    value={portName}
                    onChange={(e) => onPortNameChange(e.target.value)}
                    disabled={connected}
                    className="wb-field wb-native-select w-full appearance-none pr-8"
                  >
                    <option value="">{t('serial.selectPort', '选择串口')}</option>
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
                  disabled={connected || loadingPorts}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  title={t('serial.refresh', '刷新串口列表')}
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
                  disabled={connected}
                  className="wb-field wb-native-select w-full appearance-none pr-8"
                >
                  {BAUD_RATES.map((r) => (
                    <option key={r} value={String(r)}>{r}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
              </div>
            </label>
            <div className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t("serial.modbus.transport", "传输")}
              </span>
              <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/35 px-3 text-[var(--fs-xs)] font-medium text-text-secondary">
                RTU · {serialConfig.dataBits}{serialConfig.parity === "none" ? "N" : serialConfig.parity === "even" ? "E" : "O"}{serialConfig.stopBits}
              </div>
            </div>
          </>
        )}
      </div>

      <button
        onClick={onToggle}
        disabled={connecting || (!connected && transport === "tcp" && !host) || (!connected && transport === "rtu" && !portName)}
        className={cn(
          "wb-primary-btn h-10 w-full justify-center px-3",
          connected
            ? "bg-error hover:bg-error/90 hover:shadow-md"
            : connecting
              ? "bg-warning cursor-wait opacity-70"
              : "bg-accent hover:bg-accent-hover hover:shadow-md"
        )}
      >
        {connected ? <X className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
        {connected
          ? t('tcp.disconnect', '断开')
          : connecting
            ? t('tcp.connecting', '连接中...')
            : t('tcp.connect', '连接')}
      </button>
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
  pollingEnabled: boolean;
  pollingInterval: number;
  onUnitIdChange: (v: number) => void;
  onFunctionCodeChange: (v: ModbusFunctionCode) => void;
  onStartAddressChange: (v: number) => void;
  onQuantityChange: (v: number) => void;
  onValuesTextChange: (v: string) => void;
  onExecute: () => void;
  onPollingToggle: () => void;
  onPollingIntervalChange: (v: number) => void;
}

function ModbusFunctionPanel({
  connected, executing,
  unitId, functionCode, startAddress, quantity, valuesText,
  pollingEnabled, pollingInterval,
  onUnitIdChange, onFunctionCodeChange, onStartAddressChange, onQuantityChange, onValuesTextChange,
  onExecute, onPollingToggle, onPollingIntervalChange,
}: ModbusFunctionPanelProps) {
  const { t } = useTranslation();
  const fcDef = MODBUS_FUNCTION_CODES.find((f) => f.code === functionCode)!;

  return (
    <div className="space-y-3">
      <label className="space-y-1">
        <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('serial.modbus.functionCode', '功能码')}
        </span>
        <div className="relative">
          <select
            value={functionCode}
            onChange={(e) => onFunctionCodeChange(Number(e.target.value) as ModbusFunctionCode)}
            disabled={executing}
            className="wb-field wb-native-select w-full appearance-none pr-8"
          >
            {MODBUS_FUNCTION_CODES.map((f) => (
              <option key={f.code} value={f.code}>
                {t(FC_I18N_KEY[f.code], `FC${String(f.code).padStart(2, "0")}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
        </div>
      </label>

      <div className={cn("grid gap-2", fcDef.isSingle ? "grid-cols-2" : "grid-cols-3")}>
        <label className="space-y-1">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.unitId', '从站地址')}
          </span>
          <input
            type="number"
            min={0}
            max={247}
            value={unitId}
            onChange={(e) => onUnitIdChange(Math.min(247, Math.max(0, parseInt(e.target.value) || 0)))}
            disabled={executing}
            className="wb-field w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.startAddress', '起始地址')}
          </span>
          <input
            type="number"
            min={0}
            max={65535}
            value={startAddress}
            onChange={(e) => onStartAddressChange(Math.min(65535, Math.max(0, parseInt(e.target.value) || 0)))}
            disabled={executing}
            className="wb-field w-full"
          />
        </label>
        {!fcDef.isSingle ? (
          <label className="space-y-1">
            <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {t('serial.modbus.quantity', '数量')}
            </span>
            <input
              type="number"
              min={1}
              max={fcDef.maxQuantity}
              value={quantity}
              onChange={(e) => onQuantityChange(Math.min(fcDef.maxQuantity, Math.max(1, parseInt(e.target.value) || 1)))}
              disabled={executing || fcDef.isSingle}
              className="wb-field w-full"
            />
          </label>
        ) : null}
      </div>

      {fcDef.isWrite ? (
        <label className="space-y-1">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('serial.modbus.values', '写入值 (十进制，空格分隔)')}
            {fcDef.isSingle && functionCode === 5 ? (
              <span className="ml-2 normal-case font-normal text-text-tertiary">
                {t('serial.modbus.coilHint', '线圈: 1 = ON, 0 = OFF')}
              </span>
            ) : null}
          </span>
          <textarea
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
            rows={3}
            className="min-h-[88px] w-full resize-none rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/30 px-3 py-2 text-[var(--fs-sm)] font-mono text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent-muted disabled:opacity-60"
          />
        </label>
      ) : null}

      <div className="space-y-2 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2.5">
        <button
          onClick={onPollingToggle}
          disabled={!connected}
          className={cn(
            "flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-[var(--fs-xs)] font-semibold transition-colors",
            pollingEnabled && connected
              ? "border-amber-500/40 bg-amber-500/12 text-amber-500"
              : "border-border-default/60 text-text-disabled hover:text-text-secondary disabled:opacity-50"
          )}
          title={t('serial.modbus.pollingToggle', '轮询')}
        >
          {pollingEnabled && connected
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          {t('serial.modbus.polling', '轮询')}
        </button>
        {pollingEnabled ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={100}
              max={60000}
              value={pollingInterval}
              onChange={(e) => onPollingIntervalChange(Math.max(100, parseInt(e.target.value) || 1000))}
              className="wb-field w-[120px]"
            />
            <span className="text-[var(--fs-xxs)] text-text-disabled">ms</span>
          </div>
        ) : (
          <div className="text-[var(--fs-3xs)] text-text-disabled">
            {t('serial.modbus.pollingHint', '开启后会按固定间隔重复执行当前功能码，用于连续观测。')}
          </div>
        )}
      </div>

      <button
        onClick={onExecute}
        disabled={!connected || executing}
        className={cn(
          "wb-primary-btn h-10 w-full justify-center",
          connected && !executing
            ? "bg-accent hover:bg-accent-hover hover:shadow-md"
            : "cursor-not-allowed opacity-50"
        )}
      >
        {executing ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t('serial.modbus.executing', '执行中...')}
          </>
        ) : (
          <>
            <ArrowRight className="h-3.5 w-3.5" />
            {t('serial.modbus.execute', '执行')}
          </>
        )}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Modbus 异常码解码
// ═══════════════════════════════════════════

const MODBUS_EXCEPTION_CODES: Record<number, string> = {
  1: '非法功能码',
  2: '非法数据地址',
  3: '非法数据值',
  4: '从站设备故障',
  5: '确认(ACK)',
  6: '从站设备忙',
  8: '存储奇偶错误',
  10: '网关路径不可用',
  11: '网关目标无响应',
};

function parseModbusException(errMsg: string): string | null {
  const match = errMsg.match(/exception\s+(?:code\s+)?(?:0x)?([0-9a-fA-F]+)/i)
    || errMsg.match(/error\s+(?:code\s+)?(?:0x)?([0-9a-fA-F]+)/i)
    || errMsg.match(/(?:code|exception)[:\s]+(?:0x)?([0-9a-fA-F]+)/i);
  if (match) {
    const code = parseInt(match[1], 16) || parseInt(match[1], 10);
    return MODBUS_EXCEPTION_CODES[code] ?? null;
  }
  // Try scanning for bare numbers 1-11
  for (const [code, desc] of Object.entries(MODBUS_EXCEPTION_CODES)) {
    if (errMsg.includes(`(${code})`) || errMsg.includes(` ${code} `) || errMsg.endsWith(` ${code}`)) {
      return desc;
    }
  }
  return null;
}

// ═══════════════════════════════════════════
//  数据类型解析工具
// ═══════════════════════════════════════════

type ModbusDataType = 'uint16' | 'int16' | 'uint32-be' | 'uint32-le' | 'int32-be' | 'int32-le' | 'float32-be' | 'float32-le';

function decodeRegisters(registers: number[], dataType: ModbusDataType): string[] {
  const results: string[] = new Array(registers.length).fill('—');
  switch (dataType) {
    case 'uint16':
      registers.forEach((v, i) => { results[i] = String(v); });
      break;
    case 'int16':
      registers.forEach((v, i) => { results[i] = String(v > 32767 ? v - 65536 : v); });
      break;
    case 'uint32-be':
    case 'int32-be': {
      for (let i = 0; i + 1 < registers.length; i += 2) {
        const val32 = ((registers[i] << 16) | registers[i + 1]) >>> 0;
        const decoded = dataType === 'int32-be' ? (val32 > 0x7FFFFFFF ? val32 - 0x100000000 : val32) : val32;
        results[i] = String(decoded);
        results[i + 1] = '↑';
      }
      break;
    }
    case 'uint32-le':
    case 'int32-le': {
      for (let i = 0; i + 1 < registers.length; i += 2) {
        const val32 = ((registers[i + 1] << 16) | registers[i]) >>> 0;
        const decoded = dataType === 'int32-le' ? (val32 > 0x7FFFFFFF ? val32 - 0x100000000 : val32) : val32;
        results[i] = String(decoded);
        results[i + 1] = '↑';
      }
      break;
    }
    case 'float32-be': {
      for (let i = 0; i + 1 < registers.length; i += 2) {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint16(0, registers[i], false);
        view.setUint16(2, registers[i + 1], false);
        results[i] = view.getFloat32(0, false).toPrecision(7);
        results[i + 1] = '↑';
      }
      break;
    }
    case 'float32-le': {
      for (let i = 0; i + 1 < registers.length; i += 2) {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint16(0, registers[i + 1], false);
        view.setUint16(2, registers[i], false);
        results[i] = view.getFloat32(0, false).toPrecision(7);
        results[i + 1] = '↑';
      }
      break;
    }
  }
  return results;
}

// ═══════════════════════════════════════════
//  响应寄存器表格
// ═══════════════════════════════════════════

function ModbusResponseTable({
  transaction,
  dataType,
  onDataTypeChange,
  integrated = false,
}: {
  transaction: ModbusTransaction | undefined;
  dataType: ModbusDataType;
  onDataTypeChange: (dt: ModbusDataType) => void;
  integrated?: boolean;
}) {
  const { t } = useTranslation();
  if (!transaction) {
    return (
      <div className={cn(
        "flex h-full min-h-[240px] flex-col overflow-hidden border border-border-default/80 bg-bg-primary",
        integrated ? "rounded-t-[var(--radius-md)] border-b-0" : "rounded-[var(--radius-md)]"
      )}>
        <div className="flex items-center justify-between border-b border-border-default/60 bg-bg-secondary/30 px-3 py-2">
          <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
            {t('serial.modbus.responseRegisters', '响应寄存器')}
          </span>
          <span className="text-[var(--fs-xxs)] text-text-disabled">
            {t('serial.modbus.waitingResponse', '等待执行请求')}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="space-y-2">
            <div className="text-[var(--fs-sm)] font-semibold text-text-secondary">
              {t('serial.modbus.noResponseYet', '还没有响应数据')}
            </div>
            <div className="text-[var(--fs-xs)] text-text-disabled">
              {t('serial.modbus.noResponseHint', '先在左侧配置功能码并执行，请求结果会在这里展示寄存器、十六进制和解析值。')}
            </div>
          </div>
        </div>
      </div>
    );
  }
  const resp = transaction.response;
  const isCoil = transaction.functionCode === 1 || transaction.functionCode === 2;

  const rows: { address: number; value: number }[] = [];
  if (resp?.registers) {
    resp.registers.forEach((v, i) => rows.push({ address: transaction.startAddress + i, value: v }));
  } else if (resp?.coils) {
    resp.coils.forEach((v, i) => rows.push({ address: transaction.startAddress + i, value: v ? 1 : 0 }));
  }

  const decodedValues = (!isCoil && resp?.registers)
    ? decodeRegisters(resp.registers, dataType)
    : [];

  const exceptionHint = !transaction.success && transaction.error
    ? parseModbusException(transaction.error)
    : null;

  const DATA_TYPE_OPTIONS: { value: ModbusDataType; label: string }[] = [
    { value: 'uint16', label: 'UINT16' },
    { value: 'int16', label: 'INT16' },
    { value: 'uint32-be', label: 'UINT32 BE' },
    { value: 'uint32-le', label: 'UINT32 LE' },
    { value: 'int32-be', label: 'INT32 BE' },
    { value: 'int32-le', label: 'INT32 LE' },
    { value: 'float32-be', label: 'FLOAT32 BE' },
    { value: 'float32-le', label: 'FLOAT32 LE' },
  ];

  return (
    <div className={cn(
      "shrink-0 border border-border-default/80 bg-bg-primary overflow-hidden",
      integrated ? "h-full rounded-t-[var(--radius-md)] border-b-0" : "rounded-[var(--radius-md)]"
    )}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30">
        <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
          {t('serial.modbus.responseRegisters', '响应寄存器')}
        </span>
        <div className="flex items-center gap-2">
          {!isCoil && rows.length > 0 && (
            <div className="relative">
              <select
                value={dataType}
                onChange={(e) => onDataTypeChange(e.target.value as ModbusDataType)}
                className="h-6 appearance-none rounded-[var(--radius-xs)] border border-border-default/60 bg-bg-secondary/40 pl-2 pr-5 text-[var(--fs-xxs)] font-mono text-text-secondary outline-none cursor-pointer"
              >
                {DATA_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
            </div>
          )}
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

      {exceptionHint && (
        <div className="px-3 py-1.5 border-b border-red-500/20 bg-red-500/5 flex items-center gap-2 text-[var(--fs-xxs)]">
          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
          <span className="text-red-400 font-medium">{t('serial.modbus.exceptionDesc', 'Modbus 异常')}: {exceptionHint}</span>
        </div>
      )}

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
                {!isCoil && decodedValues.length > 0 && (
                  <th className="px-3 py-1.5 text-left font-semibold text-text-disabled w-[110px]">
                    {t('serial.modbus.parsedValue', '解析值')}
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
                  {!isCoil && decodedValues.length > 0 && (
                    <td className={cn("px-3 py-1.5 tabular-nums", decodedValues[i] === '↑' ? "text-border-default/60" : "text-accent font-medium")}>
                      {decodedValues[i]}
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
            "mx-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[var(--fs-xs)] font-mono",
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

export function ModbusPanel({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
  const { t } = useTranslation();
  const connId = useRef(`modbus:${sessionKey}`).current;

  // ── 连接状态 ──
  const [transport, setTransport] = useState<ModbusTransport>("tcp");
  const transportRef = useRef<ModbusTransport>("tcp");
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

  // ── 轮询 ──
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(1000);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 数据类型解析 ──
  const [dataType, setDataType] = useState<ModbusDataType>('uint16');

  // ── 结果 ──
  const [transactions, setTransactions] = useState<ModbusTransaction[]>([]);
  const [lastTransaction, setLastTransaction] = useState<ModbusTransaction | undefined>();

  // ── Unit ID 扫描 ──
  const [showScan, setShowScan] = useState(false);
  const [scanFrom, setScanFrom] = useState(1);
  const [scanTo, setScanTo] = useState(10);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<{ unitId: number; ok: boolean; ms: number }[]>([]);
  const scanAbortRef = useRef(false);

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
  useEffect(() => { transportRef.current = transport; }, [transport]);

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
            registerConnection(sessionKey, connId, `Modbus ${transportRef.current.toUpperCase()}`);
            break;
          case "disconnected":
            setConnected(false);
            setConnecting(false);
            unregisterConnection(sessionKey, connId);
            break;
          case "error":
            setConnected(false);
            setConnecting(false);
            unregisterConnection(sessionKey, connId);
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
      unregisterConnection(sessionKey, connId);
      mbSvc.modbusTcpDisconnect(connId).catch(() => {});
      mbSvc.modbusRtuClose(connId).catch(() => {});
    };
  }, [connId]);

  // ── 轮询 useEffect ──
  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (pollingEnabled && connected) {
      pollingRef.current = setInterval(() => {
        handleExecute();
      }, pollingInterval);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingEnabled, connected, pollingInterval]);

  // ── 连接 / 断开 ──
  const handleToggleConnection = async () => {
    if (connected) {
      unregisterConnection(sessionKey, connId);
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

  // ── Unit ID 扫描 ──
  const handleScan = useCallback(async () => {
    if (!connected || scanning) return;
    scanAbortRef.current = false;
    setScanning(true);
    setScanResults([]);
    for (let uid = scanFrom; uid <= scanTo; uid++) {
      if (scanAbortRef.current) break;
      const t0 = Date.now();
      try {
        await mbSvc.modbusExecute(connId, uid, 3, 0, 1, []);
        setScanResults((prev) => [...prev, { unitId: uid, ok: true, ms: Date.now() - t0 }]);
      } catch {
        setScanResults((prev) => [...prev, { unitId: uid, ok: false, ms: Date.now() - t0 }]);
      }
    }
    setScanning(false);
  }, [connected, scanning, scanFrom, scanTo, connId]);

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
  const successCount = transactions.filter((tx) => tx.success).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className={cn("grid min-h-0 flex-1 gap-3", compact ? "xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]" : "xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]")}>
        <div className={cn("min-h-0 overflow-auto", compact ? "pr-0" : "pr-1")}>
          <div className={cn(compact ? "space-y-2.5" : "space-y-3")}>
            <ProtocolSidebarSection
              title={t('tcp.sidebar.connection', '连接设置')}
              description={t('serial.modbus.sidebarConnectionDesc', '先选择传输方式和目标设备，再建立连接；需要找设备时可打开单元地址扫描。')}
              compact={compact}
              showDescriptionInCompact={compact}
              action={
                <button
                  onClick={() => setShowScan((v) => !v)}
                  disabled={!connected}
                  className={cn(
                    "wb-tool-chip cursor-pointer transition-colors disabled:opacity-50",
                    showScan && "border-accent/40 bg-accent-soft text-accent"
                  )}
                  title={t('serial.modbus.unitScan', '单元地址扫描')}
                >
                  <Search className="h-3 w-3" />
                  {t('serial.modbus.scan', '扫描')}
                </button>
              }
            >
              <ModbusConnectionBar
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
                onSerialConfigChange={(p) => setSerialConfig((c) => ({ ...c, ...p }))}
                onRefreshPorts={refreshPorts}
                connected={connected}
                connecting={connecting}
                onToggle={handleToggleConnection}
              />
            </ProtocolSidebarSection>

            {showScan ? (
              <ProtocolSidebarSection
                title={t('serial.modbus.unitScan', '单元地址扫描')}
                description={t('serial.modbus.scanHint', '扫描常见 Unit ID，找到响应设备后可一键带回左侧表单。')}
                compact={compact}
                action={
                  <button
                    onClick={() => { setShowScan(false); scanAbortRef.current = true; }}
                    className="rounded-[var(--radius-sm)] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                }
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                    <label className="space-y-1">
                      <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                        From
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={247}
                        value={scanFrom}
                        onChange={(e) => setScanFrom(Math.max(1, Math.min(247, parseInt(e.target.value) || 1)))}
                        disabled={scanning}
                        className="wb-field w-full"
                      />
                    </label>
                    <div className="pb-2 text-center text-[var(--fs-xxs)] text-text-disabled">—</div>
                    <label className="space-y-1">
                      <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                        To
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={247}
                        value={scanTo}
                        onChange={(e) => setScanTo(Math.max(1, Math.min(247, parseInt(e.target.value) || 10)))}
                        disabled={scanning}
                        className="wb-field w-full"
                      />
                    </label>
                  </div>

                  <button
                    onClick={scanning ? () => { scanAbortRef.current = true; } : handleScan}
                    disabled={!connected}
                    className={cn(
                      "wb-primary-btn h-10 w-full justify-center",
                      scanning
                        ? "bg-error hover:bg-error/90"
                        : "bg-accent hover:bg-accent-hover"
                    )}
                  >
                    {scanning ? (
                      <><X className="h-3.5 w-3.5" />{t('serial.modbus.stopScan', '停止')}</>
                    ) : (
                      <><ArrowRight className="h-3.5 w-3.5" />{t('serial.modbus.startScan', '扫描')}</>
                    )}
                  </button>

                  {scanResults.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-[var(--fs-3xs)] text-text-disabled">
                        {scanResults.filter((r) => r.ok).length} / {scanResults.length} {t('serial.modbus.found', '响应')}
                      </div>
                      <div className="max-h-[180px] space-y-1 overflow-y-auto">
                        {scanResults.map((r) => (
                          <div
                            key={r.unitId}
                            className={cn(
                              "flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-[var(--fs-xxs)] font-mono",
                              r.ok ? "bg-emerald-500/5 text-emerald-600" : "bg-bg-secondary/20 text-text-disabled"
                            )}
                          >
                            {r.ok
                              ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                              : <span className="h-3 w-3 shrink-0" />}
                            <span className="font-semibold">UID {r.unitId}</span>
                            <span className="text-text-disabled">{r.ms}ms</span>
                            {r.ok ? (
                              <button
                                onClick={() => setUnitId(r.unitId)}
                                className="ml-auto text-accent hover:underline text-[var(--fs-3xs)]"
                              >
                                {t('serial.modbus.useThisUnit', '使用')}
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {scanning ? (
                          <div className="flex items-center gap-2 px-2 py-1 text-[var(--fs-xxs)] text-text-disabled animate-pulse">
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            {t('serial.modbus.scanning', '扫描中...')} UID {(scanResults[scanResults.length - 1]?.unitId ?? scanFrom) + 1}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </ProtocolSidebarSection>
            ) : null}

            <ProtocolSidebarSection
              title={t('serial.modbus.requestConfig', '请求配置')}
              description={t('serial.modbus.requestConfigDesc', '选择功能码、目标地址和数量，写操作可直接填写写入值。')}
              compact={compact}
            >
              <ModbusFunctionPanel
                connected={connected}
                executing={executing}
                unitId={unitId}
                functionCode={functionCode}
                startAddress={startAddress}
                quantity={quantity}
                valuesText={valuesText}
                pollingEnabled={pollingEnabled}
                pollingInterval={pollingInterval}
                onUnitIdChange={setUnitId}
                onFunctionCodeChange={(fc) => {
                  setFunctionCode(fc);
                  const def = MODBUS_FUNCTION_CODES.find((f) => f.code === fc)!;
                  if (def.isSingle) setQuantity(1);
                }}
                onStartAddressChange={setStartAddress}
                onQuantityChange={setQuantity}
                onValuesTextChange={setValuesText}
                onExecute={handleExecute}
                onPollingToggle={() => setPollingEnabled((v) => !v)}
                onPollingIntervalChange={setPollingInterval}
              />
            </ProtocolSidebarSection>

            <ProtocolSidebarSection
              title={t('serial.modbus.sessionStatus', '会话状态')}
              description={t('serial.modbus.sessionStatusDesc', '在左侧持续掌握当前连接、事务执行和最近一次请求结果。')}
              compact={compact}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      {t('tcp.sidebar.connection', '连接设置')}
                    </div>
                    <div className={cn("mt-1 text-[var(--fs-xs)] font-semibold", connected ? "text-emerald-600 dark:text-emerald-400" : "text-text-secondary")}>
                      {statusText}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      {t('serial.modbus.transport', '传输方式')}
                    </div>
                    <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">
                      {transport.toUpperCase()}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      {t('serial.modbus.transactions', '事务')}
                    </div>
                    <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-secondary">
                      {transactions.length}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      {t('serial.modbus.successRate', '成功')}
                    </div>
                    <div className={cn("mt-1 text-[var(--fs-xs)] font-semibold", successCount === transactions.length && transactions.length > 0 ? "text-emerald-500" : "text-text-secondary")}>
                      {successCount} / {transactions.length}
                    </div>
                  </div>
                </div>

                {lastTransaction ? (
                  <div className="rounded-[var(--radius-md)] border border-border-default/60 bg-bg-secondary/20 px-3 py-2.5">
                    <div className="text-[var(--fs-3xs)] uppercase tracking-[0.08em] text-text-disabled">
                      {t('serial.modbus.lastTransaction', '最近请求')}
                    </div>
                    <div className="mt-1 text-[var(--fs-xs)] font-semibold text-text-primary">
                      {t(FC_I18N_KEY[lastTransaction.functionCode], `FC${String(lastTransaction.functionCode).padStart(2, "0")}`)}
                    </div>
                    <div className="mt-1 text-[var(--fs-xxs)] text-text-tertiary">
                      UID {lastTransaction.unitId} · Addr {lastTransaction.startAddress}
                      {lastTransaction.quantity > 1 ? ` × ${lastTransaction.quantity}` : ""}
                    </div>
                    <div className={cn("mt-1 text-[var(--fs-xxs)]", lastTransaction.success ? "text-emerald-500" : "text-red-500")}>
                      {lastTransaction.success ? t('serial.modbus.execute', '执行') : lastTransaction.error}
                    </div>
                  </div>
                ) : null}
              </div>
            </ProtocolSidebarSection>
          </div>
        </div>

        <div className="min-h-0 h-full overflow-hidden">
          <PanelGroup orientation="vertical">
            <Panel defaultSize={58} minSize={34}>
              <div className="h-full min-h-0">
                <ModbusResponseTable
                  transaction={lastTransaction}
                  dataType={dataType}
                  onDataTypeChange={setDataType}
                  integrated
                />
              </div>
            </Panel>
            <PanelResizeHandle className="wb-workbench-divider wb-workbench-divider--flush" />
            <Panel defaultSize={42} minSize={20}>
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-b-[var(--radius-md)] border border-t-0 border-border-default/80 bg-bg-primary">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30 shrink-0">
                  <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                    {t('serial.modbus.transactionLog', '事务日志')}
                    {transactions.length > 0 ? (
                      <span className="ml-2 font-normal text-text-disabled">({transactions.length})</span>
                    ) : null}
                  </span>
                  {transactions.length > 0 ? (
                    <button
                      onClick={() => { setTransactions([]); setLastTransaction(undefined); }}
                      className="flex items-center gap-1 text-[var(--fs-xxs)] text-text-tertiary transition-colors hover:text-text-secondary"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('serial.modbus.clearLog', '清空')}
                    </button>
                  ) : null}
                </div>
                <ModbusTransactionLog transactions={[...transactions].reverse()} />
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>

      {!compact ? (
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
            <span className={cn("font-medium", successCount === transactions.length ? "text-emerald-500" : "text-amber-500")}>
              ✓ {successCount} / {transactions.length}
            </span>
          </>
        )}
        </div>
      ) : null}
    </div>
  );
}
