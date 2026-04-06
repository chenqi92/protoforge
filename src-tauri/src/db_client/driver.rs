// 数据库驱动抽象 — 所有数据库类型实现此 trait

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════
//  值类型 — 跨 IPC 边界的统一表示
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum SqlValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(String), // base64
    Timestamp(String),
    Json(serde_json::Value),
    Array(Vec<SqlValue>),
}

// ═══════════════════════════════════════════
//  查询结果
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub max_length: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<SqlValue>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
    pub truncated: bool,
    pub total_rows: Option<i64>,
    pub warnings: Vec<String>,
}

// ═══════════════════════════════════════════
//  Schema 内省
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: Option<i64>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjects {
    pub schemas: Vec<String>,
    pub tables: Vec<TableMeta>,
    pub views: Vec<TableMeta>,
    pub functions: Vec<FunctionMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    pub row_count_estimate: Option<i64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionMeta {
    pub schema: String,
    pub name: String,
    pub return_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDescription {
    pub columns: Vec<ColumnDetail>,
    pub primary_keys: Vec<String>,
    pub indexes: Vec<IndexInfo>,
    pub comment: Option<String>,
    pub row_count_estimate: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDetail {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub comment: Option<String>,
    pub max_length: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

// ═══════════════════════════════════════════
//  数据编辑
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    pub database: String,
    pub schema: String,
    pub table: String,
    pub pk_columns: Vec<String>,
    pub pk_values: Vec<SqlValue>,
    pub column: String,
    pub new_value: SqlValue,
}

// ═══════════════════════════════════════════
//  驱动能力声明
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverCapabilities {
    pub supports_schemas: bool,
    pub supports_transactions: bool,
    pub supports_explain: bool,
    pub supports_cell_edit: bool,
    pub supports_row_delete: bool,
    pub supports_import_export: bool,
    pub supports_multiple_databases: bool,
    pub default_port: u16,
}

// ═══════════════════════════════════════════
//  连接信息
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub server_type: String,
    pub database: Option<String>,
}

// ═══════════════════════════════════════════
//  导入导出
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub format: String,
    pub output_path: String,
    pub database: String,
    pub schema: Option<String>,
    pub tables: Vec<String>,
    pub data_only: bool,
    pub schema_only: bool,
    pub tool_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub file_path: String,
    pub database: String,
    pub schema: Option<String>,
    pub tool_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub size_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub duration_ms: u64,
    pub warnings: Vec<String>,
}

// ═══════════════════════════════════════════
//  DbDriver trait
// ═══════════════════════════════════════════

#[async_trait]
pub trait DbDriver: Send + Sync {
    /// 测试连接，返回服务器版本信息
    async fn connect(&mut self) -> Result<ServerInfo, String>;

    /// 断开连接
    async fn disconnect(&mut self) -> Result<(), String>;

    /// 测试连接是否存活
    async fn ping(&self) -> Result<(), String>;

    /// 执行查询（SELECT），返回结果集
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;

    /// 在指定数据库上下文中执行查询（同一连接先 USE db）
    /// 默认实现忽略 database 参数，MySQL 覆盖此方法
    async fn execute_query_in_database(&self, sql: &str, _database: &str) -> Result<QueryResult, String> {
        self.execute_query(sql).await
    }

    /// 执行语句（INSERT/UPDATE/DELETE/DDL），返回影响行数
    async fn execute_statement(&self, sql: &str) -> Result<u64, String>;

    /// 列出所有数据库
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, String>;

    /// 列出数据库中的 Schema 对象
    async fn list_schema_objects(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<SchemaObjects, String>;

    /// 描述表结构
    async fn describe_table(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<TableDescription, String>;

    /// 获取表数据（分页）
    async fn fetch_table_data(
        &self,
        database: &str,
        schema: &str,
        table: &str,
        offset: i64,
        limit: i64,
        sort_column: Option<&str>,
        sort_dir: Option<&str>,
        filter: Option<&str>,
    ) -> Result<QueryResult, String>;

    /// 应用单元格编辑
    async fn apply_cell_edits(&self, edits: &[CellEdit]) -> Result<u64, String>;

    /// 删除行
    async fn delete_rows(
        &self,
        database: &str,
        schema: &str,
        table: &str,
        pk_columns: &[String],
        pk_values: &[Vec<SqlValue>],
    ) -> Result<u64, String>;

    /// 取消正在执行的查询
    async fn cancel_query(&self) -> Result<(), String>;

    /// 获取驱动能力声明
    fn capabilities(&self) -> DriverCapabilities;
}

// ═══════════════════════════════════════════
//  标识符安全验证工具
// ═══════════════════════════════════════════

/// 验证 SQL 标识符是否安全（防止 SQL 注入）
/// 允许字母、数字、下划线、点号和美元符号
pub fn validate_identifier(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    if name.len() > 128 {
        return Err("Identifier too long (max 128 chars)".to_string());
    }
    for ch in name.chars() {
        if !(ch.is_alphanumeric() || ch == '_' || ch == '.' || ch == '$' || ch == '-') {
            return Err(format!(
                "Invalid character '{}' in identifier '{}'. Only alphanumeric, underscore, dot, dollar, and hyphen are allowed.",
                ch, name
            ));
        }
    }
    Ok(())
}

/// 安全引用 PostgreSQL 标识符
pub fn quote_pg_ident(name: &str) -> Result<String, String> {
    validate_identifier(name)?;
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}

/// 安全引用 MySQL 标识符
pub fn quote_mysql_ident(name: &str) -> Result<String, String> {
    validate_identifier(name)?;
    Ok(format!("`{}`", name.replace('`', "``")))
}

/// 安全引用 SQLite 标识符
pub fn quote_sqlite_ident(name: &str) -> Result<String, String> {
    validate_identifier(name)?;
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}
