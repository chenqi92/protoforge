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
mod wasm_runtime;
mod builtin_parsers;
mod plugins;

use tauri::Manager;
use ws_client::WsConnections;
use tcp_client::{TcpConnections, TcpServers, UdpSockets};
use load_test::LoadTestState;
use proxy_capture::ProxyState;
use plugin_runtime::{PluginManager, PluginManifest, PluginType};

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

            // 注册 Tauri 插件 (updater 仅在 release 模式启用)
            #[cfg(not(debug_assertions))]
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
            let wasm_rt = wasm_runtime::WasmPluginRuntime::new(&app_data);
            let handle2 = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                // ── 注册内置 Rust 原生解析器（通过统一插件 API，非硬编码）──
                plugin_mgr.register_native(
                    PluginManifest {
                        id: "hj212-parser".into(),
                        name: "HJ212 协议解析".into(),
                        version: "2.0.0".into(),
                        description: "国标 HJ 212-2017 环保数据传输协议解析器（Rust 原生实现）".into(),
                        author: "ProtoForge 官方".into(),
                        plugin_type: PluginType::ProtocolParser,
                        icon: "🔬".into(),
                        entrypoint: "native".into(),
                        protocol_ids: vec!["hj212".into()],
                        tags: vec!["环保".into(), "HJ212".into()],
                        installed: true,
                        download_url: None,
                        source: "native".into(),
                        contributes: plugin_runtime::PluginContributes {
                            parsers: vec![plugin_runtime::ParserContribution {
                                protocol_id: "hj212".into(),
                                name: "HJ212 协议".into(),
                            }],
                            ..Default::default()
                        },
                    },
                    builtin_parsers::parse_hj212,
                ).await;

                plugin_mgr.register_native(
                    PluginManifest {
                        id: "sfjk200-parser".into(),
                        name: "SFJK200 协议解析".into(),
                        version: "2.0.0".into(),
                        description: "SFJK200 水文监测数据通信协议解析器（Rust 原生实现）".into(),
                        author: "ProtoForge 官方".into(),
                        plugin_type: PluginType::ProtocolParser,
                        icon: "🌊".into(),
                        entrypoint: "native".into(),
                        protocol_ids: vec!["sfjk200".into()],
                        tags: vec!["水文".into(), "SFJK200".into()],
                        installed: true,
                        download_url: None,
                        source: "native".into(),
                        contributes: plugin_runtime::PluginContributes {
                            parsers: vec![plugin_runtime::ParserContribution {
                                protocol_id: "sfjk200".into(),
                                name: "SFJK200 协议".into(),
                            }],
                            ..Default::default()
                        },
                    },
                    builtin_parsers::parse_sfjk200,
                ).await;

                handle2.manage(plugin_mgr);
                handle2.manage(wasm_rt);
            });

            // 非关键初始化移至后台异步任务，避免阻塞应用启动
            let handle3 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 扫描磁盘上的 JS/WASM 插件
                let pm = handle3.state::<PluginManager>();
                if let Err(e) = pm.scan_installed().await {
                    log::warn!("扫描插件目录失败: {}", e);
                }
                // 扫描 WASM 插件
                let wrt = handle3.state::<wasm_runtime::WasmPluginRuntime>();
                let wasm_loaded = wrt.scan_and_load().await;
                if !wasm_loaded.is_empty() {
                    log::info!("已加载 {} 个 WASM 插件", wasm_loaded.len());
                }
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
            commands::reorder_collection_items,
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
            commands::fetch_swagger_group,
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
            commands::export_load_test_report,
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
            // WASM Plugins
            commands::wasm_load_plugin,
            commands::wasm_unload_plugin,
            commands::wasm_parse_data,
            commands::wasm_list_loaded,
            // macOS Rounded Corners
            plugins::mac_rounded_corners::enable_rounded_corners,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
