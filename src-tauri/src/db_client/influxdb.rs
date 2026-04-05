// InfluxDB 驱动实现 — 支持 v1.x (HTTP+Basic Auth) / v2.x (HTTP+Token) / v3.x (HTTP+Token, Cloud)

use super::driver::*;
use async_trait::async_trait;
use serde::Deserialize;

type HttpClient = reqwest::Client;

/// 读取 HTTP 响应为 (status_code, body_text)
async fn read_response(resp: reqwest::Response) -> Result<(u16, String), String> {
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| format!("Read body: {}", e))?;
    Ok((status, String::from_utf8_lossy(&bytes).to_string()))
}

pub struct InfluxDbDriver {
    config: InfluxDbConfig,
    http: Option<HttpClient>,
}

pub struct InfluxDbConfig {
    pub host: String,
    pub port: u16,
    pub version: String, // "1.x" | "2.x" | "3.x"
    // v1 fields
    pub username: String,
    pub password: String,
    pub database: String,
    // v2/v3 fields
    pub org: String,
    pub token: String,
    pub bucket: String,
}

impl InfluxDbConfig {
    fn is_v1(&self) -> bool {
        self.version.starts_with('1')
    }
    fn is_v3(&self) -> bool {
        self.version.starts_with('3')
    }
}

impl InfluxDbDriver {
    pub fn new(config: InfluxDbConfig) -> Self {
        Self { config, http: None }
    }

    fn base_url(&self) -> String {
        format!("http://{}:{}", self.config.host, self.config.port)
    }

    fn client(&self) -> Result<&HttpClient, String> {
        self.http.as_ref().ok_or_else(|| "Not connected".to_string())
    }

    // ── v1: InfluxQL 查询 ──
    async fn query_v1(&self, query: &str) -> Result<String, String> {
        let client = self.client()?;
        let db = if self.config.database.is_empty() { &self.config.bucket } else { &self.config.database };
        let qs = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("db", db)
            .append_pair("q", query)
            .append_pair("epoch", "ms")
            .finish();
        let url = format!("{}/query?{}", self.base_url(), qs);
        match client.get(&url).basic_auth(&self.config.username, Some(&self.config.password)).send().await {
            Ok(resp) => {
                let (status, text) = read_response(resp).await?;
                if status >= 400 { Err(format!("InfluxDB v1 error: {}", text)) } else { Ok(text) }
            }
            Err(e) => Err(format!("v1 query failed: {}", e)),
        }
    }

    // ── v2/v3: Flux 查询 ──
    async fn query_v2(&self, flux: &str) -> Result<String, String> {
        let client = self.client()?;
        let url = format!("{}/api/v2/query?org={}", self.base_url(), self.config.org);
        match client.post(&url).header("Authorization", format!("Token {}", self.config.token)).header("Content-Type", "application/vnd.flux").header("Accept", "application/csv").body(flux.to_string()).send().await {
            Ok(resp) => {
                let (status, text) = read_response(resp).await?;
                if status >= 400 { Err(format!("InfluxDB error: {}", text)) } else { Ok(text) }
            }
            Err(e) => Err(format!("Flux query failed: {}", e)),
        }
    }

    /// 解析 v1 JSON 响应
    fn parse_v1_json(json_str: &str) -> QueryResult {
        #[derive(Deserialize)]
        struct V1Response { results: Option<Vec<V1Result>> }
        #[derive(Deserialize)]
        struct V1Result { series: Option<Vec<V1Series>>, error: Option<String> }
        #[derive(Deserialize)]
        struct V1Series { columns: Vec<String>, values: Option<Vec<Vec<serde_json::Value>>> }

        let resp: V1Response = match serde_json::from_str(json_str) {
            Ok(r) => r,
            Err(_) => return QueryResult { columns: vec![], rows: vec![], affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(0), warnings: vec![] },
        };

        let results = resp.results.unwrap_or_default();
        if results.is_empty() {
            return QueryResult { columns: vec![], rows: vec![], affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(0), warnings: vec![] };
        }

        let first = &results[0];
        if let Some(err) = &first.error {
            return QueryResult { columns: vec![], rows: vec![], affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(0), warnings: vec![err.clone()] };
        }

        let series = match &first.series {
            Some(s) if !s.is_empty() => &s[0],
            _ => return QueryResult { columns: vec![], rows: vec![], affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(0), warnings: vec![] },
        };

        let columns: Vec<ColumnInfo> = series.columns.iter().map(|name| ColumnInfo {
            name: name.clone(),
            data_type: if name == "time" { "timestamp" } else { "string" }.to_string(),
            nullable: true,
            is_primary_key: name == "time",
            max_length: None,
        }).collect();

        let rows: Vec<Vec<SqlValue>> = series.values.as_deref().unwrap_or_default().iter().map(|row| {
            row.iter().map(|v| match v {
                serde_json::Value::Null => SqlValue::Null,
                serde_json::Value::Bool(b) => SqlValue::Bool(*b),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() { SqlValue::Int(i) }
                    else if let Some(f) = n.as_f64() { SqlValue::Float(f) }
                    else { SqlValue::Text(n.to_string()) }
                }
                serde_json::Value::String(s) => SqlValue::Text(s.clone()),
                other => SqlValue::Text(other.to_string()),
            }).collect()
        }).collect();

