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
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));
  const viewportRef = useRef<HTMLDivElement>(null);
  const codeContentRef = useRef<HTMLDivElement>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

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

  return (
    <div className={cn("flex h-full min-h-0 overflow-hidden bg-bg-input/88", className)}>
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDownCapture={handleMouseDownCapture}
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
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="grid items-start gap-3"
              style={{ gridTemplateColumns: `${gutterWidth} minmax(0, 1fr)` }}
            >
              <div
                aria-hidden="true"
                className="select-none pr-2 text-right tabular-nums text-text-disabled"
              >
                {index + 1}
              </div>
              <div
                className={cn(
                  "min-w-0",
                  wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                )}
                style={{ paddingLeft: `${line.indent * 1.25}rem` }}
              >
                {line.kind === "primitive" && (
                  <>
                    {renderPropertyName(line.propertyName)}
                    {renderScalar(line.value)}
                    {line.suffix ? <span className="json-token-punctuation">{line.suffix}</span> : null}
                  </>
                )}
                {line.kind === "open" && (
                  <span className="inline-flex min-w-0 items-start gap-1">
                    {renderPropertyName(line.propertyName)}
                    <FoldButton expanded onClick={() => togglePath(line.path)} />
                    <span className="json-token-punctuation">{line.openBracket}</span>
                  </span>
                )}
                {line.kind === "collapsed" && (
                  <span className="inline-flex min-w-0 items-start gap-1">
                    {renderPropertyName(line.propertyName)}
                    <FoldButton expanded={false} onClick={getToggleHandler(line.path)} />
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
