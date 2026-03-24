// ProtoForge - Swagger / OpenAPI 2.0 & 3.x 智能解析器
// 支持：
//   1. 从任意 URL（doc.html, swagger-ui, 直接 JSON 端点）自动探测 API 文档
//   2. 分组发现（通过 swagger-config）
//   3. Swagger 2.0 和 OpenAPI 3.x 兼容

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;
use chrono::Utc;
use crate::collections::{self, Collection, CollectionItem};

// ── 输出类型 (返回给前端) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerGroup {
    pub name: String,          // "default", "ais", "system" 等
    pub url: String,           // 完整的 API 文档 URL
    pub display_name: String,  // 展示名称
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwaggerDiscoveryResult {
    pub groups: Vec<SwaggerGroup>,
    pub default_result: Option<SwaggerParseResult>,
}

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
    pub response_example: String,
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

// ── HTTP 客户端 helper ──

fn build_client() -> Result<reqwest::Client, String> {
    // SECURITY NOTE: Swagger 探测常面向内网开发环境的自签证书服务，
    // 因此默认接受无效证书。如需更严格的验证，可将此项改为 false 或暴露为参数。
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    let resp = client.get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求失败 ({}): {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} ({})", resp.status(), url));
    }

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败 ({}): {}", url, e))
}

// ── URL 规范化 ──

/// 从用户输入的 URL 提取 base origin
/// 例：http://host:port/doc.html#/home  →  http://host:port
/// 例：http://host:port/swagger-ui/index.html  →  http://host:port
/// 例：http://host:port/v3/api-docs/ais  →  保持原样（稍后直接请求）
fn extract_base_origin(url: &str) -> String {
    // 去掉 # 锚点
    let url = url.split('#').next().unwrap_or(url);

    if let Ok(parsed) = url::Url::parse(url) {
        let port_str = parsed.port()
            .map(|p| format!(":{}", p))
            .unwrap_or_default();
        format!("{}://{}{}", parsed.scheme(), parsed.host_str().unwrap_or(""), port_str)
    } else {
        url.to_string()
    }
}

/// 判断 URL 是否是文档页面（而非 API JSON 端点）
fn is_doc_page_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let lower = lower.split('#').next().unwrap_or(&lower);
    lower.ends_with("/doc.html")
        || lower.ends_with("/swagger-ui.html")
        || lower.ends_with("/swagger-ui/index.html")
        || lower.contains("/doc.html")
        || lower.contains("/swagger-ui.html")
        || lower.contains("/swagger-ui/index.html")
}

/// 判断 URL 是否可能直接指向带 context-path 的 swagger-config
/// 例如: http://host/context-path/v3/api-docs/swagger-config
fn extract_context_path(url: &str) -> Option<String> {
    let url_no_hash = url.split('#').next().unwrap_or(url);
    if let Ok(parsed) = url::Url::parse(url_no_hash) {
        let path = parsed.path();
        // 如果路径包含 doc.html、swagger-ui 等，尝试提取它前面的部分作为 context-path
        for page in &["/doc.html", "/swagger-ui.html", "/swagger-ui/index.html"] {
            if let Some(idx) = path.to_lowercase().find(page) {
                let ctx = &path[..idx];
                if !ctx.is_empty() {
                    return Some(ctx.to_string());
                }
                return None;
            }
        }
        // 对于 v3/api-docs 或 v2/api-docs 路径，提取前缀
        for api_path in &["/v3/api-docs", "/v2/api-docs", "/swagger-resources"] {
            if let Some(idx) = path.to_lowercase().find(api_path) {
                let ctx = &path[..idx];
                if !ctx.is_empty() {
                    return Some(ctx.to_string());
                }
                return None;
            }
        }
    }
    None
}

// ── 核心：智能探测 ──

