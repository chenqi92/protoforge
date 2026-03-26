/**
 * ProtocolParserPanel -- 通用协议解析面板 (插件自控布局引擎)
 *
 * 渲染策略:
 * 1. 如果插件返回 layout -> 按 LayoutConfig 声明式渲染
 * 2. 如果没有 layout  -> 回退到默认分组渲染 (向后兼容)
 * 3. 每个 section 包裹 ErrorBoundary -> 单 section 错误不影响整体
 */

import { useState, useEffect, useMemo, useCallback, useRef, Component, type ReactNode } from 'react';
import { Search, FileCode2, Loader2, AlertCircle, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '@/stores/pluginStore';
import * as pluginService from '@/services/pluginService';
import type { ParseResult, ParsedField, LayoutSection, RegisterRow } from '@/types/plugin';

// ════════════════════════════════════════════════
//  Error Boundary
// ════════════════════════════════════════════════

interface ErrorBoundaryProps { children: ReactNode; fallback?: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error?: Error }

class SectionErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center gap-2 px-3 py-2 text-[var(--fs-xs)] text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400 rounded-[8px]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Section render error: {this.state.error?.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ════════════════════════════════════════════════
//  Color Maps
// ════════════════════════════════════════════════

const BORDER_COLOR: Record<string, string> = {
  blue: 'border-l-blue-500', indigo: 'border-l-indigo-500', sky: 'border-l-sky-500',
  teal: 'border-l-teal-500', emerald: 'border-l-emerald-500', cyan: 'border-l-cyan-500',
  amber: 'border-l-amber-500', red: 'border-l-red-500', purple: 'border-l-purple-500',
  slate: 'border-l-slate-400',
};
const BG_TINT: Record<string, string> = {
  blue: 'bg-blue-500/5', indigo: 'bg-indigo-500/5', sky: 'bg-sky-500/5',
  teal: 'bg-teal-500/5', emerald: 'bg-emerald-500/5', cyan: 'bg-cyan-500/5',
  amber: 'bg-amber-500/5', red: 'bg-red-500/5', purple: 'bg-purple-500/5',
  slate: 'bg-slate-500/5',
};

function getBorderColor(c?: string) { return (c && BORDER_COLOR[c]) || 'border-l-slate-300'; }
function getBgTint(c?: string) { return (c && BG_TINT[c]) || 'bg-slate-500/5'; }

// 默认分组色映射 (用于无 layout 的回退渲染)
const DEFAULT_GROUP_COLORS: Record<string, string> = {
  '报文头': 'blue', '帧头': 'blue', '报文结构': 'indigo', '控制区': 'sky',
  '数据区': 'teal', '业务数据': 'teal', '监测数据': 'emerald', '水文要素': 'cyan',
  '帧尾': 'slate', '校验区': 'amber', '图片传输': 'purple',
};

// Field value color maps
const DOT_COLOR: Record<string, string> = {
  emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500',
  blue: 'bg-blue-500', purple: 'bg-purple-500', slate: 'bg-slate-500',
};
const TEXT_COLOR: Record<string, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400', blue: 'text-blue-600 dark:text-blue-400',
  purple: 'text-purple-600 dark:text-purple-400', slate: 'text-slate-600 dark:text-slate-400',
};
const BADGE_BG: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border-purple-200 dark:border-purple-500/20',
  slate: 'bg-slate-50 text-slate-700 dark:bg-slate-500/10 dark:text-slate-400 border-slate-200 dark:border-slate-500/20',
};

// ════════════════════════════════════════════════
//  Main Component
// ════════════════════════════════════════════════

interface ProtocolParserPanelProps {
  initialData?: string;
  compact?: boolean;
  className?: string;
}

