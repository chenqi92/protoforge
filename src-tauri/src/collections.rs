// 集合管理 + 历史记录
// 基于内存 + JSON 文件持久化

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// 集合中的请求项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRequest {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub query_params: HashMap<String, String>,
    pub body_type: String,
    pub body_content: String,
    pub auth_type: String,
    pub auth_config: serde_json::Value,
    pub pre_script: String,
    pub post_script: String,
}

/// 文件夹
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub items: Vec<CollectionItem>,
}

/// 集合项（请求或文件夹）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollectionItem {
    #[serde(rename = "request")]
    Request(SavedRequest),
    #[serde(rename = "folder")]
    Folder(Folder),
}

/// 集合
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub items: Vec<CollectionItem>,
    pub auth: Option<serde_json::Value>,
    pub pre_script: String,
    pub post_script: String,
    pub variables: HashMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 历史记录条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub body_size: Option<u64>,
    pub timestamp: String,
    pub request_config: serde_json::Value,
    pub response_summary: Option<String>,
}

/// 集合与历史管理器
pub struct CollectionManager {
    data_dir: PathBuf,
    pub collections: Mutex<Vec<Collection>>,
    pub history: Mutex<Vec<HistoryEntry>>,
}

impl CollectionManager {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let data_dir = app_data_dir.join("data");
        let _ = std::fs::create_dir_all(&data_dir);

        let collections = Self::load_json(&data_dir.join("collections.json"))
            .unwrap_or_default();
        let history = Self::load_json(&data_dir.join("history.json"))
            .unwrap_or_default();

        Self {
            data_dir,
            collections: Mutex::new(collections),
            history: Mutex::new(history),
        }
    }

    fn load_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save_collections(&self) -> Result<(), String> {
        let cols = self.collections.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&*cols)
            .map_err(|e| format!("序列化失败: {}", e))?;
        std::fs::write(self.data_dir.join("collections.json"), json)
            .map_err(|e| format!("写入失败: {}", e))
    }

    fn save_history(&self) -> Result<(), String> {
        let hist = self.history.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&*hist)
            .map_err(|e| format!("序列化失败: {}", e))?;
        std::fs::write(self.data_dir.join("history.json"), json)
            .map_err(|e| format!("写入失败: {}", e))
    }

    // ── Collections ──

    pub fn list_collections(&self) -> Result<Vec<Collection>, String> {
        let cols = self.collections.lock().map_err(|e| e.to_string())?;
        Ok(cols.clone())
    }

    pub fn create_collection(&self, col: Collection) -> Result<(), String> {
        let mut cols = self.collections.lock().map_err(|e| e.to_string())?;
        cols.push(col);
        drop(cols);
        self.save_collections()
    }

    pub fn update_collection(&self, col: Collection) -> Result<(), String> {
        let mut cols = self.collections.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = cols.iter_mut().find(|c| c.id == col.id) {
            *existing = col;
        } else {
            return Err("集合不存在".to_string());
        }
        drop(cols);
        self.save_collections()
    }

    pub fn delete_collection(&self, id: &str) -> Result<(), String> {
        let mut cols = self.collections.lock().map_err(|e| e.to_string())?;
        cols.retain(|c| c.id != id);
        drop(cols);
        self.save_collections()
    }

    pub fn export_collection(&self, id: &str) -> Result<String, String> {
        let cols = self.collections.lock().map_err(|e| e.to_string())?;
        let col = cols.iter().find(|c| c.id == id)
            .ok_or_else(|| "集合不存在".to_string())?;
        serde_json::to_string_pretty(col)
            .map_err(|e| format!("导出失败: {}", e))
    }

    pub fn import_collection(&self, json: &str) -> Result<Collection, String> {
        let col: Collection = serde_json::from_str(json)
            .map_err(|e| format!("导入解析失败: {}", e))?;
        self.create_collection(col.clone())?;
        Ok(col)
    }

    // ── History ──

    pub fn add_history(&self, entry: HistoryEntry) -> Result<(), String> {
        let mut hist = self.history.lock().map_err(|e| e.to_string())?;
        hist.insert(0, entry); // 最新的在前面
        if hist.len() > 500 {
            hist.truncate(500); // 最多保留 500 条
        }
        drop(hist);
        self.save_history()
    }

    pub fn list_history(&self, limit: usize) -> Result<Vec<HistoryEntry>, String> {
        let hist = self.history.lock().map_err(|e| e.to_string())?;
        let n = limit.min(hist.len());
        Ok(hist[..n].to_vec())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let mut hist = self.history.lock().map_err(|e| e.to_string())?;
        hist.clear();
        drop(hist);
        self.save_history()
    }

    pub fn delete_history_entry(&self, id: &str) -> Result<(), String> {
        let mut hist = self.history.lock().map_err(|e| e.to_string())?;
        hist.retain(|h| h.id != id);
        drop(hist);
        self.save_history()
    }
}
