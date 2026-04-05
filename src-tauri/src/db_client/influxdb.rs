// InfluxDB v2 驱动实现 — 基于 HTTP API + Flux 查询语言

use super::driver::*;
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

pub struct InfluxDbDriver {
    config: InfluxDbConfig,
    http: Option<Client>,
}

pub struct InfluxDbConfig {
    pub host: String,
    pub port: u16,
    pub org: String,
    pub token: String,
    pub bucket: String,
}

impl InfluxDbDriver {
    pub fn new(config: InfluxDbConfig) -> Self {
        Self {
            config,
            http: None,
        }
    }

    fn base_url(&self) -> String {
        format!("http://{}:{}", self.config.host, self.config.port)
    }

    fn client(&self) -> Result<&Client, String> {
        self.http
            .as_ref()
            .ok_or_else(|| "Not connected".to_string())
    }

    /// 执行 Flux 查询，返回 CSV 格式结果
    async fn flux_query(&self, flux: &str) -> Result<String, String> {
        let client = self.client()?;
        let url = format!("{}/api/v2/query?org={}", self.base_url(), self.config.org);
        let resp = client
            .post(&url)
            .header("Authorization", format!("Token {}", self.config.token))
            .header("Content-Type", "application/vnd.flux")
            .header("Accept", "application/csv")
            .body(flux.to_string())
            .send()
            .await
            .map_err(|e| format!("Flux query failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("InfluxDB error: {}", body));
        }

        resp.text()
            .await
            .map_err(|e| format!("Read response failed: {}", e))
    }

    /// 解析 InfluxDB CSV 响应为 QueryResult
    fn parse_csv_response(csv: &str) -> QueryResult {
        let mut columns: Vec<ColumnInfo> = Vec::new();
        let mut rows: Vec<Vec<SqlValue>> = Vec::new();
        let mut header_parsed = false;
        let mut col_indices: Vec<usize> = Vec::new();

        for line in csv.lines() {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let fields: Vec<&str> = line.split(',').collect();

            if !header_parsed {
                // 第一个非注释、非空行是表头
                // InfluxDB CSV: ,result,table,_start,_stop,_field,_value,_measurement,_time,...
                // 跳过前三列（空、result、table）
                let skip = if fields.first() == Some(&"") { 1 } else { 0 };
                for (i, &name) in fields.iter().enumerate() {
                    if i < skip { continue; }
                    let name = name.trim();
                    if name == "result" || name == "table" { continue; }
                    col_indices.push(i);
                    columns.push(ColumnInfo {
                        name: name.to_string(),
                        data_type: "string".to_string(),
                        nullable: true,
                        is_primary_key: name == "_time",
                        max_length: None,
                    });
                }
                header_parsed = true;
                continue;
            }

            // 数据行
            let mut row_values: Vec<SqlValue> = Vec::with_capacity(col_indices.len());
            for &ci in &col_indices {
                let val = fields.get(ci).map(|s| s.trim()).unwrap_or("");
                if val.is_empty() {
                    row_values.push(SqlValue::Null);
                } else if let Ok(n) = val.parse::<i64>() {
                    row_values.push(SqlValue::Int(n));
                } else if let Ok(f) = val.parse::<f64>() {
                    row_values.push(SqlValue::Float(f));
                } else if val == "true" || val == "false" {
                    row_values.push(SqlValue::Bool(val == "true"));
                } else {
                    row_values.push(SqlValue::Text(val.to_string()));
                }
            }
            if !row_values.is_empty() {
                rows.push(row_values);
            }
        }

        let row_count = rows.len();
        QueryResult {
            columns,
            rows,
            affected_rows: None,
            execution_time_ms: 0,
            truncated: false,
            total_rows: Some(row_count as i64),
            warnings: vec![],
        }
    }
}

#[derive(Deserialize)]
struct InfluxHealth {
    status: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
struct InfluxBucket {
    name: String,
}

#[derive(Deserialize)]
struct InfluxBucketsResponse {
    buckets: Option<Vec<InfluxBucket>>,
}

#[async_trait]
impl DbDriver for InfluxDbDriver {
    async fn connect(&mut self) -> Result<ServerInfo, String> {
        let client = Client::new();

        // 健康检查
        let url = format!("{}/health", self.base_url());
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        let health: InfluxHealth = resp
            .json()
            .await
            .map_err(|e| format!("Health check failed: {}", e))?;

        let version = health.version.unwrap_or_else(|| "unknown".to_string());
        let status = health.status.unwrap_or_else(|| "unknown".to_string());

        if status != "pass" {
            return Err(format!("InfluxDB unhealthy: {}", status));
        }

        self.http = Some(client);

        Ok(ServerInfo {
            version: format!("InfluxDB {}", version),
            server_type: "InfluxDB".to_string(),
            database: if self.config.bucket.is_empty() {
                None
            } else {
                Some(self.config.bucket.clone())
            },
        })
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        self.http = None;
        Ok(())
    }

    async fn ping(&self) -> Result<(), String> {
        let client = self.client()?;
        let url = format!("{}/health", self.base_url());
        client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Ping failed: {}", e))?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let csv = self.flux_query(sql).await?;
        let mut result = Self::parse_csv_response(&csv);
        result.execution_time_ms = start.elapsed().as_millis() as u64;
        Ok(result)
    }

