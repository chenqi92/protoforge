// 数据库客户端工作区 — 三栏布局：连接侧栏 | Schema 浏览 + SQL 编辑器 + 结果网格

import { memo, useCallback, useState } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Table2, History, Database, PanelLeftOpen } from "lucide-react";
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import { ConnectionSidebar } from "./ConnectionSidebar";
import { SchemaBrowser } from "./SchemaBrowser";
import { SqlEditor } from "./SqlEditor";
import { DataGrid } from "./DataGrid";
import { QueryHistoryPanel } from "./QueryHistoryPanel";
import type { CellEdit, SqlValue, QueryResult } from "@/types/dbclient";

export const DbClientWorkspace = memo(function DbClientWorkspace({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const queryResult = useDbClientStore(sessionId, (s) => s.queryResult);
  const tableData = useDbClientStore(sessionId, (s) => s.tableData);
  const tableDataLoading = useDbClientStore(sessionId, (s) => s.tableDataLoading);
  const tableDataOffset = useDbClientStore(sessionId, (s) => s.tableDataOffset);
  const tableDataLimit = useDbClientStore(sessionId, (s) => s.tableDataLimit);
  const selectedTable = useDbClientStore(sessionId, (s) => s.selectedTable);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);
  const selectedSchema = useDbClientStore(sessionId, (s) => s.selectedSchema);
  const pendingEdits = useDbClientStore(sessionId, (s) => s.pendingEdits);
  const tablePrimaryKeys = useDbClientStore(sessionId, (s) => s.tablePrimaryKeys);

  const showTableData = selectedTable != null && tableData != null;

  const connPanelRef = usePanelRef();
  const [connPanelCollapsed, setConnPanelCollapsed] = useState(false);

  const handleConnPanelResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setConnPanelCollapsed(size.inPixels <= 42);
  }, []);

  const handleConnPanelExpand = useCallback(() => {
    const ref = connPanelRef.current;
    if (!ref) return;
    ref.expand();
    ref.resize("22%");
  }, [connPanelRef]);

  const handleCellEdit = useCallback((edit: CellEdit) => {
    getDbClientStoreApi(sessionId).getState().addPendingEdit(edit);
  }, [sessionId]);

  const handleApplyEdits = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().applyEdits();
  }, [sessionId]);

  const handleDiscardEdits = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().clearPendingEdits();
  }, [sessionId]);

  const handleDeleteRows = useCallback((pkValues: SqlValue[][]) => {
    getDbClientStoreApi(sessionId).getState().deleteRows(pkValues);
  }, [sessionId]);

  const tableMeta = selectedTable && selectedDatabase ? {
    database: selectedDatabase,
    schema: selectedSchema ?? "",
    table: selectedTable.name,
    pkColumns: tablePrimaryKeys,
  } : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-base" data-contextmenu-zone="dbclient" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <PanelGroup orientation="horizontal">
          <Panel
            id="db-connections"
            defaultSize={22}
            minSize="40px"
            collapsible
            collapsedSize="0px"
            panelRef={connPanelRef}
            onResize={handleConnPanelResize}
            className="overflow-hidden"
          >
            <div className="h-full min-w-[200px]">
              <ConnectionSidebar sessionId={sessionId} />
            </div>
          </Panel>

          <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
            <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
            {connPanelCollapsed && (
              <button
                onClick={handleConnPanelExpand}
                className="absolute left-0 top-2 z-10 flex items-center justify-center w-6 h-6 rounded-r bg-bg-surface border border-l-0 border-border-default/50 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shadow-sm"
              >
                <PanelLeftOpen size={14} />
              </button>
            )}
          </PanelResizeHandle>

          <Panel id="db-main" defaultSize={78} minSize={40}>
            {connected ? (
              <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
                <PanelGroup orientation="horizontal">
                  <Panel id="db-schema" defaultSize={22} minSize={10} maxSize={35}>
                    <SchemaBrowser sessionId={sessionId} />
                  </Panel>

                  <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
                    <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
                  </PanelResizeHandle>

                  <Panel id="db-editor-area" defaultSize={78} minSize={40}>
                    <PanelGroup orientation="vertical">
                      <Panel id="db-sql-editor" defaultSize={45} minSize={15}>
                        <SqlEditor sessionId={sessionId} />
                      </Panel>

                      <PanelResizeHandle className="relative h-[7px] shrink-0 cursor-row-resize group flex items-center justify-center">
                        <div className="absolute inset-x-0 top-[3px] h-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
                      </PanelResizeHandle>

                      <Panel id="db-results" defaultSize={55} minSize={15}>
                        <ResultTabs
                          sessionId={sessionId}
                          showTableData={showTableData}
                          tableData={tableData}
                          tableDataLoading={tableDataLoading}
                          tableDataOffset={tableDataOffset}
                          tableDataLimit={tableDataLimit}
                          tableMeta={tableMeta}
                          pendingEdits={pendingEdits}
                          queryResult={queryResult}
                          onPageChange={(newOffset) => {
                            getDbClientStoreApi(sessionId).getState().setTableDataPage(newOffset);
                          }}
                          onCellEdit={handleCellEdit}
                          onApplyEdits={handleApplyEdits}
                          onDiscardEdits={handleDiscardEdits}
                          onDeleteRows={handleDeleteRows}
                        />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Database size={36} className="text-text-quaternary opacity-30" />
                  <p className="pf-text-sm text-text-tertiary">
                    {t("dbClient.getStarted")}
                  </p>
                </div>
              </div>
            )}
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
});

