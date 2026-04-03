import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, Save, Loader2, Eye, EyeOff } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { cn } from "@/lib/utils";
import { useCollectionStore } from "@/stores/collectionStore";
import { useEnvStore } from "@/stores/envStore";
import { extractVariableKeys, getVariablePreview, upsertCollectionVariable } from "@/lib/requestVariables";

interface VariableSegment {
  kind: "text" | "token";
  text: string;
  key?: string;
}

function splitVariableSegments(value: string): VariableSegment[] {
  if (!value) return [];

  const segments: VariableSegment[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(/(\{\{\s*([\w.$-]+)\s*\}\})/g)) {
    const full = match[1];
    const key = match[2]?.trim();
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ kind: "text", text: value.slice(lastIndex, index) });
    }

    if (full && key) {
      segments.push({ kind: "token", text: full, key });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < value.length) {
    segments.push({ kind: "text", text: value.slice(lastIndex) });
  }

  return segments;
}

/** Escape HTML special characters for safe innerHTML insertion */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function VariableInlineInput({
  inputRef,
  value,
  collectionId,
  itemId,
  className,
  overlayClassName: _overlayClassName,
  compactPopover,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder,
  disabled,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  collectionId?: string | null;
  itemId?: string | null;
  overlayClassName?: string;
  compactPopover?: boolean;
}) {
  const { t } = useTranslation();
  const collections = useCollectionStore((state) => state.collections);
  const activeEnvId = useEnvStore((state) => state.activeEnvId);
  const envVars = useEnvStore((state) => state.variables);
  const globalVars = useEnvStore((state) => state.globalVariables);
  const strValue = String(value ?? '');
  const variableKeys = useMemo(() => extractVariableKeys(strValue), [strValue]);
  const segments = useMemo(() => splitVariableSegments(strValue), [strValue]);
  const previews = useMemo(
    () => new Map(variableKeys.map((key) => [key, getVariablePreview(key, collectionId, itemId)])),
    [collectionId, itemId, collections, envVars, globalVars, activeEnvId, variableKeys]
  );
  const divRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // ── Helpers for popover ──
  const cancelClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => cancelClose(), []);

  // ── Expose ref to callers (they expect HTMLInputElement but we provide HTMLElement) ──
  useEffect(() => {
    if (inputRef) {
      (inputRef as React.MutableRefObject<any>).current = divRef.current;
    }
  });

  // ── Cursor save / restore helpers ──
  const getCaretOffset = (): number => {
    const el = divRef.current;
    if (!el) return 0;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  };

  const setCaretOffset = (offset: number) => {
    const el = divRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;

    let remaining = offset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    }
    // If offset is beyond all text, place cursor at the end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // ── Build highlighted innerHTML from segments ──
  const buildInnerHTML = useCallback((segs: VariableSegment[], pvs: Map<string, ReturnType<typeof getVariablePreview>>) => {
    return segs.map((seg) => {
      if (seg.kind === 'token' && seg.key) {
        const p = pvs.get(seg.key);
        const source = p?.source ?? 'missing';
        // Use data-var-key so we can attach popover listeners via event delegation
        return `<span class="variable-inline-token" data-source="${source}" data-var-key="${seg.key}">${escapeHtml(seg.text)}</span>`;
      }
      return escapeHtml(seg.text);
    }).join('');
  }, []);

  // ── Sync DOM when value changes (not during IME composition) ──
  const expectedHTML = useMemo(() => buildInnerHTML(segments, previews), [segments, previews, buildInnerHTML]);

  useEffect(() => {
    const el = divRef.current;
    if (!el || composingRef.current) return;

    // Skip if DOM already matches expected HTML
    if (el.innerHTML === expectedHTML) return;

    const hasFocus = document.activeElement === el;
    const savedOffset = hasFocus ? getCaretOffset() : -1;

    el.innerHTML = expectedHTML;

    if (hasFocus && savedOffset >= 0) {
      setCaretOffset(savedOffset);
    }
  }, [expectedHTML]);

  // ── Fire synthetic onChange ──
  const fireChange = useCallback((newText: string) => {
    if (!onChange) return;
    const fakeEvent = {
      target: { value: newText },
      currentTarget: { value: newText },
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    onChange(fakeEvent);
  }, [onChange]);

  // ── Event handlers ──
  const handleInput = useCallback(() => {
    const el = divRef.current;
    if (!el) return;
    const newText = el.textContent ?? '';
    fireChange(newText);
  }, [fireChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
    if (onKeyDown) {
      onKeyDown(e as unknown as React.KeyboardEvent<HTMLInputElement>);
    }
  }, [onKeyDown]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-var-key]');
    if (target) {
      cancelClose();
      setActiveKey(target.getAttribute('data-var-key'));
      setRect(target.getBoundingClientRect());
      setOpen(true);
    }
  }, []);

  const handleMouseOut = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-var-key]');
    if (target) {
      scheduleClose();
    }
  }, []);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (onFocus) onFocus(e as unknown as React.FocusEvent<HTMLInputElement>);
  }, [onFocus]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (onBlur) onBlur(e as unknown as React.FocusEvent<HTMLInputElement>);
  }, [onBlur]);

  // Copy over passthrough attributes
  const passthroughAttrs: Record<string, any> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k.startsWith('data-') || k.startsWith('aria-')) {
      passthroughAttrs[k] = v;
    }
  }

  return (
    <>
      <div
        ref={divRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-placeholder={placeholder || t('http.urlPlaceholder')}
        className={cn('variable-inline-editable', className)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
        onFocus={handleFocus}
        onBlur={handleBlur}
        data-placeholder={placeholder || t('http.urlPlaceholder')}
        {...passthroughAttrs}
      />

      {open && rect && activeKey && previews.get(activeKey) && createPortal(
        <VariableHoverPopover
          rect={rect}
          preview={previews.get(activeKey)!}
          collectionId={collectionId}
          compact={compactPopover}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />,
        document.body
      )}
    </>
  );
}

function VariableHoverPopover({
  rect,
  preview,
  collectionId,
  compact,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: DOMRect;
  preview: ReturnType<typeof getVariablePreview>;
  collectionId?: string | null;
  compact?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(preview.source === "missing" ? "" : preview.rawValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setDraft(preview.source === "missing" ? "" : preview.rawValue);
    setSaved(false);
  }, [preview.key, preview.rawValue, preview.source]);

  const sourceLabelMap: Record<string, string> = {
    collection: t('http.variableSourceCollection'),
    folder: t('http.variableSourceFolder'),
    environment: t('http.variableSourceEnvironment'),
    global: t('http.variableSourceGlobal'),
    dynamic: t('http.variableSourceDynamic'),
    missing: t('http.variableSourceMissing'),
  };

  const isSecretHidden = preview.isSecret && !revealed;
  const displayValue = preview.source === "missing"
    ? t('http.variableMissing')
    : isSecretHidden
      ? "••••••••"
      : preview.value;
  const canSaveToCollection = Boolean(collectionId) && preview.source !== "dynamic";

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const textToCopy = canSaveToCollection ? draft : displayValue;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  // ── Resizable popover size with localStorage persistence ──
  const STORAGE_KEY = "protoforge:var-popover-size";
  const DEFAULT_W = compact ? 340 : 420;
  const DEFAULT_H = 0; // 0 = auto height
  const MIN_W = 280;
  const MIN_H = 140;
  const MAX_W = 640;
  const MAX_H = 480;

  const readStoredSize = (): { w: number; h: number } => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.w === "number" && typeof parsed.h === "number") {
          return { w: Math.max(MIN_W, Math.min(MAX_W, parsed.w)), h: Math.max(MIN_H, Math.min(MAX_H, parsed.h)) };
        }
      }
    } catch { /* ignore */ }
    return { w: DEFAULT_W, h: DEFAULT_H };
  };

  const stored = readStoredSize();
  const [popoverW, setPopoverW] = useState(stored.w);
  const [popoverH, setPopoverH] = useState(stored.h);
  const popoverRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = popoverRef.current?.offsetWidth ?? popoverW;
    const startH = popoverRef.current?.offsetHeight ?? (popoverH || 200);

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newW = Math.max(MIN_W, Math.min(MAX_W, startW + (ev.clientX - startX)));
      const newH = Math.max(MIN_H, Math.min(MAX_H, startH + (ev.clientY - startY)));
      setPopoverW(newW);
      setPopoverH(newH);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const el = popoverRef.current;
      if (el) {
        const finalW = el.offsetWidth;
        const finalH = el.offsetHeight;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ w: finalW, h: finalH }));
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [popoverW, popoverH]);

  const popoverStyle: React.CSSProperties = {
    top: rect.bottom + 10,
    left: Math.min(window.innerWidth - popoverW - 12, Math.max(12, rect.left - 8)),
    width: popoverW,
    ...(popoverH > 0 ? { height: popoverH } : {}),
  };

  return (
    <div
      ref={popoverRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "fixed z-[var(--z-toast)] pf-rounded-xl border border-border-default/85 bg-bg-primary/98 shadow-[0_18px_46px_rgba(15,23,42,0.14)] backdrop-blur-xl",
        "animate-[varPopIn_0.15s_ease-out]",
        "var-popover-resizable group/popover"
      )}
      style={popoverStyle}
    >
      {/* Floating copy button - top right */}
      <button
        type="button"
        onClick={handleCopy}
        className={cn("var-popover-copy-float", copied && "var-popover-copy-float-ok")}
        title={t('http.copyValue')}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      {/* Header: variable name + source badge */}
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-start justify-between gap-3 pr-7">
          <div className="min-w-0">
            <div className="pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
              {t('http.variablePreview')}
            </div>
            <div className="mt-1 font-mono pf-text-sm font-semibold text-text-primary">
              {`{{${preview.key}}}`}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {preview.isSecret && preview.source !== "missing" && (
              <button
                type="button"
                onClick={() => setRevealed((current) => !current)}
                className="var-popover-toolbar-btn"
                title={revealed ? t('http.hideValue') : t('http.revealValue')}
              >
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            )}
            <div className="inline-flex rounded-full bg-bg-hover px-2 py-0.5 pf-text-xxs font-medium text-text-secondary">
              {sourceLabelMap[preview.source]}
            </div>
          </div>
        </div>
      </div>

      {/* Value area */}
      <div className="var-popover-body">
        <div className="var-popover-value-block group/block">
          {canSaveToCollection ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('http.variableEditPlaceholder')}
              spellCheck={false}
              className="var-popover-textarea"
            />
          ) : (
            <div className={cn(
              "var-popover-display",
              preview.source === "missing" && "var-popover-display-missing"
            )}>
              {displayValue}
            </div>
          )}
        </div>
      </div>

      {/* Footer: save button or status hint */}
      <div className="shrink-0 px-3 pb-3">
        {canSaveToCollection ? (
          <button
            type="button"
            onClick={async () => {
              if (!collectionId) return;
              setSaving(true);
              try {
                await upsertCollectionVariable(collectionId, preview.key, draft);
                setSaved(true);
                window.setTimeout(() => setSaved(false), 1200);
              } finally {
                setSaving(false);
              }
            }}
            className={cn("var-popover-save-btn", saved && "var-popover-save-btn-ok")}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? t('http.variableSaved') : t('http.variableSave')}
          </button>
        ) : !collectionId ? (
          <div className="pf-text-xxs text-text-disabled text-center py-0.5 select-none">{t('http.variableNoCollection')}</div>
        ) : preview.source === "dynamic" ? (
          <div className="pf-text-xxs text-text-disabled text-center py-0.5 select-none">{t('http.variableDynamicReadonly')}</div>
        ) : null}
      </div>

      {/* Resize handle */}
      <div
        className="var-popover-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
