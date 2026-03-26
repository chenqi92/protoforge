/**
 * ProtocolParserPanel — 通用协议解析面板
 *
 * 适用场景：
 * 1. 侧边栏独立工具面板
 * 2. TCP MessageLog 右键解析弹窗
 * 3. HTTP ResponseViewer 内嵌 Tab
 *
 * 通过 pluginService.parseData 调用后端插件沙箱执行解析
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, FileCode2, Loader2, AlertCircle, Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '@/stores/pluginStore';
import * as pluginService from '@/services/pluginService';
import type { ParseResult } from '@/types/plugin';

interface ProtocolParserPanelProps {
  /** 预填充的原始数据 */
  initialData?: string;
  /** 精简模式（隐藏输入区，仅显示结果） */
  compact?: boolean;
  /** 自定义高度类名 */
  className?: string;
}

export function ProtocolParserPanel({ initialData, compact, className }: ProtocolParserPanelProps) {
  const { t } = useTranslation();
  const [rawInput, setRawInput] = useState(initialData || '');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [fieldSearch, setFieldSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // 获取所有已安装的 protocol-parser 插件
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const parserPlugins = useMemo(() => installedPlugins.filter(p => p.pluginType === 'protocol-parser'), [installedPlugins]);

  // 自动选中第一个解析器
  useEffect(() => {
    if (!selectedPluginId && parserPlugins.length > 0) {
      setSelectedPluginId(parserPlugins[0].id);
    }
  }, [parserPlugins, selectedPluginId]);

  // 当 initialData 改变时更新输入
  useEffect(() => {
    if (initialData !== undefined) {
      setRawInput(initialData);
    }
  }, [initialData]);

  // compact 模式下自动解析
  useEffect(() => {
    if (compact && initialData && selectedPluginId) {
      handleParse();
    }
  }, [compact, initialData, selectedPluginId]);

  // ── 报文头自动协议识别 ──
  const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectProtocol = useCallback((input: string) => {
    if (!input.trim() || parserPlugins.length <= 1) return;
    const trimmed = input.trim();
    for (const plugin of parserPlugins) {
      const nameL = plugin.name.toLowerCase();
      // HJ212: 以 ## 开头，后跟4位数字长度
      if (/^##\d{4}/.test(trimmed) && (nameL.includes('hj212') || nameL.includes('hj 212'))) {
        setSelectedPluginId(plugin.id);
        return;
      }
      // SL651: 以 7E7E 开头 (hex)
      if (/^7[Ee]7[Ee]/i.test(trimmed) && (nameL.includes('sl651') || nameL.includes('sl 651'))) {
        setSelectedPluginId(plugin.id);
        return;
      }
      // Modbus: 以冒号开头(ASCII) 或短hex帧
      if (/^:/.test(trimmed) && nameL.includes('modbus')) {
        setSelectedPluginId(plugin.id);
        return;
      }
    }
  }, [parserPlugins]);

  useEffect(() => {
    if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current);
    if (rawInput.trim()) {
      detectTimeoutRef.current = setTimeout(() => detectProtocol(rawInput), 300);
    }
    return () => { if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current); };
  }, [rawInput, detectProtocol]);

  const handleParse = useCallback(async () => {
    if (!selectedPluginId || !rawInput.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await pluginService.parseData(selectedPluginId, rawInput.trim());
      setResult(res);
      // Auto-expand all groups by default
      if (res?.fields) {
        const groups = new Set<string>();
        res.fields.forEach(f => {
          if (f.group) groups.add(Array.isArray(f.group) ? f.group.join('/') : f.group);
        });
        const initialExpanded: Record<string, boolean> = {};
        groups.forEach(g => initialExpanded[g] = true);
        setExpandedGroups(initialExpanded);
      }
    } catch (e) {
      setResult({
        success: false,
        protocolName: '',
        summary: '',
        fields: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    setLoading(false);
  }, [selectedPluginId, rawInput]);

  const handleCopyResult = useCallback(async () => {
    if (!result || !result.fields.length) return;
    const text = result.fields.map((f) => `${f.label || f.key}: ${f.value}${f.unit ? ` ${f.unit}` : ''}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  // 聚合分组
  const groups = useMemo(() => {
    if (!result?.fields) return [];
    const set = new Set<string>();
    for (const f of result.fields) {
      if (f.group) set.add(Array.isArray(f.group) ? f.group.join('/') : f.group);
    }
    return Array.from(set);
  }, [result?.fields]);

  const keyFields = useMemo(() => {
    return result?.fields?.filter(f => f.isKeyInfo) || [];
  }, [result?.fields]);

  const filteredFields = useMemo(() => {
    if (!result?.fields) return [];
    let list = result.fields;
    if (groupFilter) {
      list = list.filter((f) => {
        const g = Array.isArray(f.group) ? f.group.join('/') : f.group;
        return g === groupFilter;
      });
    }
    if (fieldSearch) {
      const q = fieldSearch.toLowerCase();
      list = list.filter((f) => 
        f.key.toLowerCase().includes(q) || 
        f.label?.toLowerCase().includes(q) ||
        String(f.value).toLowerCase().includes(q)
      );
    }
    return list;
  }, [result?.fields, groupFilter, fieldSearch]);

  const toggleGroup = (g: string) => {
    setExpandedGroups(prev => ({ ...prev, [g]: !prev[g] }));
  };

  const renderFieldValue = (field: import('@/types/plugin').ParsedField) => {
    const valStr = String(field.value);
    const colorMap: Record<string, string> = {
      emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', 
      blue: 'bg-blue-500', purple: 'bg-purple-500', slate: 'bg-slate-500'
    };
    const textMap: Record<string, string> = {
      emerald: 'text-emerald-600 dark:text-emerald-400', 
      amber: 'text-amber-600 dark:text-amber-400', 
      red: 'text-red-600 dark:text-red-400', 
      blue: 'text-blue-600 dark:text-blue-400',
      purple: 'text-purple-600 dark:text-purple-400', 
      slate: 'text-slate-600 dark:text-slate-400'
    };
    const bgMap: Record<string, string> = {
      emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
      amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
      red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20',
      blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
      purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border-purple-200 dark:border-purple-500/20',
      slate: 'bg-slate-50 text-slate-700 dark:bg-slate-500/10 dark:text-slate-400 border-slate-200 dark:border-slate-500/20'
    };

    switch (field.uiType) {
      case 'status-dot':
        return (
          <div className="flex items-center gap-1.5 font-medium">
            <span className={cn("w-2 h-2 rounded-full", field.color ? colorMap[field.color] || colorMap.slate : "bg-text-tertiary")} />
            <span className={field.color ? textMap[field.color] : "text-text-primary"}>{valStr}</span>
          </div>
        );
      case 'badge':
        return (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-[6px] border text-[var(--fs-xs)] font-medium", field.color ? bgMap[field.color] || bgMap.slate : bgMap.slate)}>
            {valStr}
          </span>
        );
      case 'code':
      case 'json':
        return (
          <pre className="p-2 rounded-[6px] bg-bg-secondary/50 border border-border-default/40 font-mono text-[var(--fs-xs)] text-text-secondary whitespace-pre-wrap word-break">
            {typeof field.value === 'object' ? JSON.stringify(field.value, null, 2) : valStr}
          </pre>
        );
      case 'bit-map':
        return (
          <div className="flex flex-wrap gap-1">
            {String(valStr).split(',').map((bit, i) => (
              <span key={i} className="inline-block px-1.5 py-0.5 rounded bg-bg-secondary/60 text-[var(--fs-3xs)] font-mono text-text-secondary border border-border-default/40">
                {bit.trim()}
              </span>
            ))}
          </div>
        );
      case 'progress':
      default:
        return (
          <span className={cn(field.color && textMap[field.color])}>
            {typeof field.value === 'object' ? JSON.stringify(field.value) : valStr}
          </span>
        );
    }
  };

  if (parserPlugins.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-8 text-text-disabled', className)}>
        <FileCode2 className="h-8 w-8 opacity-30" />
        <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.noParser', '暂无已安装的协议解析器')}</p>
        <p className="text-text-tertiary max-w-[280px] text-center" style={{ fontSize: 'var(--fs-xs)' }}>
          {t('parser.noParserHint', '在插件仓库中安装协议解析插件以使用此功能')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* ── 输入区（非 compact 模式） ── */}
      {!compact && (
        <div className="shrink-0 border-b border-border-default/60 p-3 space-y-2">
          {/* 解析器选择 + 解析按钮 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={selectedPluginId || ''}
                onChange={(e) => setSelectedPluginId(e.target.value)}
                className="h-[32px] w-full appearance-none rounded-[10px] border border-border-default/80 bg-bg-secondary/42 pl-3 pr-8 text-text-primary outline-none transition-all focus:border-accent"
                style={{ fontSize: 'var(--fs-sm)' }}
              >
                {parserPlugins.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled pointer-events-none" />
            </div>
            <button
              onClick={handleParse}
              disabled={loading || !rawInput.trim()}
              className="flex items-center gap-1.5 h-[32px] px-4 rounded-[10px] bg-accent text-white font-medium transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              style={{ fontSize: 'var(--fs-sm)' }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              {t('parser.parse', '解析')}
            </button>
          </div>

          {/* 原始数据输入 */}
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={t('parser.inputPlaceholder', '粘贴原始报文数据...')}
            className="h-[80px] w-full resize-none rounded-[10px] border border-border-default/80 bg-bg-secondary/42 px-3 py-2 font-mono text-text-primary outline-none placeholder:text-text-tertiary transition-all focus:border-accent"
            style={{ fontSize: 'var(--fs-xs)' }}
          />
        </div>
      )}

      {/* ── 结果区 ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-disabled">
            <Loader2 className="h-6 w-6 animate-spin opacity-40" />
            <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.parsing', '解析中...')}</p>
          </div>
        )}

        {!loading && result?.error && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-disabled">
            <AlertCircle className="h-8 w-8 opacity-30 text-red-400" />
            <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.parseFailed', '解析失败')}</p>
            <p className="text-text-tertiary max-w-[400px] text-center" style={{ fontSize: 'var(--fs-xs)' }}>{result.error}</p>
          </div>
        )}

        {!loading && result?.success && (
          <div className="p-3 space-y-3">
            {/* 概要 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-[8px] bg-emerald-500/10 px-2.5 py-1 text-[var(--fs-xxs)] font-bold text-emerald-600">
                  {result.protocolName}
                </span>
                <span className="text-text-secondary truncate" style={{ fontSize: 'var(--fs-sm)' }}>
                  {result.summary}
                </span>
              </div>
              <button
                onClick={handleCopyResult}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--fs-xs)] text-text-tertiary hover:text-accent hover:bg-bg-hover transition-colors shrink-0"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied ? t('sidebar.copied', '已复制') : t('response.copy', '复制')}
              </button>
            </div>

            {/* 顶层重点卡片区 */}
            {keyFields.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
                {keyFields.map((field, i) => (
                  <div key={`key-${i}`} className="p-2.5 rounded-[10px] bg-bg-secondary/40 border border-border-default/60 flex flex-col justify-between overflow-hidden">
                    <span className="text-[var(--fs-xs)] text-text-tertiary truncate mb-1" title={field.label || field.key}>{field.label || field.key}</span>
                    <div className="text-[var(--fs-sm)] font-semibold truncate text-text-primary" title={String(field.value)}>
                      {renderFieldValue(field)}
                      {field.unit && <span className="ml-1 text-[var(--fs-xs)] text-text-disabled font-normal">{field.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 搜索与分组过滤 */}
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
                <input
                  type="text"
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder={t('parser.searchFields', '搜索字段名称或值...')}
                  className="w-full h-[30px] pl-8 pr-3 rounded-[8px] bg-bg-secondary/40 border border-border-default/60 text-[var(--fs-xs)] text-text-primary outline-none focus:border-accent transition-colors placeholder:text-text-tertiary"
                />
              </div>

              {groups.length > 1 && (
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-1 shrink-0">
                  <button
                    onClick={() => setGroupFilter(null)}
                    className={cn(
                      'shrink-0 rounded-[8px] px-2.5 py-1 text-[var(--fs-xxs)] font-medium transition-colors',
                      groupFilter === null
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-tertiary hover:bg-bg-hover'
                    )}
                  >
                    {t('parser.allGroups', '全部')} ({result.fields.length})
                  </button>
                  {groups.map((g) => {
                    const count = result.fields.filter(f => {
                       const fg = Array.isArray(f.group) ? f.group.join('/') : f.group;
                       return fg === g;
                    }).length;
                    return (
                      <button
                        key={g}
                        onClick={() => setGroupFilter(g)}
                        className={cn(
                          'shrink-0 rounded-[8px] px-2.5 py-1 text-[var(--fs-xxs)] font-medium transition-colors',
                          groupFilter === g
                            ? 'bg-accent/10 text-accent'
                            : 'text-text-tertiary hover:bg-bg-hover'
                        )}
                      >
                        {g} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 字段渲染 (手风琴/列表) */}
            <div className="space-y-2">
              {groups.map(g => {
                const groupFields = filteredFields.filter(f => {
                   const fg = Array.isArray(f.group) ? f.group.join('/') : f.group;
                   return fg === g;
                });
                
                if (groupFields.length === 0) return null;

                const isExpanded = expandedGroups[g] !== false;

                return (
                  <div key={g || 'default'} className="rounded-[10px] border border-border-default/60 overflow-hidden bg-bg-primary">
                    <div 
                      className="flex items-center justify-between px-3 py-2 bg-bg-secondary/30 cursor-pointer hover:bg-bg-secondary/50 transition-colors select-none"
                      onClick={() => toggleGroup(g)}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown className={cn("w-3.5 h-3.5 text-text-disabled transition-transform", !isExpanded && "-rotate-90")} />
                        <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">{g || t('parser.ungrouped', '未编号')}</span>
                        <span className="text-[var(--fs-3xs)] text-text-tertiary px-1.5 py-0.5 rounded bg-bg-secondary/60">{groupFields.length}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <table className="w-full border-collapse" style={{ fontSize: 'var(--fs-sm)' }}>
                        <tbody>
                          {groupFields.map((field, i) => (
                            <tr key={`${field.key}-${i}`} className={cn(
                              "hover:bg-bg-hover/30 transition-colors border-t border-border-default/40 first:border-0 group",
                              i % 2 === 1 && "bg-bg-secondary/20"
                            )}>
                              <td className="px-3 py-2 w-[40%] align-top">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-text-primary" title={field.key}>{field.label || field.key}</span>
                                  {field.label && field.label !== field.key && (
                                    <span className="text-[var(--fs-3xs)] text-text-disabled font-mono">{field.key}</span>
                                  )}
                                  {field.tooltip && (
                                    <span className="text-[var(--fs-3xs)] text-text-tertiary">{field.tooltip}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 break-all">
                                <div className="flex items-baseline gap-1.5">
                                  {renderFieldValue(field)}
                                  {field.unit && <span className="text-text-disabled text-[var(--fs-xs)] shrink-0">{field.unit}</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              
              {/* 无分组字段渲染 */}
              {filteredFields.filter(f => !f.group).length > 0 && (() => {
                const ungroupedFields = filteredFields.filter(f => !f.group);
                if (ungroupedFields.length === 0) return null;
                const isExpanded = expandedGroups['__ungrouped'] !== false;
                return (
                  <div className="rounded-[10px] border border-border-default/60 overflow-hidden bg-bg-primary">
                    <div 
                      className="flex items-center justify-between px-3 py-2 bg-bg-secondary/30 cursor-pointer hover:bg-bg-secondary/50 transition-colors select-none"
                      onClick={() => toggleGroup('__ungrouped')}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown className={cn("w-3.5 h-3.5 text-text-disabled transition-transform", !isExpanded && "-rotate-90")} />
                        <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">{t('parser.ungrouped', '未编组')}</span>
                        <span className="text-[var(--fs-3xs)] text-text-tertiary px-1.5 py-0.5 rounded bg-bg-secondary/60">{ungroupedFields.length}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <table className="w-full border-collapse" style={{ fontSize: 'var(--fs-sm)' }}>
                         <tbody>
                          {ungroupedFields.map((field, i) => (
                            <tr key={`${field.key}-${i}`} className={cn(
                              "hover:bg-bg-hover/30 transition-colors border-t border-border-default/40 first:border-0 group",
                              i % 2 === 1 && "bg-bg-secondary/20"
                            )}>
                              <td className="px-3 py-2 w-[40%] align-top">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-text-primary" title={field.key}>{field.label || field.key}</span>
                                  {field.label && field.label !== field.key && (
                                    <span className="text-[var(--fs-3xs)] text-text-disabled font-mono">{field.key}</span>
                                  )}
                                  {field.tooltip && (
                                    <span className="text-[var(--fs-3xs)] text-text-tertiary">{field.tooltip}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 break-all">
                                <div className="flex items-baseline gap-1.5">
                                  {renderFieldValue(field)}
                                  {field.unit && <span className="text-text-disabled text-[var(--fs-xs)] shrink-0">{field.unit}</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Hex 原始数据 */}
            {result.rawHex && (
              <div className="rounded-[10px] border border-border-default/60 overflow-hidden">
                <div className="px-3 py-1.5 bg-bg-secondary/30 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-disabled border-b border-border-default/60">
                  Raw Hex
                </div>
                <pre className="selectable p-3 font-mono text-[var(--fs-xs)] text-text-tertiary leading-5 whitespace-pre-wrap break-all">
                  {result.rawHex}
                </pre>
              </div>
            )}
          </div>
        )}

        {!loading && !result && !compact && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-disabled">
            <FileCode2 className="h-8 w-8 opacity-20" />
            <p style={{ fontSize: 'var(--fs-sm)' }}>{t('parser.readyTitle', '粘贴报文并点击解析')}</p>
            <p className="text-text-tertiary max-w-[280px] text-center" style={{ fontSize: 'var(--fs-xs)' }}>
              {t('parser.readyDesc', '支持 HJ212、Modbus 等工业协议的报文解析与结构化展示')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