// ── 结果面板（带 Data / History 标签页） ──

function ResultTabs({
  sessionId,
  showTableData,
  tableData,
  tableDataLoading,
  tableDataOffset,
  tableDataLimit,
  tableMeta,
  pendingEdits,
  queryResult,
  onPageChange,
  onCellEdit,
  onApplyEdits,
  onDiscardEdits,
  onDeleteRows,
}: {
  sessionId: string;
  showTableData: boolean;
  tableData: QueryResult | null;
  tableDataLoading: boolean;
  tableDataOffset: number;
  tableDataLimit: number;
  tableMeta: { database: string; schema: string; table: string; pkColumns: string[] } | null;
  pendingEdits: CellEdit[];
  queryResult: QueryResult | null;
  onPageChange: (offset: number) => void;
  onCellEdit: (edit: CellEdit) => void;
  onApplyEdits: () => void;
  onDiscardEdits: () => void;
  onDeleteRows: (pkValues: SqlValue[][]) => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"data" | "history">("data");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border-default/50 px-2">
        <button
          onClick={() => setActiveTab("data")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium transition-colors border-b-2",
            activeTab === "data"
              ? "border-accent-primary text-accent-primary"
              : "border-transparent text-text-tertiary hover:text-text-primary",
          )}
        >
          <Table2 size={12} />
          {t("dbClient.results")}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium transition-colors border-b-2",
            activeTab === "history"
              ? "border-accent-primary text-accent-primary"
              : "border-transparent text-text-tertiary hover:text-text-primary",
          )}
        >
          <History size={12} />
          {t("dbClient.queryHistory")}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "data" ? (
          showTableData ? (
            <DataGrid
              result={tableData}
              loading={tableDataLoading}
              offset={tableDataOffset}
              limit={tableDataLimit}
              onPageChange={onPageChange}
              editable={tableMeta != null && tableMeta.pkColumns.length > 0}
              tableMeta={tableMeta}
              pendingEdits={pendingEdits}
              onCellEdit={onCellEdit}
              onApplyEdits={onApplyEdits}
              onDiscardEdits={onDiscardEdits}
              onDeleteRows={onDeleteRows}
            />
          ) : (
            <DataGrid result={queryResult} />
          )
        ) : (
          <QueryHistoryPanel sessionId={sessionId} />
        )}
      </div>
    </div>
  );
}
