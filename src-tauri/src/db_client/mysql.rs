// MySQL 驱动实现

use super::driver::{*, validate_identifier, quote_mysql_ident};
use async_trait::async_trait;
use mysql_async::prelude::*;
use mysql_async::{Conn, Opts, OptsBuilder, Pool, Row as MysqlRow, Value as MysqlValue};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct MysqlDriver {
    config: MysqlConfig,
    pool: Option<Pool>,
    conn: Arc<Mutex<Option<Conn>>>,
}

pub struct MysqlConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
}

impl MysqlDriver {
    pub fn new(config: MysqlConfig) -> Self {
        Self {
            config,
            pool: None,
            conn: Arc::new(Mutex::new(None)),
        }
    }

    async fn get_conn(&self) -> Result<Conn, String> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| "Not connected".to_string())?;
        pool.get_conn()
            .await
            .map_err(|e| format!("Get connection failed: {}", e))
    }


    fn mysql_value_to_sql(val: &MysqlValue) -> SqlValue {
        match val {
            MysqlValue::NULL => SqlValue::Null,
            MysqlValue::Bytes(b) => {
                match String::from_utf8(b.clone()) {
                    Ok(s) => SqlValue::Text(s),
                    Err(_) => {
                        use base64::Engine;
                        SqlValue::Bytes(base64::engine::general_purpose::STANDARD.encode(b))
                    }
                }
            }
            MysqlValue::Int(i) => SqlValue::Int(*i),
            MysqlValue::UInt(u) => SqlValue::Int(*u as i64),
            MysqlValue::Float(f) => SqlValue::Float(*f as f64),
            MysqlValue::Double(d) => SqlValue::Float(*d),
            MysqlValue::Date(y, m, d, h, mi, s, us) => {
                SqlValue::Timestamp(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}", y, m, d, h, mi, s, us))
            }
            MysqlValue::Time(neg, days, h, m, s, us) => {
                let sign = if *neg { "-" } else { "" };
                SqlValue::Text(format!("{}{}d {:02}:{:02}:{:02}.{:06}", sign, days, h, m, s, us))
            }
        }
    }

    fn row_to_values(row: &MysqlRow) -> Vec<SqlValue> {
        let mut values = Vec::with_capacity(row.len());
        for i in 0..row.len() {
            let val: MysqlValue = row.as_ref(i).cloned().unwrap_or(MysqlValue::NULL);
            values.push(Self::mysql_value_to_sql(&val));
        }
        values
    }
}

#[async_trait]
impl DbDriver for MysqlDriver {
    async fn connect(&mut self) -> Result<ServerInfo, String> {
        let opts = OptsBuilder::default()
            .ip_or_hostname(&self.config.host)
            .tcp_port(self.config.port)
            .user(Some(&self.config.username))
            .pass(Some(&self.config.password))
            .db_name(if self.config.database.is_empty() {
                None
            } else {
                Some(&self.config.database)
            });

        let pool = Pool::new(Opts::from(opts));
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        // 获取版本
        let version: String = conn
            .query_first("SELECT version()")
            .await
            .map_err(|e| format!("Version query failed: {}", e))?
            .unwrap_or_default();

        self.pool = Some(pool);

        Ok(ServerInfo {
            version,
            server_type: "MySQL".to_string(),
            database: if self.config.database.is_empty() {
                None
            } else {
                Some(self.config.database.clone())
            },
        })
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(pool) = self.pool.take() {
            pool.disconnect()
                .await
                .map_err(|e| format!("Disconnect failed: {}", e))?;
        }
        Ok(())
    }

