// 数据网格 — 虚拟滚动 + 内联编辑 + 拖拽选区 + 复制
// 行号列整合行选择（点击选行、Shift/Ctrl 多选）
// 复制格式通过右上角下拉持久化

import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Loader2, Save, Undo2, Trash2, ArrowUp, ArrowDown,
  Copy, ChevronDown,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { QueryResult, SqlValue, CellEdit, ColumnInfo } from "@/types/dbclient";
import { sqlValueDisplay, sqlValueToString } from "@/types/dbclient";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";

const ROW_HEIGHT = 28;
export const COPY_FORMAT_KEY = "protoforge:dbclient:copyFormat";

// ── 复制格式类型 ──
export type CopyFormat = "tsv" | "csv" | "insert" | "update" | "markdown";

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = {
  tsv: "TSV",
  csv: "CSV",
  insert: "INSERT",
  update: "UPDATE",
  markdown: "Markdown",
};

export const COPY_FORMAT_GROUPS: { label: string; formats: CopyFormat[] }[] = [
  { label: "Data", formats: ["tsv", "csv"] },
  { label: "SQL", formats: ["insert", "update"] },
  { label: "Doc", formats: ["markdown"] },
];

export function getSavedCopyFormat(): CopyFormat {
  try {
    const v = localStorage.getItem(COPY_FORMAT_KEY);
    if (v && v in COPY_FORMAT_LABELS) return v as CopyFormat;
  } catch {}
  return "tsv";
}

export function saveCopyFormat(fmt: CopyFormat) {
  try { localStorage.setItem(COPY_FORMAT_KEY, fmt); } catch {}
}

// ── 选区 ──
interface CellRange { startRow: number; startCol: number; endRow: number; endCol: number; }
function norm(r: CellRange) {
  return { r1: Math.min(r.startRow, r.endRow), c1: Math.min(r.startCol, r.endCol), r2: Math.max(r.startRow, r.endRow), c2: Math.max(r.startCol, r.endCol) };
}
function inRange(row: number, col: number, range: CellRange | null) {
  if (!range) return false;
  const { r1, c1, r2, c2 } = norm(range);
  return row >= r1 && row <= r2 && col >= c1 && col <= c2;
}

// ── 复制格式化 ──
function cellText(val: SqlValue): string { return sqlValueToString(val); }

function formatRange(res: QueryResult, r: CellRange, fmt: CopyFormat, table: string): string {
  const { r1, c1, r2, c2 } = norm(r);
  const cols = res.columns.slice(c1, c2 + 1);
  const getRows = () => {
    const rows: SqlValue[][] = [];
    for (let i = r1; i <= r2; i++) { if (res.rows[i]) rows.push(res.rows[i].slice(c1, c2 + 1)); }
    return rows;
  };

  switch (fmt) {
    case "tsv": {
      const lines: string[] = [];
      for (const row of getRows()) lines.push(row.map(cellText).join("\t"));
      return lines.join("\n");
    }
    case "csv": {
      const esc = (s: string) => s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      const lines = [cols.map(c => esc(c.name)).join(",")];
      for (const row of getRows()) lines.push(row.map(c => esc(cellText(c))).join(","));
      return lines.join("\n");
    }
    case "insert": {
      const cn = cols.map(c => c.name).join(", ");
      return getRows().map(row => {
        const vals = row.map(c => c.type === "Null" ? "NULL" : (c.type === "Int" || c.type === "Float") ? String(c.value) : c.type === "Bool" ? (c.value ? "TRUE" : "FALSE") : `'${cellText(c).replace(/'/g, "''")}'`);
        return `INSERT INTO ${table} (${cn}) VALUES (${vals.join(", ")});`;
      }).join("\n");
    }
    case "update": {
      return getRows().map(row => {
        const sets = row.map((c, i) => {
          const v = c.type === "Null" ? "NULL" : (c.type === "Int" || c.type === "Float") ? String(c.value) : c.type === "Bool" ? (c.value ? "TRUE" : "FALSE") : `'${cellText(c).replace(/'/g, "''")}'`;
          return `${cols[i].name} = ${v}`;
        });
        return `UPDATE ${table} SET ${sets.join(", ")} WHERE /* condition */;`;
      }).join("\n");
    }
    case "markdown": {
      const headers = cols.map(c => c.name);
      const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
      for (const row of getRows()) lines.push(`| ${row.map(c => cellText(c).replace(/\|/g, "\\|")).join(" | ")} |`);
      return lines.join("\n");
    }
  }
}

