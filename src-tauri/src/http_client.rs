// ProtoForge HTTP 客户端引擎
// 支持 7 种方法、多种 Body 类型（含 multipart form-data）、4 种认证、Cookies、详细时序、前后置脚本

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use crate::script_engine::{self, ScriptResult, ScriptResponse};

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
    pub ssl_verify: Option<bool>,
    pub proxy: Option<ProxyConfig>,
}

/// 带脚本的请求配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestWithScripts {
    #[serde(flatten)]
    pub request: HttpRequest,
    pub pre_script: Option<String>,
    pub post_script: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(rename = "type")]
    pub proxy_type: String,     // "http" | "socks5"
    pub host: String,
    pub port: u16,
    pub auth: Option<ProxyAuth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyAuth {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RequestBody {
    None,
    #[serde(rename = "raw")]
    Raw { content: String, #[serde(default = "default_content_type")] content_type: String },
    #[serde(rename = "json")]
    Json { data: String },
    #[serde(rename = "formUrlencoded")]
    FormUrlencoded { fields: HashMap<String, String> },
    #[serde(rename = "formData")]
    FormData { fields: Vec<FormDataField> },
    #[serde(rename = "binary")]
    Binary { file_path: String },
}

fn default_content_type() -> String {
    "text/plain".to_string()
}

/// FormData 中的单个字段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormDataField {
    pub key: String,
    pub value: String,        // text value 或 file path
    pub field_type: String,   // "text" | "file"
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

/// Cookie 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub expires: Option<String>,
    pub http_only: bool,
    pub secure: bool,
    pub same_site: Option<String>,
}

/// 响应结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    /// 使用 Vec 保留同名 Header 的多个值（如多个 Set-Cookie）
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub body_size: u64,
    pub content_type: Option<String>,
    pub duration_ms: u64,
    pub timing: ResponseTiming,
    pub cookies: Vec<CookieInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTiming {
    pub total_ms: u64,
    pub connect_ms: Option<u64>,
    pub ttfb_ms: Option<u64>,
    pub download_ms: Option<u64>,
}

/// 带脚本的响应结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponseWithScripts {
    pub response: HttpResponse,
    pub pre_script_result: Option<ScriptResult>,
    pub post_script_result: Option<ScriptResult>,
}

/// 执行 HTTP 请求
/// SECURITY NOTE: 作为桌面端 API 调试工具，接受用户指定的任意 URL 是核心功能 (by-design)。
/// 不对内网地址 (127.0.0.1, 10.x.x.x 等) 做限制，因为这正是用户的使用场景。
pub async fn execute_request(req: HttpRequest) -> Result<HttpResponse, String> {
    let start = Instant::now();

    // 构建 URL（含 query params）
    let mut url = url::Url::parse(&req.url)
        .map_err(|e| format!("URL 解析失败: {}", e))?;
    for (k, v) in &req.query_params {
        url.query_pairs_mut().append_pair(k, v);
    }

    // 构建客户端
    let ssl_verify = req.ssl_verify.unwrap_or(true);
    let mut client_builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(!ssl_verify);

    // 代理
    if let Some(proxy_cfg) = &req.proxy {
        let proxy_url = if proxy_cfg.proxy_type == "socks5" {
            format!("socks5://{}:{}", proxy_cfg.host, proxy_cfg.port)
        } else {
            format!("http://{}:{}", proxy_cfg.host, proxy_cfg.port)
        };
        let mut proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("代理配置失败: {}", e))?;
        if let Some(auth) = &proxy_cfg.auth {
            proxy = proxy.basic_auth(&auth.username, &auth.password);
        }
        client_builder = client_builder.proxy(proxy);
    }

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
            RequestBody::FormData { fields } => {
                let mut form = reqwest::multipart::Form::new();
                for field in fields {
                    if field.field_type == "file" {
                        let file_path = std::path::Path::new(&field.value);
                        let file_bytes = tokio::fs::read(file_path).await
                            .map_err(|e| format!("读取文件失败 '{}': {}", field.value, e))?;
                        let file_name = file_path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "file".to_string());
                        let mime = mime_from_path(&field.value);
                        let part = reqwest::multipart::Part::bytes(file_bytes)
                            .file_name(file_name)
                            .mime_str(&mime)
                            .map_err(|e| format!("MIME 类型错误: {}", e))?;
                        form = form.part(field.key.clone(), part);
                    } else {
                        form = form.text(field.key.clone(), field.value.clone());
                    }
                }
                request_builder = request_builder.multipart(form);
            }
            RequestBody::Binary { file_path } => {
                let data = tokio::fs::read(file_path).await
                    .map_err(|e| format!("读取文件失败 '{}': {}", file_path, e))?;
                let mime = mime_from_path(file_path);
                request_builder = request_builder
                    .header("Content-Type", mime)
                    .body(data);
            }
        }
    }

    // 发送请求
    let response = request_builder.send().await
        .map_err(|e| format!("请求发送失败: {}", e))?;

    let ttfb_ms = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason()
        .unwrap_or("Unknown").to_string();

    // 响应 headers — 使用 Vec 保留同名 Header 的多个值（如多个 Set-Cookie）
    let mut resp_headers: Vec<(String, String)> = Vec::new();
    let mut content_type = None;
    for (k, v) in response.headers() {
        let key = k.as_str().to_string();
        let value = v.to_str().unwrap_or("").to_string();
        if key.eq_ignore_ascii_case("content-type") {
            content_type = Some(value.clone());
        }
        resp_headers.push((key, value));
    }

    // 解析 Cookies
    let cookies = parse_cookies_from_headers(&resp_headers);

    // 响应 body
    let download_start = Instant::now();
    let body_bytes = response.bytes().await
        .map_err(|e| format!("读取响应 body 失败: {}", e))?;
    let download_ms = download_start.elapsed().as_millis() as u64;
    let body_size = body_bytes.len() as u64;

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
            connect_ms: None, // reqwest 不暴露细粒度连接耗时
            ttfb_ms: Some(ttfb_ms),
            download_ms: Some(download_ms),
        },
        cookies,
    })
}