    async fn ping(&self) -> Result<(), String> {
        let mut conn = self.get_conn().await?;
        conn.query_drop("SELECT 1")
            .await
            .map_err(|e| format!("Ping failed: {}", e))?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut conn = self.get_conn().await?;
        let start = std::time::Instant::now();

        let result: Vec<MysqlRow> = conn
            .query(sql)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;

        if result.is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: None,
                execution_time_ms: elapsed,
                truncated: false,
                total_rows: Some(0),
                warnings: vec![],
            });
        }

        let columns: Vec<ColumnInfo> = result[0]
            .columns_ref()
            .iter()
            .map(|col| ColumnInfo {
                name: col.name_str().to_string(),
                data_type: format!("{:?}", col.column_type()),
                nullable: true,
                is_primary_key: col
                    .flags()
                    .contains(mysql_async::consts::ColumnFlags::PRI_KEY_FLAG),
                max_length: None,
            })
            .collect();

        let data: Vec<Vec<SqlValue>> = result.iter().map(Self::row_to_values).collect();
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

    async fn execute_query_in_database(&self, sql: &str, database: &str) -> Result<QueryResult, String> {
        let mut conn = self.get_conn().await?;
        // 在同一连接上先 USE database
        if !database.is_empty() {
            let use_sql = format!("USE `{}`", database.replace('`', "``"));
            conn.query_drop(&use_sql).await
                .map_err(|e| format!("USE database failed: {}", e))?;
        }
        // 然后执行用户 SQL（同一个 conn 对象）
        let start = std::time::Instant::now();
        let result: Vec<MysqlRow> = conn.query(sql).await
            .map_err(|e| format!("Query failed: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;

        if result.is_empty() {
            return Ok(QueryResult {
                columns: vec![], rows: vec![], affected_rows: None,
                execution_time_ms: elapsed, truncated: false, total_rows: Some(0), warnings: vec![],
            });
        }

        let columns: Vec<ColumnInfo> = result[0].columns_ref().iter().map(|col| ColumnInfo {
            name: col.name_str().to_string(),
            data_type: format!("{:?}", col.column_type()),
            nullable: true,
            is_primary_key: col.flags().contains(mysql_async::consts::ColumnFlags::PRI_KEY_FLAG),
            max_length: Some(col.column_length() as i64),
        }).collect();

        let data: Vec<Vec<SqlValue>> = result.iter().map(Self::row_to_values).collect();
        let row_count = data.len();

        Ok(QueryResult {
            columns, rows: data, affected_rows: None,
            execution_time_ms: elapsed, truncated: false, total_rows: Some(row_count as i64), warnings: vec![],
        })
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, String> {
        let mut conn = self.get_conn().await?;
        conn.query_drop(sql)
            .await
            .map_err(|e| format!("Execution failed: {}", e))?;
        Ok(conn.affected_rows())
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        let mut conn = self.get_conn().await?;
        let rows: Vec<String> = conn
            .query("SHOW DATABASES")
            .await
            .map_err(|e| format!("List databases failed: {}", e))?;

        Ok(rows
            .into_iter()
            .map(|name| DatabaseInfo {
                name,
                size_bytes: None,
                encoding: None,
            })
            .collect())
    }

    async fn list_schema_objects(
        &self,
        database: &str,
        _schema: &str,
    ) -> Result<SchemaObjects, String> {
        let mut conn = self.get_conn().await?;
        let effective_db = if database.is_empty() {
            &self.config.database
        } else {
            database
        };

        // MySQL 没有 schema 概念，用 database 替代
        // 列出表
        let table_rows: Vec<(String, Option<u64>, Option<String>)> = conn
            .exec(
                "SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' \
                 ORDER BY TABLE_NAME",
                (effective_db,),
            )
            .await
            .map_err(|e| format!("List tables failed: {}", e))?;

        let tables: Vec<TableMeta> = table_rows
            .into_iter()
            .map(|(name, rows, comment)| TableMeta {
                schema: effective_db.to_string(),
                name,
                row_count_estimate: rows.map(|r| r as i64),
                comment,
            })
            .collect();

        // 列出视图
        let view_rows: Vec<(String,)> = conn
            .exec(
                "SELECT TABLE_NAME \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW' \
                 ORDER BY TABLE_NAME",
                (effective_db,),
            )
            .await
            .map_err(|e| format!("List views failed: {}", e))?;

        let views: Vec<TableMeta> = view_rows
            .into_iter()
            .map(|(name,)| TableMeta {
                schema: effective_db.to_string(),
                name,
                row_count_estimate: None,
                comment: None,
            })
            .collect();

        // 列出函数
        let fn_rows: Vec<(String, String)> = conn
            .exec(
                "SELECT ROUTINE_NAME, DTD_IDENTIFIER \
                 FROM information_schema.ROUTINES \
                 WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' \
                 ORDER BY ROUTINE_NAME LIMIT 200",
                (effective_db,),
            )
            .await
            .map_err(|e| format!("List functions failed: {}", e))?;

        let functions: Vec<FunctionMeta> = fn_rows
            .into_iter()
            .map(|(name, ret)| FunctionMeta {
                schema: effective_db.to_string(),
                name,
                return_type: Some(ret),
            })
            .collect();

        Ok(SchemaObjects {
            schemas: vec![effective_db.to_string()],
            tables,
            views,
            functions,
        })
    }

    async fn describe_table(
        &self,
        database: &str,
        _schema: &str,
        table: &str,
    ) -> Result<TableDescription, String> {
        let mut conn = self.get_conn().await?;
        let effective_db = if database.is_empty() {
            &self.config.database
        } else {
            database
        };

        // 列信息
        let col_rows: Vec<(String, String, String, Option<String>, Option<String>, Option<i64>)> = conn
            .exec(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, CHARACTER_MAXIMUM_LENGTH \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                 ORDER BY ORDINAL_POSITION",
                (effective_db, table),
            )
            .await
            .map_err(|e| format!("Describe table failed: {}", e))?;

        let mut primary_keys = Vec::new();
        let columns: Vec<ColumnDetail> = col_rows
            .into_iter()
            .map(|(name, data_type, nullable, default, key, max_len)| {
                let is_pk = key.as_deref() == Some("PRI");
                if is_pk {
                    primary_keys.push(name.clone());
                }
                ColumnDetail {
                    name,
                    data_type,
                    nullable: nullable == "YES",
                    default_value: default,
                    is_primary_key: is_pk,
                    comment: None,
                    max_length: max_len,
                }
            })
            .collect();

        // 索引
        let idx_rows: Vec<(String, String, i32)> = conn
            .exec(
                "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE \
                 FROM information_schema.STATISTICS \
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
                 ORDER BY INDEX_NAME, SEQ_IN_INDEX",
                (effective_db, table),
            )
            .await
            .map_err(|e| format!("List indexes failed: {}", e))?;

        let mut index_map: std::collections::HashMap<String, (Vec<String>, bool)> =
            std::collections::HashMap::new();
        for (idx_name, col_name, non_unique) in idx_rows {
            let entry = index_map
                .entry(idx_name)
                .or_insert_with(|| (Vec::new(), non_unique == 0));
            entry.0.push(col_name);
        }
        let indexes: Vec<IndexInfo> = index_map
            .into_iter()
            .map(|(name, (cols, unique))| IndexInfo {
                name,
                columns: cols,
                unique,
                index_type: None,
            })
            .collect();

        // 行数
        let count: Option<u64> = conn
            .exec_first(
                "SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
                (effective_db, table),
            )
            .await
            .unwrap_or(None);

        Ok(TableDescription {
            columns,
            primary_keys,
            indexes,
            comment: None,
            row_count_estimate: count.map(|c| c as i64),
        })
    }

    async fn fetch_table_data(
        &self,
        database: &str,
        _schema: &str,
        table: &str,
        offset: i64,
        limit: i64,
        sort_column: Option<&str>,
        sort_dir: Option<&str>,
        filter: Option<&str>,
    ) -> Result<QueryResult, String> {
        let effective_db = if database.is_empty() {
            &self.config.database
        } else {
            database
        };
        let where_clause = match filter {
            Some(f) if !f.trim().is_empty() => format!("WHERE {}", f),
            _ => String::new(),
        };
        let order = match sort_column {
            Some(col) => {
                let dir = if sort_dir
                    .unwrap_or("ASC")
                    .eq_ignore_ascii_case("DESC")
                {
                    "DESC"
                } else {
                    "ASC"
                };
                validate_identifier(col)?;
                format!("ORDER BY {} {}", quote_mysql_ident(col)?, dir)
            }
            None => String::new(),
        };
        validate_identifier(table)?;
        let table_ref = format!("{}.{}", quote_mysql_ident(effective_db)?, quote_mysql_ident(table)?);

        // 先查总行数
        let count_sql = format!("SELECT COUNT(*) FROM {} {}", table_ref, where_clause);
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

        let sql = format!(
            "SELECT * FROM {} {} {} LIMIT {} OFFSET {}",
            table_ref, where_clause, order, limit, offset
        );
        let mut result = self.execute_query(&sql).await?;
        result.total_rows = total_rows;
        Ok(result)
    }

    async fn apply_cell_edits(&self, edits: &[CellEdit]) -> Result<u64, String> {
        let mut conn = self.get_conn().await?;
        let mut affected = 0u64;
        for edit in edits {
            let effective_db = if edit.database.is_empty() {
                &self.config.database
            } else {
                &edit.database
            };
            let where_parts: Vec<String> = edit
                .pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| format!("`{}` = {}", col, sql_value_literal_mysql(&edit.pk_values[i])))
                .collect();
            let sql = format!(
                "UPDATE `{}`.`{}` SET `{}` = {} WHERE {}",
                effective_db,
                edit.table,
                edit.column,
                sql_value_literal_mysql(&edit.new_value),
                where_parts.join(" AND ")
            );
            conn.query_drop(&sql)
                .await
                .map_err(|e| format!("Edit failed: {}", e))?;
            affected += conn.affected_rows();
        }
        Ok(affected)
    }

    async fn delete_rows(
        &self,
        database: &str,
        _schema: &str,
        table: &str,
        pk_columns: &[String],
        pk_values: &[Vec<SqlValue>],
    ) -> Result<u64, String> {
        let mut conn = self.get_conn().await?;
        let effective_db = if database.is_empty() {
            &self.config.database
        } else {
            database
        };
        let mut affected = 0u64;
        for row_pks in pk_values {
            let where_parts: Vec<String> = pk_columns
                .iter()
                .enumerate()
                .map(|(i, col)| format!("`{}` = {}", col, sql_value_literal_mysql(&row_pks[i])))
                .collect();
            let sql = format!(
                "DELETE FROM `{}`.`{}` WHERE {}",
                effective_db, table, where_parts.join(" AND ")
            );
            conn.query_drop(&sql)
                .await
                .map_err(|e| format!("Delete failed: {}", e))?;
            affected += conn.affected_rows();
        }
        Ok(affected)
    }

    async fn cancel_query(&self) -> Result<(), String> {
        // MySQL 的查询取消需要 KILL QUERY <connection_id>
        // 当前简单实现暂不支持
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
            supports_multiple_databases: true,
            default_port: 3306,
        }
    }
}

fn sql_value_literal_mysql(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        SqlValue::Int(i) => i.to_string(),
        SqlValue::Float(f) => f.to_string(),
        SqlValue::Text(s) => format!("'{}'", s.replace('\'', "\\'")),
        SqlValue::Bytes(b64) => format!("FROM_BASE64('{}')", b64),
        SqlValue::Timestamp(ts) => format!("'{}'", ts.replace('\'', "\\'")),
        SqlValue::Json(v) => format!("'{}'", v.to_string().replace('\'', "\\'")),
        SqlValue::Array(_) => "'(array)'".to_string(),
    }
}
