// 调试工具箱面板 — CRC 计算、数值转换、字节操作
// 作为 devtools-toolbox 插件的前端渲染组件，安装插件后在右侧边栏显示
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════
//  CRC 算法实现
// ═══════════════════════════════════════════

function crc8(bytes: number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80) { crc = ((crc << 1) ^ 0x07) & 0xFF; }
      else { crc = (crc << 1) & 0xFF; }
    }
  }
  return crc;
}

function crc16Modbus(bytes: number[]): number {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) { crc = (crc >> 1) ^ 0xA001; }
      else { crc >>= 1; }
    }
  }
  return crc;
}

function crc16CCITT(bytes: number[]): number {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= (byte << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) { crc = ((crc << 1) ^ 0x1021) & 0xFFFF; }
      else { crc = (crc << 1) & 0xFFFF; }
    }
  }
  return crc;
}

function crc32(bytes: number[]): number {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) { crc = (crc >>> 1) ^ 0xEDB88320; }
      else { crc >>>= 1; }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function checksum8(bytes: number[]): number {
  return bytes.reduce((sum, b) => (sum + b) & 0xFF, 0);
}

function checksum16(bytes: number[]): number {
  return bytes.reduce((sum, b) => (sum + b) & 0xFFFF, 0);
}

function xorCheck(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc ^ b, 0);
}

type CrcAlgorithm = 'crc8' | 'crc16modbus' | 'crc16ccitt' | 'crc32' | 'sum8' | 'sum16' | 'xor';
type InputMode = 'hex' | 'ascii';

function formatBinary(n: number, bits: number): string {
  return n.toString(2).padStart(bits, '0').replace(/(.{4})/g, '$1 ').trim();
}

function parseBits(algo: CrcAlgorithm): number {
  if (algo === 'crc8' || algo === 'sum8' || algo === 'xor') return 8;
  if (algo === 'crc32') return 32;
  return 16;
}

function parseHexBytes(hex: string): number[] | null {
  const parts = hex.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const bytes: number[] = [];
  for (const p of parts) {
    const v = parseInt(p, 16);
    if (isNaN(v) || v < 0 || v > 255) return null;
    bytes.push(v);
  }
  return bytes;
}

function runCrc(bytes: number[], algo: CrcAlgorithm): number {
  switch (algo) {
    case 'crc8': return crc8(bytes);
    case 'crc16modbus': return crc16Modbus(bytes);
    case 'crc16ccitt': return crc16CCITT(bytes);
    case 'crc32': return crc32(bytes);
    case 'sum8': return checksum8(bytes);
    case 'sum16': return checksum16(bytes);
    case 'xor': return xorCheck(bytes);
  }
}

// ── Section A: CRC 计算 ──

