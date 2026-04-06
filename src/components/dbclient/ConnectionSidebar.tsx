// 数据库连接侧栏 — 统一树：连接 → 数据库 → 表/视图/函数
// 使用 useContextMenu hook 统一右键菜单
// Tooltip 显示表/视图注释

import { memo, useEffect, useState, useCallback } from "react";
import {
  Plus, Trash2, Unplug, Database, Server,
  Pencil, Circle, Loader2, ChevronRight, ChevronDown,
  Table2, Eye, FunctionSquare, RefreshCw, PlugZap,
  Download, Upload, Copy, Code2, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  useDbClientStore,
  getDbClientStoreApi,
} from "@/stores/dbClientStore";
import type { SavedConnection, TableMeta } from "@/types/dbclient";
import { DB_TYPE_LABELS } from "@/types/dbclient";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { ImportExportDialog } from "./ImportExportDialog";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  getTableDdlQuery, getFunctionDdlQuery, getSelectQuery,
} from "@/lib/sqlDialect";

// ── 主组件 ──

export const ConnectionSidebar = memo(function ConnectionSidebar({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const savedConnections = useDbClientStore(sessionId, (s) => s.savedConnections);
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const connectionError = useDbClientStore(sessionId, (s) => s.connectionError);
  const connecting = useDbClientStore(sessionId, (s) => s.connecting);
  const activeConnectionId = useDbClientStore(sessionId, (s) => s.activeConnectionId);
  const expandedNodes = useDbClientStore(sessionId, (s) => s.expandedNodes);
  const databases = useDbClientStore(sessionId, (s) => s.databases);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);
  const schemaObjectsMap = useDbClientStore(sessionId, (s) => s.schemaObjectsMap);
  const schemaLoading = useDbClientStore(sessionId, (s) => s.schemaLoading);
  const connectionConfig = useDbClientStore(sessionId, (s) => s.connectionConfig);
  const tabs = useDbClientStore(sessionId, (s) => s.tabs);
  const activeTabId = useDbClientStore(sessionId, (s) => s.activeTabId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<SavedConnection | null>(null);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [exportDefaultTables, setExportDefaultTables] = useState<string[]>([]);
  const { showMenu, MenuComponent } = useContextMenu();

  // 当前活跃 table tab 的表名（用于高亮）
  const activeTableTab = tabs.find((t) => t.id === activeTabId && t.kind === "table");
  const activeTableName = activeTableTab?.kind === "table" ? activeTableTab.table : null;
  const activeTableSchema = activeTableTab?.kind === "table" ? activeTableTab.schema : null;

  useEffect(() => {
    getDbClientStoreApi(sessionId).getState().loadSavedConnections();
  }, [sessionId]);

  const toggle = useCallback((nodeId: string) => {
    getDbClientStoreApi(sessionId).getState().toggleNode(nodeId);
  }, [sessionId]);

  const handleConnectSaved = useCallback(async (conn: SavedConnection) => {
    const store = getDbClientStoreApi(sessionId);
    try {
      await store.getState().connectSaved(conn.id);
      const s = store.getState();
      if (!s.expandedNodes.has(`conn:${conn.id}`)) {
        s.toggleNode(`conn:${conn.id}`);
      }
    } catch (e) {
      console.error("Connect saved failed:", e);
    }
  }, [sessionId]);

  const handleDisconnect = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().disconnect();
  }, [sessionId]);

  const handleDelete = useCallback((id: string) => {
    getDbClientStoreApi(sessionId).getState().deleteSavedConnection(id);
  }, [sessionId]);

  const handleSelectDatabase = useCallback((db: string) => {
    getDbClientStoreApi(sessionId).getState().selectDatabase(db);
  }, [sessionId]);

  const handleOpenTable = useCallback((schema: string, table: string) => {
    getDbClientStoreApi(sessionId).getState().openTable(schema, table);
  }, [sessionId]);

  const handleNew = () => { setEditingConn(null); setDialogOpen(true); };
  const handleEdit = (conn: SavedConnection) => { setEditingConn(conn); setDialogOpen(true); };

  const dbType = connectionConfig?.dbType ?? "postgresql";

  // ── 复制到剪贴板 ──
  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  // ── Show DDL → 新建 query tab 并执行（使用表所在数据库）──
  const showDdl = useCallback((ddlSql: string, database?: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().addQueryTab("DDL", ddlSql);
    store.getState().executeQuery(database);
  }, [sessionId]);

  // ── 右键菜单：连接节点 ──
  const onConnectionContext = useCallback((e: React.MouseEvent, conn: SavedConnection) => {
    const isActive = connected && activeConnectionId === conn.id;
    const items: ContextMenuEntry[] = [];
    if (isActive) {
      items.push({
        id: "disconnect", label: t("dbClient.disconnect"), icon: <Unplug size={13} />,
        onClick: handleDisconnect,
      });
      items.push({
        id: "refresh-dbs", label: t("dbClient.refresh"), icon: <RefreshCw size={13} />,
        onClick: () => getDbClientStoreApi(sessionId).getState().loadDatabases(),
      });
    } else {
      items.push({
        id: "connect", label: t("dbClient.connect"), icon: <PlugZap size={13} />,
        onClick: () => handleConnectSaved(conn),
      });
    }
    items.push({ type: "divider" });
    items.push({
      id: "edit", label: t("dbClient.editConnection"), icon: <Pencil size={13} />,
      onClick: () => handleEdit(conn),
    });
    items.push({
      id: "delete", label: t("dbClient.delete"), icon: <Trash2 size={13} />,
      danger: true, onClick: () => handleDelete(conn.id),
    });
    showMenu(e, items);
  }, [t, connected, activeConnectionId, sessionId, handleDisconnect, handleConnectSaved, handleDelete, showMenu]);

  // ── 右键菜单：数据库节点 ──
  const onDatabaseContext = useCallback((e: React.MouseEvent, dbName: string) => {
    const items: ContextMenuEntry[] = [
      {
        id: "new-query", label: t("dbClient.newQueryTab"), icon: <FileText size={13} />,
        onClick: () => {
          getDbClientStoreApi(sessionId).getState().addQueryTab(`${dbName}`, "");
        },
      },
      {
        id: "refresh", label: t("dbClient.refresh"), icon: <RefreshCw size={13} />,
        onClick: () => handleSelectDatabase(dbName),
      },
      { type: "divider" },
      {
        id: "export-db", label: t("dbClient.export"), icon: <Download size={13} />,
        onClick: () => { setExportDefaultTables([]); setImportExportOpen(true); },
      },
      {
        id: "import-db", label: t("dbClient.import"), icon: <Upload size={13} />,
        onClick: () => { setImportExportOpen(true); },
      },
      { type: "divider" },
      {
        id: "copy-name", label: t("dbClient.copyName"), icon: <Copy size={13} />,
        onClick: () => copyText(dbName),
      },
    ];
    showMenu(e, items);
  }, [t, sessionId, handleSelectDatabase, copyText, showMenu]);

  // ── 右键菜单：表节点 ──
  const onTableContext = useCallback((e: React.MouseEvent, schema: string, tableName: string, database?: string) => {
    const items: ContextMenuEntry[] = [
      {
        id: "open", label: t("dbClient.openTable"), icon: <Table2 size={13} />,
        onClick: () => handleOpenTable(schema, tableName),
      },
      {
        id: "show-ddl", label: t("dbClient.showDDL"), icon: <Code2 size={13} />,
        onClick: () => showDdl(getTableDdlQuery(dbType, schema, tableName), database),
      },
      { type: "divider" },
      {
        id: "export-table", label: t("dbClient.exportTable"), icon: <Download size={13} />,
        onClick: () => { setExportDefaultTables([tableName]); setImportExportOpen(true); },
      },
      {
        id: "copy-name", label: t("dbClient.copyName"), icon: <Copy size={13} />,
        onClick: () => copyText(schema ? `${schema}.${tableName}` : tableName),
      },
      {
        id: "copy-select", label: t("dbClient.copySelect"), icon: <Copy size={13} />,
        onClick: () => copyText(getSelectQuery(dbType, schema, tableName)),
      },
    ];
    showMenu(e, items);
  }, [t, dbType, handleOpenTable, showDdl, copyText, showMenu]);

  // ── 右键菜单：函数节点 ──
  const onFunctionContext = useCallback((e: React.MouseEvent, schema: string, funcName: string, database?: string) => {
    const items: ContextMenuEntry[] = [
      {
        id: "show-ddl", label: t("dbClient.showDDL"), icon: <Code2 size={13} />,
        onClick: () => showDdl(getFunctionDdlQuery(dbType, schema, funcName), database),
      },
      {
        id: "copy-name", label: t("dbClient.copyName"), icon: <Copy size={13} />,
        onClick: () => copyText(schema ? `${schema}.${funcName}` : funcName),
      },
    ];
    showMenu(e, items);
  }, [t, dbType, showDdl, copyText, showMenu]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default/50 px-3 py-2">
        <span className="pf-text-xs font-medium uppercase tracking-wider text-text-tertiary">
          {t("dbClient.connections")}
        </span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title={t("dbClient.newConnection")}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 连接错误 */}
      {connectionError && !connecting && (
        <div className="border-b border-border-default/50 px-3 py-2 pf-text-xs text-red-500 bg-red-500/5 break-words">
          {connectionError}
        </div>
      )}

      {/* 统一树 */}
      <TooltipProvider delay={400}>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {savedConnections.map((conn) => {
            const connNodeId = `conn:${conn.id}`;
            const isActive = connected && activeConnectionId === conn.id;
            const isExpanded = expandedNodes.has(connNodeId);

            return (
              <div key={conn.id}>
                {/* 连接节点 */}
                <div
                  className={cn(
                    "group flex items-center gap-1.5 pf-rounded-sm px-1.5 py-1.5 transition-colors cursor-pointer select-none",
                    isActive
                      ? "bg-accent/8"
                      : "hover:bg-bg-hover",
                  )}
                  onClick={() => {
                    if (isActive) toggle(connNodeId);
                    else handleConnectSaved(conn);
                  }}
                  onContextMenu={(e) => onConnectionContext(e, conn)}
                >
                  {isActive ? (
                    isExpanded
                      ? <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
                      : <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                  ) : (
                    <div className="w-3 shrink-0" />
                  )}

                  {connecting && !isActive ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                  ) : (
                    <Server size={13} className={cn("shrink-0", isActive ? "text-emerald-500" : "text-text-tertiary")} />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate pf-text-xs font-medium text-text-primary leading-tight">
                      {conn.name}
                    </span>
                    <span className="truncate text-[10px] text-text-tertiary leading-tight">
                      {DB_TYPE_LABELS[conn.dbType]}
                      {conn.influxVersion ? ` ${conn.influxVersion}` : ""}
                      {" · "}
                      {conn.dbType === "sqlite"
                        ? (conn.filePath?.split("/").pop() ?? conn.filePath)
                        : `${conn.host}:${conn.port}`}
                    </span>
                  </div>

                  {isActive && (
                    <Circle size={6} className="fill-emerald-500 text-emerald-500 shrink-0" />
                  )}
                </div>

                {/* 数据库子树 */}
                {isActive && isExpanded && (
                  <div className="ml-4 border-l border-border-default/20 pl-0">
                    {databases.map((db) => {
                      const dbNodeId = `db:${conn.id}:${db.name}`;
                      const isDbExpanded = expandedNodes.has(dbNodeId);
                      const isDbSelected = selectedDatabase === db.name;

                      return (
                        <div key={db.name}>
                          <div
                            className={cn(
                              "flex items-center gap-1.5 px-2 py-1 pf-rounded-sm cursor-pointer transition-colors",
                              "text-text-secondary hover:bg-bg-hover",
                            )}
                            onClick={() => {
                              if (!isDbExpanded) {
                                // 展开时加载 schema（如果未缓存）
                                handleSelectDatabase(db.name);
                              }
                              toggle(dbNodeId);
                            }}
                            onContextMenu={(e) => onDatabaseContext(e, db.name)}
                          >
                            {isDbExpanded
                              ? <ChevronDown size={11} className="shrink-0 text-text-tertiary" />
                              : <ChevronRight size={11} className="shrink-0 text-text-tertiary" />}
                            <Database size={12} className={cn("shrink-0", isDbSelected ? "text-accent" : "text-blue-400")} />
                            <span className={cn("truncate pf-text-xs", isDbSelected && "text-accent font-medium")}>{db.name}</span>
                            {db.sizeBytes != null && (
                              <span className="ml-auto shrink-0 text-[10px] text-text-tertiary">{formatBytes(db.sizeBytes)}</span>
                            )}
                          </div>

                          {/* Schema 对象（支持多库同时展开） */}
                          {isDbExpanded && (() => {
                            const dbSchema = schemaObjectsMap.get(db.name);
                            const isThisDbLoading = schemaLoading && selectedDatabase === db.name;
                            return (
                            <div className="ml-4 border-l border-border-default/15 pl-0">
                              {isThisDbLoading && !dbSchema ? (
                                <div className="flex items-center gap-1.5 px-3 py-1.5">
                                  <Loader2 size={11} className="animate-spin text-text-tertiary" />
                                  <span className="pf-text-xs text-text-tertiary">{t("dbClient.loading")}</span>
                                </div>
                              ) : dbSchema ? (
                                <>
                                  {/* Tables */}
                                  {dbSchema.tables.length > 0 && (
                                    <SchemaGroup
                                      icon={<Table2 size={11} className="text-blue-500" />}
                                      label={t("dbClient.tables")}
                                      count={dbSchema.tables.length}
                                      expanded={expandedNodes.has(`tables:${conn.id}:${db.name}`)}
                                      onToggle={() => toggle(`tables:${conn.id}:${db.name}`)}
                                    >
                                      {dbSchema.tables.map((tbl) => (
                                        <TableLeaf
                                          key={`${tbl.schema}.${tbl.name}`}
                                          table={tbl}
                                          isSelected={activeTableSchema === tbl.schema && activeTableName === tbl.name}
                                          onDoubleClick={() => handleOpenTable(tbl.schema, tbl.name)}
                                          onContextMenu={(e) => onTableContext(e, tbl.schema, tbl.name, db.name)}
                                        />
                                      ))}
                                    </SchemaGroup>
                                  )}

                                  {/* Views */}
                                  {dbSchema.views.length > 0 && (
                                    <SchemaGroup
                                      icon={<Eye size={11} className="text-purple-500" />}
                                      label={t("dbClient.views")}
                                      count={dbSchema.views.length}
                                      expanded={expandedNodes.has(`views:${conn.id}:${db.name}`)}
                                      onToggle={() => toggle(`views:${conn.id}:${db.name}`)}
                                    >
                                      {dbSchema.views.map((v) => (
                                        <TableLeaf
                                          key={`${v.schema}.${v.name}`}
                                          table={v}
                                          isSelected={false}
                                          onDoubleClick={() => handleOpenTable(v.schema, v.name)}
                                          onContextMenu={(e) => onTableContext(e, v.schema, v.name, db.name)}
                                        />
                                      ))}
                                    </SchemaGroup>
                                  )}

                                  {/* Functions */}
                                  {dbSchema.functions.length > 0 && (
                                    <SchemaGroup
                                      icon={<FunctionSquare size={11} className="text-amber-500" />}
                                      label={t("dbClient.functions")}
                                      count={dbSchema.functions.length}
                                      expanded={expandedNodes.has(`functions:${conn.id}:${db.name}`)}
                                      onToggle={() => toggle(`functions:${conn.id}:${db.name}`)}
                                    >
                                      {dbSchema.functions.map((fn) => (
                                        <div
                                          key={`${fn.schema}.${fn.name}`}
                                          className="flex items-center gap-1.5 px-5 py-0.5 pf-text-xs text-text-secondary hover:bg-bg-hover pf-rounded-sm cursor-default"
                                          onContextMenu={(e) => onFunctionContext(e, fn.schema, fn.name, db.name)}
                                        >
                                          <FunctionSquare size={10} className="shrink-0 opacity-40" />
                                          <span className="truncate">{fn.name}</span>
                                          {fn.returnType && (
                                            <span className="ml-auto shrink-0 text-[10px] text-text-tertiary">{fn.returnType}</span>
                                          )}
                                        </div>
                                      ))}
                                    </SchemaGroup>
                                  )}
                                </>
                              ) : null}
                            </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {savedConnections.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
              <Database size={28} className="mb-2 opacity-30" />
              <span className="pf-text-xs">{t("dbClient.noConnections")}</span>
              <button
                onClick={handleNew}
                className="mt-2 pf-text-xs text-accent hover:underline"
              >
                {t("dbClient.createFirst")}
              </button>
            </div>
          )}
        </div>
      </TooltipProvider>

      {/* 右键菜单渲染 */}
      {MenuComponent}

      {/* 连接表单对话框 */}
      <ConnectionFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingConn(null); }}
        sessionId={sessionId}
        editingConnection={editingConn}
      />

      {/* 导入导出对话框 */}
      <ImportExportDialog
        open={importExportOpen}
        onClose={() => { setImportExportOpen(false); setExportDefaultTables([]); }}
        sessionId={sessionId}
        connectionConfig={connectionConfig}
        selectedDatabase={selectedDatabase}
        defaultTables={exportDefaultTables}
      />
    </div>
  );
});

// ── Schema 分组（表/视图/函数）──

function SchemaGroup({
  icon,
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-0.5 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover pf-rounded-sm"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-[10px] text-text-tertiary">{count}</span>
      </button>
      {expanded && children}
    </div>
  );
}

// ── 表/视图叶子节点（带 Tooltip）──

function TableLeaf({
  table,
  isSelected,
  onDoubleClick,
  onContextMenu,
}: {
  table: TableMeta;
  isSelected: boolean;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const content = (
    <button
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-1.5 px-5 py-0.5 pf-text-xs transition-colors pf-rounded-sm",
        isSelected
          ? "bg-accent/10 text-accent font-medium"
          : "text-text-secondary hover:bg-bg-hover",
      )}
    >
      <Table2 size={10} className="shrink-0 opacity-50" />
      <span className="truncate">{table.name}</span>
      {table.rowCountEstimate != null && table.rowCountEstimate > 0 && (
        <span className="ml-auto shrink-0 text-[10px] text-text-tertiary">
          ~{formatNumber(table.rowCountEstimate)}
        </span>
      )}
    </button>
  );

  if (table.comment) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <div className="max-w-[240px]">
            <div className="font-medium">{table.name}</div>
            <div className="text-xs opacity-80 mt-0.5">{table.comment}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

// ── 格式化工具 ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
