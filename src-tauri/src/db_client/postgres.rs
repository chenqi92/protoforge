// PostgreSQL 驱动实现

use super::driver::{*, validate_identifier, quote_pg_ident};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls, types::Type};

pub struct PostgresDriver {
    config: PostgresConfig,
    client: Option<Arc<Client>>,
    cancel_token: Arc<Mutex<Option<tokio_postgres::CancelToken>>>,
}

#[allow(dead_code)]
pub struct PostgresConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
}

impl PostgresDriver {
    pub fn new(config: PostgresConfig) -> Self {
        Self {
            config,
            client: None,
            cancel_token: Arc::new(Mutex::new(None)),
        }
    }

    fn client(&self) -> Result<&Client, String> {
        self.client.as_ref().map(|c| c.as_ref()).ok_or_else(|| "Not connected".to_string())
    }

    fn row_to_values(row: &tokio_postgres::Row) -> Vec<SqlValue> {
        let mut values = Vec::with_capacity(row.len());
        for i in 0..row.len() {
            let col_type = row.columns()[i].type_();
            let val = Self::extract_value(row, i, col_type);
            values.push(val);
        }
        values
    }

    fn extract_value(row: &tokio_postgres::Row, idx: usize, col_type: &Type) -> SqlValue {
        // 尝试用 Option<String> 检查 NULL（通用方法）
        // 对每种具体类型，try_get 遇到 NULL 会返回 Err

        match *col_type {
            Type::BOOL => match row.try_get::<_, bool>(idx) {
                Ok(v) => SqlValue::Bool(v),
                Err(_) => SqlValue::Null,
            },
            Type::INT2 => match row.try_get::<_, i16>(idx) {
                Ok(v) => SqlValue::Int(v as i64),
                Err(_) => SqlValue::Null,
            },
            Type::INT4 => match row.try_get::<_, i32>(idx) {
                Ok(v) => SqlValue::Int(v as i64),
                Err(_) => SqlValue::Null,
            },
            Type::INT8 => match row.try_get::<_, i64>(idx) {
                Ok(v) => SqlValue::Int(v),
                Err(_) => SqlValue::Null,
            },
            Type::FLOAT4 => match row.try_get::<_, f32>(idx) {
                Ok(v) => SqlValue::Float(v as f64),
                Err(_) => SqlValue::Null,
            },
            Type::FLOAT8 => match row.try_get::<_, f64>(idx) {
                Ok(v) => SqlValue::Float(v),
                Err(_) => SqlValue::Null,
            },
            Type::NUMERIC => {
                // NUMERIC 类型用字符串表示，避免精度丢失
                match row.try_get::<_, String>(idx) {
                    Ok(v) => SqlValue::Text(v),
                    Err(_) => SqlValue::Null,
                }
            }
            Type::JSON | Type::JSONB => match row.try_get::<_, serde_json::Value>(idx) {
                Ok(v) => SqlValue::Json(v),
                Err(_) => SqlValue::Null,
            },
            Type::BYTEA => match row.try_get::<_, Vec<u8>>(idx) {
                Ok(v) => {
                    use base64::Engine;
                    SqlValue::Bytes(base64::engine::general_purpose::STANDARD.encode(&v))
                }
                Err(_) => SqlValue::Null,
            },
            Type::TIMESTAMP | Type::TIMESTAMPTZ => {
                match row.try_get::<_, chrono::NaiveDateTime>(idx) {
                    Ok(v) => SqlValue::Timestamp(v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
                    Err(_) => match row.try_get::<_, chrono::DateTime<chrono::Utc>>(idx) {
                        Ok(v) => SqlValue::Timestamp(v.to_rfc3339()),
                        Err(_) => SqlValue::Null,
                    },
                }
            }
            Type::DATE => match row.try_get::<_, chrono::NaiveDate>(idx) {
                Ok(v) => SqlValue::Text(v.format("%Y-%m-%d").to_string()),
                Err(_) => SqlValue::Null,
            },
            Type::TIME | Type::TIMETZ => match row.try_get::<_, chrono::NaiveTime>(idx) {
                Ok(v) => SqlValue::Text(v.format("%H:%M:%S%.f").to_string()),
                Err(_) => SqlValue::Null,
            },
            // 默认全部转字符串
            _ => match row.try_get::<_, String>(idx) {
                Ok(v) => SqlValue::Text(v),
                Err(_) => {
                    // 某些类型无法直接转字符串，使用 Debug 格式
                    SqlValue::Text(format!("(unsupported: {})", col_type.name()))
                }
            },
        }
    }

    fn col_info(col: &tokio_postgres::Column) -> ColumnInfo {
        ColumnInfo {
            name: col.name().to_string(),
            data_type: col.type_().name().to_string(),
            nullable: true,
            is_primary_key: false,
            max_length: None,
        }
    }
}

#[async_trait]
impl DbDriver for PostgresDriver {
    async fn connect(&mut self) -> Result<ServerInfo, String> {
        let conn_str = format!(
            "host={} port={} dbname={} user={} password={}",
            self.config.host, self.config.port, self.config.database,
            self.config.username, self.config.password
        );

        let (client, connection) = tokio_postgres::connect(&conn_str, NoTls)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        // 从 client 获取 cancel token（不是 connection）
        let cancel = client.cancel_token();
        *self.cancel_token.lock().await = Some(cancel);

        // 后台运行连接
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                log::error!("PostgreSQL connection error: {}", e);
            }
        });

        // 获取版本
        let version_row = client
            .query_one("SELECT version()", &[])
            .await
            .map_err(|e| format!("Failed to get version: {}", e))?;
        let version: String = version_row.get(0);

        let client = Arc::new(client);
        self.client = Some(client);

        Ok(ServerInfo {
            version,
            server_type: "PostgreSQL".to_string(),
            database: Some(self.config.database.clone()),
        })
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        self.client = None;
        *self.cancel_token.lock().await = None;
        Ok(())
    }

    async fn ping(&self) -> Result<(), String> {
        let client = self.client()?;
        client
            .query_one("SELECT 1", &[])
            .await
            .map_err(|e| format!("Ping failed: {}", e))?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let client = self.client()?;
        let start = std::time::Instant::now();
        let rows = client
            .query(sql, &[])
            .await
            .map_err(|e| format!("Query failed: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;

        let columns: Vec<ColumnInfo> = if rows.is_empty() {
            // 尝试用 prepare 获取列信息
            match client.prepare(sql).await {
                Ok(stmt) => stmt.columns().iter().map(Self::col_info).collect(),
                Err(_) => vec![],
            }
        } else {
            rows[0].columns().iter().map(Self::col_info).collect()
        };

        let data: Vec<Vec<SqlValue>> = rows.iter().map(Self::row_to_values).collect();
        let row_count = data.len();

        Ok(QueryResult {
            columns,
            rows: data,
            affected_rows: None,
            execution_time_ms: elapsed,
            truncated: false,
            total_rows: Some(row_count as i64),
            warnings: vec![],
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, String> {
        let client = self.client()?;
        client
            .execute(sql, &[])
            .await
            .map_err(|e| format!("Execution failed: {}", e))
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        let client = self.client()?;
        let rows = client
            .query(
                "SELECT datname, pg_database_size(datname) as size_bytes, pg_encoding_to_char(encoding) as enc \
                 FROM pg_database WHERE datistemplate = false ORDER BY datname",
                &[],
            )
            .await
            .map_err(|e| format!("List databases failed: {}", e))?;

        Ok(rows
            .iter()
            .map(|r| DatabaseInfo {
                name: r.get(0),
                size_bytes: r.try_get::<_, i64>(1).ok(),
                encoding: r.try_get::<_, String>(2).ok(),
            })
            .collect())
    }

    async fn list_schema_objects(
        &self,
        _database: &str,
        schema: &str,
    ) -> Result<SchemaObjects, String> {
        let client = self.client()?;

        // 列出 schema
        let schema_rows = client
            .query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name NOT IN ('pg_toast','pg_catalog','information_schema') \
                 ORDER BY schema_name",
                &[],
            )
            .await
            .map_err(|e| format!("List schemas failed: {}", e))?;
        let schemas: Vec<String> = schema_rows.iter().map(|r| r.get(0)).collect();

        let effective_schema = if schema.is_empty() { "public" } else { schema };

        // 列出表
        let table_rows = client
            .query(
                "SELECT schemaname, tablename, \
                 (SELECT reltuples::bigint FROM pg_class WHERE oid = (schemaname || '.' || tablename)::regclass) as est_rows, \
                 obj_description((schemaname || '.' || tablename)::regclass, 'pg_class') as cmt \
                 FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
                &[&effective_schema],
            )
            .await
            .map_err(|e| format!("List tables failed: {}", e))?;
        let tables: Vec<TableMeta> = table_rows
            .iter()
            .map(|r| TableMeta {
                schema: r.get(0),
                name: r.get(1),
                row_count_estimate: r.try_get::<_, i64>(2).ok(),
                comment: r.try_get::<_, String>(3).ok(),
            })
            .collect();

        // 列出视图
        let view_rows = client
            .query(
                "SELECT schemaname, viewname FROM pg_views WHERE schemaname = $1 ORDER BY viewname",
                &[&effective_schema],
            )
            .await
            .map_err(|e| format!("List views failed: {}", e))?;
        let views: Vec<TableMeta> = view_rows
            .iter()
            .map(|r| TableMeta {
                schema: r.get(0),
                name: r.get(1),
                row_count_estimate: None,
                comment: None,
            })
            .collect();

        // 列出函数
        let fn_rows = client
            .query(
                "SELECT n.nspname, p.proname, pg_get_function_result(p.oid) as ret \
                 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid \
                 WHERE n.nspname = $1 AND p.prokind = 'f' ORDER BY p.proname LIMIT 200",
                &[&effective_schema],
            )
            .await
            .map_err(|e| format!("List functions failed: {}", e))?;
        let functions: Vec<FunctionMeta> = fn_rows
            .iter()
            .map(|r| FunctionMeta {
                schema: r.get(0),
                name: r.get(1),
                return_type: r.try_get::<_, String>(2).ok(),
            })
            .collect();

        Ok(SchemaObjects {
            schemas,
            tables,
            views,
            functions,
        })
    }

    async fn describe_table(
        &self,
        _database: &str,
        schema: &str,
        table: &str,
    ) -> Result<TableDescription, String> {
        let client = self.client()?;
        let effective_schema = if schema.is_empty() { "public" } else { schema };

        // 获取列信息
        let col_rows = client
            .query(
                "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, \
                 c.character_maximum_length, \
                 col_description((table_schema || '.' || table_name)::regclass, c.ordinal_position) as cmt \
                 FROM information_schema.columns c \
                 WHERE c.table_schema = $1 AND c.table_name = $2 \
                 ORDER BY c.ordinal_position",
                &[&effective_schema, &table],
            )
            .await
            .map_err(|e| format!("Describe table failed: {}", e))?;

        // 获取主键列
        let pk_rows = client
            .query(
                "SELECT a.attname \
                 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
                 WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary \
                 ORDER BY a.attnum",
                &[&effective_schema, &table],
            )
            .await
            .map_err(|e| format!("Get PKs failed: {}", e))?;
        let primary_keys: Vec<String> = pk_rows.iter().map(|r| r.get(0)).collect();

        let columns: Vec<ColumnDetail> = col_rows
            .iter()
            .map(|r| {
                let name: String = r.get(0);
                ColumnDetail {
                    is_primary_key: primary_keys.contains(&name),
                    name,
                    data_type: r.get(1),
                    nullable: r.get::<_, String>(2) == "YES",
                    default_value: r.try_get::<_, String>(3).ok(),
                    max_length: r.try_get::<_, i32>(4).ok().map(|v| v as i64),
                    comment: r.try_get::<_, String>(5).ok(),
                }
            })
            .collect();

        // 获取索引
        let idx_rows = client
            .query(
                "SELECT i.relname, array_agg(a.attname ORDER BY x.n), ix.indisunique, am.amname \
                 FROM pg_index ix \
                 JOIN pg_class i ON i.oid = ix.indexrelid \
                 JOIN pg_am am ON am.oid = i.relam \
                 JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON TRUE \
                 JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = x.attnum \
                 WHERE ix.indrelid = ($1 || '.' || $2)::regclass \
                 GROUP BY i.relname, ix.indisunique, am.amname \
                 ORDER BY i.relname",
                &[&effective_schema, &table],
            )
            .await
            .map_err(|e| format!("List indexes failed: {}", e))?;
        let indexes: Vec<IndexInfo> = idx_rows
            .iter()
            .map(|r| IndexInfo {
                name: r.get(0),
                columns: r.get::<_, Vec<String>>(1),
                unique: r.get(2),
                index_type: r.try_get::<_, String>(3).ok(),
            })
            .collect();

        // 行数估算
        let count_row = client
            .query_one(
                "SELECT reltuples::bigint FROM pg_class WHERE oid = ($1 || '.' || $2)::regclass",
                &[&effective_schema, &table],
            )
            .await;
        let row_count_estimate = count_row.ok().and_then(|r| r.try_get::<_, i64>(0).ok());

        // 表注释
        let cmt_row = client
            .query_one(
                "SELECT obj_description(($1 || '.' || $2)::regclass, 'pg_class')",
                &[&effective_schema, &table],
            )
            .await;
        let comment = cmt_row.ok().and_then(|r| r.try_get::<_, String>(0).ok());

        Ok(TableDescription {
            columns,
            primary_keys,
            indexes,
            comment,
            row_count_estimate,
        })
    }

    async fn fetch_table_data(
        &self,
        _database: &str,
        schema: &str,
        table: &str,
        offset: i64,
        limit: i64,
        sort_column: Option<&str>,
        sort_dir: Option<&str>,
        filter: Option<&str>,
    ) -> Result<QueryResult, String> {
        let effective_schema = if schema.is_empty() { "public" } else { schema };
        validate_identifier(effective_schema)?;
        validate_identifier(table)?;
        let quoted_table = format!("{}.{}", quote_pg_ident(effective_schema)?, quote_pg_ident(table)?);
        let where_clause = match filter {
            Some(f) if !f.trim().is_empty() => format!("WHERE {}", f),
            _ => String::new(),
        };
        let order = match sort_column {
            Some(col) => {
                validate_identifier(col)?;
                let safe_dir = if sort_dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") { "DESC" } else { "ASC" };
                format!("ORDER BY {} {}", quote_pg_ident(col)?, safe_dir)
            }
            None => String::new(),
        };
        // 查总行数
        let count_sql = format!("SELECT COUNT(*) FROM {} {}", quoted_table, where_clause);
        let total_rows: Option<i64> = match self.execute_query(&count_sql).await {
            Ok(cr) if !cr.rows.is_empty() && !cr.rows[0].is_empty() => {
                match &cr.rows[0][0] {
                    SqlValue::Int(n) => Some(*n),
                    SqlValue::Text(s) => s.parse().ok(),
                    _ => None,
                }
            }
            _ => None,
        };
        let sql = if limit > 0 {
            format!("SELECT * FROM {} {} {} LIMIT {} OFFSET {}", quoted_table, where_clause, order, limit, offset)
        } else {
            format!("SELECT * FROM {} {} {}", quoted_table, where_clause, order)
        };
        let mut result = self.execute_query(&sql).await?;
        result.total_rows = total_rows;
        Ok(result)
    }

    async fn apply_cell_edits(&self, edits: &[CellEdit]) -> Result<u64, String> {
        let client = self.client()?;
        let mut affected = 0u64;
        for edit in edits {
            let effective_schema = if edit.schema.is_empty() { "public" } else { &edit.schema };
            // 构建 WHERE 子句
            let where_parts: Vec<String> = edit
                .pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| {
                    let val = &edit.pk_values[i];
                    format!("\"{}\" = {}", col, sql_value_literal(val))
                })
                .collect();
            let where_clause = where_parts.join(" AND ");
            let new_val = sql_value_literal(&edit.new_value);
            let sql = format!(
                "UPDATE \"{}\".\"{}\" SET \"{}\" = {} WHERE {}",
                effective_schema, edit.table, edit.column, new_val, where_clause
            );
            let n = client
                .execute(&sql, &[])
                .await
                .map_err(|e| format!("Edit failed: {}", e))?;
            affected += n;
        }
        Ok(affected)
    }

    async fn delete_rows(
        &self,
        _database: &str,
        schema: &str,
        table: &str,
        pk_columns: &[String],
        pk_values: &[Vec<SqlValue>],
    ) -> Result<u64, String> {
        let client = self.client()?;
        let effective_schema = if schema.is_empty() { "public" } else { schema };
        let mut affected = 0u64;
        for row_pks in pk_values {
            let where_parts: Vec<String> = pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| format!("\"{}\" = {}", col, sql_value_literal(&row_pks[i])))
                .collect();
            let sql = format!(
                "DELETE FROM \"{}\".\"{}\" WHERE {}",
                effective_schema, table, where_parts.join(" AND ")
            );
            let n = client
                .execute(&sql, &[])
                .await
                .map_err(|e| format!("Delete failed: {}", e))?;
            affected += n;
        }
        Ok(affected)
    }

    async fn cancel_query(&self) -> Result<(), String> {
        let guard = self.cancel_token.lock().await;
        if let Some(token) = guard.as_ref() {
            token
                .cancel_query(NoTls)
                .await
                .map_err(|e| format!("Cancel failed: {}", e))?;
        }
        Ok(())
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_schemas: true,
            supports_transactions: true,
            supports_explain: true,
            supports_cell_edit: true,
            supports_row_delete: true,
            supports_import_export: true,
            supports_multiple_databases: true,
            default_port: 5432,
        }
    }
}

/// SqlValue → SQL 字面量（用于简单拼接，非参数化查询）
fn sql_value_literal(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        SqlValue::Int(i) => i.to_string(),
        SqlValue::Float(f) => f.to_string(),
        SqlValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
        SqlValue::Bytes(b64) => format!("decode('{}', 'base64')", b64),
        SqlValue::Timestamp(ts) => format!("'{}'", ts.replace('\'', "''")),
        SqlValue::Json(v) => format!("'{}'::jsonb", v.to_string().replace('\'', "''")),
        SqlValue::Array(_) => "'(array)'".to_string(),
    }
}
