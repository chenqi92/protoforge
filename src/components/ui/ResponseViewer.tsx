/**
 * ResponseViewer — 通用响应体展示组件
 * 支持多种视图模式：JSON（语法高亮 + 折叠）、Raw、预览（HTML）
 * 可复用于 HTTP 响应、WebSocket 消息、TCP 数据等
 * 支持插件渲染器（如 Excel）— 通过 contributes.responseRenderers 动态注入 Tab
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Copy, Check, WrapText, Search, Minimize2, Maximize2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/common/CodeEditor';
import { usePluginStore } from '@/stores/pluginStore';
import { invoke } from '@tauri-apps/api/core';
import type { RendererContribution } from '@/types/plugin';
import { PluginRendererView } from '@/components/ui/PluginRendererView';

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
        <div className="mb-2 grid grid-cols-[72px_minmax(0,1fr)_150px] gap-4 rounded-[10px] border border-border-default/70 bg-bg-secondary/30 px-2 py-2 font-semibold uppercase tracking-[0.08em] text-text-tertiary" style={{ fontSize: 'var(--fs-xxs)' }}>
          <span>Offset</span>
          <span>Hex</span>
          <span>ASCII</span>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[72px_minmax(0,1fr)_150px] gap-4 rounded-[8px] px-2 py-1 hover:bg-bg-hover/30">
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
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-[12px] border border-border-default/70 bg-bg-primary h-full", minHeightClassName)}>
      <div className="flex-1 min-h-0">
        <CodeEditor value={value} language={language} readOnly height="100%" />
      </div>
    </div>
  );
}

/* ── Main Component ── */
export function ResponseViewer({ body, contentType, responseHeaders, isBinary, modes, compact, className }: ResponseViewerProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);

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

  // Detect content type
  const isJson = useMemo(() => {
    if (contentType?.includes('json')) return true;
    try { JSON.parse(body); return true; } catch { return false; }
  }, [body, contentType]);

  const isHtml = useMemo(() => {
    return contentType?.includes('html') || body.trimStart().startsWith('<!') || body.trimStart().startsWith('<html');
  }, [body, contentType]);

  const isXml = useMemo(() => {
    return contentType?.includes('xml') || body.trimStart().startsWith('<?xml');
  }, [body, contentType]);

  // Available modes
  const availableModes = useMemo(() => {
    if (modes) return modes;
    const m: ViewMode[] = [];
    if (isJson) m.push('json');
    m.push('raw');
    m.push('base64');
    if (isHtml) m.push('preview');
    m.push('hex');
    return m;
  }, [modes, isJson, isHtml]);

  // 联合 tab：内置 + 插件
  type ActiveTab = ViewMode | `plugin:${string}`;
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => availableModes[0] || 'raw');

  useEffect(() => {
    setActiveTab(availableModes[0] || 'raw');
  }, [availableModes, body, contentType, compact, modes]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [body]);

  // Parsed JSON data
  const jsonData = useMemo(() => {
    if (!isJson) return null;
    try { return JSON.parse(body); } catch { return null; }
  }, [body, isJson]);

  // Formatted raw text (for XML/JSON pretty-print)
  const prettyBody = useMemo(() => {
    if (isJson) {
      try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
    }
    if (isXml) {
      // Simple XML formatting
      return body.replace(/></g, '>\n<').replace(/(<[^\/!][^>]*>)/g, '\n$1');
    }
    return body;
  }, [body, isJson, isXml]);

  // For binary responses, decode base64 to text for Raw view
  const rawDisplayBody = useMemo(() => {
    if (!isBinary) return body;
    try {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return body;
    }
  }, [body, isBinary]);

  const searchCount = useMemo(() => {
    if (!searchText) return 0;
    const target =
      activeTab === 'json' ? prettyBody :
      activeTab === 'raw' ? body :
      body;
    const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (target.match(regex) || []).length;
  }, [searchText, prettyBody, body, activeTab]);

  const modeLabels: Record<ViewMode, string> = {
    json: 'JSON',
    raw: 'Raw',
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
                <span>{pt.renderer.icon}</span>
                <span>{pt.renderer.name}</span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 px-2">
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

            {/* Save binary response to file */}
            {isBinary && (
              <button
                onClick={async () => {
                  const disposition = getHeaderValue(responseHeaders, 'content-disposition');
                  const filenameMatch = disposition.match(/filename[*]?=["']?([^"';\s]+)/i);
                  const suggested = filenameMatch?.[1] || 'response.bin';
                  try {
                    await invoke('save_response_body', {
                      bodyBase64: body,
                      suggestedName: suggested,
                    });
                  } catch (e) {
                    // 用户取消保存或其他错误
                    console.warn('保存失败:', e);
                  }
                }}
                className="h-6 px-2 flex items-center gap-1 rounded-md text-text-tertiary hover:bg-bg-hover transition-colors" style={{ fontSize: 'var(--fs-xs)' }}
                title="另存为"
              >
                <Download className="w-3 h-3" />
                <span>另存为</span>
              </button>
            )}

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
          </div>
        </div>
      )}

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border-default bg-bg-secondary/24 px-3 py-1.5 shrink-0">
          <Search className="w-3 h-3 text-text-disabled shrink-0" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t('response.searchPlaceholder')}
            className="flex-1 h-6 bg-transparent outline-none text-text-primary placeholder:text-text-tertiary" style={{ fontSize: 'var(--fs-sm)' }}
            autoFocus
          />
          {searchText && (
            <span className="text-text-disabled tabular-nums shrink-0" style={{ fontSize: 'var(--fs-xxs)' }}>
              {t('response.matchCount', { count: searchCount })}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto bg-[linear-gradient(180deg,rgba(148,163,184,0.05),transparent_22%)] px-3 py-2" style={{ userSelect: 'text' }}>
        <div className="h-full py-0">
          {activeBuiltinMode === 'json' && (
            <div className="flex flex-col h-full gap-2">
              {jsonData === null ? (
                <div className="rounded-[10px] border border-amber-300/60 bg-amber-500/8 px-3 py-2 text-amber-700 dark:text-amber-300 shrink-0" style={{ fontSize: 'var(--fs-xs)' }}>
                  {t('response.invalidJsonPrettyFallback')}
                </div>
              ) : null}
              <div className="flex-1 min-h-0">
                <ReadonlyCodeBlock
                  value={prettyBody}
                  language={jsonData !== null ? 'json' : isXml ? 'xml' : 'plaintext'}
                />
              </div>
            </div>
          )}

          {activeBuiltinMode === 'raw' && (
            <div className={cn("max-w-full", !wordWrap && "overflow-x-auto")}>
              <pre
                className={cn(
                  'font-mono text-text-primary leading-[20px]',
                  wordWrap ? 'whitespace-pre-wrap break-all' : 'min-w-max whitespace-pre'
                )}
                style={{ fontSize: 'var(--fs-sm)' }}
              >
                {searchText ? (
                  <HighlightedText text={rawDisplayBody} search={searchText} />
                ) : (
                  rawDisplayBody
                )}
              </pre>
            </div>
          )}

          {activeBuiltinMode === 'base64' && (
            <Base64View body={body} isBinary={isBinary} wordWrap={wordWrap} searchText={searchText} />
          )}

          {activeBuiltinMode === 'preview' && isHtml && (
            <iframe
              srcDoc={body}
              sandbox="allow-same-origin"
              className="min-h-[420px] w-full rounded-[12px] border border-border-default bg-white"
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
  const [copied, setCopied] = useState(false);

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

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(base64Content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [base64Content]);

  const sizeLabel = base64Content.length < 1024
    ? `${base64Content.length} chars`
    : `${(base64Content.length / 1024).toFixed(1)} KB`;

  return (
    <div className={cn("max-w-full", !wordWrap && "overflow-x-auto")}>
      <div className="flex items-center gap-2 mb-2 rounded-[10px] border border-border-default/60 bg-bg-secondary/30 px-3 py-1.5" style={{ fontSize: 'var(--fs-xs)' }}>
        <span className="font-medium text-text-secondary">Base64</span>
        <span className="text-text-disabled">·</span>
        <span className="text-text-tertiary tabular-nums">{sizeLabel}</span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          style={{ fontSize: 'var(--fs-xxs)' }}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
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

/* ── Highlighted text with search matches ── */
function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;

  const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
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
          className="text-[var(--fs-xxs)] px-1.5 py-0.5 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors flex items-center gap-0.5"
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
