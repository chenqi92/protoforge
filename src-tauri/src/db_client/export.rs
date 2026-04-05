// 数据库导入导出 — 封装原生 CLI 工具

use super::driver::{ExportOptions, ExportResult, ImportOptions, ImportResult};
use std::path::Path;
use tokio::process::Command;

/// 在系统 PATH 和常见路径中查找工具
fn find_tool(name: &str, custom_path: Option<&str>) -> Result<String, String> {
    // 用户指定的路径优先
    if let Some(p) = custom_path {
        if Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }

    // 常见安装路径
    let search_paths = if cfg!(target_os = "macos") {
        vec![
            format!("/opt/homebrew/bin/{}", name),
            format!("/usr/local/bin/{}", name),
            format!("/usr/bin/{}", name),
            // PostgreSQL.app
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

    // 尝试 which/where
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

    // 判断是自定义格式还是 SQL 文件
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
