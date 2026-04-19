/**
 * ResponseViewer — 通用响应体展示组件
 * 支持多种视图模式：JSON（格式化 + 过滤）、Raw、预览（HTML）
 * 可复用于 HTTP 响应、WebSocket 消息、TCP 数据等
 * 支持插件渲染器（如 Excel）— 通过 contributes.responseRenderers 动态注入 Tab
 */

import { lazy, Suspense, useState, useMemo, useCallback, useEffect, useDeferredValue } from 'react';
import { Copy, Check, WrapText, Search, Minimize2, Maximize2, Download, FileBox, HardDrive, Filter, Music, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
// JsonTreeViewer removed — using Monaco exclusively for JSON
import { usePluginStore } from '@/stores/pluginStore';
import { invoke } from '@tauri-apps/api/core';
import type { RendererContribution } from '@/types/plugin';
import { PluginRendererView } from '@/components/ui/PluginRendererView';
import { ProtocolParserPanel } from '@/components/plugins/ProtocolParserPanel';
import { ResolvedIcon } from '@/components/common/ResolvedIcon';
import { ResponseExportDropdown, findArrayNodes } from '@/components/ui/ResponseExportDropdown';

export type ViewMode = 'json' | 'raw' | 'preview' | 'hex' | 'base64';

/** 插件渲染器 tab 描述 */
interface PluginRendererTab {
  pluginId: string;
  renderer: RendererContribution;
}

interface ResponseViewerProps {
  body: string;
  contentType?: string | null;
  /** 额外的响应头信息，用于 Content-Disposition 匹配 */
  responseHeaders?: Record<string, string> | Array<[string, string]>;
  /** 是否为 base64 编码的二进制数据 */
  isBinary?: boolean;
  /** Restrict to specific modes — by default auto-detects available modes */
  modes?: ViewMode[];
  /** If true, hide the mode bar (used inline) */
  compact?: boolean;
  className?: string;
}

/* ── 判断是否为 Excel 内容 ── */
function getHeaderValue(
  headers: Record<string, string> | Array<[string, string]> | undefined,
  name: string,
) {
  if (!headers) return '';
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
  }
  return headers[name] || headers[name.toLowerCase()] || '';
}

function isExcelContent(contentType?: string | null, responseHeaders?: Record<string, string> | Array<[string, string]>): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  // 明确的 Excel MIME
  if (ct.includes('spreadsheetml') || ct.includes('ms-excel')) return true;
  // application/octet-stream 需要通过 Content-Disposition 或 URL 二次确认
  if (ct.includes('octet-stream')) {
    const disposition = getHeaderValue(responseHeaders, 'content-disposition');
    if (/\.xlsx?\b/i.test(disposition)) return true;
  }
  return false;
}

