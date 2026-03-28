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
mod workflow_engine;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use ws_client::WsConnections;
use tcp_client::{TcpConnections, TcpServers, UdpSockets};
use load_test::LoadTestState;
use proxy_capture::ProxyState;
use plugin_runtime::PluginManager;

/// 开发模式：保留 DevTools / Reload / ContextMenu（方便调试）
/// 生产模式：禁用所有浏览器默认行为
#[cfg(debug_assertions)]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;
    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::DEV_TOOLS | Flags::RELOAD | Flags::CONTEXT_MENU))
        .build()
}

#[cfg(all(not(debug_assertions), target_os = "windows"))]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::PlatformOptions;
    tauri_plugin_prevent_default::Builder::new()
        .platform(
            PlatformOptions::new()
                .default_context_menus(false)
                .browser_accelerator_keys(false)
        )
        .build()
}

#[cfg(all(not(debug_assertions), not(target_os = "windows")))]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_prevent_default::Builder::new()
        .with_flags(tauri_plugin_prevent_default::Flags::all())
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(prevent_default())
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

            // ── macOS 系统级菜单 ──
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};

                let check_updates = MenuItemBuilder::with_id("check_for_updates", "Check for Updates…")
                    .build(app)?;

                let help_submenu = SubmenuBuilder::new(app, "Help")
                    .item(&check_updates)
                    .build()?;

                let app_submenu = SubmenuBuilder::new(app, "ProtoForge")
                    .about(None)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .item(&PredefinedMenuItem::hide_others(app, None)?)
                    .item(&PredefinedMenuItem::show_all(app, None)?)
                    .separator()
                    .quit()
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&help_submenu)
                    .build()?;

                app.set_menu(menu)?;

                let handle_menu = app.handle().clone();
                app.on_menu_event(move |_app, event| {
                    if event.id().0 == "check_for_updates" {
                        let _ = handle_menu.emit("check-for-updates", ());
                    }
                });
            }

            // 初始化连接管理器
            app.manage(WsConnections::new());
            app.manage(TcpConnections::new());
            app.manage(TcpServers::new());
            app.manage(UdpSockets::new());
            app.manage(LoadTestState::new());
            app.manage(ProxyState::new());
            app.manage(workflow_engine::WorkflowState::new());

            // SSE / MQTT 连接管理
            app.manage(sse_client::new_connections());
            app.manage(mqtt_client::new_connections());

            // 初始化插件管理器
            let plugin_mgr = PluginManager::new(&app_data);
            let wasm_rt = wasm_runtime::WasmPluginRuntime::new(&app_data);
            let handle2 = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                // ── 预留：内置默认插件注册口 ──
                // 如果将来需要软件自带某些功能插件，在此调用 register_native()。
                // 当前所有插件均通过「插件中心」安装，不预装。

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
                // 检测 IP 地理位置，自动选择最优下载源（中国大陆 → R2 CDN）
                pm.detect_and_set_mirror().await;
                // 预热远程插件注册表缓存（非阻塞，失败不影响启动）
                pm.ensure_remote_cache().await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // HTTP
            commands::send_request,
            commands::send_request_with_scripts,
            commands::run_pre_request_script,
            commands::run_post_response_script,
            commands::save_response_body,
            // OAuth 2.0
            commands::fetch_oauth2_token,
            commands::open_oauth_window,
            // Proxy Browser
            commands::open_proxy_browser,
            commands::close_proxy_browser,
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
            commands::deduplicate_collection_items,
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
            commands::list_history_summary,
            commands::get_history_entry,
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
            commands::ws_is_connected,
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
            // TCP/UDP 活跃连接查询
            commands::tcp_list_connections,
            commands::tcp_list_servers,
            commands::udp_list_sockets,
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
            commands::proxy_install_ca,
            commands::proxy_check_ca_trusted,
            commands::proxy_test_connection,
            // Plugins
            commands::plugin_list,
            commands::plugin_list_available,
            commands::plugin_install,
            commands::plugin_uninstall,
            commands::plugin_parse_data,
            commands::plugin_render_data,
            commands::plugin_get_protocol_parsers,
            commands::plugin_refresh_registry,
            commands::plugin_get_icon,
            commands::plugin_run_hook,
            commands::plugin_run_generator,
            commands::plugin_run_export,
            commands::plugin_run_crypto,
            commands::plugin_list_crypto_algorithms,
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
            // Workflow Engine
            commands::workflow_list,
            commands::workflow_get,
            commands::workflow_create,
            commands::workflow_update,
            commands::workflow_delete,
            commands::workflow_run,
            commands::workflow_cancel,
            // macOS Rounded Corners
            plugins::mac_rounded_corners::enable_rounded_corners,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
