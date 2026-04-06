// 数据库客户端工作区 — 两栏布局：连接侧栏 | 编辑器/结果
// Query tab: SqlEditor(编辑器+工具栏) + ResultTabs(结果+历史)
// Table tab: TableDataView(筛选+排序+数据网格)
// Structure tab: TableStructureEditor(表结构编辑)

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
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import { ConnectionSidebar } from "./ConnectionSidebar";
import { SqlEditor } from "./SqlEditor";
import { DataGrid } from "./DataGrid";
import { QueryHistoryPanel } from "./QueryHistoryPanel";
import { TableDataView } from "./TableDataView";
import { TableStructureEditor } from "./TableStructureEditor";
import { DdlCodeView } from "./DdlCodeView";
import type { QueryResult, SqlValue } from "@/types/dbclient";

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
  const isDdlTab = activeTab?.kind === "query" && activeTab.label.startsWith("DDL");

  // Feature 1: 从 activeTab 读取 panel 布局
  const panelLayout = activeTab?.kind === "query" ? activeTab.panelLayout : undefined;
  const editorSize = panelLayout?.[0] ?? 45;
  const resultsSize = panelLayout?.[1] ?? 55;

  const handleVerticalLayout = useCallback((sizes: number[]) => {
    if (activeTabId && sizes.length === 2) {
      getDbClientStoreApi(sessionId).getState().setTabPanelLayout(activeTabId, [sizes[0], sizes[1]]);
    }
  }, [sessionId, activeTabId]);

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
              activeTab?.kind === "structure" ? (
                // Structure Tab: Tab 栏 + TableStructureEditor
                <div className="flex h-full flex-col">
                  <div className="shrink-0">
                    <SqlEditor sessionId={sessionId} />
                  </div>
                  <div className="flex-1 min-h-0">
                    <TableStructureEditor sessionId={sessionId} tab={activeTab} />
                  </div>
                </div>
              ) : activeTab?.kind === "table" ? (
                // Table Data Tab
                <div className="flex h-full flex-col">
                  <div className="shrink-0">
                    <SqlEditor sessionId={sessionId} />
                  </div>
                  <div className="flex-1 min-h-0">
                    <TableDataView sessionId={sessionId} tab={activeTab} />
                  </div>
                </div>
              ) : (
                // Query Tab: key={activeTabId} 确保各 tab 分割线独立
                <PanelGroup orientation="vertical" key={activeTabId} onLayout={handleVerticalLayout}>
                  <Panel id="db-sql-editor" defaultSize={editorSize} minSize={15}>
                    <SqlEditor sessionId={sessionId} />
                  </Panel>

                  <PanelResizeHandle className="relative h-[7px] shrink-0 cursor-row-resize group flex items-center justify-center">
                    <div className="absolute inset-x-0 top-[3px] h-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
                  </PanelResizeHandle>

                  <Panel id="db-results" defaultSize={resultsSize} minSize={15}>
                    <ResultTabs
                      sessionId={sessionId}
                      queryResult={queryResult}
                      isDdl={isDdlTab}
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
  isDdl,
}: {
  sessionId: string;
  queryResult: QueryResult | null;
  isDdl?: boolean;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"data" | "history">("data");
  const [queryPageOffset, setQueryPageOffset] = useState(0);
  const queryPageLimit = 500;

  const resultRef = useRef(queryResult);
  if (resultRef.current !== queryResult) {
    resultRef.current = queryResult;
    if (queryPageOffset !== 0) setQueryPageOffset(0);
  }

  const pagedResult = useMemo(() => {
    if (!queryResult || queryResult.rows.length <= queryPageLimit) return queryResult;
    return {
      ...queryResult,
      rows: queryResult.rows.slice(queryPageOffset, queryPageOffset + queryPageLimit),
      totalRows: queryResult.rows.length,
    };
  }, [queryResult, queryPageOffset, queryPageLimit]);

  const ddlText = useMemo(() => {
    if (!isDdl || !queryResult || !queryResult.columns.length || !queryResult.rows.length) return null;
    return extractDdlText(queryResult);
  }, [isDdl, queryResult]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border-default/50 px-2">
        <button onClick={() => setActiveTab("data")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium transition-colors border-b-2",
            activeTab === "data" ? "border-accent-primary text-accent" : "border-transparent text-text-tertiary hover:text-text-primary")}>
          <Table2 size={12} />{t("dbClient.results")}
        </button>
        <button onClick={() => setActiveTab("history")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium transition-colors border-b-2",
            activeTab === "history" ? "border-accent-primary text-accent" : "border-transparent text-text-tertiary hover:text-text-primary")}>
          <History size={12} />{t("dbClient.queryHistory")}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {activeTab === "data" ? (
          ddlText ? <DdlCodeView text={ddlText} /> : (
            <DataGrid result={pagedResult} offset={queryPageOffset} limit={queryPageLimit}
              onPageChange={queryResult && queryResult.rows.length > queryPageLimit ? setQueryPageOffset : undefined} />
          )
        ) : (
          <QueryHistoryPanel sessionId={sessionId} />
        )}
      </div>
    </div>
  );
}

