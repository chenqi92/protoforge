// ProtoForge - Postman Collection v2.1 解析器
// 将 Postman 导出的 JSON 转换为 ProtoForge 的 Collection + CollectionItem 结构

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

// ── Import Logic ──

pub async fn import_postman(pool: &SqlitePool, json: &str) -> Result<Collection, String> {
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
    let mut pre_script = String::new();
    let mut post_script = String::new();
    // 集合级 events 不在 PostmanCollection 顶级，通常在 item 层

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

// ── Helper extractors ──

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
