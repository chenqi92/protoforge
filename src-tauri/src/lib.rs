mod http_client;
mod commands;
mod collections;
mod database;
mod postman_compat;
mod swagger_import;
mod ws_client;
mod tcp_client;
mod load_test;
mod proxy_capture;
mod plugin_runtime;
mod script_engine;
mod sse_client;
mod mqtt_client;

use tauri::Manager;
use ws_client::WsConnections;
use tcp_client::{TcpConnections, TcpServers, UdpSockets};
use load_test::LoadTestState;
use proxy_capture::ProxyState;
use plugin_runtime::PluginManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()
                .expect("failed to get app data dir");

            // 初始化 SQLite 数据库连接池
            let app_data_for_db = app_data.clone();
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = database::init_pool(&app_data_for_db).await
                    .expect("failed to init database");
                handle.manage(pool);
            });

            // 注册 Tauri 插件
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            app.handle().plugin(tauri_plugin_process::init())?;

            // 初始化连接管理器
            app.manage(WsConnections::new());
            app.manage(TcpConnections::new());
            app.manage(TcpServers::new());
            app.manage(UdpSockets::new());
            app.manage(LoadTestState::new());
            app.manage(ProxyState::new());

            // SSE / MQTT 连接管理
            app.manage(sse_client::new_connections());
            app.manage(mqtt_client::new_connections());

            // 初始化插件管理器
            let plugin_mgr = PluginManager::new(&app_data);
            let handle2 = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                if let Err(e) = plugin_mgr.scan_installed().await {
                    log::warn!("扫描插件目录失败: {}", e);
                }
                handle2.manage(plugin_mgr);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // HTTP
            commands::send_request,
            commands::send_request_with_scripts,
            // Collections
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::export_collection,
            commands::import_collection,
            // Collection Items
            commands::list_collection_items,
            commands::create_collection_item,
            commands::update_collection_item,
            commands::delete_collection_item,
            // Environments
            commands::list_environments,
            commands::create_environment,
            commands::set_active_environment,
            commands::get_active_environment,
            commands::delete_environment,
            // Environment Variables
            commands::list_env_variables,
            commands::save_env_variables,
            // Global Variables
            commands::list_global_variables,
            commands::save_global_variables,
            // History
            commands::add_history,
            commands::list_history,
            commands::delete_history_entry,
            commands::clear_history,
            // Postman Import
            commands::import_postman_collection,
            commands::export_postman_collection,
            // Swagger Import
            commands::fetch_swagger,
            commands::import_swagger_endpoints,
            // Save Request
            commands::save_request_to_collection,
            // WebSocket
            commands::ws_connect,
            commands::ws_send,
            commands::ws_send_binary,
            commands::ws_disconnect,
            // TCP Client
            commands::tcp_connect,
            commands::tcp_send,
            commands::tcp_disconnect,
            // TCP Server
            commands::tcp_server_start,
            commands::tcp_server_send,
            commands::tcp_server_broadcast,
            commands::tcp_server_stop,
            // UDP
            commands::udp_bind,
            commands::udp_send_to,
            commands::udp_close,
            // Load Test
            commands::start_load_test,
            commands::stop_load_test,
            // Proxy Capture
            commands::proxy_start,
            commands::proxy_stop,
            commands::proxy_status,
            commands::proxy_get_entries,
            commands::proxy_clear,
            commands::proxy_export_ca,
            // Plugins
            commands::plugin_list,
            commands::plugin_list_available,
            commands::plugin_install,
            commands::plugin_uninstall,
            commands::plugin_parse_data,
            commands::plugin_get_protocol_parsers,
            commands::plugin_refresh_registry,
            // SSE
            commands::sse_connect,
            commands::sse_disconnect,
            // MQTT
            commands::mqtt_connect,
            commands::mqtt_disconnect,
            commands::mqtt_subscribe,
            commands::mqtt_unsubscribe,
            commands::mqtt_publish,
            // Collection Runner
            commands::run_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
