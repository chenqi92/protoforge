// 数据库导入导出 — 封装原生 CLI 工具 + 内置 SQL 导出兜底

use super::driver::{ExportOptions, ExportResult, ImportOptions, ImportResult, SqlValue};
use std::path::Path;
use tokio::process::Command;

/// 在系统 PATH 和常见路径中查找工具
fn find_tool(name: &str, custom_path: Option<&str>) -> Result<String, String> {
    if let Some(p) = custom_path {
        if Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }

    let search_paths = if cfg!(target_os = "macos") {
        vec![
            format!("/opt/homebrew/bin/{}", name),
            format!("/usr/local/bin/{}", name),
            format!("/usr/bin/{}", name),
            format!("/Applications/Postgres.app/Contents/Versions/latest/bin/{}", name),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            format!("C:\\Program Files\\PostgreSQL\\16\\bin\\{}.exe", name),
            format!("C:\\Program Files\\PostgreSQL\\15\\bin\\{}.exe", name),
            format!("C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\{}.exe", name),
        ]
    } else {
        vec![
            format!("/usr/bin/{}", name),
            format!("/usr/local/bin/{}", name),
        ]
    };

    for path in &search_paths {
        if Path::new(path).exists() {
            return Ok(path.clone());
        }
    }

    Err(format!(
        "Tool '{}' not found. Please install it or set the custom path in settings.",
        name
    ))
}

