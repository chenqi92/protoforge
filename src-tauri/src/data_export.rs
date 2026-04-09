//! 多格式数据导出引擎
//!
//! 从 JSON 数组生成 CSV / Markdown / SQL / InfluxDB / Excel 等格式。
//! 全部在 Rust 端执行，避免前端阻塞和依赖漏洞。

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 前端传来的导出请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    /// JSON 响应体字符串
    pub body: String,
    /// 数组节点的 JSON 路径（如 "data.records" 或 "(root)"）
    pub json_path: String,
    /// 导出格式 ID
    pub format: String,
    /// 格式特定的选项
    #[serde(default)]
    pub options: std::collections::HashMap<String, String>,
}

/// 导出结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataResult {
    /// 文本内容（文本格式时有值）
    pub content: Option<String>,
    /// Base64 编码的二进制内容（Excel 等二进制格式时有值）
    pub binary_base64: Option<String>,
    /// 建议的文件名
    pub filename: String,
    /// MIME 类型
    pub mime_type: String,
    /// 错误信息
    pub error: Option<String>,
}

impl ExportDataResult {
    fn error(msg: impl Into<String>) -> Self {
        Self {
            content: None,
            binary_base64: None,
            filename: String::new(),
            mime_type: String::new(),
            error: Some(msg.into()),
        }
    }
}

/// 执行导出
pub fn export_data(req: &ExportDataRequest) -> ExportDataResult {
    // 解析 JSON
    let parsed: Value = match serde_json::from_str(&req.body) {
        Ok(v) => v,
        Err(e) => return ExportDataResult::error(format!("JSON 解析失败: {}", e)),
    };

    // 按路径提取数组
    let arr = match get_by_path(&parsed, &req.json_path) {
        Some(Value::Array(a)) if !a.is_empty() => a,
        Some(Value::Array(_)) => return ExportDataResult::error("数组为空"),
        _ => return ExportDataResult::error(format!("路径 '{}' 不是数组或不存在", req.json_path)),
    };

    // 收集列名
    let columns = collect_columns(arr);
    let path_suffix = if req.json_path == "(root)" {
        "root".to_string()
    } else {
        req.json_path.replace(['.', '[', ']'], "_")
    };

    match req.format.as_str() {
        "csv" => export_csv(arr, &columns, &path_suffix),
        "markdown" => export_markdown(arr, &columns, &path_suffix),
        "mysql" => export_sql(arr, &columns, &path_suffix, "mysql", &req.options),
        "postgresql" => export_sql(arr, &columns, &path_suffix, "postgresql", &req.options),
        "sqlite" => export_sql(arr, &columns, &path_suffix, "sqlite", &req.options),
        "influxdb" => export_influxdb(arr, &columns, &path_suffix, &req.options),
        "excel" => export_excel(arr, &columns, &path_suffix),
        _ => ExportDataResult::error(format!("未知的导出格式: {}", req.format)),
    }
}

// ── 路径解析 ──

