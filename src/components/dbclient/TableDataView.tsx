// 表数据视图 — 用于 TableDataTab 的独立面板
// 第一行：分页(左) | DDL + 复制格式(右)
// 第二行：WHERE + ORDER BY

import { memo, useCallback, useState, useRef, useEffect } from "react";
import {
  Filter, RefreshCw, Loader2, X, ArrowUpDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Code2, Copy, ChevronDown, Pencil, Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { getDbClientStoreApi } from "@/stores/dbClientStore";
import type { TableDataTab } from "@/stores/dbClientStore";
import type { CellEdit, SqlValue } from "@/types/dbclient";
import { DataGrid, type CopyFormat, COPY_FORMAT_LABELS, COPY_FORMAT_GROUPS, getSavedCopyFormat, saveCopyFormat } from "./DataGrid";
import { CellDetailDialog } from "./CellDetailDialog";
import { getTableDdlQuery } from "@/lib/sqlDialect";

const PAGE_SIZES = [1000, 2000, 5000, 0]; // 0 = All (no LIMIT)

export const TableDataView = memo(function TableDataView({
  sessionId, tab,
}: { sessionId: string; tab: TableDataTab }) {
  const { t } = useTranslation();
  const store = getDbClientStoreApi(sessionId);

  const [filterInput, setFilterInput] = useState(tab.filter);
  const [orderByInput, setOrderByInput] = useState(
    tab.sortColumn ? `${tab.sortColumn} ${tab.sortDir ?? "ASC"}` : ""
  );

  // 复制格式
  const [copyFormat, setCopyFormatState] = useState<CopyFormat>(getSavedCopyFormat);
  const [showFmtDrop, setShowFmtDrop] = useState(false);
  const fmtRef = useRef<HTMLDivElement>(null);
  const setCopyFmt = useCallback((f: CopyFormat) => { setCopyFormatState(f); saveCopyFormat(f); setShowFmtDrop(false); }, []);
  useEffect(() => {
    if (!showFmtDrop) return;
    const h = (e: MouseEvent) => { if (fmtRef.current && !fmtRef.current.contains(e.target as Node)) setShowFmtDrop(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showFmtDrop]);

  // 每页条数下拉
  const [showPageSize, setShowPageSize] = useState(false);
  const pageSizeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPageSize) return;
    const h = (e: MouseEvent) => { if (pageSizeRef.current && !pageSizeRef.current.contains(e.target as Node)) setShowPageSize(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPageSize]);

  const handleApplyAll = useCallback(() => {
    const orderTrim = orderByInput.trim();
    if (orderTrim) {
      const parts = orderTrim.split(/\s+/);
      const col = parts[0];
      const dir = parts[1]?.toUpperCase() === "DESC" ? "DESC" : "ASC";
      store.getState().setTableSort(tab.id, col);
      const s = store.getState().tabs.find(t => t.id === tab.id);
      if (s?.kind === "table" && s.sortDir !== dir && s.sortColumn === col) store.getState().setTableSort(tab.id, col);
    }
    store.getState().setTableFilter(tab.id, filterInput);
  }, [store, tab.id, filterInput, orderByInput]);

  const handleClearFilter = useCallback(() => { setFilterInput(""); store.getState().setTableFilter(tab.id, ""); }, [store, tab.id]);
  const handleClearOrder = useCallback(() => {
    setOrderByInput("");
    if (tab.sortColumn) { store.getState().setTableSort(tab.id, tab.sortColumn); const s = store.getState().tabs.find(t => t.id === tab.id); if (s?.kind === "table" && s.sortColumn) store.getState().setTableSort(tab.id, s.sortColumn); }
  }, [store, tab.id, tab.sortColumn]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleApplyAll(); } }, [handleApplyAll]);

  const handleSort = useCallback((column: string) => {
    store.getState().setTableSort(tab.id, column);
    const s = store.getState().tabs.find(t => t.id === tab.id);
    setOrderByInput(s?.kind === "table" && s.sortColumn ? `${s.sortColumn} ${s.sortDir ?? "ASC"}` : "");
  }, [store, tab.id]);

  const handlePageChange = useCallback((offset: number) => { store.getState().setTableDataPage(tab.id, offset); }, [store, tab.id]);
  const handleRefresh = useCallback(() => { store.getState().refreshTableTab(tab.id); }, [store, tab.id]);
  const handlePageSizeChange = useCallback((size: number) => { store.getState().setTablePageSize(tab.id, size); setShowPageSize(false); }, [store, tab.id]);

  const handleShowDdl = useCallback(() => {
    const config = store.getState().connectionConfig;
    if (!config) return;
    store.getState().addQueryTab(`DDL: ${tab.table}`, getTableDdlQuery(config.dbType, tab.schema, tab.table));
    store.getState().executeQuery(tab.database);
  }, [store, tab.schema, tab.table, tab.database]);

  const handleEditStructure = useCallback(() => {
    store.getState().openTableStructure(tab.schema, tab.table);
  }, [store, tab.schema, tab.table]);

  // 选中单元格（用于工具栏查看按钮）
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [showCellDetail, setShowCellDetail] = useState(false);

  const handleCellSelect = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col });
  }, []);

  const handleCellEdit = useCallback((edit: CellEdit) => { store.getState().addPendingEdit(edit, tab.id); }, [store, tab.id]);
  const handleApplyEdits = useCallback(() => { store.getState().applyEdits(tab.id); }, [store, tab.id]);
  const handleDiscardEdits = useCallback(() => { store.getState().clearPendingEdits(tab.id); }, [store, tab.id]);
  const handleDeleteRows = useCallback((pkValues: SqlValue[][]) => { store.getState().deleteRows(pkValues, tab.id); }, [store, tab.id]);

  const dbType = store.getState().connectionConfig?.dbType ?? null;
  const tableMeta = { database: tab.database, schema: tab.schema, table: tab.table, pkColumns: tab.tablePrimaryKeys, dbType };
  const totalRows = tab.tableData?.totalRows ?? tab.tableData?.rows.length ?? 0;
  const pl = tab.tableDataLimit;
  const curPage = Math.floor(tab.tableDataOffset / pl) + 1;
  const totPages = Math.max(1, Math.ceil(totalRows / pl));
  const showPag = totalRows > pl;

  return (
    <div className="flex h-full flex-col">
      {/* ═══ 第一行：分页(左) | 操作(右) ═══ */}
      <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1 shrink-0">
        {/* 左：刷新 + 分页 */}
        <button onClick={handleRefresh} disabled={tab.tableDataLoading}
          className="p-1 text-text-tertiary hover:text-text-primary pf-rounded-sm hover:bg-bg-hover disabled:opacity-40" title={t("dbClient.refresh")}>
          <RefreshCw size={13} className={tab.tableDataLoading ? "animate-spin" : ""} />
        </button>

        {showPag && (
          <div className="flex items-center gap-0.5">
            <PgBtn onClick={() => handlePageChange(0)} disabled={tab.tableDataOffset === 0}><ChevronsLeft size={12} /></PgBtn>
            <PgBtn onClick={() => handlePageChange(Math.max(0, tab.tableDataOffset - pl))} disabled={tab.tableDataOffset === 0}><ChevronLeft size={12} /></PgBtn>
            <span className="px-1.5 pf-text-xs text-text-secondary tabular-nums">{curPage} / {totPages}</span>
            <PgBtn onClick={() => handlePageChange(tab.tableDataOffset + pl)} disabled={tab.tableDataOffset + pl >= totalRows}><ChevronRight size={12} /></PgBtn>
            <PgBtn onClick={() => handlePageChange((totPages - 1) * pl)} disabled={tab.tableDataOffset + pl >= totalRows}><ChevronsRight size={12} /></PgBtn>
          </div>
        )}

        {/* 每页条数 */}
        <div className="relative" ref={pageSizeRef}>
          <button onClick={() => setShowPageSize(!showPageSize)}
            className="flex items-center gap-1 pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover border border-border-default/40">
            <span>{pl === 0 ? "All" : pl}</span><span className="text-text-quaternary">/{t("dbClient.page")}</span><ChevronDown size={9} />
          </button>
          {showPageSize && (
            <div className="absolute top-full left-0 mt-1 w-[80px] py-1 bg-bg-elevated border border-border-default rounded-lg shadow-lg z-50">
              {PAGE_SIZES.map(s => (
                <button key={s} onClick={() => handlePageSizeChange(s)}
                  className={cn("w-full text-left px-3 py-1 pf-text-xs", s === pl ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-hover")}>
                  {s === 0 ? "All" : s}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="pf-text-xs text-text-quaternary">{totalRows} {t("dbClient.rows")}</span>

        {/* 右：DDL + 复制格式 */}
        <div className="flex-1" />

        <button onClick={handleEditStructure}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary">
          <Pencil size={12} /><span>{t("dbClient.editStructure")}</span>
        </button>

        <button
          onClick={() => { if (selectedCell) setShowCellDetail(true); }}
          disabled={!selectedCell}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          title={t("dbClient.viewCellDetail")}
        >
          <Maximize2 size={12} /><span>{t("dbClient.viewCellDetail")}</span>
        </button>

        <button onClick={handleShowDdl}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={t("dbClient.showDDL")}>
          <Code2 size={12} /><span>DDL</span>
        </button>

        <div className="relative" ref={fmtRef}>
          <button onClick={() => setShowFmtDrop(!showFmtDrop)}
            className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary border border-border-default/40">
            <Copy size={10} /><span>{COPY_FORMAT_LABELS[copyFormat]}</span><ChevronDown size={9} />
          </button>
          {showFmtDrop && (
            <div className="absolute top-full right-0 mt-1 w-[130px] py-1 bg-bg-elevated border border-border-default rounded-lg shadow-lg z-50">
              {COPY_FORMAT_GROUPS.map((g, gi) => (
                <div key={g.label}>
                  {gi > 0 && <div className="h-px bg-border-default/50 my-1 mx-2" />}
                  <div className="px-3 py-0.5 pf-text-xs text-text-quaternary font-medium">{g.label}</div>
                  {g.formats.map(f => (
                    <button key={f} onClick={() => setCopyFmt(f)}
                      className={cn("w-full text-left px-3 py-1 pf-text-xs", f === copyFormat ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-hover")}>
                      {COPY_FORMAT_LABELS[f]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ 第二行：WHERE + ORDER BY ═══ */}
      <div className="flex items-center gap-1.5 border-b border-border-default/50 px-3 py-1 shrink-0">
        <Filter size={11} className="text-text-tertiary shrink-0" />
        <span className="pf-text-xs text-text-tertiary shrink-0 font-mono">WHERE</span>
        <input value={filterInput} onChange={e => setFilterInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={t("dbClient.filterPlaceholder")}
          className="min-w-[100px] flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
        {filterInput && <button onClick={handleClearFilter} className="p-0.5 text-text-tertiary hover:text-text-primary"><X size={10} /></button>}

        <span className="text-border-default/50 shrink-0">|</span>

        <ArrowUpDown size={11} className="text-text-tertiary shrink-0" />
        <span className="pf-text-xs text-text-tertiary shrink-0 font-mono">ORDER BY</span>
        <input value={orderByInput} onChange={e => setOrderByInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="col ASC"
          className="w-[130px] pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
        {orderByInput && <button onClick={handleClearOrder} className="p-0.5 text-text-tertiary hover:text-text-primary"><X size={10} /></button>}

        <button onClick={handleApplyAll} disabled={tab.tableDataLoading}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 shrink-0">
          {tab.tableDataLoading && <Loader2 size={10} className="animate-spin" />}
          {t("dbClient.apply")}
        </button>
      </div>

      {/* ═══ 数据网格 ═══ */}
      <div className="flex-1 min-h-0">
        <DataGrid result={tab.tableData} loading={tab.tableDataLoading}
          offset={tab.tableDataOffset} limit={tab.tableDataLimit} onPageChange={handlePageChange}
          editable={tableMeta.pkColumns.length > 0} tableMeta={tableMeta}
          pendingEdits={tab.pendingEdits} onCellEdit={handleCellEdit}
          onApplyEdits={handleApplyEdits} onDiscardEdits={handleDiscardEdits} onDeleteRows={handleDeleteRows}
          sortColumn={tab.sortColumn} sortDir={tab.sortDir} onSort={handleSort}
          copyFormatOverride={copyFormat}
          onCellSelect={handleCellSelect}
          hideCopyFormatDropdown hideStatusBar />
      </div>

      {/* 单元格详情弹框 */}
      {showCellDetail && selectedCell && tab.tableData && tab.tableData.rows[selectedCell.row] && (
        <CellDetailDialog
          value={tab.tableData.rows[selectedCell.row][selectedCell.col]}
          column={tab.tableData.columns[selectedCell.col]}
          rowIndex={tab.tableDataOffset + selectedCell.row}
          onClose={() => setShowCellDetail(false)}
        />
      )}
    </div>
  );
});

function PgBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} className={cn("p-0.5 pf-rounded-sm transition-colors", disabled ? "text-text-quaternary cursor-not-allowed" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary")}>{children}</button>;
}