/// 带前后置脚本的请求执行
pub async fn execute_request_with_scripts(
    req: HttpRequestWithScripts,
) -> Result<HttpResponseWithScripts, String> {
    let env_vars = req.env_vars.unwrap_or_default();

    // 1. 执行前置脚本
    let pre_script_result = if let Some(ref script) = req.pre_script {
        if !script.trim().is_empty() {
            Some(script_engine::run_pre_script(script, &env_vars))
        } else {
            None
        }
    } else {
        None
    };

    // 如果前置脚本失败，直接返回
    if let Some(ref pre) = pre_script_result {
        if !pre.success {
            return Err(format!("前置脚本执行失败: {}", pre.error.as_deref().unwrap_or("unknown")));
        }
    }

    // 2. 执行 HTTP 请求
    let response = execute_request(req.request).await?;

    // 3. 执行后置脚本
    let post_script_result = if let Some(ref script) = req.post_script {
        if !script.trim().is_empty() {
            let script_resp = ScriptResponse {
                status: response.status,
                status_text: response.status_text.clone(),
                body: response.body.clone(),
                headers: response.headers.clone(),
                duration_ms: response.duration_ms,
            };
            // 合并前置脚本更新的环境变量
            let mut merged_env = env_vars;
            if let Some(ref pre) = pre_script_result {
                for (k, v) in &pre.env_updates {
                    merged_env.insert(k.clone(), v.clone());
                }
            }
            Some(script_engine::run_post_script(script, &merged_env, &script_resp))
        } else {
            None
        }
    } else {
        None
    };

    Ok(HttpResponseWithScripts {
        response,
        pre_script_result,
        post_script_result,
    })
}

/// 从响应 headers 解析 Set-Cookie（支持多个同名 header）
fn parse_cookies_from_headers(headers: &[(String, String)]) -> Vec<CookieInfo> {
    let mut cookies = Vec::new();
    for (key, value) in headers {
        if key.eq_ignore_ascii_case("set-cookie") {
            if let Some(cookie) = parse_single_cookie(value) {
                cookies.push(cookie);
            }
        }
    }
    cookies
}

fn parse_single_cookie(raw: &str) -> Option<CookieInfo> {
    let parts: Vec<&str> = raw.splitn(2, ';').collect();
    let name_value = parts.first()?;
    let (name, value) = name_value.split_once('=')?;

    let mut cookie = CookieInfo {
        name: name.trim().to_string(),
        value: value.trim().to_string(),
        domain: None,
        path: None,
        expires: None,
        http_only: false,
        secure: false,
        same_site: None,
    };

    if parts.len() > 1 {
        for attr in parts[1].split(';') {
            let attr = attr.trim();
            let lower = attr.to_lowercase();
            if lower == "httponly" {
                cookie.http_only = true;
            } else if lower == "secure" {
                cookie.secure = true;
            } else if let Some((k, v)) = attr.split_once('=') {
                let k_lower = k.trim().to_lowercase();
                let v_trimmed = v.trim().to_string();
                match k_lower.as_str() {
                    "domain" => cookie.domain = Some(v_trimmed),
                    "path" => cookie.path = Some(v_trimmed),
                    "expires" => cookie.expires = Some(v_trimmed),
                    "samesite" => cookie.same_site = Some(v_trimmed),
                    _ => {}
                }
            }
        }
    }

    Some(cookie)
}

