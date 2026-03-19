// ProtoForge - Swagger / OpenAPI 2.0 & 3.x 解析器
// 从 URL 获取 Swagger 文档，解析出所有接口列表，并支持选择性导入

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;
use chrono::Utc;
use crate::collections::{self, Collection, CollectionItem};

// ── 输出类型 (返回给前端) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerParseResult {
    pub title: String,
    pub version: String,
    pub description: String,
    pub base_url: String,
    pub endpoints: Vec<SwaggerEndpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerEndpoint {
    pub path: String,
    pub method: String,
    pub summary: String,
    pub description: String,
    pub tag: String,
    pub operation_id: String,
    pub parameters: Vec<SwaggerParameter>,
    pub request_body: Option<SwaggerRequestBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerParameter {
    pub name: String,
    pub location: String,       // query, header, path, cookie
    pub required: bool,
    pub param_type: String,     // string, integer, boolean, etc.
    pub description: String,
    pub default_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerRequestBody {
    pub content_type: String,        // application/json, multipart/form-data, etc.
    pub schema_json: String,         // 示例 JSON 或 schema 描述
    pub required: bool,
}

// ── 核心函数 ──

/// 从 URL 获取并解析 Swagger/OpenAPI 文档
pub async fn fetch_and_parse(url: &str) -> Result<SwaggerParseResult, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client.get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("获取 Swagger 文档失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP 错误: {}", resp.status()));
    }

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let doc: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 判断版本
    if doc.get("openapi").is_some() {
        parse_openapi3(&doc, url)
    } else if doc.get("swagger").is_some() {
        parse_swagger2(&doc, url)
    } else {
        Err("无法识别的文档格式：既非 OpenAPI 3.x 也非 Swagger 2.0".to_string())
    }
}

/// 解析 OpenAPI 3.x
fn parse_openapi3(doc: &serde_json::Value, source_url: &str) -> Result<SwaggerParseResult, String> {
    let info = doc.get("info").unwrap_or(&serde_json::Value::Null);
    let title = info.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled API").to_string();
    let version = info.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0").to_string();
    let description = info.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // 提取 base URL
    let base_url = extract_base_url_v3(doc, source_url);

    let mut endpoints = Vec::new();
    if let Some(paths) = doc.get("paths").and_then(|v| v.as_object()) {
        for (path, path_obj) in paths {
            if let Some(obj) = path_obj.as_object() {
                let path_params = extract_parameters_v3(obj.get("parameters"), doc);

                for method in &["get", "post", "put", "delete", "patch", "head", "options"] {
                    if let Some(operation) = obj.get(*method) {
                        let summary = operation.get("summary")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();
                        let desc = operation.get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();
                        let tag = operation.get("tags")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|v| v.as_str())
                            .unwrap_or("default").to_string();
                        let operation_id = operation.get("operationId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();

                        let mut params = path_params.clone();
                        params.extend(extract_parameters_v3(operation.get("parameters"), doc));

                        let request_body = extract_request_body_v3(operation.get("requestBody"), doc);

                        endpoints.push(SwaggerEndpoint {
                            path: path.clone(),
                            method: method.to_uppercase(),
                            summary,
                            description: desc,
                            tag,
                            operation_id,
                            parameters: params,
                            request_body,
                        });
                    }
                }
            }
        }
    }

    Ok(SwaggerParseResult { title, version, description, base_url, endpoints })
}

