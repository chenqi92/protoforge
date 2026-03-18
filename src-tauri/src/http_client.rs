// ProtoForge HTTP 客户端引擎
// 支持 7 种方法、多种 Body 类型、3 种认证、详细时序

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

/// 请求配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub query_params: HashMap<String, String>,
    pub body: Option<RequestBody>,
    pub auth: Option<AuthConfig>,
    pub timeout_ms: Option<u64>,
    pub follow_redirects: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RequestBody {
    None,
    #[serde(rename = "raw")]
    Raw { content: String, content_type: String },
    #[serde(rename = "json")]
    Json { data: String },
    #[serde(rename = "formUrlencoded")]
    FormUrlencoded { fields: HashMap<String, String> },
    #[serde(rename = "binary")]
    Binary { data: Vec<u8>, filename: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AuthConfig {
    #[serde(rename = "bearer")]
    Bearer { token: String },
    #[serde(rename = "basic")]
    Basic { username: String, password: String },
    #[serde(rename = "apiKey")]
    ApiKey { key: String, value: String, add_to: String },
}

/// 响应结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_size: u64,
    pub content_type: Option<String>,
    pub duration_ms: u64,
    pub timing: ResponseTiming,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTiming {
    pub total_ms: u64,
}

/// 执行 HTTP 请求
pub async fn execute_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let start = Instant::now();

    // 构建 URL（含 query params）
    let mut url = url::Url::parse(&req.url)
        .map_err(|e| format!("URL 解析失败: {}", e))?;
    for (k, v) in &req.query_params {
        url.query_pairs_mut().append_pair(k, v);
    }

    // 构建客户端
    let mut client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(true);

    if let Some(timeout) = req.timeout_ms {
        client_builder = client_builder.timeout(std::time::Duration::from_millis(timeout));
    } else {
        client_builder = client_builder.timeout(std::time::Duration::from_secs(30));
    }

    if let Some(false) = req.follow_redirects {
        client_builder = client_builder.redirect(reqwest::redirect::Policy::none());
    }

    let client = client_builder.build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 方法
    let method = req.method.to_uppercase();
    let reqwest_method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(format!("不支持的方法: {}", method)),
    };

    let mut request_builder = client.request(reqwest_method, url.as_str());

    // Headers
    let mut header_map = HeaderMap::new();
    for (k, v) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            header_map.insert(name, value);
        }
    }

    // Auth
    if let Some(ref auth) = req.auth {
        match auth {
            AuthConfig::Bearer { token } => {
                header_map.insert(
                    reqwest::header::AUTHORIZATION,
                    HeaderValue::from_str(&format!("Bearer {}", token))
                        .unwrap_or_else(|_| HeaderValue::from_static("")),
                );
            }
            AuthConfig::Basic { username, password } => {
                request_builder = request_builder.basic_auth(username, Some(password));
            }
            AuthConfig::ApiKey { key, value, add_to } => {
                if add_to == "header" {
                    if let (Ok(name), Ok(val)) = (
                        HeaderName::from_bytes(key.as_bytes()),
                        HeaderValue::from_str(value),
                    ) {
                        header_map.insert(name, val);
                    }
                }
                // query 方式已在 query_params 中处理
            }
        }
    }

    request_builder = request_builder.headers(header_map);

    // Body
    if let Some(ref body) = req.body {
        match body {
            RequestBody::None => {}
            RequestBody::Raw { content, content_type } => {
                request_builder = request_builder
                    .header("Content-Type", content_type.as_str())
                    .body(content.clone());
            }
            RequestBody::Json { data } => {
                request_builder = request_builder
                    .header("Content-Type", "application/json")
                    .body(data.clone());
            }
            RequestBody::FormUrlencoded { fields } => {
                let encoded: String = url::form_urlencoded::Serializer::new(String::new())
                    .extend_pairs(fields.iter())
                    .finish();
                request_builder = request_builder
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .body(encoded);
            }
            RequestBody::Binary { data, .. } => {
                request_builder = request_builder
                    .header("Content-Type", "application/octet-stream")
                    .body(data.clone());
            }
        }
    }

    // 发送请求
    let response = request_builder.send().await
        .map_err(|e| format!("请求发送失败: {}", e))?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason()
        .unwrap_or("Unknown").to_string();

    // 响应 headers
    let mut resp_headers = HashMap::new();
    let mut content_type = None;
    for (k, v) in response.headers() {
        let key = k.as_str().to_string();
        let value = v.to_str().unwrap_or("").to_string();
        if key.eq_ignore_ascii_case("content-type") {
            content_type = Some(value.clone());
        }
        resp_headers.insert(key, value);
    }

    // 响应 body
    let body_bytes = response.bytes().await
        .map_err(|e| format!("读取响应 body 失败: {}", e))?;
    let body_size = body_bytes.len() as u64;

    // 尝试转为文本
    let body_text = String::from_utf8_lossy(&body_bytes).to_string();

    let total_duration = start.elapsed().as_millis() as u64;

    Ok(HttpResponse {
        status,
        status_text,
        headers: resp_headers,
        body: body_text,
        body_size,
        content_type,
        duration_ms: total_duration,
        timing: ResponseTiming {
            total_ms: total_duration,
        },
    })
}
