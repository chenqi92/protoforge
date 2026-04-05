// Database Client Zustand Store — 每个 session 独立实例
// 统一 Tab 系统：QueryTab（SQL 编辑器）+ TableDataTab（表数据浏览）

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  ConnectionConfig,
  SavedConnection,
  ServerInfo,
  QueryResult,
  DatabaseInfo,
  SchemaObjects,
  TableDescription,
  CellEdit,
} from "@/types/dbclient";
import * as dbService from "@/services/dbClientService";

// ═══════════════════════════════════════════
//  Tab 类型
// ═══════════════════════════════════════════

export interface QueryTab {
  kind: "query";
  id: string;
  label: string;
  sqlText: string;
  queryResult: QueryResult | null;
  queryError: string | null;
  queryRunning: boolean;
}

export interface TableDataTab {
  kind: "table";
  id: string;
  label: string;
  database: string;
  schema: string;
  table: string;
  tableData: QueryResult | null;
  tableDataLoading: boolean;
  tableDataOffset: number;
  tableDataLimit: number;
  sortColumn: string | null;
  sortDir: "ASC" | "DESC" | null;
  filter: string;
  tablePrimaryKeys: string[];
  pendingEdits: CellEdit[];
  tableDescription: TableDescription | null;
}

export type WorkspaceTab = QueryTab | TableDataTab;

// ═══════════════════════════════════════════
//  State 类型
// ═══════════════════════════════════════════

interface DbClientStoreState {
  sessionId: string;

  // 连接
  activeConnectionId: string | null;
  connectionConfig: ConnectionConfig | null;
  connected: boolean;
  serverInfo: ServerInfo | null;
  connectionError: string | null;
  connecting: boolean;

  // 保存的连接
  savedConnections: SavedConnection[];

  // 树展开状态
  expandedNodes: Set<string>;

  // Schema 浏览
  databases: DatabaseInfo[];
  selectedDatabase: string | null;
  schemaObjects: SchemaObjects | null;
  selectedSchema: string | null;
  schemaLoading: boolean;

  // 统一 Tab 系统
  tabs: WorkspaceTab[];
  activeTabId: string | null;

  // Query tab proxy（向后兼容）
  sqlText: string;
  queryRunning: boolean;
  queryResult: QueryResult | null;
  queryError: string | null;

  // Actions — 连接管理
  connect: (config: ConnectionConfig) => Promise<void>;
  connectSaved: (connectionId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  testConnection: (config: ConnectionConfig) => Promise<ServerInfo>;
  loadSavedConnections: () => Promise<void>;
  saveConnection: (req: import("@/types/dbclient").SaveConnectionRequest) => Promise<string>;
  deleteSavedConnection: (id: string) => Promise<void>;

  // 树展开
  toggleNode: (nodeId: string) => void;

  // Schema
  loadDatabases: () => Promise<void>;
  selectDatabase: (db: string) => Promise<void>;
  loadSchemaObjects: (schema?: string) => Promise<void>;

  // 统一 Tab 操作
  addQueryTab: (label?: string, sql?: string) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setSqlText: (text: string) => void;
  executeQuery: () => Promise<void>;
  cancelQuery: () => Promise<void>;

  // 表数据 Tab 操作
  openTable: (schema: string, table: string) => Promise<void>;
  refreshTableTab: (tabId?: string) => Promise<void>;
  setTableSort: (tabId: string, column: string) => Promise<void>;
  setTableFilter: (tabId: string, filter: string) => Promise<void>;
  setTableDataPage: (tabIdOrOffset: string | number, offset?: number) => Promise<void>;

  // 编辑操作（作用于具体 tab）
  addPendingEdit: (edit: CellEdit, tabId?: string) => void;
  clearPendingEdits: (tabId?: string) => void;
  applyEdits: (tabId?: string) => Promise<void>;
  deleteRows: (pkValues: import("@/types/dbclient").SqlValue[][], tabId?: string) => Promise<void>;

  // 向后兼容旧接口
  closeQueryTab: (tabId: string) => void;
  setActiveQueryTab: (tabId: string) => void;
}

type DbClientStoreApi = ReturnType<typeof createDbClientSessionStore>;

const stores = new Map<string, DbClientStoreApi>();
const cleanupFns = new Map<string, () => void>();

// ── 辅助：获取活跃 table tab ──
function getActiveTableTab(state: DbClientStoreState, tabId?: string): TableDataTab | null {
  const id = tabId ?? state.activeTabId;
  if (!id) return null;
  const tab = state.tabs.find((t) => t.id === id);
  return tab?.kind === "table" ? tab : null;
}

function updateTab<T extends WorkspaceTab>(
  tabs: WorkspaceTab[],
  tabId: string,
  updater: (tab: T) => Partial<T>,
): WorkspaceTab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, ...updater(t as T) } : t));
}