/// 根据文件扩展名猜测 MIME 类型
fn mime_from_path(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        _ => "application/octet-stream",
    }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ═══════════════════════════════════════════
    //  Cookie 解析测试
    // ═══════════════════════════════════════════

    #[test]
    fn test_parse_simple_cookie() {
        let headers = vec![
            ("set-cookie".into(), "session=abc123".into()),
        ];
        let cookies = parse_cookies_from_headers(&headers);
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].name, "session");
        assert_eq!(cookies[0].value, "abc123");
    }

    #[test]
    fn test_parse_cookie_with_attributes() {
        let headers = vec![
            ("set-cookie".into(), "token=xyz; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=Strict".into()),
        ];
        let cookies = parse_cookies_from_headers(&headers);
        assert_eq!(cookies.len(), 1);
        let c = &cookies[0];
        assert_eq!(c.name, "token");
        assert_eq!(c.value, "xyz");
        assert_eq!(c.path, Some("/".into()));
        assert_eq!(c.domain, Some("example.com".into()));
        assert!(c.http_only);
        assert!(c.secure);
        assert_eq!(c.same_site, Some("Strict".into()));
    }

    #[test]
    fn test_parse_multiple_cookies() {
        let headers = vec![
            ("set-cookie".into(), "a=1; Path=/".into()),
            ("set-cookie".into(), "b=2; HttpOnly".into()),
            ("set-cookie".into(), "c=3".into()),
            ("content-type".into(), "text/html".into()), // 非 cookie header
        ];
        let cookies = parse_cookies_from_headers(&headers);
        assert_eq!(cookies.len(), 3);
        assert_eq!(cookies[0].name, "a");
        assert_eq!(cookies[1].name, "b");
        assert!(cookies[1].http_only);
        assert_eq!(cookies[2].name, "c");
    }

    #[test]
    fn test_parse_cookie_with_expires() {
        let headers = vec![
            ("set-cookie".into(), "lang=zh; Expires=Thu, 01 Jan 2030 00:00:00 GMT; Path=/".into()),
        ];
        let cookies = parse_cookies_from_headers(&headers);
        assert_eq!(cookies.len(), 1);
        assert!(cookies[0].expires.is_some());
        assert!(cookies[0].expires.as_ref().unwrap().contains("2030"));
    }

    #[test]
    fn test_parse_empty_headers() {
        let headers: Vec<(String, String)> = vec![];
        let cookies = parse_cookies_from_headers(&headers);
        assert!(cookies.is_empty());
    }

    #[test]
    fn test_parse_no_set_cookie() {
        let headers = vec![
            ("content-type".into(), "application/json".into()),
            ("x-request-id".into(), "12345".into()),
        ];
        let cookies = parse_cookies_from_headers(&headers);
        assert!(cookies.is_empty());
    }

    // ═══════════════════════════════════════════
    //  MIME 类型测试
    // ═══════════════════════════════════════════

    #[test]
    fn test_mime_json() {
        assert_eq!(mime_from_path("data.json"), "application/json");
    }

    #[test]
    fn test_mime_images() {
        assert_eq!(mime_from_path("photo.png"), "image/png");
        assert_eq!(mime_from_path("photo.jpg"), "image/jpeg");
        assert_eq!(mime_from_path("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_from_path("icon.svg"), "image/svg+xml");
        assert_eq!(mime_from_path("anim.gif"), "image/gif");
        assert_eq!(mime_from_path("pic.webp"), "image/webp");
    }

    #[test]
    fn test_mime_text() {
        assert_eq!(mime_from_path("readme.txt"), "text/plain");
        assert_eq!(mime_from_path("index.html"), "text/html");
        assert_eq!(mime_from_path("page.htm"), "text/html");
        assert_eq!(mime_from_path("data.csv"), "text/csv");
        assert_eq!(mime_from_path("config.xml"), "application/xml");
    }

    #[test]
    fn test_mime_archives() {
        assert_eq!(mime_from_path("archive.zip"), "application/zip");
        assert_eq!(mime_from_path("file.tar"), "application/x-tar");
        assert_eq!(mime_from_path("file.gz"), "application/gzip");
    }

    #[test]
    fn test_mime_media() {
        assert_eq!(mime_from_path("video.mp4"), "video/mp4");
        assert_eq!(mime_from_path("song.mp3"), "audio/mpeg");
        assert_eq!(mime_from_path("sound.wav"), "audio/wav");
    }

    #[test]
    fn test_mime_documents() {
        assert_eq!(mime_from_path("doc.pdf"), "application/pdf");
        assert_eq!(mime_from_path("file.doc"), "application/msword");
        assert_eq!(mime_from_path("file.docx"), "application/msword");
        assert_eq!(mime_from_path("sheet.xls"), "application/vnd.ms-excel");
    }

    #[test]
    fn test_mime_unknown() {
        assert_eq!(mime_from_path("file.xyz"), "application/octet-stream");
        assert_eq!(mime_from_path("noext"), "application/octet-stream");
    }

    #[test]
    fn test_mime_case_insensitive() {
        assert_eq!(mime_from_path("FILE.JSON"), "application/json");
        assert_eq!(mime_from_path("photo.PNG"), "image/png");
    }

    #[test]
    fn test_mime_nested_path() {
        assert_eq!(mime_from_path("/path/to/file.json"), "application/json");
        assert_eq!(mime_from_path("C:\\Users\\data.csv"), "text/csv");
    }
}