/// 解析 Swagger 2.0
fn parse_swagger2(doc: &serde_json::Value, source_url: &str) -> Result<SwaggerParseResult, String> {
    let info = doc.get("info").unwrap_or(&serde_json::Value::Null);
    let title = info.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled API").to_string();
    let version = info.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0").to_string();
    let description = info.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // 提取 base URL
    let base_url = extract_base_url_v2(doc, source_url);

    let mut endpoints = Vec::new();
    if let Some(paths) = doc.get("paths").and_then(|v| v.as_object()) {
        for (path, path_obj) in paths {
            if let Some(obj) = path_obj.as_object() {
                let path_params = extract_parameters_v2(obj.get("parameters"), doc);

                for method in &["get", "post", "put", "delete", "patch", "head", "options"] {
                    if let Some(operation) = obj.get(*method) {
                        let summary = operation.get("summary")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();
                        let desc = operation.get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();
                        let tag = operation.get("tags")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|v| v.as_str())
                            .unwrap_or("default").to_string();
                        let operation_id = operation.get("operationId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("").to_string();

                        let mut params = path_params.clone();
                        let op_params = extract_parameters_v2(operation.get("parameters"), doc);

                        // Swagger 2.0: body 参数在 parameters 中
                        let mut request_body: Option<SwaggerRequestBody> = None;
                        for p in &op_params {
                            if p.location == "body" {
                                request_body = Some(SwaggerRequestBody {
                                    content_type: "application/json".to_string(),
                                    schema_json: p.default_value.clone(),
                                    required: p.required,
                                });
                            }
                        }

                        // 检查 consumes 中是否包含 form-data
                        let consumes = operation.get("consumes")
                            .or_else(|| doc.get("consumes"));
                        let has_formdata = op_params.iter().any(|p| p.location == "formData");
                        if has_formdata && request_body.is_none() {
                            let content_type = if consumes.and_then(|v| v.as_array())
                                .map(|arr| arr.iter().any(|v| v.as_str() == Some("multipart/form-data")))
                                .unwrap_or(false) {
                                "multipart/form-data"
                            } else {
                                "application/x-www-form-urlencoded"
                            };
                            request_body = Some(SwaggerRequestBody {
                                content_type: content_type.to_string(),
                                schema_json: "{}".to_string(),
                                required: true,
                            });
                        }

                        // 过滤掉 body/formData 参数
                        params.extend(op_params.into_iter()
                            .filter(|p| p.location != "body" && p.location != "formData"));

                        endpoints.push(SwaggerEndpoint {
                            path: path.clone(),
                            method: method.to_uppercase(),
                            summary,
                            description: desc,
                            tag,
                            operation_id,
                            parameters: params,
                            request_body,
                        });
                    }
                }
            }
        }
    }

    Ok(SwaggerParseResult { title, version, description, base_url, endpoints })
}

// ── 参数提取 helpers ──

fn extract_parameters_v3(params_val: Option<&serde_json::Value>, doc: &serde_json::Value) -> Vec<SwaggerParameter> {
    let mut result = Vec::new();
    if let Some(arr) = params_val.and_then(|v| v.as_array()) {
        for param in arr {
            let param = resolve_ref(param, doc);
            let name = param.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let location = param.get("in").and_then(|v| v.as_str()).unwrap_or("query").to_string();
            let required = param.get("required").and_then(|v| v.as_bool()).unwrap_or(location == "path");
            let desc = param.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();

            let schema = param.get("schema").unwrap_or(&serde_json::Value::Null);
            let param_type = schema.get("type").and_then(|v| v.as_str()).unwrap_or("string").to_string();
            let default_value = schema.get("default")
                .map(|v| v.to_string())
                .unwrap_or_default();

            result.push(SwaggerParameter {
                name,
                location,
                required,
                param_type,
                description: desc,
                default_value,
            });
        }
    }
    result
}

fn extract_parameters_v2(params_val: Option<&serde_json::Value>, doc: &serde_json::Value) -> Vec<SwaggerParameter> {
    let mut result = Vec::new();
    if let Some(arr) = params_val.and_then(|v| v.as_array()) {
        for param in arr {
            let param = resolve_ref(param, doc);
            let name = param.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let location = param.get("in").and_then(|v| v.as_str()).unwrap_or("query").to_string();
            let required = param.get("required").and_then(|v| v.as_bool()).unwrap_or(location == "path");
            let desc = param.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let param_type = param.get("type").and_then(|v| v.as_str()).unwrap_or("string").to_string();

            let default_value = if location == "body" {
                // 尝试从 schema 生成示例
                param.get("schema")
                    .map(|s| generate_example_json(s, doc))
                    .unwrap_or_default()
            } else {
                param.get("default")
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            };

            result.push(SwaggerParameter {
                name,
                location,
                required,
                param_type,
                description: desc,
                default_value,
            });
        }
    }
    result
}

fn extract_request_body_v3(body_val: Option<&serde_json::Value>, doc: &serde_json::Value) -> Option<SwaggerRequestBody> {
    let body = body_val?;
    let body = resolve_ref(body, doc);
    let required = body.get("required").and_then(|v| v.as_bool()).unwrap_or(false);

    let content = body.get("content")?.as_object()?;

    // 优先 application/json
    if let Some(json_content) = content.get("application/json") {
        let schema = json_content.get("schema");
        let schema_json = schema.map(|s| generate_example_json(s, doc)).unwrap_or_else(|| "{}".to_string());
        return Some(SwaggerRequestBody {
            content_type: "application/json".to_string(),
            schema_json,
            required,
        });
    }

    // multipart/form-data
    if let Some(form_content) = content.get("multipart/form-data") {
        let schema = form_content.get("schema");
        let schema_json = schema.map(|s| generate_example_json(s, doc)).unwrap_or_else(|| "{}".to_string());
        return Some(SwaggerRequestBody {
            content_type: "multipart/form-data".to_string(),
            schema_json,
            required,
        });
    }

    // application/x-www-form-urlencoded
    if let Some(urlencoded) = content.get("application/x-www-form-urlencoded") {
        let schema = urlencoded.get("schema");
        let schema_json = schema.map(|s| generate_example_json(s, doc)).unwrap_or_else(|| "{}".to_string());
        return Some(SwaggerRequestBody {
            content_type: "application/x-www-form-urlencoded".to_string(),
            schema_json,
            required,
        });
    }

    // 其他类型
    if let Some((ct, ct_obj)) = content.iter().next() {
        let schema = ct_obj.get("schema");
        let schema_json = schema.map(|s| generate_example_json(s, doc)).unwrap_or_else(|| "{}".to_string());
        return Some(SwaggerRequestBody {
            content_type: ct.clone(),
            schema_json,
            required,
        });
    }

    None
}

