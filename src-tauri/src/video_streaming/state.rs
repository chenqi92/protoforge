use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[allow(unused_imports)]
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use tokio::net::UdpSocket;
use tokio::sync::{Mutex, oneshot};

/// 单个流会话
#[allow(dead_code)]
pub struct StreamSession {
    pub generation: u64,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
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
    pub session_id: String,
    pub direction: String, // "sent" | "received" | "info"
    pub protocol: String,
    pub summary: String,
    pub detail: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTagged<'a, T: Serialize> {
    #[serde(flatten)]
    pub payload: &'a T,
    pub generation: u64,
}

impl<'a, T: Serialize> GenerationTagged<'a, T> {
    pub fn new(payload: &'a T, generation: u64) -> Self {
        Self {
            payload,
            generation,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{GenerationTagged, ProtocolMessage, StreamEvent, VideoStreamState};

    #[test]
    fn protocol_message_serializes_session_id_in_camel_case() {
        let message = ProtocolMessage {
            id: "message-1".to_string(),
            session_id: "session-1".to_string(),
            direction: "info".to_string(),
            protocol: "rtsp".to_string(),
            summary: "summary".to_string(),
            detail: "detail".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            size: None,
        };

        let value = serde_json::to_value(message).expect("protocol message should serialize");
        assert_eq!(value["sessionId"], "session-1");
        assert!(value.get("session_id").is_none());
    }

    #[test]
    fn stream_event_and_tagged_payload_serialize_generation_in_camel_case() {
        let event = StreamEvent {
            session_id: "session-1".to_string(),
            generation: Some(7),
            event_type: "connected".to_string(),
            data: None,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        };
        let event_value = serde_json::to_value(event).expect("stream event serialization");
        assert_eq!(event_value["generation"], 7);
        assert_eq!(event_value["sessionId"], "session-1");

        let message = ProtocolMessage {
            id: "message-1".to_string(),
            session_id: "session-1".to_string(),
            direction: "info".to_string(),
            protocol: "rtsp".to_string(),
            summary: "summary".to_string(),
            detail: "detail".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            size: None,
        };
        let tagged = serde_json::to_value(GenerationTagged::new(&message, 7))
            .expect("tagged message serialization");
        assert_eq!(tagged["generation"], 7);
        assert_eq!(tagged["sessionId"], "session-1");
    }

    #[test]
    fn session_generations_are_monotonic() {
        let state = VideoStreamState::new();
        let first = state.next_session_generation();
        let second = state.next_session_generation();

        assert!(second > first);
    }

    #[tokio::test]
    async fn session_operations_are_scoped_per_session_id() {
        let state = VideoStreamState::new();
        let first = state.session_operation("session-a").await;
        let same = state.session_operation("session-a").await;
        let other = state.session_operation("session-b").await;

        assert!(std::sync::Arc::ptr_eq(&first, &same));
        assert!(!std::sync::Arc::ptr_eq(&first, &other));
    }
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

#[derive(Debug, Clone)]
pub struct Gb28181PlaySession {
    pub target_device_id: String,
    pub request_uri: String,
    pub from_header: String,
    pub to_header: String,
    pub call_id: String,
    pub media_port: u16,
}

#[allow(dead_code)]
pub struct Gb28181Session {
    pub socket: Option<Arc<UdpSocket>>,
    pub sip_server: String,
    pub sip_port: u16,
    pub sip_domain: String,
    pub device_id: String,
    pub local_ip: String,
    pub local_port: u16,
    pub call_id: String,
    pub cseq: AtomicU32,
    pub transport: String,
    pub active_play: Option<Gb28181PlaySession>,
}

// ── RTMP Session ──

#[allow(dead_code)]
pub struct RtmpSession {
    pub generation: u64,
    pub stream: Option<tokio::net::TcpStream>,
    pub(crate) decoder: crate::video_streaming::rtmp::RtmpChunkDecoder,
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
    next_session_generation: AtomicU64,
    session_operations: Mutex<HashMap<String, Weak<Mutex<()>>>>,
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
            next_session_generation: AtomicU64::new(1),
            session_operations: Mutex::new(HashMap::new()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            onvif_sessions: Arc::new(Mutex::new(HashMap::new())),
            gb_sessions: Arc::new(Mutex::new(HashMap::new())),
            rtmp_sessions: Arc::new(Mutex::new(HashMap::new())),
            srt_sessions: Arc::new(Mutex::new(HashMap::new())),
            webrtc_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn next_session_generation(&self) -> u64 {
        self.next_session_generation.fetch_add(1, Ordering::Relaxed)
    }

    pub async fn session_operation(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut operations = self.session_operations.lock().await;
        operations.retain(|_, operation| operation.strong_count() > 0);
        if let Some(operation) = operations.get(session_id).and_then(Weak::upgrade) {
            return operation;
        }

        let operation = Arc::new(Mutex::new(()));
        operations.insert(session_id.to_string(), Arc::downgrade(&operation));
        operation
    }
}

impl Default for VideoStreamState {
    fn default() -> Self {
        Self::new()
    }
}