/// 智能探测 Swagger/OpenAPI 文档
/// 支持从任意 URL 自动发现 API 文档端点和分组
pub async fn discover_and_parse(url: &str) -> Result<SwaggerDiscoveryResult, String> {
    let client = build_client()?;
    let url = url.trim();

    // Step 1: 如果用户直接给了 JSON 端点 URL，先尝试直接请求
    if !is_doc_page_url(url) {
        if let Ok(doc) = fetch_json(&client, url).await {
            // 检查是否是 swagger-config 响应
            if let Some(groups) = try_parse_swagger_config(&doc, url) {
                if !groups.is_empty() {
                    // 获取第一个分组的文档作为默认结果
                    let default_result = fetch_and_parse_doc(&client, &groups[0].url).await.ok();
                    return Ok(SwaggerDiscoveryResult { groups, default_result });
                }
            }

            // 检查是否是 swagger-resources 响应（Spring Boot 旧版）
            if let Some(groups) = try_parse_swagger_resources(&doc, url) {
                if !groups.is_empty() {
                    let default_result = fetch_and_parse_doc(&client, &groups[0].url).await.ok();
                    return Ok(SwaggerDiscoveryResult { groups, default_result });
                }
            }

            // 检查是否直接是 OpenAPI/Swagger 文档
            if doc.get("openapi").is_some() || doc.get("swagger").is_some() {
                let result = parse_doc(&doc, url)?;
                return Ok(SwaggerDiscoveryResult {
                    groups: vec![SwaggerGroup {
                        name: "default".to_string(),
                        url: url.to_string(),
                        display_name: result.title.clone(),
                    }],
                    default_result: Some(result),
                });
            }
        }
    }

    // Step 2: 从 URL 提取 base origin 和 context-path
    let base = extract_base_origin(url);
    let context_path = extract_context_path(url).unwrap_or_default();
    let base_with_ctx = format!("{}{}", base, context_path);

    // Step 3: 尝试 swagger-config 发现分组
    let config_url = format!("{}/v3/api-docs/swagger-config", base_with_ctx);
    if let Ok(config_doc) = fetch_json(&client, &config_url).await {
        if let Some(groups) = try_parse_swagger_config(&config_doc, &base_with_ctx) {
            if !groups.is_empty() {
                let default_result = fetch_and_parse_doc(&client, &groups[0].url).await.ok();
                return Ok(SwaggerDiscoveryResult { groups, default_result });
            }
        }
    }

    // Step 4: 尝试 swagger-resources（Spring Boot 旧版 Swagger 2）
    let resources_url = format!("{}/swagger-resources", base_with_ctx);
    if let Ok(resources_doc) = fetch_json(&client, &resources_url).await {
        if let Some(groups) = try_parse_swagger_resources(&resources_doc, &base_with_ctx) {
            if !groups.is_empty() {
                let default_result = fetch_and_parse_doc(&client, &groups[0].url).await.ok();
                return Ok(SwaggerDiscoveryResult { groups, default_result });
            }
        }
    }

    // Step 5: 逐个尝试常见端点
    let candidates = vec![
        format!("{}/v3/api-docs", base_with_ctx),
        format!("{}/v2/api-docs", base_with_ctx),
    ];

    let mut last_error = String::new();
    for candidate in &candidates {
        match fetch_and_parse_doc(&client, candidate).await {
            Ok(result) => {
                return Ok(SwaggerDiscoveryResult {
                    groups: vec![SwaggerGroup {
                        name: "default".to_string(),
                        url: candidate.clone(),
                        display_name: result.title.clone(),
                    }],
                    default_result: Some(result),
                });
            }
            Err(e) => { last_error = e; }
        }
    }

    Err(format!(
        "无法从 URL \"{}\" 发现 Swagger/OpenAPI 文档。\n\
         已尝试以下端点均失败：\n  - {}\n  - swagger-config: {}\n  - swagger-resources: {}\n\
         最后错误: {}",
        url,
        candidates.join("\n  - "),
        config_url,
        resources_url,
        last_error,
    ))
}

