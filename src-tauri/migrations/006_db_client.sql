-- 数据库客户端 — 连接、查询保存、历史

-- 保存的数据库连接
CREATE TABLE IF NOT EXISTS db_connections (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    db_type         TEXT NOT NULL CHECK(db_type IN ('postgresql','mysql','sqlite','influxdb')),
    host            TEXT DEFAULT 'localhost',
    port            INTEGER,
    database_name   TEXT DEFAULT '',
    username        TEXT DEFAULT '',
    password_enc    TEXT DEFAULT '',
    ssl_enabled     INTEGER DEFAULT 0,
    ssl_ca_cert     TEXT,
    ssl_client_cert TEXT,
    ssl_client_key  TEXT,
    file_path       TEXT,
    org             TEXT DEFAULT '',
    token_enc       TEXT DEFAULT '',
    options_json    TEXT DEFAULT '{}',
    color_label     TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 保存的查询 / 代码片段
CREATE TABLE IF NOT EXISTS db_saved_queries (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT REFERENCES db_connections(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    sql_text        TEXT NOT NULL,
    description     TEXT DEFAULT '',
    folder          TEXT DEFAULT '',
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_conn ON db_saved_queries(connection_id);

-- 查询执行历史
CREATE TABLE IF NOT EXISTS db_query_history (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT REFERENCES db_connections(id) ON DELETE SET NULL,
    connection_name TEXT NOT NULL DEFAULT '',
    db_type         TEXT NOT NULL,
    database_name   TEXT DEFAULT '',
    sql_text        TEXT NOT NULL,
    execution_ms    INTEGER,
    row_count       INTEGER,
    status          TEXT NOT NULL CHECK(status IN ('success','error')),
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_query_history_date ON db_query_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_conn ON db_query_history(connection_id);
