/**
 * ProtocolParserPanel -- 通用协议解析面板 (插件自控布局引擎)
 *
 * 渲染策略:
 * 1. 如果插件返回 layout -> 按 LayoutConfig 声明式渲染
 * 2. 如果没有 layout  -> 回退到默认分组渲染 (向后兼容)
 * 3. 每个 section 包裹 ErrorBoundary -> 单 section 错误不影响整体
 */

import { useState, useEffect, useMemo, useCallback, useRef, Component, type ReactNode } from 'react';
import { Search, FileCode2, Loader2, AlertCircle, Copy, Check, ChevronDown, ChevronRight, ArrowLeftRight } from 'lucide-react';
import { PluginIcon } from '@/components/plugins/PluginIcon';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '@/stores/pluginStore';
import * as pluginService from '@/services/pluginService';
import type { ParseResult, ParsedField, LayoutSection, RegisterRow, PluginManifest } from '@/types/plugin';

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
        <div className="flex items-center gap-2 px-3 py-2 pf-text-xs text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400 pf-rounded-sm">
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

  // Auto-detect protocol — data-driven from plugin manifests' matchPatterns + priority
  const detectProtocol = useCallback((input: string): string | null => {
    if (!input.trim() || parserPlugins.length === 0) return null;
    const trimmed = input.trim();

    // Collect all candidates: { pluginId, priority }
    const candidates: { pluginId: string; priority: number }[] = [];
    for (const plugin of parserPlugins) {
      const parsers = plugin.contributes?.parsers;
      if (!parsers?.length) continue;
      for (const parser of parsers) {
        if (!parser.matchPatterns?.length) continue;
        const matched = parser.matchPatterns.some(pattern => {
          try { return new RegExp(pattern).test(trimmed); } catch { return false; }
        });
        if (matched) {
          candidates.push({ pluginId: plugin.id, priority: parser.priority ?? 0 });
          break; // one match per plugin is enough
        }
      }
    }
    if (candidates.length === 0) return null;
    // highest priority wins
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0].pluginId;
  }, [parserPlugins]);

  // handleParse — must be defined before effects that reference it
  const handleParse = useCallback(async () => {
    if (!selectedPluginId || !rawInput.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await pluginService.parseData(selectedPluginId, rawInput.trim());
      setResult(res);
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

  // Initialize: detect protocol first, then fallback to first plugin
  useEffect(() => {
    if (!selectedPluginId && parserPlugins.length > 0) {
      const detected = rawInput ? detectProtocol(rawInput) : null;
      setSelectedPluginId(detected || parserPlugins[0].id);
    }
  }, [parserPlugins, selectedPluginId, rawInput, detectProtocol]);

  useEffect(() => { if (initialData !== undefined) setRawInput(initialData); }, [initialData]);

  // Compact mode: auto-parse once plugin is resolved
  const compactParsedRef = useRef<string | null>(null);
  useEffect(() => {
    if (compact && initialData && selectedPluginId && compactParsedRef.current !== `${initialData}::${selectedPluginId}`) {
      compactParsedRef.current = `${initialData}::${selectedPluginId}`;
      handleParse();
    }
  }, [compact, initialData, selectedPluginId, handleParse]);

  // Non-compact: debounced detection on input change
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (compact) return;
    if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current);
    if (rawInput.trim()) {
      detectTimeoutRef.current = setTimeout(() => {
        const detected = detectProtocol(rawInput);
        if (detected) setSelectedPluginId(detected);
      }, 300);
    }
    return () => { if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current); };
  }, [rawInput, detectProtocol, compact]);

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
  const selectedPlugin = parserPlugins.find(p => p.id === selectedPluginId);
  const [searchSelectOpen, setSearchSelectOpen] = useState(false);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* ── Input Area ── */}
      {!compact && (
        <div className="shrink-0 border-b border-border-default/60">
          {/* Row 1: Title bar — protocol icon + name + switch button */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-default/40 bg-bg-secondary/20">
            <div className="flex items-center gap-2.5 min-w-0">
              {selectedPlugin && (
                <PluginIcon pluginId={selectedPlugin.id} fallbackEmoji={selectedPlugin.icon} size="sm" />
              )}
              <div className="min-w-0">
                <div className="pf-text-sm font-semibold text-text-primary truncate">
                  {selectedPlugin?.name || t('parser.selectPlugin', '选择解析器')}
                </div>
                {selectedPlugin?.protocolIds?.[0] && (
                  <span className="pf-text-3xs text-accent font-medium">{selectedPlugin.protocolIds[0].toUpperCase()}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => setSearchSelectOpen(true)}
              className="flex items-center gap-1 px-2 py-1 pf-rounded-md pf-text-3xs font-medium text-text-tertiary hover:text-accent hover:bg-bg-hover transition-colors shrink-0"
              title={t('parser.switchPlugin', '切换协议')}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('parser.switch', '切换')}</span>
            </button>
          </div>

          {/* Hidden PluginSearchSelect (controlled by title bar button) */}
          <PluginSearchSelect
            plugins={parserPlugins}
            selectedId={selectedPluginId}
            onSelect={setSelectedPluginId}
            externalOpen={searchSelectOpen}
            onOpenChange={setSearchSelectOpen}
            hideTrigger
          />

          {/* Row 2: Input textarea + Parse button */}
          <div className="p-3 space-y-2">
            <textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)}
              placeholder={t('parser.inputPlaceholder', '粘贴原始报文数据...')}
              className="h-[80px] w-full resize-none pf-rounded-md border border-border-default/80 bg-bg-secondary/42 px-3 py-2 font-mono text-text-primary outline-none placeholder:text-text-tertiary transition-all focus:border-accent"
              style={{ fontSize: 'var(--fs-xs)' }} />
            <button onClick={handleParse} disabled={loading || !rawInput.trim()}
              className="flex w-full items-center justify-center gap-1.5 h-[32px] pf-rounded-md bg-accent text-white font-medium transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontSize: 'var(--fs-sm)' }}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {t('parser.parse', '解析')}
            </button>
          </div>
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
          <div className="p-2.5 space-y-2 select-text cursor-auto">
            {/* Summary Header */}
            <div className="pf-rounded-sm border border-border-default/50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-accent-soft border-l-[3px] border-l-accent">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="pf-rounded-xs bg-accent/12 px-1.5 py-0.5 pf-text-3xs font-bold text-accent tracking-wide uppercase shrink-0">
                    {result.protocolName}
                  </span>
                  <span className="text-text-secondary truncate pf-text-xs">{result.summary}</span>
                </div>
                <button onClick={handleCopyResult}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md pf-text-3xs text-text-tertiary hover:text-accent hover:bg-bg-hover transition-colors shrink-0">
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>

            {/* Key Info Cards */}
            {keyFields.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {keyFields.map((field, i) => (
                  <div key={`ki-${i}`} className="relative pf-rounded-sm border border-border-default/50 bg-bg-primary overflow-hidden">
                    <div className={cn("h-[2px]",
                      field.color === 'emerald' ? 'bg-emerald-500' : field.color === 'red' ? 'bg-red-500' :
                      field.color === 'blue' ? 'bg-blue-500' : field.color === 'amber' ? 'bg-amber-500' :
                      field.color === 'purple' ? 'bg-purple-500' : 'bg-accent/40'
                    )} />
                    <div className="px-2 py-1.5">
                      <div className="pf-text-3xs text-text-tertiary truncate">{field.label || field.key}</div>
                      <div className="pf-text-xs font-semibold truncate"><FieldValue field={field} /></div>
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
                  className="w-full h-[26px] pl-7 pr-3 pf-rounded-sm bg-bg-secondary/40 border border-border-default/50 pf-text-3xs text-text-primary outline-none focus:border-accent transition-colors placeholder:text-text-tertiary" />
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
              <div className="pf-rounded-sm border border-border-default/50 border-l-[3px] border-l-slate-400 overflow-hidden">
                <div className="px-3 py-1 bg-slate-500/5 pf-text-3xs font-semibold uppercase tracking-[0.08em] text-text-disabled">Raw Hex</div>
                <pre className="selectable p-2 font-mono pf-text-3xs text-text-tertiary leading-4 whitespace-pre-wrap break-all">{result.rawHex}</pre>
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
    <div className={cn("pf-rounded-sm border border-border-default/50 overflow-hidden border-l-[3px]", getBorderColor(section.color))}>
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
          <span className="pf-text-xs font-semibold text-text-secondary">{section.title}</span>
          <span className="pf-text-3xs text-text-tertiary px-1 py-0.5 rounded-full bg-bg-secondary/60 font-medium leading-none">{count}</span>
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
      <table className="w-full table-fixed border-collapse pf-text-xs">
        {/* Header */}
        <thead>
          <tr className="border-b border-border-default/50">
            {columns.map((col, i) => (
              <th key={i} className={cn(
                "px-2 py-1.5 pf-text-3xs font-semibold text-text-tertiary uppercase tracking-wider whitespace-nowrap",
                i === 0 ? "text-left pl-3 w-[20%]" : "text-center"
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
                  <span className="pf-text-xs">{row.label}</span>
                </td>
                {/* Data cells */}
                {row.cells.map((cell, ci) => {
                  const field = fieldMap.get(cell.key);
                  if (!field) {
                    return <td key={ci} className="px-2 py-1.5 text-center text-text-disabled">--</td>;
                  }
                  return (
                    <td key={ci} colSpan={cell.span || 1} className="px-2 py-1.5 text-center whitespace-nowrap">
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
      <span className="inline-flex items-center gap-1 justify-center">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", field.color ? DOT_COLOR[field.color] || DOT_COLOR.slate : "bg-text-tertiary")} />
        <span className={cn("pf-text-xs font-medium", field.color ? TEXT_COLOR[field.color] : "text-text-primary")}>{valStr}</span>
      </span>
    );
  }
  if (field.uiType === 'badge') {
    return (
      <span className={cn("inline-flex items-center px-1.5 py-0.5 pf-rounded-xs border pf-text-3xs font-medium", field.color ? BADGE_BG[field.color] || BADGE_BG.slate : BADGE_BG.slate)}>
        {valStr}
      </span>
    );
  }

  return (
    <span className="text-text-primary">
      <span className="font-semibold">{valStr}</span>
      {field.unit && <span className="ml-0.5 pf-text-3xs text-text-disabled font-normal">{field.unit}</span>}
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
          <div key={`${f.key}-${i}`} className="pf-rounded-sm border border-border-default/30 px-2 py-1.5 bg-bg-primary hover:border-border-default/60 transition-colors">
            <div className="pf-text-3xs text-text-tertiary truncate">{cleanLabel}</div>
            <div className="flex items-baseline gap-1">
              <span className="pf-text-xs font-semibold text-text-primary"><FieldValue field={f} /></span>
              {f.unit && <span className="pf-text-3xs text-text-disabled">{f.unit}</span>}
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
        <div key={`${f.key}-${i}`} className={cn("flex items-baseline gap-2 px-3 py-1.5 pf-text-xs transition-colors hover:bg-bg-hover/30", i % 2 === 1 && "bg-bg-secondary/10")}>
          <span className="w-[38%] shrink-0 font-medium text-text-primary truncate" title={f.key}>{f.label || f.key}</span>
          <span className="flex-1 min-w-0 break-all">
            <span className="inline-flex items-baseline gap-1 flex-wrap">
              <FieldValue field={f} />
              {f.unit && <span className="text-text-disabled pf-text-3xs">{f.unit}</span>}
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
            <div className={cn("pf-rounded-sm border border-border-default/50 overflow-hidden border-l-[3px]", getBorderColor(color))}>
              <div className={cn("flex items-center justify-between px-2.5 py-1.5 cursor-pointer select-none transition-colors", getBgTint(color), "hover:brightness-[0.97]")}
                onClick={() => toggleSection(g)}>
                <div className="flex items-center gap-1.5">
                  {isCollapsed ? <ChevronRight className="w-3 h-3 text-text-disabled" /> : <ChevronDown className="w-3 h-3 text-text-disabled" />}
                  <span className="pf-text-xs font-semibold text-text-secondary">{g}</span>
                  <span className="pf-text-3xs text-text-tertiary px-1 py-0.5 rounded-full bg-bg-secondary/60 font-medium leading-none">{groupFields.length}</span>
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

// ════════════════════════════════════════════════
//  Plugin Search Select (弹框式可搜索插件选择器)
// ════════════════════════════════════════════════

function PluginSearchSelect({ plugins, selectedId, onSelect, externalOpen, onOpenChange, hideTrigger }: {
  plugins: PluginManifest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Controlled open state from parent */
  externalOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (parent provides its own) */
  hideTrigger?: boolean;
}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);

  // Support both controlled and uncontrolled modes
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    setInternalOpen(v);
  };
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = plugins.find(p => p.id === selectedId);

  const filtered = useMemo(() => {
    if (!query) return plugins;
    const q = query.toLowerCase();
    return plugins.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.protocolIds.some(pid => pid.toLowerCase().includes(q)) ||
      p.tags.some(tag => tag.toLowerCase().includes(q)) ||
      p.description.toLowerCase().includes(q)
    );
  }, [plugins, query]);

  useEffect(() => { setHighlightIdx(0); }, [filtered.length]);

  // Focus input and reset on open
  useEffect(() => {
    if (open) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlightIdx]) { onSelect(filtered[highlightIdx].id); setOpen(false); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <>
      {/* Trigger (hidden when parent provides its own) */}
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="flex h-[32px] flex-1 items-center justify-between gap-2 pf-rounded-md border border-border-default/80 bg-bg-secondary/42 px-3 text-left transition-all hover:border-border-default cursor-pointer"
        >
          <span className="truncate pf-text-sm text-text-primary">{selected?.name || t('parser.selectPlugin', '选择解析器')}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-disabled" />
        </button>
      )}

      {/* Dialog Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/20 animate-in fade-in-0 duration-150" />
          <div
            className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border-default bg-bg-primary shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search header */}
            <div className="flex items-center gap-2.5 border-b border-border-default/60 px-4 py-3">
              <Search className="w-4 h-4 shrink-0 text-text-disabled" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('parser.searchPlugin', '搜索协议...')}
                className="flex-1 bg-transparent pf-text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 pf-rounded-xs border border-border-default/60 bg-bg-secondary/60 pf-text-3xs text-text-disabled font-mono">
                ESC
              </kbd>
            </div>

            {/* Plugin list */}
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-text-disabled">
                  <Search className="w-6 h-6 opacity-30" />
                  <span className="pf-text-sm">{t('parser.noMatch', '无匹配结果')}</span>
                </div>
              ) : (
                filtered.map((p, idx) => {
                  const isSelected = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { onSelect(p.id); setOpen(false); }}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        idx === highlightIdx ? "bg-accent/8" : "hover:bg-bg-hover/50",
                        isSelected && "ring-1 ring-accent/30 bg-accent/5"
                      )}
                    >
                      {/* Icon */}
                      <PluginIcon pluginId={p.id} fallbackEmoji={p.icon} size="sm" />

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("pf-text-sm font-semibold truncate", isSelected ? "text-accent" : "text-text-primary")}>
                            {p.name}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-accent" />}
                        </div>
                        <p className="mt-0.5 pf-text-xs text-text-tertiary line-clamp-2 leading-relaxed">
                          {p.description}
                        </p>
                        {(p.protocolIds.length > 0 || p.tags.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {p.protocolIds.map(pid => (
                              <span key={pid} className="pf-text-3xs px-1.5 py-0.5 pf-rounded-xs bg-accent/8 text-accent font-medium">{pid}</span>
                            ))}
                            {p.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="pf-text-3xs px-1.5 py-0.5 pf-rounded-xs bg-bg-secondary/80 text-text-disabled">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center justify-between border-t border-border-default/40 px-4 py-2 pf-text-3xs text-text-disabled">
              <span>{filtered.length} {t('parser.parsersAvailable', '个解析器')}</span>
              <div className="flex items-center gap-2">
                <span><kbd className="font-mono">↑↓</kbd> {t('parser.navigate', '导航')}</span>
                <span><kbd className="font-mono">↵</kbd> {t('parser.confirm', '确认')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
        <span className={cn("inline-flex items-center px-1.5 py-0.5 pf-rounded-xs border pf-text-3xs font-medium", field.color ? BADGE_BG[field.color] || BADGE_BG.slate : BADGE_BG.slate)}>
          {valStr}
        </span>
      );
    case 'code':
    case 'json':
      return (
        <pre className="p-1.5 pf-rounded-xs bg-bg-secondary/50 border border-border-default/40 font-mono pf-text-3xs text-text-secondary whitespace-pre-wrap break-all">
          {typeof field.value === 'object' ? JSON.stringify(field.value, null, 2) : valStr}
        </pre>
      );
    default:
      return <span className={cn(field.color && TEXT_COLOR[field.color])}>{typeof field.value === 'object' ? JSON.stringify(field.value) : valStr}</span>;
  }
}
