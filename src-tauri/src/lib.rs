mod http_client;
mod commands;
mod collections;

use commands::AppState;
use collections::CollectionManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let app_data = app.path().app_data_dir()
                .expect("failed to get app data dir");
            let mgr = CollectionManager::new(&app_data);
            app.manage(mgr);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // HTTP
            commands::send_request,
            // Environments
            commands::get_environments,
            commands::get_active_environment,
            commands::set_active_environment,
            commands::get_environment_variables,
            commands::save_environment,
            commands::delete_environment,
            commands::get_global_variables,
            commands::save_global_variables,
            // Collections
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::export_collection,
            commands::import_collection,
            // History
            commands::add_history,
            commands::list_history,
            commands::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
