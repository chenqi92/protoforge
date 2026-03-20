// ProtoForge 数据库初始化与连接管理

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteJournalMode};
use sqlx::SqlitePool;
use std::path::Path;

/// 初始化 SQLite 数据库连接池
pub async fn init_pool(app_data_dir: &Path) -> Result<SqlitePool, sqlx::Error> {
    let db_path = app_data_dir.join("protoforge.db");
    let _ = std::fs::create_dir_all(app_data_dir);

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)       // WAL 模式 — 并发读写
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // 运行迁移
    run_migrations(&pool).await?;

    Ok(pool)
}

/// 执行 SQL 迁移
async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 创建迁移版本表
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    ).execute(pool).await?;

    // 获取当前版本
    let current_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM _migrations"
    ).fetch_one(pool).await?;

    // 按顺序执行未应用的迁移
    let migrations: Vec<(i64, &str, &str)> = vec![
        (1, "initial_schema", include_str!("../migrations/001_initial_schema.sql")),
    ];

    for (version, name, sql) in migrations {
        if version > current_version {
            log::info!("Running migration {}: {}", version, name);

            // 使用感知字符串字面量的分割，避免拆分 SQL 字符串值中的分号
            for statement in split_sql_statements(sql) {
                let trimmed = statement.trim();
                if !trimmed.is_empty() {
                    sqlx::query(trimmed).execute(pool).await?;
                }
            }

            sqlx::query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
                .bind(version)
                .bind(name)
                .execute(pool).await?;
        }
    }

    Ok(())
}

/// 感知字符串字面量的 SQL 语句分割。
/// 跳过单引号内的分号，仅在语句级别的分号处拆分。
/// 正确处理 SQL 转义单引号 '' (两个连续单引号 = 字面量 ')。
fn split_sql_statements(sql: &str) -> Vec<&str> {
    let mut statements = Vec::new();
    let mut start = 0;
    let mut in_string = false;
    let bytes = sql.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'\'' {
            if in_string && i + 1 < len && bytes[i + 1] == b'\'' {
                // 连续两个单引号 '' — SQL 转义，跳过整对，不改变 in_string 状态
                i += 2;
                continue;
            }
            in_string = !in_string;
        } else if bytes[i] == b';' && !in_string {
            statements.push(&sql[start..i]);
            start = i + 1;
        }
        i += 1;
    }

    // 最后一段
    if start < len {
        statements.push(&sql[start..]);
    }

    statements
}
