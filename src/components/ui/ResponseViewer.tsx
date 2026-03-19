/**
 * ResponseViewer — 通用响应体展示组件
 * 支持多种视图模式：JSON（语法高亮 + 折叠）、Raw、预览（HTML）
 * 可复用于 HTTP 响应、WebSocket 消息、TCP 数据等
 */

import { useState, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronDown, Copy, Check, WrapText, Search, Minimize2, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewMode = 'json' | 'raw' | 'preview' | 'hex';

interface ResponseViewerProps {
  body: string;
  contentType?: string | null;
  /** Restrict to specific modes — by default auto-detects available modes */
  modes?: ViewMode[];
  /** If true, hide the mode bar (used inline) */
  compact?: boolean;
  className?: string;
}

/* ── JSON Syntax Highlighter — recursive with collapsing ── */

interface JsonNodeProps {
  data: unknown;
  nodeKey?: string;
  depth: number;
  isLast: boolean;
  defaultExpanded?: boolean;
}

function JsonNode({ data, nodeKey, depth, isLast, defaultExpanded = true }: JsonNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded && depth < 3);

  const indent = depth * 16;

  if (data === null) {
    return (
      <div style={{ paddingLeft: indent }} className="leading-[22px]">
        {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
        <span className="text-[#6b7280] italic">null</span>
        {!isLast && <span className="text-text-disabled">,</span>}
      </div>
    );
  }

  if (typeof data === 'boolean') {
    return (
      <div style={{ paddingLeft: indent }} className="leading-[22px]">
        {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
        <span className="text-[#d97706]">{String(data)}</span>
        {!isLast && <span className="text-text-disabled">,</span>}
      </div>
    );
  }

  if (typeof data === 'number') {
    return (
      <div style={{ paddingLeft: indent }} className="leading-[22px]">
        {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
        <span className="text-[#0284c7]">{String(data)}</span>
        {!isLast && <span className="text-text-disabled">,</span>}
      </div>
    );
  }

  if (typeof data === 'string') {
    // Long strings: truncate on display
    const display = data.length > 500 ? data.slice(0, 500) + '...' : data;
    return (
      <div style={{ paddingLeft: indent }} className="leading-[22px]">
        {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
        <span className="text-[#16a34a]">&quot;{display}&quot;</span>
        {!isLast && <span className="text-text-disabled">,</span>}
      </div>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div style={{ paddingLeft: indent }} className="leading-[22px]">
          {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
          <span className="text-text-primary">[]</span>
          {!isLast && <span className="text-text-disabled">,</span>}
        </div>
      );
    }

    return (
      <div>
        <div
          style={{ paddingLeft: indent }}
          className="leading-[22px] cursor-pointer select-none hover:bg-bg-hover/50 rounded-sm transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="inline-flex items-center justify-center w-4 h-4 -ml-1 mr-0.5 text-text-disabled">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
          <span className="text-text-primary">[</span>
          {!expanded && (
            <span className="text-text-disabled text-[11px] ml-1">
              {data.length} items
            </span>
          )}
          {!expanded && <><span className="text-text-primary">]</span>{!isLast && <span className="text-text-disabled">,</span>}</>}
        </div>
        {expanded && (
          <>
            {data.map((item, i) => (
              <JsonNode key={i} data={item} depth={depth + 1} isLast={i === data.length - 1} defaultExpanded={depth < 2} />
            ))}
            <div style={{ paddingLeft: indent }} className="leading-[22px]">
              <span className="text-text-primary">]</span>
              {!isLast && <span className="text-text-disabled">,</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div style={{ paddingLeft: indent }} className="leading-[22px]">
          {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
          <span className="text-text-primary">{'{}'}</span>
          {!isLast && <span className="text-text-disabled">,</span>}
        </div>
      );
    }

    return (
      <div>
        <div
          style={{ paddingLeft: indent }}
          className="leading-[22px] cursor-pointer select-none hover:bg-bg-hover/50 rounded-sm transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="inline-flex items-center justify-center w-4 h-4 -ml-1 mr-0.5 text-text-disabled">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
          <span className="text-text-primary">{'{'}</span>
          {!expanded && (
            <span className="text-text-disabled text-[11px] ml-1">
              {entries.length} keys
            </span>
          )}
          {!expanded && <><span className="text-text-primary">{'}'}</span>{!isLast && <span className="text-text-disabled">,</span>}</>}
        </div>
        {expanded && (
          <>
            {entries.map(([k, v], i) => (
              <JsonNode key={k} data={v} nodeKey={k} depth={depth + 1} isLast={i === entries.length - 1} defaultExpanded={depth < 2} />
            ))}
            <div style={{ paddingLeft: indent }} className="leading-[22px]">
              <span className="text-text-primary">{'}'}</span>
              {!isLast && <span className="text-text-disabled">,</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: indent }} className="leading-[22px]">
      {nodeKey !== undefined && <><span className="text-[#7c3aed]">&quot;{nodeKey}&quot;</span><span className="text-text-disabled">: </span></>}
      <span className="text-text-primary">{String(data)}</span>
      {!isLast && <span className="text-text-disabled">,</span>}
    </div>
  );
}

/* ── Hex view ── */
function HexView({ data }: { data: string }) {
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
    <div className="font-mono text-[11px] leading-[18px]">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-4 hover:bg-bg-hover/30 px-1 rounded-sm">
          <span className="text-text-disabled w-[70px] shrink-0">{line.offset}</span>
          <span className="text-[#0284c7] flex-1">{line.hex}</span>
          <span className="text-text-tertiary w-[140px] shrink-0">{line.ascii}</span>
        </div>
      ))}
      {data.length > 4096 && (
        <div className="text-text-disabled text-[10px] mt-2 italic">
          仅显示前 4096 字节 (总 {data.length} 字节)
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */
export function ResponseViewer({ body, contentType, modes, compact, className }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);

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
    if (isHtml) m.push('preview');
    m.push('hex');
    return m;
  }, [modes, isJson, isHtml]);

  const [activeMode, setActiveMode] = useState<ViewMode>(() => availableModes[0] || 'raw');

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
  const formattedBody = useMemo(() => {
    if (isJson) {
      try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
    }
    if (isXml) {
      // Simple XML formatting
      return body.replace(/></g, '>\n<').replace(/(<[^\/!][^>]*>)/g, '\n$1');
    }
    return body;
  }, [body, isJson, isXml]);

  const searchCount = useMemo(() => {
    if (!searchText) return 0;
    const target = activeMode === 'raw' ? formattedBody : body;
    const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (target.match(regex) || []).length;
  }, [searchText, formattedBody, body, activeMode]);

  const modeLabels: Record<ViewMode, string> = {
    json: 'JSON',
    raw: 'Raw',
    preview: '预览',
    hex: 'Hex',
  };

  if (!body) return null;

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Mode Bar */}
      {!compact && (
        <div className="flex items-center shrink-0 border-b border-border-default bg-bg-secondary/30">
          <div className="flex h-9">
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => setActiveMode(mode)}
                className={cn(
                  'px-4 text-[12px] font-medium border-b-[2px] transition-colors whitespace-nowrap',
                  activeMode === mode
                    ? 'text-accent border-accent'
                    : 'text-text-tertiary border-transparent hover:text-text-secondary'
                )}
              >
                {modeLabels[mode]}
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
              title="搜索 (Ctrl+F)"
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
              title="自动换行"
            >
              <WrapText className="w-3 h-3" />
            </button>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className="h-6 w-6 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover transition-colors"
              title="复制"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-secondary/20 shrink-0">
          <Search className="w-3 h-3 text-text-disabled shrink-0" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索内容..."
            className="flex-1 h-6 text-[12px] bg-transparent outline-none text-text-primary placeholder:text-text-tertiary"
            autoFocus
          />
          {searchText && (
            <span className="text-[10px] text-text-disabled tabular-nums shrink-0">
              {searchCount} 个匹配
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-3" style={{ userSelect: 'text' }}>
        {activeMode === 'json' && jsonData !== null && (
          <div className="font-mono text-[12px]">
            <JsonNode data={jsonData} depth={0} isLast={true} defaultExpanded={true} />
          </div>
        )}

        {activeMode === 'raw' && (
          <pre
            className={cn(
              'text-[12px] font-mono text-text-primary leading-[20px]',
              wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
            )}
          >
            {searchText ? (
              <HighlightedText text={formattedBody} search={searchText} />
            ) : (
              formattedBody
            )}
          </pre>
        )}

        {activeMode === 'preview' && isHtml && (
          <iframe
            srcDoc={body}
            sandbox="allow-same-origin"
            className="w-full h-full border border-border-default rounded-lg bg-white"
            title="HTML Preview"
          />
        )}

        {activeMode === 'hex' && (
          <HexView data={body} />
        )}
      </div>
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

  const parsed = useMemo(() => {
    try { return JSON.parse(data); } catch { return null; }
  }, [data]);

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors flex items-center gap-0.5"
        >
          {expanded ? <Minimize2 className="w-2.5 h-2.5" /> : <Maximize2 className="w-2.5 h-2.5" />}
          JSON
        </button>
      </div>
      {expanded ? (
        <div className="font-mono text-[11px]">
          <JsonNode data={parsed} depth={0} isLast={true} defaultExpanded={true} />
        </div>
      ) : (
        <span className="whitespace-pre-wrap break-all">{formatted}</span>
      )}
    </div>
  );
}