fn get_by_path<'a>(val: &'a Value, path: &str) -> Option<&'a Value> {
    if path == "(root)" {
        return Some(val);
    }
    let normalized = path.replace(|c: char| c == '[', ".").replace(']', "");
    let mut current = val;
    for part in normalized.split('.') {
        if part.is_empty() {
            continue;
        }
        match current {
            Value::Object(map) => {
                current = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

// ── 列名收集 ──

fn collect_columns(arr: &[Value]) -> Vec<String> {
    let mut seen = indexmap::IndexSet::new();
    for item in arr {
        if let Value::Object(map) = item {
            for key in map.keys() {
                seen.insert(key.clone());
            }
        }
    }
    if seen.is_empty() {
        vec!["value".to_string()]
    } else {
        seen.into_iter().collect()
    }
}

fn get_cell(row: &Value, col: &str) -> String {
    match row {
        Value::Object(map) => match map.get(col) {
            Some(Value::Null) | None => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::Bool(b)) => b.to_string(),
            Some(v) => v.to_string(), // 嵌套对象/数组序列化
        },
        // 非对象行（纯值数组）
        _ if col == "value" => match row {
            Value::Null => String::new(),
            Value::String(s) => s.clone(),
            _ => row.to_string(),
        },
        _ => String::new(),
    }
}

// ── CSV ──

fn escape_csv(val: &str) -> String {
    if val.contains(',') || val.contains('"') || val.contains('\n') || val.contains('\r') {
        format!("\"{}\"", val.replace('"', "\"\""))
    } else {
        val.to_string()
    }
}

fn export_csv(arr: &[Value], columns: &[String], path_suffix: &str) -> ExportDataResult {
    let mut buf = String::with_capacity(arr.len() * columns.len() * 20);
    buf.push('\u{FEFF}'); // UTF-8 BOM
    // 表头
    buf.push_str(&columns.iter().map(|c| escape_csv(c)).collect::<Vec<_>>().join(","));
    buf.push_str("\r\n");
    // 数据行
    for row in arr {
        buf.push_str(&columns.iter().map(|c| escape_csv(&get_cell(row, c))).collect::<Vec<_>>().join(","));
        buf.push_str("\r\n");
    }
    ExportDataResult {
        content: Some(buf),
        binary_base64: None,
        filename: format!("export_{}.csv", path_suffix),
        mime_type: "text/csv".to_string(),
        error: None,
    }
}

// ── Markdown ──

fn escape_md(val: &str) -> String {
    val.replace('|', "\\|").replace('\n', " ")
}

fn export_markdown(arr: &[Value], columns: &[String], path_suffix: &str) -> ExportDataResult {
    let mut buf = String::with_capacity(arr.len() * columns.len() * 20);
    // 表头
    buf.push_str("| ");
    buf.push_str(&columns.iter().map(|c| escape_md(c)).collect::<Vec<_>>().join(" | "));
    buf.push_str(" |\n");
    // 分隔线
    buf.push_str("| ");
    buf.push_str(&columns.iter().map(|_| "---").collect::<Vec<_>>().join(" | "));
    buf.push_str(" |\n");
    // 数据行
    for row in arr {
        buf.push_str("| ");
        buf.push_str(&columns.iter().map(|c| escape_md(&get_cell(row, c))).collect::<Vec<_>>().join(" | "));
        buf.push_str(" |\n");
    }
    ExportDataResult {
        content: Some(buf),
        binary_base64: None,
        filename: format!("export_{}.md", path_suffix),
        mime_type: "text/markdown".to_string(),
        error: None,
    }
}

// ── SQL INSERT ──

fn escape_sql(val: &str) -> String {
    val.replace('\'', "''")
}

fn export_sql(
    arr: &[Value],
    columns: &[String],
    path_suffix: &str,
    dialect: &str,
    options: &std::collections::HashMap<String, String>,
) -> ExportDataResult {
    let table = options.get("tableName").map(|s| s.as_str()).unwrap_or("table_name");
    let mut buf = String::with_capacity(arr.len() * columns.len() * 30);

    buf.push_str(&format!("-- {} INSERT statements\n", dialect.to_uppercase()));
    buf.push_str("-- Generated by ProtoForge\n\n");

    let quote_col = |col: &str| -> String {
        if dialect == "mysql" { format!("`{}`", col) } else { format!("\"{}\"", col) }
    };
    let quoted_table = if dialect == "mysql" { format!("`{}`", table) } else { format!("\"{}\"", table) };
    let col_list = columns.iter().map(|c| quote_col(c)).collect::<Vec<_>>().join(", ");

    for row in arr {
        let values: Vec<String> = columns.iter().map(|col| {
            match row {
                Value::Object(map) => match map.get(col) {
                    Some(Value::Null) | None => "NULL".to_string(),
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::Bool(b)) => {
                        if dialect == "mysql" { if *b { "1" } else { "0" }.to_string() }
                        else { if *b { "TRUE" } else { "FALSE" }.to_string() }
                    }
                    Some(Value::String(s)) => format!("'{}'", escape_sql(s)),
                    Some(v) => format!("'{}'", escape_sql(&v.to_string())),
                },
                _ => "NULL".to_string(),
            }
        }).collect();
        buf.push_str(&format!("INSERT INTO {} ({}) VALUES ({});\n", quoted_table, col_list, values.join(", ")));
    }

    ExportDataResult {
        content: Some(buf),
        binary_base64: None,
        filename: format!("export_{}_{}.sql", path_suffix, dialect),
        mime_type: "application/sql".to_string(),
        error: None,
    }
}

// ── InfluxDB Line Protocol ──

fn escape_influx_tag(val: &str) -> String {
    val.replace(' ', "\\ ").replace(',', "\\,").replace('=', "\\=")
}

fn export_influxdb(
    arr: &[Value],
    columns: &[String],
    path_suffix: &str,
    options: &std::collections::HashMap<String, String>,
) -> ExportDataResult {
    let measurement = options.get("measurement").map(|s| s.as_str()).unwrap_or("measurement");
    let tag_keys: Vec<&str> = options
        .get("tagKeys")
        .map(|s| s.split(',').map(str::trim).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    let mut buf = String::with_capacity(arr.len() * 100);

    for row in arr {
        let obj = match row.as_object() {
            Some(o) => o,
            None => continue,
        };

        // tags
        let tags: Vec<String> = tag_keys.iter().filter_map(|&k| {
            let v = obj.get(k)?;
            if v.is_object() || v.is_array() || v.is_null() { return None; }
            Some(format!("{}={}", k, escape_influx_tag(&v.to_string().trim_matches('"').to_string())))
        }).collect();

        // fields
        let fields: Vec<String> = columns.iter().filter_map(|col| {
            if tag_keys.contains(&col.as_str()) { return None; }
            let v = obj.get(col)?;
            match v {
                Value::Null => None,
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() { Some(format!("{}={}i", col, i)) }
                    else { Some(format!("{}={}", col, n)) }
                }
                Value::Bool(b) => Some(format!("{}={}", col, b)),
                Value::String(s) => Some(format!("{}=\"{}\"", col, s.replace('"', "\\\""))),
                _ => Some(format!("{}=\"{}\"", col, v.to_string().replace('"', "\\\""))),
            }
        }).collect();

        if fields.is_empty() { continue; }
        let tag_part = if tags.is_empty() { String::new() } else { format!(",{}", tags.join(",")) };
        buf.push_str(&format!("{}{} {}\n", measurement, tag_part, fields.join(",")));
    }

    ExportDataResult {
        content: Some(buf),
        binary_base64: None,
        filename: format!("export_{}_influxdb.txt", path_suffix),
        mime_type: "text/plain".to_string(),
        error: None,
    }
}

// ── Excel (.xlsx) ──

fn export_excel(arr: &[Value], columns: &[String], path_suffix: &str) -> ExportDataResult {
    use rust_xlsxwriter::*;

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // 表头加粗
    let header_fmt = Format::new().set_bold();
    for (col_idx, col_name) in columns.iter().enumerate() {
        let _ = worksheet.write_string_with_format(0, col_idx as u16, col_name, &header_fmt);
    }

    // 数据行
    for (row_idx, row) in arr.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32;
        for (col_idx, col_name) in columns.iter().enumerate() {
            let excel_col = col_idx as u16;
            match row {
                Value::Object(map) => match map.get(col_name) {
                    Some(Value::Number(n)) => {
                        if let Some(f) = n.as_f64() {
                            let _ = worksheet.write_number(excel_row, excel_col, f);
                        }
                    }
                    Some(Value::Bool(b)) => {
                        let _ = worksheet.write_boolean(excel_row, excel_col, *b);
                    }
                    Some(Value::String(s)) => {
                        let _ = worksheet.write_string(excel_row, excel_col, s);
                    }
                    Some(Value::Null) | None => {}
                    Some(v) => {
                        let _ = worksheet.write_string(excel_row, excel_col, &v.to_string());
                    }
                },
                _ if col_name == "value" => {
                    let _ = worksheet.write_string(excel_row, excel_col, &get_cell(row, col_name));
                }
                _ => {}
            }
        }
    }

    // 自动列宽
    let _ = worksheet.autofit();

    match workbook.save_to_buffer() {
        Ok(buf) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
            ExportDataResult {
                content: None,
                binary_base64: Some(b64),
                filename: format!("export_{}.xlsx", path_suffix),
                mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
                error: None,
            }
        }
        Err(e) => ExportDataResult::error(format!("生成 Excel 失败: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_req(body: &str, path: &str, format: &str) -> ExportDataRequest {
        ExportDataRequest {
            body: body.to_string(),
            json_path: path.to_string(),
            format: format.to_string(),
            options: std::collections::HashMap::new(),
        }
    }

    fn make_req_with_opts(body: &str, path: &str, format: &str, opts: Vec<(&str, &str)>) -> ExportDataRequest {
        ExportDataRequest {
            body: body.to_string(),
            json_path: path.to_string(),
            format: format.to_string(),
            options: opts.into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    const SAMPLE_JSON: &str = r#"{"code":200,"data":{"records":[{"id":1,"name":"Alice","score":95.5},{"id":2,"name":"Bob","score":88.0}]}}"#;

    #[test]
    fn test_csv_export() {
        let req = make_req(SAMPLE_JSON, "data.records", "csv");
        let result = export_data(&req);
        assert!(result.error.is_none());
        let csv = result.content.unwrap();
        assert!(csv.contains("id,name,score"));
        assert!(csv.contains("1,Alice,95.5"));
        assert!(csv.contains("2,Bob,88"));
        assert!(csv.starts_with('\u{FEFF}')); // BOM
    }

    #[test]
    fn test_markdown_export() {
        let req = make_req(SAMPLE_JSON, "data.records", "markdown");
        let result = export_data(&req);
        assert!(result.error.is_none());
        let md = result.content.unwrap();
        assert!(md.contains("| id | name | score |"));
        assert!(md.contains("| --- | --- | --- |"));
        assert!(md.contains("| 1 | Alice | 95.5 |"));
    }

    #[test]
    fn test_mysql_export() {
        let req = make_req_with_opts(SAMPLE_JSON, "data.records", "mysql", vec![("tableName", "employees")]);
        let result = export_data(&req);
        assert!(result.error.is_none());
        let sql = result.content.unwrap();
        assert!(sql.contains("INSERT INTO `employees`"));
        assert!(sql.contains("`id`, `name`, `score`"));
        assert!(sql.contains("1, 'Alice', 95.5"));
    }

    #[test]
    fn test_postgresql_export() {
        let req = make_req_with_opts(SAMPLE_JSON, "data.records", "postgresql", vec![("tableName", "emp")]);
        let result = export_data(&req);
        let sql = result.content.unwrap();
        assert!(sql.contains("INSERT INTO \"emp\""));
        assert!(sql.contains("\"id\", \"name\", \"score\""));
    }

    #[test]
    fn test_influxdb_export() {
        let body = r#"[{"device":"d1","temp":25.5,"status":"ok"},{"device":"d2","temp":30.1,"status":"warn"}]"#;
        let req = make_req_with_opts(body, "(root)", "influxdb", vec![
            ("measurement", "sensor"),
            ("tagKeys", "device,status"),
        ]);
        let result = export_data(&req);
        let lp = result.content.unwrap();
        assert!(lp.contains("sensor,device=d1,status=ok temp="));
        assert!(lp.contains("sensor,device=d2,status=warn temp="));
    }

    #[test]
    fn test_excel_export() {
        let req = make_req(SAMPLE_JSON, "data.records", "excel");
        let result = export_data(&req);
        assert!(result.error.is_none());
        assert!(result.binary_base64.is_some());
        assert!(result.filename.ends_with(".xlsx"));
        // 验证 base64 可解码
        let b64 = result.binary_base64.unwrap();
        let decoded = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
        assert!(decoded.len() > 100); // xlsx 应该有实质内容
        // xlsx 文件以 PK 开头（ZIP 格式）
        assert_eq!(&decoded[0..2], b"PK");
    }

    #[test]
    fn test_root_array() {
        let body = r#"[{"a":1},{"a":2}]"#;
        let req = make_req(body, "(root)", "csv");
        let result = export_data(&req);
        assert!(result.error.is_none());
        let csv = result.content.unwrap();
        assert!(csv.contains("a"));
        assert!(csv.contains("1"));
    }

    #[test]
    fn test_invalid_path() {
        let req = make_req(SAMPLE_JSON, "data.nonexistent", "csv");
        let result = export_data(&req);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_empty_array() {
        let req = make_req(r#"{"items":[]}"#, "items", "csv");
        let result = export_data(&req);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_bulk_csv_performance() {
        // 生成 10K 行数据
        let mut records = Vec::with_capacity(10_000);
        for i in 0..10_000 {
            records.push(serde_json::json!({"id": i, "name": format!("user_{}", i), "score": i as f64 * 0.1}));
        }
        let body = serde_json::json!({"data": records}).to_string();
        let req = make_req(&body, "data", "csv");

        let start = std::time::Instant::now();
        let result = export_data(&req);
        let elapsed = start.elapsed();

        assert!(result.error.is_none());
        let csv = result.content.unwrap();
        let line_count = csv.lines().count();
        assert_eq!(line_count, 10_001); // header + 10K rows
        println!("[perf] Rust CSV 10K rows: {}ms, {}KB", elapsed.as_millis(), csv.len() / 1024);
        assert!(elapsed.as_millis() < 1000, "10K rows CSV should be under 1s");
    }

    #[test]
    fn test_bulk_excel_performance() {
        let mut records = Vec::with_capacity(10_000);
        for i in 0..10_000 {
            records.push(serde_json::json!({"id": i, "name": format!("user_{}", i), "val": i as f64 * 0.5}));
        }
        let body = serde_json::json!({"data": records}).to_string();
        let req = make_req(&body, "data", "excel");

        let start = std::time::Instant::now();
        let result = export_data(&req);
        let elapsed = start.elapsed();

        assert!(result.error.is_none());
        assert!(result.binary_base64.is_some());
        let b64_len = result.binary_base64.unwrap().len();
        println!("[perf] Rust Excel 10K rows: {}ms, {}KB (base64)", elapsed.as_millis(), b64_len / 1024);
        assert!(elapsed.as_millis() < 5000, "10K rows Excel should be under 5s");
    }
}
