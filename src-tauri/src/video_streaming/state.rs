use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tokio::net::UdpSocket;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use std::sync::atomic::AtomicU32;

/// 单个流会话
#[allow(dead_code)]
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

// ── ONVIF Session ──

#[allow(dead_code)]
pub struct OnvifSession {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub device_service_url: String,
    pub media_service_url: String,
    pub ptz_service_url: String,
    pub use_proxy: bool,
}

// ���─ GB28181 Session ──

#[allow(dead_code)]
pub struct Gb28181Session {
    pub socket: Option<Arc<UdpSocket>>,
    pub sip_server: String,
    pub sip_port: u16,
    pub sip_domain: String,
    pub device_id: String,
    pub local_port: u16,
    pub call_id: String,
    pub cseq: AtomicU32,
    pub transport: String,
}

// ── RTMP Session ──

#[allow(dead_code)]
pub struct RtmpSession {
    pub stream: Option<tokio::net::TcpStream>,
    pub url: String,
    pub handshake_done: bool,
    pub connected: bool,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

// ── SRT Session ──

#[allow(dead_code)]
pub struct SrtSession {
    pub config: String,
    pub connected: bool,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

// ── WebRTC Session ──

#[allow(dead_code)]
pub struct WebRtcSession {
    pub config: String,
    pub connected: bool,
    pub shutdown_tx: Option<oneshot::Sender<()>>,
}

/// 全局视频流状态管理器
pub struct VideoStreamState {
    pub sessions: Arc<Mutex<HashMap<String, StreamSession>>>,
    pub onvif_sessions: Arc<Mutex<HashMap<String, OnvifSession>>>,
    pub gb_sessions: Arc<Mutex<HashMap<String, Gb28181Session>>>,
    pub rtmp_sessions: Arc<Mutex<HashMap<String, RtmpSession>>>,
    pub srt_sessions: Arc<Mutex<HashMap<String, SrtSession>>>,
    pub webrtc_sessions: Arc<Mutex<HashMap<String, WebRtcSession>>>,
}

impl VideoStreamState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            onvif_sessions: Arc::new(Mutex::new(HashMap::new())),
            gb_sessions: Arc::new(Mutex::new(HashMap::new())),
            rtmp_sessions: Arc::new(Mutex::new(HashMap::new())),
            srt_sessions: Arc::new(Mutex::new(HashMap::new())),
            webrtc_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for VideoStreamState {
    fn default() -> Self {
        Self::new()
    }
}
