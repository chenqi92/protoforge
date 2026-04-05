// 数据库客户端模块 — 连接管理器 + 驱动分发

pub mod driver;
pub mod postgres;
pub mod mysql;
pub mod sqlite_driver;
pub mod influxdb;
pub mod export;
pub mod crypto;

use driver::*;
use postgres::{PostgresConfig, PostgresDriver};
use mysql::{MysqlConfig, MysqlDriver};
use sqlite_driver::{SqliteConfig, SqliteDriver};
use influxdb::{InfluxDbConfig, InfluxDbDriver};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ═══════════════════════════════════════════
//  连接配置（前端 ↔ 后端 IPC 传输）
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub db_type: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_enabled: bool,
    pub file_path: Option<String>,
    pub org: Option<String>,
    pub token: Option<String>,
    pub influx_version: Option<String>,
    pub retention_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub database_name: String,
    pub username: String,
    pub ssl_enabled: bool,
    pub file_path: Option<String>,
    pub org: Option<String>,
    pub influx_version: Option<String>,
    pub color_label: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionRequest {
    pub id: Option<String>,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub database_name: String,
    pub username: String,
    pub password: String,
    pub ssl_enabled: bool,
    pub file_path: Option<String>,
    pub org: Option<String>,
    pub token: Option<String>,
    pub influx_version: Option<String>,
    pub retention_policy: Option<String>,
    pub color_label: Option<String>,
    pub sort_order: Option<i64>,
}

// ═══════════════════════════════════════════
//  连接管理器
// ═══════════════════════════════════════════

pub struct DbConnectionManager {
    connections: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<Box<dyn DbDriver>>>>>>,
}

impl DbConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取某个 session 的驱动（Arc 引用，释放外层锁后仍可使用）
    pub async fn get_driver_arc(
        &self,
        session_id: &str,
    ) -> Result<Arc<tokio::sync::Mutex<Box<dyn DbDriver>>>, String> {
        let guard = self.connections.lock().await;
        guard
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("No connection for session: {}", session_id))
    }

    /// 创建驱动实例并建立连接
    pub async fn connect(
        &self,
        session_id: &str,
        config: &ConnectionConfig,
    ) -> Result<ServerInfo, String> {
        let mut driver: Box<dyn DbDriver> = match config.db_type.as_str() {
            "postgresql" => Box::new(PostgresDriver::new(PostgresConfig {
                host: config.host.clone(),
                port: config.port,
                database: config.database.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                ssl: config.ssl_enabled,
            })),
            "mysql" => Box::new(MysqlDriver::new(MysqlConfig {
                host: config.host.clone(),
                port: config.port,
                database: config.database.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                ssl: config.ssl_enabled,
            })),
            "sqlite" => Box::new(SqliteDriver::new(SqliteConfig {
                file_path: config.file_path.clone().unwrap_or_else(|| config.database.clone()),
            })),
            "influxdb" => Box::new(InfluxDbDriver::new(InfluxDbConfig {
                host: config.host.clone(),
                port: config.port,
                org: config.org.clone().unwrap_or_default(),
                token: config.token.clone().unwrap_or_default(),
                bucket: config.database.clone(),
                version: config.influx_version.clone().unwrap_or_else(|| "2.x".to_string()),
                username: config.username.clone(),
                password: config.password.clone(),
                database: config.database.clone(),
            })),
            other => return Err(format!("Unsupported database type: {}", other)),
        };

        let info = driver.connect().await?;
        self.connections
            .lock()
            .await
            .insert(session_id.to_string(), Arc::new(tokio::sync::Mutex::new(driver)));
        Ok(info)
    }

    /// 断开连接
    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let driver_arc = self.connections.lock().await.remove(session_id);
        if let Some(arc) = driver_arc {
            let mut driver = arc.lock().await;
            driver.disconnect().await?;
        }
        Ok(())
    }

    /// 测试连接（不保存）
    pub async fn test_connection(&self, config: &ConnectionConfig) -> Result<ServerInfo, String> {
        let mut driver: Box<dyn DbDriver> = match config.db_type.as_str() {
            "postgresql" => Box::new(PostgresDriver::new(PostgresConfig {
                host: config.host.clone(),
                port: config.port,
                database: config.database.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                ssl: config.ssl_enabled,
            })),
            "mysql" => Box::new(MysqlDriver::new(MysqlConfig {
                host: config.host.clone(),
                port: config.port,
                database: config.database.clone(),
                username: config.username.clone(),
                password: config.password.clone(),
                ssl: config.ssl_enabled,
            })),
            "sqlite" => Box::new(SqliteDriver::new(SqliteConfig {
                file_path: config.file_path.clone().unwrap_or_else(|| config.database.clone()),
            })),
            other => return Err(format!("Unsupported database type: {}", other)),
        };

        let info = driver.connect().await?;
        driver.disconnect().await?;
        Ok(info)
    }

}

// ═══════════════════════════════════════════
//  连接持久化 (SQLite)
// ═══════════════════════════════════════════

