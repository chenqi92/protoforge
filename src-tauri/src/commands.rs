// Tauri IPC Commands — 全部使用 SQLite 持久化
// 这是一个薄委托层，业务逻辑在各领域模块中

use crate::collections::{
    self, Collection, CollectionItem, EnvVariable, Environment, GlobalVariable, HistoryEntry,
};
use crate::db_client::{self, ConnectionConfig, DbConnectionManager, SaveConnectionRequest, SavedConnection, QueryHistoryEntry};
use crate::db_client::driver::*;
use crate::http_client::{
    self, HttpRequest, HttpRequestWithScripts, HttpResponse, HttpResponseWithScripts,
};
use crate::load_test::{LoadTestConfig, LoadTestState};
use crate::mqtt_client::{self, MqttConnectRequest, MqttConnections};
use crate::script_engine::{self, ScriptRequestContext, ScriptResponse, ScriptResult};
use crate::sse_client::{self, SseConnectRequest, SseConnections};
use crate::tcp_client::{TcpConnections, TcpServers, UdpSockets};
use crate::mock_server::{self, MockRoute, MockRequestLog, MockServerConfig, MockServerState, MockServerStatusInfo};
use crate::wasm_runtime::WasmPluginRuntime;
use crate::ws_client::WsConnections;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};

// ═══════════════════════════════════════════
//  HTTP
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    http_client::execute_request(request).await
}

#[tauri::command]
pub async fn send_request_with_scripts(
    request: HttpRequestWithScripts,
) -> Result<HttpResponseWithScripts, String> {
    http_client::execute_request_with_scripts(request).await
}

#[tauri::command]
pub fn run_pre_request_script(
    script: String,
    env_vars: Option<HashMap<String, String>>,
    folder_vars: Option<HashMap<String, String>>,
    collection_vars: Option<HashMap<String, String>>,
    global_vars: Option<HashMap<String, String>>,
    request: Option<ScriptRequestContext>,
) -> Result<ScriptResult, String> {
    Ok(script_engine::run_pre_request_script_with_scopes(
        &script,
        &env_vars.unwrap_or_default(),
        &folder_vars.unwrap_or_default(),
        &collection_vars.unwrap_or_default(),
        &global_vars.unwrap_or_default(),
        request.as_ref(),
    ))
}

#[tauri::command]
pub fn run_post_response_script(
    script: String,
    env_vars: Option<HashMap<String, String>>,
    folder_vars: Option<HashMap<String, String>>,
    collection_vars: Option<HashMap<String, String>>,
    global_vars: Option<HashMap<String, String>>,
    response: ScriptResponse,
) -> Result<ScriptResult, String> {
    Ok(script_engine::run_post_script_with_all_scopes(
        &script,
        &env_vars.unwrap_or_default(),
        &folder_vars.unwrap_or_default(),
        &collection_vars.unwrap_or_default(),
        &global_vars.unwrap_or_default(),
        &response,
    ))
}

/// 将二进制响应 body (base64) 另存为本地文件
#[tauri::command]
pub async fn save_response_body(
    app: tauri::AppHandle,
    body_base64: String,
    suggested_name: String,
) -> Result<String, String> {
    use base64::Engine as _;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&body_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;

    let sname = suggested_name.clone();
    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&sname)
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("对话框任务失败: {}", e))?;

    let path = match file_path {
        Some(p) => p.to_string(),
        None => return Err("用户取消保存".to_string()),
    };

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(path)
}

// ═══════════════════════════════════════════
//  OAuth 2.0 Token
// ═══════════════════════════════════════════

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuth2TokenRequest {
    pub grant_type: String, // "client_credentials" | "password" | "authorization_code" | "refresh_token"
    pub access_token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scope: Option<String>,
    // authorization_code specific
    pub code: Option<String>,
    pub redirect_uri: Option<String>,
    pub code_verifier: Option<String>, // PKCE
    // password specific
    pub username: Option<String>,
    pub password: Option<String>,
    // refresh_token specific
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuth2TokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

#[tauri::command]
pub async fn fetch_oauth2_token(req: OAuth2TokenRequest) -> Result<OAuth2TokenResponse, String> {
    if req.access_token_url.is_empty() {
        return Err("Access Token URL 不能为空".into());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut params = vec![
        ("grant_type".to_string(), req.grant_type.clone()),
        ("client_id".to_string(), req.client_id.clone()),
        ("client_secret".to_string(), req.client_secret.clone()),
    ];

    if let Some(scope) = &req.scope {
        if !scope.is_empty() {
            params.push(("scope".to_string(), scope.clone()));
        }
    }

    match req.grant_type.as_str() {
        "client_credentials" => {
            // client_id + client_secret + scope 已足够
        }
        "password" => {
            let username = req.username.as_deref().unwrap_or("");
            let password = req.password.as_deref().unwrap_or("");
            if username.is_empty() {
                return Err("Password 授权类型需要提供 username".into());
            }
            params.push(("username".to_string(), username.to_string()));
            params.push(("password".to_string(), password.to_string()));
        }
        "authorization_code" => {
            let code = req.code.as_deref().unwrap_or("");
            let redirect_uri = req.redirect_uri.as_deref().unwrap_or("");
            if code.is_empty() {
                return Err("Authorization Code 授权类型需要提供 code".into());
            }
            params.push(("code".to_string(), code.to_string()));
            if !redirect_uri.is_empty() {
                params.push(("redirect_uri".to_string(), redirect_uri.to_string()));
            }
            // PKCE: send code_verifier during token exchange
            if let Some(verifier) = &req.code_verifier {
                if !verifier.is_empty() {
                    params.push(("code_verifier".to_string(), verifier.clone()));
                }
            }
        }
        "refresh_token" => {
            let rt = req.refresh_token.as_deref().unwrap_or("");
            if rt.is_empty() {
                return Err("Refresh Token 授权类型需要提供 refresh_token".into());
            }
            params.push(("refresh_token".to_string(), rt.to_string()));
        }
        _ => {
            return Err(format!("不支持的授权类型: {}", req.grant_type));
        }
    }

    // 手动构建 application/x-www-form-urlencoded body
    let form_body: String = {
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        for (k, v) in &params {
            serializer.append_pair(k, v);
        }
        serializer.finish()
    };

    let resp = client
        .post(&req.access_token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(form_body)
        .send()
        .await
        .map_err(|e| format!("Token 请求失败: {}", e))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("Token 端点返回 {} — {}", status.as_u16(), body));
    }

    // 解析 JSON 响应
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析 Token 响应 JSON 失败: {} — 原始响应: {}", e, body))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| format!("响应中缺少 access_token 字段 — 原始响应: {}", body))?
        .to_string();

    Ok(OAuth2TokenResponse {
        access_token,
        token_type: json["token_type"].as_str().map(|s| s.to_string()),
        expires_in: json["expires_in"].as_u64(),
        refresh_token: json["refresh_token"].as_str().map(|s| s.to_string()),
        scope: json["scope"].as_str().map(|s| s.to_string()),
    })
}

// ═══════════════════════════════════════════
//  OAuth 2.0 Authorization Code 弹窗
// ═══════════════════════════════════════════

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthWindowRequest {
    pub auth_url: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scope: Option<String>,
    pub state: Option<String>,
    pub code_challenge: Option<String>,
    pub code_challenge_method: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthWindowResult {
    pub code: String,
    pub state: Option<String>,
}

/// 打开 OAuth 授权弹窗，通过 on_navigation 拦截 redirect_uri 提取 code
#[tauri::command]
pub async fn open_oauth_window(
    app: AppHandle,
    req: OAuthWindowRequest,
) -> Result<OAuthWindowResult, String> {
    use std::sync::Arc;
    use tauri::WebviewWindowBuilder;
    use tokio::sync::oneshot;

    // 构建标准 OAuth 授权 URL
    let mut url =
        reqwest::Url::parse(&req.auth_url).map_err(|e| format!("Auth URL 解析失败: {}", e))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &req.client_id)
        .append_pair("redirect_uri", &req.redirect_uri);
    if let Some(scope) = &req.scope {
        if !scope.is_empty() {
            url.query_pairs_mut().append_pair("scope", scope);
        }
    }
    if let Some(state) = &req.state {
        url.query_pairs_mut().append_pair("state", state);
    }
    // PKCE: append code_challenge and code_challenge_method
    if let Some(challenge) = &req.code_challenge {
        if !challenge.is_empty() {
            url.query_pairs_mut().append_pair("code_challenge", challenge);
            url.query_pairs_mut().append_pair(
                "code_challenge_method",
                req.code_challenge_method.as_deref().unwrap_or("S256"),
            );
        }
    }

    let label = format!(
        "oauth-{}",
        uuid::Uuid::new_v4()
            .to_string()
            .replace("-", "")
            .chars()
            .take(8)
            .collect::<String>()
    );
    let redirect_uri = req.redirect_uri.clone();

    // 用 channel 传递结果
    let (tx, rx) = oneshot::channel::<Result<OAuthWindowResult, String>>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));

    let tx_nav = tx.clone();
    let redirect_uri_clone = redirect_uri.clone();

    let window = WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url))
        .title("OAuth Authorization")
        .inner_size(800.0, 680.0)
        .center()
        .decorations(true)
        .resizable(true)
        .on_navigation(move |nav_url| {
            let nav_str = nav_url.as_str();
            if nav_str.starts_with(&redirect_uri_clone) {
                // 拦截到 redirect，提取 code
                let parsed = reqwest::Url::parse(nav_str).ok();
                let code = parsed.as_ref().and_then(|u| {
                    u.query_pairs()
                        .find(|(k, _)| k == "code")
                        .map(|(_, v)| v.to_string())
                });
                let state = parsed.as_ref().and_then(|u| {
                    u.query_pairs()
                        .find(|(k, _)| k == "state")
                        .map(|(_, v)| v.to_string())
                });
                let error = parsed.as_ref().and_then(|u| {
                    u.query_pairs()
                        .find(|(k, _)| k == "error")
                        .map(|(_, v)| v.to_string())
                });
                let error_desc = parsed.as_ref().and_then(|u| {
                    u.query_pairs()
                        .find(|(k, _)| k == "error_description")
                        .map(|(_, v)| v.to_string())
                });

                let result = if let Some(err) = error {
                    Err(format!(
                        "OAuth 错误: {}{}",
                        err,
                        error_desc.map(|d| format!(" — {}", d)).unwrap_or_default()
                    ))
                } else if let Some(code) = code {
                    Ok(OAuthWindowResult { code, state })
                } else {
                    Err("OAuth 响应中缺少 code 参数".to_string())
                };

                if let Ok(mut guard) = tx_nav.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(result);
                    }
                }

                // 阻止导航到 redirect_uri
                return false;
            }
            true
        })
        .build()
        .map_err(|e| format!("创建 OAuth 窗口失败: {}", e))?;

    // 监听窗口关闭，如果用户关闭窗口则发送取消信号
    let tx_close = tx.clone();
    let label_close = label.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Ok(mut guard) = tx_close.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("用户取消了 OAuth 授权".to_string()));
                }
            }
            log::debug!("OAuth 窗口 {} 已关闭", label_close);
        }
    });

    // 等待结果
    let result = rx.await.map_err(|_| "OAuth 授权通道关闭".to_string())?;

    // 关闭窗口
    let _ = window.close();

    result
}

