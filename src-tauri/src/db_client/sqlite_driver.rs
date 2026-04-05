// SQLite 驱动实现 — 打开外部 .db 文件（区别于应用自身的 sqlx 池）

use super::driver::{*, quote_sqlite_ident};
use async_trait::async_trait;
use rusqlite::{Connection, types::Value as SqliteValue};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SqliteDriver {
    config: SqliteConfig,
    conn: Arc<Mutex<Option<Connection>>>,
}

pub struct SqliteConfig {
    pub file_path: String,
}

impl SqliteDriver {
    pub fn new(config: SqliteConfig) -> Self {
        Self {
            config,
            conn: Arc::new(Mutex::new(None)),
        }
    }

    fn with_conn<F, R>(&self, guard: &tokio::sync::MutexGuard<'_, Option<Connection>>, f: F) -> Result<R, String>
    where
        F: FnOnce(&Connection) -> Result<R, String>,
    {
        match guard.as_ref() {
            Some(conn) => f(conn),
            None => Err("Not connected".to_string()),
        }
    }
}

#[async_trait]
impl DbDriver for SqliteDriver {
    async fn connect(&mut self) -> Result<ServerInfo, String> {
        let path = PathBuf::from(&self.config.file_path);
        let conn = Connection::open(&path)
            .map_err(|e| format!("Failed to open SQLite database: {}", e))?;

        // 获取版本
        let version: String = conn
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .map_err(|e| format!("Version query failed: {}", e))?;

        *self.conn.lock().await = Some(conn);

        Ok(ServerInfo {
            version: format!("SQLite {}", version),
            server_type: "SQLite".to_string(),
            database: Some(
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            ),
        })
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        *self.conn.lock().await = None;
        Ok(())
    }

    async fn ping(&self) -> Result<(), String> {
        let guard = self.conn.lock().await;
        self.with_conn(&guard, |conn| {
            conn.query_row("SELECT 1", [], |_| Ok(()))
                .map_err(|e| format!("Ping failed: {}", e))
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;
        let start = std::time::Instant::now();

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let col_count = stmt.column_count();
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let columns: Vec<ColumnInfo> = (0..col_count)
            .map(|i| ColumnInfo {
                name: col_names.get(i).cloned().unwrap_or_else(|| "?".to_string()),
                data_type: "TEXT".to_string(),
                nullable: true,
                is_primary_key: false,
                max_length: None,
            })
            .collect();

        let mut rows_data: Vec<Vec<SqlValue>> = Vec::new();
        let mut rows_iter = stmt
            .query([])
            .map_err(|e| format!("Query failed: {}", e))?;

        while let Some(row) = rows_iter
            .next()
            .map_err(|e| format!("Row fetch failed: {}", e))?
        {
            let mut values = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: SqliteValue = match row.get_ref(i) {
                    Ok(vr) => SqliteValue::from(vr),
                    Err(_) => SqliteValue::Null,
                };
                values.push(sqlite_to_sql_value(&val));
            }
            rows_data.push(values);
        }

        let elapsed = start.elapsed().as_millis() as u64;
        let row_count = rows_data.len();

        Ok(QueryResult {
            columns,
            rows: rows_data,
            affected_rows: None,
            execution_time_ms: elapsed,
            truncated: false,
            total_rows: Some(row_count as i64),
            warnings: vec![],
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;
        let affected = conn
            .execute(sql, [])
            .map_err(|e| format!("Execution failed: {}", e))?;
        Ok(affected as u64)
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        // SQLite 没有数据库列表的概念，返回当前文件
        let name = PathBuf::from(&self.config.file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| self.config.file_path.clone());

        let size = std::fs::metadata(&self.config.file_path)
            .ok()
            .map(|m| m.len() as i64);

        Ok(vec![DatabaseInfo {
            name,
            size_bytes: size,
            encoding: Some("UTF-8".to_string()),
        }])
    }

    async fn list_schema_objects(
        &self,
        _database: &str,
        _schema: &str,
    ) -> Result<SchemaObjects, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;

        // 列出表
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| format!("List tables failed: {}", e))?;
        let tables: Vec<TableMeta> = stmt
            .query_map([], |row| {
                Ok(TableMeta {
                    schema: "main".to_string(),
                    name: row.get(0)?,
                    row_count_estimate: None,
                    comment: None,
                })
            })
            .map_err(|e| format!("Query tables failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // 列出视图
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
            .map_err(|e| format!("List views failed: {}", e))?;
        let views: Vec<TableMeta> = stmt
            .query_map([], |row| {
                Ok(TableMeta {
                    schema: "main".to_string(),
                    name: row.get(0)?,
                    row_count_estimate: None,
                    comment: None,
                })
            })
            .map_err(|e| format!("Query views failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(SchemaObjects {
            schemas: vec!["main".to_string()],
            tables,
            views,
            functions: vec![],
        })
    }

    async fn describe_table(
        &self,
        _database: &str,
        _schema: &str,
        table: &str,
    ) -> Result<TableDescription, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;

        // PRAGMA table_info
        let safe_table = quote_sqlite_ident(table)?;
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", safe_table))
            .map_err(|e| format!("Describe table failed: {}", e))?;

        let mut primary_keys = Vec::new();
        let columns: Vec<ColumnDetail> = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                let data_type: String = row.get(2)?;
                let not_null: bool = row.get(3)?;
                let default: Option<String> = row.get(4)?;
                let pk: i32 = row.get(5)?;
                Ok((name, data_type, not_null, default, pk))
            })
            .map_err(|e| format!("Query columns failed: {}", e))?
            .filter_map(|r| r.ok())
            .map(|(name, data_type, not_null, default, pk)| {
                let is_pk = pk > 0;
                if is_pk {
                    primary_keys.push(name.clone());
                }
                ColumnDetail {
                    name,
                    data_type,
                    nullable: !not_null,
                    default_value: default,
                    is_primary_key: is_pk,
                    comment: None,
                    max_length: None,
                }
            })
            .collect();

        // 索引
        let mut stmt = conn
            .prepare(&format!("PRAGMA index_list({})", safe_table))
            .map_err(|e| format!("List indexes failed: {}", e))?;
        let idx_list: Vec<(String, bool)> = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                let unique: bool = row.get(2)?;
                Ok((name, unique))
            })
            .map_err(|e| format!("Query indexes failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        let mut indexes = Vec::new();
        for (idx_name, unique) in idx_list {
            let safe_idx = quote_sqlite_ident(&idx_name).unwrap_or_else(|_| format!("\"{}\"", idx_name));
            let mut stmt = conn
                .prepare(&format!("PRAGMA index_info({})", safe_idx))
                .map_err(|e| format!("Index info failed: {}", e))?;
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get(2))
                .map_err(|e| format!("Query index cols failed: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            indexes.push(IndexInfo {
                name: idx_name,
                columns: cols,
                unique,
                index_type: None,
            });
        }

        // 行数
        let count: Option<i64> = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", safe_table),
                [],
                |row| row.get(0),
            )
            .ok();