pub async fn save_connection(pool: &SqlitePool, req: &SaveConnectionRequest, app_data_dir: &std::path::Path) -> Result<String, String> {
    let id = req.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 加密敏感字段
    let password_enc = if req.password.is_empty() {
        String::new()
    } else {
        crypto::encrypt(&req.password, app_data_dir)?
    };
    let token_enc = match &req.token {
        Some(t) if !t.is_empty() => crypto::encrypt(t, app_data_dir)?,
        _ => String::new(),
    };

    sqlx::query(
        "INSERT INTO db_connections (id, name, db_type, host, port, database_name, username, password_enc, ssl_enabled, file_path, org, token_enc, influx_version, retention_policy, color_label, sort_order, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(id) DO UPDATE SET \
         name=excluded.name, db_type=excluded.db_type, host=excluded.host, port=excluded.port, \
         database_name=excluded.database_name, username=excluded.username, password_enc=excluded.password_enc, \
         ssl_enabled=excluded.ssl_enabled, file_path=excluded.file_path, org=excluded.org, token_enc=excluded.token_enc, \
         influx_version=excluded.influx_version, retention_policy=excluded.retention_policy, \
         color_label=excluded.color_label, sort_order=excluded.sort_order, updated_at=datetime('now')"
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&req.db_type)
    .bind(&req.host)
    .bind(req.port)
    .bind(&req.database_name)
    .bind(&req.username)
    .bind(&password_enc)
    .bind(req.ssl_enabled)
    .bind(&req.file_path)
    .bind(&req.org)
    .bind(&token_enc)
    .bind(&req.influx_version)
    .bind(&req.retention_policy)
    .bind(&req.color_label)
    .bind(req.sort_order.unwrap_or(0))
    .execute(pool)
    .await
    .map_err(|e| format!("Save connection failed: {}", e))?;

    Ok(id)
}

pub async fn list_connections(pool: &SqlitePool) -> Result<Vec<SavedConnection>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<i64>, String, String, bool, Option<String>, Option<String>, Option<String>, Option<String>, i64, String, String)>(
        "SELECT id, name, db_type, host, port, database_name, username, ssl_enabled, file_path, org, influx_version, color_label, sort_order, created_at, updated_at \
         FROM db_connections ORDER BY sort_order, name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("List connections failed: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|r| SavedConnection {
            id: r.0,
            name: r.1,
            db_type: r.2,
            host: r.3,
            port: r.4,
            database_name: r.5,
            username: r.6,
            ssl_enabled: r.7,
            file_path: r.8,
            org: r.9,
            influx_version: r.10,
            color_label: r.11,
            sort_order: r.12,
            created_at: r.13,
            updated_at: r.14,
        })
        .collect())
}

pub async fn delete_connection(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM db_connections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Delete connection failed: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════
//  查询历史
// ═══════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub connection_id: Option<String>,
    pub connection_name: String,
    pub db_type: String,
    pub database_name: String,
    pub sql_text: String,
    pub execution_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

pub async fn add_query_history(pool: &SqlitePool, entry: &QueryHistoryEntry) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO db_query_history (id, connection_id, connection_name, db_type, database_name, sql_text, execution_ms, row_count, status, error_message) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&entry.id)
    .bind(&entry.connection_id)
    .bind(&entry.connection_name)
    .bind(&entry.db_type)
    .bind(&entry.database_name)
    .bind(&entry.sql_text)
    .bind(entry.execution_ms)
    .bind(entry.row_count)
    .bind(&entry.status)
    .bind(&entry.error_message)
    .execute(pool)
    .await
    .map_err(|e| format!("Save history failed: {}", e))?;
    Ok(())
}

pub async fn list_query_history(pool: &SqlitePool, connection_id: Option<&str>, limit: i64) -> Result<Vec<QueryHistoryEntry>, String> {
    let rows = if let Some(conn_id) = connection_id {
        sqlx::query_as::<_, (String, Option<String>, String, String, String, String, Option<i64>, Option<i64>, String, Option<String>, String)>(
            "SELECT id, connection_id, connection_name, db_type, database_name, sql_text, execution_ms, row_count, status, error_message, created_at \
             FROM db_query_history WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?"
        )
        .bind(conn_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, (String, Option<String>, String, String, String, String, Option<i64>, Option<i64>, String, Option<String>, String)>(
            "SELECT id, connection_id, connection_name, db_type, database_name, sql_text, execution_ms, row_count, status, error_message, created_at \
             FROM db_query_history ORDER BY created_at DESC LIMIT ?"
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| format!("List history failed: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|r| QueryHistoryEntry {
            id: r.0,
            connection_id: r.1,
            connection_name: r.2,
            db_type: r.3,
            database_name: r.4,
            sql_text: r.5,
            execution_ms: r.6,
            row_count: r.7,
            status: r.8,
            error_message: r.9,
            created_at: r.10,
        })
        .collect())
}