        let row_count = rows.len();
        QueryResult { columns, rows, affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(row_count as i64), warnings: vec![] }
    }

    /// 解析 v2 CSV 响应
    fn parse_csv_response(csv: &str) -> QueryResult {
        let mut columns: Vec<ColumnInfo> = Vec::new();
        let mut rows: Vec<Vec<SqlValue>> = Vec::new();
        let mut header_parsed = false;
        let mut col_indices: Vec<usize> = Vec::new();

        for line in csv.lines() {
            if line.is_empty() || line.starts_with('#') { continue; }
            let fields: Vec<&str> = line.split(',').collect();
            if !header_parsed {
                let skip = if fields.first() == Some(&"") { 1 } else { 0 };
                for (i, &name) in fields.iter().enumerate() {
                    if i < skip { continue; }
                    let name = name.trim();
                    if name == "result" || name == "table" { continue; }
                    col_indices.push(i);
                    columns.push(ColumnInfo { name: name.to_string(), data_type: "string".to_string(), nullable: true, is_primary_key: name == "_time", max_length: None });
                }
                header_parsed = true;
                continue;
            }
            let mut row_values: Vec<SqlValue> = Vec::with_capacity(col_indices.len());
            for &ci in &col_indices {
                let val = fields.get(ci).map(|s| s.trim()).unwrap_or("");
                if val.is_empty() { row_values.push(SqlValue::Null); }
                else if let Ok(n) = val.parse::<i64>() { row_values.push(SqlValue::Int(n)); }
                else if let Ok(f) = val.parse::<f64>() { row_values.push(SqlValue::Float(f)); }
                else if val == "true" || val == "false" { row_values.push(SqlValue::Bool(val == "true")); }
                else { row_values.push(SqlValue::Text(val.to_string())); }
            }
            if !row_values.is_empty() { rows.push(row_values); }
        }
        let row_count = rows.len();
        QueryResult { columns, rows, affected_rows: None, execution_time_ms: 0, truncated: false, total_rows: Some(row_count as i64), warnings: vec![] }
    }
}

#[derive(Deserialize)]
struct InfluxHealth { status: Option<String>, version: Option<String> }

#[derive(Deserialize)]
struct InfluxBucket { name: String }

#[derive(Deserialize)]
struct InfluxBucketsResponse { buckets: Option<Vec<InfluxBucket>> }

#[async_trait]
impl DbDriver for InfluxDbDriver {
    async fn connect(&mut self) -> Result<ServerInfo, String> {
        let client = HttpClient::new();

        if self.config.is_v1() {
            let url = format!("{}/ping", self.base_url());
            match client.get(&url).send().await {
                Ok(resp) => {
                    let version = resp.headers().get("X-Influxdb-Version")
                        .and_then(|v| v.to_str().ok()).unwrap_or("1.x").to_string();
                    self.http = Some(client);
                    Ok(ServerInfo { version: format!("InfluxDB {}", version), server_type: "InfluxDB v1".to_string(), database: Some(self.config.database.clone()) })
                }
                Err(e) => Err(format!("v1 ping failed: {}", e)),
            }
        } else {
            let url = format!("{}/health", self.base_url());
            match client.get(&url).send().await {
                Ok(resp) => {
                    let (_, body) = read_response(resp).await?;
                    let health: InfluxHealth = serde_json::from_str(&body).map_err(|e| format!("Health parse failed: {}", e))?;
                    let version = health.version.unwrap_or_else(|| "unknown".to_string());
                    if health.status.as_deref() != Some("pass") {
                        return Err(format!("InfluxDB unhealthy: {}", health.status.unwrap_or_default()));
                    }
                    self.http = Some(client);
                    let label = if self.config.is_v3() { "InfluxDB v3" } else { "InfluxDB v2" };
                    Ok(ServerInfo { version: format!("{} {}", label, version), server_type: label.to_string(), database: Some(self.config.bucket.clone()) })
                }
                Err(e) => Err(format!("Connection failed: {}", e)),
            }
        }
    }

