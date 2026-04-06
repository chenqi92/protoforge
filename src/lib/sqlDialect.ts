// SQL 方言工具 — DDL 查询、Monaco 语言映射、数据库关键字
// 设计为可扩展的注册表模式，便于后续添加新数据库类型

import type { DbType, ColumnDetail } from "@/types/dbclient";

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
      const pgSchema = schema || "public";
      // 使用 pg_dump 风格的 DDL 生成，先尝试获取完整建表语句
      return `SELECT
  'CREATE TABLE ' || quote_ident(c.table_schema) || '.' || quote_ident(c.table_name) || E' (\\n' ||
  string_agg(
    '    ' || quote_ident(c.column_name) || ' ' ||
    CASE
      WHEN c.data_type = 'character varying' THEN 'varchar(' || c.character_maximum_length || ')'
      WHEN c.data_type = 'character' THEN 'char(' || c.character_maximum_length || ')'
      WHEN c.data_type = 'numeric' THEN 'numeric' || COALESCE('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
      WHEN c.domain_name IS NOT NULL THEN c.domain_name
      ELSE c.data_type
    END ||
    CASE WHEN c.column_default IS NOT NULL THEN ' DEFAULT ' || c.column_default ELSE '' END ||
    CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
    E',\\n' ORDER BY c.ordinal_position
  ) ||
  COALESCE(E',\\n    ' || (
    SELECT string_agg(
      CASE con.contype
        WHEN 'p' THEN 'CONSTRAINT ' || quote_ident(con.conname) || ' PRIMARY KEY (' ||
          (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(con.conkey, a.attnum))
           FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) || ')'
        WHEN 'u' THEN 'CONSTRAINT ' || quote_ident(con.conname) || ' UNIQUE (' ||
          (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(con.conkey, a.attnum))
           FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) || ')'
      END,
      E',\\n    '
    )
    FROM pg_constraint con
    WHERE con.conrelid = (quote_ident('${escLiteral(pgSchema)}') || '.' || quote_ident('${escLiteral(table)}'))::regclass
      AND con.contype IN ('p', 'u')
  ), '') ||
  E'\\n);' AS ddl
FROM information_schema.columns c
WHERE c.table_schema = '${escLiteral(pgSchema)}' AND c.table_name = '${escLiteral(table)}';`;
    }
    case "mysql":
      // MySQL 的 SHOW CREATE TABLE 只需要表名，数据库上下文由 USE 语句处理
      return `SHOW CREATE TABLE ${quoteIdentMysql(table)};`;
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

// ── ALTER TABLE SQL 生成 ──

export function generateAlterTableSQL(
  dbType: DbType,
  schema: string,
  table: string,
  original: ColumnDetail[],
  edited: ColumnDetail[],
  deletedColumns: string[],
  addedColumns: ColumnDetail[],
): string[] {
  const statements: string[] = [];
  const fqn = formatTableRef(dbType, schema, table);

  // 删除列
  for (const colName of deletedColumns) {
    const qc = dbType === "mysql" ? quoteIdentMysql(colName) : quoteIdent(colName);
    statements.push(`ALTER TABLE ${fqn} DROP COLUMN ${qc};`);
  }

  // 新增列
  const addedNames = new Set(addedColumns.map(c => c.name));
  for (const col of edited) {
    if (!addedNames.has(col.name)) continue;
    statements.push(`ALTER TABLE ${fqn} ADD COLUMN ${buildColDef(dbType, col)};`);
  }

  // 修改列（比较 original vs edited）
  for (const editedCol of edited) {
    if (addedNames.has(editedCol.name) && !original.some(o => o.name === editedCol.name)) continue;
    const origCol = original.find(c => c.name === editedCol.name);
    if (!origCol) {
      // 可能是 rename：查找同位置的原始列
      const editedIdx = edited.indexOf(editedCol);
      const possibleOrig = original[editedIdx];
      if (possibleOrig && !edited.some(e => e.name === possibleOrig.name) && !deletedColumns.includes(possibleOrig.name)) {
        // rename + 可能的类型修改
        statements.push(...generateRenameAndModify(dbType, fqn, possibleOrig, editedCol));
      }
      continue;
    }
    if (hasColumnChanged(origCol, editedCol)) {
      statements.push(...generateModifyColumn(dbType, fqn, origCol, editedCol));
    }
  }

  return statements;
}