function CrcCalculator() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('hex');
  const [algorithm, setAlgorithm] = useState<CrcAlgorithm>('crc16modbus');
  const [result, setResult] = useState<{ value: number; bits: number } | null>(null);
  const [error, setError] = useState('');

  const handleCalculate = useCallback(() => {
    setError('');
    setResult(null);
    let bytes: number[] | null = null;
    if (inputMode === 'hex') {
      bytes = parseHexBytes(input);
      if (!bytes) { setError('HEX 格式错误，请输入空格分隔的十六进制字节，如: FF 01 02'); return; }
    } else {
      bytes = Array.from(new TextEncoder().encode(input));
    }
    if (bytes.length === 0) { setError('输入为空'); return; }
    const value = runCrc(bytes, algorithm);
    setResult({ value, bits: parseBits(algorithm) });
  }, [input, inputMode, algorithm]);

  const algoLabels: Record<CrcAlgorithm, string> = {
    crc8: t('toolbox.crc.algoList.crc8', 'CRC-8'),
    crc16modbus: t('toolbox.crc.algoList.crc16modbus', 'CRC-16/Modbus'),
    crc16ccitt: t('toolbox.crc.algoList.crc16ccitt', 'CRC-16/CCITT'),
    crc32: t('toolbox.crc.algoList.crc32', 'CRC-32'),
    sum8: t('toolbox.crc.algoList.sum8', '累加和 8-bit'),
    sum16: t('toolbox.crc.algoList.sum16', '累加和 16-bit'),
    xor: t('toolbox.crc.algoList.xor', 'XOR 校验'),
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {/* 输入区 */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
            {t('toolbox.crc.inputLabel', '输入')}
          </span>
          {/* 模式切换 */}
          <div className="flex h-6 items-center rounded-[var(--radius-xs)] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
            {(['hex', 'ascii'] as InputMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                className={cn(
                  "h-full px-2.5 text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-colors",
                  inputMode === m
                    ? "bg-accent text-white"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
                )}
              >
                {m === 'hex' ? t('toolbox.crc.inputHex', 'HEX') : t('toolbox.crc.inputAscii', 'ASCII')}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={inputMode === 'hex' ? 'FF 01 02 03 ...' : 'Hello World'}
          rows={3}
          className="w-full rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-3 py-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted resize-none placeholder:text-text-disabled"
        />

        <div className="flex items-center gap-2">
          <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled shrink-0">
            {t('toolbox.crc.algorithm', '算法')}
          </span>
          <div className="relative flex-1">
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as CrcAlgorithm)}
              className="h-7 w-full appearance-none rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 pl-2 pr-6 text-[var(--fs-xs)] font-mono text-text-primary outline-none cursor-pointer"
            >
              {(Object.keys(algoLabels) as CrcAlgorithm[]).map((a) => (
                <option key={a} value={a}>{algoLabels[a]}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
          <button
            onClick={handleCalculate}
            className="wb-primary-btn px-3 bg-accent hover:bg-accent-hover"
          >
            {t('toolbox.crc.calculate', '计算')}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-red-500/30 bg-red-500/5 px-3 py-2 text-[var(--fs-xs)] text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-3 py-2 space-y-1.5">
          <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled mb-1">
            {t('toolbox.crc.result', '计算结果')} — {algoLabels[algorithm]} ({result.bits} {t('toolbox.crc.bits', '位')})
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--fs-xs)] font-mono">
            <div className="flex items-center gap-2">
              <span className="text-text-disabled text-[var(--fs-xxs)] w-[48px] shrink-0">{t('toolbox.crc.decimal', '十进制')}</span>
              <span className="text-text-primary font-medium">{result.value}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-disabled text-[var(--fs-xxs)] w-[48px] shrink-0">{t('toolbox.crc.hex', '十六进制')}</span>
              <span className="text-accent font-medium">
                0x{result.value.toString(16).toUpperCase().padStart(result.bits / 4, '0')}
              </span>
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <span className="text-text-disabled text-[var(--fs-xxs)] w-[48px] shrink-0">{t('toolbox.crc.binary', '二进制')}</span>
              <span className="text-text-secondary">{formatBinary(result.value, result.bits)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Section B: 数值转换器
// ═══════════════════════════════════════════

type NumberInputField = 'dec' | 'hex' | 'bin' | 'float32';

function parseDecInput(s: string): number | null {
  if (s.trim() === '' || s.trim() === '-') return null;
  const n = Number(s.trim());
  return isNaN(n) ? null : n;
}

function formatBytes(n: number, bigEndian: boolean): string {
  const arr = [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
  const ordered = bigEndian ? arr : [...arr].reverse();
  return ordered.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function NumberConverter() {
  const { t } = useTranslation();
  const [activeField, setActiveField] = useState<NumberInputField>('dec');
  const [decVal, setDecVal] = useState('');
  const [hexVal, setHexVal] = useState('');
  const [binVal, setBinVal] = useState('');
  const [floatVal, setFloatVal] = useState('');
  const [error, setError] = useState('');

  const applyFromInt32 = (n: number) => {
    const u32 = n >>> 0;
    setDecVal(String(n | 0));
    setHexVal('0x' + u32.toString(16).toUpperCase().padStart(8, '0'));
    setBinVal(u32.toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim());
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setInt32(0, n | 0, false);
    setFloatVal(view.getFloat32(0, false).toPrecision(7));
    setError('');
  };

  const handleDecChange = (v: string) => {
    setDecVal(v);
    setActiveField('dec');
    const n = parseDecInput(v);
    if (n === null) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    applyFromInt32(n);
  };

  const handleHexChange = (v: string) => {
    setHexVal(v);
    setActiveField('hex');
    const clean = v.trim().replace(/^0x/i, '');
    if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    const n = parseInt(clean, 16);
    if (isNaN(n)) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    setDecVal(String(n | 0));
    setBinVal((n >>> 0).toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim());
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, n >>> 0, false);
    setFloatVal(view.getFloat32(0, false).toPrecision(7));
    setError('');
  };

  const handleBinChange = (v: string) => {
    setBinVal(v);
    setActiveField('bin');
    const clean = v.trim().replace(/\s+/g, '');
    if (!clean || !/^[01]+$/.test(clean)) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    const n = parseInt(clean, 2);
    if (isNaN(n)) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    setDecVal(String(n | 0));
    setHexVal('0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0'));
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, n >>> 0, false);
    setFloatVal(view.getFloat32(0, false).toPrecision(7));
    setError('');
  };

  const handleFloatChange = (v: string) => {
    setFloatVal(v);
    setActiveField('float32');
    const f = parseFloat(v.trim());
    if (isNaN(f)) { setError(t('toolbox.converter.invalidInput', '无效输入')); return; }
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, f, false);
    const u32 = view.getUint32(0, false);
    const i32 = view.getInt32(0, false);
    setDecVal(String(i32));
    setHexVal('0x' + u32.toString(16).toUpperCase().padStart(8, '0'));
    setBinVal(u32.toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim());
    setError('');
  };

  const fields: { key: NumberInputField; label: string; value: string; onChange: (v: string) => void; placeholder: string }[] = [
    { key: 'dec', label: t('toolbox.converter.decimal', '十进制'), value: decVal, onChange: handleDecChange, placeholder: '0' },
    { key: 'hex', label: t('toolbox.converter.hex', '十六进制'), value: hexVal, onChange: handleHexChange, placeholder: '0x00000000' },
    { key: 'bin', label: t('toolbox.converter.binary', '二进制'), value: binVal, onChange: handleBinChange, placeholder: '0000 0000 ...' },
    { key: 'float32', label: t('toolbox.converter.float32', 'Float32'), value: floatVal, onChange: handleFloatChange, placeholder: '0.0' },
  ];

  const u32 = (() => {
    const clean = hexVal.replace(/^0x/i, '');
    const n = parseInt(clean, 16);
    return isNaN(n) ? 0 : n >>> 0;
  })();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label, value, onChange, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {label}
            </label>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={cn(
                "h-7 w-full rounded-[var(--radius-sm)] border bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:ring-1 focus:ring-accent-muted transition-colors",
                activeField === key ? "border-accent" : "border-border-default/60 focus:border-accent"
              )}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="text-[var(--fs-xxs)] text-red-400">{error}</div>
      )}

      {!error && hexVal && (
        <div className="grid grid-cols-2 gap-2 text-[var(--fs-xxs)] font-mono">
          <div className="rounded-[var(--radius-sm)] border border-border-default/50 bg-bg-secondary/30 px-2 py-1.5">
            <div className="text-text-disabled mb-0.5">{t('toolbox.converter.bytes_be', '字节 (大端)')}</div>
            <div className="text-text-secondary">{formatBytes(u32, true)}</div>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-border-default/50 bg-bg-secondary/30 px-2 py-1.5">
            <div className="text-text-disabled mb-0.5">{t('toolbox.converter.bytes_le', '字节 (小端)')}</div>
            <div className="text-text-secondary">{formatBytes(u32, false)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Section C: 字节工具
// ═══════════════════════════════════════════

type ByteOperation = 'swap' | 'invert' | 'and' | 'or';

function ByteTools() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [operation, setOperation] = useState<ByteOperation>('swap');
  const [mask, setMask] = useState('FF');
  const [result, setResult] = useState('');
  const [resultAscii, setResultAscii] = useState('');
  const [error, setError] = useState('');

  const handleApply = useCallback(() => {
    setError('');
    setResult('');
    setResultAscii('');
    const bytes = parseHexBytes(input);
    if (!bytes) { setError('HEX 格式错误，请输入空格分隔的十六进制字节'); return; }
    if (bytes.length === 0) { setError('输入为空'); return; }

    let out: number[] = [];
    switch (operation) {
      case 'swap':
        out = [...bytes].reverse();
        break;
      case 'invert':
        out = bytes.map((b) => (~b) & 0xFF);
        break;
      case 'and': {
        const maskBytes = parseHexBytes(mask);
        if (!maskBytes || maskBytes.length === 0) { setError('掩码格式错误'); return; }
        out = bytes.map((b, i) => b & (maskBytes[i % maskBytes.length]));
        break;
      }
      case 'or': {
        const maskBytes = parseHexBytes(mask);
        if (!maskBytes || maskBytes.length === 0) { setError('掩码格式错误'); return; }
        out = bytes.map((b, i) => b | (maskBytes[i % maskBytes.length]));
        break;
      }
    }

    setResult(out.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    setResultAscii(out.map((b) => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join(''));
  }, [input, operation, mask]);

  const ops: { key: ByteOperation; label: string; hasMask: boolean }[] = [
    { key: 'swap', label: t('toolbox.byteTools.swapEndian', '字节序翻转'), hasMask: false },
    { key: 'invert', label: t('toolbox.byteTools.invertBits', '按位取反'), hasMask: false },
    { key: 'and', label: t('toolbox.byteTools.andMask', 'AND 掩码'), hasMask: true },
    { key: 'or', label: t('toolbox.byteTools.orMask', 'OR 掩码'), hasMask: true },
  ];

  const currentOp = ops.find((o) => o.key === operation)!;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('toolbox.byteTools.inputLabel', 'HEX 输入')}
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="FF 01 02 03 ..."
            className="h-7 w-full rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex h-7 items-center rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
            {ops.map((op) => (
              <button
                key={op.key}
                onClick={() => setOperation(op.key)}
                className={cn(
                  "h-full px-2.5 text-[var(--fs-xxs)] font-semibold tracking-wide transition-colors border-r border-border-default/40 last:border-r-0",
                  operation === op.key
                    ? "bg-accent text-white"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
                )}
              >
                {op.label}
              </button>
            ))}
          </div>
          {currentOp.hasMask && (
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--fs-xxs)] text-text-disabled">{t('toolbox.byteTools.andMask', '掩码')}</span>
              <input
                value={mask}
                onChange={(e) => setMask(e.target.value)}
                placeholder="FF"
                className="h-7 w-[80px] rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-2 text-center text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent-muted"
              />
            </div>
          )}
          <button
            onClick={handleApply}
            className="wb-primary-btn px-3 bg-accent hover:bg-accent-hover"
          >
            {t('toolbox.byteTools.result', '执行')}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-red-500/30 bg-red-500/5 px-3 py-2 text-[var(--fs-xs)] text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-3 py-2 space-y-1.5">
          <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('toolbox.byteTools.result', '结果')}
          </div>
          <div className="space-y-1 text-[var(--fs-xs)] font-mono">
            <div className="text-accent break-all">{result}</div>
            <div className="text-text-tertiary">{resultAscii}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsible Section for sidebar ──

function SidebarSection({ title, icon, defaultOpen = true, children }: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-sidebar last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg-hover transition-colors text-left group"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] bg-accent/10 text-accent shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-[length:var(--fs-sidebar)] font-semibold text-text-primary">{title}</span>
        <svg
          className={cn("w-3.5 h-3.5 text-text-tertiary transition-transform duration-200", open && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  ToolboxPanel — 侧边栏版本（手风琴折叠）
// ═══════════════════════════════════════════

export function ToolboxPanel() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border-sidebar px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
          {t('rightSidebar.toolbox', '工具箱')}
        </span>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">
        <SidebarSection
          title={t('toolbox.crc.title', 'CRC / 校验')}
          icon={<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
          defaultOpen={true}
        >
          <CrcCalculator />
        </SidebarSection>
        <SidebarSection
          title={t('toolbox.converter.title', '数值转换')}
          icon={<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>}
          defaultOpen={false}
        >
          <NumberConverter />
        </SidebarSection>
        <SidebarSection
          title={t('toolbox.byteTools.title', '字节操作')}
          icon={<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>}
          defaultOpen={false}
        >
          <ByteTools />
        </SidebarSection>
      </div>
    </div>
  );
}
