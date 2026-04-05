// Database Client Zustand Store — 每个 session 独立实例

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  ConnectionConfig,
  SavedConnection,
  ServerInfo,
  QueryResult,
  DatabaseInfo,
  SchemaObjects,
  SchemaTreeNode,
  DbType,
  CellEdit,
  QueryHistoryEntry,
} from "@/types/dbclient";
import * as dbService from "@/services/dbClientService";

// ═══════════════════════════════════════════
//  State 类型
// ═══════════════════════════════════════════

interface DbClientStoreState {
  sessionId: string;

  // 连接
  connectionConfig: ConnectionConfig | null;
  connected: boolean;
  serverInfo: ServerInfo | null;
  connectionError: string | null;
  connecting: boolean;

  // 保存的连接
  savedConnections: SavedConnection[];

  // Schema 浏览
  databases: DatabaseInfo[];
  selectedDatabase: string | null;
  schemaObjects: SchemaObjects | null;
  selectedSchema: string | null;
  schemaLoading: boolean;

  // SQL 编辑器
  sqlText: string;
  queryRunning: boolean;
  queryResult: QueryResult | null;
  queryError: string | null;

  // 表数据浏览
  selectedTable: { schema: string; name: string } | null;
  tablePrimaryKeys: string[];
  tableData: QueryResult | null;
  tableDataOffset: number;
  tableDataLimit: number;
  tableDataLoading: boolean;

  // 待提交编辑
  pendingEdits: CellEdit[];

  // Actions
  // 连接管理
  connect: (config: ConnectionConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  testConnection: (config: ConnectionConfig) => Promise<ServerInfo>;
  loadSavedConnections: () => Promise<void>;
  saveConnection: (req: import("@/types/dbclient").SaveConnectionRequest) => Promise<string>;
  deleteSavedConnection: (id: string) => Promise<void>;

  // Schema
  loadDatabases: () => Promise<void>;
  selectDatabase: (db: string) => Promise<void>;
  loadSchemaObjects: (schema?: string) => Promise<void>;

  // 查询
  setSqlText: (text: string) => void;
  executeQuery: () => Promise<void>;
  cancelQuery: () => Promise<void>;

  // 表数据
  openTable: (schema: string, table: string) => Promise<void>;
  refreshTableData: () => Promise<void>;
  setTableDataPage: (offset: number) => Promise<void>;

  // 编辑
  addPendingEdit: (edit: CellEdit) => void;
  clearPendingEdits: () => void;
  applyEdits: () => Promise<void>;
  deleteRows: (pkValues: import("@/types/dbclient").SqlValue[][]) => Promise<void>;
}

type DbClientStoreApi = ReturnType<typeof createDbClientSessionStore>;

const stores = new Map<string, DbClientStoreApi>();
const cleanupFns = new Map<string, () => void>();

function createDbClientSessionStore(sessionId: string) {
  cleanupFns.set(sessionId, () => {
    // 清理逻辑（断开连接等）
  });

  return createStore<DbClientStoreState>((set, get) => ({
    sessionId,

    // 初始状态
    connectionConfig: null,
    connected: false,
    serverInfo: null,
    connectionError: null,
    connecting: false,
    savedConnections: [],
    databases: [],
    selectedDatabase: null,
    schemaObjects: null,
    selectedSchema: null,
    schemaLoading: false,
    sqlText: "",
    queryRunning: false,
    queryResult: null,
    queryError: null,
    selectedTable: null,
    tablePrimaryKeys: [],
    tableData: null,
    tableDataOffset: 0,
    tableDataLimit: 200,
    tableDataLoading: false,
    pendingEdits: [],

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
        // 自动加载数据库列表
        get().loadDatabases();
      } catch (e) {
        set({
          connected: false,
          connectionError: String(e),
          connecting: false,
        });
        throw e;
      }
    },

    disconnect: async () => {
      try {
        await dbService.disconnect(sessionId);
      } catch {
        // 忽略断开错误
      }
      set({
        connected: false,
        serverInfo: null,
        connectionConfig: null,
        databases: [],
        selectedDatabase: null,
        schemaObjects: null,
        queryResult: null,
        tableData: null,
        selectedTable: null,
        pendingEdits: [],
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
        // 自动选择当前连接的数据库
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
        // 默认选择第一个 schema
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
          sessionId,
          db,
          schema ?? get().selectedSchema ?? "",
        );
        set({ schemaObjects: objects, schemaLoading: false });
      } catch (e) {
        set({ schemaLoading: false });
        console.error("Load schema objects failed:", e);
      }
    },

    // ── 查询 ──

    setSqlText: (text: string) => set({ sqlText: text }),

    executeQuery: async () => {
      const sql = get().sqlText.trim();
      if (!sql) return;
      set({ queryRunning: true, queryError: null, queryResult: null });
      const config = get().connectionConfig;
      const startMs = Date.now();
      try {
        const result = await dbService.executeQuery(sessionId, sql);
        set({ queryResult: result, queryRunning: false });
        // 记录历史
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
        set({ queryError: String(e), queryRunning: false });
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
      try {
        await dbService.cancelQuery(sessionId);
      } catch {
        // 忽略
      }
      set({ queryRunning: false });
    },

    // ── 表数据 ──

    openTable: async (schema: string, table: string) => {
      set({
        selectedTable: { schema, name: table },
        tablePrimaryKeys: [],
        tableDataOffset: 0,
        tableData: null,
        tableDataLoading: true,
        pendingEdits: [],
      });
      try {
        const db = get().selectedDatabase ?? "";
        // 并行获取表数据和表结构（主键信息）
        const [result, desc] = await Promise.all([
          dbService.fetchTableData(sessionId, db, schema, table, 0, get().tableDataLimit),
          dbService.describeTable(sessionId, db, schema, table),
        ]);
        set({
          tableData: result,
          tablePrimaryKeys: desc.primaryKeys,
          tableDataLoading: false,
        });
      } catch (e) {
        set({ tableDataLoading: false });
        console.error("Load table data failed:", e);
      }
    },

    refreshTableData: async () => {
      const t = get().selectedTable;
      if (!t) return;
      set({ tableDataLoading: true });
      try {
        const db = get().selectedDatabase ?? "";
        const result = await dbService.fetchTableData(
          sessionId,
          db,
          t.schema,
          t.name,
          get().tableDataOffset,
          get().tableDataLimit,
        );
        set({ tableData: result, tableDataLoading: false });
      } catch (e) {
        set({ tableDataLoading: false });
      }
    },

    setTableDataPage: async (offset: number) => {
      set({ tableDataOffset: offset });
      await get().refreshTableData();
    },

    // ── 编辑 ──

    addPendingEdit: (edit: CellEdit) => {
      set((s) => ({ pendingEdits: [...s.pendingEdits, edit] }));
    },

    clearPendingEdits: () => set({ pendingEdits: [] }),

    applyEdits: async () => {
      const edits = get().pendingEdits;
      if (edits.length === 0) return;
      try {
        await dbService.applyEdits(sessionId, edits);
        set({ pendingEdits: [] });
        await get().refreshTableData();
      } catch (e) {
        console.error("Apply edits failed:", e);
        throw e;
      }
    },

    deleteRows: async (pkValues) => {
      const t = get().selectedTable;
      const db = get().selectedDatabase ?? "";
      const pks = get().tablePrimaryKeys;
      if (!t || pks.length === 0) return;
      try {
        await dbService.deleteRows(sessionId, db, t.schema, t.name, pks, pkValues);
        await get().refreshTableData();
      } catch (e) {
        console.error("Delete rows failed:", e);
        throw e;
      }
    },
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