/// pg_dump 导出
pub async fn pg_dump(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    options: &ExportOptions,
) -> Result<ExportResult, String> {
    let tool = find_tool("pg_dump", options.tool_path.as_deref())?;
    let start = std::time::Instant::now();

    let mut cmd = Command::new(&tool);
    cmd.arg("-h").arg(host)
        .arg("-p").arg(port.to_string())
        .arg("-U").arg(username)
        .arg("-d").arg(&options.database)
        .arg("-f").arg(&options.output_path);

    if options.data_only {
        cmd.arg("--data-only");
    }
    if options.schema_only {
        cmd.arg("--schema-only");
    }
    if let Some(ref schema) = options.schema {
        cmd.arg("-n").arg(schema);
    }
    for table in &options.tables {
        cmd.arg("-t").arg(table);
    }

    cmd.env("PGPASSWORD", password);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run pg_dump: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pg_dump failed: {}", stderr));
    }

    let file_size = std::fs::metadata(&options.output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(ExportResult {
        output_path: options.output_path.clone(),
        size_bytes: file_size,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

/// pg_restore / psql 导入
pub async fn pg_import(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    options: &ImportOptions,
) -> Result<ImportResult, String> {
    let start = std::time::Instant::now();

    let is_custom = options.file_path.ends_with(".dump")
        || options.file_path.ends_with(".backup");

    let (tool_name, args) = if is_custom {
        let tool = find_tool("pg_restore", options.tool_path.as_deref())?;
        let mut args = vec![
            "-h".to_string(), host.to_string(),
            "-p".to_string(), port.to_string(),
            "-U".to_string(), username.to_string(),
            "-d".to_string(), options.database.clone(),
            options.file_path.clone(),
        ];
        if let Some(ref schema) = options.schema {
            args.push("-n".to_string());
            args.push(schema.clone());
        }
        (tool, args)
    } else {
        let tool = find_tool("psql", options.tool_path.as_deref())?;
        let args = vec![
            "-h".to_string(), host.to_string(),
            "-p".to_string(), port.to_string(),
            "-U".to_string(), username.to_string(),
            "-d".to_string(), options.database.clone(),
            "-f".to_string(), options.file_path.clone(),
        ];
        (tool, args)
    };

    let output = Command::new(&tool_name)
        .args(&args)
        .env("PGPASSWORD", password)
        .output()
        .await
        .map_err(|e| format!("Failed to run import: {}", e))?;

    let mut warnings = Vec::new();
    if !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        for line in stderr.lines() {
            if !line.is_empty() {
                warnings.push(line.to_string());
            }
        }
    }

    if !output.status.success() && warnings.iter().any(|w| w.contains("ERROR")) {
        return Err(format!("Import failed: {}", warnings.join("\n")));
    }

    Ok(ImportResult {
        duration_ms: start.elapsed().as_millis() as u64,
        warnings,
    })
}

/// mysqldump 导出
pub async fn mysql_dump(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    options: &ExportOptions,
) -> Result<ExportResult, String> {
    let tool = find_tool("mysqldump", options.tool_path.as_deref())?;
    let start = std::time::Instant::now();

    let mut cmd = Command::new(&tool);
    cmd.arg("-h").arg(host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(username)
        .arg(&format!("-p{}", password))
        .arg("--result-file").arg(&options.output_path);

    if options.data_only {
        cmd.arg("--no-create-info");
    }
    if options.schema_only {
        cmd.arg("--no-data");
    }

    cmd.arg(&options.database);

    for table in &options.tables {
        cmd.arg(table);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run mysqldump: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("mysqldump failed: {}", stderr));
    }

    let file_size = std::fs::metadata(&options.output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(ExportResult {
        output_path: options.output_path.clone(),
        size_bytes: file_size,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

/// mysql CLI 导入
pub async fn mysql_import(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    options: &ImportOptions,
) -> Result<ImportResult, String> {
    let tool = find_tool("mysql", options.tool_path.as_deref())?;
    let start = std::time::Instant::now();

    let sql_content = std::fs::read_to_string(&options.file_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    let output = Command::new(&tool)
        .arg("-h").arg(host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(username)
        .arg(&format!("-p{}", password))
        .arg(&options.database)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start mysql: {}", e))?;

    use tokio::io::AsyncWriteExt;
    let mut child = output;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(sql_content.as_bytes()).await
            .map_err(|e| format!("Failed to write to mysql stdin: {}", e))?;
        drop(stdin);
    }

    let output = child.wait_with_output().await
        .map_err(|e| format!("Failed to wait for mysql: {}", e))?;

    let mut warnings = Vec::new();
    if !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        for line in stderr.lines() {
            if !line.is_empty() && !line.contains("Warning") {
                warnings.push(line.to_string());
            }
        }
    }

    if !output.status.success() {
        return Err(format!("mysql import failed: {}", warnings.join("\n")));
    }

    Ok(ImportResult {
        duration_ms: start.elapsed().as_millis() as u64,
        warnings,
    })
}

/// sqlite3 .dump 导出
pub async fn sqlite_dump(
    db_path: &str,
    options: &ExportOptions,
) -> Result<ExportResult, String> {
    let tool = find_tool("sqlite3", options.tool_path.as_deref())?;
    let start = std::time::Instant::now();

    let output = Command::new(&tool)
        .arg(db_path)
        .arg(".dump")
        .output()
        .await
        .map_err(|e| format!("Failed to run sqlite3: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sqlite3 dump failed: {}", stderr));
    }

    std::fs::write(&options.output_path, &output.stdout)
        .map_err(|e| format!("Write dump file failed: {}", e))?;

    let file_size = output.stdout.len() as u64;

    Ok(ExportResult {
        output_path: options.output_path.clone(),
        size_bytes: file_size,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ═══════════════════════════════════════════
// 内置 SQL 导出 — 不依赖外部工具
// ═══════════════════════════════════════════

/// 将 SqlValue 转换为 SQL 字面量
fn sql_value_to_literal(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Bool(b) => if *b { "TRUE".to_string() } else { "FALSE".to_string() },
        SqlValue::Int(n) => n.to_string(),
        SqlValue::Float(f) => format!("{}", f),
        SqlValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
        SqlValue::Bytes(b64) => format!("X'{}'", b64), // 简化处理
        SqlValue::Timestamp(ts) => format!("'{}'", ts),
        SqlValue::Json(v) => format!("'{}'", serde_json::to_string(v).unwrap_or_default().replace('\'', "''")),
        SqlValue::Array(arr) => {
            let items: Vec<String> = arr.iter().map(sql_value_to_literal).collect();
            format!("ARRAY[{}]", items.join(", "))
        }
    }
}

/// 使用数据库连接生成 SQL 导出（不需要外部工具）
pub async fn sql_based_export(
    driver: &dyn super::driver::DbDriver,
    options: &ExportOptions,
    db_type: &str,
) -> Result<ExportResult, String> {
    let start = std::time::Instant::now();
    let mut output = String::new();

    output.push_str(&format!("-- SQL Export: database={} generated by ProtoForge\n", options.database));
    output.push_str(&format!("-- Date: {}\n\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));

    // 获取 schema 对象
    let schema = options.schema.as_deref().unwrap_or("");
    let objects = driver.list_schema_objects(&options.database, schema).await
        .map_err(|e| format!("Failed to list schema objects: {}", e))?;

    // 确定要导出的表
    let tables_to_export: Vec<&super::driver::TableMeta> = if options.tables.is_empty() {
        objects.tables.iter().collect()
    } else {
        objects.tables.iter()
            .filter(|t| options.tables.contains(&t.name))
            .collect()
    };

    for table in &tables_to_export {
        // 获取 DDL (schema)
        if !options.data_only {
            let ddl_sql = match db_type {
                "mysql" => format!("SHOW CREATE TABLE `{}`", table.name),
                "sqlite" => format!("SELECT sql FROM sqlite_master WHERE type='table' AND name='{}'", table.name),
                _ => {
                    // PostgreSQL: 获取列信息构建 CREATE TABLE
                    format!(
                        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='{}' AND table_name='{}' ORDER BY ordinal_position",
                        if schema.is_empty() { "public" } else { schema },
                        table.name
                    )
                }
            };

            match driver.execute_query(&ddl_sql).await {
                Ok(ddl_result) => {
                    if db_type == "mysql" && !ddl_result.rows.is_empty() {
                        // SHOW CREATE TABLE 返回第二列是 DDL
                        if let Some(row) = ddl_result.rows.first() {
                            if row.len() >= 2 {
                                if let SqlValue::Text(ddl) = &row[1] {
                                    output.push_str(&format!("DROP TABLE IF EXISTS `{}`;\n", table.name));
                                    output.push_str(ddl);
                                    output.push_str(";\n\n");
                                }
                            }
                        }
                    } else if db_type == "sqlite" && !ddl_result.rows.is_empty() {
                        if let Some(row) = ddl_result.rows.first() {
                            if let Some(SqlValue::Text(ddl)) = row.first() {
                                output.push_str(ddl);
                                output.push_str(";\n\n");
                            }
                        }
                    } else {
                        // PostgreSQL: 从 information_schema 构建近似 DDL
                        output.push_str(&format!("-- Table: {}\n", table.name));
                        output.push_str(&format!("CREATE TABLE IF NOT EXISTS \"{}\" (\n", table.name));
                        let col_count = ddl_result.rows.len();
                        for (i, row) in ddl_result.rows.iter().enumerate() {
                            let col_name = match &row[0] { SqlValue::Text(s) => s.as_str(), _ => "?" };
                            let col_type = match &row[1] { SqlValue::Text(s) => s.as_str(), _ => "TEXT" };
                            let nullable = match &row[2] { SqlValue::Text(s) => s.as_str(), _ => "YES" };
                            let not_null = if nullable == "NO" { " NOT NULL" } else { "" };
                            let comma = if i < col_count - 1 { "," } else { "" };
                            output.push_str(&format!("  \"{}\" {}{}{}\n", col_name, col_type, not_null, comma));
                        }
                        output.push_str(");\n\n");
                    }
                }
                Err(e) => {
                    output.push_str(&format!("-- Failed to get DDL for {}: {}\n\n", table.name, e));
                }
            }
        }

        // 获取数据 (INSERT 语句)
        if !options.schema_only {
            let data_sql = match db_type {
                "mysql" => format!("SELECT * FROM `{}`", table.name),
                "sqlite" => format!("SELECT * FROM \"{}\"", table.name),
                _ => format!("SELECT * FROM \"{}\"", table.name),
            };

            match driver.execute_query(&data_sql).await {
                Ok(data_result) => {
                    if !data_result.rows.is_empty() {
                        let col_names: Vec<&str> = data_result.columns.iter().map(|c| c.name.as_str()).collect();
                        let quoted_cols = match db_type {
                            "mysql" => col_names.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", "),
                            _ => col_names.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", "),
                        };

                        for row in &data_result.rows {
                            let vals: Vec<String> = row.iter().map(sql_value_to_literal).collect();
                            let table_ref = match db_type {
                                "mysql" => format!("`{}`", table.name),
                                _ => format!("\"{}\"", table.name),
                            };
                            output.push_str(&format!(
                                "INSERT INTO {} ({}) VALUES ({});\n",
                                table_ref, quoted_cols, vals.join(", ")
                            ));
                        }
                        output.push('\n');
                    }
                }
                Err(e) => {
                    output.push_str(&format!("-- Failed to export data for {}: {}\n\n", table.name, e));
                }
            }
        }
    }

    // 写入文件
    std::fs::write(&options.output_path, &output)
        .map_err(|e| format!("Write export file failed: {}", e))?;

    Ok(ExportResult {
        output_path: options.output_path.clone(),
        size_bytes: output.len() as u64,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}