// ── $ref 解析 ──

fn resolve_ref<'a>(val: &'a serde_json::Value, doc: &'a serde_json::Value) -> &'a serde_json::Value {
    if let Some(ref_str) = val.get("$ref").and_then(|v| v.as_str()) {
        // #/components/schemas/Xxx  or  #/definitions/Xxx
        let parts: Vec<&str> = ref_str.trim_start_matches('#').trim_start_matches('/')
            .split('/').collect();
        let mut current = doc;
        for part in parts {
            current = current.get(part).unwrap_or(&serde_json::Value::Null);
        }
        if current.is_null() { val } else { current }
    } else {
        val
    }
}

/// 根据 JSON Schema 生成示例 JSON
fn generate_example_json(schema: &serde_json::Value, doc: &serde_json::Value) -> String {
    let example = generate_example_value(schema, doc, 0);
    serde_json::to_string_pretty(&example).unwrap_or_else(|_| "{}".to_string())
}

fn generate_example_value(schema: &serde_json::Value, doc: &serde_json::Value, depth: u32) -> serde_json::Value {
    if depth > 5 {
        return serde_json::Value::Null;
    }

    let schema = resolve_ref(schema, doc);

    // 优先使用 example
    if let Some(example) = schema.get("example") {
        return example.clone();
    }

    let type_str = schema.get("type").and_then(|v| v.as_str()).unwrap_or("object");
    match type_str {
        "object" => {
            let mut obj = serde_json::Map::new();
            if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
                for (key, prop_schema) in props {
                    obj.insert(key.clone(), generate_example_value(prop_schema, doc, depth + 1));
                }
            }
            serde_json::Value::Object(obj)
        }
        "array" => {
            let items = schema.get("items").unwrap_or(&serde_json::Value::Null);
            let item_example = generate_example_value(items, doc, depth + 1);
            serde_json::Value::Array(vec![item_example])
        }
        "string" => {
            let format = schema.get("format").and_then(|v| v.as_str()).unwrap_or("");
            match format {
                "date-time" => serde_json::json!("2024-01-01T00:00:00Z"),
                "date" => serde_json::json!("2024-01-01"),
                "email" => serde_json::json!("user@example.com"),
                "uri" | "url" => serde_json::json!("https://example.com"),
                _ => {
                    if let Some(enum_vals) = schema.get("enum").and_then(|v| v.as_array()) {
                        enum_vals.first().cloned().unwrap_or(serde_json::json!("string"))
                    } else {
                        serde_json::json!("string")
                    }
                }
            }
        }
        "integer" | "number" => {
            if let Some(enum_vals) = schema.get("enum").and_then(|v| v.as_array()) {
                enum_vals.first().cloned().unwrap_or(serde_json::json!(0))
            } else {
                serde_json::json!(0)
            }
        }
        "boolean" => serde_json::json!(false),
        _ => serde_json::Value::Null,
    }
}

// ── URL 构建 helpers ──

fn extract_base_url_v3(doc: &serde_json::Value, source_url: &str) -> String {
    // 优先从 servers[0].url 取
    if let Some(servers) = doc.get("servers").and_then(|v| v.as_array()) {
        if let Some(first) = servers.first() {
            if let Some(url) = first.get("url").and_then(|v| v.as_str()) {
                // 如果是相对路径，拼接 source_url
                if url.starts_with('/') {
                    if let Ok(parsed) = url::Url::parse(source_url) {
                        return format!("{}://{}{}", parsed.scheme(), parsed.host_str().unwrap_or(""), url);
                    }
                }
                return url.to_string();
            }
        }
    }
    // fallback: source URL 的 origin
    if let Ok(parsed) = url::Url::parse(source_url) {
        return format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
    }
    String::new()
}