// ── Props ──
interface DataGridProps {
  result: QueryResult | null;
  loading?: boolean;
  offset?: number;
  limit?: number;
  onPageChange?: (offset: number) => void;
  editable?: boolean;
  pendingEdits?: CellEdit[];
  onCellEdit?: (edit: CellEdit) => void;
  onApplyEdits?: () => void;
  onDiscardEdits?: () => void;
  onDeleteRows?: (pkValues: SqlValue[][]) => void;
  tableMeta?: { database: string; schema: string; table: string; pkColumns: string[] } | null;
  sortColumn?: string | null;
  sortDir?: "ASC" | "DESC" | null;
  onSort?: (column: string) => void;
  hideCopyFormatDropdown?: boolean;
  hideStatusBar?: boolean;
}

export const DataGrid = memo(function DataGrid({
  result, loading = false, offset = 0, limit = 200, onPageChange,
  editable = false, pendingEdits = [], onCellEdit, onApplyEdits, onDiscardEdits, onDeleteRows,
  tableMeta, sortColumn, sortDir, onSort, hideCopyFormatDropdown = false, hideStatusBar = false,
}: DataGridProps) {
  const { t } = useTranslation();
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const lastClickedRowRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 选区（每个 DataGrid 实例独立）
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [anchor, setAnchor] = useState<{ row: number; col: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 当 result 变化时清空选区（切换 tab 或刷新数据）
  const resultRef = useRef(result);
  useEffect(() => {
    if (resultRef.current !== result) {
      resultRef.current = result;
      setCellRange(null);
      setAnchor(null);
      setSelectedRows(new Set());
      setEditingCell(null);
    }
  }, [result]);

  // 复制格式（持久化到 localStorage）
  const [copyFormat, setCopyFormatState] = useState<CopyFormat>(getSavedCopyFormat);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const formatDropdownRef = useRef<HTMLDivElement>(null);

  const setCopyFormat = useCallback((fmt: CopyFormat) => {
    setCopyFormatState(fmt);
    saveCopyFormat(fmt);
    setShowFormatDropdown(false);
  }, []);

  // 关闭下拉
  useEffect(() => {
    if (!showFormatDropdown) return;
    const h = (e: MouseEvent) => {
      if (formatDropdownRef.current && !formatDropdownRef.current.contains(e.target as Node)) setShowFormatDropdown(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showFormatDropdown]);

  const { showMenu, MenuComponent } = useContextMenu();

  const rowCount = result?.rows.length ?? 0;
  const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 30 });

  // 列宽（可拖拽调整）
  const computedWidths = useMemo(() => {
    if (!result) return [];
    return result.columns.map((col, ci) => {
      const hLen = col.name.length + simplifyType(col.dataType).length + 4;
      let maxD = 0;
      for (let i = 0, n = Math.min(result.rows.length, 50); i < n; i++) {
        const c = result.rows[i][ci];
        if (c) { const l = c.type === "Null" ? 4 : c.type === "Text" || c.type === "Timestamp" ? String(c.value).length : c.type === "Int" || c.type === "Float" ? String(c.value).length : 6; if (l > maxD) maxD = l; }
      }
      return Math.max(80, Math.min(400, Math.max(hLen, maxD) * 7.5 + 32));
    });
  }, [result]);

  const [colWidths, setColWidths] = useState<number[]>([]);
  useEffect(() => { setColWidths(computedWidths); }, [computedWidths]);

  // 列宽拖拽
  const resizingColRef = useRef<{ ci: number; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((ci: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColRef.current = { ci, startX: e.clientX, startW: colWidths[ci] ?? 120 };

    const onMove = (ev: MouseEvent) => {
      const r = resizingColRef.current;
      if (!r) return;
      const delta = ev.clientX - r.startX;
      const newW = Math.max(50, r.startW + delta);
      setColWidths(prev => { const next = [...prev]; next[r.ci] = newW; return next; });
    };
    const onUp = () => {
      resizingColRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  // PK
  const pkIdx = useMemo(() => tableMeta?.pkColumns.map(pk => result?.columns.findIndex(c => c.name === pk) ?? -1).filter(i => i >= 0) ?? [], [tableMeta?.pkColumns, result?.columns]);
  const getPk = useCallback((ri: number): SqlValue[] => { const row = result?.rows[ri]; return row ? pkIdx.map(ci => ci < row.length ? row[ci] : { type: "Null" as const }) : []; }, [result, pkIdx]);
  const editKeys = useMemo(() => { if (!tableMeta || !pendingEdits.length) return new Set<string>(); const s = new Set<string>(); for (const e of pendingEdits) if (e.table === tableMeta.table) s.add(`${JSON.stringify(e.pkValues)}:${e.column}`); return s; }, [pendingEdits, tableMeta]);
  const isEdited = useCallback((ri: number, ci: number) => { if (!editKeys.size || !result) return false; return editKeys.has(`${JSON.stringify(getPk(ri))}:${result.columns[ci].name}`); }, [editKeys, result, getPk]);

  // ── 行号点击 = 选行（支持 Shift/Ctrl 多选）──
  const handleRowClick = useCallback((ri: number, e: React.MouseEvent) => {
    if (!result) return;
    const colCount = result.columns.length;
    if (e.shiftKey && lastClickedRowRef.current != null) {
      // Shift: 范围选择
      const from = Math.min(lastClickedRowRef.current, ri);
      const to = Math.max(lastClickedRowRef.current, ri);
      setSelectedRows(prev => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
        return next;
      });
      // 同时设置单元格选区
      setCellRange({ startRow: from, startCol: 0, endRow: to, endCol: colCount - 1 });
    } else if (e.metaKey || e.ctrlKey) {
      // Ctrl/Cmd: 切换单行
      setSelectedRows(prev => {
        const next = new Set(prev);
        next.has(ri) ? next.delete(ri) : next.add(ri);
        return next;
      });
    } else {
      // 普通点击: 选中单行
      setSelectedRows(new Set([ri]));
      setCellRange({ startRow: ri, startCol: 0, endRow: ri, endCol: colCount - 1 });
      setAnchor({ row: ri, col: 0 });
    }
    lastClickedRowRef.current = ri;
  }, [result]);

  // 行号拖拽选多行
  const startRowDrag = useCallback((ri: number) => {
    if (!result) return;
    setSelectedRows(new Set([ri]));
    setAnchor({ row: ri, col: 0 });
    setCellRange({ startRow: ri, startCol: 0, endRow: ri, endCol: result.columns.length - 1 });
    setIsDragging(true);
    lastClickedRowRef.current = ri;
  }, [result]);

  const extendRowDrag = useCallback((ri: number) => {
    if (!isDragging || !anchor || !result) return;
    const from = Math.min(anchor.row, ri);
    const to = Math.max(anchor.row, ri);
    const rows = new Set<number>();
    for (let i = from; i <= to; i++) rows.add(i);
    setSelectedRows(rows);
    setCellRange({ startRow: anchor.row, startCol: 0, endRow: ri, endCol: result.columns.length - 1 });
  }, [isDragging, anchor, result]);

  // ── 单元格拖拽选区 ──
  const startDrag = useCallback((row: number, col: number, shift: boolean) => {
    if (shift && anchor) {
      setCellRange({ startRow: anchor.row, startCol: anchor.col, endRow: row, endCol: col });
    } else {
      setAnchor({ row, col });
      setCellRange({ startRow: row, startCol: col, endRow: row, endCol: col });
    }
    setSelectedRows(new Set());
    setIsDragging(true);
  }, [anchor]);

  const extendDrag = useCallback((row: number, col: number) => {
    if (!isDragging || !anchor) return;
    setCellRange({ startRow: anchor.row, startCol: anchor.col, endRow: row, endCol: col });
  }, [isDragging, anchor]);

  const endDrag = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (!isDragging) return;
    const up = () => setIsDragging(false);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, [isDragging]);

  // 列头点击 = 选列
  const selectColumn = useCallback((ci: number) => {
    if (!result) return;
    setAnchor({ row: 0, col: ci });
    setCellRange({ startRow: 0, startCol: ci, endRow: result.rows.length - 1, endCol: ci });
    setSelectedRows(new Set());
  }, [result]);

  // 编辑
  const handleDblClick = useCallback((ri: number, ci: number) => {
    if (!editable || !tableMeta || !result) return;
    if (result.columns[ci].dataType === "bytea" || result.columns[ci].dataType === "BLOB") return;
    setEditingCell({ row: ri, col: ci });
  }, [editable, tableMeta, result]);

  const handleSave = useCallback((ri: number, ci: number, val: SqlValue) => {
    if (!tableMeta || !onCellEdit || !result) return;
    onCellEdit({ database: tableMeta.database, schema: tableMeta.schema, table: tableMeta.table, pkColumns: tableMeta.pkColumns, pkValues: getPk(ri), column: result.columns[ci].name, newValue: val });
    setEditingCell(null);
  }, [tableMeta, onCellEdit, result, getPk]);

  const handleDeleteSel = useCallback(() => {
    if (!tableMeta || !onDeleteRows || !selectedRows.size) return;
    onDeleteRows(Array.from(selectedRows).map(getPk));
    setSelectedRows(new Set());
  }, [tableMeta, onDeleteRows, selectedRows, getPk]);

  // ── 复制（使用当前选择的格式）──
  const doCopy = useCallback(() => {
    if (!result || !cellRange) return;
    const text = formatRange(result, cellRange, copyFormat, tableMeta?.table ?? "table");
    copyTextToClipboard(text);
  }, [result, cellRange, copyFormat, tableMeta]);

  const copyCellAt = useCallback((ri: number, ci: number) => {
    if (!result) return;
    const c = result.rows[ri]?.[ci];
    if (c) copyTextToClipboard(cellText(c));
  }, [result]);

  // Ctrl+C / Ctrl+A
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "c" && cellRange && result) { e.preventDefault(); doCopy(); }
      if (mod && e.key === "a" && result) {
        e.preventDefault();
        setCellRange({ startRow: 0, startCol: 0, endRow: result.rows.length - 1, endCol: result.columns.length - 1 });
        setAnchor({ row: 0, col: 0 });
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [cellRange, result, doCopy]);

  // 右键菜单 — 只显示"复制"
  const onCtx = useCallback((e: React.MouseEvent, ri: number, ci: number) => {
    if (!inRange(ri, ci, cellRange)) {
      setAnchor({ row: ri, col: ci });
      setCellRange({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    }
    const items: ContextMenuEntry[] = [
      { id: "copy", label: `${t("dbClient.copy")} (${COPY_FORMAT_LABELS[copyFormat]})`, icon: <Copy size={13} />, shortcut: "⌘C", onClick: doCopy },
      { id: "copy-cell", label: t("dbClient.copyCell"), icon: <Copy size={13} />, onClick: () => copyCellAt(ri, ci) },
    ];
    showMenu(e, items);
  }, [t, cellRange, copyFormat, doCopy, copyCellAt, showMenu]);

  // ── 空状态 ──
  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-text-tertiary" /></div>;
  if (!result) return <div className="flex h-full items-center justify-center pf-text-xs text-text-tertiary">{t("dbClient.noData")}</div>;
  if (!result.columns.length) return <div className="flex h-full items-center justify-center pf-text-xs text-text-tertiary">{result.affectedRows != null ? `${result.affectedRows} ${t("dbClient.rowsAffected")}` : t("dbClient.queryComplete")}</div>;

  const totalRows = result.totalRows ?? result.rows.length;
  const sl = limit > 0 ? limit : 200;
  const curPage = Math.floor(offset / sl) + 1;
  const totPages = Math.max(1, Math.ceil(totalRows / sl));
  const showPag = onPageChange && totalRows > sl;
  const rangeNorm = cellRange ? norm(cellRange) : null;

  return (
    <div className="flex h-full flex-col" tabIndex={-1} onMouseUp={endDrag}>
      {/* 编辑工具栏 */}
      {editable && (pendingEdits.length > 0 || selectedRows.size > 0) && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 bg-amber-500/5 shrink-0">
          {pendingEdits.length > 0 && (
            <>
              <span className="pf-text-xs text-amber-600 font-medium">{pendingEdits.length} {t("dbClient.pendingChanges")}</span>
              <button onClick={onApplyEdits} className="flex items-center gap-1 pf-rounded-sm bg-emerald-500/15 px-2 py-0.5 pf-text-xs font-medium text-emerald-600 hover:bg-emerald-500/25"><Save size={11} />{t("dbClient.apply")}</button>
              <button onClick={onDiscardEdits} className="flex items-center gap-1 pf-rounded-sm bg-bg-secondary px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover"><Undo2 size={11} />{t("dbClient.discard")}</button>
            </>
          )}
          {selectedRows.size > 0 && editable && tableMeta && tableMeta.pkColumns.length > 0 && (
            <button onClick={handleDeleteSel} className="flex items-center gap-1 pf-rounded-sm bg-red-500/15 px-2 py-0.5 pf-text-xs font-medium text-red-600 hover:bg-red-500/25 ml-auto"><Trash2 size={11} />{t("dbClient.deleteSelected", { count: selectedRows.size })}</button>
          )}
        </div>
      )}

      {/* 表格 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto select-none">
        {/* 表头 — sticky + 不透明背景防止内容透出 */}
        <div className="sticky top-0 z-20 flex border-b border-border-default/50 bg-bg-secondary" style={{ minWidth: "max-content", backdropFilter: "none" }}>
          {/* 序号列头 */}
          <div className="w-12 shrink-0 border-r border-border-default/50 px-2 py-1.5 text-center pf-text-xs font-medium text-text-tertiary bg-bg-secondary">#</div>
          {result.columns.map((col, ci) => {
            const sorted = sortColumn === col.name;
            const w = colWidths[ci] ?? 120;
            const isColSel = rangeNorm && rangeNorm.c1 <= ci && rangeNorm.c2 >= ci;
            return (
              <div key={col.name} className="relative shrink-0 group/col" style={{ width: w }}>
                <div
                  className={cn("h-full border-r border-border-default/50 px-3 py-1.5 pf-text-xs font-medium text-text-secondary cursor-pointer hover:bg-bg-hover/50 select-none bg-bg-secondary", isColSel && "bg-accent/5")}
                  onClick={() => selectColumn(ci)}>
                  <div className="flex items-center gap-1 overflow-hidden">
                    <span className="shrink-0">{col.name}</span>
                    <span className="text-text-quaternary font-normal truncate" title={col.dataType}>{simplifyType(col.dataType)}</span>
                    {col.isPrimaryKey && <span className="text-amber-500 font-normal shrink-0" title={t("dbClient.primaryKey")}>PK</span>}
                    {onSort && (
                      <button className="ml-auto shrink-0 p-0.5 pf-rounded-sm hover:bg-bg-hover" onClick={e => { e.stopPropagation(); onSort(col.name); }} title={t("dbClient.sortedBy")}>
                        {sorted && sortDir === "ASC" ? <ArrowUp size={10} className="text-accent" /> : sorted && sortDir === "DESC" ? <ArrowDown size={10} className="text-accent" /> : <ArrowUp size={10} className="text-text-quaternary opacity-30" />}
                      </button>
                    )}
                  </div>
                </div>
                {/* 列宽拖拽手柄 */}
                <div
                  className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-10 hover:bg-accent/30 group-hover/col:bg-accent/10 transition-colors"
                  onMouseDown={(e) => onResizeStart(ci, e)}
                />
              </div>
            );
          })}
        </div>

        {/* 虚拟行 */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "max-content" }}>
          {virtualizer.getVirtualItems().map(vr => {
            const ri = vr.index;
            const row = result.rows[ri];
            const isRowSel = selectedRows.has(ri);
            const inCellR = rangeNorm && ri >= rangeNorm.r1 && ri <= rangeNorm.r2;

            return (
              <div key={vr.key} data-index={vr.index} ref={virtualizer.measureElement}
                className={cn("absolute left-0 right-0 flex border-b border-border-default/30", isRowSel ? "bg-accent/5" : !inCellR ? "hover:bg-bg-hover/50" : "")}
                style={{ top: vr.start, height: ROW_HEIGHT }}>

                {/* 序号列（合并了行选择功能） */}
                <div
                  className={cn(
                    "w-12 shrink-0 border-r border-border-default/30 flex items-center justify-center pf-text-xs tabular-nums cursor-pointer select-none",
                    isRowSel ? "text-accent bg-accent/10 font-medium" : inCellR ? "text-accent bg-accent/5" : "text-text-quaternary hover:bg-bg-hover/50 hover:text-text-secondary",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      handleRowClick(ri, e);
                    } else {
                      startRowDrag(ri);
                    }
                  }}
                  onMouseEnter={() => { if (isDragging) extendRowDrag(ri); }}
                >
                  {offset + ri + 1}
                </div>

                {/* 数据单元格 */}
                {row.map((cell, ci) => {
                  const editing = editingCell?.row === ri && editingCell?.col === ci;
                  const edited = isEdited(ri, ci);
                  const w = colWidths[ci] ?? 120;
                  const inR = inRange(ri, ci, cellRange);
                  const bT = inR && rangeNorm && ri === rangeNorm.r1;
                  const bB = inR && rangeNorm && ri === rangeNorm.r2;
                  const bL = inR && rangeNorm && ci === rangeNorm.c1;
                  const bR = inR && rangeNorm && ci === rangeNorm.c2;
                  return (
                    <div key={ci}
                      className={cn(
                        "shrink-0 flex items-center overflow-hidden cursor-default",
                        edited && "bg-amber-500/10",
                        inR && !edited && "bg-accent/8",
                        !inR && "border-r border-border-default/30",
                        !editing && "px-3",
                      )}
                      style={{
                        width: w,
                        borderTop: bT ? "1.5px solid var(--color-accent)" : undefined,
                        borderBottom: bB ? "1.5px solid var(--color-accent)" : undefined,
                        borderLeft: bL ? "1.5px solid var(--color-accent)" : undefined,
                        borderRight: bR ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border-default-30, rgba(128,128,128,0.12))",
                      }}
                      onMouseDown={e => { if (e.button === 0) startDrag(ri, ci, e.shiftKey); }}
                      onMouseEnter={() => { if (isDragging) extendDrag(ri, ci); }}
                      onDoubleClick={() => handleDblClick(ri, ci)}
                      onContextMenu={e => onCtx(e, ri, ci)}>
                      {editing ? (
                        <InlineCellEditor value={cell} column={result.columns[ci]} onSave={v => handleSave(ri, ci, v)} onCancel={() => setEditingCell(null)} t={t} />
                      ) : (
                        <CellValue value={cell} t={t} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 状态栏 */}
      {!hideStatusBar && <div className="flex items-center justify-between border-t border-border-default/50 px-3 py-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="pf-text-xs text-text-tertiary">
            {result.rows.length} {t("dbClient.rows")}
            {result.executionTimeMs != null && ` · ${result.executionTimeMs}ms`}
          </span>
          {rangeNorm && (rangeNorm.r2 - rangeNorm.r1 > 0 || rangeNorm.c2 - rangeNorm.c1 > 0) && (
            <span className="pf-text-xs text-accent">{t("dbClient.selected")}: {rangeNorm.r2 - rangeNorm.r1 + 1}×{rangeNorm.c2 - rangeNorm.c1 + 1}</span>
          )}
          {selectedRows.size > 0 && (
            <span className="pf-text-xs text-accent">{selectedRows.size} {t("dbClient.rowsSelected")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 复制格式下拉 */}
          {!hideCopyFormatDropdown && <div className="relative" ref={formatDropdownRef}>
            <button
              onClick={() => setShowFormatDropdown(!showFormatDropdown)}
              className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary border border-border-default/50"
            >
              <Copy size={10} />
              <span>{COPY_FORMAT_LABELS[copyFormat]}</span>
              <ChevronDown size={10} />
            </button>
            {showFormatDropdown && (
              <div className="absolute bottom-full right-0 mb-1 w-[130px] py-1 bg-bg-elevated border border-border-default rounded-lg shadow-lg z-50">
                {COPY_FORMAT_GROUPS.map((group, gi) => (
                  <div key={group.label}>
                    {gi > 0 && <div className="h-px bg-border-default/50 my-1 mx-2" />}
                    <div className="px-3 py-0.5 pf-text-xs text-text-quaternary font-medium">{group.label}</div>
                    {group.formats.map(fmt => (
                      <button key={fmt}
                        onClick={() => setCopyFormat(fmt)}
                        className={cn("w-full text-left px-3 py-1 pf-text-xs transition-colors", fmt === copyFormat ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-hover")}>
                        {COPY_FORMAT_LABELS[fmt]}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>}
          {showPag && (
            <div className="flex items-center gap-1">
              <PagBtn onClick={() => onPageChange(0)} disabled={offset === 0}><ChevronsLeft size={12} /></PagBtn>
              <PagBtn onClick={() => onPageChange(Math.max(0, offset - sl))} disabled={offset === 0}><ChevronLeft size={12} /></PagBtn>
              <span className="px-2 pf-text-xs text-text-secondary tabular-nums">{curPage} / {totPages}</span>
              <PagBtn onClick={() => onPageChange(offset + sl)} disabled={offset + sl >= totalRows}><ChevronRight size={12} /></PagBtn>
              <PagBtn onClick={() => onPageChange((totPages - 1) * sl)} disabled={offset + sl >= totalRows}><ChevronsRight size={12} /></PagBtn>
            </div>
          )}
        </div>
      </div>}
      {MenuComponent}
    </div>
  );
});

// ── 单元格值 ──
function CellValue({ value, t }: { value: SqlValue; t: (k: string) => string }) {
  if (value.type === "Null") return <span className="italic text-text-quaternary truncate">{t("dbClient.null")}</span>;
  if (value.type === "Bool") return <span className={cn("truncate", value.value ? "text-emerald-600" : "text-text-tertiary")}>{value.value ? "true" : "false"}</span>;
  if (value.type === "Int" || value.type === "Float") return <span className="tabular-nums text-blue-600 truncate">{String(value.value)}</span>;
  if (value.type === "Bytes") return <span className="italic text-text-quaternary truncate">{t("dbClient.binaryValue")}</span>;
  if (value.type === "Json") return <span className="text-amber-600 truncate">{JSON.stringify(value.value)}</span>;
  if (value.type === "Timestamp") return <span className="text-purple-600 tabular-nums truncate">{value.value}</span>;
  if (value.type === "Array") return <span className="text-text-secondary truncate">[{value.value.length} {t("dbClient.items")}]</span>;
  return <span className="text-text-primary truncate">{value.value}</span>;
}

// ── 内联编辑器 ──
function InlineCellEditor({ value, column, onSave, onCancel, t }: { value: SqlValue; column: ColumnInfo; onSave: (v: SqlValue) => void; onCancel: () => void; t: (k: string) => string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value.type === "Null" ? "" : sqlValueDisplay(value));
  const [isNull, setIsNull] = useState(value.type === "Null");
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => {
    if (isNull) { onSave({ type: "Null" }); return; }
    const dt = column.dataType.toLowerCase();
    if (dt.includes("int") || dt.includes("serial")) { const n = parseInt(text, 10); onSave(isNaN(n) ? { type: "Text", value: text } : { type: "Int", value: n }); }
    else if (dt.includes("float") || dt.includes("double") || dt.includes("decimal") || dt.includes("numeric") || dt.includes("real")) { const n = parseFloat(text); onSave(isNaN(n) ? { type: "Text", value: text } : { type: "Float", value: n }); }
    else if (dt.includes("bool")) { onSave({ type: "Bool", value: text === "true" || text === "1" }); }
    else if (dt.includes("json")) { try { onSave({ type: "Json", value: JSON.parse(text) }); } catch { onSave({ type: "Text", value: text }); } }
    else { onSave({ type: "Text", value: text }); }
  };
  return (
    <div className="flex items-center gap-0.5 w-full px-1">
      <input ref={ref} value={isNull ? "" : text} onChange={e => { setText(e.target.value); setIsNull(false); }}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
        onBlur={save} placeholder={isNull ? "NULL" : ""}
        className={cn("flex-1 min-w-0 pf-rounded-sm border border-accent-primary bg-bg-primary px-1.5 py-0.5 pf-text-xs text-text-primary focus:outline-none", isNull && "italic text-text-quaternary")} />
      <button onMouseDown={e => { e.preventDefault(); setIsNull(!isNull); }}
        className={cn("shrink-0 pf-rounded-sm px-1 py-0.5 pf-text-xs", isNull ? "bg-amber-500/20 text-amber-600" : "text-text-quaternary hover:bg-bg-hover")}
        title={t("dbClient.toggleNull")}>N</button>
    </div>
  );
}

function simplifyType(dt: string) { return dt.startsWith("MYSQL_TYPE_") ? dt.replace("MYSQL_TYPE_", "").toLowerCase() : dt; }
function PagBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className={cn("p-1 pf-rounded-sm transition-colors", disabled ? "text-text-quaternary cursor-not-allowed" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary")}>{children}</button>;
}
