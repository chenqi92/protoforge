/**
 * ResponseExportDropdown — 工具栏导出按钮
 *
 * 流程：选节点 → 选格式 → 导出
 * 每个格式独立导出，不阻塞其他格式。
 *
 * 右键菜单导出由 GlobalContextMenu 独立处理，与此组件无耦合。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';

/* ── JSON 数组扫描 ── */

export interface ArrayNodeInfo {
  path: string;
  length: number;
}

export function findArrayNodes(obj: unknown, prefix = ''): ArrayNodeInfo[] {
  const result: ArrayNodeInfo[] = [];
  if (Array.isArray(obj)) {
    result.push({ path: prefix || '(root)', length: obj.length });
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      for (const [key, val] of Object.entries(obj[0])) {
        const childPath = prefix ? `${prefix}[0].${key}` : `[0].${key}`;
        result.push(...findArrayNodes(val, childPath));
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, val] of Object.entries(obj)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      result.push(...findArrayNodes(val, childPath));
    }
  }
  return result;
}

export function getByPath(obj: unknown, path: string): unknown {
  if (path === '(root)') return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 从数组前几行采样收集列名（无需遍历全量数据） */
export function collectColumnsFromArray(arr: unknown[]): string[] {
  const seen = new Map<string, true>();
  const sample = Math.min(arr.length, 5);
  for (let i = 0; i < sample; i++) {
    const item = arr[i];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item)) if (!seen.has(key)) seen.set(key, true);
    }
  }
  return seen.size > 0 ? [...seen.keys()] : ['value'];
}

/* ── 格式定义 ── */

export interface FormatDef {
  id: string;
  name: string;
  extension: string;
  needsOptions?: boolean;
}

export const EXPORT_FORMATS: FormatDef[] = [
  { id: 'csv', name: 'CSV', extension: '.csv' },
  { id: 'excel', name: 'Excel (.xlsx)', extension: '.xlsx' },
  { id: 'markdown', name: 'Markdown Table', extension: '.md' },
  { id: 'mysql', name: 'MySQL INSERT', extension: '.sql', needsOptions: true },
  { id: 'postgresql', name: 'PostgreSQL INSERT', extension: '.sql', needsOptions: true },
  { id: 'sqlite', name: 'SQLite INSERT', extension: '.sql', needsOptions: true },
  { id: 'influxdb', name: 'InfluxDB Line Protocol', extension: '.txt', needsOptions: true },
];

/* ── Rust 返回类型 ── */

interface ExportDataResult {
  content: string | null;
  binaryBase64: string | null;
  filename: string;
  mimeType: string;
  error: string | null;
}

/* ── 核心导出函数（独立，不依赖组件状态） ── */

export async function doExportToFile(
  body: string,
  jsonPath: string,
  fmt: FormatDef,
  options: Record<string, string> = {},
): Promise<string | null> {
  try {
    const result = await invoke<ExportDataResult>('export_response_data', {
      body,
      jsonPath,
      format: fmt.id,
      options,
    });

    if (result.error) return result.error;

    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: result.filename,
      filters: [{ name: fmt.name, extensions: [fmt.extension.replace(/^\./, '')] }],
    });

    if (path) {
      if (result.content != null) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, result.content);
      } else if (result.binaryBase64 != null) {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const raw = atob(result.binaryBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        await writeFile(path, bytes);
      }
    }
    return null;
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    console.warn('[ProtoForge] export error:', msg);
    return msg;
  }
}

/* ── 工具栏组件 ── */