/// 尝试从 swagger-config JSON 中解析分组列表
fn try_parse_swagger_config(doc: &serde_json::Value, base_url: &str) -> Option<Vec<SwaggerGroup>> {
    // swagger-config 格式：{ "urls": [{ "url": "/v3/api-docs/xxx", "name": "xxx" }, ...] }
    let urls = doc.get("urls")?.as_array()?;
    if urls.is_empty() {
        return None;
    }

    let base = extract_base_origin(base_url);
    let context_path = extract_context_path(base_url).unwrap_or_default();

    let groups: Vec<SwaggerGroup> = urls.iter().filter_map(|entry| {
        let url_path = entry.get("url")?.as_str()?;
        let name = entry.get("name").and_then(|v| v.as_str()).unwrap_or("default");

        // url 可能是相对路径或绝对路径
        let full_url = if url_path.starts_with("http://") || url_path.starts_with("https://") {
            url_path.to_string()
        } else {
            format!("{}{}", base, url_path)
        };

        // 如果 URL 不包含 context path 但 context path 存在，尝试加上
        let final_url = if !context_path.is_empty()
            && !full_url.contains(&context_path)
            && !url_path.starts_with("http")
        {
            format!("{}{}{}", base, context_path, url_path)
        } else {
            full_url
        };

        Some(SwaggerGroup {
            name: name.to_string(),
            url: final_url,
            display_name: name.to_string(),
        })
    }).collect();

    if groups.is_empty() { None } else { Some(groups) }
}

/// 尝试从 swagger-resources JSON 中解析分组列表（Spring Boot 旧版）
fn try_parse_swagger_resources(doc: &serde_json::Value, base_url: &str) -> Option<Vec<SwaggerGroup>> {
    // swagger-resources 格式: [{ "url": "/v2/api-docs?group=xxx", "name": "xxx", "location": "/v2/api-docs?group=xxx" }, ...]
    let arr = doc.as_array()?;
    if arr.is_empty() {
        return None;
    }

    let base = extract_base_origin(base_url);

    let groups: Vec<SwaggerGroup> = arr.iter().filter_map(|entry| {
        let url_path = entry.get("url")
            .or_else(|| entry.get("location"))
            .and_then(|v| v.as_str())?;
        let name = entry.get("name").and_then(|v| v.as_str()).unwrap_or("default");

        let full_url = if url_path.starts_with("http://") || url_path.starts_with("https://") {
            url_path.to_string()
        } else {
            format!("{}{}", base, url_path)
        };

        Some(SwaggerGroup {
            name: name.to_string(),
            url: full_url,
            display_name: name.to_string(),
        })
    }).collect();

    if groups.is_empty() { None } else { Some(groups) }
}

// ── 文档获取与解析 ──

/// 获取并解析单个 Swagger/OpenAPI 文档 URL
pub async fn fetch_and_parse_doc(client: &reqwest::Client, url: &str) -> Result<SwaggerParseResult, String> {
    let doc = fetch_json(client, url).await?;
    parse_doc(&doc, url)
}

/// 获取指定分组的文档（供前端分组切换时调用）
pub async fn fetch_group(url: &str) -> Result<SwaggerParseResult, String> {
    let client = build_client()?;
    fetch_and_parse_doc(&client, url).await
}

