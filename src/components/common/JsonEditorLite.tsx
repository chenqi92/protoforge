import { useCallback, useMemo, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";

interface JsonEditorLiteProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  textareaClassName?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;
const JSON_HIGHLIGHT_LIMIT = 200_000;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHighlightedJsonHtml(source: string) {
  if (!source) return "";
  if (source.length > JSON_HIGHLIGHT_LIMIT) {
    return escapeHtml(source);
  }

  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  JSON_TOKEN_RE.lastIndex = 0;

  while ((match = JSON_TOKEN_RE.exec(source)) !== null) {
    const token = match[0];
    const index = match.index;
    if (index > lastIndex) {
      html += escapeHtml(source.slice(lastIndex, index));
    }

    if (match[1]) {
      html += match[2]
        ? `<span class="json-token-key">${escapeHtml(match[1])}</span>${escapeHtml(match[2])}`
        : `<span class="json-token-string">${escapeHtml(token)}</span>`;
    } else if (token === "true" || token === "false") {
      html += `<span class="json-token-boolean">${token}</span>`;
    } else if (token === "null") {
      html += `<span class="json-token-null">${token}</span>`;
    } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
      html += `<span class="json-token-number">${token}</span>`;
    } else {
      html += `<span class="json-token-punctuation">${escapeHtml(token)}</span>`;
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    html += escapeHtml(source.slice(lastIndex));
  }

  return html;
}

export function JsonEditorLite({
  value,
  onChange,
  readOnly = false,
  className,
  textareaClassName,
  placeholder,
  autoFocus = false,
}: JsonEditorLiteProps) {
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightedHtml = useMemo(() => buildHighlightedJsonHtml(value), [value]);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join("\n"),
    [lineCount],
  );
  const gutterWidth = `calc(${Math.max(3, String(lineCount).length + 1)}ch + 0.75rem)`;

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || !onChange) return;
    if (event.key !== "Tab") return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd } = textarea;
    const nextValue = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(nextValue);

    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const nextCaret = selectionStart + 2;
      target.selectionStart = nextCaret;
      target.selectionEnd = nextCaret;
    });
  }, [onChange, readOnly, value]);

  const syncOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.scrollTop = target.scrollTop;
      overlay.scrollLeft = target.scrollLeft;
    }

    const gutter = gutterRef.current;
    if (gutter) {
      gutter.scrollTop = target.scrollTop;
    }
  }, []);

  if (readOnly) {
    return (
      <div className={cn("flex h-full min-h-0 overflow-auto bg-bg-input/88", className)}>
        <div
          aria-hidden="true"
          className="shrink-0 overflow-hidden border-r border-border-default/50 bg-bg-secondary/45 px-2 py-3 font-mono tabular-nums text-text-disabled select-none"
          style={{
            width: gutterWidth,
            fontSize: `${editorFontSize}px`,
            lineHeight: 1.6,
          }}
        >
          <pre>{lineNumbers}</pre>
        </div>
        <pre
          className={cn(
            "h-full min-h-0 w-full flex-1 px-3 py-3 font-mono whitespace-pre-wrap break-words text-text-primary",
            textareaClassName,
          )}
          style={{
            fontSize: `${editorFontSize}px`,
            lineHeight: 1.6,
          }}
        >
          <code
            className={cn(
              "[&_.json-token-key]:text-sky-600 dark:[&_.json-token-key]:text-sky-400",
              "[&_.json-token-string]:text-emerald-600 dark:text-emerald-300 dark:[&_.json-token-string]:text-emerald-400",
              "[&_.json-token-number]:text-amber-600 dark:text-amber-300 dark:[&_.json-token-number]:text-amber-400",
              "[&_.json-token-boolean]:text-violet-600 dark:text-violet-300 dark:[&_.json-token-boolean]:text-violet-400",
              "[&_.json-token-null]:text-rose-600 dark:text-rose-300 dark:[&_.json-token-null]:text-rose-400",
              "[&_.json-token-punctuation]:text-text-tertiary"
            )}
            dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
          />
        </pre>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full min-h-0 overflow-hidden bg-bg-input/88", className)}>
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="absolute inset-y-0 left-0 z-20 overflow-hidden border-r border-border-default/50 bg-bg-secondary/45 px-2 py-3 font-mono tabular-nums text-right text-text-disabled select-none"
        style={{
          width: gutterWidth,
          fontSize: `${editorFontSize}px`,
          lineHeight: 1.6,
        }}
      >
        <pre>{lineNumbers}</pre>
      </div>
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <pre
          className="min-h-full w-full py-3 pr-3 font-mono whitespace-pre-wrap break-words text-text-primary"
          style={{
            fontSize: `${editorFontSize}px`,
            lineHeight: 1.6,
            paddingLeft: `calc(${gutterWidth} + 0.75rem)`,
          }}
        >
          <code
            className={cn(
              "[&_.json-token-key]:text-sky-600 dark:[&_.json-token-key]:text-sky-400",
              "[&_.json-token-string]:text-emerald-600 dark:text-emerald-300 dark:[&_.json-token-string]:text-emerald-400",
              "[&_.json-token-number]:text-amber-600 dark:text-amber-300 dark:[&_.json-token-number]:text-amber-400",
              "[&_.json-token-boolean]:text-violet-600 dark:text-violet-300 dark:[&_.json-token-boolean]:text-violet-400",
              "[&_.json-token-null]:text-rose-600 dark:text-rose-300 dark:[&_.json-token-null]:text-rose-400",
              "[&_.json-token-punctuation]:text-text-tertiary"
            )}
            dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
          />
        </pre>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => syncOverlayScroll(event.currentTarget)}
        readOnly={readOnly}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          "relative z-10 h-full min-h-0 w-full flex-1 resize-none border-0 bg-transparent py-3 pr-3 font-mono outline-none placeholder:text-text-disabled",
          readOnly ? "cursor-text" : "",
          textareaClassName,
        )}
        style={{
          fontSize: `${editorFontSize}px`,
          lineHeight: 1.6,
          tabSize: 2,
          color: "transparent",
          caretColor: "var(--color-text-primary)",
          paddingLeft: `calc(${gutterWidth} + 0.75rem)`,
        }}
      />
    </div>
  );
}