export function ResponseExportDropdown({ body }: { body: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // 步骤
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<FormatDef | null>(null);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  // SQL 字段选择 + 别名
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [aliases, setAliases] = useState<Record<string, string>>({});

  // 每个格式的独立状态：idle / loading / done / error
  const [formatStates, setFormatStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});

  const arrayNodes = useMemo<ArrayNodeInfo[]>(() => {
    try { return findArrayNodes(JSON.parse(body)); }
    catch { return []; }
  }, [body]);

  const hasArrays = arrayNodes.length > 0;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return;
      closePanel();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const closePanel = () => { setOpen(false); setStep(1); setSelectedFormat(null); setOptionValues({}); setFormatStates({}); };

  const handleToggle = () => {
    if (open) { closePanel(); return; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setSelectedPath(arrayNodes[0]?.path || '');
    setStep(1);
    setFormatStates({});
    setOpen(true);
  };

  /** 非阻塞导出 — 每个格式独立 loading，不影响其他 */
  const handleExportFormat = (fmt: FormatDef) => {
    if (fmt.needsOptions) {
      setSelectedFormat(fmt);
      setOptionValues(
        fmt.id === 'influxdb' ? { measurement: 'data', tagKeys: '' } : { tableName: 'table_name' }
      );
      // SQL 格式需要解析列信息
      if (fmt.id !== 'influxdb') {
        try {
          const arr = getByPath(JSON.parse(body), selectedPath);
          const cols = Array.isArray(arr) ? collectColumnsFromArray(arr) : [];
          setAllColumns(cols);
          setSelectedCols(new Set(cols));
          setAliases({});
        } catch { setAllColumns([]); setSelectedCols(new Set()); }
      }
      setStep(3);
      return;
    }
    fireExport(fmt, {});
  };

  const fireExport = (fmt: FormatDef, opts: Record<string, string>) => {
    setFormatStates((prev) => ({ ...prev, [fmt.id]: 'loading' }));
    doExportToFile(body, selectedPath, fmt, opts).then((err) => {
      setFormatStates((prev) => ({ ...prev, [fmt.id]: err ? 'error' : 'done' }));
      // 3 秒后重置为 idle
      setTimeout(() => setFormatStates((prev) => ({ ...prev, [fmt.id]: 'idle' })), 3000);
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={hasArrays ? handleToggle : undefined}
        disabled={!hasArrays}
        className={cn(
          "h-6 w-6 flex items-center justify-center rounded-md transition-colors",
          hasArrays ? "text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer" : "text-text-disabled cursor-not-allowed"
        )}
        title={t('response.exportData', '导出数据')}
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[var(--z-toast)] min-w-[260px] max-w-[360px] pf-rounded-md border border-border-default bg-bg-primary shadow-xl shadow-black/8 overflow-hidden"
          style={{ top: pos.top, right: pos.right }}
        >
          {step === 1 && (
            <div className="p-1.5">
              <div className="px-3 py-1.5 pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-disabled">
                {t('response.selectJsonPath', '选择数组节点')}
              </div>
              {arrayNodes.map((node) => (
                <button
                  key={node.path}
                  onClick={() => { setSelectedPath(node.path); setStep(2); }}
                  className="w-full flex items-center justify-between gap-2 pf-rounded-sm px-3 py-1.5 text-left pf-text-sm text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <span className="font-mono truncate">
                    {node.path === '(root)' ? t('response.rootArray', '(根数组)') : node.path}
                  </span>
                  <span className="pf-text-xxs text-text-disabled shrink-0">{node.length} {t('response.rows', '行')}</span>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="p-1.5">
              <div className="px-3 py-1 pf-text-xxs text-text-disabled flex items-center justify-between">
                <span className="font-mono truncate">{selectedPath === '(root)' ? t('response.rootArray', '(根数组)') : selectedPath}</span>
                {arrayNodes.length > 1 && (
                  <button onClick={() => setStep(1)} className="text-accent hover:underline ml-2 shrink-0">{t('response.changePath', '切换')}</button>
                )}
              </div>
              <div className="px-3 py-1 pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-disabled">
                {t('response.exportAs', '导出为')}
              </div>
              {EXPORT_FORMATS.map((fmt) => {
                const state = formatStates[fmt.id] || 'idle';
                return (
                  <button
                    key={fmt.id}
                    onClick={() => handleExportFormat(fmt)}
                    disabled={state === 'loading'}
                    className="w-full flex items-center justify-between gap-2 pf-rounded-sm px-3 py-1.5 text-left pf-text-sm text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-60"
                  >
                    <span className="font-medium">{fmt.name}</span>
                    {state === 'loading' && <Loader2 className="w-3 h-3 animate-spin text-text-disabled" />}
                    {state === 'done' && <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-300" />}
                    {state === 'error' && <span className="pf-text-xxs text-red-500 dark:text-red-300">!</span>}
                    {state === 'idle' && <span className="pf-text-xxs text-text-disabled">{fmt.extension}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {step === 3 && selectedFormat && (
            <div className="flex flex-col" style={{ width: selectedFormat.id !== 'influxdb' ? 420 : undefined }}>
              <div className="px-3 py-2 border-b border-border-default/60">
                <span className="pf-text-sm font-semibold text-text-primary">{selectedFormat.name}</span>
              </div>
              <div className="p-3 space-y-2 max-h-[400px] overflow-auto">
                {selectedFormat.id === 'influxdb' ? (
                  <>
                    <label className="block pf-text-xs text-text-secondary">Measurement</label>
                    <input value={optionValues.measurement || ''} onChange={(e) => setOptionValues((p) => ({ ...p, measurement: e.target.value }))}
                      className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" placeholder="measurement" />
                    <label className="block pf-text-xs text-text-secondary mt-2">Tag Keys (逗号分隔)</label>
                    <input value={optionValues.tagKeys || ''} onChange={(e) => setOptionValues((p) => ({ ...p, tagKeys: e.target.value }))}
                      className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" placeholder="device_id,city" />
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block pf-text-xs text-text-secondary mb-1">{t('response.tableName', '表名')}</label>
                      <input value={optionValues.tableName || ''} onChange={(e) => setOptionValues((p) => ({ ...p, tableName: e.target.value }))}
                        className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" placeholder="table_name" />
                    </div>
                    {allColumns.length > 0 && (
                      <div>
                        <label className="block pf-text-xs text-text-secondary mb-1">
                          字段选择 ({selectedCols.size}/{allColumns.length})
                          <button className="ml-2 text-accent pf-text-xxs hover:underline"
                            onClick={() => setSelectedCols(selectedCols.size === allColumns.length ? new Set() : new Set(allColumns))}>
                            {selectedCols.size === allColumns.length ? '取消全选' : '全选'}
                          </button>
                        </label>
                        <div className="max-h-[200px] overflow-auto border border-border-default/60 pf-rounded-sm">
                          {allColumns.map((col) => (
                            <div key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-bg-hover/50 border-b border-border-default/30 last:border-0">
                              <input type="checkbox" checked={selectedCols.has(col)}
                                onChange={() => setSelectedCols((prev) => { const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col); return n; })}
                                className="rounded border-border-default shrink-0" />
                              <span className="pf-text-xs font-mono text-text-primary min-w-[80px] truncate">{col}</span>
                              <span className="pf-text-xxs text-text-disabled">→</span>
                              <input
                                value={aliases[col] || ''} placeholder={col}
                                onChange={(e) => setAliases((p) => ({ ...p, [col]: e.target.value }))}
                                className="flex-1 px-1.5 py-0.5 pf-rounded-sm border border-border-default/40 bg-transparent pf-text-xs text-text-secondary placeholder:text-text-disabled/50 min-w-0" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2 px-3 py-2 border-t border-border-default/60">
                <button onClick={() => setStep(2)} className="px-3 py-1 pf-rounded-sm pf-text-xs text-text-secondary hover:bg-bg-hover">{t('response.cancel', '返回')}</button>
                <button
                  onClick={() => {
                    const opts = { ...optionValues };
                    if (selectedFormat.id !== 'influxdb' && selectedCols.size < allColumns.length) {
                      opts.selectedColumns = [...selectedCols].join(',');
                    }
                    const usedAliases = Object.fromEntries(Object.entries(aliases).filter(([k, v]) => v && selectedCols.has(k)));
                    if (Object.keys(usedAliases).length > 0) {
                      opts.columnAliases = JSON.stringify(usedAliases);
                    }
                    fireExport(selectedFormat, opts);
                    setStep(2);
                  }}
                  disabled={selectedFormat.id !== 'influxdb' && selectedCols.size === 0}
                  className="px-3 py-1 pf-rounded-sm pf-text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
                  {t('response.export', '导出')}
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