// ═══════════════════════════════════════════
//  抓包内置浏览器
// ═══════════════════════════════════════════

/// 查找 Chrome 浏览器路径
#[cfg(target_os = "macos")]
fn find_chrome_path() -> Option<String> {
    let candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_chrome_path() -> Option<String> {
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // 也试试从 PATH 中找 chrome
    if let Ok(output) = std::process::Command::new("where").arg("chrome").output() {
        let out = String::from_utf8_lossy(&output.stdout);
        let first_line = out.lines().next().unwrap_or("").trim();
        if !first_line.is_empty() && std::path::Path::new(first_line).exists() {
            return Some(first_line.to_string());
        }
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn find_chrome_path() -> Option<String> {
    // Linux: try common names
    for name in &[
        "google-chrome",
        "chromium-browser",
        "chromium",
        "microsoft-edge",
    ] {
        if let Ok(output) = std::process::Command::new("which").arg(name).output() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

/// 获取代理浏览器临时 profile 目录
fn proxy_browser_profile_dir() -> String {
    let dir = std::env::temp_dir().join("protoforge-proxy-browser");
    dir.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn open_proxy_browser(
    _app: tauri::AppHandle,
    url: String,
    proxy_port: u16,
) -> Result<String, String> {
    // 确保 URL 有协议前缀
    let target_url = if url.is_empty() {
        "https://www.example.com".to_string()
    } else if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("https://{}", url)
    } else {
        url
    };

    log::info!(
        "打开代理浏览器: url={}, proxy_port={}",
        target_url,
        proxy_port
    );

    let proxy_arg = format!("--proxy-server=127.0.0.1:{}", proxy_port);
    let profile_dir = proxy_browser_profile_dir();

    if let Some(chrome_path) = find_chrome_path() {
        log::info!("使用 Chromium 内核浏览器: {}", chrome_path);

        // 使用 --proxy-server 直接在浏览器层面强制代理
        // 使用 --user-data-dir 隔离 profile，避免影响正常浏览器
        // 使用 --ignore-certificate-errors 信任 MITM CA 证书
        let result = std::process::Command::new(&chrome_path)
            .arg(&proxy_arg)
            .arg(format!("--user-data-dir={}", profile_dir))
            .arg("--ignore-certificate-errors")
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg(&target_url)
            .spawn();

        match result {
            Ok(_child) => {
                log::info!("Chrome 代理浏览器已启动");
                Ok("chrome-proxy".to_string())
            }
            Err(e) => {
                log::error!("启动 Chrome 失败: {}, 尝试 fallback", e);
                fallback_open_browser(&target_url, proxy_port)
            }
        }
    } else {
        log::warn!("未找到 Chromium 内核浏览器，使用 fallback 方式");
        fallback_open_browser(&target_url, proxy_port)
    }
}

/// Fallback: 使用系统默认浏览器 + 系统代理设置（Safari 等会走系统代理）
fn fallback_open_browser(target_url: &str, _proxy_port: u16) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(target_url).output();
        Ok("fallback".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", target_url])
            .output();
        Ok("fallback".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(target_url)
            .output();
        Ok("fallback".to_string())
    }
}

/// 清理代理浏览器（在抓包停止时调用）
#[tauri::command]
pub async fn close_proxy_browser(service_name: String) -> Result<(), String> {
    log::info!("清理代理浏览器: mode={}", service_name);

    // 对于 chrome-proxy 模式，无需额外清理（关闭浏览器窗口即可）
    // 对于 fallback 模式（旧的系统代理方式），也无需恢复系统代理
    // 因为新实现不再修改系统代理设置
    let _ = service_name;
    Ok(())
}

// ═══════════════════════════════════════════
//  Collections
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_collections(pool: State<'_, SqlitePool>) -> Result<Vec<Collection>, String> {
    collections::list_collections(&pool).await
}

#[tauri::command]
pub async fn create_collection(
    pool: State<'_, SqlitePool>,
    collection: Collection,
) -> Result<Collection, String> {
    collections::create_collection(&pool, collection).await
}

#[tauri::command]
pub async fn update_collection(
    pool: State<'_, SqlitePool>,
    collection: Collection,
) -> Result<(), String> {
    collections::update_collection(&pool, collection).await
}

#[tauri::command]
pub async fn delete_collection(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    collections::delete_collection(&pool, &id).await
}

#[tauri::command]
pub async fn export_collection(pool: State<'_, SqlitePool>, id: String) -> Result<String, String> {
    collections::export_collection(&pool, &id).await
}

#[tauri::command]
pub async fn import_collection(
    pool: State<'_, SqlitePool>,
    json: String,
) -> Result<Collection, String> {
    collections::import_collection(&pool, &json).await
}

// ═══════════════════════════════════════════
//  Collection Items
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_collection_items(
    pool: State<'_, SqlitePool>,
    collection_id: String,
) -> Result<Vec<CollectionItem>, String> {
    collections::list_collection_items(&pool, &collection_id).await
}

#[tauri::command]
pub async fn create_collection_item(
    pool: State<'_, SqlitePool>,
    item: CollectionItem,
) -> Result<CollectionItem, String> {
    collections::create_collection_item(&pool, item).await
}

#[tauri::command]
pub async fn update_collection_item(
    pool: State<'_, SqlitePool>,
    item: CollectionItem,
) -> Result<(), String> {
    collections::update_collection_item(&pool, item).await
}

#[tauri::command]
pub async fn delete_collection_item(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    collections::delete_collection_item(&pool, &id).await
}

#[tauri::command]
pub async fn reorder_collection_items(
    pool: State<'_, SqlitePool>,
    item_ids: Vec<String>,
) -> Result<(), String> {
    collections::reorder_collection_items(&pool, item_ids).await
}

#[tauri::command]
pub async fn deduplicate_collection_items(
    pool: State<'_, SqlitePool>,
    collection_id: String,
) -> Result<u64, String> {
    collections::deduplicate_collection_items(&pool, &collection_id).await
}

// ═══════════════════════════════════════════
//  Environments
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_environments(pool: State<'_, SqlitePool>) -> Result<Vec<Environment>, String> {
    collections::list_environments(&pool).await
}

#[tauri::command]
pub async fn create_environment(
    pool: State<'_, SqlitePool>,
    environment: Environment,
) -> Result<Environment, String> {
    collections::create_environment(&pool, environment).await
}

#[tauri::command]
pub async fn set_active_environment(
    pool: State<'_, SqlitePool>,
    id: Option<String>,
) -> Result<(), String> {
    collections::set_active_environment(&pool, id.as_deref()).await
}

#[tauri::command]
pub async fn get_active_environment(
    pool: State<'_, SqlitePool>,
) -> Result<Option<Environment>, String> {
    collections::get_active_environment(&pool).await
}

#[tauri::command]
pub async fn delete_environment(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    collections::delete_environment(&pool, &id).await
}

// ═══════════════════════════════════════════
//  Environment Variables
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_env_variables(
    pool: State<'_, SqlitePool>,
    environment_id: String,
) -> Result<Vec<EnvVariable>, String> {
    collections::list_env_variables(&pool, &environment_id).await
}

#[tauri::command]
pub async fn save_env_variables(
    pool: State<'_, SqlitePool>,
    environment_id: String,
    variables: Vec<EnvVariable>,
) -> Result<(), String> {
    collections::save_env_variables(&pool, &environment_id, variables).await
}

// ═══════════════════════════════════════════
//  Global Variables
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_global_variables(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<GlobalVariable>, String> {
    collections::list_global_variables(&pool).await
}

#[tauri::command]
pub async fn save_global_variables(
    pool: State<'_, SqlitePool>,
    variables: Vec<GlobalVariable>,
) -> Result<(), String> {
    collections::save_global_variables(&pool, variables).await
}

// ═══════════════════════════════════════════
//  History
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn add_history(pool: State<'_, SqlitePool>, entry: HistoryEntry, max_count: Option<i64>) -> Result<(), String> {
    collections::add_history(&pool, entry, max_count.unwrap_or(200)).await
}

#[tauri::command]
pub async fn list_history(
    pool: State<'_, SqlitePool>,
    limit: i64,
) -> Result<Vec<HistoryEntry>, String> {
    collections::list_history(&pool, limit).await
}

#[tauri::command]
pub async fn list_history_summary(
    pool: State<'_, SqlitePool>,
    limit: i64,
) -> Result<Vec<collections::HistoryEntrySummary>, String> {
    collections::list_history_summary(&pool, limit).await
}

#[tauri::command]
pub async fn get_history_entry(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<HistoryEntry, String> {
    collections::get_history_entry(&pool, &id).await
}

#[tauri::command]
pub async fn delete_history_entry(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    collections::delete_history_entry(&pool, &id).await
}

#[tauri::command]
pub async fn clear_history(pool: State<'_, SqlitePool>) -> Result<(), String> {
    collections::clear_history(&pool).await
}

// ═══════════════════════════════════════════
//  Postman 导入 / 导出
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn import_postman_collection(
    pool: State<'_, SqlitePool>,
    json: String,
) -> Result<collections::Collection, String> {
    crate::postman_compat::import_postman(&pool, &json).await
}

#[tauri::command]
pub async fn export_postman_collection(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<String, String> {
    crate::postman_compat::export_postman(&pool, &id).await
}

// ═══════════════════════════════════════════
//  Swagger / OpenAPI 导入
// ═══════════════════════════════════════════

use crate::swagger_import::{self, SwaggerDiscoveryResult, SwaggerEndpoint, SwaggerParseResult};

#[tauri::command]
pub async fn fetch_swagger(url: String) -> Result<SwaggerDiscoveryResult, String> {
    swagger_import::discover_and_parse(&url).await
}

#[tauri::command]
pub async fn fetch_swagger_group(url: String) -> Result<SwaggerParseResult, String> {
    swagger_import::fetch_group(&url).await
}

#[tauri::command]
pub async fn import_swagger_endpoints(
    pool: State<'_, SqlitePool>,
    collection_name: String,
    base_url: String,
    endpoints: Vec<SwaggerEndpoint>,
) -> Result<collections::Collection, String> {
    swagger_import::import_selected(&pool, &collection_name, &base_url, &endpoints).await
}

// ═══════════════════════════════════════════
//  保存请求到集合
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn save_request_to_collection(
    pool: State<'_, SqlitePool>,
    item: CollectionItem,
) -> Result<CollectionItem, String> {
    // 试更新，不存在则创建
    let existing =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM collection_items WHERE id = ?")
            .bind(&item.id)
            .fetch_one(pool.inner())
            .await
            .map_err(|e| e.to_string())?;

    if existing > 0 {
        collections::update_collection_item(&pool, item.clone()).await?;
    } else {
        collections::create_collection_item(&pool, item.clone()).await?;
    }
    Ok(item)
}
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn ws_connect(
    app: tauri::AppHandle,
    connections: State<'_, WsConnections>,
    connection_id: String,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    crate::ws_client::connect(app, &connections, connection_id, url, headers).await
}

#[tauri::command]
pub async fn ws_send(
    connections: State<'_, WsConnections>,
    connection_id: String,
    message: String,
) -> Result<(), String> {
    crate::ws_client::send(&connections, &connection_id, message).await
}

#[tauri::command]
pub async fn ws_disconnect(
    connections: State<'_, WsConnections>,
    connection_id: String,
) -> Result<(), String> {
    crate::ws_client::disconnect(&connections, &connection_id).await
}

#[tauri::command]
pub async fn ws_is_connected(
    connections: State<'_, WsConnections>,
    connection_id: String,
) -> Result<bool, String> {
    crate::ws_client::is_connected(&connections, &connection_id).await
}

#[tauri::command]
pub async fn ws_send_binary(
    connections: State<'_, WsConnections>,
    connection_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    crate::ws_client::send_binary(&connections, &connection_id, data).await
}

// ═══════════════════════════════════════════
//  TCP Client
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn tcp_connect(
    app: tauri::AppHandle,
    connections: State<'_, TcpConnections>,
    connection_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    crate::tcp_client::tcp_connect(app, &connections, connection_id, host, port).await
}

#[tauri::command]
pub async fn tcp_send(
    connections: State<'_, TcpConnections>,
    connection_id: String,
    data: String,
    encoding: String,
) -> Result<(), String> {
    crate::tcp_client::tcp_send(&connections, &connection_id, data, encoding).await
}

#[tauri::command]
pub async fn tcp_disconnect(
    connections: State<'_, TcpConnections>,
    connection_id: String,
) -> Result<(), String> {
    crate::tcp_client::tcp_disconnect(&connections, &connection_id).await
}

// ═══════════════════════════════════════════
//  TCP Server
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn tcp_server_start(
    app: tauri::AppHandle,
    servers: State<'_, TcpServers>,
    server_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    crate::tcp_client::tcp_server_start(app, &servers, server_id, host, port).await
}

#[tauri::command]
pub async fn tcp_server_send(
    servers: State<'_, TcpServers>,
    server_id: String,
    client_id: String,
    data: String,
    encoding: String,
) -> Result<(), String> {
    crate::tcp_client::tcp_server_send(&servers, &server_id, &client_id, data, encoding).await
}

#[tauri::command]
pub async fn tcp_server_broadcast(
    servers: State<'_, TcpServers>,
    server_id: String,
    data: String,
    encoding: String,
) -> Result<usize, String> {
    crate::tcp_client::tcp_server_broadcast(&servers, &server_id, data, encoding).await
}

#[tauri::command]
pub async fn tcp_server_stop(
    servers: State<'_, TcpServers>,
    server_id: String,
) -> Result<(), String> {
    crate::tcp_client::tcp_server_stop(&servers, &server_id).await
}

// ═══════════════════════════════════════════
//  UDP
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn udp_bind(
    app: tauri::AppHandle,
    sockets: State<'_, UdpSockets>,
    socket_id: String,
    local_addr: String,
) -> Result<(), String> {
    crate::tcp_client::udp_bind(app, &sockets, socket_id, local_addr).await
}

#[tauri::command]
pub async fn udp_send_to(
    sockets: State<'_, UdpSockets>,
    socket_id: String,
    data: String,
    target_addr: String,
    encoding: String,
) -> Result<(), String> {
    crate::tcp_client::udp_send_to(&sockets, &socket_id, data, target_addr, encoding).await
}

#[tauri::command]
pub async fn udp_close(sockets: State<'_, UdpSockets>, socket_id: String) -> Result<(), String> {
    crate::tcp_client::udp_close(&sockets, &socket_id).await
}

// ═══════════════════════════════════════════
//  TCP/UDP 活跃连接查询
// ═══════════════════════════════════════════

use crate::tcp_client::{ActiveTcpConnection, ActiveTcpServer, ActiveUdpSocket};

#[tauri::command]
pub async fn tcp_list_connections(
    connections: State<'_, TcpConnections>,
) -> Result<Vec<ActiveTcpConnection>, String> {
    Ok(crate::tcp_client::list_active_connections(&connections).await)
}

#[tauri::command]
pub async fn tcp_list_servers(
    servers: State<'_, TcpServers>,
) -> Result<Vec<ActiveTcpServer>, String> {
    Ok(crate::tcp_client::list_active_servers(&servers).await)
}

#[tauri::command]
pub async fn udp_list_sockets(
    sockets: State<'_, UdpSockets>,
) -> Result<Vec<ActiveUdpSocket>, String> {
    Ok(crate::tcp_client::list_active_sockets(&sockets).await)
}

// ═══════════════════════════════════════════
//  Load Test
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn start_load_test(
    app: tauri::AppHandle,
    state: State<'_, LoadTestState>,
    test_id: String,
    config: LoadTestConfig,
) -> Result<(), String> {
    crate::load_test::start_load_test(app, &state, test_id, config).await
}

#[tauri::command]
pub async fn stop_load_test(
    state: State<'_, LoadTestState>,
    test_id: String,
) -> Result<(), String> {
    crate::load_test::stop_load_test(&state, &test_id).await
}

#[tauri::command]
pub async fn export_load_test_report(
    app: tauri::AppHandle,
    report_json: String,
    format: String, // "json" or "csv"
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let extension = if format == "csv" { "csv" } else { "json" };
    let file_name = format!("loadtest_report.{}", extension);

    // 将阻塞式文件对话框移入 spawn_blocking，避免阻塞 tokio 异步运行时线程
    let app_clone = app.clone();
    let ext = extension.to_string();
    let fname = file_name.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_file_name(&fname)
            .add_filter(ext.to_uppercase(), &[&ext])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("对话框任务失败: {}", e))?;

    let path = match file_path {
        Some(p) => p.to_string(),
        None => return Err("用户取消导出".to_string()),
    };

    let content = if format == "csv" {
        // Parse JSON and convert to CSV
        let data: serde_json::Value =
            serde_json::from_str(&report_json).map_err(|e| format!("解析报告 JSON 失败: {}", e))?;
        let mut csv = String::from(
            "testId,totalRequests,totalErrors,totalDurationSecs,avgRps,avgLatencyMs,minLatencyMs,maxLatencyMs,p50Ms,p95Ms,p99Ms\n",
        );
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{}\n",
            data["testId"].as_str().unwrap_or(""),
            data["totalRequests"].as_u64().unwrap_or(0),
            data["totalErrors"].as_u64().unwrap_or(0),
            data["totalDurationSecs"].as_f64().unwrap_or(0.0),
            data["avgRps"].as_f64().unwrap_or(0.0),
            data["avgLatencyMs"].as_f64().unwrap_or(0.0),
            data["minLatencyMs"].as_u64().unwrap_or(0),
            data["maxLatencyMs"].as_u64().unwrap_or(0),
            data["p50Ms"].as_u64().unwrap_or(0),
            data["p95Ms"].as_u64().unwrap_or(0),
            data["p99Ms"].as_u64().unwrap_or(0),
        ));
        csv
    } else {
        // Pretty print JSON
        let data: serde_json::Value =
            serde_json::from_str(&report_json).map_err(|e| format!("解析报告 JSON 失败: {}", e))?;
        serde_json::to_string_pretty(&data).map_err(|e| format!("格式化失败: {}", e))?
    };

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(path)
}

// ═══════════════════════════════════════════
//  Proxy Capture (抓包)
// ═══════════════════════════════════════════

use crate::proxy_capture::{self, CapturedEntry, ProxyState, ProxyStatusInfo};

#[tauri::command]
pub async fn proxy_start(
    app: tauri::AppHandle,
    state: State<'_, ProxyState>,
    session_id: String,
    port: u16,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    proxy_capture::start_proxy(app, &state, &session_id, port, app_data_dir).await
}

#[tauri::command]
pub async fn proxy_stop(state: State<'_, ProxyState>, session_id: String) -> Result<(), String> {
    proxy_capture::stop_proxy(&state, &session_id).await
}

#[tauri::command]
pub async fn proxy_status(
    state: State<'_, ProxyState>,
    session_id: String,
) -> Result<ProxyStatusInfo, String> {
    Ok(proxy_capture::get_status(&state, &session_id).await)
}

#[tauri::command]
pub async fn proxy_get_entries(
    state: State<'_, ProxyState>,
    session_id: String,
) -> Result<Vec<CapturedEntry>, String> {
    Ok(proxy_capture::get_entries(&state, &session_id).await)
}

#[tauri::command]
pub async fn proxy_clear(state: State<'_, ProxyState>, session_id: String) -> Result<(), String> {
    proxy_capture::clear_entries(&state, &session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn proxy_export_ca(state: State<'_, ProxyState>) -> Result<String, String> {
    proxy_capture::export_ca_cert(&state).await
}

/// 通过代理发送测试请求，验证代理功能
#[tauri::command]
pub async fn proxy_test_connection(port: u16) -> Result<String, String> {
    proxy_capture::test_proxy_connection(port).await
}

/// 一键安装 CA 证书到系统信任库
/// macOS: security import + open（触发原生证书信任对话框）
/// Windows: certutil -addstore Root
#[tauri::command]
pub async fn proxy_install_ca(state: State<'_, ProxyState>) -> Result<String, String> {
    let cert_path = {
        let path = state.ca_cert_path.lock().await;
        match &*path {
            Some(p) => p.clone(),
            None => return Err("CA 证书尚未生成，请先启动代理".to_string()),
        }
    };

    let cert_path_str = cert_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        // macOS 策略:
        // 直接使用 security add-trusted-cert (用户域，不加 -d)
        // macOS 安全框架会弹出原生密码/授权对话框
        let output = std::process::Command::new("security")
            .args(["add-trusted-cert", "-r", "trustRoot", &cert_path_str])
            .output()
            .map_err(|e| format!("执行 security 命令失败: {}", e))?;

        if output.status.success() {
            Ok("CA 证书已安装并设为信任".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("security add-trusted-cert 失败: {}", stderr);

            // 回退方案：打开钥匙串访问，让用户手动信任
            let _ = std::process::Command::new("security")
                .args(["import", &cert_path_str, "-t", "cert"])
                .output();

            let _ = std::process::Command::new("open")
                .args(["-a", "Keychain Access"])
                .output();

            Ok("已打开钥匙串访问。请搜索「ProtoForge CA」，双击证书 → 展开「信任」→ 选择「始终信任」".to_string())
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 certutil 命令安装到受信任根证书存储（会弹出 UAC）
        let output = std::process::Command::new("certutil")
            .args(["-addstore", "Root", &cert_path_str])
            .output()
            .map_err(|e| format!("执行 certutil 命令失败: {}", e))?;

        if output.status.success() {
            Ok("CA 证书已安装到 Windows 受信任根证书存储".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("安装 CA 证书失败: {} {}", stderr, stdout))
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("当前平台不支持自动安装 CA 证书，请手动导入".to_string())
    }
}

/// 检查 CA 证书是否已安装到系统信任库
#[tauri::command]
pub async fn proxy_check_ca_trusted(state: State<'_, ProxyState>) -> Result<bool, String> {
    let _cert_path = {
        let path = state.ca_cert_path.lock().await;
        match &*path {
            Some(p) => p.clone(),
            None => return Ok(false),
        }
    };

    #[cfg(target_os = "macos")]
    {
        // 检查系统钥匙串中是否包含 ProtoForge CA
        let output = std::process::Command::new("security")
            .args([
                "find-certificate",
                "-c",
                "ProtoForge CA",
                "/Library/Keychains/System.keychain",
            ])
            .output()
            .map_err(|e| format!("执行 security 命令失败: {}", e))?;

        Ok(output.status.success())
    }

    #[cfg(target_os = "windows")]
    {
        // 检查受信任根证书存储中是否包含证书
        let output = std::process::Command::new("certutil")
            .args(["-verify", &_cert_path.to_string_lossy()])
            .output()
            .map_err(|e| format!("执行 certutil 命令失败: {}", e))?;

        Ok(output.status.success())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = _cert_path;
        Ok(false)
    }
}

// ═══════════════════════════════════════════
//  Plugins
// ═══════════════════════════════════════════

use crate::plugin_runtime::{
    CryptoResult, ExportResult, GenerateDataResult, HookResult, InstalledCryptoAlgorithm,
    ParseResult, PluginManager, PluginManifest, ProtocolParser, RenderResult,
};

#[tauri::command]
pub async fn plugin_list(mgr: State<'_, PluginManager>) -> Result<Vec<PluginManifest>, String> {
    Ok(mgr.list_installed().await)
}

#[tauri::command]
pub async fn plugin_list_available(
    mgr: State<'_, PluginManager>,
) -> Result<Vec<PluginManifest>, String> {
    Ok(mgr.list_available().await)
}

#[tauri::command]
pub async fn plugin_install(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<PluginManifest, String> {
    mgr.install(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_uninstall(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<(), String> {
    mgr.uninstall(&plugin_id).await
}

#[tauri::command]
pub async fn plugin_parse_data(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    raw_data: String,
) -> Result<ParseResult, String> {
    mgr.parse_data(&plugin_id, &raw_data).await
}

#[tauri::command]
pub async fn plugin_render_data(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    base64_data: String,
) -> Result<RenderResult, String> {
    mgr.render_data(&plugin_id, &base64_data).await
}

#[tauri::command]
pub async fn plugin_get_protocol_parsers(
    mgr: State<'_, PluginManager>,
) -> Result<Vec<ProtocolParser>, String> {
    Ok(mgr.get_protocol_parsers().await)
}

#[tauri::command]
pub async fn plugin_refresh_registry(mgr: State<'_, PluginManager>) -> Result<usize, String> {
    mgr.refresh_registry().await
}

#[tauri::command]
pub async fn plugin_get_icon(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
) -> Result<Option<String>, String> {
    Ok(mgr.get_plugin_icon(&plugin_id).await)
}

#[tauri::command]
pub async fn plugin_run_hook(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    request_json: String,
) -> Result<HookResult, String> {
    mgr.run_hook(&plugin_id, &request_json).await
}

#[tauri::command]
pub async fn plugin_run_generator(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    generator_id: String,
    options_json: String,
) -> Result<GenerateDataResult, String> {
    mgr.run_generator(&plugin_id, &generator_id, &options_json)
        .await
}

#[tauri::command]
pub async fn plugin_run_export(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    request_json: String,
) -> Result<ExportResult, String> {
    mgr.run_export(&plugin_id, &request_json).await
}

#[tauri::command]
pub async fn plugin_run_crypto(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    algorithm_id: String,
    mode: String,
    input: String,
    params_json: String,
) -> Result<CryptoResult, String> {
    mgr.run_crypto(&plugin_id, &algorithm_id, &mode, &input, &params_json)
        .await
}

#[tauri::command]
pub async fn plugin_run_context_menu_action(
    mgr: State<'_, PluginManager>,
    plugin_id: String,
    action: String,
    selected_text: String,
    context_json: String,
) -> Result<crate::plugin_runtime::ContextMenuActionResult, String> {
    mgr.run_context_menu_action(&plugin_id, &action, &selected_text, &context_json)
        .await
}

#[tauri::command]
pub async fn plugin_list_crypto_algorithms(
    mgr: State<'_, PluginManager>,
) -> Result<Vec<InstalledCryptoAlgorithm>, String> {
    Ok(mgr.list_crypto_algorithms().await)
}

// ═════════════════════════════════════════════
//  Collection Runner
// ═══════════════════════════════════════════

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCollectionConfig {
    pub collection_id: String,
    pub item_ids: Vec<String>, // 选中的请求 ID（空 = 全部）
    pub delay_ms: u64,         // 请求间延迟
    pub iterations: u32,       // 迭代次数
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunItemResult {
    pub item_id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCollectionResult {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub total_ms: u64,
    pub results: Vec<RunItemResult>,
}

#[tauri::command]
pub async fn run_collection(
    pool: State<'_, SqlitePool>,
    app_handle: AppHandle,
    config: RunCollectionConfig,
) -> Result<RunCollectionResult, String> {
    use crate::http_client::{self, HttpRequest};
    use tauri::Emitter;

    let all_items = collections::list_collection_items(&pool, &config.collection_id).await?;

    // 过滤出请求类型
    let requests: Vec<_> = all_items
        .into_iter()
        .filter(|item| item.item_type == "request")
        .filter(|item| config.item_ids.is_empty() || config.item_ids.contains(&item.id))
        .collect();

    let iterations = config.iterations.max(1);
    let mut all_results: Vec<RunItemResult> = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let start = std::time::Instant::now();

    'outer: for iter in 0..iterations {
        for (idx, item) in requests.iter().enumerate() {
            let method = item.method.clone().unwrap_or_else(|| "GET".to_string());
            let url = item.url.clone().unwrap_or_default();

            if url.is_empty() {
                let r = RunItemResult {
                    item_id: item.id.clone(),
                    name: item.name.clone(),
                    method: method.clone(),
                    url: url.clone(),
                    status: None,
                    duration_ms: 0,
                    success: false,
                    error: Some("URL 为空".to_string()),
                };
                failed += 1;
                all_results.push(r.clone());
                let _ = app_handle.emit(
                    "collection-runner-progress",
                    &serde_json::json!({
                        "iteration": iter,
                        "index": idx,
                        "total": requests.len(),
                        "result": r,
                    }),
                );
                continue;
            }

            // 解析 headers（兼容数组格式和 Object 格式）
            let header_map: std::collections::HashMap<String, String> = {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&item.headers) {
                    if let Some(arr) = val.as_array() {
                        arr.iter()
                            .filter(|h| h.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true))
                            .filter_map(|h| {
                                let k = h.get("key")?.as_str()?.to_string();
                                let v = h
                                    .get("value")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                Some((k, v))
                            })
                            .collect()
                    } else if let Some(obj) = val.as_object() {
                        obj.iter()
                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                            .collect()
                    } else {
                        std::collections::HashMap::new()
                    }
                } else {
                    std::collections::HashMap::new()
                }
            };

            // 构造 body：从 body_type + body_content 反序列化
            let body = if item.body_content.is_empty() || item.body_type == "none" {
                None
            } else {
                match item.body_type.as_str() {
                    "json" => Some(http_client::RequestBody::Json {
                        data: item.body_content.clone(),
                    }),
                    "raw" => Some(http_client::RequestBody::Raw {
                        content: item.body_content.clone(),
                        content_type: "text/plain".to_string(),
                    }),
                    "binary" => Some(http_client::RequestBody::Binary {
                        file_path: item.body_content.clone(),
                    }),
                    "formUrlencoded" => {
                        // 从数组格式解析 [{key, value, enabled}] -> FormUrlEncoded {fields: HashMap}
                        let mut fields = std::collections::HashMap::new();
                        if let Ok(val) =
                            serde_json::from_str::<serde_json::Value>(&item.body_content)
                        {
                            if let Some(arr) = val.as_array() {
                                for f in arr {
                                    if f.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                                        if let Some(k) = f.get("key").and_then(|v| v.as_str()) {
                                            let v = f
                                                .get("value")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            fields.insert(k.to_string(), v);
                                        }
                                    }
                                }
                            } else if let Some(obj) = val.as_object() {
                                for (k, v) in obj {
                                    fields.insert(k.clone(), v.as_str().unwrap_or("").to_string());
                                }
                            }
                        }
                        Some(http_client::RequestBody::FormUrlencoded { fields })
                    }
                    "graphql" => {
                        // graphql: {query, variables}
                        if let Ok(gql) =
                            serde_json::from_str::<serde_json::Value>(&item.body_content)
                        {
                            let query = gql
                                .get("query")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let variables = gql
                                .get("variables")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let raw = if variables.is_empty() {
                                serde_json::json!({"query": query}).to_string()
                            } else {
                                serde_json::json!({"query": query, "variables": variables})
                                    .to_string()
                            };
                            Some(http_client::RequestBody::Json { data: raw })
                        } else {
                            Some(http_client::RequestBody::Json {
                                data: item.body_content.clone(),
                            })
                        }
                    }
                    _ => serde_json::from_str(&item.body_content).ok(),
                }
            };

            // 构造 auth（兼容 ProtoForge 平面格式和 Postman 嵌套数组格式）
            let auth: Option<http_client::AuthConfig> = if item.auth_type == "none"
                || item.auth_config.is_empty()
            {
                None
            } else {
                serde_json::from_str::<http_client::AuthConfig>(&item.auth_config)
                    .ok()
                    .or_else(|| {
                        // Postman 嵌套数组格式 fallback
                        let v: serde_json::Value = serde_json::from_str(&item.auth_config).ok()?;
                        let find_kv = |arr: Option<&serde_json::Value>, key: &str| -> String {
                            arr.and_then(|a| a.as_array())
                                .and_then(|a| {
                                    a.iter().find(|kv| {
                                        kv.get("key").and_then(|k| k.as_str()) == Some(key)
                                    })
                                })
                                .and_then(|kv| kv.get("value").and_then(|v| v.as_str()))
                                .unwrap_or("")
                                .to_string()
                        };
                        match item.auth_type.as_str() {
                            "bearer" => Some(http_client::AuthConfig::Bearer {
                                token: find_kv(v.get("bearer"), "token"),
                            }),
                            "basic" => Some(http_client::AuthConfig::Basic {
                                username: find_kv(v.get("basic"), "username"),
                                password: find_kv(v.get("basic"), "password"),
                            }),
                            "apiKey" => Some(http_client::AuthConfig::ApiKey {
                                key: find_kv(v.get("apikey"), "key"),
                                value: find_kv(v.get("apikey"), "value"),
                                add_to: find_kv(v.get("apikey"), "in"),
                            }),
                            _ => None,
                        }
                    })
            };

            let req = HttpRequest {
                method: method.clone(),
                url: url.clone(),
                headers: header_map,
                query_params: {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&item.query_params) {
                        if let Some(arr) = val.as_array() {
                            arr.iter()
                                .filter(|q| {
                                    q.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true)
                                })
                                .filter_map(|q| {
                                    let k = q.get("key")?.as_str()?.to_string();
                                    let v = q
                                        .get("value")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    Some((k, v))
                                })
                                .collect()
                        } else {
                            serde_json::from_value(val).unwrap_or_default()
                        }
                    } else {
                        std::collections::HashMap::new()
                    }
                },
                body,
                auth,
                timeout_ms: Some(30_000), // 每个请求强制 30s 超时
                follow_redirects: None,
                max_redirects: None,
                ssl_verify: None,
                proxy: None,
            };

            // 全局超时保护：总时长超过 10 分钟自动中止
            if start.elapsed().as_secs() > 600 {
                all_results.push(RunItemResult {
                    item_id: item.id.clone(),
                    name: item.name.clone(),
                    method: method.clone(),
                    url: url.clone(),
                    status: None,
                    duration_ms: 0,
                    success: false,
                    error: Some("Collection Runner 全局超时（10 分钟）".to_string()),
                });
                failed += 1;
                break 'outer; // 退出外层循环
            }

            let result = match http_client::execute_request(req).await {
                Ok(resp) => {
                    let success = resp.status < 400;
                    if success {
                        passed += 1;
                    } else {
                        failed += 1;
                    }
                    RunItemResult {
                        item_id: item.id.clone(),
                        name: item.name.clone(),
                        method: method.clone(),
                        url: url.clone(),
                        status: Some(resp.status),
                        duration_ms: resp.timing.total_ms,
                        success,
                        error: None,
                    }
                }
                Err(e) => {
                    failed += 1;
                    RunItemResult {
                        item_id: item.id.clone(),
                        name: item.name.clone(),
                        method: method.clone(),
                        url: url.clone(),
                        status: None,
                        duration_ms: 0,
                        success: false,
                        error: Some(e),
                    }
                }
            };

            all_results.push(result.clone());
            let _ = app_handle.emit(
                "collection-runner-progress",
                &serde_json::json!({
                    "iteration": iter,
                    "index": idx,
                    "total": requests.len(),
                    "result": result,
                }),
            );

            // 延迟
            if config.delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(config.delay_ms)).await;
            }
        }
    }

    let total_ms = start.elapsed().as_millis() as u64;

    Ok(RunCollectionResult {
        total: all_results.len(),
        passed,
        failed,
        total_ms,
        results: all_results,
    })
}

// ═══════════════════════════════════════════
//  SSE
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn sse_connect(
    connections: State<'_, SseConnections>,
    app_handle: AppHandle,
    conn_id: String,
    request: SseConnectRequest,
) -> Result<(), String> {
    sse_client::connect(conn_id, request, connections.inner().clone(), app_handle).await
}

#[tauri::command]
pub async fn sse_disconnect(
    connections: State<'_, SseConnections>,
    conn_id: String,
) -> Result<(), String> {
    sse_client::disconnect(&conn_id, connections.inner().clone()).await
}

// ═══════════════════════════════════════════
//  MQTT
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn mqtt_connect(
    connections: State<'_, MqttConnections>,
    app_handle: AppHandle,
    conn_id: String,
    request: MqttConnectRequest,
) -> Result<(), String> {
    mqtt_client::connect(conn_id, request, connections.inner().clone(), app_handle).await
}

#[tauri::command]
pub async fn mqtt_disconnect(
    connections: State<'_, MqttConnections>,
    conn_id: String,
) -> Result<(), String> {
    mqtt_client::disconnect(&conn_id, connections.inner().clone()).await
}

#[tauri::command]
pub async fn mqtt_subscribe(
    connections: State<'_, MqttConnections>,
    conn_id: String,
    topic: String,
    qos: u8,
) -> Result<(), String> {
    mqtt_client::subscribe(&conn_id, &topic, qos, connections.inner().clone()).await
}

#[tauri::command]
pub async fn mqtt_unsubscribe(
    connections: State<'_, MqttConnections>,
    conn_id: String,
    topic: String,
) -> Result<(), String> {
    mqtt_client::unsubscribe(&conn_id, &topic, connections.inner().clone()).await
}

#[tauri::command]
pub async fn mqtt_publish(
    connections: State<'_, MqttConnections>,
    conn_id: String,
    topic: String,
    payload: String,
    qos: u8,
    retain: bool,
) -> Result<(), String> {
    mqtt_client::publish(
        &conn_id,
        &topic,
        &payload,
        qos,
        retain,
        connections.inner().clone(),
    )
    .await
}

// ═══════════════════════════════════════════
//  WASM Plugins
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn wasm_load_plugin(
    runtime: State<'_, WasmPluginRuntime>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let info = runtime.load_plugin(&plugin_id).await?;
    serde_json::to_value(info).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wasm_unload_plugin(
    runtime: State<'_, WasmPluginRuntime>,
    plugin_id: String,
) -> Result<(), String> {
    runtime.unload_plugin(&plugin_id).await;
    Ok(())
}

#[tauri::command]
pub async fn wasm_parse_data(
    runtime: State<'_, WasmPluginRuntime>,
    plugin_id: String,
    raw_data: String,
) -> Result<serde_json::Value, String> {
    let result = runtime.parse_data(&plugin_id, &raw_data).await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wasm_list_loaded(
    runtime: State<'_, WasmPluginRuntime>,
) -> Result<serde_json::Value, String> {
    let list = runtime.list_loaded().await;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════
//  Workflow Engine (自动化流程)
// ═══════════════════════════════════════════

use crate::workflow_engine::{self, Workflow, WorkflowState};
use tauri::Emitter as _;

#[tauri::command]
pub async fn workflow_list(pool: State<'_, SqlitePool>) -> Result<Vec<Workflow>, String> {
    workflow_engine::list_workflows(&pool).await
}

#[tauri::command]
pub async fn workflow_get(pool: State<'_, SqlitePool>, id: String) -> Result<Workflow, String> {
    workflow_engine::get_workflow(&pool, &id).await
}

#[tauri::command]
pub async fn workflow_create(
    pool: State<'_, SqlitePool>,
    workflow: Workflow,
) -> Result<Workflow, String> {
    workflow_engine::create_workflow(&pool, &workflow).await
}

#[tauri::command]
pub async fn workflow_update(
    pool: State<'_, SqlitePool>,
    workflow: Workflow,
) -> Result<(), String> {
    workflow_engine::update_workflow(&pool, &workflow).await
}

#[tauri::command]
pub async fn workflow_delete(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    workflow_engine::delete_workflow(&pool, &id).await
}

/// 运行流程 — 在后台 tokio 任务中异步执行，通过 Event 实时推送进度
#[tauri::command]
pub async fn workflow_run(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, WorkflowState>,
    id: String,
) -> Result<String, String> {
    let workflow = workflow_engine::get_workflow(&pool, &id).await?;

    let cancel_token = tokio_util::sync::CancellationToken::new();
    let execution_id = uuid::Uuid::new_v4().to_string();

    // 存储取消令牌
    {
        let mut running = state.running.lock().await;
        running.insert(execution_id.clone(), cancel_token.clone());
    }

    let exec_id = execution_id.clone();
    let state_inner = state.inner().clone();

    // 后台异步执行
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let result =
            workflow_engine::run_workflow(&workflow, app_clone.clone(), cancel_token).await;

        // 清理取消令牌
        {
            let mut running = state_inner.running.lock().await;
            running.remove(&exec_id);
        }

        // 发送完成事件
        let _ = app_clone.emit("workflow-completed", &result);
    });

    Ok(execution_id)
}

/// 取消正在运行的流程
#[tauri::command]
pub async fn workflow_cancel(
    state: State<'_, WorkflowState>,
    execution_id: String,
) -> Result<(), String> {
    let running = state.running.lock().await;
    if let Some(token) = running.get(&execution_id) {
        token.cancel();
        Ok(())
    } else {
        Err(format!("流程执行 {} 不存在或已完成", execution_id))
    }
}

// ═══════════════════════════════════════════
//  Video Streaming Commands
// ═══════════════════════════════════════════

use crate::video_streaming::{
    VideoStreamState,
    state::{StreamEvent, StreamInfo},
};

#[tauri::command]
pub async fn vs_connect(
    session_id: String,
    protocol: String,
    config: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;

    // Remove existing session if any
    if let Some(old) = sessions.remove(&session_id) {
        if let Some(tx) = old.shutdown_tx {
            let _ = tx.send(());
        }
    }

    // For HTTP-FLV, start background stream parsing task
    let shutdown_tx = if protocol == "http-flv" {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let sid = session_id.clone();
        let cfg: serde_json::Value = serde_json::from_str(&config).unwrap_or_default();
        let url = cfg
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let app_clone = app.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::video_streaming::http_flv::start_flv_stream(
                sid.clone(),
                url,
                app_clone.clone(),
                rx,
            )
            .await
            {
                log::warn!("FLV stream error: {}", e);
                let event = StreamEvent {
                    session_id: sid,
                    event_type: "error".to_string(),
                    data: Some(e),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };
                let _ = app_clone.emit("videostream-event", &event);
            }
        });
        Some(tx)
    } else {
        None
    };

    let session = crate::video_streaming::state::StreamSession {
        session_id: session_id.clone(),
        protocol: protocol.clone(),
        config: config.clone(),
        connected: true,
        shutdown_tx,
    };
    sessions.insert(session_id.clone(), session);

    // Emit connected event
    let event = StreamEvent {
        session_id: session_id.clone(),
        event_type: "connected".to_string(),
        data: Some(format!("{} stream ready", protocol.to_uppercase())),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);

    log::info!(
        "Video stream connected: {} protocol={}",
        session_id,
        protocol
    );
    Ok(())
}

#[tauri::command]
pub async fn vs_disconnect(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::video_streaming::player::stop_player(&session_id).await;
    crate::video_streaming::media_gateway::stop_hls_session(&session_id).await;

    // Clean up generic session
    let mut sessions = state.sessions.lock().await;
    if let Some(old) = sessions.remove(&session_id) {
        if let Some(tx) = old.shutdown_tx {
            let _ = tx.send(());
        }
    }
    drop(sessions);

    // Clean up protocol-specific sessions
    state.onvif_sessions.lock().await.remove(&session_id);
    if let Some(mut gb) = state.gb_sessions.lock().await.remove(&session_id) {
        let _ = crate::video_streaming::gb28181::stop_play(&mut gb, &session_id, &app).await;
        drop(gb.socket); // Close UDP socket
    }
    if let Some(rtmp) = state.rtmp_sessions.lock().await.remove(&session_id) {
        if let Some(tx) = rtmp.shutdown_tx {
            let _ = tx.send(());
        }
    }
    if let Some(srt) = state.srt_sessions.lock().await.remove(&session_id) {
        if let Some(tx) = srt.shutdown_tx {
            let _ = tx.send(());
        }
    }
    if let Some(webrtc) = state.webrtc_sessions.lock().await.remove(&session_id) {
        if let Some(tx) = webrtc.shutdown_tx {
            let _ = tx.send(());
        }
    }

    let event = StreamEvent {
        session_id: session_id.clone(),
        event_type: "disconnected".to_string(),
        data: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);

    log::info!("Video stream disconnected: {}", session_id);
    Ok(())
}

#[tauri::command]
pub async fn vs_probe(url: String, app: AppHandle) -> Result<StreamInfo, String> {
    log::info!("Probing stream: {}", url);

    // Detect protocol from URL and probe accordingly
    let lower = url.to_lowercase();
    if lower.starts_with("rtsp://") {
        // RTSP probe: send DESCRIBE and parse SDP
        let resp = crate::video_streaming::rtsp::send_rtsp_request(
            "probe", &url, "DESCRIBE", None, "tcp", "", &app,
        )
        .await?;

        // Parse SDP from DESCRIBE response
        if let Some(sdp_start) = resp.find("v=0") {
            let sdp = crate::video_streaming::rtsp::parse_sdp(&resp[sdp_start..]);
            let video = sdp
                .media_descriptions
                .iter()
                .find(|m| m.media_type == "video");
            let audio = sdp
                .media_descriptions
                .iter()
                .find(|m| m.media_type == "audio");

            return Ok(StreamInfo {
                codec: video
                    .and_then(|v| v.codec.clone())
                    .unwrap_or_else(|| "Unknown".to_string()),
                width: 0,
                height: 0,
                fps: 0.0,
                bitrate: 0,
                audio_codec: audio.and_then(|a| a.codec.clone()),
                sample_rate: audio.and_then(|a| a.clock_rate),
                channels: None,
            });
        }
        Err("RTSP DESCRIBE did not contain SDP".to_string())
    } else if lower.ends_with(".m3u8") || lower.contains("/hls/") {
        // HLS probe: fetch playlist and extract info
        let playlist =
            crate::video_streaming::hls::fetch_and_parse_playlist("probe", &url, &app).await?;
        let info = if !playlist.variants.is_empty() {
            let first = &playlist.variants[0];
            let codecs = first.codecs.as_deref().unwrap_or("");
            let resolution = first.resolution.as_deref().unwrap_or("");
            let (w, h) = if let Some(x_pos) = resolution.find('x') {
                (
                    resolution[..x_pos].parse().unwrap_or(0),
                    resolution[x_pos + 1..].parse().unwrap_or(0),
                )
            } else {
                (0u32, 0u32)
            };
            StreamInfo {
                codec: if codecs.contains("avc") {
                    "H.264".to_string()
                } else if codecs.contains("hev") {
                    "H.265".to_string()
                } else if codecs.is_empty() {
                    "HLS".to_string()
                } else {
                    codecs.to_string()
                },
                width: w,
                height: h,
                fps: 0.0,
                bitrate: first.bandwidth / 1000,
                audio_codec: if codecs.contains("mp4a") {
                    Some("AAC".to_string())
                } else {
                    None
                },
                sample_rate: None,
                channels: None,
            }
        } else {
            let seg_count = playlist.segments.len();
            let duration = playlist.total_duration;
            StreamInfo {
                codec: "HLS".to_string(),
                width: 0,
                height: 0,
                fps: if duration > 0.0 && seg_count > 0 {
                    seg_count as f64 / duration
                } else {
                    0.0
                },
                bitrate: 0,
                audio_codec: None,
                sample_rate: None,
                channels: None,
            }
        };
        Ok(info)
    } else if lower.ends_with(".flv") || lower.contains("/flv") || lower.contains("http-flv") {
        // HTTP-FLV probe: fetch first few bytes to parse header
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Read error: {}", e))?;
        if bytes.len() >= 9 {
            let header = crate::video_streaming::http_flv::parse_flv_header(&bytes)?;
            Ok(StreamInfo {
                codec: if header.has_video {
                    "FLV/H.264".to_string()
                } else {
                    "FLV".to_string()
                },
                width: 0,
                height: 0,
                fps: 0.0,
                bitrate: 0,
                audio_codec: if header.has_audio {
                    Some("FLV Audio".to_string())
                } else {
                    None
                },
                sample_rate: None,
                channels: None,
            })
        } else {
            Err("FLV response too short".to_string())
        }
    } else {
        // Generic HTTP probe: try to detect content type
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;
        let resp = client
            .head(&url)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();
        Ok(StreamInfo {
            codec: content_type.clone(),
            width: 0,
            height: 0,
            fps: 0.0,
            bitrate: 0,
            audio_codec: None,
            sample_rate: None,
            channels: None,
        })
    }
}

#[tauri::command]
pub async fn vs_player_load(
    session_id: String,
    protocol: String,
    url: String,
    config: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!(
        "Player load: session={} protocol={} url={}",
        session_id,
        protocol,
        url
    );

    // HLS 可直接在前端用 hls.js 播放
    if protocol == "hls" || url.to_lowercase().contains(".m3u8") {
        return Ok(format!("hls:{}", url));
    }

    // 源协议优先通过本地 HLS 网关统一输出，供 EasyPlayer 直接播放
    match protocol.as_str() {
        "rtsp" | "rtmp" | "srt" | "onvif" | "gb28181" => {
            crate::video_streaming::player::stop_player(&session_id).await;
            crate::video_streaming::media_gateway::start_hls_session(
                session_id.clone(),
                protocol,
                url,
                config,
                app,
            )
            .await
        }
        _ => {
            crate::video_streaming::media_gateway::stop_hls_session(&session_id).await;
            crate::video_streaming::player::start_player(
                session_id.clone(),
                protocol,
                url.clone(),
                config,
                app,
            )
            .await
            .map(|_| format!("tauri:{}", url))
        }
    }
}

/// 查询 FFmpeg 安装状态
#[tauri::command]
pub async fn vs_ffmpeg_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let status = crate::video_streaming::ffmpeg_manager::get_status(&app).await;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

/// 按需下载 FFmpeg 到应用数据目录
#[tauri::command]
pub async fn vs_ffmpeg_download(app: AppHandle) -> Result<String, String> {
    let path = crate::video_streaming::ffmpeg_manager::download(&app).await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn vs_player_control(
    session_id: String,
    action: String,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("Player control: session={} action={}", session_id, action);
    if action == "stop" {
        crate::video_streaming::player::stop_player(&session_id).await;
        crate::video_streaming::media_gateway::stop_hls_session(&session_id).await;
        let event = crate::video_streaming::state::StreamEvent {
            session_id,
            event_type: "disconnected".to_string(),
            data: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        let _ = app.emit("videostream-event", &event);
    }
    Ok(())
}

#[tauri::command]
pub async fn vs_player_set_volume(session_id: String, volume: f64) -> Result<(), String> {
    log::info!("Player volume: session={} vol={}", session_id, volume);
    Ok(())
}

#[tauri::command]
pub async fn vs_rtsp_command(
    session_id: String,
    method: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!("RTSP command: session={} method={}", session_id, method);

    // Get the URL from the session config
    let sessions = state.sessions.lock().await;
    let url = if let Some(session) = sessions.get(&session_id) {
        let cfg: serde_json::Value = serde_json::from_str(&session.config).unwrap_or_default();
        cfg.get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        return Err("Session not found".to_string());
    };
    drop(sessions);

    if url.is_empty() {
        return Err("No RTSP URL configured".to_string());
    }

    let sessions = state.sessions.lock().await;
    let cfg: serde_json::Value = sessions
        .get(&session_id)
        .and_then(|session| serde_json::from_str(&session.config).ok())
        .unwrap_or_default();
    drop(sessions);

    let transport = cfg
        .get("transport")
        .and_then(|v| v.as_str())
        .unwrap_or("tcp")
        .to_string();
    let auth_method = cfg
        .get("authMethod")
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let username = cfg.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let password = cfg.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let mut extra_headers = String::new();
    if auth_method == "basic" && !username.is_empty() {
        use base64::Engine;
        let token =
            base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", username, password));
        extra_headers.push_str(&format!("Authorization: Basic {}\r\n", token));
    } else if auth_method == "digest" {
        return Err(
            "当前 RTSP 调试面板暂未实现 Digest 挑战应答，仅内置播放器会通过 FFmpeg 自动处理。"
                .to_string(),
        );
    }

    // Use real RTSP client
    crate::video_streaming::rtsp::send_rtsp_request(
        &session_id,
        &url,
        &method,
        None,
        &transport,
        &extra_headers,
        &app,
    )
    .await
}

#[tauri::command]
pub async fn vs_hls_parse_playlist(
    session_id: String,
    url: String,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    log::info!("HLS parse playlist: session={} url={}", session_id, url);
    let playlist =
        crate::video_streaming::hls::fetch_and_parse_playlist(&session_id, &url, &app).await?;
    serde_json::to_value(&playlist).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn vs_gb_register(
    session_id: String,
    config: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("GB28181 register: session={}", session_id);

    let cfg: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| format!("Invalid config JSON: {}", e))?;
    let sip_server = cfg
        .get("sipServerIp")
        .and_then(|v| v.as_str())
        .unwrap_or("192.168.1.100");
    let sip_port = cfg
        .get("sipServerPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(5060) as u16;
    let sip_domain = cfg
        .get("sipDomain")
        .and_then(|v| v.as_str())
        .unwrap_or("3402000000");
    let device_id = cfg
        .get("deviceId")
        .and_then(|v| v.as_str())
        .unwrap_or("34020000001320000001");
    let local_port = cfg
        .get("localPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(5080) as u16;
    let transport = cfg
        .get("transport")
        .and_then(|v| v.as_str())
        .unwrap_or("udp");

    let session = crate::video_streaming::gb28181::register(
        &session_id,
        sip_server,
        sip_port,
        sip_domain,
        device_id,
        local_port,
        transport,
        &app,
    )
    .await?;

    state.gb_sessions.lock().await.insert(session_id, session);

    Ok(())
}

#[tauri::command]
pub async fn vs_gb_query_catalog(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    log::info!("GB28181 query catalog: session={}", session_id);

    let sessions = state.gb_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "GB28181 not registered".to_string())?;

    crate::video_streaming::gb28181::query_catalog(session, &session_id, &app).await
}

#[tauri::command]
pub async fn vs_gb_unregister(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("GB28181 unregister: session={}", session_id);

    if let Some(mut session) = state.gb_sessions.lock().await.remove(&session_id) {
        let _ = crate::video_streaming::gb28181::stop_play(&mut session, &session_id, &app).await;
        drop(session.socket);
    }

    let msg = crate::video_streaming::state::ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "gb28181".to_string(),
        summary: "GB28181 会话已注销".to_string(),
        detail: format!("Session: {}", session_id),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    Ok(())
}

#[tauri::command]
pub async fn vs_gb_start_live(
    session_id: String,
    channel_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!(
        "GB28181 start live: session={} channel={}",
        session_id,
        channel_id
    );

    let mut sessions = state.gb_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "GB28181 not registered".to_string())?;

    crate::video_streaming::gb28181::start_play(session, &session_id, &channel_id, &app).await
}

#[tauri::command]
pub async fn vs_gb_stop_live(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("GB28181 stop live: session={}", session_id);

    crate::video_streaming::player::stop_player(&session_id).await;
    crate::video_streaming::media_gateway::stop_hls_session(&session_id).await;

    let mut sessions = state.gb_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "GB28181 not registered".to_string())?;

    crate::video_streaming::gb28181::stop_play(session, &session_id, &app).await?;

    let event = crate::video_streaming::state::StreamEvent {
        session_id,
        event_type: "disconnected".to_string(),
        data: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);

    Ok(())
}

#[tauri::command]
pub async fn vs_gb_ptz(
    session_id: String,
    command: String,
    speed: f64,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!(
        "GB28181 PTZ: session={} cmd={} speed={}",
        session_id,
        command,
        speed
    );

    let sessions = state.gb_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "GB28181 not registered".to_string())?;

    crate::video_streaming::gb28181::ptz_control(session, &session_id, &command, speed, &app).await
}

// ── ONVIF Commands ──

#[tauri::command]
pub async fn vs_onvif_discover(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    log::info!("ONVIF WS-Discovery scan");
    crate::video_streaming::onvif::discover(&app).await
}

#[tauri::command]
pub async fn vs_onvif_device_info(
    session_id: String,
    config: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    log::info!("ONVIF get device info: session={}", session_id);

    let cfg: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| format!("Invalid config JSON: {}", e))?;
    let host = cfg
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("192.168.1.100");
    let port = cfg.get("port").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    let username = cfg.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let password = cfg.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let xaddr = cfg.get("xaddr").and_then(|v| v.as_str());
    let use_proxy = cfg
        .get("useProxy")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let (info, session) = crate::video_streaming::onvif::get_device_info(
        &session_id,
        host,
        port,
        username,
        password,
        xaddr,
        use_proxy,
        &app,
    )
    .await?;

    // Cache session for subsequent calls
    state
        .onvif_sessions
        .lock()
        .await
        .insert(session_id, session);

    Ok(info)
}

#[tauri::command]
pub async fn vs_onvif_get_profiles(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    log::info!("ONVIF get profiles: session={}", session_id);

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found — get device info first".to_string())?;

    crate::video_streaming::onvif::get_profiles(session, &session_id, &app).await
}

#[tauri::command]
pub async fn vs_onvif_get_stream_uri(
    session_id: String,
    profile_token: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!(
        "ONVIF get stream URI: session={} profile={}",
        session_id,
        profile_token
    );

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::get_stream_uri(session, &session_id, &profile_token, &app).await
}

#[tauri::command]
pub async fn vs_onvif_ptz_move(
    session_id: String,
    direction: String,
    speed: f64,
    profile_token: Option<String>,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    let pt = profile_token.as_deref().unwrap_or("Profile_1");
    log::info!(
        "ONVIF PTZ move: session={} dir={} speed={} profile={}",
        session_id,
        direction,
        speed,
        pt
    );

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::ptz_continuous_move(
        session,
        &session_id,
        pt,
        &direction,
        speed,
        &app,
    )
    .await
}

#[tauri::command]
pub async fn vs_onvif_ptz_stop(
    session_id: String,
    profile_token: Option<String>,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    let pt = profile_token.as_deref().unwrap_or("Profile_1");
    log::info!("ONVIF PTZ stop: session={} profile={}", session_id, pt);

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::ptz_stop(session, &session_id, pt, &app).await
}

#[tauri::command]
pub async fn vs_onvif_get_presets(
    session_id: String,
    profile_token: Option<String>,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let pt = profile_token.as_deref().unwrap_or("Profile_1");
    log::info!("ONVIF get presets: session={} profile={}", session_id, pt);

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::get_presets(session, &session_id, pt, &app).await
}

#[tauri::command]
pub async fn vs_onvif_goto_preset(
    session_id: String,
    preset_token: String,
    profile_token: Option<String>,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    let pt = profile_token.as_deref().unwrap_or("Profile_1");
    log::info!(
        "ONVIF goto preset: session={} preset={} profile={}",
        session_id,
        preset_token,
        pt
    );

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::goto_preset(session, &session_id, pt, &preset_token, &app).await
}

#[tauri::command]
pub async fn vs_onvif_set_preset(
    session_id: String,
    preset_name: String,
    profile_token: Option<String>,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<String, String> {
    let pt = profile_token.as_deref().unwrap_or("Profile_1");
    log::info!(
        "ONVIF set preset: session={} name={} profile={}",
        session_id,
        preset_name,
        pt
    );

    let sessions = state.onvif_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "ONVIF session not found".to_string())?;

    crate::video_streaming::onvif::set_preset(session, &session_id, pt, &preset_name, &app).await
}

#[tauri::command]
pub async fn vs_onvif_close(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("ONVIF close: session={}", session_id);

    state.onvif_sessions.lock().await.remove(&session_id);

    let msg = crate::video_streaming::state::ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "onvif".to_string(),
        summary: "ONVIF 会话已关闭".to_string(),
        detail: format!("Session: {}", session_id),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    Ok(())
}

// ── RTMP Commands ──

#[tauri::command]
pub async fn vs_rtmp_handshake(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("RTMP handshake: session={}", session_id);

    // Get URL from session config
    let sessions = state.sessions.lock().await;
    let url = if let Some(session) = sessions.get(&session_id) {
        let cfg: serde_json::Value = serde_json::from_str(&session.config).unwrap_or_default();
        cfg.get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        return Err("Session not found".to_string());
    };
    drop(sessions);

    if url.is_empty() {
        return Err("No RTMP URL configured".to_string());
    }

    let stream = crate::video_streaming::rtmp::handshake(&session_id, &url, &app).await?;

    // Store the TCP stream for subsequent commands
    let rtmp_session = crate::video_streaming::state::RtmpSession {
        stream: Some(stream),
        url: url.clone(),
        handshake_done: true,
        connected: false,
        shutdown_tx: None,
    };
    state
        .rtmp_sessions
        .lock()
        .await
        .insert(session_id, rtmp_session);

    Ok(())
}

#[tauri::command]
pub async fn vs_rtmp_connect_app(
    session_id: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("RTMP connect app: session={}", session_id);

    let mut sessions = state.rtmp_sessions.lock().await;
    let rtmp = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "RTMP session not found — handshake first".to_string())?;

    let stream = rtmp
        .stream
        .as_mut()
        .ok_or_else(|| "RTMP TCP stream not available".to_string())?;

    crate::video_streaming::rtmp::connect_app(stream, &session_id, &rtmp.url.clone(), &app).await?;
    rtmp.connected = true;

    Ok(())
}

#[tauri::command]
pub async fn vs_rtmp_play(
    session_id: String,
    stream_key: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("RTMP play: session={} key={}", session_id, stream_key);

    let mut sessions = state.rtmp_sessions.lock().await;
    let rtmp = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "RTMP session not found".to_string())?;

    let stream = rtmp
        .stream
        .as_mut()
        .ok_or_else(|| "RTMP TCP stream not available".to_string())?;

    crate::video_streaming::rtmp::play(stream, &session_id, &stream_key, &app).await
}

// ── SRT Commands ──

#[tauri::command]
pub async fn vs_srt_connect(
    session_id: String,
    config: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("SRT connect: session={}", session_id);

    crate::video_streaming::srt::connect(&session_id, &config, &state, &app).await
}

#[tauri::command]
pub async fn vs_srt_disconnect(
    session_id: String,
    state: State<'_, VideoStreamState>,
) -> Result<(), String> {
    log::info!("SRT disconnect: session={}", session_id);

    let mut sessions = state.srt_sessions.lock().await;
    if let Some(session) = sessions.remove(&session_id) {
        if let Some(tx) = session.shutdown_tx {
            let _ = tx.send(());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn vs_srt_stats(
    session_id: String,
    state: State<'_, VideoStreamState>,
) -> Result<serde_json::Value, String> {
    log::info!("SRT stats: session={}", session_id);

    let sessions = state.srt_sessions.lock().await;
    if sessions.contains_key(&session_id) {
        Ok(serde_json::json!({
            "connected": true,
            "rtt": 0,
            "bandwidth": 0,
            "retransmitRate": 0.0,
            "dropRate": 0.0,
            "sendRate": 0,
            "recvRate": 0,
        }))
    } else {
        Err("SRT session not found".to_string())
    }
}

// ── WebRTC Commands ──

#[tauri::command]
pub async fn vs_webrtc_create_offer(
    session_id: String,
    config: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<String, String> {
    log::info!("WebRTC create offer: session={}", session_id);

    crate::video_streaming::webrtc::create_offer(&session_id, &config, &state, &app).await
}

#[tauri::command]
pub async fn vs_webrtc_set_answer(
    session_id: String,
    sdp: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("WebRTC set answer: session={}", session_id);

    crate::video_streaming::webrtc::set_answer(&session_id, &sdp, &state, &app).await
}

#[tauri::command]
pub async fn vs_webrtc_add_ice(
    session_id: String,
    candidate: String,
    state: State<'_, VideoStreamState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("WebRTC add ICE: session={}", session_id);

    crate::video_streaming::webrtc::add_ice_candidate(&session_id, &candidate, &state, &app).await
}

#[tauri::command]
pub async fn vs_webrtc_close(
    session_id: String,
    state: State<'_, VideoStreamState>,
) -> Result<(), String> {
    log::info!("WebRTC close: session={}", session_id);

    let mut sessions = state.webrtc_sessions.lock().await;
    if let Some(session) = sessions.remove(&session_id) {
        if let Some(tx) = session.shutdown_tx {
            let _ = tx.send(());
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════
//  Mock Server
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn mock_server_start(
    app: AppHandle,
    state: State<'_, MockServerState>,
    session_id: String,
    port: u16,
    routes: Vec<MockRoute>,
) -> Result<(), String> {
    mock_server::start_mock_server(app, &state, &session_id, port, routes).await
}

#[tauri::command]
pub async fn mock_server_stop(
    state: State<'_, MockServerState>,
    session_id: String,
) -> Result<(), String> {
    mock_server::stop_mock_server(&state, &session_id).await
}

#[tauri::command]
pub async fn mock_server_update_routes(
    state: State<'_, MockServerState>,
    session_id: String,
    routes: Vec<MockRoute>,
) -> Result<(), String> {
    mock_server::update_routes(&state, &session_id, routes).await
}

#[tauri::command]
pub async fn mock_server_get_log(
    state: State<'_, MockServerState>,
    session_id: String,
) -> Result<Vec<MockRequestLog>, String> {
    Ok(mock_server::get_logs(&state, &session_id).await)
}

#[tauri::command]
pub async fn mock_server_clear_log(
    state: State<'_, MockServerState>,
    session_id: String,
) -> Result<(), String> {
    mock_server::clear_logs(&state, &session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn mock_server_status(
    state: State<'_, MockServerState>,
    session_id: String,
) -> Result<MockServerStatusInfo, String> {
    Ok(mock_server::get_status(&state, &session_id).await)
}

#[tauri::command]
pub async fn mock_server_set_proxy_target(
    state: State<'_, MockServerState>,
    session_id: String,
    target: Option<String>,
) -> Result<(), String> {
    mock_server::set_proxy_target(&state, &session_id, target).await
}

// ── Mock Server 持久化 ──

#[tauri::command]
pub async fn mock_server_save_config(
    pool: State<'_, SqlitePool>,
    config: MockServerConfig,
) -> Result<(), String> {
    mock_server::save_mock_config(&pool, &config).await
}

#[tauri::command]
pub async fn mock_server_load_config(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<Option<MockServerConfig>, String> {
    mock_server::load_mock_config(&pool, &id).await
}

#[tauri::command]
pub async fn mock_server_list_configs(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<MockServerConfig>, String> {
    mock_server::list_mock_configs(&pool).await
}

#[tauri::command]
pub async fn mock_server_delete_config(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    mock_server::delete_mock_config(&pool, &id).await
}

// ═══════════════════════════════════════════
//  Database Client
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn db_client_connect(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    config: ConnectionConfig,
) -> Result<ServerInfo, String> {
    mgr.connect(&session_id, &config).await
}

#[tauri::command]
pub async fn db_client_disconnect(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
) -> Result<(), String> {
    mgr.disconnect(&session_id).await
}

#[tauri::command]
pub async fn db_client_test_connection(
    mgr: State<'_, DbConnectionManager>,
    config: ConnectionConfig,
) -> Result<ServerInfo, String> {
    mgr.test_connection(&config).await
}

#[tauri::command]
pub async fn db_client_list_databases(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.list_databases().await
}

#[tauri::command]
pub async fn db_client_list_schema_objects(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    database: String,
    schema: String,
) -> Result<SchemaObjects, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.list_schema_objects(&database, &schema).await
}

#[tauri::command]
pub async fn db_client_describe_table(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<TableDescription, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.describe_table(&database, &schema, &table).await
}

#[tauri::command]
pub async fn db_client_execute_query(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    let mut result = driver.execute_query(&sql).await?;
    // 安全阈值：截断超过 10000 行的结果防止前端 OOM
    const MAX_ROWS: usize = 10_000;
    if result.rows.len() > MAX_ROWS {
        result.rows.truncate(MAX_ROWS);
        result.truncated = true;
        result.warnings.push(format!("Result truncated to {} rows", MAX_ROWS));
    }
    Ok(result)
}

#[tauri::command]
pub async fn db_client_cancel_query(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
) -> Result<(), String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.cancel_query().await
}

#[tauri::command]
pub async fn db_client_fetch_table_data(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    database: String,
    schema: String,
    table: String,
    offset: i64,
    limit: i64,
    sort_column: Option<String>,
    sort_dir: Option<String>,
    filter: Option<String>,
) -> Result<QueryResult, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.fetch_table_data(
        &database, &schema, &table, offset, limit,
        sort_column.as_deref(), sort_dir.as_deref(), filter.as_deref(),
    ).await
}

#[tauri::command]
pub async fn db_client_apply_edits(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    edits: Vec<CellEdit>,
) -> Result<u64, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.apply_cell_edits(&edits).await
}

#[tauri::command]
pub async fn db_client_delete_rows(
    mgr: State<'_, DbConnectionManager>,
    session_id: String,
    database: String,
    schema: String,
    table: String,
    pk_columns: Vec<String>,
    pk_values: Vec<Vec<SqlValue>>,
) -> Result<u64, String> {
    let driver_arc = mgr.get_driver_arc(&session_id).await?;
    let driver = driver_arc.lock().await;
    driver.delete_rows(&database, &schema, &table, &pk_columns, &pk_values).await
}

// ── DB Client 持久化 ──

#[tauri::command]
pub async fn db_client_save_connection(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    req: SaveConnectionRequest,
) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("App data dir: {}", e))?;
    db_client::save_connection(&pool, &req, &app_data_dir).await
}

#[tauri::command]
pub async fn db_client_list_connections(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<SavedConnection>, String> {
    db_client::list_connections(&pool).await
}

#[tauri::command]
pub async fn db_client_delete_connection(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    db_client::delete_connection(&pool, &id).await
}

#[tauri::command]
pub async fn db_client_add_query_history(
    pool: State<'_, SqlitePool>,
    entry: QueryHistoryEntry,
) -> Result<(), String> {
    db_client::add_query_history(&pool, &entry).await
}

#[tauri::command]
pub async fn db_client_list_query_history(
    pool: State<'_, SqlitePool>,
    connection_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    db_client::list_query_history(&pool, connection_id.as_deref(), limit.unwrap_or(100)).await
}

// ── DB Client 导入导出 ──

#[tauri::command]
pub async fn db_client_export(
    _mgr: State<'_, DbConnectionManager>,
    _session_id: String,
    config: ConnectionConfig,
    options: db_client::driver::ExportOptions,
) -> Result<db_client::driver::ExportResult, String> {
    match config.db_type.as_str() {
        "postgresql" => {
            db_client::export::pg_dump(
                &config.host, config.port, &config.username, &config.password, &options,
            ).await
        }
        "mysql" => {
            db_client::export::mysql_dump(
                &config.host, config.port, &config.username, &config.password, &options,
            ).await
        }
        "sqlite" => {
            let db_path = config.file_path.as_deref().unwrap_or(&config.database);
            db_client::export::sqlite_dump(db_path, &options).await
        }
        _ => Err(format!("Export not supported for {}", config.db_type)),
    }
}

#[tauri::command]
pub async fn db_client_import(
    _mgr: State<'_, DbConnectionManager>,
    _session_id: String,
    config: ConnectionConfig,
    options: db_client::driver::ImportOptions,
) -> Result<db_client::driver::ImportResult, String> {
    match config.db_type.as_str() {
        "postgresql" => {
            db_client::export::pg_import(
                &config.host, config.port, &config.username, &config.password, &options,
            ).await
        }
        _ => Err(format!("Import not supported for {}", config.db_type)),
    }
}
