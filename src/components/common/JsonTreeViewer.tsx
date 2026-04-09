import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import { useContextMenu } from "@/components/ui/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useTranslation } from "react-i18next";
import type { ContextMenuEntry } from "@/components/ui/ContextMenu";

interface JsonTreeViewerProps {
  value: string;
  className?: string;
  wrapLines?: boolean;
}

type JsonScalar = string | number | boolean | null;
type JsonLine =
  | {
      id: string;
      indent: number;
      suffix: string;
      propertyName?: string;
      kind: "primitive";
      value: JsonScalar;
    }
  | {
      id: string;
      indent: number;
      suffix: string;
      propertyName?: string;
      kind: "collapsed";
      path?: string;
      openBracket: "{" | "[";
      closeBracket: "}" | "]";
      summary?: string;
    }
  | {
      id: string;
      indent: number;
      suffix: string;
      propertyName?: string;
      kind: "open";
      path: string;
      openBracket: "{" | "[";
    }
  | {
      id: string;
      indent: number;
      suffix: string;
      kind: "close";
      closeBracket: "}" | "]";
    };

function buildJsonLines(source: unknown, collapsedPaths: Set<string>) {
  const lines: JsonLine[] = [];

  const visit = (
    value: unknown,
    path: string,
    indent: number,
    suffix = "",
    propertyName?: string,
  ) => {
    if (Array.isArray(value)) {
      const itemCount = value.length;
      if (itemCount === 0) {
        lines.push({
          id: `${path}:empty`,
          kind: "collapsed",
          indent,
          suffix,
          propertyName,
          openBracket: "[",
          closeBracket: "]",
        });
        return;
      }

      if (collapsedPaths.has(path)) {
        lines.push({
          id: `${path}:collapsed`,
          kind: "collapsed",
          indent,
          suffix,
          propertyName,
          path,
          openBracket: "[",
          closeBracket: "]",
          summary: `${itemCount} item${itemCount === 1 ? "" : "s"}`,
        });
        return;
      }

      lines.push({
        id: `${path}:open`,
        kind: "open",
        indent,
        suffix: "",
        propertyName,
        path,
        openBracket: "[",
      });

      value.forEach((item, index) => {
        visit(item, `${path}[${index}]`, indent + 1, index < itemCount - 1 ? "," : "");
      });

      lines.push({
        id: `${path}:close`,
        kind: "close",
        indent,
        suffix,
        closeBracket: "]",
      });
      return;
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      const keyCount = entries.length;
      if (keyCount === 0) {
        lines.push({
          id: `${path}:empty`,
          kind: "collapsed",
          indent,
          suffix,
          propertyName,
          openBracket: "{",
          closeBracket: "}",
        });
        return;
      }

      if (collapsedPaths.has(path)) {
        lines.push({
          id: `${path}:collapsed`,
          kind: "collapsed",
          indent,
          suffix,
          propertyName,
          path,
          openBracket: "{",
          closeBracket: "}",
          summary: `${keyCount} key${keyCount === 1 ? "" : "s"}`,
        });
        return;
      }

      lines.push({
        id: `${path}:open`,
        kind: "open",
        indent,
        suffix: "",
        propertyName,
        path,
        openBracket: "{",
      });

      entries.forEach(([key, item], index) => {
        visit(item, `${path}.${JSON.stringify(key)}`, indent + 1, index < keyCount - 1 ? "," : "", key);
      });

      lines.push({
        id: `${path}:close`,
        kind: "close",
        indent,
        suffix,
        closeBracket: "}",
      });
      return;
    }

    lines.push({
      id: `${path}:primitive`,
      kind: "primitive",
      indent,
      suffix,
      propertyName,
      value: value as JsonScalar,
    });
  };

  visit(source, "$", 0);
  return lines;
}

/** Convert internal path like $.\"key\"[0].\"nested\" to key[0].nested */
function formatJsonPath(path: string): string {
  return path
    .replace(/^\$\.?/, '')
    .replace(/\."([^"]+)"/g, (_, key) => {
      // If it's the first segment, no dot prefix
      return key;
    })
    .replace(/\."([^"]+)"/g, '.$1')
    // Clean up leading dots
    .replace(/^\./, '');
}