/// 解析已获取的 JSON 文档
fn parse_doc(doc: &serde_json::Value, url: &str) -> Result<SwaggerParseResult, String> {
    if doc.get("openapi").is_some() {
        parse_openapi3(doc, url)
    } else if doc.get("swagger").is_some() {
        parse_swagger2(doc, url)
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

                        // 提取响应示例 (200/201)
                        let response_example = extract_response_example(operation.get("responses"), doc);

                        endpoints.push(SwaggerEndpoint {
                            path: path.clone(),
                            method: method.to_uppercase(),
                            summary,
                            description: desc,
                            tag,
                            operation_id,
                            parameters: params,
                            request_body,
                            response_example,
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

                        // 提取响应示例 (200/201)
                        let response_example = extract_response_example(operation.get("responses"), doc);

                        endpoints.push(SwaggerEndpoint {
                            path: path.clone(),
                            method: method.to_uppercase(),
                            summary,
                            description: desc,
                            tag,
                            operation_id,
                            parameters: params,
                            request_body,
                            response_example,
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

/// 从 responses 对象中提取成功响应(200/201)的示例 JSON
fn extract_response_example(responses_val: Option<&serde_json::Value>, doc: &serde_json::Value) -> String {
    let responses = match responses_val {
        Some(r) => r,
        None => return String::new(),
    };

    // 优先 200，其次 201
    let success_resp = responses.get("200")
        .or_else(|| responses.get("201"))
        .or_else(|| responses.get("default"));

    let resp = match success_resp {
        Some(r) => resolve_ref(r, doc),
        None => return String::new(),
    };

    // OpenAPI 3.x: responses.200.content.application/json.schema
    if let Some(content) = resp.get("content").and_then(|c| c.as_object()) {
        if let Some(json_content) = content.get("application/json") {
            // 优先 example 字段
            if let Some(example) = json_content.get("example") {
                return serde_json::to_string_pretty(example).unwrap_or_default();
            }
            // 优先 examples.*.value
            if let Some(examples) = json_content.get("examples").and_then(|e| e.as_object()) {
                if let Some(first) = examples.values().next() {
                    if let Some(val) = first.get("value") {
                        return serde_json::to_string_pretty(val).unwrap_or_default();
                    }
                }
            }
            // 从 schema 生成
            if let Some(schema) = json_content.get("schema") {
                let example = generate_example_json(schema, doc);
                if example != "null" {
                    return example;
                }
            }
        }
    }

    // Swagger 2.0: responses.200.schema
    if let Some(schema) = resp.get("schema") {
        let example = generate_example_json(schema, doc);
        if example != "null" {
            return example;
        }
    }

    // 兜底: responses.200.examples.application/json
    if let Some(examples) = resp.get("examples") {
        if let Some(json_example) = examples.get("application/json") {
            return serde_json::to_string_pretty(json_example).unwrap_or_default();
        }
    }

    String::new()
}

// ── $ref 解析 ──

fn resolve_ref<'a>(val: &'a serde_json::Value, doc: &'a serde_json::Value) -> &'a serde_json::Value {
    resolve_ref_depth(val, doc, 0)
}

/// 带深度限制的 $ref 解析，防止循环引用导致无限递归
fn resolve_ref_depth<'a>(val: &'a serde_json::Value, doc: &'a serde_json::Value, depth: u32) -> &'a serde_json::Value {
    if depth > 10 {
        return val; // 超过深度限制，返回原始值
    }
    if let Some(ref_str) = val.get("$ref").and_then(|v| v.as_str()) {
        // #/components/schemas/Xxx  or  #/definitions/Xxx
        let parts: Vec<&str> = ref_str.trim_start_matches('#').trim_start_matches('/')
            .split('/').collect();
        let mut current = doc;
        for part in parts {
            current = current.get(part).unwrap_or(&serde_json::Value::Null);
        }
        if current.is_null() {
            val
        } else if current.get("$ref").is_some() {
            // 递归解析嵌套 $ref
            resolve_ref_depth(current, doc, depth + 1)
        } else {
            current
        }
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
        variables: serde_json::json!({"baseUrl": base_url.trim_end_matches('/')}).to_string(),
        sort_order: 0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    // TODO: 与 postman_compat::import_postman 相同，create_collection + 逐条 create_collection_item
    // 应包裹在事务中，避免中途失败留下不完整集合。
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
                    response_example: String::new(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                collections::create_collection_item(pool, folder).await?;
                tag_folders.insert(ep.tag.clone(), folder_id);
            }
            Some(tag_folders[&ep.tag].clone())
        };

        // 构造 URL — 使用 {{baseUrl}} 变量，发送时由前端变量系统解析
        let full_url = format!("{{{{baseUrl}}}}{}", ep.path);

        // 构造 query params — 前端期望格式: [{key, value, description, enabled}]
        let query_arr: Vec<serde_json::Value> = ep.parameters.iter()
            .filter(|p| p.location == "query")
            .map(|p| serde_json::json!({
                "key": p.name,
                "value": p.default_value.trim_matches('"'),
                "description": p.description,
                "enabled": true
            }))
            .collect();
        let query_params = serde_json::to_string(&query_arr).unwrap_or_else(|_| "[]".to_string());

        // 构造 headers — 前端期望格式: [{key, value, description, enabled}]
        let header_arr: Vec<serde_json::Value> = ep.parameters.iter()
            .filter(|p| p.location == "header")
            .map(|p| serde_json::json!({
                "key": p.name,
                "value": p.default_value.trim_matches('"'),
                "description": p.description,
                "enabled": true
            }))
            .collect();
        let headers = serde_json::to_string(&header_arr).unwrap_or_else(|_| "[]".to_string());

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
            response_example: ep.response_example.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };

        collections::create_collection_item(pool, item).await?;
    }

    Ok(collection)
}
