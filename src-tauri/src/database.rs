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
        (2, "add_response_example", include_str!("../migrations/002_add_response_example.sql")),
        (3, "workflow_schema", include_str!("../migrations/003_workflow_schema.sql")),
        (4, "add_item_variables", include_str!("../migrations/004_add_item_variables.sql")),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_simple() {
        let sql = "SELECT 1; SELECT 2; SELECT 3";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 3);
        assert_eq!(stmts[0].trim(), "SELECT 1");
        assert_eq!(stmts[1].trim(), "SELECT 2");
        assert_eq!(stmts[2].trim(), "SELECT 3");
    }

    #[test]
    fn test_split_with_string_semicolons() {
        let sql = "INSERT INTO t VALUES ('hello; world'); SELECT 1";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("hello; world"), "字符串内分号不应拆分");
    }

    #[test]
    fn test_split_escaped_quotes() {
        let sql = "INSERT INTO t VALUES ('it''s a test; really'); SELECT 2";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("it''s a test; really"));
    }

    #[test]
    fn test_split_empty() {
        let stmts = split_sql_statements("");
        assert!(stmts.is_empty());
    }

    #[test]
    fn test_split_single_statement() {
        let sql = "CREATE TABLE test (id INTEGER PRIMARY KEY)";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 1);
        assert_eq!(stmts[0], sql);
    }

    #[test]
    fn test_split_trailing_semicolon() {
        let sql = "SELECT 1;";
        let stmts = split_sql_statements(sql);
        // 应有 "SELECT 1" 和一个空字符串
        assert_eq!(stmts[0].trim(), "SELECT 1");
    }

    #[test]
    fn test_split_multiline() {
        let sql = "CREATE TABLE IF NOT EXISTS test (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL\n);\nINSERT INTO test VALUES ('1', 'name with; semi')";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("CREATE TABLE"));
        assert!(stmts[1].contains("name with; semi"));
    }

    #[test]
    fn test_split_complex_migration() {
        // 模拟真实的迁移 SQL
        let sql = r"CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    data TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_items ON items(id)";
        let stmts = split_sql_statements(sql);
        assert_eq!(stmts.len(), 3);
        assert!(stmts[0].contains("collections"));
        assert!(stmts[1].contains("items"));
        assert!(stmts[2].contains("CREATE INDEX"));
    }
}
