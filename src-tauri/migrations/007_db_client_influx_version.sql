-- 为 db_connections 添加 InfluxDB 版本和保留策略字段
ALTER TABLE db_connections ADD COLUMN influx_version TEXT DEFAULT NULL;
ALTER TABLE db_connections ADD COLUMN retention_policy TEXT DEFAULT NULL;