    async fn disconnect(&mut self) -> Result<(), String> { self.http = None; Ok(()) }

    async fn ping(&self) -> Result<(), String> {
        let client = self.client()?;
        let url = if self.config.is_v1() { format!("{}/ping", self.base_url()) } else { format!("{}/health", self.base_url()) };
        match client.get(&url).send().await {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Ping failed: {}", e)),
        }
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        if self.config.is_v1() {
            let json = self.query_v1(sql).await?;
            let mut result = Self::parse_v1_json(&json);
            result.execution_time_ms = start.elapsed().as_millis() as u64;
            Ok(result)
        } else {
            let csv = self.query_v2(sql).await?;
            let mut result = Self::parse_csv_response(&csv);
            result.execution_time_ms = start.elapsed().as_millis() as u64;
            Ok(result)
        }
    }

    async fn execute_statement(&self, _sql: &str) -> Result<u64, String> {
        Err("InfluxDB: use Line Protocol for writes.".to_string())
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        if self.config.is_v1() {
            let json = self.query_v1("SHOW DATABASES").await?;
            let result = Self::parse_v1_json(&json);
            Ok(result.rows.iter().filter_map(|row| {
                row.first().and_then(|v| match v { SqlValue::Text(s) => Some(DatabaseInfo { name: s.clone(), size_bytes: None, encoding: None }), _ => None })
            }).collect())
        } else {
            let client = self.client()?;
            let url = format!("{}/api/v2/buckets?org={}", self.base_url(), self.config.org);
            let resp = match client.get(&url).header("Authorization", format!("Token {}", self.config.token)).send().await {
                Ok(r) => r,
                Err(e) => return Err(format!("List buckets failed: {}", e)),
            };
            let (_, body_text) = read_response(resp).await?;
            let body: InfluxBucketsResponse = serde_json::from_str(&body_text).map_err(|e| format!("Parse buckets failed: {}", e))?;
            Ok(body.buckets.unwrap_or_default().into_iter().filter(|b| !b.name.starts_with('_')).map(|b| DatabaseInfo { name: b.name, size_bytes: None, encoding: None }).collect())
        }
    }

