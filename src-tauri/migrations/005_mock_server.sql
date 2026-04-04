-- Mock Server 配置持久化
CREATE TABLE IF NOT EXISTS mock_server_configs (
  id TEXT PRIMARY KEY,
  session_label TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 3100,
  routes_json TEXT NOT NULL DEFAULT '[]',
  proxy_target TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