        Ok(TableDescription {
            columns,
            primary_keys,
            indexes,
            comment: None,
            row_count_estimate: count,
        })
    }

    async fn fetch_table_data(
        &self,
        _database: &str,
        _schema: &str,
        table: &str,
        offset: i64,
        limit: i64,
        sort_column: Option<&str>,
        sort_dir: Option<&str>,
        _filter: Option<&str>,
    ) -> Result<QueryResult, String> {
        let safe_table = quote_sqlite_ident(table)?;
        let order = match sort_column {
            Some(col) => {
                validate_identifier(col)?;
                let dir = if sort_dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") { "DESC" } else { "ASC" };
                format!("ORDER BY {} {}", quote_sqlite_ident(col)?, dir)
            }
            None => String::new(),
        };
        let sql = format!(
            "SELECT * FROM {} {} LIMIT {} OFFSET {}",
            safe_table, order, limit, offset
        );
        self.execute_query(&sql).await
    }

    async fn apply_cell_edits(&self, edits: &[CellEdit]) -> Result<u64, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;
        let mut affected = 0u64;
        for edit in edits {
            let where_parts: Vec<String> = edit
                .pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| {
                    format!("\"{}\" = {}", col, sql_value_literal_sqlite(&edit.pk_values[i]))
                })
                .collect();
            let sql = format!(
                "UPDATE \"{}\" SET \"{}\" = {} WHERE {}",
                edit.table,
                edit.column,
                sql_value_literal_sqlite(&edit.new_value),
                where_parts.join(" AND ")
            );
            let n = conn
                .execute(&sql, [])
                .map_err(|e| format!("Edit failed: {}", e))?;
            affected += n as u64;
        }
        Ok(affected)
    }

    async fn delete_rows(
        &self,
        _database: &str,
        _schema: &str,
        table: &str,
        pk_columns: &[String],
        pk_values: &[Vec<SqlValue>],
    ) -> Result<u64, String> {
        let guard = self.conn.lock().await;
        let conn = guard.as_ref().ok_or_else(|| "Not connected".to_string())?;
        let mut affected = 0u64;
        for row_pks in pk_values {
            let where_parts: Vec<String> = pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| format!("\"{}\" = {}", col, sql_value_literal_sqlite(&row_pks[i])))
                .collect();
            let sql = format!(
                "DELETE FROM \"{}\" WHERE {}",
                table, where_parts.join(" AND ")
            );
            let n = conn
                .execute(&sql, [])
                .map_err(|e| format!("Delete failed: {}", e))?;
            affected += n as u64;
        }
        Ok(affected)
    }

    async fn cancel_query(&self) -> Result<(), String> {
        // SQLite 同步执行，不支持取消
        Ok(())
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_schemas: false,
            supports_transactions: true,
            supports_explain: true,
            supports_cell_edit: true,
            supports_row_delete: true,
            supports_import_export: true,
            supports_multiple_databases: false,
            default_port: 0,
        }
    }
}

fn sqlite_to_sql_value(val: &SqliteValue) -> SqlValue {
    match val {
        SqliteValue::Null => SqlValue::Null,
        SqliteValue::Integer(i) => SqlValue::Int(*i),
        SqliteValue::Real(f) => SqlValue::Float(*f),
        SqliteValue::Text(s) => SqlValue::Text(s.clone()),
        SqliteValue::Blob(b) => {
            use base64::Engine;
            SqlValue::Bytes(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

fn sql_value_literal_sqlite(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        SqlValue::Int(i) => i.to_string(),
        SqlValue::Float(f) => f.to_string(),
        SqlValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
        SqlValue::Bytes(b64) => format!("X'{}'", b64),
        SqlValue::Timestamp(ts) => format!("'{}'", ts.replace('\'', "''")),
        SqlValue::Json(v) => format!("'{}'", v.to_string().replace('\'', "''")),
        SqlValue::Array(_) => "'(array)'".to_string(),
    }
}
