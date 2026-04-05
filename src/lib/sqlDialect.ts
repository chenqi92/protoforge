// SQL 方言工具 — DDL 查询、Monaco 语言映射、数据库关键字
// 设计为可扩展的注册表模式，便于后续添加新数据库类型

import type { DbType } from "@/types/dbclient";

// ── Monaco 语言映射 ──

const MONACO_LANGUAGE_MAP: Record<DbType, string> = {
  postgresql: "pgsql",
  mysql: "mysql",
  sqlite: "sql",
  influxdb: "sql",
};

export function getMonacoLanguage(dbType: DbType | undefined | null): string {
  return dbType ? MONACO_LANGUAGE_MAP[dbType] ?? "sql" : "sql";
}

// ── DDL 查询生成 ──

export function getTableDdlQuery(
  dbType: DbType,
  schema: string,
  table: string,
): string {
  switch (dbType) {
    case "postgresql": {
      return [
        `-- DDL for ${schema ? schema + "." : ""}${table}`,
        `-- Columns`,
        `SELECT column_name, data_type, is_nullable, column_default`,
        `FROM information_schema.columns`,
        `WHERE table_schema = '${escLiteral(schema || "public")}' AND table_name = '${escLiteral(table)}'`,
        `ORDER BY ordinal_position;`,
      ].join("\n");
    }
    case "mysql":
      return `SHOW CREATE TABLE ${quoteIdentMysql(schema)}.${quoteIdentMysql(table)};`;
    case "sqlite":
      return `SELECT sql FROM sqlite_master WHERE type='table' AND name='${escLiteral(table)}';`;
    default:
      return `-- DDL not supported for ${dbType}`;
  }
}

export function getFunctionDdlQuery(
  dbType: DbType,
  schema: string,
  name: string,
): string {
  switch (dbType) {
    case "postgresql":
      return `SELECT pg_get_functiondef(p.oid)\nFROM pg_proc p\nJOIN pg_namespace n ON p.pronamespace = n.oid\nWHERE n.nspname = '${escLiteral(schema || "public")}' AND p.proname = '${escLiteral(name)}';`;
    case "mysql":
      return `SHOW CREATE FUNCTION ${quoteIdentMysql(schema)}.${quoteIdentMysql(name)};`;
    default:
      return `-- Function DDL not supported for ${dbType}`;
  }
}

// ── 复制用 SQL 模板 ──

export function getSelectQuery(
  dbType: DbType,
  schema: string,
  table: string,
  limit = 100,
): string {
  const fqn = formatTableRef(dbType, schema, table);
  switch (dbType) {
    case "mysql":
      return `SELECT * FROM ${fqn} LIMIT ${limit};`;
    case "postgresql":
      return `SELECT * FROM ${fqn} LIMIT ${limit};`;
    case "sqlite":
      return `SELECT * FROM ${fqn} LIMIT ${limit};`;
    default:
      return `SELECT * FROM ${fqn} LIMIT ${limit};`;
  }
}

export function getDropTableQuery(
  dbType: DbType,
  schema: string,
  table: string,
): string {
  const fqn = formatTableRef(dbType, schema, table);
  return `DROP TABLE ${fqn};`;
}

// ── 表引用格式化 ──

function formatTableRef(dbType: DbType, schema: string, table: string): string {
  switch (dbType) {
    case "mysql":
      return schema
        ? `${quoteIdentMysql(schema)}.${quoteIdentMysql(table)}`
        : quoteIdentMysql(table);
    case "postgresql":
      return schema
        ? `${quoteIdent(schema)}.${quoteIdent(table)}`
        : quoteIdent(table);
    default:
      return schema ? `"${schema}"."${table}"` : `"${table}"`;
  }
}

// ── 数据库特有关键字（用于补全增强）──

const PG_KEYWORDS = [
  "RETURNING", "ILIKE", "SIMILAR", "LATERAL", "MATERIALIZED",
  "CONCURRENTLY", "TABLESPACE", "EXTENSION", "SCHEMA",
  "INHERITS", "PARTITION", "EXCLUDE", "CONFLICT",
  "GENERATED", "IDENTITY", "OVERRIDING", "STORED",
  "NOTIFY", "LISTEN", "UNLISTEN", "VACUUM", "ANALYZE",
  "REINDEX", "CLUSTER", "REFRESH", "AGGREGATE",
  "SEQUENCE", "SERIAL", "BIGSERIAL", "SMALLSERIAL",
  "JSONB", "HSTORE", "ARRAY", "ENUM", "RANGE",
  "BYTEA", "UUID", "INET", "CIDR", "MACADDR",
  "TSVECTOR", "TSQUERY", "REGCLASS", "INTERVAL",
];

const MYSQL_KEYWORDS = [
  "ENGINE", "AUTO_INCREMENT", "CHARSET", "COLLATE",
  "UNSIGNED", "ZEROFILL", "BINARY", "VARBINARY",
  "TINYINT", "MEDIUMINT", "BIGINT", "TINYTEXT",
  "MEDIUMTEXT", "LONGTEXT", "TINYBLOB", "MEDIUMBLOB",
  "LONGBLOB", "ENUM", "SET", "JSON", "GEOMETRY",
  "SPATIAL", "FULLTEXT", "PARTITION", "SUBPARTITION",
  "ALGORITHM", "DEFINER", "INVOKER", "DETERMINISTIC",
  "SQL_CALC_FOUND_ROWS", "STRAIGHT_JOIN", "HIGH_PRIORITY",
  "LOW_PRIORITY", "DELAYED", "IGNORE", "REPLACE",
  "DUPLICATE", "OUTFILE", "INFILE", "TERMINATED",
  "ENCLOSED", "ESCAPED", "LINES", "STARTING",
  "SHOW", "DESCRIBE", "EXPLAIN", "USE", "STATUS",
  "VARIABLES", "PROCESSLIST", "GRANTS", "PRIVILEGES",
];

const SQLITE_KEYWORDS = [
  "AUTOINCREMENT", "GLOB", "VACUUM", "ATTACH",
  "DETACH", "PRAGMA", "REINDEX", "EXPLAIN",
  "CONFLICT", "ABORT", "FAIL", "ROLLBACK",
  "REPLACE", "IGNORE", "TEMP", "TEMPORARY",
  "WITHOUT", "ROWID", "STRICT", "RETURNING",
  "INDEXED", "UNINDEXED", "VIRTUAL", "USING",
];

const DB_KEYWORDS: Record<DbType, string[]> = {
  postgresql: PG_KEYWORDS,
  mysql: MYSQL_KEYWORDS,
  sqlite: SQLITE_KEYWORDS,
  influxdb: [],
};

export function getDbKeywords(dbType: DbType | undefined | null): string[] {
  return dbType ? DB_KEYWORDS[dbType] ?? [] : [];
}

// ── 内部工具函数 ──

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteIdentMysql(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function escLiteral(s: string): string {
  return s.replace(/'/g, "''");
}
