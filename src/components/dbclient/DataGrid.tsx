// 数据网格 — 虚拟滚动 + 内联编辑
// 使用 @tanstack/react-virtual 行虚拟化，仅渲染可视区域 DOM

import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Loader2, Save, Undo2, Trash2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { QueryResult, SqlValue, CellEdit, ColumnInfo } from "@/types/dbclient";
import { sqlValueDisplay } from "@/types/dbclient";

const ROW_HEIGHT = 28; // px per row

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
}

export const DataGrid = memo(function DataGrid({
  result,
  loading = false,
  offset = 0,
  limit = 200,
  onPageChange,
  editable = false,
  pendingEdits = [],
  onCellEdit,
  onApplyEdits,
  onDiscardEdits,
  onDeleteRows,
  tableMeta,
}: DataGridProps) {
  const { t } = useTranslation();
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const lastClickedRowRef = useRef<number | null>(null); // Shift+Click 锚点
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 虚拟化 — overscan 30 行保证快速滚动不白屏
  const rowCount = result?.rows.length ?? 0;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  // 主键列索引（缓存）
  const pkColIndices = useMemo(() =>
    tableMeta?.pkColumns.map((pk) =>
      result?.columns.findIndex((c) => c.name === pk) ?? -1
    ).filter((i) => i >= 0) ?? [],
    [tableMeta?.pkColumns, result?.columns]
  );

  const getPkValues = useCallback((rowIdx: number): SqlValue[] => {
    const row = result?.rows[rowIdx];
    if (!row) return [];
    return pkColIndices.map((ci) => (ci < row.length ? row[ci] : { type: "Null" as const }));
  }, [result, pkColIndices]);

  // 编辑判断（缓存 set）
  const editedCellKeys = useMemo(() => {
    if (!tableMeta || pendingEdits.length === 0) return new Set<string>();
    const keys = new Set<string>();
    for (const e of pendingEdits) {
      if (e.table === tableMeta.table) {
        keys.add(`${JSON.stringify(e.pkValues)}:${e.column}`);
      }
    }
    return keys;
  }, [pendingEdits, tableMeta]);

  const isCellEdited = useCallback((rowIdx: number, colIdx: number): boolean => {
    if (editedCellKeys.size === 0 || !result) return false;
    const colName = result.columns[colIdx].name;
    const pkVals = getPkValues(rowIdx);
    return editedCellKeys.has(`${JSON.stringify(pkVals)}:${colName}`);
  }, [editedCellKeys, result, getPkValues]);

  const handleDoubleClick = useCallback((rowIdx: number, colIdx: number) => {
    if (!editable || !tableMeta || !result) return;
    const col = result.columns[colIdx];
    if (col.dataType === "bytea" || col.dataType === "BLOB") return;
    setEditingCell({ row: rowIdx, col: colIdx });
  }, [editable, tableMeta, result]);

  const handleCellSave = useCallback((rowIdx: number, colIdx: number, newValue: SqlValue) => {
    if (!tableMeta || !onCellEdit || !result) return;
    onCellEdit({
      database: tableMeta.database,
      schema: tableMeta.schema,
      table: tableMeta.table,
      pkColumns: tableMeta.pkColumns,
      pkValues: getPkValues(rowIdx),
      column: result.columns[colIdx].name,
      newValue,
    });
    setEditingCell(null);
  }, [tableMeta, onCellEdit, result, getPkValues]);

  const handleDeleteSelected = useCallback(() => {
    if (!tableMeta || !onDeleteRows || selectedRows.size === 0) return;
    const pkValues = Array.from(selectedRows).map(getPkValues);
    onDeleteRows(pkValues);
    setSelectedRows(new Set());
  }, [tableMeta, onDeleteRows, selectedRows, getPkValues]);

  // 行选择：支持 Click 单选、Shift+Click 范围选、全选/全不选
  const handleRowSelect = useCallback((rowIdx: number, shiftKey: boolean) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedRowRef.current != null) {
        // Shift+Click: 选中从锚点到当前行的连续范围
        const from = Math.min(lastClickedRowRef.current, rowIdx);
        const to = Math.max(lastClickedRowRef.current, rowIdx);
        for (let i = from; i <= to; i++) next.add(i);
      } else {
        // 普通 Click: 切换单行
        if (next.has(rowIdx)) next.delete(rowIdx);
        else next.add(rowIdx);
      }
      return next;
    });
    lastClickedRowRef.current = rowIdx;
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === rowCount) {
        // 已全选 → 全不选
        return new Set();
      }
      // 全选
      const all = new Set<number>();
      for (let i = 0; i < rowCount; i++) all.add(i);
      return all;
    });
  }, [rowCount]);

  // ── 空状态 ──

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center pf-text-xs text-text-tertiary">
        {t("dbClient.noData")}
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center pf-text-xs text-text-tertiary">
        {result.affectedRows != null
          ? `${result.affectedRows} ${t("dbClient.rowsAffected")}`
          : t("dbClient.queryComplete")}
      </div>
    );
  }

  const totalRows = result.totalRows ?? result.rows.length;
  const safeLimit = limit > 0 ? limit : 200;
  const currentPage = Math.floor(offset / safeLimit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalRows / safeLimit));
  const showPagination = onPageChange && totalRows > safeLimit;
  const colCount = result.columns.length;

  return (
    <div className="flex h-full flex-col">
      {/* 编辑工具栏 */}
      {editable && (pendingEdits.length > 0 || selectedRows.size > 0) && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 bg-amber-500/5 shrink-0">
          {pendingEdits.length > 0 && (
            <>
              <span className="pf-text-xs text-amber-600 font-medium">
                {pendingEdits.length} {t("dbClient.pendingChanges")}
              </span>
              <button onClick={onApplyEdits} className="flex items-center gap-1 pf-rounded-sm bg-emerald-500/15 px-2 py-0.5 pf-text-xs font-medium text-emerald-600 hover:bg-emerald-500/25">
                <Save size={11} />{t("dbClient.apply")}
              </button>
              <button onClick={onDiscardEdits} className="flex items-center gap-1 pf-rounded-sm bg-bg-secondary px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover">
                <Undo2 size={11} />{t("dbClient.discard")}
              </button>
            </>
          )}
          {selectedRows.size > 0 && (
            <button onClick={handleDeleteSelected} className="flex items-center gap-1 pf-rounded-sm bg-red-500/15 px-2 py-0.5 pf-text-xs font-medium text-red-600 hover:bg-red-500/25 ml-auto">
              <Trash2 size={11} />{t("dbClient.deleteSelected", { count: selectedRows.size })}
            </button>
          )}
        </div>
      )}

      {/* 虚拟滚动表格 */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto">
        {/* 固定表头 */}
        <div className="sticky top-0 z-10 flex bg-bg-secondary border-b border-border-default/50" style={{ minWidth: "max-content" }}>
          {editable && (
            <div className="w-8 shrink-0 border-r border-border-default/50 flex items-center justify-center">
              <input
                type="checkbox"
                checked={rowCount > 0 && selectedRows.size === rowCount}
                ref={(el) => { if (el) el.indeterminate = selectedRows.size > 0 && selectedRows.size < rowCount; }}
                onChange={handleSelectAll}
                className="h-3 w-3 rounded border-border-default"
                title={t("dbClient.selectAll")}
              />
            </div>
          )}
          <div className="w-12 shrink-0 border-r border-border-default/50 px-2 py-1.5 text-center pf-text-xs font-medium text-text-tertiary">
            #
          </div>
          {result.columns.map((col) => (
            <div
              key={col.name}
              className="shrink-0 border-r border-border-default/50 px-3 py-1.5 pf-text-xs font-medium text-text-secondary whitespace-nowrap"
              style={{ minWidth: 100, maxWidth: 300 }}
            >
              <div className="flex items-center gap-1">
                <span>{col.name}</span>
                <span className="text-text-quaternary font-normal">{col.dataType}</span>
                {col.isPrimaryKey && <span className="text-amber-500 font-normal" title={t("dbClient.primaryKey")}>PK</span>}
              </div>
            </div>
          ))}
        </div>

        {/* 虚拟行 */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", minWidth: "max-content" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowIdx = virtualRow.index;
            const row = result.rows[rowIdx];
            const isSelected = selectedRows.has(rowIdx);

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(
                  "absolute left-0 right-0 flex border-b border-border-default/30",
                  isSelected ? "bg-accent-primary/5" : "hover:bg-bg-hover/50",
                )}
                style={{ top: virtualRow.start, height: ROW_HEIGHT }}
              >
                {editable && (
                  <div className="w-8 shrink-0 border-r border-border-default/30 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => handleRowSelect(rowIdx, (e.nativeEvent as MouseEvent).shiftKey)}
                      className="h-3 w-3 rounded border-border-default"
                    />
                  </div>
                )}
                <div className="w-12 shrink-0 border-r border-border-default/30 flex items-center justify-center pf-text-xs text-text-quaternary tabular-nums">
                  {offset + rowIdx + 1}
                </div>
                {row.map((cell, colIdx) => {
                  const isEditing = editingCell?.row === rowIdx && editingCell?.col === colIdx;
                  const isEdited = isCellEdited(rowIdx, colIdx);
                  return (
                    <div
                      key={colIdx}
                      className={cn(
                        "shrink-0 border-r border-border-default/30 flex items-center overflow-hidden",
                        isEdited && "bg-amber-500/10",
                        !isEditing && "px-3",
                      )}
                      style={{ minWidth: 100, maxWidth: 300 }}
                      onDoubleClick={() => handleDoubleClick(rowIdx, colIdx)}
                    >
                      {isEditing ? (
                        <InlineCellEditor
                          value={cell}
                          column={result.columns[colIdx]}
                          onSave={(newVal) => handleCellSave(rowIdx, colIdx, newVal)}
                          onCancel={() => setEditingCell(null)}
                          t={t}
                        />
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

      {/* 分页 + 状态栏 */}
      <div className="flex items-center justify-between border-t border-border-default/50 px-3 py-1 shrink-0">
        <span className="pf-text-xs text-text-tertiary">
          {result.rows.length} {t("dbClient.rows")}
          {result.executionTimeMs != null && ` · ${result.executionTimeMs}ms`}
          {result.warnings.length > 0 && ` · ${result.warnings.length} ${t("dbClient.warnings")}`}
        </span>
        {showPagination && (
          <div className="flex items-center gap-1">
            <PagBtn onClick={() => onPageChange(0)} disabled={offset === 0}><ChevronsLeft size={12} /></PagBtn>
            <PagBtn onClick={() => onPageChange(Math.max(0, offset - safeLimit))} disabled={offset === 0}><ChevronLeft size={12} /></PagBtn>
            <span className="px-2 pf-text-xs text-text-secondary tabular-nums">{currentPage} / {totalPages}</span>
            <PagBtn onClick={() => onPageChange(offset + safeLimit)} disabled={offset + safeLimit >= totalRows}><ChevronRight size={12} /></PagBtn>
            <PagBtn onClick={() => onPageChange((totalPages - 1) * safeLimit)} disabled={offset + safeLimit >= totalRows}><ChevronsRight size={12} /></PagBtn>
          </div>
        )}
      </div>
    </div>
  );
});

// ── 单元格值渲染（纯函数，不调 hooks）──

function CellValue({ value, t }: { value: SqlValue; t: (key: string) => string }) {
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

function InlineCellEditor({
  value, column, onSave, onCancel, t,
}: {
  value: SqlValue;
  column: ColumnInfo;
  onSave: (newValue: SqlValue) => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value.type === "Null" ? "" : sqlValueDisplay(value));
  const [isNull, setIsNull] = useState(value.type === "Null");

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const handleSave = () => {
    if (isNull) { onSave({ type: "Null" }); return; }
    const dt = column.dataType.toLowerCase();
    if (dt.includes("int") || dt.includes("serial")) {
      const n = parseInt(text, 10);
      onSave(isNaN(n) ? { type: "Text", value: text } : { type: "Int", value: n });
    } else if (dt.includes("float") || dt.includes("double") || dt.includes("decimal") || dt.includes("numeric") || dt.includes("real")) {
      const n = parseFloat(text);
      onSave(isNaN(n) ? { type: "Text", value: text } : { type: "Float", value: n });
    } else if (dt.includes("bool")) {
      onSave({ type: "Bool", value: text === "true" || text === "1" });
    } else if (dt.includes("json")) {
      try { onSave({ type: "Json", value: JSON.parse(text) }); } catch { onSave({ type: "Text", value: text }); }
    } else {
      onSave({ type: "Text", value: text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <div className="flex items-center gap-0.5 w-full px-1">
      <input
        ref={inputRef}
        value={isNull ? "" : text}
        onChange={(e) => { setText(e.target.value); setIsNull(false); }}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        placeholder={isNull ? "NULL" : ""}
        className={cn(
          "flex-1 min-w-0 pf-rounded-sm border border-accent-primary bg-bg-primary px-1.5 py-0.5 pf-text-xs text-text-primary focus:outline-none",
          isNull && "italic text-text-quaternary",
        )}
      />
      <button
        onMouseDown={(e) => { e.preventDefault(); setIsNull(!isNull); }}
        className={cn("shrink-0 pf-rounded-sm px-1 py-0.5 pf-text-xs", isNull ? "bg-amber-500/20 text-amber-600" : "text-text-quaternary hover:bg-bg-hover")}
        title={t("dbClient.toggleNull")}
      >N</button>
    </div>
  );
}

// ── 分页按钮 ──

function PagBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn("p-1 pf-rounded-sm transition-colors", disabled ? "text-text-quaternary cursor-not-allowed" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary")}>
      {children}
    </button>
  );
}