// ── DDL 文本提取 ──

function sqlValueToString(v: SqlValue): string {
  switch (v.type) {
    case "Text": return v.value;
    case "Null": return "";
    case "Bool": return String(v.value);
    case "Int": case "Float": return String(v.value);
    case "Json": return typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 2);
    case "Bytes": return v.value;
    case "Timestamp": return v.value;
    case "Array": return v.value.map(sqlValueToString).join(", ");
  }
}

function extractDdlText(result: QueryResult): string | null {
  if (!result.rows.length) return null;
  const cols = result.columns.map(c => c.name.toLowerCase());

  const createIdx = cols.findIndex(c => c === "create table" || c === "create view" || c === "create function");
  if (createIdx >= 0) return sqlValueToString(result.rows[0][createIdx]);

  const sqlIdx = cols.findIndex(c => c === "sql");
  if (sqlIdx >= 0 && cols.length <= 2) return sqlValueToString(result.rows[0][sqlIdx]);

  if (result.columns.length === 1 && result.rows.length === 1) {
    const val = sqlValueToString(result.rows[0][0]);
    if (val && val.length > 10) return val;
  }

  if (cols.includes("column_name") && cols.includes("data_type")) {
    return formatPgColumnsToDdl(result);
  }

  return null;
}

function formatPgColumnsToDdl(result: QueryResult): string {
  const cols = result.columns.map(c => c.name.toLowerCase());
  const nameIdx = cols.indexOf("column_name");
  const typeIdx = cols.indexOf("data_type");
  const nullIdx = cols.indexOf("is_nullable");
  const defaultIdx = cols.indexOf("column_default");
  const maxLenIdx = cols.indexOf("character_maximum_length");

  const lines: string[] = [];
  const maxNameLen = Math.max(...result.rows.map(r => sqlValueToString(r[nameIdx]).length));

  for (const row of result.rows) {
    const name = sqlValueToString(row[nameIdx]);
    let dtype = sqlValueToString(row[typeIdx]);
    const maxLen = maxLenIdx >= 0 ? sqlValueToString(row[maxLenIdx]) : "";
    if (maxLen && maxLen !== "" && dtype.toLowerCase() !== "text") dtype = `${dtype}(${maxLen})`;
    const nullable = nullIdx >= 0 ? sqlValueToString(row[nullIdx]) : "YES";
    const def = defaultIdx >= 0 ? sqlValueToString(row[defaultIdx]) : "";

    let line = `    ${name.padEnd(maxNameLen + 2)}${dtype}`;
    if (nullable === "NO") line += "  NOT NULL";
    if (def) line += `  DEFAULT ${def}`;
    lines.push(line);
  }

  return `-- auto-generated definition\n(\n${lines.join(",\n")}\n);`;
}
