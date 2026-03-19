// Tauri IPC Commands — 全部使用 SQLite 持久化
// 这是一个薄委托层，业务逻辑在各领域模块中

use crate::http_client::{self, HttpRequest, HttpResponse};
use crate::collections::{
    self, Collection, CollectionItem, HistoryEntry,
    Environment, EnvVariable, GlobalVariable,
};
use crate::ws_client::WsConnections;
use crate::tcp_client::{TcpConnections, TcpServers, UdpSockets};
use crate::load_test::{LoadTestConfig, LoadTestState};
use sqlx::SqlitePool;
use tauri::{Manager, State};

// ═══════════════════════════════════════════
//  HTTP
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    http_client::execute_request(request).await
}

// ═══════════════════════════════════════════
//  Collections
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_collections(pool: State<'_, SqlitePool>) -> Result<Vec<Collection>, String> {
    collections::list_collections(&pool).await
}

#[tauri::command]
pub async fn create_collection(pool: State<'_, SqlitePool>, collection: Collection) -> Result<Collection, String> {
    collections::create_collection(&pool, collection).await
}

#[tauri::command]
pub async fn update_collection(pool: State<'_, SqlitePool>, collection: Collection) -> Result<(), String> {
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
pub async fn import_collection(pool: State<'_, SqlitePool>, json: String) -> Result<Collection, String> {
    collections::import_collection(&pool, &json).await
}

// ═══════════════════════════════════════════
//  Collection Items
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_collection_items(pool: State<'_, SqlitePool>, collection_id: String) -> Result<Vec<CollectionItem>, String> {
    collections::list_collection_items(&pool, &collection_id).await
}

#[tauri::command]
pub async fn create_collection_item(pool: State<'_, SqlitePool>, item: CollectionItem) -> Result<CollectionItem, String> {
    collections::create_collection_item(&pool, item).await
}

#[tauri::command]
pub async fn update_collection_item(pool: State<'_, SqlitePool>, item: CollectionItem) -> Result<(), String> {
    collections::update_collection_item(&pool, item).await
}

#[tauri::command]
pub async fn delete_collection_item(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    collections::delete_collection_item(&pool, &id).await
}

// ═══════════════════════════════════════════
//  Environments
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_environments(pool: State<'_, SqlitePool>) -> Result<Vec<Environment>, String> {
    collections::list_environments(&pool).await
}

#[tauri::command]
pub async fn create_environment(pool: State<'_, SqlitePool>, environment: Environment) -> Result<Environment, String> {
    collections::create_environment(&pool, environment).await
}

#[tauri::command]
pub async fn set_active_environment(pool: State<'_, SqlitePool>, id: Option<String>) -> Result<(), String> {
    collections::set_active_environment(&pool, id.as_deref()).await
}

#[tauri::command]
pub async fn get_active_environment(pool: State<'_, SqlitePool>) -> Result<Option<Environment>, String> {
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
pub async fn list_env_variables(pool: State<'_, SqlitePool>, environment_id: String) -> Result<Vec<EnvVariable>, String> {
    collections::list_env_variables(&pool, &environment_id).await
}

#[tauri::command]
pub async fn save_env_variables(pool: State<'_, SqlitePool>, environment_id: String, variables: Vec<EnvVariable>) -> Result<(), String> {
    collections::save_env_variables(&pool, &environment_id, variables).await
}

// ═══════════════════════════════════════════
//  Global Variables
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn list_global_variables(pool: State<'_, SqlitePool>) -> Result<Vec<GlobalVariable>, String> {
    collections::list_global_variables(&pool).await
}

#[tauri::command]
pub async fn save_global_variables(pool: State<'_, SqlitePool>, variables: Vec<GlobalVariable>) -> Result<(), String> {
    collections::save_global_variables(&pool, variables).await
}

// ═══════════════════════════════════════════
//  History
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn add_history(pool: State<'_, SqlitePool>, entry: HistoryEntry) -> Result<(), String> {
    collections::add_history(&pool, entry).await
}

#[tauri::command]
pub async fn list_history(pool: State<'_, SqlitePool>, limit: i64) -> Result<Vec<HistoryEntry>, String> {
    collections::list_history(&pool, limit).await
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
//  Postman 导入
// ═══════════════════════════════════════════

#[tauri::command]
pub async fn import_postman_collection(
    pool: State<'_, SqlitePool>,
    json: String,
) -> Result<collections::Collection, String> {
    crate::postman_compat::import_postman(&pool, &json).await
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
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM collection_items WHERE id = ?"
    )
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
) -> Result<(), String> {
    crate::ws_client::connect(app, &connections, connection_id, url).await
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
) -> Result<(), String> {
    crate::tcp_client::tcp_send(&connections, &connection_id, data).await
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
) -> Result<(), String> {
    crate::tcp_client::tcp_server_send(&servers, &server_id, &client_id, data).await
}

#[tauri::command]
pub async fn tcp_server_broadcast(
    servers: State<'_, TcpServers>,
    server_id: String,
    data: String,
) -> Result<usize, String> {
    crate::tcp_client::tcp_server_broadcast(&servers, &server_id, data).await
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
) -> Result<(), String> {
    crate::tcp_client::udp_send_to(&sockets, &socket_id, data, target_addr).await
}

#[tauri::command]
pub async fn udp_close(
    sockets: State<'_, UdpSockets>,
    socket_id: String,
) -> Result<(), String> {
    crate::tcp_client::udp_close(&sockets, &socket_id).await
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

// ═══════════════════════════════════════════
//  Proxy Capture (抓包)
// ═══════════════════════════════════════════

use crate::proxy_capture::{self, CapturedEntry, ProxyState, ProxyStatusInfo};

#[tauri::command]
pub async fn proxy_start(
    app: tauri::AppHandle,
    state: State<'_, ProxyState>,
    port: u16,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    proxy_capture::start_proxy(app, &state, port, app_data_dir).await
}

#[tauri::command]
pub async fn proxy_stop(
    state: State<'_, ProxyState>,
) -> Result<(), String> {
    proxy_capture::stop_proxy(&state).await
}

#[tauri::command]
pub fn proxy_status(
    state: State<'_, ProxyState>,
) -> Result<ProxyStatusInfo, String> {
    Ok(proxy_capture::get_status(&state))
}

#[tauri::command]
pub async fn proxy_get_entries(
    state: State<'_, ProxyState>,
) -> Result<Vec<CapturedEntry>, String> {
    Ok(proxy_capture::get_entries(&state).await)
}

#[tauri::command]
pub async fn proxy_clear(
    state: State<'_, ProxyState>,
) -> Result<(), String> {
    proxy_capture::clear_entries(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn proxy_export_ca(
    state: State<'_, ProxyState>,
) -> Result<String, String> {
    proxy_capture::export_ca_cert(&state).await
}

// ═══════════════════════════════════════════
//  Plugins
// ═══════════════════════════════════════════

use crate::plugin_runtime::{PluginManager, PluginManifest, ProtocolParser, ParseResult};

#[tauri::command]
pub async fn plugin_list(
    mgr: State<'_, PluginManager>,
) -> Result<Vec<PluginManifest>, String> {
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
pub async fn plugin_get_protocol_parsers(
    mgr: State<'_, PluginManager>,
) -> Result<Vec<ProtocolParser>, String> {
    Ok(mgr.get_protocol_parsers().await)
}
