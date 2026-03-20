// ProtoForge - Postman Collection v2.1 解析器 + 导出器
// 导入: 将 Postman 导出的 JSON 转换为 ProtoForge 的 Collection + CollectionItem 结构
// 导出: 将 ProtoForge 的 Collection + CollectionItem 转换为 Postman v2.1 JSON

use serde::Deserialize;
use sqlx::SqlitePool;
use uuid::Uuid;
use chrono::Utc;
use crate::collections::{self, Collection, CollectionItem};

// ── Postman v2.1 schema types ──

#[derive(Debug, Deserialize)]
pub struct PostmanCollection {
    pub info: PostmanInfo,
    #[serde(default)]
    pub item: Vec<PostmanItem>,
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
    #[serde(default)]
    pub variable: Option<Vec<PostmanVariable>>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanItem {
    pub name: String,
    #[serde(default)]
    pub item: Option<Vec<PostmanItem>>,       // folder children
    #[serde(default)]
    pub request: Option<PostmanRequest>,       // request (leaf)
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
    #[serde(default)]
    pub event: Option<Vec<PostmanEvent>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct PostmanRequest {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub url: Option<PostmanUrl>,
    #[serde(default)]
    pub header: Option<Vec<PostmanKeyValue>>,
    #[serde(default)]
    pub body: Option<PostmanBody>,
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanUrl {
    Plain(String),
    Structured(PostmanUrlObj),
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct PostmanUrlObj {
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub host: Option<Vec<String>>,
    #[serde(default)]
    pub path: Option<Vec<String>>,
    #[serde(default)]
    pub query: Option<Vec<PostmanQueryParam>>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanQueryParam {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct PostmanKeyValue {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(rename = "type", default)]
    pub kv_type: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBody {
    #[serde(default)]
    pub mode: Option<String>,            // raw, formdata, urlencoded, file, graphql
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub formdata: Option<Vec<PostmanFormData>>,
    #[serde(default)]
    pub urlencoded: Option<Vec<PostmanKeyValue>>,
    #[serde(default)]
    pub options: Option<PostmanBodyOptions>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct PostmanFormData {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(rename = "type", default)]
    pub data_type: Option<String>,   // text | file
    #[serde(default)]
    pub src: Option<String>,
    #[serde(default)]
    pub disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBodyOptions {
    #[serde(default)]
    pub raw: Option<PostmanRawOptions>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanRawOptions {
    #[serde(default)]
    pub language: Option<String>,    // json, xml, text etc.
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(default)]
    pub bearer: Option<Vec<PostmanKeyValue>>,
    #[serde(default)]
    pub basic: Option<Vec<PostmanKeyValue>>,
    #[serde(default)]
    pub apikey: Option<Vec<PostmanKeyValue>>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanEvent {
    pub listen: String,              // prerequest | test
    #[serde(default)]
    pub script: Option<PostmanScript>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanScript {
    #[serde(default)]
    pub exec: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanVariable {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
}

// ══════════════════════════════════════════════
//  Export: ProtoForge → Postman v2.1
// ══════════════════════════════════════════════

pub async fn export_postman(pool: &SqlitePool, collection_id: &str) -> Result<String, String> {
    let col = collections::get_collection(pool, collection_id).await?;
    let items = collections::list_collection_items(pool, collection_id).await?;

    // 构建集合级 auth
    let auth_out = col.auth.as_ref().and_then(|s| build_export_auth_from_json(s));

    // 构建集合级 variables
    let variables_out = build_export_variables(&col.variables);

    // 构建集合级 events
    let mut events_out: Vec<serde_json::Value> = Vec::new();
    if !col.pre_script.is_empty() {
        events_out.push(build_export_event("prerequest", &col.pre_script));
    }
    if !col.post_script.is_empty() {
        events_out.push(build_export_event("test", &col.post_script));
    }

    // 递归构建 item 树 (顶级 parent_id = None)
    let item_tree = build_item_tree(&items, None);

    let mut postman_json = serde_json::json!({
        "info": {
            "_postman_id": col.id,
            "name": col.name,
            "description": col.description,
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        "item": item_tree
    });

    if let Some(auth) = auth_out {
        postman_json["auth"] = auth;
    }
    if !variables_out.is_empty() {
        postman_json["variable"] = serde_json::json!(variables_out);
    }
    if !events_out.is_empty() {
        postman_json["event"] = serde_json::json!(events_out);
    }

    serde_json::to_string_pretty(&postman_json)
        .map_err(|e| format!("导出 Postman JSON 失败: {}", e))
}

/// 递归构建 Postman item 树
fn build_item_tree(all_items: &[CollectionItem], parent_id: Option<&str>) -> Vec<serde_json::Value> {
    let mut result = Vec::new();

    let children: Vec<&CollectionItem> = all_items.iter()
        .filter(|i| i.parent_id.as_deref() == parent_id)
        .collect();

    let mut sorted_children = children;
    sorted_children.sort_by_key(|i| i.sort_order);

    for item in sorted_children {
        if item.item_type == "folder" {
            // 文件夹
            let sub_items = build_item_tree(all_items, Some(&item.id));
            let mut folder_json = serde_json::json!({
                "name": item.name,
                "item": sub_items
            });

            // 文件夹级 events
            let mut events: Vec<serde_json::Value> = Vec::new();
            if !item.pre_script.is_empty() {
                events.push(build_export_event("prerequest", &item.pre_script));
            }
            if !item.post_script.is_empty() {
                events.push(build_export_event("test", &item.post_script));
            }
            if !events.is_empty() {
                folder_json["event"] = serde_json::json!(events);
            }

            result.push(folder_json);
        } else {
            // 请求
            let method = item.method.clone().unwrap_or_else(|| "GET".to_string());
            let url_str = item.url.clone().unwrap_or_default();

            // 构建 URL 对象
            let url_obj = build_export_url(&url_str, &item.query_params);

            // 构建 headers
            let headers_out = build_export_headers(&item.headers);

            // 构建 body
            let body_out = build_export_body(&item.body_type, &item.body_content);

            // 构建 auth
            let auth_out = if item.auth_type != "none" {
                build_export_auth(&item.auth_type, &item.auth_config)
            } else {
                None
            };

            let mut request_json = serde_json::json!({
                "method": method,
                "header": headers_out,
                "url": url_obj
            });

            if let Some(body) = body_out {
                request_json["body"] = body;
            }
            if let Some(auth) = auth_out {
                request_json["auth"] = auth;
            }

            let mut item_json = serde_json::json!({
                "name": item.name,
                "request": request_json,
                "response": []
            });

            // 请求级 events
            let mut events: Vec<serde_json::Value> = Vec::new();
            if !item.pre_script.is_empty() {
                events.push(build_export_event("prerequest", &item.pre_script));
            }
            if !item.post_script.is_empty() {
                events.push(build_export_event("test", &item.post_script));
            }
            if !events.is_empty() {
                item_json["event"] = serde_json::json!(events);
            }

            result.push(item_json);
        }
    }

    result
}

fn build_export_url(url_str: &str, query_params_json: &str) -> serde_json::Value {
    // 解析 query params
    let mut query_arr: Vec<serde_json::Value> = Vec::new();
    if let Ok(params) = serde_json::from_str::<serde_json::Value>(query_params_json) {
        if let Some(obj) = params.as_object() {
            for (k, v) in obj {
                query_arr.push(serde_json::json!({
                    "key": k,
                    "value": v.as_str().unwrap_or("")
                }));
            }
        }
    }

    // 分解 URL（相对路径如 /api/v1/users 会解析失败，此时仅输出 raw 字段）
    let parsed = url::Url::parse(url_str);
    let mut url_json = serde_json::json!({ "raw": url_str });

    if let Ok(u) = parsed {
        let host: Vec<String> = u.host_str()
            .map(|h| h.split('.').map(|s| s.to_string()).collect())
            .unwrap_or_default();
        let path: Vec<String> = u.path().trim_start_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        if let Some(scheme) = Some(u.scheme().to_string()) {
            url_json["protocol"] = serde_json::json!(scheme);
        }
        if !host.is_empty() {
            url_json["host"] = serde_json::json!(host);
        }
        if let Some(port) = u.port() {
            url_json["port"] = serde_json::json!(port.to_string());
        }
        if !path.is_empty() {
            url_json["path"] = serde_json::json!(path);
        }
    }

    if !query_arr.is_empty() {
        url_json["query"] = serde_json::json!(query_arr);
    }

    url_json
}

fn build_export_headers(headers_json: &str) -> Vec<serde_json::Value> {
    let mut result = Vec::new();
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(headers_json) {
        if let Some(map) = obj.as_object() {
            for (k, v) in map {
                result.push(serde_json::json!({
                    "key": k,
                    "value": v.as_str().unwrap_or(""),
                    "type": "text"
                }));
            }
        }
    }
    result
}

fn build_export_body(body_type: &str, body_content: &str) -> Option<serde_json::Value> {
    match body_type {
        "json" => Some(serde_json::json!({
            "mode": "raw",
            "raw": body_content,
            "options": {
                "raw": {
                    "language": "json"
                }
            }
        })),
        "raw" => Some(serde_json::json!({
            "mode": "raw",
            "raw": body_content,
            "options": {
                "raw": {
                    "language": "text"
                }
            }
        })),
        "formData" => {
            let fields: Vec<serde_json::Value> = serde_json::from_str(body_content)
                .unwrap_or_default();
            let formdata: Vec<serde_json::Value> = fields.iter().map(|f| {
                serde_json::json!({
                    "key": f.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                    "value": f.get("value").and_then(|v| v.as_str()).unwrap_or(""),
                    "type": f.get("fieldType").and_then(|v| v.as_str()).unwrap_or("text"),
                    "disabled": f.get("enabled").and_then(|v| v.as_bool()).map(|e| !e).unwrap_or(false)
                })
            }).collect();
            Some(serde_json::json!({
                "mode": "formdata",
                "formdata": formdata
            }))
        }
        "formUrlencoded" => {
            let mut urlencoded: Vec<serde_json::Value> = Vec::new();
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(body_content) {
                if let Some(map) = obj.as_object() {
                    for (k, v) in map {
                        urlencoded.push(serde_json::json!({
                            "key": k,
                            "value": v.as_str().unwrap_or(""),
                            "type": "text"
                        }));
                    }
                }
            }
            Some(serde_json::json!({
                "mode": "urlencoded",
                "urlencoded": urlencoded
            }))
        }
        _ => None,
    }
}

fn build_export_auth(auth_type: &str, auth_config: &str) -> Option<serde_json::Value> {
    let config: serde_json::Value = serde_json::from_str(auth_config).unwrap_or_default();

    match auth_type {
        "bearer" => {
            let token = config.get("bearerToken")
                .or_else(|| {
                    config.get("bearer").and_then(|b| b.as_array())
                        .and_then(|arr| arr.iter().find(|kv| kv.get("key").and_then(|k| k.as_str()) == Some("token")))
                        .and_then(|kv| kv.get("value"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(serde_json::json!({
                "type": "bearer",
                "bearer": [{ "key": "token", "value": token, "type": "string" }]
            }))
        }
        "basic" => {
            let username = config.get("basicUsername")
                .or_else(|| {
                    config.get("basic").and_then(|b| b.as_array())
                        .and_then(|arr| arr.iter().find(|kv| kv.get("key").and_then(|k| k.as_str()) == Some("username")))
                        .and_then(|kv| kv.get("value"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let password = config.get("basicPassword")
                .or_else(|| {
                    config.get("basic").and_then(|b| b.as_array())
                        .and_then(|arr| arr.iter().find(|kv| kv.get("key").and_then(|k| k.as_str()) == Some("password")))
                        .and_then(|kv| kv.get("value"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(serde_json::json!({
                "type": "basic",
                "basic": [
                    { "key": "username", "value": username, "type": "string" },
                    { "key": "password", "value": password, "type": "string" }
                ]
            }))
        }
        "apiKey" => {
            let api_key = config.get("apiKeyName")
                .and_then(|v| v.as_str())
                .unwrap_or("api_key");
            let api_value = config.get("apiKeyValue")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let api_in = config.get("apiKeyIn")
                .and_then(|v| v.as_str())
                .unwrap_or("header");
            Some(serde_json::json!({
                "type": "apikey",
                "apikey": [
                    { "key": "key", "value": api_key, "type": "string" },
                    { "key": "value", "value": api_value, "type": "string" },
                    { "key": "in", "value": api_in, "type": "string" }
                ]
            }))
        }
        _ => None,
    }
}

fn build_export_auth_from_json(auth_json: &str) -> Option<serde_json::Value> {
    let config: serde_json::Value = serde_json::from_str(auth_json).ok()?;
    let auth_type = config.get("type").and_then(|v| v.as_str()).unwrap_or("none");
    if auth_type == "none" || auth_type == "noauth" {
        return None;
    }
    build_export_auth(auth_type, auth_json)
}

fn build_export_variables(variables_json: &str) -> Vec<serde_json::Value> {
    let mut result = Vec::new();
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(variables_json) {
        if let Some(map) = obj.as_object() {
            for (k, v) in map {
                result.push(serde_json::json!({
                    "key": k,
                    "value": v.as_str().unwrap_or(""),
                    "type": "default"
                }));
            }
        }
    }
    result
}

fn build_export_event(listen: &str, script_code: &str) -> serde_json::Value {
    let exec: Vec<&str> = script_code.lines().collect();
    serde_json::json!({
        "listen": listen,
        "script": {
            "exec": exec,
            "type": "text/javascript"
        }
    })
}

// ══════════════════════════════════════════════
//  Import: Postman v2.1 → ProtoForge
// ══════════════════════════════════════════════

pub async fn import_postman(pool: &SqlitePool, json: &str) -> Result<Collection, String> {
    // TODO: 整个导入过程（create_collection + import_items）理想情况下应包裹在事务中，
    // 中途失败时可回滚，避免留下不完整的集合。当前 create_collection_item 直接使用 pool，
    // 需要重构为接受 &mut Transaction 才能实现。
    let postman: PostmanCollection = serde_json::from_str(json)
        .map_err(|e| format!("Postman JSON 解析失败: {}", e))?;

    // 验证 schema
    if let Some(ref schema) = postman.info.schema {
        if !schema.contains("v2.1") && !schema.contains("v2.0") {
            return Err(format!("不支持的 Postman Collection 版本: {}", schema));
        }
    }

    let now = Utc::now().to_rfc3339();
    let col_id = Uuid::new_v4().to_string();

    // 处理集合级脚本
    let pre_script = String::new();
    let post_script = String::new();

    // 处理集合级变量
    let variables = if let Some(vars) = &postman.variable {
        let obj: serde_json::Value = vars.iter()
            .map(|v| (v.key.clone(), serde_json::Value::String(v.value.clone().unwrap_or_default())))
            .collect::<serde_json::Map<String, serde_json::Value>>()
            .into();
        serde_json::to_string(&obj).unwrap_or_default()
    } else {
        "{}".to_string()
    };

    // 处理集合级 auth
    let auth_json = postman.auth.as_ref().map(|a| convert_auth(a));

    let collection = Collection {
        id: col_id.clone(),
        name: postman.info.name.clone(),
        description: postman.info.description.clone().unwrap_or_default(),
        auth: auth_json,
        pre_script: pre_script.clone(),
        post_script: post_script.clone(),
        variables,
        sort_order: 0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    // 创建集合
    collections::create_collection(pool, collection.clone()).await?;

    // 递归导入 items
    import_items(pool, &col_id, None, &postman.item, &now, 0).await?;

    Ok(collection)
}

/// 递归导入 Postman items（支持嵌套文件夹）
async fn import_items(
    pool: &SqlitePool,
    collection_id: &str,
    parent_id: Option<&str>,
    items: &[PostmanItem],
    now: &str,
    depth: u32,
) -> Result<(), String> {
    if depth > 20 {
        return Err("文件夹嵌套层数过深（> 20）".to_string());
    }

    for (idx, pm_item) in items.iter().enumerate() {
        let item_id = Uuid::new_v4().to_string();

        // 提取脚本
        let (pre_script, post_script) = extract_scripts(&pm_item.event);

        if let Some(ref children) = pm_item.item {
            // 文件夹
            let folder = CollectionItem {
                id: item_id.clone(),
                collection_id: collection_id.to_string(),
                parent_id: parent_id.map(|s| s.to_string()),
                item_type: "folder".to_string(),
                name: pm_item.name.clone(),
                sort_order: idx as i64,
                method: None,
                url: None,
                headers: "{}".to_string(),
                query_params: "{}".to_string(),
                body_type: "none".to_string(),
                body_content: "".to_string(),
                auth_type: "none".to_string(),
                auth_config: "{}".to_string(),
                pre_script,
                post_script,
                created_at: now.to_string(),
                updated_at: now.to_string(),
            };
            collections::create_collection_item(pool, folder).await?;

            // 递归子项
            Box::pin(import_items(pool, collection_id, Some(&item_id), children, now, depth + 1)).await?;
        } else if let Some(ref request) = pm_item.request {
            // 请求
            let method = request.method.clone().unwrap_or_else(|| "GET".to_string()).to_uppercase();
            let url = extract_url(&request.url);
            let headers = extract_headers(&request.header);
            let query_params = extract_query_params(&request.url);
            let (body_type, body_content) = extract_body(&request.body);
            let (auth_type, auth_config) = extract_auth_config(&request.auth.as_ref().or(pm_item.auth.as_ref()));

            let item = CollectionItem {
                id: item_id,
                collection_id: collection_id.to_string(),
                parent_id: parent_id.map(|s| s.to_string()),
                item_type: "request".to_string(),
                name: pm_item.name.clone(),
                sort_order: idx as i64,
                method: Some(method),
                url: Some(url),
                headers,
                query_params,
                body_type,
                body_content,
                auth_type,
                auth_config,
                pre_script,
                post_script,
                created_at: now.to_string(),
                updated_at: now.to_string(),
            };
            collections::create_collection_item(pool, item).await?;
        }
    }

    Ok(())
}

// ── Helper extractors (import) ──

fn extract_url(url_opt: &Option<PostmanUrl>) -> String {
    match url_opt {
        Some(PostmanUrl::Plain(s)) => s.clone(),
        Some(PostmanUrl::Structured(obj)) => obj.raw.clone().unwrap_or_default(),
        None => String::new(),
    }
}

fn extract_headers(headers: &Option<Vec<PostmanKeyValue>>) -> String {
    let obj: serde_json::Value = match headers {
        Some(h) => h.iter()
            .filter(|kv| kv.disabled != Some(true))
            .map(|kv| (kv.key.clone(), serde_json::Value::String(kv.value.clone().unwrap_or_default())))
            .collect::<serde_json::Map<String, serde_json::Value>>()
            .into(),
        None => serde_json::Value::Object(Default::default()),
    };
    serde_json::to_string(&obj).unwrap_or_else(|_| "{}".to_string())
}

fn extract_query_params(url_opt: &Option<PostmanUrl>) -> String {
    let params = match url_opt {
        Some(PostmanUrl::Structured(obj)) => {
            if let Some(ref query) = obj.query {
                let map: serde_json::Map<String, serde_json::Value> = query.iter()
                    .filter(|q| q.disabled != Some(true))
                    .filter_map(|q| q.key.as_ref().map(|k| (k.clone(), serde_json::Value::String(q.value.clone().unwrap_or_default()))))
                    .collect();
                serde_json::Value::Object(map)
            } else {
                serde_json::Value::Object(Default::default())
            }
        }
        _ => serde_json::Value::Object(Default::default()),
    };
    serde_json::to_string(&params).unwrap_or_else(|_| "{}".to_string())
}

fn extract_body(body: &Option<PostmanBody>) -> (String, String) {
    match body {
        None => ("none".to_string(), String::new()),
        Some(b) => {
            let mode = b.mode.as_deref().unwrap_or("none");
            match mode {
                "raw" => {
                    let language = b.options.as_ref()
                        .and_then(|o| o.raw.as_ref())
                        .and_then(|r| r.language.as_deref())
                        .unwrap_or("text");
                    let body_type = if language == "json" { "json" } else { "raw" };
                    (body_type.to_string(), b.raw.clone().unwrap_or_default())
                }
                "formdata" => {
                    let fields: Vec<serde_json::Value> = b.formdata.as_ref()
                        .map(|fd| fd.iter().map(|f| {
                            serde_json::json!({
                                "key": f.key,
                                "value": f.value.clone().unwrap_or_default(),
                                "fieldType": f.data_type.clone().unwrap_or_else(|| "text".to_string()),
                                "enabled": f.disabled != Some(true),
                            })
                        }).collect())
                        .unwrap_or_default();
                    ("formData".to_string(), serde_json::to_string(&fields).unwrap_or_else(|_| "[]".to_string()))
                }
                "urlencoded" => {
                    let fields: serde_json::Map<String, serde_json::Value> = b.urlencoded.as_ref()
                        .map(|ue| ue.iter()
                            .filter(|kv| kv.disabled != Some(true))
                            .map(|kv| (kv.key.clone(), serde_json::Value::String(kv.value.clone().unwrap_or_default())))
                            .collect())
                        .unwrap_or_default();
                    ("formUrlencoded".to_string(), serde_json::to_string(&fields).unwrap_or_else(|_| "{}".to_string()))
                }
                _ => ("none".to_string(), String::new()),
            }
        }
    }
}

fn convert_auth(auth: &PostmanAuth) -> String {
    let obj = serde_json::json!({
        "type": auth.auth_type,
        "bearer": auth.bearer.as_ref().map(|kvs| kvs.iter().map(|kv| serde_json::json!({"key": kv.key, "value": kv.value})).collect::<Vec<_>>()),
        "basic": auth.basic.as_ref().map(|kvs| kvs.iter().map(|kv| serde_json::json!({"key": kv.key, "value": kv.value})).collect::<Vec<_>>()),
        "apikey": auth.apikey.as_ref().map(|kvs| kvs.iter().map(|kv| serde_json::json!({"key": kv.key, "value": kv.value})).collect::<Vec<_>>()),
    });
    serde_json::to_string(&obj).unwrap_or_else(|_| "{}".to_string())
}

fn extract_auth_config(auth: &Option<&PostmanAuth>) -> (String, String) {
    match auth {
        None => ("none".to_string(), "{}".to_string()),
        Some(a) => {
            let auth_type = match a.auth_type.as_str() {
                "bearer" => "bearer",
                "basic" => "basic",
                "apikey" => "apiKey",
                _ => "none",
            };
            (auth_type.to_string(), convert_auth(a))
        }
    }
}

fn extract_scripts(events: &Option<Vec<PostmanEvent>>) -> (String, String) {
    let mut pre = String::new();
    let mut post = String::new();
    if let Some(evts) = events {
        for evt in evts {
            if let Some(ref script) = evt.script {
                if let Some(ref lines) = script.exec {
                    let code = lines.join("\n");
                    match evt.listen.as_str() {
                        "prerequest" => pre = code,
                        "test" => post = code,
                        _ => {}
                    }
                }
            }
        }
    }
    (pre, post)
}
