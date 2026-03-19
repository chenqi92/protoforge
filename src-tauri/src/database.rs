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

            // 分号分割执行多条 SQL
            for statement in sql.split(';') {
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