/* ── Hex view ── */
function HexView({ data }: { data: string }) {
  const { t } = useTranslation();
  const lines = useMemo(() => {
    const result: { offset: string; hex: string; ascii: string }[] = [];
    const bytes = new TextEncoder().encode(data);
    for (let i = 0; i < Math.min(bytes.length, 4096); i += 16) {
      const slice = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(8, '0');
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
      result.push({ offset, hex: hex.padEnd(48, ' '), ascii });
    }
    return result;
  }, [data]);

  return (
    <div className="selectable overflow-x-auto font-mono leading-[18px]" style={{ fontSize: 'var(--fs-xs)' }}>
      <div className="min-w-[620px]">
        <div className="mb-2 grid grid-cols-[72px_minmax(0,1fr)_150px] gap-4 pf-rounded-md border border-border-default/60 bg-bg-secondary/30 px-2 py-2 font-semibold uppercase tracking-[0.08em] text-text-tertiary" style={{ fontSize: 'var(--fs-xxs)' }}>
          <span>Offset</span>
          <span>Hex</span>
          <span>ASCII</span>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[72px_minmax(0,1fr)_150px] gap-4 pf-rounded-sm px-2 py-1 hover:bg-bg-hover/30">
            <span className="shrink-0 text-text-disabled">{line.offset}</span>
            <span className="min-w-0 text-[#0284c7]">{line.hex}</span>
            <span className="shrink-0 text-text-tertiary">{line.ascii}</span>
          </div>
        ))}
        {data.length > 4096 && (
          <div className="mt-2 italic text-text-disabled" style={{ fontSize: 'var(--fs-xxs)' }}>
            {t('response.truncated', { total: data.length })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReadonlyCodeBlock({
  value,
  language = 'json',
  minHeightClassName = 'min-h-[320px]',
}: {
  value: string;
  language?: string;
  minHeightClassName?: string;
}) {
  if (language === 'json') {
    return (
      <div className={cn("flex h-full min-h-0 overflow-hidden", minHeightClassName)}>
        <div className="flex-1 min-h-0">
          <MonacoReadonlyViewer value={value} language="json" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col overflow-hidden pf-rounded-md border border-border-default/60 bg-bg-primary h-full", minHeightClassName)}>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-3">
        <pre
          className="font-mono whitespace-pre-wrap break-all text-text-primary"
          style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}
        >
          {value}
        </pre>
      </div>
    </div>
  );
}

/* ── Monaco readonly viewer for response body ── */
const LazyCodeEditor = lazy(() => import('@/components/common/CodeEditor').then((m) => ({ default: m.CodeEditor })));

function MonacoReadonlyViewer({ value, language }: { value: string; language: string }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-text-tertiary pf-text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...</div>}>
      <LazyCodeEditor
        value={value}
        language={language}
        readOnly
        height="100%"
        stickyScroll={false}
      />
    </Suspense>
  );
}

/* ── Main Component ── */
export function ResponseViewer({ body, contentType, responseHeaders, isBinary, modes, compact, className }: ResponseViewerProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [isRegexMode, setIsRegexMode] = useState(false);
  const [jsonFilterKeys, setJsonFilterKeys] = useState<Set<string>>(new Set());
  const [showKeyFilter, setShowKeyFilter] = useState(false);
  const [filterValue, setFilterValue] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const deferredFilterValue = useDeferredValue(filterValue);

  // 插件渲染器匹配
  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  const matchedRenderers = useMemo<PluginRendererTab[]>(() => {
    if (!contentType) return [];
    const ct = contentType.toLowerCase();
    const tabs: PluginRendererTab[] = [];

    for (const plugin of installedPlugins) {
      if (!plugin.contributes?.responseRenderers) continue;
      for (const renderer of plugin.contributes.responseRenderers) {
        const matched = renderer.contentTypes.some(pattern => {
          const p = pattern.toLowerCase();
          if (p === 'application/octet-stream') {
            // octet-stream 需要二次确认
            return ct.includes('octet-stream') && isExcelContent(contentType, responseHeaders);
          }
          return ct.includes(p);
        });
        if (matched) {
          tabs.push({ pluginId: plugin.id, renderer });
        }
      }
    }
    return tabs;
  }, [contentType, responseHeaders, installedPlugins]);

  const analyzedTextBody = useMemo(() => {
    if (isBinary) {
      return {
        isJson: false,
        isHtml: false,
        isXml: false,
        jsonData: null as unknown,
        prettyBody: '',
        rawDisplayBody: '',
      };
    }

    const trimmed = body.trimStart();
    let jsonData: unknown = null;
    let isJson = false;

    if (contentType?.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        jsonData = JSON.parse(body);
        isJson = true;
      } catch {
        jsonData = null;
      }
    }

    const isHtml = contentType?.includes('html') || trimmed.startsWith('<!') || trimmed.startsWith('<html');
    const isXml = !isJson && (contentType?.includes('xml') || trimmed.startsWith('<?xml'));

    let prettyBody = body;
    if (isJson) {
      prettyBody = JSON.stringify(jsonData, null, 2);
    } else if (isXml) {
      prettyBody = body.replace(/></g, '>\n<');
    }

    return {
      isJson,
      isHtml,
      isXml,
      jsonData,
      prettyBody,
      rawDisplayBody: body,
    };
  }, [body, contentType, isBinary]);

  const {
    isJson,
    isHtml,
    isXml,
    jsonData,
    prettyBody,
    rawDisplayBody,
  } = analyzedTextBody;

  // 暴露 JSON 响应体供右键菜单导出使用（不在 cleanup 中清除，避免 tab 切换导致丢失）
  useEffect(() => {
    if (isJson && !isBinary && body) {
      (window as any).__pf_response_body = body;
    }
  }, [isJson, isBinary, body]);

  // 预先缓存导出所需的数组节点信息，避免右键时再次同步 JSON.parse 卡住主线程
  useEffect(() => {
    if (!isJson || isBinary || !body || jsonData == null) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    const idleWindow = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const publishExportMeta = () => {
      if (cancelled) return;
      const arrayNodes = findArrayNodes(jsonData);
      const bestArrayPath = arrayNodes.length > 0
        ? arrayNodes.reduce((a, b) => (b.length > a.length ? b : a)).path
        : '';

      if (cancelled) return;

      (window as any).__pf_response_export_meta = {
        body,
        arrayNodes,
        bestArrayPath,
      };

      window.dispatchEvent(new CustomEvent('pf-response-export-meta-ready', { detail: { body } }));
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleId = idleWindow.requestIdleCallback(() => publishExportMeta(), { timeout: 500 });
    } else {
      timeoutId = globalThis.setTimeout(publishExportMeta, 0);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [isJson, isBinary, body, jsonData]);

  // Available modes
  const availableModes = useMemo(() => {
    if (modes) return modes;
    if (isBinary) {
      // 二进制响应：默认显示文件信息卡片，可选 Hex 预览
      const m: ViewMode[] = ['raw', 'hex'];
      return m;
    }
    const m: ViewMode[] = [];
    if (isJson) m.push('json');
    m.push('raw');
    m.push('base64');
    if (isHtml) m.push('preview');
    m.push('hex');
    return m;
  }, [modes, isJson, isHtml, isBinary]);

  // 联合 tab：内置 + 插件
  type ActiveTab = ViewMode | `plugin:${string}` | 'protocol-parser';
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => availableModes[0] || 'raw');

  useEffect(() => {
    setActiveTab(availableModes[0] || 'raw');
  }, [availableModes, body, contentType, compact, modes]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [body]);

  // 二进制文件真实大小（从 base64 反算）
  const binaryFileSize = useMemo(() => {
    if (!isBinary) return 0;
    const padding = (body.match(/=+$/) || [''])[0].length;
    return Math.floor((body.length * 3) / 4) - padding;
  }, [body, isBinary]);

  const searchMeta = useMemo(() => {
    if (!showSearch || !deferredSearchText) {
      return { count: 0, regexError: null as string | null };
    }
    const target =
      activeTab === 'json' ? prettyBody :
      activeTab === 'raw' ? body :
      body;

    try {
      const regex = isRegexMode
        ? new RegExp(deferredSearchText, 'gi')
        : new RegExp(deferredSearchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return {
        count: (target.match(regex) || []).length,
        regexError: null,
      };
    } catch (e) {
      return {
        count: 0,
        regexError: String(e).replace(/^SyntaxError: /, ''),
      };
    }
  }, [showSearch, deferredSearchText, prettyBody, body, activeTab, isRegexMode]);

  // 递归提取 JSON 所有层级的 keys（深度 + 数组采样限制，防止大数据卡顿）
  const availableJsonKeys = useMemo<string[]>(() => {
    if (!jsonData) return [];
    const keys = new Set<string>();
    const MAX_DEPTH = 5;
    const MAX_SAMPLE = 20;
    const MAX_KEYS = 500;

    function collect(obj: unknown, depth: number) {
      if (depth > MAX_DEPTH || keys.size >= MAX_KEYS || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        const limit = Math.min(obj.length, MAX_SAMPLE);
        for (let i = 0; i < limit; i++) collect(obj[i], depth);
      } else {
        for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
          keys.add(key);
          if (keys.size >= MAX_KEYS) return;
          if (val && typeof val === 'object') collect(val, depth + 1);
        }
      }
    }

    collect(jsonData, 0);
    return Array.from(keys).sort();
  }, [jsonData]);

  // 按搜索文本过滤可见 chips
  const visibleJsonKeys = useMemo(() => {
    if (!deferredSearchText) return availableJsonKeys;
    const lower = deferredSearchText.toLowerCase();
    return availableJsonKeys.filter(k => k.toLowerCase().includes(lower));
  }, [availableJsonKeys, deferredSearchText]);

  // 根据 key 过滤后的 JSON 展示内容（支持 key 投影 + key=value 行筛选两种模式）
  const filteredPrettyBody = useMemo(() => {
    if (jsonFilterKeys.size === 0 || !jsonData) return prettyBody;

    const selectedKeys = jsonFilterKeys;
    const valueFilter = deferredFilterValue.trim();

    /** Mode A: 投影 — 仅保留选中 key，递归保持链路结构 */
    function projectKeys(obj: unknown): unknown {
      if (obj == null || typeof obj !== 'object') return undefined;
      if (Array.isArray(obj)) {
        const mapped = obj.map(item => projectKeys(item)).filter(v => v !== undefined);
        return mapped.length > 0 ? mapped : undefined;
      }
      const result: Record<string, unknown> = {};
      let has = false;
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        if (selectedKeys.has(key)) {
          result[key] = val; has = true;
        } else if (val && typeof val === 'object') {
          const nested = projectKeys(val);
          if (nested !== undefined) { result[key] = nested; has = true; }
        }
      }
      return has ? result : undefined;
    }

    /** Mode B: 行筛选 — 筛选数组中 key=value 匹配的项，保留完整对象和链路 */
    function filterByValue(obj: unknown): unknown {
      if (obj == null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        const hasTargetKey = obj.some(item =>
          item && typeof item === 'object' && !Array.isArray(item) &&
          [...selectedKeys].some(k => k in (item as Record<string, unknown>))
        );
        if (hasTargetKey) {
          const lv = valueFilter.toLowerCase();
          return obj.filter(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
            const rec = item as Record<string, unknown>;
            return [...selectedKeys].some(key => {
              const v = rec[key];
              if (v === undefined) return false;
              const sv = typeof v === 'string' ? v : JSON.stringify(v);
              return sv.toLowerCase().includes(lv);
            });
          });
        }
        const mapped = obj.map(item => filterByValue(item));
        return mapped;
      }
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        result[k] = (v && typeof v === 'object') ? filterByValue(v) : v;
      }
      return result;
    }

    try {
      const filtered = valueFilter ? filterByValue(jsonData) : projectKeys(jsonData);
      return JSON.stringify(filtered ?? (Array.isArray(jsonData) ? [] : {}), null, 2);
    } catch {
      return prettyBody;
    }
  }, [jsonData, jsonFilterKeys, deferredFilterValue, prettyBody]);

  // 当 JSON 数据变化时，清除不再存在的 key 过滤
  useEffect(() => {
    if (jsonFilterKeys.size > 0 && availableJsonKeys.length > 0) {
      const validKeys = new Set(availableJsonKeys);
      const newFilterKeys = new Set([...jsonFilterKeys].filter(k => validKeys.has(k)));
      if (newFilterKeys.size !== jsonFilterKeys.size) {
        setJsonFilterKeys(newFilterKeys);
      }
    }
  }, [availableJsonKeys]);

  // value 过滤仅在单 key 选中时有意义
  useEffect(() => {
    if (jsonFilterKeys.size === 0) setFilterValue('');
  }, [jsonFilterKeys.size]);


  const modeLabels: Record<ViewMode, string> = {
    json: 'Pretty',
    raw: isBinary ? t('response.fileInfo', { defaultValue: '文件信息' }) : 'Raw',
    base64: 'Base64',
    preview: t('response.preview'),
    hex: 'Hex',
  };

  // 当前是否在插件 tab
  const activePluginTab = activeTab.startsWith('plugin:')
    ? matchedRenderers.find((_, i) => activeTab === `plugin:${i}`)
    : null;
  const activeBuiltinMode: ViewMode | null = activeTab.startsWith('plugin:') ? null : activeTab as ViewMode;

  if (!body) return null;

  return (
    <div className={cn('selectable flex h-full flex-col overflow-hidden bg-bg-primary/60', className)}>
      {/* Mode Bar */}
      {!compact && (
        <div className="flex items-center shrink-0 border-b border-border-default bg-bg-secondary/42 px-3 py-2">
          <div className="response-viewer-tabs">
            {/* 内置 tab */}
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => setActiveTab(mode)}
                className={cn(
                  'response-viewer-tab',
                  activeBuiltinMode === mode && 'is-active'
                )}
              >
                {modeLabels[mode]}
              </button>
            ))}
            {/* 协议解析器已移至右键菜单触发 */}
            {/* 插件渲染器 tab */}
            {matchedRenderers.map((pt, idx) => (
              <button
                key={`plugin-${idx}`}
                onClick={() => setActiveTab(`plugin:${idx}`)}
                className={cn(
                  'response-viewer-tab flex items-center gap-1',
                  activeTab === `plugin:${idx}` && 'is-active'
                )}
              >
                <ResolvedIcon icon={pt.renderer.icon} size={14} />
                <span>{pt.renderer.name}</span>
              </button>
            ))}
            {/* 协议解析器已移至右键菜单触发 */}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 px-2">
            {/* Search toggle */}
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={cn(
                'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
                showSearch ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:bg-bg-hover'
              )}
              title={t('response.search')}
            >
              <Search className="w-3 h-3" />
            </button>

            {/* Word wrap */}
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className={cn(
                'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
                wordWrap ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:bg-bg-hover'
              )}
              title={t('response.wordWrap')}
            >
              <WrapText className="w-3 h-3" />
            </button>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className="h-6 w-6 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover transition-colors"
              title={t('response.copy')}
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>

            {/* Response Export — only for JSON responses */}
            {isJson && !isBinary && (
              <ResponseExportDropdown body={body} />
            )}
          </div>
        </div>
      )}

      {/* Search Bar + Key Filter — only when search is open */}
      {showSearch && (
        <div className="border-b border-border-default bg-bg-secondary/24 shrink-0">
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Search className="w-3 h-3 text-text-disabled shrink-0" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={isRegexMode ? t('response.regexPlaceholder', { defaultValue: '正则表达式...' }) : t('response.searchPlaceholder')}
              className={cn('flex-1 h-6 bg-transparent outline-none text-text-primary placeholder:text-text-tertiary', searchMeta.regexError && 'text-red-500')} style={{ fontSize: 'var(--fs-sm)' }}
              autoFocus
            />
            {/* Regex toggle */}
            <button
              onClick={() => setIsRegexMode(!isRegexMode)}
              className={cn(
                'h-5 px-1.5 rounded text-[10px] font-bold font-mono transition-all shrink-0 leading-none',
                isRegexMode ? 'text-accent bg-accent/12 ring-1 ring-inset ring-accent/25' : 'text-text-disabled hover:text-text-tertiary hover:bg-bg-hover'
              )}
              title={t('response.regexMode', { defaultValue: '正则模式' })}
            >
              .*
            </button>
            {/* Key filter toggle — JSON mode only */}
            {activeBuiltinMode === 'json' && availableJsonKeys.length > 0 && (
              <button
                onClick={() => {
                  if (showKeyFilter) {
                    setShowKeyFilter(false);
                    setJsonFilterKeys(new Set());
                    setFilterValue('');
                  } else {
                    setShowKeyFilter(true);
                  }
                }}
                className={cn(
                  'h-5 flex items-center gap-1 px-1.5 rounded text-[10px] font-medium transition-all shrink-0',
                  showKeyFilter || jsonFilterKeys.size > 0
                    ? 'text-accent bg-accent/12 ring-1 ring-inset ring-accent/25'
                    : 'text-text-disabled hover:text-text-tertiary hover:bg-bg-hover'
                )}
                title={t('response.filterByKey', { defaultValue: 'Key 过滤' })}
              >
                <Filter className="w-2.5 h-2.5" />
                {jsonFilterKeys.size > 0 ? jsonFilterKeys.size : ''}
              </button>
            )}
            {deferredSearchText && !searchMeta.regexError && (
              <span className="text-text-disabled tabular-nums shrink-0" style={{ fontSize: 'var(--fs-xxs)' }}>
                {t('response.matchCount', { count: searchMeta.count })}
              </span>
            )}
            {searchMeta.regexError && (
              <span className="text-red-400 truncate max-w-[160px] shrink-0" style={{ fontSize: 'var(--fs-xxs)' }} title={searchMeta.regexError}>
                {t('response.regexInvalid', { defaultValue: '无效正则' })}
              </span>
            )}
          </div>

          {/* Key chips row — 按搜索文本过滤，渲染上限 200 */}
          {showKeyFilter && activeBuiltinMode === 'json' && availableJsonKeys.length > 0 && (
            <div className="flex flex-col gap-1 px-3 pb-1.5">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                {visibleJsonKeys.slice(0, 200).map(key => {
                  const isActive = jsonFilterKeys.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setJsonFilterKeys(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      className={cn(
                        'inline-flex items-center gap-1 h-[22px] px-2 pf-rounded-sm text-[11px] font-mono whitespace-nowrap transition-all shrink-0 border',
                        isActive
                          ? 'bg-accent/10 text-accent border-accent/25 shadow-[0_0_0_1px_rgba(59,130,246,0.06)]'
                          : 'bg-bg-primary/80 text-text-tertiary border-border-default/60 hover:bg-bg-hover hover:text-text-secondary hover:border-border-default'
                      )}
                    >
                      {isActive && <Check className="w-2.5 h-2.5" />}
                      {key}
                    </button>
                  );
                })}
                {visibleJsonKeys.length > 200 && (
                  <span className="text-text-disabled text-[10px] shrink-0 pl-1">
                    {t('response.moreKeys', { count: visibleJsonKeys.length - 200, defaultValue: `… 还有 ${visibleJsonKeys.length - 200} 个` })}
                  </span>
                )}
                {deferredSearchText && visibleJsonKeys.length === 0 && (
                  <span className="text-text-disabled text-[11px]">
                    {t('response.noMatchingKeys', { defaultValue: '无匹配 Key' })}
                  </span>
                )}
              </div>

              {/* Value 过滤输入 — 选中 key 后出现 */}
              {jsonFilterKeys.size > 0 && (
                <div className="flex items-center gap-1.5 h-[26px] px-2 rounded-md border border-border-default/60 bg-bg-primary/60">
                  <span className="text-accent/60 font-mono text-[11px] shrink-0">{[...jsonFilterKeys].join(', ')}</span>
                  <span className="text-text-disabled text-[11px] shrink-0">=</span>
                  <input
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    placeholder={t('response.filterValuePlaceholder', { defaultValue: '输入值筛选匹配项…' })}
                    className="flex-1 min-w-0 h-full bg-transparent outline-none text-text-primary placeholder:text-text-disabled font-mono text-[11px]"
                  />
                  {filterValue && (
                    <button onClick={() => setFilterValue('')} className="text-text-disabled hover:text-text-secondary shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto",
          // JSON 模式 Monaco/Tree 自带 padding，不加外层 padding
          activeBuiltinMode === 'json' ? '' : 'px-3 py-2',
        )}
        style={{ userSelect: 'text' }}
      >
        <div className="h-full">
          {activeBuiltinMode === 'json' && (
            <div className="flex flex-col h-full">
              {jsonData === null ? (
                <div className="pf-rounded-md border border-amber-300/60 bg-amber-500/8 px-3 py-2 text-amber-700 dark:text-amber-300 shrink-0" style={{ fontSize: 'var(--fs-xs)' }}>
                  {t('response.invalidJsonPrettyFallback')}
                </div>
              ) : null}
              {jsonFilterKeys.size > 0 && (
                <div className="flex items-center gap-1.5 pf-rounded-sm bg-accent/6 border border-accent/15 px-2.5 py-1 shrink-0" style={{ fontSize: 'var(--fs-xxs)' }}>
                  <Filter className="w-2.5 h-2.5 text-accent/60" />
                  <span className="text-accent/80">
                    {deferredFilterValue
                      ? t('response.filterActiveWithValue', {
                          keys: [...jsonFilterKeys].join(', '),
                          value: deferredFilterValue,
                          defaultValue: `筛选 ${[...jsonFilterKeys].join(', ')} = "${deferredFilterValue}"`,
                        })
                      : t('response.filterActive', { count: jsonFilterKeys.size, defaultValue: `已过滤 ${jsonFilterKeys.size} 个 Key` })
                    }
                  </span>
                  {!deferredFilterValue && (
                    <span className="text-accent/50 font-mono truncate">{[...jsonFilterKeys].join(', ')}</span>
                  )}
                </div>
              )}
              <div className="flex-1 min-h-0">
                <ReadonlyCodeBlock
                  value={jsonFilterKeys.size > 0 ? filteredPrettyBody : prettyBody}
                  language={jsonData !== null ? 'json' : isXml ? 'xml' : 'plaintext'}
                  minHeightClassName=""
                />
              </div>
            </div>
          )}

          {activeBuiltinMode === 'raw' && (
            isBinary ? (
              <BinaryFileCard
                contentType={contentType}
                fileSize={binaryFileSize}
                body={body}
                responseHeaders={responseHeaders}
              />
            ) : (
              <div className={cn("max-w-full", !wordWrap && "overflow-x-auto")}>
                <pre
                  className={cn(
                    'font-mono text-text-primary leading-[20px]',
                    wordWrap ? 'whitespace-pre-wrap break-all' : 'min-w-max whitespace-pre'
                  )}
                  style={{ fontSize: 'var(--fs-sm)' }}
                >
                  {deferredSearchText ? (
                    <HighlightedText text={rawDisplayBody} search={deferredSearchText} isRegex={isRegexMode} />
                  ) : (
                    rawDisplayBody
                  )}
                </pre>
              </div>
            )
          )}

          {activeBuiltinMode === 'base64' && (
              <Base64View body={body} isBinary={isBinary} wordWrap={wordWrap} searchText={deferredSearchText} />
          )}

          {activeBuiltinMode === 'preview' && isHtml && (
            <iframe
              srcDoc={body}
              sandbox="allow-same-origin"
              className="min-h-[420px] w-full pf-rounded-md border border-border-default bg-white"
              title="HTML Preview"
            />
          )}

          {activeBuiltinMode === 'hex' && (
            <HexView data={body} />
          )}

          {/* 插件渲染器内容 — 通用管线 */}
          {activePluginTab && (
            <PluginRendererView
              pluginId={activePluginTab.pluginId}
              body={body}
              isBinary={isBinary}
            />
          )}

          {/* 协议解析器面板 */}
          {activeTab === 'protocol-parser' && (
            <ProtocolParserPanel initialData={body} compact className="h-full" />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Base64 View ── */
function Base64View({ body, isBinary, wordWrap, searchText }: {
  body: string;
  isBinary?: boolean;
  wordWrap: boolean;
  searchText: string;
}) {
  const base64Content = useMemo(() => {
    if (isBinary) return body; // already base64
    try {
      // text → base64
      const bytes = new TextEncoder().encode(body);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch {
      return body;
    }
  }, [body, isBinary]);

  return (
    <div className={cn("max-w-full", !wordWrap && "overflow-x-auto")}>
      <pre
        className={cn(
          'font-mono text-text-primary leading-[20px]',
          wordWrap ? 'whitespace-pre-wrap break-all' : 'min-w-max whitespace-pre'
        )}
        style={{ fontSize: 'var(--fs-sm)' }}
      >
        {searchText ? (
          <HighlightedText text={base64Content} search={searchText} />
        ) : (
          base64Content
        )}
      </pre>
    </div>
  );
}

/* ── Binary file preview / info card ── */
function BinaryFileCard({ contentType, fileSize, body, responseHeaders }: {
  contentType?: string | null;
  fileSize: number;
  body: string;
  responseHeaders?: Record<string, string> | Array<[string, string]>;
}) {
  const { t } = useTranslation();

  const ct = (contentType || '').toLowerCase();

  // ── 魔数嗅探 ──
  const sniffedMime = useMemo(() => {
    return detectMimeFromBase64(body, ct);
  }, [body, ct]);

  // ── 分类 ──
  const previewKind = useMemo(() => {
    if (sniffedMime.includes('image/')) return 'image' as const;
    if (sniffedMime.includes('pdf')) return 'pdf' as const;
    if (sniffedMime.includes('audio/') || sniffedMime.includes('mpeg') || sniffedMime.includes('wav') || sniffedMime.includes('ogg')) return 'audio' as const;
    if (sniffedMime.includes('video/')) return 'video' as const;
    return 'generic' as const;
  }, [sniffedMime]);

  // ── 文件大小标签 ──
  const sizeLabel = fileSize < 1024
    ? `${fileSize} B`
    : fileSize < 1024 * 1024
      ? `${(fileSize / 1024).toFixed(1)} KB`
      : `${(fileSize / (1024 * 1024)).toFixed(2)} MB`;

  // ── 文件类型标签 ──
  const fileTypeLabel = useMemo(() => {
    if (sniffedMime.includes('pdf')) return 'PDF';
    if (sniffedMime.includes('zip')) return 'ZIP';
    if (sniffedMime.includes('gzip')) return 'GZIP';
    if (sniffedMime.includes('tar')) return 'TAR';
    if (sniffedMime.includes('png')) return 'PNG';
    if (sniffedMime.includes('jpeg') || sniffedMime.includes('jpg')) return 'JPEG';
    if (sniffedMime.includes('gif')) return 'GIF';
    if (sniffedMime.includes('webp')) return 'WebP';
    if (sniffedMime.includes('svg')) return 'SVG';
    if (sniffedMime.includes('mp4')) return 'MP4';
    if (sniffedMime.includes('mp3') || sniffedMime.includes('mpeg')) return 'MP3';
    if (sniffedMime.includes('wav')) return 'WAV';
    if (sniffedMime.includes('spreadsheetml') || sniffedMime.includes('ms-excel')) return 'Excel';
    if (sniffedMime.includes('wordprocessingml') || sniffedMime.includes('msword')) return 'Word';
    if (sniffedMime.includes('presentationml') || sniffedMime.includes('ms-powerpoint')) return 'PowerPoint';
    if (ct.includes('protobuf')) return 'Protobuf';
    if (ct.includes('wasm')) return 'WebAssembly';
    if (ct.includes('octet-stream')) return t('response.binaryFile', { defaultValue: '二进制文件' });
    if (ct.includes('image/')) return t('response.imageFile', { defaultValue: '图片' });
    if (ct.includes('audio/')) return t('response.audioFile', { defaultValue: '音频' });
    if (ct.includes('video/')) return t('response.videoFile', { defaultValue: '视频' });
    return t('response.binaryFile', { defaultValue: '二进制文件' });
  }, [ct, t]);

  // ── 从 Content-Disposition 中提取文件名 ──
  const fileName = useMemo(() => {
    const disposition = getHeaderValue(responseHeaders, 'content-disposition');
    const match = disposition.match(/filename[*]?=["']?([^"';\s]+)/i);
    return match?.[1] || null;
  }, [responseHeaders]);

  // ── 另存为 ──
  const handleSave = useCallback(async () => {
    const suggested = fileName || `response.${guessExtension(sniffedMime)}`;
    try {
      await invoke('save_response_body', {
        bodyBase64: body,
        suggestedName: suggested,
      });
    } catch (e) {
      console.warn('保存失败:', e);
    }
  }, [body, sniffedMime, fileName]);

  // ── 图片/PDF/音视频：生成 data URL 或 blob URL ──
  const mediaUrl = useMemo(() => {
    if (previewKind === 'image') {
      // 图片直接用 data URL（避免 blob 生命周期问题）
      // 如果后端传的是 application/octet-stream，直接用 data URL 渲染可能会失败，所以强制指定 image mime
      let mime = sniffedMime;
      if (!mime.includes('image/')) mime = 'image/jpeg';
      return `data:${mime};base64,${body}`;
    }
    if (previewKind === 'pdf' || previewKind === 'audio' || previewKind === 'video') {
      // PDF/音视频用 Blob URL
      try {
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: sniffedMime || 'application/octet-stream' });
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    }
    return null;
  }, [body, sniffedMime, previewKind]);

  // 清理 blob URL
  useEffect(() => {
    return () => {
      if (mediaUrl && mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaUrl);
      }
    };
  }, [mediaUrl]);

  // ── 底部工具栏（所有类型通用） ──
  const toolbar = (
    <div className="flex items-center gap-3 shrink-0 border-t border-border-default/60 bg-bg-secondary/40 px-4 py-2.5">
      <FileBox className="h-4 w-4 text-text-disabled shrink-0" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="font-semibold text-text-primary truncate" style={{ fontSize: 'var(--fs-sm)' }}>
          {fileName || fileTypeLabel}
        </span>
        <span className="text-text-disabled" style={{ fontSize: 'var(--fs-xs)' }}>·</span>
        <span className="text-text-tertiary shrink-0" style={{ fontSize: 'var(--fs-xs)' }}>
          {sniffedMime || 'unknown'}
        </span>
        <span className="text-text-disabled" style={{ fontSize: 'var(--fs-xs)' }}>·</span>
        <span className="text-text-disabled tabular-nums shrink-0" style={{ fontSize: 'var(--fs-xs)' }}>
          {sizeLabel}
        </span>
      </div>
      <button
        onClick={handleSave}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-white shadow-sm transition-colors hover:bg-accent-hover shrink-0"
        style={{ fontSize: 'var(--fs-xs)' }}
      >
        <Download className="h-3.5 w-3.5" />
        {t('response.saveToFile', { defaultValue: '另存为' })}
      </button>
    </div>
  );

  // ── 图片预览 ──
  if (previewKind === 'image' && mediaUrl) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4 bg-[repeating-conic-gradient(var(--color-border-default)_0%_25%,transparent_0%_50%)_50%/20px_20px]">
          <img
            src={mediaUrl}
            alt={fileName || 'Response image'}
            className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
            style={{ imageRendering: 'auto' }}
          />
        </div>
        {toolbar}
      </div>
    );
  }

  // ── PDF 预览 ──
  if (previewKind === 'pdf' && mediaUrl) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0">
          <iframe
            src={mediaUrl}
            title="PDF Preview"
            className="w-full h-full border-0 rounded-lg"
          />
        </div>
        {toolbar}
      </div>
    );
  }

  // ── 音频预览 ──
  if (previewKind === 'audio' && mediaUrl) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-500/10">
              <Music className="w-8 h-8 text-violet-500" />
            </div>
            <span className="font-semibold text-text-primary" style={{ fontSize: 'var(--fs-base)' }}>
              {fileName || fileTypeLabel}
            </span>
            <audio controls src={mediaUrl} className="w-[360px] max-w-full" />
          </div>
        </div>
        {toolbar}
      </div>
    );
  }

  // ── 视频预览 ──
  if (previewKind === 'video' && mediaUrl) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4">
          <video
            controls
            src={mediaUrl}
            className="max-w-full max-h-full rounded-lg shadow-sm"
          />
        </div>
        {toolbar}
      </div>
    );
  }

  // ── 通用二进制文件（不可预览） ──
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 pf-rounded-xl border border-border-default/60 bg-bg-secondary/40 px-12 py-10 shadow-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            <FileBox className="h-8 w-8 text-accent" />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-text-primary font-semibold" style={{ fontSize: 'var(--fs-base)' }}>
              {fileName || fileTypeLabel}
            </span>
            <span className="text-text-tertiary" style={{ fontSize: 'var(--fs-sm)' }}>
              {contentType || 'unknown'}
            </span>
            <div className="flex items-center gap-1.5 text-text-disabled" style={{ fontSize: 'var(--fs-xs)' }}>
              <HardDrive className="h-3 w-3" />
              <span>{sizeLabel}</span>
            </div>
          </div>
          <button
            onClick={handleSave}
            className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-accent-hover"
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            <Download className="h-4 w-4" />
            {t('response.saveToFile', { defaultValue: '另存为文件' })}
          </button>
          <p className="max-w-[280px] text-center text-text-disabled leading-relaxed" style={{ fontSize: 'var(--fs-xxs)' }}>
            {t('response.binaryHint', { defaultValue: '该响应为二进制文件，无法作为文本预览。可切换到 Hex 查看字节数据。' })}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 根据 Content-Type 猜文件扩展名 */
function guessExtension(ct: string): string {
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('svg')) return 'svg';
  if (ct.includes('zip')) return 'zip';
  if (ct.includes('gzip')) return 'gz';
  if (ct.includes('tar')) return 'tar';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('mp3') || ct.includes('mpeg')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('spreadsheetml')) return 'xlsx';
  if (ct.includes('ms-excel')) return 'xls';
  if (ct.includes('wordprocessingml') || ct.includes('msword')) return 'docx';
  if (ct.includes('presentationml') || ct.includes('ms-powerpoint')) return 'pptx';
  if (ct.includes('wasm')) return 'wasm';
  return 'bin';
}