    async fn list_schema_objects(&self, database: &str, _schema: &str) -> Result<SchemaObjects, String> {
        let measurements = if self.config.is_v1() {
            let _db = if database.is_empty() { &self.config.database } else { database };
            // v1: 需要临时切换 db 查询 measurements
            let json = self.query_v1("SHOW MEASUREMENTS").await?;
            let result = Self::parse_v1_json(&json);
            result.rows.iter().filter_map(|row| row.first().and_then(|v| match v { SqlValue::Text(s) => Some(s.clone()), _ => None })).collect::<Vec<_>>()
        } else {
            let bucket = if database.is_empty() { &self.config.bucket } else { database };
            let flux = format!(r#"import "influxdata/influxdb/schema"
schema.measurements(bucket: "{}")"#, bucket);
            let csv = self.query_v2(&flux).await?;
            let result = Self::parse_csv_response(&csv);
            result.rows.iter().filter_map(|row| row.last().and_then(|v| match v { SqlValue::Text(s) => Some(s.clone()), _ => None })).collect::<Vec<_>>()
        };

        let tables: Vec<TableMeta> = measurements.into_iter().map(|name| TableMeta {
            schema: database.to_string(), name, row_count_estimate: None, comment: None,
        }).collect();

        Ok(SchemaObjects { schemas: vec![database.to_string()], tables, views: vec![], functions: vec![] })
    }

    async fn describe_table(&self, database: &str, _schema: &str, table: &str) -> Result<TableDescription, String> {
        let mut columns = vec![ColumnDetail { name: "_time".to_string(), data_type: "timestamp".to_string(), nullable: false, default_value: None, is_primary_key: true, comment: Some("Timestamp".to_string()), max_length: None }];

        if self.config.is_v1() {
            // v1: SHOW TAG KEYS / SHOW FIELD KEYS
            let tag_json = self.query_v1(&format!("SHOW TAG KEYS FROM \"{}\"", table)).await?;
            let tag_result = Self::parse_v1_json(&tag_json);
            for row in &tag_result.rows {
                if let Some(SqlValue::Text(name)) = row.first() {
                    columns.push(ColumnDetail { name: name.clone(), data_type: "tag".to_string(), nullable: true, default_value: None, is_primary_key: false, comment: Some("Tag key".to_string()), max_length: None });
                }
            }
            let field_json = self.query_v1(&format!("SHOW FIELD KEYS FROM \"{}\"", table)).await?;
            let field_result = Self::parse_v1_json(&field_json);
            for row in &field_result.rows {
                if let Some(SqlValue::Text(name)) = row.first() {
                    let field_type = row.get(1).and_then(|v| match v { SqlValue::Text(s) => Some(s.clone()), _ => None }).unwrap_or_else(|| "field".to_string());
                    columns.push(ColumnDetail { name: name.clone(), data_type: field_type, nullable: true, default_value: None, is_primary_key: false, comment: Some("Field key".to_string()), max_length: None });
                }
            }
        } else {
            let bucket = if database.is_empty() { &self.config.bucket } else { database };
            let flux_tags = format!(r#"import "influxdata/influxdb/schema"
schema.tagKeys(bucket: "{}", measurement: "{}")"#, bucket, table);
            if let Ok(csv) = self.query_v2(&flux_tags).await {
                let result = Self::parse_csv_response(&csv);
                for row in &result.rows {
                    if let Some(SqlValue::Text(name)) = row.last() {
                        if name.starts_with('_') { continue; }
                        columns.push(ColumnDetail { name: name.clone(), data_type: "tag".to_string(), nullable: true, default_value: None, is_primary_key: false, comment: Some("Tag key".to_string()), max_length: None });
                    }
                }
            }
            let flux_fields = format!(r#"import "influxdata/influxdb/schema"
schema.fieldKeys(bucket: "{}", measurement: "{}")"#, bucket, table);
            if let Ok(csv) = self.query_v2(&flux_fields).await {
                let result = Self::parse_csv_response(&csv);
                for row in &result.rows {
                    if let Some(SqlValue::Text(name)) = row.last() {
                        columns.push(ColumnDetail { name: name.clone(), data_type: "field".to_string(), nullable: true, default_value: None, is_primary_key: false, comment: Some("Field key".to_string()), max_length: None });
                    }
                }
            }
        }

        Ok(TableDescription { columns, primary_keys: vec!["_time".to_string()], indexes: vec![], comment: Some(format!("Measurement: {}", table)), row_count_estimate: None })
    }

    async fn fetch_table_data(&self, database: &str, _schema: &str, table: &str, _offset: i64, limit: i64, _sort_column: Option<&str>, _sort_dir: Option<&str>, _filter: Option<&str>) -> Result<QueryResult, String> {
        if self.config.is_v1() {
            let _db = if database.is_empty() { &self.config.database } else { database };
            let q = format!("SELECT * FROM \"{}\" ORDER BY time DESC LIMIT {}", table, limit);
            self.execute_query(&q).await
        } else {
            let bucket = if database.is_empty() { &self.config.bucket } else { database };
            let flux = format!(r#"from(bucket: "{}")
  |> range(start: -30d)
  |> filter(fn: (r) => r["_measurement"] == "{}")
  |> limit(n: {})
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")"#, bucket, table, limit);
            self.execute_query(&flux).await
        }
    }

    async fn apply_cell_edits(&self, _edits: &[CellEdit]) -> Result<u64, String> { Err("InfluxDB: data is append-only.".to_string()) }
    async fn delete_rows(&self, _database: &str, _schema: &str, _table: &str, _pk_columns: &[String], _pk_values: &[Vec<SqlValue>]) -> Result<u64, String> { Err("InfluxDB: use Delete API with time range.".to_string()) }
    async fn cancel_query(&self) -> Result<(), String> { Ok(()) }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities { supports_schemas: false, supports_transactions: false, supports_explain: false, supports_cell_edit: false, supports_row_delete: false, supports_import_export: false, supports_multiple_databases: true, default_port: 8086 }
    }
}
