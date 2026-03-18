// Tauri IPC Commands for HTTP client + Collections + History

use crate::http_client::{self, HttpRequest, HttpResponse};
use crate::collections::{CollectionManager, Collection, HistoryEntry};
use tauri::State;
use std::sync::Mutex;
use std::collections::HashMap;

/// 应用状态：环境变量
pub struct AppState {
    pub environments: Mutex<HashMap<String, HashMap<String, String>>>,
    pub active_environment: Mutex<Option<String>>,
    pub global_variables: Mutex<HashMap<String, String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            environments: Mutex::new(HashMap::new()),
            active_environment: Mutex::new(None),
            global_variables: Mutex::new(HashMap::new()),
        }
    }
}

/// 发送 HTTP 请求
#[tauri::command]
pub async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    http_client::execute_request(request).await
}

/// 获取所有环境列表
#[tauri::command]
pub fn get_environments(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let envs = state.environments.lock().map_err(|e| e.to_string())?;
    Ok(envs.keys().cloned().collect())
}

#[tauri::command]
pub fn get_active_environment(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let active = state.active_environment.lock().map_err(|e| e.to_string())?;
    Ok(active.clone())
}

#[tauri::command]
pub fn set_active_environment(state: State<'_, AppState>, name: Option<String>) -> Result<(), String> {
    let mut active = state.active_environment.lock().map_err(|e| e.to_string())?;
    *active = name;
    Ok(())
}

#[tauri::command]
pub fn get_environment_variables(state: State<'_, AppState>, name: String) -> Result<HashMap<String, String>, String> {
    let envs = state.environments.lock().map_err(|e| e.to_string())?;
    Ok(envs.get(&name).cloned().unwrap_or_default())
}

#[tauri::command]
pub fn save_environment(state: State<'_, AppState>, name: String, variables: HashMap<String, String>) -> Result<(), String> {
    let mut envs = state.environments.lock().map_err(|e| e.to_string())?;
    envs.insert(name, variables);
    Ok(())
}

#[tauri::command]
pub fn delete_environment(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut envs = state.environments.lock().map_err(|e| e.to_string())?;
    envs.remove(&name);
    let mut active = state.active_environment.lock().map_err(|e| e.to_string())?;
    if active.as_deref() == Some(name.as_str()) {
        *active = None;
    }
    Ok(())
}

#[tauri::command]
pub fn get_global_variables(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let vars = state.global_variables.lock().map_err(|e| e.to_string())?;
    Ok(vars.clone())
}

#[tauri::command]
pub fn save_global_variables(state: State<'_, AppState>, variables: HashMap<String, String>) -> Result<(), String> {
    let mut vars = state.global_variables.lock().map_err(|e| e.to_string())?;
    *vars = variables;
    Ok(())
}

// ── Collections ──

#[tauri::command]
pub fn list_collections(mgr: State<'_, CollectionManager>) -> Result<Vec<Collection>, String> {
    mgr.list_collections()
}

#[tauri::command]
pub fn create_collection(mgr: State<'_, CollectionManager>, collection: Collection) -> Result<(), String> {
    mgr.create_collection(collection)
}

#[tauri::command]
pub fn update_collection(mgr: State<'_, CollectionManager>, collection: Collection) -> Result<(), String> {
    mgr.update_collection(collection)
}

#[tauri::command]
pub fn delete_collection(mgr: State<'_, CollectionManager>, id: String) -> Result<(), String> {
    mgr.delete_collection(&id)
}

#[tauri::command]
pub fn export_collection(mgr: State<'_, CollectionManager>, id: String) -> Result<String, String> {
    mgr.export_collection(&id)
}

#[tauri::command]
pub fn import_collection(mgr: State<'_, CollectionManager>, json: String) -> Result<Collection, String> {
    mgr.import_collection(&json)
}

// ── History ──

#[tauri::command]
pub fn add_history(mgr: State<'_, CollectionManager>, entry: HistoryEntry) -> Result<(), String> {
    mgr.add_history(entry)
}

#[tauri::command]
pub fn list_history(mgr: State<'_, CollectionManager>, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    mgr.list_history(limit)
}

#[tauri::command]
pub fn clear_history(mgr: State<'_, CollectionManager>) -> Result<(), String> {
    mgr.clear_history()
}
