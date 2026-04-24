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
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, FileSpreadsheet, Rows3, Columns3 } from 'lucide-react';

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

/** 安全地将任意文本编码为 base64（支持 Unicode，不会像 btoa 那样崩溃） */
function textToBase64(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
      base64Data: isBinary ? body : textToBase64(body),
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
        <Loader2 className="h-6 w-6 animate-spin opacity-40" />
        <p style={{ fontSize: 'var(--fs-sm)' }}>插件处理中...</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-text-disabled', className)}>
        <AlertCircle className="h-8 w-8 opacity-30 text-red-400" />
        <p style={{ fontSize: 'var(--fs-sm)' }}>插件渲染失败</p>
        <p className="text-text-tertiary max-w-[400px] text-center" style={{ fontSize: 'var(--fs-xs)' }}>{error || '未知错误'}</p>
      </div>
    );
  }

  // HTML 渲染模式 — 使用 iframe sandbox 隔离插件 HTML，阻断脚本 / 跨域 / 表单提交
  if (result.type === 'html' && result.html) {
    return (
      <div className={cn('flex-1 overflow-hidden p-2', className)}>
        <iframe
          className="h-full w-full border-0 bg-transparent"
          sandbox=""
          title={`plugin-${pluginId}`}
          srcDoc={result.html}
          style={{ fontSize: 'var(--fs-sm)' }}
        />
      </div>
    );
  }

  // Table 渲染模式（多 Sheet 结构化数据）
  if (result.type === 'table' && result.sheets && result.sheets.length > 0) {
    return <TableRenderer sheets={result.sheets} className={className} />;
  }

  return (
    <div className={cn('flex items-center justify-center h-full text-text-disabled', className)} style={{ fontSize: 'var(--fs-sm)' }}>
      插件返回了未知的渲染类型: {result.type}
    </div>
  );
}

/* ── 表格渲染子组件（多 Sheet + 分页 + 精致样式） ── */
function TableRenderer({ sheets, className }: { sheets: RenderSheet[]; className?: string }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const sheet = sheets[activeSheet];

  const { columns, rows } = useMemo(() => {
    if (!sheet) return { columns: [] as string[], rows: [] as string[][] };
    return { columns: sheet.columns, rows: sheet.rows };
  }, [sheet]);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* ── 底部 Sheet 切换条（Excel 风格，始终显示） ── */}
      <div className="flex items-center border-b border-border-default/60 bg-bg-secondary/20 shrink-0">
        {/* Sheet tabs */}
        <div className="flex items-center gap-0 overflow-x-auto scrollbar-hide">
          {sheets.map((s, idx) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(idx)}
              className={cn(
                'relative flex items-center gap-1.5 border-r border-border-default/40 px-3 py-1.5 transition-all whitespace-nowrap',
                activeSheet === idx
                  ? 'bg-bg-primary text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-text-tertiary hover:bg-bg-hover/60 hover:text-text-secondary'
              )}
              style={{ fontSize: 'var(--fs-xs)' }}
            >
              <FileSpreadsheet className="h-3 w-3 shrink-0 opacity-70" />
              {s.name}
              {activeSheet === idx && (
                <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-emerald-500" />
              )}
            </button>
          ))}
        </div>

        {/* Sheet 导航 + 统计 */}
        <div className="ml-auto flex items-center gap-2 px-3 text-text-disabled shrink-0" style={{ fontSize: 'var(--fs-xxs)' }}>
          {sheets.length > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setActiveSheet(Math.max(0, activeSheet - 1))}
                disabled={activeSheet === 0}
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-bg-hover disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="tabular-nums px-1">{activeSheet + 1}/{sheets.length}</span>
              <button
                onClick={() => setActiveSheet(Math.min(sheets.length - 1, activeSheet + 1))}
                disabled={activeSheet === sheets.length - 1}
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-bg-hover disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
          <span className="flex items-center gap-1 text-text-disabled">
            <Columns3 className="h-3 w-3 opacity-50" />
            <span className="tabular-nums">{columns.length}</span>
          </span>
          <span className="flex items-center gap-1 text-text-disabled">
            <Rows3 className="h-3 w-3 opacity-50" />
            <span className="tabular-nums">{rows.length}</span>
          </span>
        </div>
      </div>

      {/* ── 表格内容 ── */}
      <div className="flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-disabled" style={{ fontSize: 'var(--fs-sm)' }}>
            此 Sheet 为空
          </div>
        ) : (
          <table className="plugin-table w-full border-collapse" style={{ fontSize: 'var(--fs-sm)' }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="plugin-table-th plugin-table-row-num w-[42px] text-center">#</th>
                {columns.map((h: string, i: number) => (
                  <th key={i} className="plugin-table-th">
                    {h || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((row: string[], ri: number) => (
                <tr key={ri} className="plugin-table-row">
                  <td className="plugin-table-td plugin-table-row-num text-center tabular-nums" style={{ fontSize: 'var(--fs-xxs)' }}>
                    {ri + 1}
                  </td>
                  {row.map((cell: string, ci: number) => (
                    <td key={ci} className="plugin-table-td">
                      {cell}
                    </td>
                  ))}
                  {row.length < columns.length && Array.from({ length: columns.length - row.length }).map((_, ci) => (
                    <td key={`pad-${ci}`} className="plugin-table-td text-text-disabled">—</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 500 && (
          <div className="py-3 text-center text-text-disabled italic" style={{ fontSize: 'var(--fs-xs)' }}>
            仅显示前 500 行，共 {rows.length.toLocaleString()} 行
          </div>
        )}
      </div>
    </div>
  );
}