/** Resolve a value from parsed JSON by internal path */
function getValueAtPath(data: unknown, path: string): unknown {
  if (path === '$') return data;
  const stripped = path.replace(/^\$\.?/, '');
  // Parse path segments
  const segments: (string | number)[] = [];
  const regex = /"([^"]+)"|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    if (match[1] !== undefined) segments.push(match[1]);
    else if (match[2] !== undefined) segments.push(Number(match[2]));
  }
  let current: any = data;
  for (const seg of segments) {
    if (current == null) return undefined;
    current = current[seg];
  }
  return current;
}

function renderScalar(value: JsonScalar) {
  if (typeof value === "string") {
    return <span className="json-token-string">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="json-token-number">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="json-token-boolean">{String(value)}</span>;
  }
  return <span className="json-token-null">null</span>;
}

function FoldButton({
  expanded,
  onClick,
}: {
  expanded?: boolean;
  onClick?: () => void;
}) {
  if (!onClick) {
    return <span aria-hidden="true" className="h-4 w-4 shrink-0" />;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary"
      title={expanded ? "Collapse" : "Expand"}
    >
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}

function renderPropertyName(propertyName?: string) {
  if (!propertyName) return null;
  return (
    <>
      <span className="json-token-key">{JSON.stringify(propertyName)}</span>
      <span className="json-token-punctuation">: </span>
    </>
  );
}

export function JsonTreeViewer({
  value,
  className,
  wrapLines = true,
}: JsonTreeViewerProps) {
  const { t } = useTranslation();
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));
  const viewportRef = useRef<HTMLDivElement>(null);
  const codeContentRef = useRef<HTMLDivElement>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const { showMenu, MenuComponent } = useContextMenu();

  const parsedJson = useMemo(() => {
    try {
      return { ok: true as const, data: JSON.parse(value) as unknown };
    } catch {
      return { ok: false as const, data: null };
    }
  }, [value]);
  const lines = useMemo(
    () => (parsedJson.ok ? buildJsonLines(parsedJson.data, collapsedPaths) : []),
    [collapsedPaths, parsedJson],
  );
  const gutterWidth = `${Math.max(3, String(lines.length).length + 1)}ch`;

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [value]);

  const togglePath = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
      return;
    }

    const selection = window.getSelection();
    const content = codeContentRef.current;
    if (!selection || !content) return;

    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(content);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const handleMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    viewportRef.current?.focus({ preventScroll: true });
  }, []);

  const getToggleHandler = useCallback((path?: string) => {
    if (!path) return undefined;
    return () => {
      togglePath(path);
    };
  }, [togglePath]);

  const handleLineContextMenu = useCallback((e: ReactMouseEvent, line: JsonLine) => {
    const items: ContextMenuEntry[] = [];

    // Add "Copy Selection" if user has selected text
    const sel = window.getSelection();
    const selText = sel?.toString().trim() || '';
    if (selText) {
      items.push({ id: '_copy-sel', label: t('contextMenu.copy', '复制'), shortcut: '⌘C', onClick: () => copyTextToClipboard(selText) });
      items.push({ type: 'divider' });
    }

    const linePath = ('path' in line ? line.path : line.id.replace(/:(?:primitive|collapsed|open|close|empty)$/, '')) ?? '';
    const displayPath = formatJsonPath(linePath);

    if (line.kind === 'primitive') {
      const valStr = line.value === null ? 'null' : typeof line.value === 'string' ? line.value : String(line.value);
      items.push({ id: 'copy-value', label: t('contextMenu.copyValue', '复制值'), onClick: () => copyTextToClipboard(valStr) });
      if (line.propertyName) {
        items.push({ id: 'copy-kv', label: t('contextMenu.copyKeyValue', '复制键值对'), onClick: () => copyTextToClipboard(`"${line.propertyName}": ${JSON.stringify(line.value)}`) });
      }
      items.push({ id: 'copy-path', label: t('contextMenu.copyPath', '复制路径'), onClick: () => copyTextToClipboard(displayPath) });
      items.push({ type: 'divider' });
      items.push({ id: 'set-env', label: t('contextMenu.setAsEnvVariable', '设为环境变量'), onClick: () => {
        window.dispatchEvent(new CustomEvent('set-env-variable', { detail: { value: valStr } }));
      }});
    } else if (line.kind === 'collapsed' || line.kind === 'open') {
      // Copy the subtree value
      if (parsedJson.ok) {
        const nodeValue = getValueAtPath(parsedJson.data, linePath);
        if (nodeValue !== undefined) {
          items.push({ id: 'copy-value', label: t('contextMenu.copyValue', '复制值'), onClick: () => copyTextToClipboard(JSON.stringify(nodeValue, null, 2)) });
        }
      }
      if (displayPath) {
        items.push({ id: 'copy-path', label: t('contextMenu.copyPath', '复制路径'), onClick: () => copyTextToClipboard(displayPath) });
      }
      items.push({ type: 'divider' });
      if (line.kind === 'collapsed' && line.path) {
        items.push({ id: 'expand', label: t('contextMenu.expandNode', '展开'), onClick: () => togglePath(line.path!) });
      }
      if (line.kind === 'open') {
        items.push({ id: 'collapse', label: t('contextMenu.collapseNode', '折叠'), onClick: () => togglePath(line.path) });
      }
      items.push({ type: 'divider' });
      items.push({ id: 'expand-all', label: t('contextMenu.expandAll', '展开全部'), onClick: () => setCollapsedPaths(new Set()) });
      items.push({ id: 'collapse-all', label: t('contextMenu.collapseAll', '折叠全部'), onClick: () => {
        // Collect all collapsible paths
        const allPaths = new Set<string>();
        const collectPaths = (data: unknown, path: string) => {
          if (Array.isArray(data) && data.length > 0) {
            allPaths.add(path);
            data.forEach((item, i) => collectPaths(item, `${path}[${i}]`));
          } else if (data && typeof data === 'object') {
            allPaths.add(path);
            Object.entries(data).forEach(([key, val]) => collectPaths(val, `${path}.${JSON.stringify(key)}`));
          }
        };
        if (parsedJson.ok) collectPaths(parsedJson.data, '$');
        setCollapsedPaths(allPaths);
      }});
    }

    if (items.length > 0) {
      showMenu(e, items);
    }
  }, [parsedJson, showMenu, togglePath, t]);

  if (!parsedJson.ok) {
    return (
      <div className={cn("flex h-full min-h-0 overflow-auto bg-bg-input/88", className)}>
        <pre
          className="h-full min-h-0 w-full flex-1 px-3 py-3 font-mono whitespace-pre-wrap break-words text-text-primary"
          style={{
            fontSize: `${editorFontSize}px`,
            lineHeight: 1.6,
          }}
        >
          {value}
        </pre>
      </div>
    );
  }

  // ── Lightweight virtualization for large JSON ──
  // Only render lines visible in the scroll viewport + a generous buffer.
  const ROW_HEIGHT = editorFontSize * 1.6; // matches lineHeight: 1.6
  const OVERSCAN = 30; // extra rows above/below viewport
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const enableVirtualization = lines.length > 500;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (enableVirtualization) setScrollTop(e.currentTarget.scrollTop);
  }, [enableVirtualization]);

  useEffect(() => {
    if (!enableVirtualization || !viewportRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [enableVirtualization]);

  const { visibleLines, startIndex, topPad, bottomPad } = useMemo(() => {
    if (!enableVirtualization) return { visibleLines: lines, startIndex: 0, topPad: 0, bottomPad: 0 };
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(lines.length, start + visibleCount);
    return {
      visibleLines: lines.slice(start, end),
      startIndex: start,
      topPad: start * ROW_HEIGHT,
      bottomPad: Math.max(0, (lines.length - end) * ROW_HEIGHT),
    };
  }, [enableVirtualization, lines, scrollTop, viewportHeight, ROW_HEIGHT]);

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden bg-bg-input/88", className)} data-contextmenu-zone="json-tree" onContextMenu={(e) => e.preventDefault()}>
      {MenuComponent}
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDownCapture={handleMouseDownCapture}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/35"
      >
        <div
          ref={codeContentRef}
          className={cn(
            "min-h-full px-3 py-3 font-mono text-text-primary",
            wrapLines ? "min-w-full" : "min-w-max",
            "[&_.json-token-key]:text-sky-600 dark:[&_.json-token-key]:text-sky-400",
            "[&_.json-token-string]:text-emerald-600 dark:[&_.json-token-string]:text-emerald-400",
            "[&_.json-token-number]:text-amber-600 dark:[&_.json-token-number]:text-amber-400",
            "[&_.json-token-boolean]:text-violet-600 dark:[&_.json-token-boolean]:text-violet-400",
            "[&_.json-token-null]:text-rose-600 dark:[&_.json-token-null]:text-rose-400",
            "[&_.json-token-punctuation]:text-text-tertiary",
          )}
          style={{
            fontSize: `${editorFontSize}px`,
            lineHeight: 1.6,
          }}
        >
          {enableVirtualization && topPad > 0 && <div style={{ height: topPad }} />}
          {visibleLines.map((line, i) => {
            const index = startIndex + i;
            return (
            <div
              key={line.id}
              className="grid items-start gap-3"
              style={{ gridTemplateColumns: `${gutterWidth} minmax(0, 1fr)`, height: enableVirtualization ? ROW_HEIGHT : undefined }}
              onContextMenu={(e) => { if (line.kind !== 'close') handleLineContextMenu(e, line); }}
            >
              <div
                aria-hidden="true"
                className="select-none pr-2 text-right tabular-nums text-text-disabled cursor-default"
              >
                {index + 1}
              </div>
              <div
                className={cn(
                  "min-w-0 flex items-start",
                  wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                )}
                style={{ paddingLeft: `${line.indent * 1.25}rem` }}
              >
                {/* Fold button gutter — fixed width so brackets always align */}
                <span className="shrink-0 w-4 flex items-center justify-center cursor-pointer">
                  {line.kind === "open" && (
                    <FoldButton expanded onClick={() => togglePath(line.path)} />
                  )}
                  {line.kind === "collapsed" && (
                    <FoldButton expanded={false} onClick={getToggleHandler(line.path)} />
                  )}
                </span>
                <span className="min-w-0">
                  {line.kind === "primitive" && (
                    <>
                      {renderPropertyName(line.propertyName)}
                      {renderScalar(line.value)}
                      {line.suffix ? <span className="json-token-punctuation">{line.suffix}</span> : null}
                    </>
                  )}
                  {line.kind === "open" && (
                    <>
                      {renderPropertyName(line.propertyName)}
                      <span className="json-token-punctuation">{line.openBracket}</span>
                    </>
                  )}
                  {line.kind === "collapsed" && (
                    <span className="inline-flex min-w-0 items-start gap-1">
                      {renderPropertyName(line.propertyName)}
                      <span className="json-token-punctuation">{line.openBracket}</span>
                      {line.summary ? (
                        <span className="truncate px-1 text-text-disabled">{line.summary}</span>
                      ) : null}
                      <span className="json-token-punctuation">{line.closeBracket}</span>
                      {line.suffix ? <span className="json-token-punctuation">{line.suffix}</span> : null}
                    </span>
                  )}
                  {line.kind === "close" && (
                    <>
                      <span className="json-token-punctuation">{line.closeBracket}</span>
                      {line.suffix ? <span className="json-token-punctuation">{line.suffix}</span> : null}
                    </>
                  )}
                </span>
              </div>
            </div>
            );
          })}
          {enableVirtualization && bottomPad > 0 && <div style={{ height: bottomPad }} />}
        </div>
      </div>
    </div>
  );
}
