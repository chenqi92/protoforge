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

import { useState, useEffect, useMemo, useCallback } from 'react';
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

  const handleParse = useCallback(async () => {
    if (!selectedPluginId || !rawInput.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await pluginService.parseData(selectedPluginId, rawInput.trim());
      setResult(res);
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
      if (f.group) set.add(f.group);
    }
    return Array.from(set);
  }, [result?.fields]);

  const filteredFields = useMemo(() => {
    if (!result?.fields) return [];
    if (!groupFilter) return result.fields;
    return result.fields.filter((f) => f.group === groupFilter);
  }, [result?.fields, groupFilter]);

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

            {/* 分组过滤 */}
            {groups.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => setGroupFilter(null)}
                  className={cn(
                    'rounded-[8px] px-2.5 py-1 text-[var(--fs-xxs)] font-medium transition-colors',
                    groupFilter === null
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-tertiary hover:bg-bg-hover'
                  )}
                >
                  {t('parser.allGroups', '全部')} ({result.fields.length})
                </button>
                {groups.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupFilter(g)}
                    className={cn(
                      'rounded-[8px] px-2.5 py-1 text-[var(--fs-xxs)] font-medium transition-colors',
                      groupFilter === g
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-tertiary hover:bg-bg-hover'
                    )}
                  >
                    {g} ({result.fields.filter((f) => f.group === g).length})
                  </button>
                ))}
              </div>
            )}

            {/* 字段表格 */}
            <div className="rounded-[10px] border border-border-default/70 overflow-hidden">
              <table className="w-full border-collapse" style={{ fontSize: 'var(--fs-sm)' }}>
                <thead>
                  <tr className="bg-bg-secondary/40">
                    <th className="text-left px-3 py-2 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary border-b border-border-default/60 w-[40%]">
                      {t('parser.field', '字段')}
                    </th>
                    <th className="text-left px-3 py-2 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary border-b border-border-default/60">
                      {t('parser.value', '值')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFields.map((field, i) => (
                    <tr key={`${field.key}-${i}`} className="hover:bg-bg-hover/30 transition-colors">
                      <td className="px-3 py-1.5 border-b border-border-default/40">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-text-primary">{field.label || field.key}</span>
                          {field.group && groups.length > 1 && (
                            <span className="rounded bg-bg-secondary/60 px-1.5 py-0.5 text-[var(--fs-3xs)] text-text-disabled">{field.group}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 border-b border-border-default/40 font-mono text-text-secondary">
                        <span className="selectable">{field.value}</span>
                        {field.unit && <span className="ml-1 text-text-disabled">{field.unit}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
