import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Upload, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { VariableInlineInput } from "./VariableInlineInput";
import { InlineMockButton } from "./ExportPluginDropdown";
import { useContextMenu, buildClipboardItems, useZoneFallback } from "@/components/ui/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { KeyValue, FormDataField } from "@/types/http";
import type { ContextMenuEntry } from "@/components/ui/ContextMenu";
import { pickFiles } from "@/services/httpService";

/* ── Header Dictionary: key → possible values ── */
export const HEADER_DICT: Record<string, string[]> = {
  "Content-Type": [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
    "text/html",
    "application/xml",
    "application/octet-stream",
    "application/javascript",
    "text/css",
    "image/png",
    "image/jpeg",
  ],
  "Accept": [
    "application/json",
    "*/*",
    "text/html",
    "application/xml",
    "text/plain",
    "image/*",
  ],
  "Authorization": ["Bearer ", "Basic "],
  "Cache-Control": ["no-cache", "no-store", "max-age=0", "max-age=3600", "public", "private"],
  "Accept-Encoding": ["gzip, deflate, br", "gzip, deflate", "identity"],
  "Accept-Language": ["zh-CN,zh;q=0.9,en;q=0.8", "en-US,en;q=0.9", "*"],
  "User-Agent": ["ProtoForge/1.0", "Mozilla/5.0"],
  "X-Requested-With": ["XMLHttpRequest"],
  "Origin": [""],
  "Referer": [""],
  "Cookie": [""],
  "If-None-Match": [""],
  "If-Modified-Since": [""],
  "X-Forwarded-For": [""],
  "X-Real-IP": [""],
  "X-CSRF-Token": [""],
  "X-API-Key": [""],
  "Connection": ["keep-alive", "close"],
  "Transfer-Encoding": ["chunked"],
  "Content-Length": [""],
  "Content-Disposition": ["attachment; filename=\"\"", "inline"],
  "Access-Control-Allow-Origin": ["*"],
  "Access-Control-Allow-Methods": ["GET, POST, PUT, DELETE, OPTIONS"],
  "Access-Control-Allow-Headers": ["Content-Type, Authorization"],
  "Pragma": ["no-cache"],
  "Expires": ["0"],
  "Range": ["bytes=0-"],
  "Host": [""],
  "DNT": ["1"],
};

const ALL_HEADER_KEYS = Object.keys(HEADER_DICT);

const createEmptyKeyValue = (): KeyValue => ({ key: "", value: "", description: "", enabled: true });
const isEmptyKeyValueRow = (item: KeyValue) => !item.key.trim() && !item.value.trim() && !(item.description || "").trim();

function normalizeKeyValueRows(items: KeyValue[]) {
  const autoRows = items.filter((item) => item.isAuto);
  const customRows = items.filter((item) => !item.isAuto);
  const normalizedCustomRows = [...customRows];

  while (
    normalizedCustomRows.length > 1 &&
    isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 1]) &&
    isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 2])
  ) {
    normalizedCustomRows.pop();
  }

  if (normalizedCustomRows.length === 0 || !isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 1])) {
    normalizedCustomRows.push(createEmptyKeyValue());
  }

  return [...autoRows, ...normalizedCustomRows];
}

const createEmptyFormDataField = (): FormDataField => ({ key: "", value: "", fieldType: "text", enabled: true });
const isEmptyFormDataRow = (field: FormDataField) => !field.key.trim() && !field.value.trim() && !field.fileName && !(field.description || "").trim();

function normalizeFormDataRows(fields: FormDataField[]) {
  const normalizedFields = [...fields];

  while (
    normalizedFields.length > 1 &&
    isEmptyFormDataRow(normalizedFields[normalizedFields.length - 1]) &&
    isEmptyFormDataRow(normalizedFields[normalizedFields.length - 2])
  ) {
    normalizedFields.pop();
  }

  if (normalizedFields.length === 0 || !isEmptyFormDataRow(normalizedFields[normalizedFields.length - 1])) {
    normalizedFields.push(createEmptyFormDataField());
  }

  return normalizedFields;
}

