// 表数据视图 — 用于 TableDataTab 的独立面板
// 包含 filter 工具栏 + DataGrid（支持排序、分页、编辑）

import { memo, useCallback, useState, useRef } from "react";
import {
  Filter, RefreshCw, Loader2, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDbClientStoreApi } from "@/stores/dbClientStore";
import type { TableDataTab } from "@/stores/dbClientStore";
import type { CellEdit, SqlValue } from "@/types/dbclient";
import { DataGrid } from "./DataGrid";

interface TableDataViewProps {
  sessionId: string;
  tab: TableDataTab;
}

export const TableDataView = memo(function TableDataView({
  sessionId,
  tab,
}: TableDataViewProps) {
  const { t } = useTranslation();
  const [filterInput, setFilterInput] = useState(tab.filter);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleApplyFilter = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().setTableFilter(tab.id, filterInput);
  }, [sessionId, tab.id, filterInput]);

  const handleClearFilter = useCallback(() => {
    setFilterInput("");
    getDbClientStoreApi(sessionId).getState().setTableFilter(tab.id, "");
  }, [sessionId, tab.id]);

  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApplyFilter();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleClearFilter();
    }
  }, [handleApplyFilter, handleClearFilter]);

  const handleSort = useCallback((column: string) => {
    getDbClientStoreApi(sessionId).getState().setTableSort(tab.id, column);
  }, [sessionId, tab.id]);

  const handlePageChange = useCallback((offset: number) => {
    getDbClientStoreApi(sessionId).getState().setTableDataPage(tab.id, offset);
  }, [sessionId, tab.id]);

  const handleRefresh = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().refreshTableTab(tab.id);
  }, [sessionId, tab.id]);

  const handleCellEdit = useCallback((edit: CellEdit) => {
    getDbClientStoreApi(sessionId).getState().addPendingEdit(edit, tab.id);
  }, [sessionId, tab.id]);

  const handleApplyEdits = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().applyEdits(tab.id);
  }, [sessionId, tab.id]);

  const handleDiscardEdits = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().clearPendingEdits(tab.id);
  }, [sessionId, tab.id]);

  const handleDeleteRows = useCallback((pkValues: SqlValue[][]) => {
    getDbClientStoreApi(sessionId).getState().deleteRows(pkValues, tab.id);
  }, [sessionId, tab.id]);

  const tableMeta = {
    database: tab.database,
    schema: tab.schema,
    table: tab.table,
    pkColumns: tab.tablePrimaryKeys,
  };

  return (
    <div className="flex h-full flex-col">
      {/* Filter 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 shrink-0">
        <Filter size={12} className="text-text-tertiary shrink-0" />
        <span className="pf-text-xs text-text-tertiary shrink-0">WHERE</span>
        <input
          ref={inputRef}
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          onKeyDown={handleFilterKeyDown}
          placeholder={t("dbClient.filterPlaceholder")}
          className="flex-1 min-w-0 pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-1 pf-text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
        />
        {filterInput && (
          <button
            onClick={handleClearFilter}
            className="p-1 text-text-tertiary hover:text-text-primary pf-rounded-sm hover:bg-bg-hover"
          >
            <X size={12} />
          </button>
        )}
        <button
          onClick={handleApplyFilter}
          disabled={tab.tableDataLoading}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-1 pf-text-xs bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          {tab.tableDataLoading ? <Loader2 size={11} className="animate-spin" /> : null}
          {t("dbClient.apply")}
        </button>
        <button
          onClick={handleRefresh}
          disabled={tab.tableDataLoading}
          className="p-1 text-text-tertiary hover:text-text-primary pf-rounded-sm hover:bg-bg-hover disabled:opacity-40"
          title={t("dbClient.refresh")}
        >
          <RefreshCw size={12} className={tab.tableDataLoading ? "animate-spin" : ""} />
        </button>

        {/* 排序指示 */}
        {tab.sortColumn && (
          <div className="flex items-center gap-1 pf-text-xs text-text-tertiary shrink-0">
            <span className="text-text-quaternary">|</span>
            <span>{t("dbClient.sortedBy")}</span>
            <span className="font-mono text-accent">{tab.sortColumn}</span>
            <span>{tab.sortDir}</span>
          </div>
        )}
      </div>

      {/* 数据网格 */}
      <div className="flex-1 min-h-0">
        <DataGrid
          result={tab.tableData}
          loading={tab.tableDataLoading}
          offset={tab.tableDataOffset}
          limit={tab.tableDataLimit}
          onPageChange={handlePageChange}
          editable={tableMeta.pkColumns.length > 0}
          tableMeta={tableMeta}
          pendingEdits={tab.pendingEdits}
          onCellEdit={handleCellEdit}
          onApplyEdits={handleApplyEdits}
          onDiscardEdits={handleDiscardEdits}
          onDeleteRows={handleDeleteRows}
          sortColumn={tab.sortColumn}
          sortDir={tab.sortDir}
          onSort={handleSort}
        />
      </div>
    </div>
  );
});