function hasColumnChanged(a: ColumnDetail, b: ColumnDetail): boolean {
  return a.name !== b.name || a.dataType !== b.dataType
    || a.nullable !== b.nullable || a.defaultValue !== b.defaultValue
    || a.comment !== b.comment;
}

function generateRenameAndModify(dbType: DbType, fqn: string, oldCol: ColumnDetail, newCol: ColumnDetail): string[] {
  const stmts: string[] = [];
  switch (dbType) {
    case "mysql":
      stmts.push(`ALTER TABLE ${fqn} CHANGE COLUMN ${quoteIdentMysql(oldCol.name)} ${buildColDef("mysql", newCol)};`);
      break;
    case "postgresql":
      if (oldCol.name !== newCol.name) {
        stmts.push(`ALTER TABLE ${fqn} RENAME COLUMN ${quoteIdent(oldCol.name)} TO ${quoteIdent(newCol.name)};`);
      }
      stmts.push(...generatePgAlterProps(fqn, { ...oldCol, name: newCol.name }, newCol));
      break;
    case "sqlite":
      if (oldCol.name !== newCol.name) {
        stmts.push(`ALTER TABLE ${fqn} RENAME COLUMN "${oldCol.name}" TO "${newCol.name}";`);
      }
      break;
  }
  return stmts;
}

function generateModifyColumn(dbType: DbType, fqn: string, oldCol: ColumnDetail, newCol: ColumnDetail): string[] {
  switch (dbType) {
    case "mysql":
      if (oldCol.name !== newCol.name) {
        return [`ALTER TABLE ${fqn} CHANGE COLUMN ${quoteIdentMysql(oldCol.name)} ${buildColDef("mysql", newCol)};`];
      }
      return [`ALTER TABLE ${fqn} MODIFY COLUMN ${buildColDef("mysql", newCol)};`];
    case "postgresql": {
      const stmts: string[] = [];
      if (oldCol.name !== newCol.name) {
        stmts.push(`ALTER TABLE ${fqn} RENAME COLUMN ${quoteIdent(oldCol.name)} TO ${quoteIdent(newCol.name)};`);
      }
      stmts.push(...generatePgAlterProps(fqn, { ...oldCol, name: newCol.name }, newCol));
      return stmts;
    }
    case "sqlite":
      if (oldCol.name !== newCol.name) {
        return [`ALTER TABLE ${fqn} RENAME COLUMN "${oldCol.name}" TO "${newCol.name}";`];
      }
      return [`-- SQLite 不支持修改列类型或约束`];
    default:
      return [];
  }
}

function generatePgAlterProps(fqn: string, oldCol: ColumnDetail, newCol: ColumnDetail): string[] {
  const stmts: string[] = [];
  const qn = quoteIdent(newCol.name);
  if (oldCol.dataType !== newCol.dataType) {
    stmts.push(`ALTER TABLE ${fqn} ALTER COLUMN ${qn} TYPE ${newCol.dataType};`);
  }
  if (oldCol.nullable !== newCol.nullable) {
    stmts.push(`ALTER TABLE ${fqn} ALTER COLUMN ${qn} ${newCol.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
  }
  if (oldCol.defaultValue !== newCol.defaultValue) {
    stmts.push(newCol.defaultValue == null
      ? `ALTER TABLE ${fqn} ALTER COLUMN ${qn} DROP DEFAULT;`
      : `ALTER TABLE ${fqn} ALTER COLUMN ${qn} SET DEFAULT ${newCol.defaultValue};`);
  }
  if (oldCol.comment !== newCol.comment) {
    stmts.push(`COMMENT ON COLUMN ${fqn}.${qn} IS '${escLiteral(newCol.comment ?? "")}';`);
  }
  return stmts;
}

function buildColDef(dbType: DbType, col: ColumnDetail): string {
  const q = dbType === "mysql" ? quoteIdentMysql : quoteIdent;
  let def = `${q(col.name)} ${col.dataType}`;
  if (!col.nullable) def += " NOT NULL";
  if (col.defaultValue != null) def += ` DEFAULT ${col.defaultValue}`;
  if (col.comment && dbType === "mysql") def += ` COMMENT '${escLiteral(col.comment)}'`;
  return def;
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
