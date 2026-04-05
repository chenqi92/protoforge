// 数据网格 — 查询结果 / 表数据展示 + 内联编辑

import { memo, useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Loader2, Save, Undo2, Trash2, Check, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { QueryResult, SqlValue, CellEdit, ColumnInfo } from "@/types/dbclient";
import { sqlValueDisplay } from "@/types/dbclient";

interface DataGridProps {
  result: QueryResult | null;
  loading?: boolean;
  offset?: number;
  limit?: number;
  onPageChange?: (offset: number) => void;
  // 编辑相关
  editable?: boolean;
  pendingEdits?: CellEdit[];
  onCellEdit?: (edit: CellEdit) => void;
  onApplyEdits?: () => void;
  onDiscardEdits?: () => void;
  onDeleteRows?: (pkValues: SqlValue[][]) => void;
  // 表信息（用于编辑）
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

  const pkColIndices = tableMeta?.pkColumns.map((pk) =>
    result.columns.findIndex((c) => c.name === pk)
  ).filter((i) => i >= 0) ?? [];

  const getPkValues = (rowIdx: number): SqlValue[] => {
    const row = result.rows[rowIdx];
    if (!row) return [];
    return pkColIndices.map((ci) => (ci < row.length ? row[ci] : { type: "Null" as const }));
  };

  const isCellEdited = (rowIdx: number, colIdx: number): boolean => {
    if (!tableMeta || pendingEdits.length === 0) return false;
    const colName = result.columns[colIdx].name;
    const pkVals = getPkValues(rowIdx);
    return pendingEdits.some(
      (e) =>
        e.column === colName &&
        e.table === tableMeta.table &&
        JSON.stringify(e.pkValues) === JSON.stringify(pkVals),
    );
  };

  const handleDoubleClick = (rowIdx: number, colIdx: number) => {
    if (!editable || !tableMeta) return;
    const col = result.columns[colIdx];
    if (col.dataType === "bytea" || col.dataType === "BLOB") return;
    setEditingCell({ row: rowIdx, col: colIdx });
  };

  const handleCellSave = (rowIdx: number, colIdx: number, newValue: SqlValue) => {
    if (!tableMeta || !onCellEdit) return;
    const col = result.columns[colIdx];
    onCellEdit({
      database: tableMeta.database,
      schema: tableMeta.schema,
      table: tableMeta.table,
      pkColumns: tableMeta.pkColumns,
      pkValues: getPkValues(rowIdx),
      column: col.name,
      newValue,
    });
    setEditingCell(null);
  };

  const handleDeleteSelected = () => {
    if (!tableMeta || !onDeleteRows || selectedRows.size === 0) return;
    const pkValues = Array.from(selectedRows).map(getPkValues);
    onDeleteRows(pkValues);
    setSelectedRows(new Set());
  };

  const toggleRowSelect = (rowIdx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 编辑工具栏 */}
      {editable && (pendingEdits.length > 0 || selectedRows.size > 0) && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 bg-amber-500/5">
          {pendingEdits.length > 0 && (
            <>
              <span className="pf-text-xs text-amber-600 font-medium">
                {pendingEdits.length} {t("dbClient.pendingChanges")}
              </span>
              <button
                onClick={onApplyEdits}
                className="flex items-center gap-1 pf-rounded-sm bg-emerald-500/15 px-2 py-0.5 pf-text-xs font-medium text-emerald-600 hover:bg-emerald-500/25"
              >
                <Save size={11} />
                {t("dbClient.apply")}
              </button>
              <button
                onClick={onDiscardEdits}
                className="flex items-center gap-1 pf-rounded-sm bg-bg-secondary px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover"
              >
                <Undo2 size={11} />
                {t("dbClient.discard")}
              </button>
            </>
          )}
          {selectedRows.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1 pf-rounded-sm bg-red-500/15 px-2 py-0.5 pf-text-xs font-medium text-red-600 hover:bg-red-500/25 ml-auto"
            >
              <Trash2 size={11} />
              {t("dbClient.deleteSelected", { count: selectedRows.size })}
            </button>
          )}
        </div>
      )}

      {/* 表格 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse pf-text-xs">
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            <tr>
              {editable && (
                <th className="w-8 border-b border-r border-border-default/50 px-1 py-1.5 text-center">
                  {/* 全选 checkbox 预留 */}
                </th>
              )}
              <th className="w-10 border-b border-r border-border-default/50 px-2 py-1.5 text-center font-medium text-text-tertiary">
                #
              </th>
              {result.columns.map((col) => (
                <th
                  key={col.name}
                  className="border-b border-r border-border-default/50 px-3 py-1.5 text-left font-medium text-text-secondary whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    <span>{col.name}</span>
                    <span className="text-text-quaternary font-normal">{col.dataType}</span>
                    {col.isPrimaryKey && (
                      <span className="text-amber-500 font-normal" title={t("dbClient.primaryKey")}>PK</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={cn(
                  "border-b border-border-default/30 transition-colors",
                  selectedRows.has(rowIdx)
                    ? "bg-accent-primary/5"
                    : "hover:bg-bg-hover/50",
                )}
              >
                {editable && (
                  <td className="border-r border-border-default/30 px-1 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(rowIdx)}
                      onChange={() => toggleRowSelect(rowIdx)}
                      className="h-3 w-3 rounded border-border-default"
                    />
                  </td>
                )}
                <td className="border-r border-border-default/30 px-2 py-1 text-center text-text-quaternary tabular-nums">
                  {offset + rowIdx + 1}
                </td>
                {row.map((cell, colIdx) => {
                  const isEditing =
                    editingCell?.row === rowIdx && editingCell?.col === colIdx;
                  const isEdited = isCellEdited(rowIdx, colIdx);

                  return (
                    <td
                      key={colIdx}
                      className={cn(
                        "border-r border-border-default/30 max-w-[300px]",
                        isEdited && "bg-amber-500/10",
                        !isEditing && "px-3 py-1 truncate",
                      )}
                      onDoubleClick={() => handleDoubleClick(rowIdx, colIdx)}
                    >
                      {isEditing ? (
                        <InlineCellEditor
                          value={cell}
                          column={result.columns[colIdx]}
                          onSave={(newVal) => handleCellSave(rowIdx, colIdx, newVal)}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : (
                        <CellRenderer value={cell} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 + 状态栏 */}
      <div className="flex items-center justify-between border-t border-border-default/50 px-3 py-1">
        <span className="pf-text-xs text-text-tertiary">
          {result.rows.length} {t("dbClient.rows")}
          {result.executionTimeMs != null && ` · ${result.executionTimeMs}ms`}
          {result.warnings.length > 0 && ` · ${result.warnings.length} ${t("dbClient.warnings")}`}
        </span>

        {showPagination && (
          <div className="flex items-center gap-1">
            <PagBtn onClick={() => onPageChange(0)} disabled={offset === 0}>
              <ChevronsLeft size={12} />
            </PagBtn>
            <PagBtn onClick={() => onPageChange(Math.max(0, offset - limit))} disabled={offset === 0}>
              <ChevronLeft size={12} />
            </PagBtn>
            <span className="px-2 pf-text-xs text-text-secondary tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <PagBtn onClick={() => onPageChange(offset + limit)} disabled={offset + limit >= totalRows}>
              <ChevronRight size={12} />
            </PagBtn>
            <PagBtn onClick={() => onPageChange((totalPages - 1) * limit)} disabled={offset + limit >= totalRows}>
              <ChevronsRight size={12} />
            </PagBtn>
          </div>
        )}
      </div>
    </div>
  );
});

// ── 内联单元格编辑器 ──

function InlineCellEditor({
  value,
  column,
  onSave,
  onCancel,
}: {
  value: SqlValue;
  column: ColumnInfo;
  onSave: (newValue: SqlValue) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value.type === "Null" ? "" : sqlValueDisplay(value));
  const [isNull, setIsNull] = useState(value.type === "Null");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    if (isNull) {
      onSave({ type: "Null" });
      return;
    }
    // 根据列类型构造 SqlValue
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
      try {
        onSave({ type: "Json", value: JSON.parse(text) });
      } catch {
        onSave({ type: "Text", value: text });
      }
    } else {
      onSave({ type: "Text", value: text });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-0.5 py-0.5 px-1">
      <input
        ref={inputRef}
        value={isNull ? "" : text}
        onChange={(e) => { setText(e.target.value); setIsNull(false); }}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        placeholder={isNull ? "NULL" : ""}
        className={cn(
          "flex-1 min-w-[60px] pf-rounded-sm border border-accent-primary bg-bg-primary px-1.5 py-0.5 pf-text-xs text-text-primary focus:outline-none",
          isNull && "italic text-text-quaternary",
        )}
      />
      <button
        onMouseDown={(e) => { e.preventDefault(); setIsNull(!isNull); }}
        className={cn(
          "shrink-0 pf-rounded-sm px-1 py-0.5 pf-text-xs",
          isNull ? "bg-amber-500/20 text-amber-600" : "text-text-quaternary hover:bg-bg-hover",
        )}
        title={t("dbClient.toggleNull")}
      >
        N
      </button>
    </div>
  );
}

// ── 单元格渲染 ──

function CellRenderer({ value }: { value: SqlValue }) {
  const { t } = useTranslation();
  if (value.type === "Null") {
    return <span className="italic text-text-quaternary">{t("dbClient.null")}</span>;
  }
  if (value.type === "Bool") {
    return (
      <span className={value.value ? "text-emerald-600" : "text-text-tertiary"}>
        {value.value ? "true" : "false"}
      </span>
    );
  }
  if (value.type === "Int" || value.type === "Float") {
    return <span className="tabular-nums text-blue-600">{String(value.value)}</span>;
  }
  if (value.type === "Bytes") {
    return <span className="italic text-text-quaternary">{t("dbClient.binaryValue")}</span>;
  }
  if (value.type === "Json") {
    return <span className="text-amber-600">{JSON.stringify(value.value)}</span>;
  }
  if (value.type === "Timestamp") {
    return <span className="text-purple-600 tabular-nums">{value.value}</span>;
  }
  if (value.type === "Array") {
    return <span className="text-text-secondary">[{value.value.length} {t("dbClient.items")}]</span>;
  }
  return <span className="text-text-primary">{value.value}</span>;
}

// ── 分页按钮 ──

function PagBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-1 pf-rounded-sm transition-colors",
        disabled
          ? "text-text-quaternary cursor-not-allowed"
          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