export function ProtocolParserPanel({ initialData, compact, className }: ProtocolParserPanelProps) {
  const { t } = useTranslation();
  const [rawInput, setRawInput] = useState(initialData || '');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const parserPlugins = useMemo(() => installedPlugins.filter(p => p.pluginType === 'protocol-parser'), [installedPlugins]);

  useEffect(() => { if (!selectedPluginId && parserPlugins.length > 0) setSelectedPluginId(parserPlugins[0].id); }, [parserPlugins, selectedPluginId]);
  useEffect(() => { if (initialData !== undefined) setRawInput(initialData); }, [initialData]);
  useEffect(() => { if (compact && initialData && selectedPluginId) handleParse(); }, [compact, initialData, selectedPluginId]);

  // Auto-detect protocol
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectProtocol = useCallback((input: string) => {
    if (!input.trim() || parserPlugins.length <= 1) return;
    const trimmed = input.trim();
    for (const plugin of parserPlugins) {
      const nameL = plugin.name.toLowerCase();
      if (/^##\d{4}/.test(trimmed) && (nameL.includes('hj212') || nameL.includes('hj 212'))) { setSelectedPluginId(plugin.id); return; }
      if (/^7[Ee]7[Ee]/i.test(trimmed) && (nameL.includes('sl651') || nameL.includes('sl 651'))) { setSelectedPluginId(plugin.id); return; }
      if (/^:/.test(trimmed) && nameL.includes('modbus')) { setSelectedPluginId(plugin.id); return; }
    }
  }, [parserPlugins]);
  useEffect(() => {
    if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current);
    if (rawInput.trim()) detectTimeoutRef.current = setTimeout(() => detectProtocol(rawInput), 300);
    return () => { if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current); };
  }, [rawInput, detectProtocol]);

  const handleParse = useCallback(async () => {
    if (!selectedPluginId || !rawInput.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await pluginService.parseData(selectedPluginId, rawInput.trim());
      setResult(res);
      // Initialize collapsed state from layout
      if (res?.layout?.sections) {
        const initial: Record<string, boolean> = {};
        res.layout.sections.forEach(s => { if (s.collapsed) initial[s.title] = true; });
        setCollapsedSections(initial);
      } else {
        setCollapsedSections({});
      }
    } catch (e) {
      setResult({ success: false, protocolName: '', summary: '', fields: [], error: e instanceof Error ? e.message : String(e) });
    }
    setLoading(false);
  }, [selectedPluginId, rawInput]);

  const handleCopyResult = useCallback(async () => {
    if (!result || !result.fields.length) return;
    const text = result.fields.map((f) => `${f.label || f.key}: ${f.value}${f.unit ? ` ${f.unit}` : ''}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const toggleSection = (title: string) => {
    setCollapsedSections(prev => ({ ...prev, [title]: !prev[title] }));
  };

  // Field lookup map for layout engine
  const fieldMap = useMemo(() => {
    const map = new Map<string, ParsedField>();
    result?.fields?.forEach(f => map.set(f.key, f));
    return map;
  }, [result?.fields]);

  // Key info fields
  const keyFields = useMemo(() => result?.fields?.filter(f => f.isKeyInfo) || [], [result?.fields]);

  if (parserPlugins.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-text-disabled', className)}>
        <FileCode2 className="h-8 w-8 opacity-30" />
        <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.noParser', '暂无已安装的协议解析器')}</p>
      </div>
    );
  }

  // ── Determine render mode ──
  const hasLayout = result?.layout?.sections && result.layout.sections.length > 0;

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* ── Input Area ── */}
      {!compact && (
        <div className="shrink-0 border-b border-border-default/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select value={selectedPluginId || ''} onChange={(e) => setSelectedPluginId(e.target.value)}
                className="h-[32px] w-full appearance-none rounded-[10px] border border-border-default/80 bg-bg-secondary/42 pl-3 pr-8 text-text-primary outline-none transition-all focus:border-accent"
                style={{ fontSize: 'var(--fs-sm)' }}>
                {parserPlugins.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled pointer-events-none" />
            </div>
            <button onClick={handleParse} disabled={loading || !rawInput.trim()}
              className="flex items-center gap-1.5 h-[32px] px-4 rounded-[10px] bg-accent text-white font-medium transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              style={{ fontSize: 'var(--fs-sm)' }}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {t('parser.parse', '解析')}
            </button>
          </div>
          <textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)}
            placeholder={t('parser.inputPlaceholder', '粘贴原始报文数据...')}
            className="h-[80px] w-full resize-none rounded-[10px] border border-border-default/80 bg-bg-secondary/42 px-3 py-2 font-mono text-text-primary outline-none placeholder:text-text-tertiary transition-all focus:border-accent"
            style={{ fontSize: 'var(--fs-xs)' }} />
        </div>
      )}

      {/* ── Results ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-disabled">
            <Loader2 className="h-6 w-6 animate-spin opacity-40" />
            <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.parsing', '解析中...')}</p>
          </div>
        )}

        {!loading && result?.error && (
          <div className="flex flex-col items-center justify-center gap-3 p-8">
            <AlertCircle className="h-8 w-8 opacity-30 text-red-400" />
            <p className="text-text-secondary" style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.parseFailed', '解析失败')}</p>
            <p className="text-text-tertiary max-w-[400px] text-center" style={{ fontSize: 'var(--fs-xs)' }}>{result.error}</p>
          </div>
        )}

        {!loading && result?.success && (
          <div className="p-2.5 space-y-2">
            {/* Summary Header */}
            <div className="rounded-[8px] border border-border-default/50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-accent/8 to-transparent border-l-[3px] border-l-accent">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-[5px] bg-accent/12 px-1.5 py-0.5 text-[var(--fs-3xs)] font-bold text-accent tracking-wide uppercase shrink-0">
                    {result.protocolName}
                  </span>
                  <span className="text-text-secondary truncate text-[var(--fs-xs)]">{result.summary}</span>
                </div>
                <button onClick={handleCopyResult}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[var(--fs-3xs)] text-text-tertiary hover:text-accent hover:bg-bg-hover transition-colors shrink-0">
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>

            {/* Key Info Cards */}
            {keyFields.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {keyFields.map((field, i) => (
                  <div key={`ki-${i}`} className="relative rounded-[7px] border border-border-default/50 bg-bg-primary overflow-hidden">
                    <div className={cn("h-[2px]",
                      field.color === 'emerald' ? 'bg-emerald-500' : field.color === 'red' ? 'bg-red-500' :
                      field.color === 'blue' ? 'bg-blue-500' : field.color === 'amber' ? 'bg-amber-500' :
                      field.color === 'purple' ? 'bg-purple-500' : 'bg-accent/40'
                    )} />
                    <div className="px-2 py-1.5">
                      <div className="text-[var(--fs-3xs)] text-text-tertiary truncate">{field.label || field.key}</div>
                      <div className="text-[var(--fs-xs)] font-semibold truncate"><FieldValue field={field} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            {result.fields.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
                <input type="text" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder={t('parser.searchFields', '搜索字段...')}
                  className="w-full h-[26px] pl-7 pr-3 rounded-[7px] bg-bg-secondary/40 border border-border-default/50 text-[var(--fs-3xs)] text-text-primary outline-none focus:border-accent transition-colors placeholder:text-text-tertiary" />
              </div>
            )}

            {/* ── Layout Engine or Default Renderer ── */}
            {hasLayout ? (
              <LayoutEngine
                sections={result.layout!.sections}
                fieldMap={fieldMap}
                search={fieldSearch}
                collapsedSections={collapsedSections}
                toggleSection={toggleSection}
              />
            ) : (
              <DefaultGroupRenderer
                fields={result.fields}
                search={fieldSearch}
                collapsedSections={collapsedSections}
                toggleSection={toggleSection}
              />
            )}

            {/* Raw Hex */}
            {result.rawHex && (
              <div className="rounded-[8px] border border-border-default/50 border-l-[3px] border-l-slate-400 overflow-hidden">
                <div className="px-3 py-1 bg-slate-500/5 text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-disabled">Raw Hex</div>
                <pre className="selectable p-2 font-mono text-[var(--fs-3xs)] text-text-tertiary leading-4 whitespace-pre-wrap break-all">{result.rawHex}</pre>
              </div>
            )}
          </div>
        )}

        {!loading && !result && !compact && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-disabled">
            <FileCode2 className="h-8 w-8 opacity-20" />
            <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.readyTitle', '粘贴报文并点击解析')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
//  Layout Engine (插件声明式布局)
// ════════════════════════════════════════════════

function LayoutEngine({ sections, fieldMap, search, collapsedSections, toggleSection }: {
  sections: LayoutSection[];
  fieldMap: Map<string, ParsedField>;
  search: string;
  collapsedSections: Record<string, boolean>;
  toggleSection: (t: string) => void;
}) {
  return (
    <div className="space-y-2">
      {sections.map((section, idx) => (
        <SectionErrorBoundary key={idx}>
          <SectionRenderer
            section={section}
            fieldMap={fieldMap}
            search={search}
            collapsed={!!collapsedSections[section.title]}
            onToggle={() => toggleSection(section.title)}
          />
        </SectionErrorBoundary>
      ))}
    </div>
  );
}

function SectionRenderer({ section, fieldMap, search, collapsed, onToggle }: {
  section: LayoutSection;
  fieldMap: Map<string, ParsedField>;
  search: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Get fields for this section
  const sectionFields = useMemo(() => {
    if (section.fieldKeys) {
      return section.fieldKeys.map(k => fieldMap.get(k)).filter(Boolean) as ParsedField[];
    }
    // For register style, collect fields from rows
    if (section.rows) {
      const keys = new Set<string>();
      section.rows.forEach(r => r.cells.forEach(c => keys.add(c.key)));
      return Array.from(keys).map(k => fieldMap.get(k)).filter(Boolean) as ParsedField[];
    }
    return [];
  }, [section, fieldMap]);

  // Filter by search
  const matchesSearch = !search || sectionFields.some(f =>
    f.key.toLowerCase().includes(search.toLowerCase()) ||
    (f.label || '').toLowerCase().includes(search.toLowerCase()) ||
    String(f.value).toLowerCase().includes(search.toLowerCase())
  );

  if (!matchesSearch && search) return null;

  const count = section.style === 'register' && section.rows ? section.rows.length : sectionFields.length;

  return (
    <div className={cn("rounded-[8px] border border-border-default/50 overflow-hidden border-l-[3px]", getBorderColor(section.color))}>
      {/* Section Header */}
      <div
        className={cn("flex items-center justify-between px-2.5 py-1.5 cursor-pointer select-none transition-colors", getBgTint(section.color), "hover:brightness-[0.97]")}
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5">
          {collapsed
            ? <ChevronRight className="w-3 h-3 text-text-disabled" />
            : <ChevronDown className="w-3 h-3 text-text-disabled" />
          }
          <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">{section.title}</span>
          <span className="text-[var(--fs-3xs)] text-text-tertiary px-1 py-0.5 rounded-full bg-bg-secondary/60 font-medium leading-none">{count}</span>
        </div>
      </div>

      {/* Section Body */}
      {!collapsed && (
        section.style === 'register' && section.rows && section.columns
          ? <RegisterTable columns={section.columns} rows={section.rows} fieldMap={fieldMap} search={search} />
          : section.style === 'grid'
            ? <GridView fields={sectionFields} search={search} />
            : <KeyValueView fields={sectionFields} search={search} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
//  Register Table (登记表渲染器)
// ════════════════════════════════════════════════

function RegisterTable({ columns, rows, fieldMap, search }: {
  columns: string[];
  rows: RegisterRow[];
  fieldMap: Map<string, ParsedField>;
  search: string;
}) {
  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(row => {
      if (row.label.toLowerCase().includes(q)) return true;
      return row.cells.some(c => {
        const f = fieldMap.get(c.key);
        return f && (String(f.value).toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q));
      });
    });
  }, [rows, search, fieldMap]);

  if (filteredRows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[var(--fs-xs)]">
        {/* Header */}
        <thead>
          <tr className="border-b border-border-default/50">
            {columns.map((col, i) => (
              <th key={i} className={cn(
                "px-2 py-1.5 text-[var(--fs-3xs)] font-semibold text-text-tertiary uppercase tracking-wider whitespace-nowrap",
                i === 0 ? "text-left pl-3 w-[20%]" : "text-right"
              )}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        {/* Body */}
        <tbody>
          {filteredRows.map((row, ri) => {
            return (
              <tr key={ri} className={cn(
                "border-b border-border-default/20 last:border-0 transition-colors hover:bg-bg-hover/30",
                ri % 2 === 1 && "bg-bg-secondary/10"
              )}>
                {/* Row label (因子名称) */}
                <td className="px-2 py-1.5 pl-3 font-medium text-text-primary whitespace-nowrap">
                  <span className="text-[var(--fs-xs)]">{row.label}</span>
                </td>
                {/* Data cells */}
                {row.cells.map((cell, ci) => {
                  const field = fieldMap.get(cell.key);
                  if (!field) {
                    return <td key={ci} className="px-2 py-1.5 text-right text-text-disabled">--</td>;
                  }
                  return (
                    <td key={ci} className={cn("px-2 py-1.5 text-right whitespace-nowrap", cell.span && `col-span-${cell.span}`)}>
                      <CellValue field={field} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 登记表单元格值渲染 — 紧凑版 */
function CellValue({ field }: { field: ParsedField }) {
  const valStr = String(field.value);

  if (field.uiType === 'status-dot') {
    return (
      <span className="inline-flex items-center gap-1 justify-end">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", field.color ? DOT_COLOR[field.color] || DOT_COLOR.slate : "bg-text-tertiary")} />
        <span className={cn("text-[var(--fs-xs)] font-medium", field.color ? TEXT_COLOR[field.color] : "text-text-primary")}>{valStr}</span>
      </span>
    );
  }
  if (field.uiType === 'badge') {
    return (
      <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-[5px] border text-[var(--fs-3xs)] font-medium", field.color ? BADGE_BG[field.color] || BADGE_BG.slate : BADGE_BG.slate)}>
        {valStr}
      </span>
    );
  }

  return (
    <span className="text-text-primary">
      <span className="font-semibold">{valStr}</span>
      {field.unit && <span className="ml-0.5 text-[var(--fs-3xs)] text-text-disabled font-normal">{field.unit}</span>}
    </span>
  );
}

// ════════════════════════════════════════════════
//  Grid View (卡片网格)
// ════════════════════════════════════════════════

function GridView({ fields, search }: { fields: ParsedField[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search) return fields;
    const q = search.toLowerCase();
    return fields.filter(f => f.key.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q) || String(f.value).toLowerCase().includes(q));
  }, [fields, search]);
  if (filtered.length === 0) return null;
  return (
    <div className="p-1.5 grid grid-cols-2 gap-1">
      {filtered.map((f, i) => {
        const cleanLabel = (f.label || f.key).replace(/^[\p{Emoji}\u200d\uFE0F]+\s*/u, '');
        return (
          <div key={`${f.key}-${i}`} className="rounded-[6px] border border-border-default/30 px-2 py-1.5 bg-bg-primary hover:border-border-default/60 transition-colors">
            <div className="text-[var(--fs-3xs)] text-text-tertiary truncate">{cleanLabel}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-[var(--fs-xs)] font-semibold text-text-primary"><FieldValue field={f} /></span>
              {f.unit && <span className="text-[var(--fs-3xs)] text-text-disabled">{f.unit}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════
//  Key-Value View (紧凑键值表)
// ════════════════════════════════════════════════

function KeyValueView({ fields, search }: { fields: ParsedField[]; search: string }) {
  const filtered = useMemo(() => {
    if (!search) return fields;
    const q = search.toLowerCase();
    return fields.filter(f => f.key.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q) || String(f.value).toLowerCase().includes(q));
  }, [fields, search]);
  if (filtered.length === 0) return null;
  return (
    <div className="divide-y divide-border-default/25">
      {filtered.map((f, i) => (
        <div key={`${f.key}-${i}`} className={cn("flex items-baseline gap-2 px-3 py-1.5 text-[var(--fs-xs)] transition-colors hover:bg-bg-hover/30", i % 2 === 1 && "bg-bg-secondary/10")}>
          <span className="w-[38%] shrink-0 font-medium text-text-primary truncate" title={f.key}>{f.label || f.key}</span>
          <span className="flex-1 min-w-0 break-all">
            <span className="inline-flex items-baseline gap-1 flex-wrap">
              <FieldValue field={f} />
              {f.unit && <span className="text-text-disabled text-[var(--fs-3xs)]">{f.unit}</span>}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════
//  Default Group Renderer (无 layout 回退)
// ════════════════════════════════════════════════

function DefaultGroupRenderer({ fields, search, collapsedSections, toggleSection }: {
  fields: ParsedField[];
  search: string;
  collapsedSections: Record<string, boolean>;
  toggleSection: (t: string) => void;
}) {
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const f of fields) {
      if (f.group) set.add(Array.isArray(f.group) ? f.group.join('/') : f.group);
    }
    return Array.from(set);
  }, [fields]);

  return (
    <div className="space-y-2">
      {groups.map(g => {
        const groupFields = fields.filter(f => {
          const fg = Array.isArray(f.group) ? f.group.join('/') : f.group;
          return fg === g;
        });
        if (groupFields.length === 0) return null;
        const color = DEFAULT_GROUP_COLORS[g] || 'slate';
        const isCollapsed = !!collapsedSections[g];
        const matchesSearch = !search || groupFields.some(f =>
          f.key.toLowerCase().includes(search.toLowerCase()) ||
          (f.label || '').toLowerCase().includes(search.toLowerCase()) ||
          String(f.value).toLowerCase().includes(search.toLowerCase())
        );
        if (!matchesSearch && search) return null;

        return (
          <SectionErrorBoundary key={g}>
            <div className={cn("rounded-[8px] border border-border-default/50 overflow-hidden border-l-[3px]", getBorderColor(color))}>
              <div className={cn("flex items-center justify-between px-2.5 py-1.5 cursor-pointer select-none transition-colors", getBgTint(color), "hover:brightness-[0.97]")}
                onClick={() => toggleSection(g)}>
                <div className="flex items-center gap-1.5">
                  {isCollapsed ? <ChevronRight className="w-3 h-3 text-text-disabled" /> : <ChevronDown className="w-3 h-3 text-text-disabled" />}
                  <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">{g}</span>
                  <span className="text-[var(--fs-3xs)] text-text-tertiary px-1 py-0.5 rounded-full bg-bg-secondary/60 font-medium leading-none">{groupFields.length}</span>
                </div>
              </div>
              {!isCollapsed && <KeyValueView fields={groupFields} search={search} />}
            </div>
          </SectionErrorBoundary>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════
//  Field Value Renderer (通用)
// ════════════════════════════════════════════════

function FieldValue({ field }: { field: ParsedField }) {
  const valStr = String(field.value);
  switch (field.uiType) {
    case 'status-dot':
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className={cn("w-2 h-2 rounded-full shrink-0", field.color ? DOT_COLOR[field.color] || DOT_COLOR.slate : "bg-text-tertiary")} />
          <span className={field.color ? TEXT_COLOR[field.color] : "text-text-primary"}>{valStr}</span>
        </span>
      );
    case 'badge':
      return (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-[5px] border text-[var(--fs-3xs)] font-medium", field.color ? BADGE_BG[field.color] || BADGE_BG.slate : BADGE_BG.slate)}>
          {valStr}
        </span>
      );
    case 'code':
    case 'json':
      return (
        <pre className="p-1.5 rounded-[5px] bg-bg-secondary/50 border border-border-default/40 font-mono text-[var(--fs-3xs)] text-text-secondary whitespace-pre-wrap break-all">
          {typeof field.value === 'object' ? JSON.stringify(field.value, null, 2) : valStr}
        </pre>
      );
    default:
      return <span className={cn(field.color && TEXT_COLOR[field.color])}>{typeof field.value === 'object' ? JSON.stringify(field.value) : valStr}</span>;
  }
}
