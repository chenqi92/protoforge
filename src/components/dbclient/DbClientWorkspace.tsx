// 数据库客户端工作区 — 两栏布局：连接侧栏 | 编辑器/结果
// Query tab: SqlEditor(编辑器+工具栏) + ResultTabs(结果+历史)
// Table tab: TableDataView(筛选+排序+数据网格)

import { memo, useCallback, useState, useRef, useMemo } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Table2, History, Database, PanelLeftOpen } from "lucide-react";
import { useDbClientStore } from "@/stores/dbClientStore";
import { ConnectionSidebar } from "./ConnectionSidebar";
import { SqlEditor } from "./SqlEditor";
import { DataGrid } from "./DataGrid";
import { QueryHistoryPanel } from "./QueryHistoryPanel";
import { TableDataView } from "./TableDataView";
import type { QueryResult } from "@/types/dbclient";

export const DbClientWorkspace = memo(function DbClientWorkspace({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const queryResult = useDbClientStore(sessionId, (s) => s.queryResult);
  const tabs = useDbClientStore(sessionId, (s) => s.tabs);
  const activeTabId = useDbClientStore(sessionId, (s) => s.activeTabId);

  const activeTab = tabs.find((t) => t.id === activeTabId);

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
              activeTab?.kind === "table" ? (
                // Table Data Tab: Tab 栏 + 全高 TableDataView
                <div className="flex h-full flex-col">
                  <div className="shrink-0">
                    <SqlEditor sessionId={sessionId} />
                  </div>
                  <div className="flex-1 min-h-0">
                    <TableDataView sessionId={sessionId} tab={activeTab} />
                  </div>
                </div>
              ) : (
                // Query Tab: 上下分栏（编辑器 + 结果）
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
                      queryResult={queryResult}
                    />
                  </Panel>
                </PanelGroup>
              )
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

// ── 结果面板（Query tab 用：Data / History 标签页）──

function ResultTabs({
  sessionId,
  queryResult,
}: {
  sessionId: string;
  queryResult: QueryResult | null;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"data" | "history">("data");
  const [queryPageOffset, setQueryPageOffset] = useState(0);
  const queryPageLimit = 500;

  // 重置分页 when result changes
  const resultRef = useRef(queryResult);
  if (resultRef.current !== queryResult) {
    resultRef.current = queryResult;
    if (queryPageOffset !== 0) setQueryPageOffset(0);
  }

  // 客户端分页：截取当前页数据
  const pagedResult = useMemo(() => {
    if (!queryResult || queryResult.rows.length <= queryPageLimit) return queryResult;
    return {
      ...queryResult,
      rows: queryResult.rows.slice(queryPageOffset, queryPageOffset + queryPageLimit),
      totalRows: queryResult.rows.length,
    };
  }, [queryResult, queryPageOffset, queryPageLimit]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border-default/50 px-2">
        <button
          onClick={() => setActiveTab("data")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium transition-colors border-b-2",
            activeTab === "data"
              ? "border-accent-primary text-accent"
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
              ? "border-accent-primary text-accent"
              : "border-transparent text-text-tertiary hover:text-text-primary",
          )}
        >
          <History size={12} />
          {t("dbClient.queryHistory")}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "data" ? (
          <DataGrid
            result={pagedResult}
            offset={queryPageOffset}
            limit={queryPageLimit}
            onPageChange={queryResult && queryResult.rows.length > queryPageLimit ? setQueryPageOffset : undefined}
          />
        ) : (
          <QueryHistoryPanel sessionId={sessionId} />
        )}
      </div>
    </div>
  );
}