fn extract_base_url_v2(doc: &serde_json::Value, source_url: &str) -> String {
    let host = doc.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let base_path = doc.get("basePath").and_then(|v| v.as_str()).unwrap_or("");
    let schemes = doc.get("schemes").and_then(|v| v.as_array());
    let scheme = schemes
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .unwrap_or("https");

    if !host.is_empty() {
        format!("{}://{}{}", scheme, host, base_path)
    } else if let Ok(parsed) = url::Url::parse(source_url) {
        format!("{}://{}{}", parsed.scheme(), parsed.host_str().unwrap_or(""), base_path)
    } else {
        String::new()
    }
}

// ══════════════════════════════════════════════
//  选择性导入
// ══════════════════════════════════════════════

pub async fn import_selected(
    pool: &SqlitePool,
    collection_name: &str,
    base_url: &str,
    endpoints: &[SwaggerEndpoint],
) -> Result<Collection, String> {
    let now = Utc::now().to_rfc3339();
    let col_id = Uuid::new_v4().to_string();

    let collection = Collection {
        id: col_id.clone(),
        name: collection_name.to_string(),
        description: format!("从 Swagger 导入，共 {} 个接口", endpoints.len()),
        auth: None,
        pre_script: String::new(),
        post_script: String::new(),
        variables: "{}".to_string(),
        sort_order: 0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    collections::create_collection(pool, collection.clone()).await?;

    // 按 tag 分组创建文件夹
    let mut tag_folders: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for (idx, ep) in endpoints.iter().enumerate() {
        // 获取或创建 tag 文件夹
        let parent_id = if ep.tag.is_empty() || ep.tag == "default" {
            None
        } else {
            if !tag_folders.contains_key(&ep.tag) {
                let folder_id = Uuid::new_v4().to_string();
                let folder = CollectionItem {
                    id: folder_id.clone(),
                    collection_id: col_id.clone(),
                    parent_id: None,
                    item_type: "folder".to_string(),
                    name: ep.tag.clone(),
                    sort_order: tag_folders.len() as i64,
                    method: None,
                    url: None,
                    headers: "{}".to_string(),
                    query_params: "{}".to_string(),
                    body_type: "none".to_string(),
                    body_content: "".to_string(),
                    auth_type: "none".to_string(),
                    auth_config: "{}".to_string(),
                    pre_script: String::new(),
                    post_script: String::new(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                collections::create_collection_item(pool, folder).await?;
                tag_folders.insert(ep.tag.clone(), folder_id);
            }
            Some(tag_folders[&ep.tag].clone())
        };

        // 构造 URL
        let full_url = format!("{}{}", base_url.trim_end_matches('/'), ep.path);

        // 构造 query params
        let query_obj: serde_json::Map<String, serde_json::Value> = ep.parameters.iter()
            .filter(|p| p.location == "query")
            .map(|p| (p.name.clone(), serde_json::json!(p.default_value.trim_matches('"'))))
            .collect();
        let query_params = serde_json::to_string(&query_obj).unwrap_or_else(|_| "{}".to_string());

        // 构造 headers
        let header_obj: serde_json::Map<String, serde_json::Value> = ep.parameters.iter()
            .filter(|p| p.location == "header")
            .map(|p| (p.name.clone(), serde_json::json!(p.default_value.trim_matches('"'))))
            .collect();
        let headers = serde_json::to_string(&header_obj).unwrap_or_else(|_| "{}".to_string());

        // 构造 body
        let (body_type, body_content) = if let Some(ref rb) = ep.request_body {
            match rb.content_type.as_str() {
                "application/json" => ("json".to_string(), rb.schema_json.clone()),
                "multipart/form-data" => ("formData".to_string(), rb.schema_json.clone()),
                "application/x-www-form-urlencoded" => ("formUrlencoded".to_string(), rb.schema_json.clone()),
                _ => ("raw".to_string(), rb.schema_json.clone()),
            }
        } else {
            ("none".to_string(), String::new())
        };

        // 名称: 优先 summary，其次 operationId，最后 method + path
        let name = if !ep.summary.is_empty() {
            ep.summary.clone()
        } else if !ep.operation_id.is_empty() {
            ep.operation_id.clone()
        } else {
            format!("{} {}", ep.method, ep.path)
        };

        let item = CollectionItem {
            id: Uuid::new_v4().to_string(),
            collection_id: col_id.clone(),
            parent_id,
            item_type: "request".to_string(),
            name,
            sort_order: idx as i64,
            method: Some(ep.method.clone()),
            url: Some(full_url),
            headers,
            query_params,
            body_type,
            body_content,
            auth_type: "none".to_string(),
            auth_config: "{}".to_string(),
            pre_script: String::new(),
            post_script: String::new(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };

        collections::create_collection_item(pool, item).await?;
    }

    Ok(collection)
}