    async fn execute_statement(&self, sql: &str) -> Result<u64, String> {
        // InfluxDB 写入使用 Line Protocol，不通过这里
        Err("InfluxDB does not support SQL statements. Use Flux queries or Line Protocol for writes.".to_string())
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        // InfluxDB v2: 列出 buckets
        let client = self.client()?;
        let url = format!(
            "{}/api/v2/buckets?org={}",
            self.base_url(),
            self.config.org
        );
        let resp = client
            .get(&url)
            .header("Authorization", format!("Token {}", self.config.token))
            .send()
            .await
            .map_err(|e| format!("List buckets failed: {}", e))?;

        let body: InfluxBucketsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Parse buckets failed: {}", e))?;

        Ok(body
            .buckets
            .unwrap_or_default()
            .into_iter()
            .filter(|b| !b.name.starts_with('_')) // 过滤系统 bucket
            .map(|b| DatabaseInfo {
                name: b.name,
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
        let bucket = if database.is_empty() {
            &self.config.bucket
        } else {
            database
        };

        // 列出 measurements（相当于表）
        let flux = format!(
            r#"import "influxdata/influxdb/schema"
schema.measurements(bucket: "{}")"#,
            bucket
        );

        let csv = self.flux_query(&flux).await?;
        let result = Self::parse_csv_response(&csv);

        let tables: Vec<TableMeta> = result
            .rows
            .iter()
            .filter_map(|row| {
                row.last().and_then(|v| match v {
                    SqlValue::Text(s) => Some(TableMeta {
                        schema: bucket.to_string(),
                        name: s.clone(),
                        row_count_estimate: None,
                        comment: None,
                    }),
                    _ => None,
                })
            })
            .collect();

        Ok(SchemaObjects {
            schemas: vec![bucket.to_string()],
            tables,
            views: vec![],
            functions: vec![],
        })
    }

    async fn describe_table(
        &self,
        database: &str,
        _schema: &str,
        table: &str,
    ) -> Result<TableDescription, String> {
        let bucket = if database.is_empty() {
            &self.config.bucket
        } else {
            database
        };

        // 获取 tag keys + field keys
        let flux_tags = format!(
            r#"import "influxdata/influxdb/schema"
schema.tagKeys(bucket: "{}", measurement: "{}")"#,
            bucket, table
        );
        let flux_fields = format!(
            r#"import "influxdata/influxdb/schema"
schema.fieldKeys(bucket: "{}", measurement: "{}")"#,
            bucket, table
        );

        let (tag_csv, field_csv) = tokio::join!(
            self.flux_query(&flux_tags),
            self.flux_query(&flux_fields),
        );

        let mut columns = Vec::new();

        // _time 总是存在
        columns.push(ColumnDetail {
            name: "_time".to_string(),
            data_type: "timestamp".to_string(),
            nullable: false,
            default_value: None,
            is_primary_key: true,
            comment: Some("Timestamp".to_string()),
            max_length: None,
        });

        // Tag keys
        if let Ok(csv) = tag_csv {
            let result = Self::parse_csv_response(&csv);
            for row in &result.rows {
                if let Some(SqlValue::Text(name)) = row.last() {
                    if name.starts_with('_') { continue; }
                    columns.push(ColumnDetail {
                        name: name.clone(),
                        data_type: "tag (string)".to_string(),
                        nullable: true,
                        default_value: None,
                        is_primary_key: false,
                        comment: Some("Tag key".to_string()),
                        max_length: None,
                    });
                }
            }
        }

        // Field keys
        if let Ok(csv) = field_csv {
            let result = Self::parse_csv_response(&csv);
            for row in &result.rows {
                if let Some(SqlValue::Text(name)) = row.last() {
                    columns.push(ColumnDetail {
                        name: name.clone(),
                        data_type: "field".to_string(),
                        nullable: true,
                        default_value: None,
                        is_primary_key: false,
                        comment: Some("Field key".to_string()),
                        max_length: None,
                    });
                }
            }
        }

        Ok(TableDescription {
            columns,
            primary_keys: vec!["_time".to_string()],
            indexes: vec![],
            comment: Some(format!("Measurement: {}", table)),
            row_count_estimate: None,
        })
    }

    async fn fetch_table_data(
        &self,
        database: &str,
        _schema: &str,
        table: &str,
        _offset: i64,
        limit: i64,
        _sort_column: Option<&str>,
        _sort_dir: Option<&str>,
        _filter: Option<&str>,
    ) -> Result<QueryResult, String> {
        let bucket = if database.is_empty() {
            &self.config.bucket
        } else {
            database
        };

        // 使用 Flux 查询最近数据
        let flux = format!(
            r#"from(bucket: "{}")
  |> range(start: -30d)
  |> filter(fn: (r) => r["_measurement"] == "{}")
  |> limit(n: {})
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")"#,
            bucket, table, limit
        );

        self.execute_query(&flux).await
    }

    async fn apply_cell_edits(&self, _edits: &[CellEdit]) -> Result<u64, String> {
        Err("InfluxDB does not support cell editing. Data is append-only.".to_string())
    }

    async fn delete_rows(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
        _pk_columns: &[String],
        _pk_values: &[Vec<SqlValue>],
    ) -> Result<u64, String> {
        Err("InfluxDB row deletion requires the Delete API with time range predicates.".to_string())
    }

    async fn cancel_query(&self) -> Result<(), String> {
        Ok(())
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            supports_schemas: false,
            supports_transactions: false,
            supports_explain: false,
            supports_cell_edit: false,
            supports_row_delete: false,
            supports_import_export: false,
            supports_multiple_databases: true,
            default_port: 8086,
        }
    }
}