function createDbClientSessionStore(sessionId: string) {
  cleanupFns.set(sessionId, () => {});

  return createStore<DbClientStoreState>((set, get) => ({
    sessionId,

    // 初始状态
    activeConnectionId: null,
    connectionConfig: null,
    connected: false,
    serverInfo: null,
    connectionError: null,
    connecting: false,
    savedConnections: [],
    expandedNodes: new Set<string>(),
    databases: [],
    selectedDatabase: null,
    schemaObjects: null,
    selectedSchema: null,
    schemaLoading: false,
    tabs: [],
    activeTabId: null,
    sqlText: "",
    queryRunning: false,
    queryResult: null,
    queryError: null,

    // ── 连接 ──

    connect: async (config: ConnectionConfig) => {
      set({ connecting: true, connectionError: null });
      try {
        const info = await dbService.connect(sessionId, config);
        set({
          connected: true,
          serverInfo: info,
          connectionConfig: config,
          connecting: false,
        });
        get().loadDatabases();
      } catch (e) {
        set({ connected: false, connectionError: String(e), connecting: false });
        throw e;
      }
    },

    connectSaved: async (connectionId: string) => {
      set({ connecting: true, connectionError: null });
      try {
        const info = await dbService.connectSaved(sessionId, connectionId);
        set({
          connected: true,
          serverInfo: info,
          activeConnectionId: connectionId,
          connecting: false,
        });
        get().loadDatabases();
      } catch (e) {
        set({ connected: false, connectionError: String(e), connecting: false });
        throw e;
      }
    },

    disconnect: async () => {
      try { await dbService.disconnect(sessionId); } catch {}
      set({
        connected: false,
        serverInfo: null,
        connectionConfig: null,
        activeConnectionId: null,
        databases: [],
        selectedDatabase: null,
        schemaObjects: null,
        tabs: [],
        activeTabId: null,
        sqlText: "",
        queryResult: null,
        queryError: null,
      });
    },

    testConnection: async (config: ConnectionConfig) => {
      return dbService.testConnection(config);
    },

    loadSavedConnections: async () => {
      try {
        const conns = await dbService.listConnections();
        set({ savedConnections: conns });
      } catch (e) {
        console.error("Load saved connections failed:", e);
      }
    },

    saveConnection: async (req) => {
      const id = await dbService.saveConnection(req);
      await get().loadSavedConnections();
      return id;
    },

    deleteSavedConnection: async (id: string) => {
      await dbService.deleteConnection(id);
      await get().loadSavedConnections();
    },

    // ── Schema ──

    loadDatabases: async () => {
      try {
        const dbs = await dbService.listDatabases(sessionId);
        set({ databases: dbs });
        const config = get().connectionConfig;
        if (config?.database && dbs.some((d) => d.name === config.database)) {
          get().selectDatabase(config.database);
        } else if (dbs.length > 0) {
          get().selectDatabase(dbs[0].name);
        }
      } catch (e) {
        console.error("Load databases failed:", e);
      }
    },

    selectDatabase: async (db: string) => {
      set({ selectedDatabase: db, schemaObjects: null, schemaLoading: true });
      try {
        const objects = await dbService.listSchemaObjects(sessionId, db, "");
        set({ schemaObjects: objects, schemaLoading: false });
        if (objects.schemas.length > 0) {
          set({ selectedSchema: objects.schemas[0] });
        }
      } catch (e) {
        set({ schemaLoading: false });
        console.error("Load schema objects failed:", e);
      }
    },

    loadSchemaObjects: async (schema?: string) => {
      const db = get().selectedDatabase;
      if (!db) return;
      set({ schemaLoading: true });
      try {
        const objects = await dbService.listSchemaObjects(
          sessionId, db, schema ?? get().selectedSchema ?? "",
        );
        set({ schemaObjects: objects, schemaLoading: false });
      } catch (e) {
        set({ schemaLoading: false });
        console.error("Load schema objects failed:", e);
      }
    },

    // ── 树展开 ──

    toggleNode: (nodeId: string) => {
      set((s) => {
        const next = new Set(s.expandedNodes);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return { expandedNodes: next };
      });
    },

    // ── 统一 Tab ──

    addQueryTab: (label?: string, sql?: string) => {
      const id = crypto.randomUUID();
      const queryCount = get().tabs.filter((t) => t.kind === "query").length;
      const tab: QueryTab = {
        kind: "query",
        id,
        label: label ?? `Query ${queryCount + 1}`,
        sqlText: sql ?? "",
        queryResult: null,
        queryError: null,
        queryRunning: false,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: id,
        sqlText: tab.sqlText,
        queryResult: null,
        queryError: null,
        queryRunning: false,
      }));
      return id;
    },

    closeTab: (tabId: string) => {
      set((s) => {
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        let activeId = s.activeTabId;
        if (activeId === tabId) {
          activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
        }
        const activeTab = tabs.find((t) => t.id === activeId);
        const isQuery = activeTab?.kind === "query";
        return {
          tabs,
          activeTabId: activeId,
          sqlText: isQuery ? (activeTab as QueryTab).sqlText : "",
          queryResult: isQuery ? (activeTab as QueryTab).queryResult : null,
          queryError: isQuery ? (activeTab as QueryTab).queryError : null,
          queryRunning: isQuery ? (activeTab as QueryTab).queryRunning : false,
        };
      });
    },

    setActiveTab: (tabId: string) => {
      set((s) => {
        // 先保存当前 query tab 状态
        const tabs = s.tabs.map((t) => {
          if (t.id === s.activeTabId && t.kind === "query") {
            return {
              ...t,
              sqlText: s.sqlText,
              queryResult: s.queryResult,
              queryError: s.queryError,
              queryRunning: s.queryRunning,
            };
          }
          return t;
        });
        const target = tabs.find((t) => t.id === tabId);
        const isQuery = target?.kind === "query";
        return {
          tabs,
          activeTabId: tabId,
          sqlText: isQuery ? (target as QueryTab).sqlText : "",
          queryResult: isQuery ? (target as QueryTab).queryResult : null,
          queryError: isQuery ? (target as QueryTab).queryError : null,
          queryRunning: isQuery ? (target as QueryTab).queryRunning : false,
        };
      });
    },

    setSqlText: (text: string) => set({ sqlText: text }),

    executeQuery: async () => {
      const sql = get().sqlText.trim();
      if (!sql) return;
      set({ queryRunning: true, queryError: null, queryResult: null });
      const config = get().connectionConfig;
      const startMs = Date.now();
      try {
        const result = await dbService.executeQuery(sessionId, sql);
        set((s) => ({
          queryResult: result,
          queryRunning: false,
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId && t.kind === "query"
              ? { ...t, queryResult: result, queryError: null, queryRunning: false, sqlText: sql }
              : t
          ),
        }));
        dbService.addQueryHistory({
          id: crypto.randomUUID(),
          connectionId: null,
          connectionName: config?.host ?? "",
          dbType: config?.dbType ?? "postgresql",
          databaseName: get().selectedDatabase ?? "",
          sqlText: sql,
          executionMs: result.executionTimeMs ?? (Date.now() - startMs),
          rowCount: result.rows.length,
          status: "success",
          errorMessage: null,
          createdAt: new Date().toISOString(),
        }).catch((e) => console.warn("Failed to save query history:", e));
      } catch (e) {
        const errMsg = String(e);
        set((s) => ({
          queryError: errMsg,
          queryRunning: false,
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId && t.kind === "query"
              ? { ...t, queryError: errMsg, queryResult: null, queryRunning: false, sqlText: sql }
              : t
          ),
        }));
        dbService.addQueryHistory({
          id: crypto.randomUUID(),
          connectionId: null,
          connectionName: config?.host ?? "",
          dbType: config?.dbType ?? "postgresql",
          databaseName: get().selectedDatabase ?? "",
          sqlText: sql,
          executionMs: Date.now() - startMs,
          rowCount: null,
          status: "error",
          errorMessage: String(e),
          createdAt: new Date().toISOString(),
        }).catch((e) => console.warn("Failed to save query history:", e));
      }
    },

    cancelQuery: async () => {
      try { await dbService.cancelQuery(sessionId); } catch {}
      set({ queryRunning: false });
    },

    // ── 表数据 Tab ──

    openTable: async (schema: string, table: string) => {
      const db = get().selectedDatabase ?? "";

      // 查找是否已有该表的 tab
      const existing = get().tabs.find(
        (t) => t.kind === "table" && t.database === db && t.schema === schema && t.table === table
      );
      if (existing) {
        get().setActiveTab(existing.id);
        return;
      }

      // 新建 table data tab
      const id = crypto.randomUUID();
      const tab: TableDataTab = {
        kind: "table",
        id,
        label: table,
        database: db,
        schema,
        table,
        tableData: null,
        tableDataLoading: true,
        tableDataOffset: 0,
        tableDataLimit: 200,
        sortColumn: null,
        sortDir: null,
        filter: "",
        tablePrimaryKeys: [],
        pendingEdits: [],
        tableDescription: null,
      };

      // 先保存当前 query tab 状态再切换
      set((s) => {
        const tabs = s.tabs.map((t) => {
          if (t.id === s.activeTabId && t.kind === "query") {
            return { ...t, sqlText: s.sqlText, queryResult: s.queryResult, queryError: s.queryError, queryRunning: s.queryRunning };
          }
          return t;
        });
        return {
          tabs: [...tabs, tab],
          activeTabId: id,
          sqlText: "",
          queryResult: null,
          queryError: null,
          queryRunning: false,
        };
      });

      // 并行加载表数据和表结构
      try {
        const [result, desc] = await Promise.all([
          dbService.fetchTableData(sessionId, db, schema, table, 0, 200),
          dbService.describeTable(sessionId, db, schema, table),
        ]);
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, id, () => ({
            tableData: result,
            tableDataLoading: false,
            tablePrimaryKeys: desc.primaryKeys,
            tableDescription: desc,
          })),
        }));
      } catch (e) {
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, id, () => ({
            tableDataLoading: false,
          })),
        }));
        console.error("Load table data failed:", e);
      }
    },

    refreshTableTab: async (tabId?: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({ tableDataLoading: true })),
      }));
      try {
        const result = await dbService.fetchTableData(
          sessionId, tab.database, tab.schema, tab.table,
          tab.tableDataOffset, tab.tableDataLimit,
          tab.sortColumn, tab.sortDir, tab.filter || null,
        );
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({
            tableData: result, tableDataLoading: false,
          })),
        }));
      } catch (e) {
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({ tableDataLoading: false })),
        }));
      }
    },

    setTableSort: async (tabId: string, column: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      // 循环：null → ASC → DESC → null
      let newDir: "ASC" | "DESC" | null;
      if (tab.sortColumn === column) {
        newDir = tab.sortDir === "ASC" ? "DESC" : tab.sortDir === "DESC" ? null : "ASC";
      } else {
        newDir = "ASC";
      }
      const newCol = newDir ? column : null;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({
          sortColumn: newCol, sortDir: newDir, tableDataOffset: 0, tableDataLoading: true,
        })),
      }));
      try {
        const result = await dbService.fetchTableData(
          sessionId, tab.database, tab.schema, tab.table,
          0, tab.tableDataLimit, newCol, newDir, tab.filter || null,
        );
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({
            tableData: result, tableDataLoading: false,
          })),
        }));
      } catch (e) {
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({ tableDataLoading: false })),
        }));
      }
    },

    setTableFilter: async (tabId: string, filter: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({
          filter, tableDataOffset: 0, tableDataLoading: true,
        })),
      }));
      try {
        const result = await dbService.fetchTableData(
          sessionId, tab.database, tab.schema, tab.table,
          0, tab.tableDataLimit, tab.sortColumn, tab.sortDir, filter || null,
        );
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({
            tableData: result, tableDataLoading: false,
          })),
        }));
      } catch (e) {
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tabId, () => ({ tableDataLoading: false })),
        }));
      }
    },

    setTableDataPage: async (tabIdOrOffset: string | number, offset?: number) => {
      // 兼容旧接口: setTableDataPage(offset) 或 setTableDataPage(tabId, offset)
      let tabId: string;
      let newOffset: number;
      if (typeof tabIdOrOffset === "number") {
        tabId = get().activeTabId ?? "";
        newOffset = tabIdOrOffset;
      } else {
        tabId = tabIdOrOffset;
        newOffset = offset ?? 0;
      }
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({
          tableDataOffset: newOffset, tableDataLoading: true,
        })),
      }));
      try {
        const result = await dbService.fetchTableData(
          sessionId, tab.database, tab.schema, tab.table,
          newOffset, tab.tableDataLimit,
          tab.sortColumn, tab.sortDir, tab.filter || null,
        );
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({
            tableData: result, tableDataLoading: false,
          })),
        }));
      } catch (e) {
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({ tableDataLoading: false })),
        }));
      }
    },

    // ── 编辑 ──

    addPendingEdit: (edit: CellEdit, tabId?: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tab.id, (t) => ({
          pendingEdits: [...t.pendingEdits, edit],
        })),
      }));
    },

    clearPendingEdits: (tabId?: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab) return;
      set((s) => ({
        tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({
          pendingEdits: [],
        })),
      }));
    },

    applyEdits: async (tabId?: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab || tab.pendingEdits.length === 0) return;
      try {
        await dbService.applyEdits(sessionId, tab.pendingEdits);
        set((s) => ({
          tabs: updateTab<TableDataTab>(s.tabs, tab.id, () => ({ pendingEdits: [] })),
        }));
        await get().refreshTableTab(tab.id);
      } catch (e) {
        console.error("Apply edits failed:", e);
        throw e;
      }
    },

    deleteRows: async (pkValues, tabId?: string) => {
      const tab = getActiveTableTab(get(), tabId);
      if (!tab || tab.tablePrimaryKeys.length === 0) return;
      try {
        await dbService.deleteRows(
          sessionId, tab.database, tab.schema, tab.table,
          tab.tablePrimaryKeys, pkValues,
        );
        await get().refreshTableTab(tab.id);
      } catch (e) {
        console.error("Delete rows failed:", e);
        throw e;
      }
    },

    // ── 向后兼容 ──
    closeQueryTab: (tabId: string) => get().closeTab(tabId),
    setActiveQueryTab: (tabId: string) => get().setActiveTab(tabId),
  }));
}

// ── 公共 API ──

export function getDbClientStoreApi(sessionId: string): DbClientStoreApi {
  if (!stores.has(sessionId)) {
    stores.set(sessionId, createDbClientSessionStore(sessionId));
  }
  return stores.get(sessionId)!;
}

export function useDbClientStore<T>(
  sessionId: string,
  selector: (s: DbClientStoreState) => T,
): T {
  const store = getDbClientStoreApi(sessionId);
  return useStore(store, selector);
}

export function cleanupDbClientStore(sessionId: string): void {
  const cleanup = cleanupFns.get(sessionId);
  if (cleanup) cleanup();
  stores.delete(sessionId);
  cleanupFns.delete(sessionId);
}
