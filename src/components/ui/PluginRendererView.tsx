/**
 * PluginRendererView — 通用插件渲染器展示组件
 *
 * 接收后端 plugin_render_data 返回的 RenderResult，
 * 根据 type="html" 或 type="table" 选择渲染方式。
 *
 * 宿主只负责展示，渲染逻辑全部在插件沙箱中执行。
 */

import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';

/** 后端 RenderResult 对应的前端类型 */
interface RenderSheet {
  name: string;
  columns: string[];
  rows: string[][];
}

interface RenderResult {
  type: 'html' | 'table';
  html?: string;
  sheets?: RenderSheet[];
  error?: string;
}

interface PluginRendererViewProps {
  pluginId: string;
  body: string;
  isBinary?: boolean;
  className?: string;
}

export function PluginRendererView({ pluginId, body, isBinary, className }: PluginRendererViewProps) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 调用后端 plugin_render_data，让插件在沙箱中执行渲染逻辑
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);

    invoke<RenderResult>('plugin_render_data', {
      pluginId,
      base64Data: isBinary ? body : btoa(body),
    })
      .then((res) => {
        if (!cancelled) {
          if (res.error) {
            setError(res.error);
          } else {
            setResult(res);
          }
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(typeof e === 'string' ? e : String(e));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [pluginId, body, isBinary]);

  if (loading) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-text-disabled', className)}>
        <Loader2 className="h-8 w-8 animate-spin opacity-40" />
        <p className="text-[13px]">插件处理中...</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-text-disabled', className)}>
        <AlertCircle className="h-10 w-10 opacity-30 text-red-400" />
        <p className="text-[13px]">插件渲染失败</p>
        <p className="text-[11px] text-text-tertiary max-w-[400px] text-center">{error || '未知错误'}</p>
      </div>
    );
  }

  // HTML 渲染模式
  if (result.type === 'html' && result.html) {
    return (
      <div className={cn('flex-1 overflow-auto p-2', className)}>
        <div
          className="plugin-html-content text-[12px]"
          dangerouslySetInnerHTML={{ __html: result.html }}
        />
      </div>
    );
  }

  // Table 渲染模式（多 Sheet 结构化数据）
  if (result.type === 'table' && result.sheets && result.sheets.length > 0) {
    return <TableRenderer sheets={result.sheets} className={className} />;
  }

  return (
    <div className={cn('flex items-center justify-center h-full text-text-disabled text-[13px]', className)}>
      插件返回了未知的渲染类型: {result.type}
    </div>
  );
}

/* ── 表格渲染子组件（多 Sheet + 分页） ── */
function TableRenderer({ sheets, className }: { sheets: RenderSheet[]; className?: string }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const sheet = sheets[activeSheet];

  const { columns, rows } = useMemo(() => {
    if (!sheet) return { columns: [] as string[], rows: [] as string[][] };
    return { columns: sheet.columns, rows: sheet.rows };
  }, [sheet]);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border-default bg-bg-secondary/30 px-3 py-1.5 shrink-0">
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            {sheets.map((s, idx) => (
              <button
                key={s.name}
                onClick={() => setActiveSheet(idx)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
                  activeSheet === idx
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-text-disabled shrink-0">
            <button
              onClick={() => setActiveSheet(Math.max(0, activeSheet - 1))}
              disabled={activeSheet === 0}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-bg-hover disabled:opacity-30"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span className="tabular-nums">{activeSheet + 1}/{sheets.length}</span>
            <button
              onClick={() => setActiveSheet(Math.min(sheets.length - 1, activeSheet + 1))}
              disabled={activeSheet === sheets.length - 1}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-bg-hover disabled:opacity-30"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 border-b border-border-default/60 bg-bg-secondary/15 px-3 py-1 shrink-0">
        <span className="text-[10px] font-medium text-text-tertiary">
          Sheet: <span className="text-text-secondary">{sheet?.name}</span>
        </span>
        <span className="text-[10px] text-text-disabled">
          {columns.length} 列 · {rows.length} 行
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-2">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-disabled text-[13px]">
            此 Sheet 为空
          </div>
        ) : (
          <div className="editor-table-shell">
            <div className="editor-table-frame">
              <table className="editor-table text-[12px]">
                <thead>
                  <tr>
                    <th className="w-[40px] text-center text-text-disabled font-normal">#</th>
                    {columns.map((h: string, i: number) => (
                      <th key={i} className="min-w-[80px] whitespace-nowrap">
                        {h || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((row: string[], ri: number) => (
                    <tr key={ri}>
                      <td className="text-center text-[10px] text-text-disabled tabular-nums">{ri + 1}</td>
                      {row.map((cell: string, ci: number) => (
                        <td key={ci} className="px-3 py-2 break-words max-w-[300px]">
                          {cell}
                        </td>
                      ))}
                      {row.length < columns.length && Array.from({ length: columns.length - row.length }).map((_, ci) => (
                        <td key={`pad-${ci}`} className="px-3 py-2 text-text-disabled">—</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && (
                <div className="py-3 text-center text-[11px] text-text-disabled italic">
                  仅显示前 500 行，共 {rows.length} 行
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
