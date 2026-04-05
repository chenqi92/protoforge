// 数据库客户端类型定义

export type DbType = "postgresql" | "mysql" | "sqlite" | "influxdb";

// ── 连接配置 ──

export interface ConnectionConfig {
  dbType: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  filePath?: string | null;
  org?: string | null;
  token?: string | null;
}

export interface SavedConnection {
  id: string;
  name: string;
  dbType: DbType;
  host: string;
  port: number | null;
  databaseName: string;
  username: string;
  sslEnabled: boolean;
  filePath: string | null;
  org: string | null;
  colorLabel: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveConnectionRequest {
  id?: string | null;
  name: string;
  dbType: DbType;
  host: string;
  port?: number | null;
  databaseName: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  filePath?: string | null;
  org?: string | null;
  token?: string | null;
  colorLabel?: string | null;
  sortOrder?: number | null;
}

export interface ServerInfo {
  version: string;
  serverType: string;
  database: string | null;
}

// ── SQL 值 ──

export type SqlValue =
  | { type: "Null" }
  | { type: "Bool"; value: boolean }
  | { type: "Int"; value: number }
  | { type: "Float"; value: number }
  | { type: "Text"; value: string }
  | { type: "Bytes"; value: string }
  | { type: "Timestamp"; value: string }
  | { type: "Json"; value: unknown }
  | { type: "Array"; value: SqlValue[] };

// ── 查询结果 ──

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  maxLength: number | null;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: SqlValue[][];
  affectedRows: number | null;
  executionTimeMs: number;
  truncated: boolean;
  totalRows: number | null;
  warnings: string[];
}

// ── Schema ──

export interface DatabaseInfo {
  name: string;
  sizeBytes: number | null;
  encoding: string | null;
}

export interface SchemaObjects {
  schemas: string[];
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
}

export interface TableMeta {
  schema: string;
  name: string;
  rowCountEstimate: number | null;
  comment: string | null;
}

export interface FunctionMeta {
  schema: string;
  name: string;
  returnType: string | null;
}

export interface TableDescription {
  columns: ColumnDetail[];
  primaryKeys: string[];
  indexes: IndexInfo[];
  comment: string | null;
  rowCountEstimate: number | null;
}

export interface ColumnDetail {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  indexType: string | null;
}

// ── 数据编辑 ──

export interface CellEdit {
  database: string;
  schema: string;
  table: string;
  pkColumns: string[];
  pkValues: SqlValue[];
  column: string;
  newValue: SqlValue;
}

// ── 导入导出 ──

export interface ExportOptions {
  format: string;
  outputPath: string;
  database: string;
  schema?: string | null;
  tables: string[];
  dataOnly: boolean;
  schemaOnly: boolean;
  toolPath?: string | null;
}

export interface ImportOptions {
  filePath: string;
  database: string;
  schema?: string | null;
  toolPath?: string | null;
}

export interface ExportResult {
  outputPath: string;
  sizeBytes: number;
  durationMs: number;
}

export interface ImportResult {
  durationMs: number;
  warnings: string[];
}

// ── 查询历史 ──

export interface QueryHistoryEntry {
  id: string;
  connectionId: string | null;
  connectionName: string;
  dbType: string;
  databaseName: string;
  sqlText: string;
  executionMs: number | null;
  rowCount: number | null;
  status: "success" | "error";
  errorMessage: string | null;
  createdAt: string;
}

// ── 驱动能力 ──

export interface DriverCapabilities {
  supportsSchemas: boolean;
  supportsTransactions: boolean;
  supportsExplain: boolean;
  supportsCellEdit: boolean;
  supportsRowDelete: boolean;
  supportsImportExport: boolean;
  supportsMultipleDatabases: boolean;
  defaultPort: number;
}

// ── Schema 树节点 ──

export type SchemaNodeType =
  | "database"
  | "schema"
  | "table-group"
  | "view-group"
  | "function-group"
  | "table"
  | "view"
  | "function"
  | "column"
  | "index";

export interface SchemaTreeNode {
  id: string;
  name: string;
  nodeType: SchemaNodeType;
  children?: SchemaTreeNode[];
  loaded: boolean;
  metadata?: Record<string, string>;
}

// ── 工具函数 ──

export function sqlValueToString(val: SqlValue): string {
  switch (val.type) {
    case "Null":
      return "";
    case "Bool":
      return val.value ? "true" : "false";
    case "Int":
    case "Float":
      return String(val.value);
    case "Text":
    case "Timestamp":
      return val.value;
    case "Bytes":
      return `[BINARY]`;
    case "Json":
      return JSON.stringify(val.value);
    case "Array":
      return `[${val.value.map(sqlValueToString).join(", ")}]`;
  }
}

export function sqlValueDisplay(val: SqlValue): string {
  if (val.type === "Null") return "NULL";
  return sqlValueToString(val);
}

export const DB_TYPE_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  influxdb: "InfluxDB",
};

export const DB_TYPE_DEFAULTS: Record<DbType, Partial<ConnectionConfig>> = {
  postgresql: { host: "localhost", port: 5432, username: "postgres", database: "postgres" },
  mysql: { host: "localhost", port: 3306, username: "root", database: "" },
  sqlite: { host: "", port: 0, username: "", database: "" },
  influxdb: { host: "localhost", port: 8086, username: "", database: "" },
};