/* ── KV Editor (table-based, for params, headers, form-urlencoded) ── */
export function KVEditor({ items, onChange, kp, vp, showPresets, showAutoToggle, showMockGenerator, collectionId, itemId }: {
  items: KeyValue[];
  onChange: (v: KeyValue[]) => void;
  kp: string;
  vp: string;
  showPresets?: boolean;
  showAutoToggle?: boolean;
  showMockGenerator?: boolean;
  collectionId?: string | null;
  itemId?: string | null;
}) {
  const { t } = useTranslation();
  const [showAuto, setShowAuto] = useState(false);
  const [activeKeySuggest, setActiveKeySuggest] = useState<number | null>(null);
  const [activeValueSuggest, setActiveValueSuggest] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const frameRef = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => normalizeKeyValueRows(items || []), [items]);
  const customRowCount = safe.filter((item) => !item.isAuto).length;
  const previousCustomRowCountRef = useRef(customRowCount);

  const autoCount = safe.filter(h => h.isAuto).length;
  const hasAuto = showAutoToggle && autoCount > 0;

  const update = (i: number, f: "key" | "value" | "description", v: string) => {
    const n = [...safe]; n[i] = { ...n[i], [f]: v }; onChange(normalizeKeyValueRows(n));
  };
  const toggle = (i: number) => {
    const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(normalizeKeyValueRows(n));
  };
  const remove = (i: number) => onChange(normalizeKeyValueRows(safe.filter((_, j) => j !== i)));

  const selectKeySuggestion = (i: number, key: string) => {
    const n = [...safe]; n[i] = { ...n[i], key };
    const vals = HEADER_DICT[key];
    if (vals && vals.length > 0 && !n[i].value) n[i].value = vals[0];
    onChange(normalizeKeyValueRows(n)); setActiveKeySuggest(null); setHighlightIdx(-1);
    if (vals && vals.length > 1) setActiveValueSuggest(i);
  };
  const selectValueSuggestion = (i: number, value: string) => {
    update(i, "value", value); setActiveValueSuggest(null); setHighlightIdx(-1);
  };
  const getKeySuggestions = (input: string): string[] => {
    if (!showPresets) return [];
    if (!input) return ALL_HEADER_KEYS.slice(0, 12);
    return ALL_HEADER_KEYS.filter(k => k.toLowerCase().includes(input.toLowerCase())).slice(0, 10);
  };
  const getValueSuggestions = (key: string): string[] => (!showPresets ? [] : HEADER_DICT[key] || []);
  const handleKeyDown = (e: React.KeyboardEvent, sugs: string[], onSel: (v: string) => void, onCls: () => void) => {
    if (!sugs.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx(p => (p + 1) % sugs.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx(p => (p <= 0 ? sugs.length - 1 : p - 1)); }
    else if (e.key === "Enter" && highlightIdx >= 0 && highlightIdx < sugs.length) { e.preventDefault(); onSel(sugs[highlightIdx]); }
    else if (e.key === "Escape") { e.preventDefault(); onCls(); setHighlightIdx(-1); }
  };

  const cellInput = "editor-table-input";

  // ── Context menu ──
  const { showMenu, MenuComponent } = useContextMenu();
  const { handleZoneFallback, ZoneFallbackMenu } = useZoneFallback(t);
  const handleRowContextMenu = (e: React.MouseEvent, i: number) => {
    const item = safe[i];
    const clipboardItems = buildClipboardItems(e, t);
    if (!item.key.trim() && !item.value.trim()) {
      // 空行：只显示剪贴板菜单（如果在 input 上），否则仅阻止默认菜单
      if (clipboardItems.length > 0) {
        showMenu(e, clipboardItems.slice(0, -1));
      } else {
        e.preventDefault();
      }
      return;
    }
    const menuItems: ContextMenuEntry[] = [
      ...clipboardItems,
      { id: 'copy-row', label: t('contextMenu.copyRow', '复制行'), onClick: () => copyTextToClipboard(`${item.key}: ${item.value}`) },
      { id: 'duplicate-row', label: t('contextMenu.duplicateRow', '复制为新行'), onClick: () => {
        const n = [...safe];
        n.splice(i + 1, 0, { ...item, key: item.key, value: item.value, description: item.description });
        onChange(normalizeKeyValueRows(n));
      }},
      { type: 'divider' },
      { id: 'insert-above', label: t('contextMenu.insertAbove', '在上方插入行'), onClick: () => {
        const n = [...safe]; n.splice(i, 0, createEmptyKeyValue()); onChange(normalizeKeyValueRows(n));
      }},
      { id: 'insert-below', label: t('contextMenu.insertBelow', '在下方插入行'), onClick: () => {
        const n = [...safe]; n.splice(i + 1, 0, createEmptyKeyValue()); onChange(normalizeKeyValueRows(n));
      }},
      { type: 'divider' },
      { id: 'toggle-row', label: item.enabled ? t('contextMenu.disableRow', '禁用') : t('contextMenu.enableRow', '启用'), onClick: () => toggle(i) },
    ];
    // Set as env variable
    if (item.key.trim()) {
      menuItems.push({ id: 'set-key-env', label: t('contextMenu.setKeyAsEnv', '设 Key 为环境变量'), onClick: () => {
        window.dispatchEvent(new CustomEvent('set-env-variable', { detail: { value: item.key } }));
      }});
    }
    if (item.value.trim()) {
      menuItems.push({ id: 'set-val-env', label: t('contextMenu.setValueAsEnv', '设 Value 为环境变量'), onClick: () => {
        window.dispatchEvent(new CustomEvent('set-env-variable', { detail: { value: item.value } }));
      }});
    }
    menuItems.push({ type: 'divider' });
    menuItems.push({ id: 'delete-row', label: t('contextMenu.delete', '删除'), danger: true, onClick: () => remove(i) });
    showMenu(e, menuItems);
  };

  const visibleItems = safe.filter(item => !item.isAuto || showAuto);
  const selectableVisibleItems = visibleItems.filter(item => item.key.trim().length > 0);
  const allVisibleEnabled = selectableVisibleItems.length > 0 && selectableVisibleItems.every(item => item.enabled);

  useEffect(() => {
    if (customRowCount > previousCustomRowCountRef.current) {
      requestAnimationFrame(() => {
        frameRef.current?.scrollTo({ top: frameRef.current.scrollHeight, behavior: "smooth" });
      });
    }
    previousCustomRowCountRef.current = customRowCount;
  }, [customRowCount]);

  const renderRow = (item: KeyValue, i: number) => {
    const isSelectable = item.key.trim().length > 0;
    const keySugs = activeKeySuggest === i ? getKeySuggestions(item.key) : [];
    const valSugs = activeValueSuggest === i ? getValueSuggestions(item.key) : [];
    return (
      <tr key={i} className={cn("group", item.isAuto && "bg-bg-secondary/18")} onContextMenu={(e) => handleRowContextMenu(e, i)}>
        <td className="editor-table-check relative">
          {isSelectable ? (
            <input type="checkbox" checked={item.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto" />
          ) : (
            <span className="editor-table-empty-check block mx-auto" aria-hidden="true" />
          )}
        </td>
        <td>
          <TableCellInput value={item.key} onChange={v => update(i, "key", v)}
            onFocus={() => { if (showPresets) { setActiveKeySuggest(i); setActiveValueSuggest(null); setHighlightIdx(-1); } }}
            onBlur={() => setTimeout(() => { setActiveKeySuggest(null); setHighlightIdx(-1); }, 150)}
            onKeyDown={e => handleKeyDown(e, keySugs, k => selectKeySuggestion(i, k), () => setActiveKeySuggest(null))}
            placeholder={kp} disabled={!item.enabled} suggestions={keySugs} highlightIdx={highlightIdx}
            onSelectSuggestion={k => selectKeySuggestion(i, k)} className={cellInput} collectionId={collectionId} itemId={itemId} />
        </td>
        <td>
          <div className="flex items-center gap-0">
            <TableCellInput value={item.value} onChange={v => update(i, "value", v)}
              onFocus={() => { if (showPresets && HEADER_DICT[item.key]) { setActiveValueSuggest(i); setActiveKeySuggest(null); setHighlightIdx(-1); } }}
              onBlur={() => setTimeout(() => { setActiveValueSuggest(null); setHighlightIdx(-1); }, 150)}
              onKeyDown={e => handleKeyDown(e, valSugs, v => selectValueSuggestion(i, v), () => setActiveValueSuggest(null))}
              placeholder={vp} disabled={!item.enabled} suggestions={valSugs} highlightIdx={highlightIdx}
              onSelectSuggestion={v => selectValueSuggestion(i, v)} className={cn(cellInput, "flex-1 min-w-0")} collectionId={collectionId} itemId={itemId} />
            {showMockGenerator && <InlineMockButton onInsert={(v: string) => update(i, "value", v)} />}
          </div>
        </td>
        <td>
          <input value={item.description || ""} onChange={e => update(i, "description", e.target.value)} placeholder="Description"
            className={cn("editor-table-input editor-table-description", !item.enabled && "editor-table-muted")} />
        </td>
        <td className="editor-table-actions">
          {isSelectable ? (
            <button onClick={() => remove(i)} className="editor-table-delete">
              <Trash2 className="h-3 w-3" />
              <span>{t('contextMenu.delete')}</span>
            </button>
          ) : (
            <span className="editor-table-empty-action" aria-hidden="true" />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="editor-table-shell" data-contextmenu-zone="kv-editor" onContextMenu={handleZoneFallback}>
      {MenuComponent}
      {ZoneFallbackMenu}
      <div ref={frameRef} className="editor-table-frame">
        {hasAuto && (
          <div className="editor-table-banner">
            <button type="button" className="editor-table-banner-toggle" onClick={() => setShowAuto(!showAuto)}>
              {showAuto ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-medium">{autoCount} auto headers</span>
              <span className="text-text-disabled">{showAuto ? '点击隐藏' : '点击展示默认请求头'}</span>
            </button>
          </div>
        )}

        <table className="editor-table">
          <colgroup>
            <col style={{ width: '32px' }} />
            <col style={{ width: '33%' }} />
            <col style={{ width: '39%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '72px' }} />
          </colgroup>
        <thead>
          <tr>
            <th className="editor-table-check relative">
              <input
                type="checkbox"
                checked={allVisibleEnabled}
                onChange={() => {
                  onChange(safe.map(item => {
                    if (item.isAuto && !showAuto) return item;
                    if (!item.key.trim()) return item;
                    return { ...item, enabled: !allVisibleEnabled };
                  }));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto"
                title={allVisibleEnabled ? t('import.deselectAll') : t('import.selectAll')}
                disabled={selectableVisibleItems.length === 0}
              />
            </th>
            <th>{kp}</th>
            <th>{vp}</th>
            <th>Description</th>
            <th className="editor-table-actions" />
          </tr>
        </thead>
        <tbody>
          {hasAuto && showAuto && safe.map((item, i) => {
            if (!item.isAuto) return null;
            return renderRow(item, i);
          })}
          {safe.map((item, i) => {
            if (item.isAuto) return null;
            return renderRow(item, i);
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── TableCellInput: borderless input with portal suggestion dropdown ── */
function TableCellInput({ value, onChange, onFocus, onBlur, onKeyDown, placeholder, disabled, suggestions, highlightIdx, onSelectSuggestion, className: cls, collectionId, itemId }: {
  value: string; onChange: (v: string) => void; onFocus: () => void; onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void; placeholder: string; disabled: boolean;
  suggestions?: string[]; highlightIdx?: number; onSelectSuggestion?: (v: string) => void; className?: string;
  collectionId?: string | null;
  itemId?: string | null;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hasSugs = suggestions && suggestions.length > 0;
  useEffect(() => { if (hasSugs && ref.current) setRect(ref.current.getBoundingClientRect()); }, [hasSugs, value]);

  return (
    <>
      <VariableInlineInput
        inputRef={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        collectionId={collectionId}
        itemId={itemId}
        className={cn(cls, disabled && "editor-table-muted")}
        overlayClassName={cn(cls, disabled && "editor-table-muted")}
        compactPopover
      />
      {hasSugs && rect && onSelectSuggestion && createPortal(
        <div className="fixed bg-bg-elevated border border-border-default rounded-lg shadow-xl max-h-[220px] overflow-y-auto py-0.5"
          style={{ top: rect.bottom + 2, left: rect.left, width: rect.width, zIndex: 9999 }}>
          {suggestions!.map((s, si) => (
            <button key={si} onMouseDown={e => { e.preventDefault(); onSelectSuggestion!(s); }}
              className={cn("w-full px-3 py-1.5 text-left pf-text-sm font-mono transition-colors",
                si === (highlightIdx ?? -1) ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-bg-hover",
                value === s && si !== (highlightIdx ?? -1) && "text-accent font-semibold")}>
              {s || <span className="text-text-disabled italic">{t('http.emptyValue')}</span>}
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

/* ── FormData Editor (table-based, text + file fields) ── */
export function FormDataEditor({ fields, onChange }: { fields: FormDataField[]; onChange: (v: FormDataField[]) => void }) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => normalizeFormDataRows(fields || []), [fields]);
  const selectableFields = safe.filter((field) => field.key.trim().length > 0);
  const previousFieldCountRef = useRef(safe.length);
  const update = (i: number, u: Partial<FormDataField>) => { const n = [...safe]; n[i] = { ...n[i], ...u }; onChange(normalizeFormDataRows(n)); };
  const toggle = (i: number) => { const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(normalizeFormDataRows(n)); };
  const remove = (i: number) => onChange(normalizeFormDataRows(safe.filter((_, j) => j !== i)));

  const getFilePaths = (field: FormDataField): string[] => {
    if (field.filePaths && field.filePaths.length > 0) return field.filePaths;
    if (field.value) return field.value.split(',').map(p => p.trim()).filter(Boolean);
    return [];
  };
  const getFileNames = (field: FormDataField): string[] => {
    if (field.fileNames && field.fileNames.length > 0) return field.fileNames;
    if (field.fileName) return field.fileName.split(',').map(n => n.trim()).filter(Boolean);
    return getFilePaths(field).map(p => p.split(/[\\/]/).pop() || 'file');
  };

  const handleFilePick = async (i: number) => {
    const r = await pickFiles();
    if (!r) return;
    const field = safe[i];
    const existingPaths = getFilePaths(field);
    const existingNames = getFileNames(field);
    const newPaths = [...existingPaths, ...r.paths];
    const newNames = [...existingNames, ...r.names];
    update(i, {
      filePaths: newPaths,
      fileNames: newNames,
      value: newPaths.join(','),
      fileName: newNames.join(', '),
    });
  };

  const handleRemoveFile = (fieldIdx: number, fileIdx: number) => {
    const field = safe[fieldIdx];
    const paths = [...getFilePaths(field)];
    const names = [...getFileNames(field)];
    paths.splice(fileIdx, 1);
    names.splice(fileIdx, 1);
    update(fieldIdx, {
      filePaths: paths,
      fileNames: names,
      value: paths.join(','),
      fileName: names.join(', '),
    });
  };

  useEffect(() => {
    if (safe.length > previousFieldCountRef.current) {
      requestAnimationFrame(() => {
        frameRef.current?.scrollTo({ top: frameRef.current.scrollHeight, behavior: "smooth" });
      });
    }
    previousFieldCountRef.current = safe.length;
  }, [safe.length]);

  return (
    <div className="editor-table-shell">
      <div ref={frameRef} className="editor-table-frame">
      <table className="editor-table table-fixed">
        <colgroup>
          <col style={{ width: '32px' }} />
          <col style={{ width: '80px' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '72px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="editor-table-check relative">
              <input
                type="checkbox"
                checked={selectableFields.length > 0 && selectableFields.every(f => f.enabled)}
                onChange={() => {
                  const allEnabled = selectableFields.length > 0 && selectableFields.every(f => f.enabled);
                  onChange(safe.map(f => f.key.trim() ? { ...f, enabled: !allEnabled } : f));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto"
                title={(selectableFields.length > 0 && selectableFields.every(f => f.enabled)) ? t('import.deselectAll') : t('import.selectAll')}
                disabled={selectableFields.length === 0}
              />
            </th>
            <th>{t('http.type')}</th>
            <th>Key</th>
            <th>Value</th>
            <th>Description</th>
            <th className="editor-table-actions" />
          </tr>
        </thead>
        <tbody>
          {safe.map((field, i) => (
            <tr key={i} className="group">
              <td className="editor-table-check relative">
                {field.key.trim() ? (
                  <input type="checkbox" checked={field.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto" />
                ) : (
                  <span className="editor-table-empty-check block mx-auto" aria-hidden="true" />
                )}
              </td>
              <td>
                <select value={field.fieldType}
                  onChange={e => update(i, { fieldType: e.target.value as 'text' | 'file', value: '', fileName: undefined, filePaths: [], fileNames: [] })}
                  className={cn("editor-table-select pf-text-xs text-text-secondary", !field.enabled && "editor-table-muted")}>
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td>
                <input value={field.key} onChange={e => update(i, { key: e.target.value })} placeholder="Key"
                  className={cn("editor-table-input", !field.enabled && "editor-table-muted")} />
              </td>
              <td>
                {field.fieldType === "text" ? (
                  <input value={field.value} onChange={e => update(i, { value: e.target.value })} placeholder="Value"
                    className={cn("editor-table-input", !field.enabled && "editor-table-muted")} />
                ) : (
                  <div className={cn("flex items-start w-full min-h-[34px]", !field.enabled && "editor-table-muted")}>
                    <button onClick={() => handleFilePick(i)}
                      className="shrink-0 h-[34px] px-2 flex items-center gap-1 bg-transparent pf-text-xs cursor-pointer hover:bg-bg-hover transition-colors rounded"
                      title={getFilePaths(field).length > 0 ? "添加更多文件" : t('http.selectFile')}>
                      <Upload className="w-3 h-3 text-text-disabled shrink-0" />
                      <span className="text-text-tertiary whitespace-nowrap">{getFilePaths(field).length > 0 ? "+" : t('http.selectFile')}</span>
                    </button>
                    {getFilePaths(field).length > 0 && (
                      <div className="flex-1 min-w-0 max-h-[68px] overflow-y-auto flex flex-wrap gap-1 py-1 px-1">
                        {getFileNames(field).map((name, fi) => (
                          <span
                            key={fi}
                            title={getFilePaths(field)[fi] || name}
                            className="inline-flex items-center gap-0.5 max-w-[160px] px-1.5 py-0.5 rounded bg-bg-hover pf-text-xxs text-text-secondary border border-border-subtle cursor-default group/chip"
                          >
                            <span className="truncate">{name}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveFile(i, fi); }}
                              className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-red-500/15 hover:text-red-500 text-text-disabled transition-colors"
                              title={`移除 ${name}`}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td>
                <input value={field.description || ''} onChange={e => update(i, { description: e.target.value })} placeholder="Description"
                  className={cn("editor-table-input editor-table-description", !field.enabled && "editor-table-muted")} />
              </td>
              <td className="editor-table-actions">
                {field.key.trim() ? (
                  <button onClick={() => remove(i)} className="editor-table-delete">
                    <Trash2 className="h-3 w-3" />
                    <span>{t('contextMenu.delete')}</span>
                  </button>
                ) : (
                  <span className="editor-table-empty-action" aria-hidden="true" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