/** 通过 Base64 魔数嗅探真实的 MIME 类型（应对泛用 octet-stream 或缺失 Content-Type 的情况） */
function detectMimeFromBase64(b64: string, fallback: string): string {
  // 提取前缀
  const prefix = b64.substring(0, 16);
  if (prefix.startsWith('/9j/')) return 'image/jpeg';
  if (prefix.startsWith('iVBORw0KGgo')) return 'image/png';
  if (prefix.startsWith('R0lGOD')) return 'image/gif';
  if (prefix.startsWith('UklGR')) return 'image/webp'; // WebP base64 starts with UklGR
  if (prefix.startsWith('JVBERi0')) return 'application/pdf';
  return fallback;
}

/* ── Highlighted text with search matches ── */
function HighlightedText({ text, search, isRegex = false }: { text: string; search: string; isRegex?: boolean }) {
  if (!search) return <>{text}</>;

  try {
    const regex = isRegex
      ? new RegExp(`(${search})`, 'gi')
      : new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-amber-300/50 text-inherit rounded-sm px-px">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

/* ── Inline mini-viewer for WebSocket/TCP messages ── */
export function InlineJsonViewer({ data }: { data: string }) {
  const [expanded, setExpanded] = useState(false);

  const isJson = useMemo(() => {
    try { JSON.parse(data); return true; } catch { return false; }
  }, [data]);

  if (!isJson) return <span>{data}</span>;

  const formatted = useMemo(() => {
    try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; }
  }, [data]);

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="pf-text-xxs px-1.5 py-0.5 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors flex items-center gap-0.5"
        >
          {expanded ? <Minimize2 className="w-2.5 h-2.5" /> : <Maximize2 className="w-2.5 h-2.5" />}
          JSON
        </button>
      </div>
      {expanded ? (
        <ReadonlyCodeBlock value={formatted} language="json" minHeightClassName="min-h-[180px]" />
      ) : (
        <span className="whitespace-pre-wrap break-all">{formatted}</span>
      )}
    </div>
  );
}
