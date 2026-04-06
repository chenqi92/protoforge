// 数据库客户端服务层 — Tauri IPC 前端封装

import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  SavedConnection,
  SaveConnectionRequest,
  ServerInfo,
  QueryResult,
  DatabaseInfo,
  SchemaObjects,
  TableDescription,
  CellEdit,
  SqlValue,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
  QueryHistoryEntry,
} from "@/types/dbclient";

// ── 连接 ──

export async function connect(
  sessionId: string,
  config: ConnectionConfig,
): Promise<ServerInfo> {
  return invoke("db_client_connect", { sessionId, config });
}

export async function connectSaved(
  sessionId: string,
  connectionId: string,
): Promise<ServerInfo> {
  return invoke("db_client_connect_saved", { sessionId, connectionId });
}

export async function disconnect(sessionId: string): Promise<void> {
  return invoke("db_client_disconnect", { sessionId });
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<ServerInfo> {
  return invoke("db_client_test_connection", { config });
}

// ── Schema ──

export async function listDatabases(
  sessionId: string,
): Promise<DatabaseInfo[]> {
  return invoke("db_client_list_databases", { sessionId });
}

export async function listSchemaObjects(
  sessionId: string,
  database: string,
  schema: string,
): Promise<SchemaObjects> {
  return invoke("db_client_list_schema_objects", {
    sessionId,
    database,
    schema,
  });
}

export async function describeTable(
  sessionId: string,
  database: string,
  schema: string,
  table: string,
): Promise<TableDescription> {
  return invoke("db_client_describe_table", {
    sessionId,
    database,
    schema,
    table,
  });
}

// ── 查询 ──

export async function executeQuery(
  sessionId: string,
  sql: string,
  database?: string | null,
): Promise<QueryResult> {
  return invoke("db_client_execute_query", { sessionId, sql, database: database ?? null });
}

export async function cancelQuery(sessionId: string): Promise<void> {
  return invoke("db_client_cancel_query", { sessionId });
}

// ── 表数据 ──

export async function fetchTableData(
  sessionId: string,
  database: string,
  schema: string,
  table: string,
  offset: number,
  limit: number,
  sortColumn?: string | null,
  sortDir?: string | null,
  filter?: string | null,
): Promise<QueryResult> {
  return invoke("db_client_fetch_table_data", {
    sessionId,
    database,
    schema,
    table,
    offset,
    limit,
    sortColumn,
    sortDir,
    filter,
  });
}

export async function applyEdits(
  sessionId: string,
  edits: CellEdit[],
): Promise<number> {
  return invoke("db_client_apply_edits", { sessionId, edits });
}

export async function deleteRows(
  sessionId: string,
  database: string,
  schema: string,
  table: string,
  pkColumns: string[],
  pkValues: SqlValue[][],
): Promise<number> {
  return invoke("db_client_delete_rows", {
    sessionId,
    database,
    schema,
    table,
    pkColumns,
    pkValues,
  });
}

// ── 持久化 ──

export async function saveConnection(
  req: SaveConnectionRequest,
): Promise<string> {
  return invoke("db_client_save_connection", { req });
}

export async function listConnections(): Promise<SavedConnection[]> {
  return invoke("db_client_list_connections");
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("db_client_delete_connection", { id });
}

// ── 历史 ──

export async function addQueryHistory(
  entry: QueryHistoryEntry,
): Promise<void> {
  return invoke("db_client_add_query_history", { entry });
}

export async function listQueryHistory(
  connectionId?: string | null,
  limit?: number,
): Promise<QueryHistoryEntry[]> {
  return invoke("db_client_list_query_history", { connectionId, limit });
}

// ── 导入导出 ──

export async function exportDatabase(
  sessionId: string,
  config: ConnectionConfig,
  options: ExportOptions,
): Promise<ExportResult> {
  return invoke("db_client_export", { sessionId, config, options });
}

export async function importDatabase(
  sessionId: string,
  config: ConnectionConfig,
  options: ImportOptions,
): Promise<ImportResult> {
  return invoke("db_client_import", { sessionId, config, options });
}
