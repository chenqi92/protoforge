-- ProtoForge Initial Schema
-- 001_initial_schema.sql

-- 集合
CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    auth        TEXT,
    pre_script  TEXT DEFAULT '',
    post_script TEXT DEFAULT '',
    variables   TEXT DEFAULT '{}',
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 集合项（请求/文件夹，树形结构）
CREATE TABLE IF NOT EXISTS collection_items (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    parent_id       TEXT,
    item_type       TEXT NOT NULL CHECK(item_type IN ('request', 'folder')),
    name            TEXT NOT NULL,
    sort_order      INTEGER DEFAULT 0,
    method          TEXT,
    url             TEXT,
    headers         TEXT DEFAULT '{}',
    query_params    TEXT DEFAULT '{}',
    body_type       TEXT DEFAULT 'none',
    body_content    TEXT DEFAULT '',
    auth_type       TEXT DEFAULT 'none',
    auth_config     TEXT DEFAULT '{}',
    pre_script      TEXT DEFAULT '',
    post_script     TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_items_parent ON collection_items(parent_id);

-- 环境
CREATE TABLE IF NOT EXISTS environments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    is_active   INTEGER DEFAULT 0,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 环境变量
CREATE TABLE IF NOT EXISTS environment_variables (
    id              TEXT PRIMARY KEY,
    environment_id  TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    value           TEXT NOT NULL DEFAULT '',
    enabled         INTEGER DEFAULT 1,
    is_secret       INTEGER DEFAULT 0,
    sort_order      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_env_vars ON environment_variables(environment_id);

-- 全局变量
CREATE TABLE IF NOT EXISTS global_variables (
    id      TEXT PRIMARY KEY,
    key     TEXT NOT NULL UNIQUE,
    value   TEXT NOT NULL DEFAULT '',
    enabled INTEGER DEFAULT 1
);

-- 历史记录
CREATE TABLE IF NOT EXISTS history (
    id              TEXT PRIMARY KEY,
    method          TEXT NOT NULL,
    url             TEXT NOT NULL,
    status          INTEGER,
    duration_ms     INTEGER,
    body_size       INTEGER,
    request_config  TEXT,
    response_summary TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_date ON history(created_at DESC);

-- 用户偏好
CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
