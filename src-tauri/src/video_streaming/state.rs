use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use serde::{Deserialize, Serialize};

/// 单个流会话
pub struct StreamSession {
    pub session_id: String,
    pub protocol: String,
    pub config: String, // JSON
    pub connected: bool,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

/// 流信息（前端显示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub bitrate: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
}

/// 流事件（通过 Tauri event 推送给前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub session_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    pub timestamp: String,
}

/// 协议报文（通过 Tauri event 推送给前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolMessage {
    pub id: String,
    pub direction: String, // "sent" | "received" | "info"
    pub protocol: String,
    pub summary: String,
    pub detail: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
}

/// 全局视频流状态管理器
pub struct VideoStreamState {
    pub sessions: Arc<Mutex<HashMap<String, StreamSession>>>,
}

impl VideoStreamState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for VideoStreamState {
    fn default() -> Self {
        Self::new()
    }
}
