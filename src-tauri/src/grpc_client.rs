// ProtoForge gRPC 客户端引擎
// 支持 Proto 文件解析、gRPC Reflection、Unary / Server-Streaming 调用

use bytes::{Buf, BufMut, Bytes, BytesMut};
use futures_util::{StreamExt, stream};
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, MethodDescriptor};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::{Mutex, Semaphore, mpsc, oneshot, watch};
use tonic::Status;
use tonic::codec::{Codec, Decoder, Encoder};
use tonic::transport::Channel;

// ══════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════

pub type GrpcConnections = Arc<Mutex<HashMap<String, GrpcHandle>>>;

pub fn new_connections() -> GrpcConnections {
    Arc::new(Mutex::new(HashMap::new()))
}

pub(crate) struct GrpcHandle {
    generation: u64,
    cancel: watch::Sender<bool>,
    /// Message sender for client-streaming / bidi-streaming
    msg_sender: Option<mpsc::Sender<Bytes>>,
    /// Keep the active stream's input schema alive even if its cache entry is evicted.
    input_descriptor: Option<MessageDescriptor>,
}

static NEXT_STREAM_GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_stream_generation() -> u64 {
    NEXT_STREAM_GENERATION.fetch_add(1, Ordering::Relaxed)
}

async fn register_stream(
    connections: &GrpcConnections,
    connection_id: &str,
    msg_sender: Option<mpsc::Sender<Bytes>>,
    input_descriptor: Option<MessageDescriptor>,
) -> (u64, watch::Receiver<bool>) {
    let generation = next_stream_generation();
    let (cancel, cancel_rx) = watch::channel(false);
    let previous = connections.lock().await.insert(
        connection_id.to_string(),
        GrpcHandle {
            generation,
            cancel,
            msg_sender,
            input_descriptor,
        },
    );

    // A same-ID start is a replacement. Wake the old transport after the new
    // generation is visible so its cleanup can never remove the replacement.
    if let Some(previous) = previous {
        let _ = previous.cancel.send(true);
    }

    (generation, cancel_rx)
}

async fn remove_stream_if_generation(
    connections: &GrpcConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    let mut connections = connections.lock().await;
    if connections
        .get(connection_id)
        .is_some_and(|handle| handle.generation == generation)
    {
        connections.remove(connection_id);
        true
    } else {
        false
    }
}

async fn emit_if_current(
    app: &tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    generation: u64,
    event: GrpcStreamEvent,
) -> bool {
    let connections = connections.lock().await;
    if connections
        .get(connection_id)
        .is_some_and(|handle| handle.generation == generation)
    {
        let _ = app.emit("grpc-stream-event", event);
        true
    } else {
        false
    }
}

async fn finish_stream_if_current(
    app: &tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    generation: u64,
    event: GrpcStreamEvent,
) -> bool {
    let mut connections = connections.lock().await;
    if connections
        .get(connection_id)
        .is_some_and(|handle| handle.generation == generation)
    {
        connections.remove(connection_id);
        // Emit while holding the registry lock. A replacement cannot become
        // visible between removing the old entry and its terminal event.
        let _ = app.emit("grpc-stream-event", event);
        true
    } else {
        false
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StreamCancelled;

async fn await_stream_or_cancel<F, T>(
    cancel: &mut watch::Receiver<bool>,
    future: F,
) -> Result<T, StreamCancelled>
where
    F: std::future::Future<Output = T>,
{
    if *cancel.borrow() {
        return Err(StreamCancelled);
    }

    tokio::select! {
        biased;
        _ = cancel.changed() => Err(StreamCancelled),
        result = future => Ok(result),
    }
}

/// gRPC 方法类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrpcMethodKind {
    Unary,
    ServerStreaming,
    ClientStreaming,
    BidiStreaming,
}

/// 描述一个 gRPC 方法
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethodInfo {
    pub name: String,
    pub full_name: String,
    pub input_type: String,
    pub output_type: String,
    pub kind: GrpcMethodKind,
    /// JSON schema hint for the input message (field names + types)
    pub input_fields: Vec<GrpcFieldInfo>,
}

/// 描述一个 protobuf 字段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcFieldInfo {
    pub name: String,
    pub json_name: String,
    pub field_type: String,
    pub is_repeated: bool,
    pub is_map: bool,
    pub is_optional: bool,
}

/// 描述一个 gRPC 服务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcServiceInfo {
    pub name: String,
    pub full_name: String,
    pub methods: Vec<GrpcMethodInfo>,
}

/// 加载 proto 文件后的结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoLoadResult {
    pub services: Vec<GrpcServiceInfo>,
    pub file_name: String,
}

/// Unary 调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallResult {
    pub response_json: String,
    pub status_code: i32,
    pub status_message: String,
    pub duration_ms: u64,
    pub response_metadata: HashMap<String, String>,
}

/// Streaming 事件（发给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamEvent {
    pub connection_id: String,
    pub generation: u64,
    pub event_type: String, // "data" | "completed" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    /// Number of data events discarded by the bounded backend queue since the
    /// previous emitted event. A terminal event reports any remaining drops.
    pub dropped_count: u64,
    pub timestamp: String,
}

fn stream_event(
    connection_id: &str,
    generation: u64,
    event_type: &str,
    data: Option<String>,
    status_code: Option<i32>,
    status_message: Option<String>,
) -> GrpcStreamEvent {
    bound_stream_event(GrpcStreamEvent {
        connection_id: connection_id.to_string(),
        generation,
        event_type: event_type.to_string(),
        data,
        status_code,
        status_message,
        dropped_count: 0,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

const MAX_STREAM_EVENT_SERIALIZED_BYTES: usize = 64 * 1024;
const MAX_STREAM_CONNECTION_ID_BYTES: usize = 4 * 1024;
const MAX_STREAM_EVENT_DATA_BYTES: usize = 48 * 1024;
const MAX_STREAM_EVENT_STATUS_BYTES: usize = 4 * 1024;
const STREAM_EVENT_QUEUE_CAPACITY: usize = 32;
const MAX_STREAM_EVENTS_PER_SECOND: usize = 30;
const MAX_STREAM_EMIT_BYTES_PER_SECOND: usize = 512 * 1024;
const STREAM_EMIT_WINDOW: Duration = Duration::from_secs(1);
const STREAM_TRUNCATED_SUFFIX: &str = "\n… [backend preview truncated]";

fn validate_stream_connection_id(connection_id: &str) -> Result<(), String> {
    if connection_id.is_empty() {
        return Err("gRPC 流连接 ID 不能为空".to_string());
    }
    if connection_id.len() > MAX_STREAM_CONNECTION_ID_BYTES {
        return Err(format!(
            "gRPC 流连接 ID 过长：{} 字节，上限为 {MAX_STREAM_CONNECTION_ID_BYTES} 字节",
            connection_id.len()
        ));
    }
    Ok(())
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    if max_bytes == 0 {
        return String::new();
    }

    let suffix = if STREAM_TRUNCATED_SUFFIX.len() <= max_bytes {
        STREAM_TRUNCATED_SUFFIX
    } else {
        ""
    };
    let mut end = max_bytes.saturating_sub(suffix.len()).min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut output = String::with_capacity(end + suffix.len());
    output.push_str(&value[..end]);
    output.push_str(suffix);
    output
}

fn serialized_stream_event_bytes(event: &GrpcStreamEvent) -> usize {
    serde_json::to_vec(event)
        .map(|bytes| bytes.len())
        .unwrap_or(MAX_STREAM_EVENT_SERIALIZED_BYTES)
}

fn bound_stream_event(mut event: GrpcStreamEvent) -> GrpcStreamEvent {
    event.data = event
        .data
        .take()
        .map(|value| truncate_utf8(&value, MAX_STREAM_EVENT_DATA_BYTES));
    event.status_message = event
        .status_message
        .take()
        .map(|value| truncate_utf8(&value, MAX_STREAM_EVENT_STATUS_BYTES));

    // Escaping control characters can make serialized JSON larger than the
    // source strings. Re-check the actual payload that Tauri will fan out and
    // shrink the largest text field until it is inside the hard bound.
    while serialized_stream_event_bytes(&event) > MAX_STREAM_EVENT_SERIALIZED_BYTES {
        let data_len = event.data.as_ref().map_or(0, String::len);
        let status_len = event.status_message.as_ref().map_or(0, String::len);
        if data_len == 0 && status_len == 0 {
            break;
        }
        if data_len >= status_len && data_len > 0 {
            event.data = event
                .data
                .take()
                .map(|value| truncate_utf8(&value, data_len / 2));
        } else {
            event.status_message = event
                .status_message
                .take()
                .map(|value| truncate_utf8(&value, status_len / 2));
        }
    }
    event
}

struct QueuedStreamEvent {
    event: GrpcStreamEvent,
    terminal: bool,
    acknowledgement: Option<oneshot::Sender<bool>>,
}

#[derive(Clone)]
struct StreamEventSink {
    sender: mpsc::Sender<QueuedStreamEvent>,
    dropped: Arc<AtomicU64>,
}

impl StreamEventSink {
    fn spawn(
        app: tauri::AppHandle,
        connections: GrpcConnections,
        connection_id: String,
        generation: u64,
        mut cancel: watch::Receiver<bool>,
    ) -> Self {
        let (sender, mut receiver) =
            mpsc::channel::<QueuedStreamEvent>(STREAM_EVENT_QUEUE_CAPACITY);
        let dropped = Arc::new(AtomicU64::new(0));
        let dispatcher_dropped = dropped.clone();

        tokio::spawn(async move {
            let mut limiter = StreamEmitRateLimiter::new(
                MAX_STREAM_EVENTS_PER_SECOND,
                MAX_STREAM_EMIT_BYTES_PER_SECOND,
                STREAM_EMIT_WINDOW,
            );
            loop {
                let queued = tokio::select! {
                    biased;
                    _ = cancel.changed() => break,
                    queued = receiver.recv() => match queued {
                        Some(queued) => queued,
                        None => break,
                    },
                };

                let mut event = queued.event;
                event.dropped_count = event
                    .dropped_count
                    .saturating_add(dispatcher_dropped.swap(0, Ordering::Relaxed));
                event = bound_stream_event(event);
                let event_bytes = serialized_stream_event_bytes(&event);
                if !limiter.wait_for_capacity(event_bytes, &mut cancel).await {
                    if let Some(acknowledgement) = queued.acknowledgement {
                        let _ = acknowledgement.send(false);
                    }
                    break;
                }

                let emitted = if queued.terminal {
                    finish_stream_if_current(&app, &connections, &connection_id, generation, event)
                        .await
                } else {
                    emit_if_current(&app, &connections, &connection_id, generation, event).await
                };

                if let Some(acknowledgement) = queued.acknowledgement {
                    let _ = acknowledgement.send(emitted);
                }
                if !emitted || queued.terminal {
                    break;
                }
            }
        });

        Self { sender, dropped }
    }

    fn try_emit(&self, event: GrpcStreamEvent) -> bool {
        match self.sender.try_send(QueuedStreamEvent {
            event: bound_stream_event(event),
            terminal: false,
            acknowledgement: None,
        }) {
            Ok(()) => true,
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                false
            }
            Err(mpsc::error::TrySendError::Closed(_)) => false,
        }
    }

    async fn finish(&self, event: GrpcStreamEvent) -> bool {
        let (acknowledgement, received) = oneshot::channel();
        if self
            .sender
            .send(QueuedStreamEvent {
                event: bound_stream_event(event),
                terminal: true,
                acknowledgement: Some(acknowledgement),
            })
            .await
            .is_err()
        {
            return false;
        }
        received.await.unwrap_or(false)
    }
}

struct StreamEmitRateLimiter {
    max_events: usize,
    max_bytes: usize,
    window: Duration,
    window_started: Instant,
    emitted_events: usize,
    emitted_bytes: usize,
}

impl StreamEmitRateLimiter {
    fn new(max_events: usize, max_bytes: usize, window: Duration) -> Self {
        Self {
            max_events,
            max_bytes,
            window,
            window_started: Instant::now(),
            emitted_events: 0,
            emitted_bytes: 0,
        }
    }

    fn capacity_delay(&mut self, bytes: usize, now: Instant) -> Option<Duration> {
        let elapsed = now.saturating_duration_since(self.window_started);
        if elapsed >= self.window {
            self.window_started = now;
            self.emitted_events = 0;
            self.emitted_bytes = 0;
        }
        if self.emitted_events < self.max_events
            && self
                .emitted_bytes
                .checked_add(bytes)
                .is_some_and(|total| total <= self.max_bytes)
        {
            self.emitted_events += 1;
            self.emitted_bytes += bytes;
            None
        } else {
            Some(self.window.saturating_sub(elapsed))
        }
    }

    async fn wait_for_capacity(
        &mut self,
        bytes: usize,
        cancel: &mut watch::Receiver<bool>,
    ) -> bool {
        loop {
            let Some(delay) = self.capacity_delay(bytes, Instant::now()) else {
                return true;
            };
            tokio::select! {
                biased;
                _ = cancel.changed() => return false,
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }
}

fn decode_stream_message(message: &MessageDescriptor, bytes: Bytes) -> String {
    match DynamicMessage::decode(message.clone(), bytes) {
        Ok(message) => serde_json::to_string_pretty(&message).unwrap_or_default(),
        Err(error) => format!("{{\"error\": \"解码失败: {error}\"}}"),
    }
}

// ══════════════════════════════════════════════
//  Raw bytes codec for dynamic gRPC
// ══════════════════════════════════════════════

#[derive(Debug, Clone)]
struct RawBytesCodec;

impl Codec for RawBytesCodec {
    type Encode = Bytes;
    type Decode = Bytes;
    type Encoder = RawBytesEncoder;
    type Decoder = RawBytesDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        RawBytesEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        RawBytesDecoder
    }
}

#[derive(Debug, Clone)]
struct RawBytesEncoder;

impl Encoder for RawBytesEncoder {
    type Item = Bytes;
    type Error = Status;

    fn encode(
        &mut self,
        item: Self::Item,
        dst: &mut tonic::codec::EncodeBuf<'_>,
    ) -> Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct RawBytesDecoder;

impl Decoder for RawBytesDecoder {
    type Item = Bytes;
    type Error = Status;

    fn decode(
        &mut self,
        src: &mut tonic::codec::DecodeBuf<'_>,
    ) -> Result<Option<Self::Item>, Self::Error> {
        let remaining = src.remaining();
        if remaining == 0 {
            return Ok(None);
        }
        let mut buf = BytesMut::with_capacity(remaining);
        buf.put(src.take(remaining));
        Ok(Some(buf.freeze()))
    }
}

// ══════════════════════════════════════════════
//  Descriptor pool cache (global, keyed by path)
// ══════════════════════════════════════════════

const MAX_PROTO_CONTENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROTO_SOURCE_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROTO_SOURCE_FILES: usize = 256;
const MAX_PROTO_SOURCE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_PROTO_IMPORT_NAME_BYTES: usize = 1024;
const PROTO_COMPILE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONCURRENT_PROTO_COMPILES: usize = 2;
const MAX_DESCRIPTOR_KEY_BYTES: usize = 4 * 1024;
const MAX_DESCRIPTOR_CACHE_ENTRIES: usize = 32;
const MAX_DESCRIPTOR_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_DESCRIPTOR_ENTRY_BYTES: usize = 8 * 1024 * 1024;

const REFLECTION_TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
const REFLECTION_CALL_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_REFLECTION_SERVICES: usize = 256;
const MAX_REFLECTION_SERVICE_NAME_BYTES: usize = 512;
const MAX_REFLECTION_SERVICE_BYTES: usize = 64 * 1024;
const MAX_REFLECTION_FANOUT: usize = 8;
const MAX_REFLECTION_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REFLECTION_DESCRIPTOR_BYTES: usize = 8 * 1024 * 1024;
const MAX_REFLECTION_DESCRIPTOR_COUNT: usize = 1024;
const MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES: usize = 1024 * 1024;

static PROTO_COMPILE_SLOTS: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(MAX_CONCURRENT_PROTO_COMPILES)));

struct DescriptorPoolEntry {
    pool: DescriptorPool,
    bytes: usize,
    last_used: u64,
}

struct DescriptorPoolCache {
    entries: HashMap<String, DescriptorPoolEntry>,
    total_bytes: usize,
    clock: u64,
    max_entries: usize,
    max_bytes: usize,
    max_entry_bytes: usize,
}

impl DescriptorPoolCache {
    fn new(max_entries: usize, max_bytes: usize, max_entry_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            total_bytes: 0,
            clock: 0,
            max_entries,
            max_bytes,
            max_entry_bytes,
        }
    }

    fn get(&mut self, key: &str) -> Option<DescriptorPool> {
        self.clock = self.clock.saturating_add(1);
        let last_used = self.clock;
        self.entries.get_mut(key).map(|entry| {
            entry.last_used = last_used;
            entry.pool.clone()
        })
    }

    fn insert(&mut self, key: String, pool: DescriptorPool, bytes: usize) -> Result<(), String> {
        let bytes = bytes.max(1);
        if self.max_entries == 0 || self.max_bytes == 0 {
            return Err("Proto 描述符缓存已禁用".to_string());
        }
        if bytes > self.max_entry_bytes || bytes > self.max_bytes {
            return Err(format!(
                "Proto 描述符过大：{bytes} 字节，单条上限为 {} 字节",
                self.max_entry_bytes.min(self.max_bytes)
            ));
        }

        if let Some(previous) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(previous.bytes);
        }

        while self.entries.len() >= self.max_entries
            || self
                .total_bytes
                .checked_add(bytes)
                .is_none_or(|total| total > self.max_bytes)
        {
            let Some(lru_key) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone())
            else {
                return Err("Proto 描述符缓存容量不足".to_string());
            };
            if let Some(evicted) = self.entries.remove(&lru_key) {
                self.total_bytes = self.total_bytes.saturating_sub(evicted.bytes);
            }
        }

        self.clock = self.clock.saturating_add(1);
        self.total_bytes = self
            .total_bytes
            .checked_add(bytes)
            .ok_or("Proto 描述符缓存大小溢出")?;
        self.entries.insert(
            key,
            DescriptorPoolEntry {
                pool,
                bytes,
                last_used: self.clock,
            },
        );
        Ok(())
    }
}

static DESCRIPTOR_POOLS: std::sync::LazyLock<Mutex<DescriptorPoolCache>> =
    std::sync::LazyLock::new(|| {
        Mutex::new(DescriptorPoolCache::new(
            MAX_DESCRIPTOR_CACHE_ENTRIES,
            MAX_DESCRIPTOR_CACHE_BYTES,
            MAX_DESCRIPTOR_ENTRY_BYTES,
        ))
    });

fn validate_descriptor_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Proto 缓存键不能为空".to_string());
    }
    if key.len() > MAX_DESCRIPTOR_KEY_BYTES {
        return Err(format!(
            "Proto 缓存键过长：{} 字节，上限为 {MAX_DESCRIPTOR_KEY_BYTES} 字节",
            key.len()
        ));
    }
    Ok(())
}

async fn get_descriptor_pool(key: &str) -> Option<DescriptorPool> {
    DESCRIPTOR_POOLS.lock().await.get(key)
}

async fn cache_descriptor_pool(
    key: String,
    pool: DescriptorPool,
    descriptor_bytes: usize,
) -> Result<(), String> {
    validate_descriptor_key(&key)?;
    DESCRIPTOR_POOLS
        .lock()
        .await
        .insert(key, pool, descriptor_bytes)
}

// ══════════════════════════════════════════════
//  Proto file loading
// ══════════════════════════════════════════════

struct CompiledProto {
    pool: DescriptorPool,
    services: Vec<GrpcServiceInfo>,
    file_name: String,
    descriptor_bytes: usize,
}

struct TempProtoWorkspace {
    dir: PathBuf,
    input: PathBuf,
}

impl TempProtoWorkspace {
    fn create() -> Result<Self, String> {
        let temp_root = std::env::temp_dir();
        for _ in 0..4 {
            let dir = temp_root.join(format!("protoforge-proto-{}", uuid::Uuid::new_v4()));
            match std::fs::create_dir(&dir) {
                Ok(()) => {
                    let input = dir.join("input.proto");
                    return Ok(Self { dir, input });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("创建临时 Proto 目录失败: {error}")),
            }
        }
        Err("无法分配唯一的临时 Proto 目录".to_string())
    }
}

impl Drop for TempProtoWorkspace {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.dir) {
            log::warn!(
                "failed to remove temporary proto workspace {}: {error}",
                self.dir.display()
            );
        }
    }
}

#[derive(Clone, Copy)]
struct ProtoCompileLimits {
    max_file_bytes: usize,
    max_files: usize,
    max_total_bytes: usize,
}

impl Default for ProtoCompileLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: MAX_PROTO_SOURCE_FILE_BYTES,
            max_files: MAX_PROTO_SOURCE_FILES,
            max_total_bytes: MAX_PROTO_SOURCE_TOTAL_BYTES,
        }
    }
}

#[derive(Default)]
struct ProtoSourceBudget {
    seen: HashSet<String>,
    total_bytes: usize,
}

impl ProtoSourceBudget {
    fn reserve(
        &mut self,
        name: &str,
        bytes: usize,
        limits: ProtoCompileLimits,
    ) -> Result<(), String> {
        if self.seen.contains(name) {
            return Ok(());
        }
        if bytes > limits.max_file_bytes {
            return Err(format!(
                "Proto 源文件 {name} 过大：{bytes} 字节，上限为 {} 字节",
                limits.max_file_bytes
            ));
        }
        if self.seen.len() >= limits.max_files {
            return Err(format!("Proto 源文件数量超过 {} 个", limits.max_files));
        }
        let total_bytes = self
            .total_bytes
            .checked_add(bytes)
            .ok_or("Proto 源文件总大小溢出")?;
        if total_bytes > limits.max_total_bytes {
            return Err(format!(
                "Proto 源文件总大小超过 {} 字节",
                limits.max_total_bytes
            ));
        }
        self.seen.insert(name.to_string());
        self.total_bytes = total_bytes;
        Ok(())
    }
}

struct LimitedProtoResolver {
    include_dir: PathBuf,
    include: protox::file::IncludeFileResolver,
    google: protox::file::GoogleFileResolver,
    budget: Arc<std::sync::Mutex<ProtoSourceBudget>>,
    deadline: Instant,
    limits: ProtoCompileLimits,
}

impl LimitedProtoResolver {
    fn new(include_dir: PathBuf, deadline: Instant, limits: ProtoCompileLimits) -> Self {
        Self {
            include: protox::file::IncludeFileResolver::new(include_dir.clone()),
            include_dir,
            google: protox::file::GoogleFileResolver::new(),
            budget: Arc::new(std::sync::Mutex::new(ProtoSourceBudget::default())),
            deadline,
            limits,
        }
    }

    fn ensure_within_deadline(&self) -> Result<(), protox::Error> {
        if Instant::now() >= self.deadline {
            Err(proto_resolver_error("Proto 编译超过耗时限制"))
        } else {
            Ok(())
        }
    }

    fn validate_name(&self, name: &str) -> Result<(), protox::Error> {
        if name.is_empty() || name.len() > MAX_PROTO_IMPORT_NAME_BYTES {
            return Err(proto_resolver_error(format!(
                "Proto 导入路径长度无效，上限为 {MAX_PROTO_IMPORT_NAME_BYTES} 字节"
            )));
        }
        if Path::new(name)
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err(proto_resolver_error(format!(
                "Proto 导入路径不安全: {name}"
            )));
        }
        Ok(())
    }

    fn reserve(&self, name: &str, bytes: usize) -> Result<(), protox::Error> {
        self.budget
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .reserve(name, bytes, self.limits)
            .map_err(proto_resolver_error)
    }

    fn open_local_file(
        &self,
        name: &str,
        path: &Path,
    ) -> Result<protox::file::File, protox::Error> {
        let file = std::fs::File::open(path).map_err(proto_resolver_error)?;
        let metadata = file.metadata().map_err(proto_resolver_error)?;
        let metadata_bytes = usize::try_from(metadata.len())
            .map_err(|_| proto_resolver_error(format!("Proto 源文件 {name} 的大小无法表示")))?;
        self.reserve(name, metadata_bytes)?;
        self.ensure_within_deadline()?;

        let read_limit = u64::try_from(self.limits.max_file_bytes)
            .unwrap_or(u64::MAX)
            .saturating_add(1);
        let mut source = String::with_capacity(metadata_bytes.min(self.limits.max_file_bytes));
        file.take(read_limit)
            .read_to_string(&mut source)
            .map_err(proto_resolver_error)?;
        if source.len() > self.limits.max_file_bytes {
            return Err(proto_resolver_error(format!(
                "Proto 源文件 {name} 过大：上限为 {} 字节",
                self.limits.max_file_bytes
            )));
        }
        // A concurrently growing file may exceed the metadata reservation.
        // Reserve the observed delta before handing any text to the parser.
        if source.len() > metadata_bytes {
            let mut budget = self
                .budget
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let extra = source.len() - metadata_bytes;
            let total = budget
                .total_bytes
                .checked_add(extra)
                .ok_or_else(|| proto_resolver_error("Proto 源文件总大小溢出"))?;
            if total > self.limits.max_total_bytes {
                return Err(proto_resolver_error(format!(
                    "Proto 源文件总大小超过 {} 字节",
                    self.limits.max_total_bytes
                )));
            }
            budget.total_bytes = total;
        }
        self.ensure_within_deadline()?;
        let parsed = protox::file::File::from_source(name, &source)?;
        self.ensure_within_deadline()?;
        Ok(parsed)
    }
}

impl protox::file::FileResolver for LimitedProtoResolver {
    fn resolve_path(&self, path: &Path) -> Option<String> {
        protox::file::FileResolver::resolve_path(&self.include, path)
    }

    fn open_file(&self, name: &str) -> Result<protox::file::File, protox::Error> {
        self.ensure_within_deadline()?;
        self.validate_name(name)?;
        let path = self.include_dir.join(name);
        match std::fs::metadata(&path) {
            Ok(_) => self.open_local_file(name, &path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let file = protox::file::FileResolver::open_file(&self.google, name)?;
                let bytes = file
                    .source()
                    .map(str::len)
                    .unwrap_or_else(|| file.file_descriptor_proto().encoded_len());
                self.reserve(name, bytes)?;
                self.ensure_within_deadline()?;
                Ok(file)
            }
            Err(error) => Err(proto_resolver_error(error)),
        }
    }
}

#[derive(Debug)]
struct ProtoResolverError(String);

impl std::fmt::Display for ProtoResolverError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ProtoResolverError {}

fn proto_resolver_error(error: impl std::fmt::Display) -> protox::Error {
    protox::Error::new(ProtoResolverError(error.to_string()))
}

fn compile_proto_with_limits(
    path: &Path,
    include_dir: &Path,
    deadline: Instant,
) -> Result<prost_types::FileDescriptorSet, String> {
    let resolver = LimitedProtoResolver::new(
        include_dir.to_path_buf(),
        deadline,
        ProtoCompileLimits::default(),
    );
    let mut compiler = protox::Compiler::with_file_resolver(resolver);
    compiler
        .include_source_info(false)
        .include_imports(true)
        .open_file(path)
        .map_err(|error| format!("Proto 编译失败: {error}"))?;
    if Instant::now() >= deadline {
        return Err("Proto 编译超过耗时限制".to_string());
    }
    Ok(compiler.file_descriptor_set())
}

fn build_compiled_proto(
    fds: prost_types::FileDescriptorSet,
    file_name: String,
) -> Result<CompiledProto, String> {
    let descriptor_bytes = fds.encoded_len();
    if descriptor_bytes > MAX_DESCRIPTOR_ENTRY_BYTES {
        return Err(format!(
            "Proto 描述符过大：{descriptor_bytes} 字节，上限为 {MAX_DESCRIPTOR_ENTRY_BYTES} 字节"
        ));
    }
    let pool = DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|error| format!("描述符池构建失败: {error}"))?;
    let services = build_service_infos(&pool);
    Ok(CompiledProto {
        pool,
        services,
        file_name,
        descriptor_bytes,
    })
}

fn compile_proto_file_blocking(
    proto_path: String,
    deadline: Instant,
) -> Result<CompiledProto, String> {
    let path = Path::new(&proto_path);
    if !path.exists() {
        return Err(format!("Proto 文件不存在: {proto_path}"));
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let include_dir = path.parent().unwrap_or(Path::new("."));
    let fds = compile_proto_with_limits(path, include_dir, deadline)?;
    build_compiled_proto(fds, file_name)
}

fn compile_proto_content_blocking(
    content: String,
    deadline: Instant,
) -> Result<CompiledProto, String> {
    let workspace = TempProtoWorkspace::create()?;
    std::fs::write(&workspace.input, content)
        .map_err(|error| format!("写入临时 Proto 文件失败: {error}"))?;

    let fds = compile_proto_with_limits(&workspace.input, &workspace.dir, deadline)?;
    build_compiled_proto(fds, "input.proto".to_string())
}

async fn run_proto_compile<F>(compile: F) -> Result<CompiledProto, String>
where
    F: FnOnce(Instant) -> Result<CompiledProto, String> + Send + 'static,
{
    let permit = tokio::time::timeout(
        PROTO_COMPILE_TIMEOUT,
        PROTO_COMPILE_SLOTS.clone().acquire_owned(),
    )
    .await
    .map_err(|_| "等待 Proto 编译槽位超时".to_string())?
    .map_err(|_| "Proto 编译器已关闭".to_string())?;
    let deadline = Instant::now() + PROTO_COMPILE_TIMEOUT;
    let task = tokio::task::spawn_blocking(move || {
        // Keep the permit in the blocking task. A timed-out task therefore
        // cannot allow an unbounded pile-up of detached compiler threads.
        let _permit = permit;
        compile(deadline)
    });
    tokio::time::timeout(PROTO_COMPILE_TIMEOUT, task)
        .await
        .map_err(|_| format!("Proto 编译超过 {} 秒", PROTO_COMPILE_TIMEOUT.as_secs()))?
        .map_err(|error| format!("Proto 编译任务失败: {error}"))?
}

/// Load and compile a .proto file, returning service/method descriptors
pub async fn load_proto_file(proto_path: &str) -> Result<ProtoLoadResult, String> {
    validate_descriptor_key(proto_path)?;
    let proto_path_owned = proto_path.to_string();
    let compiled =
        run_proto_compile(move |deadline| compile_proto_file_blocking(proto_path_owned, deadline))
            .await?;

    cache_descriptor_pool(
        proto_path.to_string(),
        compiled.pool,
        compiled.descriptor_bytes,
    )
    .await?;

    Ok(ProtoLoadResult {
        services: compiled.services,
        file_name: compiled.file_name,
    })
}

/// Load from raw proto content string (for pasted definitions)
pub async fn load_proto_content(content: &str, key: &str) -> Result<ProtoLoadResult, String> {
    validate_descriptor_key(key)?;
    if content.len() > MAX_PROTO_CONTENT_BYTES {
        return Err(format!(
            "Proto 内容过大：{} 字节，上限为 {MAX_PROTO_CONTENT_BYTES} 字节",
            content.len()
        ));
    }

    let content_owned = content.to_string();
    let compiled =
        run_proto_compile(move |deadline| compile_proto_content_blocking(content_owned, deadline))
            .await?;

    cache_descriptor_pool(key.to_string(), compiled.pool, compiled.descriptor_bytes).await?;

    Ok(ProtoLoadResult {
        services: compiled.services,
        file_name: compiled.file_name,
    })
}

// ══════════════════════════════════════════════
//  gRPC Reflection
// ══════════════════════════════════════════════

/// Use gRPC server reflection to discover services
pub async fn reflect_services(url: &str, tls_enabled: bool) -> Result<ProtoLoadResult, String> {
    tokio::time::timeout(
        REFLECTION_TOTAL_TIMEOUT,
        reflect_services_inner(url, tls_enabled),
    )
    .await
    .map_err(|_| {
        format!(
            "Reflection 总耗时超过 {} 秒",
            REFLECTION_TOTAL_TIMEOUT.as_secs()
        )
    })?
}

struct ReflectionDescriptorAccumulator {
    descriptor_set: prost_types::FileDescriptorSet,
    names: HashSet<String>,
    processed_bytes: usize,
    processed_count: usize,
}

impl ReflectionDescriptorAccumulator {
    fn new() -> Self {
        Self {
            descriptor_set: prost_types::FileDescriptorSet { file: Vec::new() },
            names: HashSet::new(),
            processed_bytes: 0,
            processed_count: 0,
        }
    }

    fn push(&mut self, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.len() > MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES {
            return Err(format!(
                "Reflection 单个描述符超过 {MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES} 字节"
            ));
        }
        self.processed_count = self
            .processed_count
            .checked_add(1)
            .ok_or("Reflection 描述符数量溢出")?;
        if self.processed_count > MAX_REFLECTION_DESCRIPTOR_COUNT {
            return Err(format!(
                "Reflection 描述符数量超过 {MAX_REFLECTION_DESCRIPTOR_COUNT}"
            ));
        }
        self.processed_bytes = self
            .processed_bytes
            .checked_add(bytes.len())
            .ok_or("Reflection 描述符总大小溢出")?;
        if self.processed_bytes > MAX_REFLECTION_DESCRIPTOR_BYTES {
            return Err(format!(
                "Reflection 描述符总大小超过 {MAX_REFLECTION_DESCRIPTOR_BYTES} 字节"
            ));
        }

        let descriptor = prost_types::FileDescriptorProto::decode(bytes.as_slice())
            .map_err(|error| format!("Reflection 描述符解码失败: {error}"))?;
        let name = descriptor
            .name
            .as_deref()
            .filter(|name| !name.is_empty())
            .ok_or("Reflection 返回了无文件名的描述符")?
            .to_string();
        if self.names.insert(name) {
            self.descriptor_set.file.push(descriptor);
        }
        Ok(())
    }
}

async fn reflect_services_inner(url: &str, tls_enabled: bool) -> Result<ProtoLoadResult, String> {
    let cache_key = format!("reflect:{url}");
    validate_descriptor_key(&cache_key)?;
    let channel = create_channel(url, tls_enabled).await?;

    let list_response = call_reflection_with_fallback(
        channel.clone(),
        encode_message(&build_reflection_list_request()),
    )
    .await?;
    let service_names = parse_reflection_list_response(&list_response)?;
    if service_names.is_empty() {
        return Err("服务器未返回任何服务".to_string());
    }

    let requests = stream::iter(service_names.into_iter().map(|service_name| {
        let channel = channel.clone();
        async move {
            let response = call_reflection_with_fallback(
                channel,
                encode_message(&build_reflection_file_request(&service_name)),
            )
            .await
            .map_err(|error| reflection_service_failure(&service_name, &error))?;
            parse_reflection_file_response(&response)
                .map_err(|error| reflection_service_failure(&service_name, &error))
        }
    }));
    let mut responses = requests.buffer_unordered(MAX_REFLECTION_FANOUT);

    let mut descriptor_accumulator = ReflectionDescriptorAccumulator::new();

    while let Some(result) = responses.next().await {
        let descriptors = require_complete_reflection_result(result)?;

        for bytes in descriptors {
            descriptor_accumulator.push(bytes)?;
        }
    }

    if descriptor_accumulator.descriptor_set.file.is_empty() {
        return Err("服务器未返回可用的 Proto 描述符".to_string());
    }

    let descriptor_set = descriptor_accumulator.descriptor_set;
    let encoded_bytes = descriptor_set.encoded_len();
    if encoded_bytes > MAX_REFLECTION_DESCRIPTOR_BYTES {
        return Err(format!(
            "Reflection 描述符集合超过 {MAX_REFLECTION_DESCRIPTOR_BYTES} 字节"
        ));
    }
    let file_name = format!("reflection@{url}");
    let compiled = tokio::task::spawn_blocking(move || {
        let pool = DescriptorPool::from_file_descriptor_set(descriptor_set)
            .map_err(|error| format!("描述符池构建失败: {error}"))?;
        let services = build_service_infos(&pool);
        Ok::<_, String>((pool, services))
    })
    .await
    .map_err(|error| format!("Reflection 描述符处理任务失败: {error}"))??;

    cache_descriptor_pool(cache_key, compiled.0, encoded_bytes).await?;
    Ok(ProtoLoadResult {
        services: compiled.1,
        file_name,
    })
}

fn reflection_service_failure(service_name: &str, error: &str) -> String {
    format!(
        "服务 {}: {}",
        truncate_utf8(service_name, MAX_REFLECTION_SERVICE_NAME_BYTES),
        truncate_utf8(error, 1024)
    )
}

fn require_complete_reflection_result(
    result: Result<Vec<Vec<u8>>, String>,
) -> Result<Vec<Vec<u8>>, String> {
    result.map_err(|error| format!("Reflection 服务描述符获取失败: {error}"))
}

// ══════════════════════════════════════════════
//  gRPC Calls
// ══════════════════════════════════════════════

/// Make a unary gRPC call
pub async fn call_unary(
    url: &str,
    tls_enabled: bool,
    proto_key: &str,
    method_full_name: &str,
    request_json: &str,
    metadata: &HashMap<String, String>,
) -> Result<GrpcCallResult, String> {
    let pool = get_descriptor_pool(proto_key)
        .await
        .ok_or("Proto 未加载，请先加载 .proto 文件或使用 Reflection")?;

    let method_desc = find_method(&pool, method_full_name)?;
    let input_desc = method_desc.input();
    let output_desc = method_desc.output();

    // Build request message from JSON
    let mut deserializer = serde_json::Deserializer::from_str(request_json);
    let request_msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("JSON → Protobuf 转换失败: {}", e))?;

    let request_bytes = request_msg.encode_to_vec();

    let channel = create_channel(url, tls_enabled).await?;
    let mut client = tonic::client::Grpc::new(channel);
    client
        .ready()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;

    // Build tonic request with metadata
    let mut tonic_req = tonic::Request::new(Bytes::from(request_bytes));
    for (k, v) in metadata {
        if let (Ok(key), Ok(val)) = (
            k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            v.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            tonic_req.metadata_mut().insert(key, val);
        }
    }

    let start = std::time::Instant::now();

    let response = client
        .unary(tonic_req, path, RawBytesCodec)
        .await
        .map_err(|e| format!("gRPC 调用失败: {} (code: {:?})", e.message(), e.code()))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    // Decode response
    let resp_metadata: HashMap<String, String> = response
        .metadata()
        .iter()
        .filter_map(|entry| match entry {
            tonic::metadata::KeyAndValueRef::Ascii(k, v) => {
                Some((k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
            }
            _ => None,
        })
        .collect();

    let resp_bytes = response.into_inner();
    let resp_msg = DynamicMessage::decode(output_desc, resp_bytes)
        .map_err(|e| format!("响应解码失败: {}", e))?;

    let response_json = serde_json::to_string_pretty(&resp_msg)
        .map_err(|e| format!("响应 JSON 序列化失败: {}", e))?;

    Ok(GrpcCallResult {
        response_json,
        status_code: 0, // OK
        status_message: "OK".to_string(),
        duration_ms,
        response_metadata: resp_metadata,
    })
}

/// Start a server-streaming gRPC call, emitting events to the frontend
pub async fn call_server_stream(
    app: tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    url: &str,
    tls_enabled: bool,
    proto_key: &str,
    method_full_name: &str,
    request_json: &str,
    metadata: &HashMap<String, String>,
) -> Result<u64, String> {
    validate_stream_connection_id(connection_id)?;
    let pool = get_descriptor_pool(proto_key).await.ok_or("Proto 未加载")?;
    let method_desc = find_method(&pool, method_full_name)?;
    let input_desc = method_desc.input();
    let output_desc = method_desc.output();

    let mut deserializer = serde_json::Deserializer::from_str(request_json);
    let request_msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("JSON → Protobuf 转换失败: {}", e))?;

    let request_bytes = request_msg.encode_to_vec();
    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;

    // Register before connecting so `grpc_cancel_stream` can interrupt DNS,
    // TCP/TLS setup, readiness, and the pending initial response.
    let (generation, mut cancel_rx) = register_stream(connections, connection_id, None, None).await;
    let channel =
        match await_stream_or_cancel(&mut cancel_rx, create_channel(url, tls_enabled)).await {
            Ok(Ok(channel)) => channel,
            Ok(Err(error)) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err(error);
            }
            Err(_) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err("gRPC 流连接已取消".to_string());
            }
        };
    let mut client = tonic::client::Grpc::new(channel);
    match await_stream_or_cancel(&mut cancel_rx, client.ready()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err(format!("连接失败: {error}"));
        }
        Err(_) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err("gRPC 流连接已取消".to_string());
        }
    }

    let mut tonic_req = tonic::Request::new(Bytes::from(request_bytes));
    for (k, v) in metadata {
        if let (Ok(key), Ok(val)) = (
            k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            v.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            tonic_req.metadata_mut().insert(key, val);
        }
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();
    let event_sink = StreamEventSink::spawn(
        app,
        conns.clone(),
        conn_id.clone(),
        generation,
        cancel_rx.clone(),
    );

    tokio::spawn(async move {
        let result = match await_stream_or_cancel(
            &mut cancel_rx,
            client.server_streaming(tonic_req, path, RawBytesCodec),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                remove_stream_if_generation(&conns, &conn_id, generation).await;
                return;
            }
        };

        match result {
            Ok(response) => {
                let mut stream = response.into_inner();
                use futures_util::StreamExt;

                loop {
                    tokio::select! {
                        biased;
                        _ = cancel_rx.changed() => {
                            remove_stream_if_generation(&conns, &conn_id, generation).await;
                            return;
                        }
                        item = stream.next() => {
                            match item {
                                Some(Ok(resp_bytes)) => {
                                    let json = decode_stream_message(&output_desc, resp_bytes);
                                    event_sink.try_emit(stream_event(
                                        &conn_id,
                                        generation,
                                        "data",
                                        Some(json),
                                        None,
                                        None,
                                    ));
                                }
                                Some(Err(e)) => {
                                    let message = e.message().to_string();
                                    if !event_sink
                                        .finish(stream_event(
                                            &conn_id,
                                            generation,
                                            "error",
                                            Some(message.clone()),
                                            Some(e.code() as i32),
                                            Some(message),
                                        ))
                                        .await
                                    {
                                        remove_stream_if_generation(&conns, &conn_id, generation)
                                            .await;
                                    }
                                    return;
                                }
                                None => break,
                            }
                        }
                    }
                }

                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "completed",
                        None,
                        Some(0),
                        Some("Stream completed".to_string()),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
            Err(e) => {
                let message = e.message().to_string();
                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "error",
                        Some(message.clone()),
                        Some(e.code() as i32),
                        Some(message),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
        }
    });

    Ok(generation)
}

/// Start a client-streaming gRPC call.
/// Returns immediately; use `stream_send_message` to push messages and `stream_close_send` to finish.
/// The single response is emitted as a `grpc-stream-event` with event_type = "data".
pub async fn call_client_stream(
    app: tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    url: &str,
    tls_enabled: bool,
    proto_key: &str,
    method_full_name: &str,
    metadata: &HashMap<String, String>,
) -> Result<u64, String> {
    validate_stream_connection_id(connection_id)?;
    let pool = get_descriptor_pool(proto_key).await.ok_or("Proto 未加载")?;
    let method_desc = find_method(&pool, method_full_name)?;
    let input_desc = method_desc.input();
    let output_desc = method_desc.output();
    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;
    let (msg_tx, msg_rx) = mpsc::channel::<Bytes>(64);
    let (generation, mut cancel_rx) =
        register_stream(connections, connection_id, Some(msg_tx), Some(input_desc)).await;
    let channel =
        match await_stream_or_cancel(&mut cancel_rx, create_channel(url, tls_enabled)).await {
            Ok(Ok(channel)) => channel,
            Ok(Err(error)) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err(error);
            }
            Err(_) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err("gRPC 流连接已取消".to_string());
            }
        };
    let mut client = tonic::client::Grpc::new(channel);
    match await_stream_or_cancel(&mut cancel_rx, client.ready()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err(format!("连接失败: {error}"));
        }
        Err(_) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err("gRPC 流连接已取消".to_string());
        }
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();
    let event_sink = StreamEventSink::spawn(
        app,
        conns.clone(),
        conn_id.clone(),
        generation,
        cancel_rx.clone(),
    );

    // Build tonic request with metadata
    let stream = tokio_stream::wrappers::ReceiverStream::new(msg_rx);
    let mut tonic_req = tonic::Request::new(stream);
    for (k, v) in metadata {
        if let (Ok(key), Ok(val)) = (
            k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            v.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            tonic_req.metadata_mut().insert(key, val);
        }
    }

    tokio::spawn(async move {
        let result = match await_stream_or_cancel(
            &mut cancel_rx,
            client.client_streaming(tonic_req, path, RawBytesCodec),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                remove_stream_if_generation(&conns, &conn_id, generation).await;
                return;
            }
        };
        match result {
            Ok(response) => {
                let resp_bytes = response.into_inner();
                let json = decode_stream_message(&output_desc, resp_bytes);
                event_sink.try_emit(stream_event(
                    &conn_id,
                    generation,
                    "data",
                    Some(json),
                    Some(0),
                    Some("OK".to_string()),
                ));

                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "completed",
                        None,
                        Some(0),
                        Some("Stream completed".to_string()),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
            Err(e) => {
                let message = e.message().to_string();
                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "error",
                        Some(message.clone()),
                        Some(e.code() as i32),
                        Some(message),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
        }
    });

    Ok(generation)
}

/// Start a bidirectional streaming gRPC call.
/// Returns immediately; use `stream_send_message` to push messages.
/// Responses arrive as `grpc-stream-event` events.
pub async fn call_bidi_stream(
    app: tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    url: &str,
    tls_enabled: bool,
    proto_key: &str,
    method_full_name: &str,
    metadata: &HashMap<String, String>,
) -> Result<u64, String> {
    validate_stream_connection_id(connection_id)?;
    let pool = get_descriptor_pool(proto_key).await.ok_or("Proto 未加载")?;
    let method_desc = find_method(&pool, method_full_name)?;
    let input_desc = method_desc.input();
    let output_desc = method_desc.output();
    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;
    let (msg_tx, msg_rx) = mpsc::channel::<Bytes>(64);
    let (generation, mut cancel_rx) =
        register_stream(connections, connection_id, Some(msg_tx), Some(input_desc)).await;
    let channel =
        match await_stream_or_cancel(&mut cancel_rx, create_channel(url, tls_enabled)).await {
            Ok(Ok(channel)) => channel,
            Ok(Err(error)) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err(error);
            }
            Err(_) => {
                remove_stream_if_generation(connections, connection_id, generation).await;
                return Err("gRPC 流连接已取消".to_string());
            }
        };
    let mut client = tonic::client::Grpc::new(channel);
    match await_stream_or_cancel(&mut cancel_rx, client.ready()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err(format!("连接失败: {error}"));
        }
        Err(_) => {
            remove_stream_if_generation(connections, connection_id, generation).await;
            return Err("gRPC 流连接已取消".to_string());
        }
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();
    let event_sink = StreamEventSink::spawn(
        app,
        conns.clone(),
        conn_id.clone(),
        generation,
        cancel_rx.clone(),
    );

    let stream = tokio_stream::wrappers::ReceiverStream::new(msg_rx);
    let mut tonic_req = tonic::Request::new(stream);
    for (k, v) in metadata {
        if let (Ok(key), Ok(val)) = (
            k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            v.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            tonic_req.metadata_mut().insert(key, val);
        }
    }

    tokio::spawn(async move {
        let result = match await_stream_or_cancel(
            &mut cancel_rx,
            client.streaming(tonic_req, path, RawBytesCodec),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                remove_stream_if_generation(&conns, &conn_id, generation).await;
                return;
            }
        };
        match result {
            Ok(response) => {
                let mut resp_stream = response.into_inner();
                use futures_util::StreamExt;

                loop {
                    tokio::select! {
                        biased;
                        _ = cancel_rx.changed() => {
                            remove_stream_if_generation(&conns, &conn_id, generation).await;
                            return;
                        }
                        item = resp_stream.next() => {
                            match item {
                                Some(Ok(resp_bytes)) => {
                                    let json = decode_stream_message(&output_desc, resp_bytes);
                                    event_sink.try_emit(stream_event(
                                        &conn_id,
                                        generation,
                                        "data",
                                        Some(json),
                                        None,
                                        None,
                                    ));
                                }
                                Some(Err(e)) => {
                                    let message = e.message().to_string();
                                    if !event_sink
                                        .finish(stream_event(
                                            &conn_id,
                                            generation,
                                            "error",
                                            Some(message.clone()),
                                            Some(e.code() as i32),
                                            Some(message),
                                        ))
                                        .await
                                    {
                                        remove_stream_if_generation(&conns, &conn_id, generation)
                                            .await;
                                    }
                                    return;
                                }
                                None => break,
                            }
                        }
                    }
                }

                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "completed",
                        None,
                        Some(0),
                        Some("Stream completed".to_string()),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
            Err(e) => {
                let message = e.message().to_string();
                if !event_sink
                    .finish(stream_event(
                        &conn_id,
                        generation,
                        "error",
                        Some(message.clone()),
                        Some(e.code() as i32),
                        Some(message),
                    ))
                    .await
                {
                    remove_stream_if_generation(&conns, &conn_id, generation).await;
                }
            }
        }
    });

    Ok(generation)
}

/// Send a message on an active client-streaming or bidi-streaming call
pub async fn stream_send_message(
    connections: &GrpcConnections,
    connection_id: &str,
    _proto_key: &str,
    _method_full_name: &str,
    message_json: &str,
) -> Result<(), String> {
    validate_stream_connection_id(connection_id)?;
    let (generation, input_desc) = {
        let connections = connections.lock().await;
        let handle = connections.get(connection_id).ok_or("流连接不存在")?;
        let input_desc = handle
            .input_descriptor
            .clone()
            .ok_or("此连接不支持发送消息（非 streaming 模式）")?;
        (handle.generation, input_desc)
    };

    let mut deserializer = serde_json::Deserializer::from_str(message_json);
    let msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("JSON → Protobuf 转换失败: {}", e))?;
    let msg_bytes = Bytes::from(msg.encode_to_vec());

    send_stream_bytes(connections, connection_id, Some(generation), msg_bytes).await
}

async fn send_stream_bytes(
    connections: &GrpcConnections,
    connection_id: &str,
    expected_generation: Option<u64>,
    bytes: Bytes,
) -> Result<(), String> {
    let (sender, mut cancel) = {
        let connections = connections.lock().await;
        let handle = connections.get(connection_id).ok_or("流连接不存在")?;
        if expected_generation.is_some_and(|generation| generation != handle.generation) {
            return Err("发送失败：流连接已被替换".to_string());
        }
        let sender = handle
            .msg_sender
            .clone()
            .ok_or("此连接不支持发送消息（非 streaming 模式）")?;
        (sender, handle.cancel.subscribe())
    };

    // Never hold the registry mutex while waiting for channel capacity. This
    // lets cancel/replacement drop a full or transport-stalled stream promptly.
    if *cancel.borrow() {
        return Err("发送失败：流已取消".to_string());
    }
    tokio::select! {
        biased;
        _ = cancel.changed() => Err("发送失败：流已取消".to_string()),
        result = sender.send(bytes) => result.map_err(|_| "发送失败：流已关闭".to_string()),
    }
}

/// Close the send side of a client-streaming or bidi-streaming call.
/// For client streams this triggers the server response.
pub async fn stream_close_send(
    connections: &GrpcConnections,
    connection_id: &str,
) -> Result<(), String> {
    validate_stream_connection_id(connection_id)?;
    let mut conns = connections.lock().await;
    if let Some(handle) = conns.get_mut(connection_id) {
        // Drop the sender to signal end of stream
        handle.msg_sender = None;
    }
    Ok(())
}

/// Cancel a streaming call
pub async fn cancel_stream(
    connections: &GrpcConnections,
    connection_id: &str,
) -> Result<(), String> {
    validate_stream_connection_id(connection_id)?;
    let handle = connections.lock().await.remove(connection_id);
    if let Some(handle) = handle {
        let _ = handle.cancel.send(true);
    }
    Ok(())
}

// ══════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════

/// TLS configuration from frontend
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTlsConfig {
    pub enabled: bool,
    /// Path to custom CA certificate (PEM). If empty, uses system roots.
    pub ca_cert_path: Option<String>,
    /// Reserved for compatibility. This backend refuses to silently disable
    /// certificate verification; use a custom CA for private test services.
    pub skip_verify: bool,
}

async fn create_channel(url: &str, tls_enabled: bool) -> Result<Channel, String> {
    create_channel_with_tls(
        url,
        &GrpcTlsConfig {
            enabled: tls_enabled,
            ..Default::default()
        },
    )
    .await
}

fn normalize_grpc_endpoint(url: &str, force_tls: bool) -> Result<(String, bool), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("gRPC 地址不能为空".to_string());
    }

    let lower = url.to_ascii_lowercase();
    let (mut normalized, explicit_tls) = if lower.starts_with("https://") {
        (format!("https://{}", &url[8..]), true)
    } else if lower.starts_with("http://") {
        (format!("http://{}", &url[7..]), false)
    } else if lower.starts_with("grpcs://") {
        (format!("https://{}", &url[8..]), true)
    } else if lower.starts_with("grpc://") {
        (format!("http://{}", &url[7..]), false)
    } else if lower.contains("://") {
        return Err("gRPC 地址仅支持 http、https、grpc 或 grpcs 协议".to_string());
    } else {
        (
            format!("{}://{url}", if force_tls { "https" } else { "http" }),
            force_tls,
        )
    };

    let use_tls = force_tls || explicit_tls;
    if use_tls && normalized.to_ascii_lowercase().starts_with("http://") {
        normalized = format!("https://{}", &normalized[7..]);
    }

    let uri = normalized
        .parse::<http::Uri>()
        .map_err(|error| format!("无效的 gRPC 地址: {error}"))?;
    if uri.authority().is_none() {
        return Err("无效的 gRPC 地址：缺少主机".to_string());
    }
    Ok((normalized, use_tls))
}

pub async fn create_channel_with_tls(url: &str, tls: &GrpcTlsConfig) -> Result<Channel, String> {
    if tls.skip_verify {
        return Err(
            "当前 gRPC 后端不允许跳过证书验证；请配置用于测试服务的自定义 CA 证书".to_string(),
        );
    }

    let (endpoint_url, use_tls) = normalize_grpc_endpoint(url, tls.enabled)?;
    let mut endpoint = Channel::from_shared(endpoint_url.clone())
        .map_err(|e| format!("无效的 gRPC 地址: {}", e))?
        .connect_timeout(std::time::Duration::from_secs(10));

    if use_tls {
        let mut tls_config = tonic::transport::ClientTlsConfig::new().with_enabled_roots();

        if let Some(ref ca_path) = tls.ca_cert_path {
            if !ca_path.is_empty() {
                let ca_pem = tokio::fs::read(ca_path)
                    .await
                    .map_err(|e| format!("读取 CA 证书失败: {}", e))?;
                let ca = tonic::transport::Certificate::from_pem(ca_pem);
                tls_config = tls_config.ca_certificate(ca);
            }
        }

        // Extract domain name for TLS SNI
        if let Ok(uri) = endpoint_url.parse::<http::Uri>() {
            if let Some(host) = uri.host() {
                tls_config = tls_config.domain_name(host.to_string());
            }
        }

        endpoint = endpoint
            .tls_config(tls_config)
            .map_err(|e| format!("TLS 配置失败: {}", e))?;
    }

    endpoint
        .connect()
        .await
        .map_err(|e| format!("gRPC 连接失败: {}", e))
}

fn find_method<'a>(
    pool: &'a DescriptorPool,
    method_full_name: &str,
) -> Result<MethodDescriptor, String> {
    // method_full_name: "package.Service.Method" or "package.Service/Method"
    let normalized = method_full_name.replace('/', ".");
    for svc in pool.services() {
        for method in svc.methods() {
            if method.full_name() == normalized {
                return Ok(method);
            }
        }
    }
    Err(format!("方法未找到: {}", method_full_name))
}

fn build_service_infos(pool: &DescriptorPool) -> Vec<GrpcServiceInfo> {
    pool.services()
        .filter(|svc| !svc.full_name().starts_with("grpc.reflection"))
        .map(|svc| {
            let methods = svc
                .methods()
                .map(|m| {
                    let kind = match (m.is_client_streaming(), m.is_server_streaming()) {
                        (false, false) => GrpcMethodKind::Unary,
                        (false, true) => GrpcMethodKind::ServerStreaming,
                        (true, false) => GrpcMethodKind::ClientStreaming,
                        (true, true) => GrpcMethodKind::BidiStreaming,
                    };

                    let input_fields = m
                        .input()
                        .fields()
                        .map(|f| GrpcFieldInfo {
                            name: f.name().to_string(),
                            json_name: f.json_name().to_string(),
                            field_type: format!("{:?}", f.kind()),
                            is_repeated: f.cardinality() == prost_reflect::Cardinality::Repeated,
                            is_map: f.is_map(),
                            is_optional: f.field_descriptor_proto().proto3_optional(),
                        })
                        .collect();

                    GrpcMethodInfo {
                        name: m.name().to_string(),
                        full_name: m.full_name().to_string(),
                        input_type: m.input().full_name().to_string(),
                        output_type: m.output().full_name().to_string(),
                        kind,
                        input_fields,
                    }
                })
                .collect();

            GrpcServiceInfo {
                name: svc.name().to_string(),
                full_name: svc.full_name().to_string(),
                methods,
            }
        })
        .collect()
}

#[allow(dead_code)]
fn build_field_infos(desc: &prost_reflect::MessageDescriptor) -> Vec<GrpcFieldInfo> {
    desc.fields()
        .map(|f| GrpcFieldInfo {
            name: f.name().to_string(),
            json_name: f.json_name().to_string(),
            field_type: format!("{:?}", f.kind()),
            is_repeated: f.cardinality() == prost_reflect::Cardinality::Repeated,
            is_map: f.is_map(),
            is_optional: f.field_descriptor_proto().proto3_optional(),
        })
        .collect()
}

// ── Reflection protocol helpers ──

fn build_reflection_list_request() -> prost_types::Any {
    // ServerReflectionRequest with list_services = ""
    // We manually encode: field 7 (list_services) = ""
    let mut buf = Vec::new();
    // field 7, wire type 2 (length-delimited), value = empty string
    prost::encoding::string::encode(7, &String::new(), &mut buf);
    prost_types::Any {
        type_url: String::new(),
        value: buf,
    }
}

fn build_reflection_file_request(service_name: &str) -> prost_types::Any {
    // ServerReflectionRequest with file_containing_symbol = service_name
    let mut buf = Vec::new();
    // field 4 (file_containing_symbol), wire type 2
    prost::encoding::string::encode(4, &service_name.to_string(), &mut buf);
    prost_types::Any {
        type_url: String::new(),
        value: buf,
    }
}

fn encode_message(msg: &prost_types::Any) -> Bytes {
    Bytes::from(msg.value.clone())
}

#[derive(Clone, PartialEq, prost::Message)]
struct WireReflectionResponse {
    #[prost(message, optional, tag = "4")]
    file_descriptor_response: Option<WireFileDescriptorResponse>,
    #[prost(message, optional, tag = "6")]
    list_services_response: Option<WireListServiceResponse>,
    #[prost(message, optional, tag = "7")]
    error_response: Option<WireErrorResponse>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct WireFileDescriptorResponse {
    #[prost(bytes = "vec", repeated, tag = "1")]
    file_descriptor_proto: Vec<Vec<u8>>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct WireListServiceResponse {
    #[prost(message, repeated, tag = "1")]
    service: Vec<WireServiceResponse>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct WireServiceResponse {
    #[prost(string, tag = "1")]
    name: String,
}

#[derive(Clone, PartialEq, prost::Message)]
struct WireErrorResponse {
    #[prost(int32, tag = "1")]
    error_code: i32,
    #[prost(string, tag = "2")]
    error_message: String,
}

async fn call_reflection_with_fallback(
    channel: Channel,
    request_bytes: Bytes,
) -> Result<Bytes, String> {
    const V1_PATH: &str = "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo";
    const V1_ALPHA_PATH: &str = "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo";

    match call_reflection_path(channel.clone(), V1_PATH, request_bytes.clone()).await {
        Ok(response) => Ok(response),
        Err(v1_error) => call_reflection_path(channel, V1_ALPHA_PATH, request_bytes)
            .await
            .map_err(|alpha_error| {
                format!("Reflection v1 失败: {v1_error}; v1alpha 失败: {alpha_error}")
            }),
    }
}

async fn call_reflection_path(
    channel: Channel,
    path: &str,
    request_bytes: Bytes,
) -> Result<Bytes, String> {
    let path = path
        .parse::<http::uri::PathAndQuery>()
        .map_err(|error| format!("Reflection Path 解析失败: {error}"))?;

    tokio::time::timeout(REFLECTION_CALL_TIMEOUT, async move {
        let mut client = tonic::client::Grpc::new(channel)
            .max_decoding_message_size(MAX_REFLECTION_RESPONSE_BYTES)
            .max_encoding_message_size(64 * 1024);
        client
            .ready()
            .await
            .map_err(|error| format!("Reflection 连接失败: {error}"))?;

        // Reflection is bidirectional, but one request produces one response.
        let response = client
            .server_streaming(tonic::Request::new(request_bytes), path, RawBytesCodec)
            .await
            .map_err(|error| format!("Reflection 调用失败: {error}"))?;
        let mut response_stream = response.into_inner();
        let bytes = match response_stream.next().await {
            Some(Ok(bytes)) => bytes,
            Some(Err(error)) => return Err(format!("Reflection 响应错误: {error}")),
            None => return Err("Reflection 未返回数据".to_string()),
        };
        if bytes.len() > MAX_REFLECTION_RESPONSE_BYTES {
            return Err(format!(
                "Reflection 单次响应超过 {MAX_REFLECTION_RESPONSE_BYTES} 字节"
            ));
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| {
        format!(
            "Reflection 单次调用超过 {} 秒",
            REFLECTION_CALL_TIMEOUT.as_secs()
        )
    })?
}

fn decode_reflection_response(data: &[u8]) -> Result<WireReflectionResponse, String> {
    if data.len() > MAX_REFLECTION_RESPONSE_BYTES {
        return Err(format!(
            "Reflection 响应超过 {MAX_REFLECTION_RESPONSE_BYTES} 字节"
        ));
    }
    let response = WireReflectionResponse::decode(data)
        .map_err(|error| format!("Reflection 响应格式无效: {error}"))?;
    if let Some(error) = &response.error_response {
        return Err(format!(
            "Reflection 服务错误 {}: {}",
            error.error_code, error.error_message
        ));
    }
    Ok(response)
}

fn parse_reflection_list_response(data: &[u8]) -> Result<Vec<String>, String> {
    let response = decode_reflection_response(data)?;
    let services = response
        .list_services_response
        .ok_or("Reflection 响应缺少服务列表")?
        .service;
    if services.len() > MAX_REFLECTION_SERVICES {
        return Err(format!("Reflection 服务数量超过 {MAX_REFLECTION_SERVICES}"));
    }

    let mut names = Vec::with_capacity(services.len());
    let mut seen = HashSet::with_capacity(services.len());
    let mut total_bytes = 0usize;
    for service in services {
        let name = service.name;
        if name.is_empty()
            || name.len() > MAX_REFLECTION_SERVICE_NAME_BYTES
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_')
        {
            return Err("Reflection 返回了无效的服务名称".to_string());
        }
        if !seen.insert(name.clone()) {
            continue;
        }
        total_bytes = total_bytes
            .checked_add(name.len())
            .ok_or("Reflection 服务名称总大小溢出")?;
        if total_bytes > MAX_REFLECTION_SERVICE_BYTES {
            return Err(format!(
                "Reflection 服务名称总大小超过 {MAX_REFLECTION_SERVICE_BYTES} 字节"
            ));
        }
        names.push(name);
    }
    Ok(names)
}

fn parse_reflection_file_response(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let response = decode_reflection_response(data)?;
    let descriptors = response
        .file_descriptor_response
        .ok_or("Reflection 响应缺少文件描述符")?
        .file_descriptor_proto;
    if descriptors.len() > MAX_REFLECTION_DESCRIPTOR_COUNT {
        return Err(format!(
            "Reflection 单次描述符数量超过 {MAX_REFLECTION_DESCRIPTOR_COUNT}"
        ));
    }

    let mut total_bytes = 0usize;
    for descriptor in &descriptors {
        if descriptor.len() > MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES {
            return Err(format!(
                "Reflection 单个描述符超过 {MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES} 字节"
            ));
        }
        total_bytes = total_bytes
            .checked_add(descriptor.len())
            .ok_or("Reflection 描述符大小溢出")?;
        if total_bytes > MAX_REFLECTION_RESPONSE_BYTES {
            return Err(format!(
                "Reflection 单次描述符总大小超过 {MAX_REFLECTION_RESPONSE_BYTES} 字节"
            ));
        }
    }
    Ok(descriptors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future;
    use tokio::time::{Duration, timeout};

    #[test]
    fn grpc_endpoint_schemes_are_normalized_for_real_tls_transport() {
        assert_eq!(
            normalize_grpc_endpoint("grpcs://example.test:443", false).unwrap(),
            ("https://example.test:443".to_string(), true)
        );
        assert_eq!(
            normalize_grpc_endpoint("HTTPS://example.test:443", false).unwrap(),
            ("https://example.test:443".to_string(), true)
        );
        assert_eq!(
            normalize_grpc_endpoint("http://example.test:443", true).unwrap(),
            ("https://example.test:443".to_string(), true)
        );
        assert_eq!(
            normalize_grpc_endpoint("127.0.0.1:50051", false).unwrap(),
            ("http://127.0.0.1:50051".to_string(), false)
        );
        assert!(normalize_grpc_endpoint("ftp://example.test", false).is_err());
    }

    #[test]
    fn descriptor_pool_cache_evicts_lru_and_enforces_byte_limits() {
        let mut cache = DescriptorPoolCache::new(2, 10, 10);
        cache
            .insert("a".to_string(), DescriptorPool::new(), 3)
            .unwrap();
        cache
            .insert("b".to_string(), DescriptorPool::new(), 3)
            .unwrap();
        assert!(cache.get("a").is_some());
        cache
            .insert("c".to_string(), DescriptorPool::new(), 3)
            .unwrap();

        assert!(cache.entries.contains_key("a"));
        assert!(!cache.entries.contains_key("b"));
        assert!(cache.entries.contains_key("c"));
        assert_eq!(cache.total_bytes, 6);

        cache
            .insert("large".to_string(), DescriptorPool::new(), 11)
            .expect_err("oversized cache entries must be rejected");
        assert!(cache.entries.contains_key("a"));
        assert!(cache.entries.contains_key("c"));

        let mut byte_limited = DescriptorPoolCache::new(4, 5, 5);
        byte_limited
            .insert("x".to_string(), DescriptorPool::new(), 3)
            .unwrap();
        byte_limited
            .insert("y".to_string(), DescriptorPool::new(), 3)
            .unwrap();
        assert!(!byte_limited.entries.contains_key("x"));
        assert!(byte_limited.entries.contains_key("y"));
        assert_eq!(byte_limited.total_bytes, 3);
    }

    #[test]
    fn backend_stream_events_are_generation_tagged_bounded_and_drop_on_full_queue() {
        let event = stream_event(
            "bounded",
            42,
            "data",
            Some("\u{0}".repeat(MAX_STREAM_EVENT_DATA_BYTES * 2)),
            None,
            Some("status".repeat(MAX_STREAM_EVENT_STATUS_BYTES)),
        );
        assert_eq!(event.generation, 42);
        assert!(serialized_stream_event_bytes(&event) <= MAX_STREAM_EVENT_SERIALIZED_BYTES);

        let (sender, mut receiver) = mpsc::channel::<QueuedStreamEvent>(1);
        let dropped = Arc::new(AtomicU64::new(0));
        let sink = StreamEventSink {
            sender,
            dropped: dropped.clone(),
        };
        assert!(sink.try_emit(event.clone()));
        assert!(!sink.try_emit(event));
        assert_eq!(dropped.load(Ordering::Relaxed), 1);
        assert!(receiver.try_recv().is_ok());
    }

    #[test]
    fn backend_stream_emit_rate_limiter_enforces_event_and_byte_windows() {
        let mut limiter = StreamEmitRateLimiter::new(2, 100, Duration::from_secs(1));
        let start = limiter.window_started;
        assert_eq!(limiter.capacity_delay(40, start), None);
        assert_eq!(limiter.capacity_delay(40, start), None);
        assert!(limiter.capacity_delay(1, start).is_some());
        assert_eq!(
            limiter.capacity_delay(100, start + Duration::from_secs(1)),
            None
        );
        assert!(
            limiter
                .capacity_delay(1, start + Duration::from_secs(1))
                .is_some()
        );
    }

    #[test]
    fn temporary_proto_workspaces_are_unique_and_removed_on_drop() {
        let first = TempProtoWorkspace::create().unwrap();
        let second = TempProtoWorkspace::create().unwrap();
        let first_dir = first.dir.clone();
        let second_dir = second.dir.clone();

        assert_ne!(first_dir, second_dir);
        assert!(first_dir.is_dir());
        assert!(second_dir.is_dir());
        std::fs::write(&first.input, "syntax = \"proto3\";").unwrap();
        drop(first);
        drop(second);
        assert!(!first_dir.exists());
        assert!(!second_dir.exists());
    }

    #[test]
    fn pasted_proto_compiles_in_isolated_workspace() {
        let compiled = compile_proto_content_blocking(
            r#"
                syntax = "proto3";
                package bounded;
                message Ping {}
                service Echo { rpc Call(Ping) returns (Ping); }
            "#
            .to_string(),
            Instant::now() + PROTO_COMPILE_TIMEOUT,
        )
        .unwrap();

        assert_eq!(compiled.file_name, "input.proto");
        assert_eq!(compiled.services.len(), 1);
        assert_eq!(compiled.services[0].full_name, "bounded.Echo");
        assert!(compiled.descriptor_bytes > 0);
    }

    #[test]
    fn proto_source_budget_counts_unique_files_and_rejects_resource_overflow() {
        let limits = ProtoCompileLimits {
            max_file_bytes: 8,
            max_files: 2,
            max_total_bytes: 10,
        };
        let mut budget = ProtoSourceBudget::default();
        budget.reserve("a.proto", 6, limits).unwrap();
        budget.reserve("a.proto", 6, limits).unwrap();
        assert_eq!(budget.seen.len(), 1);
        assert_eq!(budget.total_bytes, 6);
        budget.reserve("b.proto", 4, limits).unwrap();
        assert!(budget.reserve("c.proto", 1, limits).is_err());

        let mut file_limited = ProtoSourceBudget::default();
        assert!(file_limited.reserve("large.proto", 9, limits).is_err());

        let total_limited = ProtoCompileLimits {
            max_files: 3,
            ..limits
        };
        let mut total_budget = ProtoSourceBudget::default();
        total_budget.reserve("a.proto", 6, total_limited).unwrap();
        assert!(total_budget.reserve("b.proto", 5, total_limited).is_err());
    }

    #[test]
    fn limited_proto_resolver_rejects_oversized_sources_and_expired_compiles() {
        let workspace = TempProtoWorkspace::create().unwrap();
        let source = "syntax = \"proto3\"; message A {}";
        std::fs::write(&workspace.input, source).unwrap();

        let too_small = LimitedProtoResolver::new(
            workspace.dir.clone(),
            Instant::now() + Duration::from_secs(1),
            ProtoCompileLimits {
                max_file_bytes: source.len() - 1,
                max_files: 1,
                max_total_bytes: source.len(),
            },
        );
        let error = protox::file::FileResolver::open_file(&too_small, "input.proto")
            .expect_err("the resolver must reject a source before parsing it");
        assert!(error.to_string().contains("过大"));

        let expired = LimitedProtoResolver::new(
            workspace.dir.clone(),
            Instant::now() - Duration::from_millis(1),
            ProtoCompileLimits::default(),
        );
        let error = protox::file::FileResolver::open_file(&expired, "input.proto")
            .expect_err("an expired compile must fail cooperatively");
        assert!(error.to_string().contains("耗时限制"));
    }

    #[test]
    fn limited_proto_compiler_includes_imports_without_source_info() {
        let workspace = TempProtoWorkspace::create().unwrap();
        let child = workspace.dir.join("child.proto");
        std::fs::write(
            &workspace.input,
            "syntax = \"proto3\"; import \"child.proto\"; message Root { Child child = 1; }",
        )
        .unwrap();
        std::fs::write(&child, "syntax = \"proto3\"; message Child {}").unwrap();

        let descriptors = compile_proto_with_limits(
            &workspace.input,
            &workspace.dir,
            Instant::now() + PROTO_COMPILE_TIMEOUT,
        )
        .unwrap();
        assert_eq!(descriptors.file.len(), 2);
        assert!(
            descriptors
                .file
                .iter()
                .all(|file| file.source_code_info.is_none())
        );
    }

    #[tokio::test]
    async fn pasted_proto_and_cache_keys_have_hard_input_limits() {
        let oversized = "x".repeat(MAX_PROTO_CONTENT_BYTES + 1);
        let error = load_proto_content(&oversized, "oversized")
            .await
            .expect_err("oversized pasted content must fail before compilation");
        assert!(error.contains("内容过大"));

        let oversized_key = "k".repeat(MAX_DESCRIPTOR_KEY_BYTES + 1);
        assert!(validate_descriptor_key(&oversized_key).is_err());
    }

    #[test]
    fn reflection_prost_parser_deduplicates_and_validates_service_lists() {
        let response = WireReflectionResponse {
            file_descriptor_response: None,
            list_services_response: Some(WireListServiceResponse {
                service: vec![
                    WireServiceResponse {
                        name: "example.Echo".to_string(),
                    },
                    WireServiceResponse {
                        name: "example.Echo".to_string(),
                    },
                    WireServiceResponse {
                        name: "Health".to_string(),
                    },
                ],
            }),
            error_response: None,
        }
        .encode_to_vec();
        assert_eq!(
            parse_reflection_list_response(&response).unwrap(),
            vec!["example.Echo".to_string(), "Health".to_string()]
        );

        let too_many = WireReflectionResponse {
            file_descriptor_response: None,
            list_services_response: Some(WireListServiceResponse {
                service: (0..=MAX_REFLECTION_SERVICES)
                    .map(|index| WireServiceResponse {
                        name: format!("service.S{index}"),
                    })
                    .collect(),
            }),
            error_response: None,
        }
        .encode_to_vec();
        assert!(parse_reflection_list_response(&too_many).is_err());
        assert!(parse_reflection_list_response(&[0x32, 0x80]).is_err());
        assert!(decode_reflection_response(&vec![0; MAX_REFLECTION_RESPONSE_BYTES + 1]).is_err());
    }

    #[test]
    fn reflection_descriptor_bounds_and_deduplication_are_enforced() {
        let descriptor = prost_types::FileDescriptorProto {
            name: Some("echo.proto".to_string()),
            syntax: Some("proto3".to_string()),
            ..Default::default()
        }
        .encode_to_vec();
        let response = WireReflectionResponse {
            file_descriptor_response: Some(WireFileDescriptorResponse {
                file_descriptor_proto: vec![descriptor.clone()],
            }),
            list_services_response: None,
            error_response: None,
        }
        .encode_to_vec();
        assert_eq!(parse_reflection_file_response(&response).unwrap().len(), 1);

        let mut accumulator = ReflectionDescriptorAccumulator::new();
        accumulator.push(descriptor.clone()).unwrap();
        accumulator.push(descriptor).unwrap();
        assert_eq!(accumulator.processed_count, 2);
        assert_eq!(accumulator.descriptor_set.file.len(), 1);

        let mut count_limited = ReflectionDescriptorAccumulator::new();
        count_limited.processed_count = MAX_REFLECTION_DESCRIPTOR_COUNT;
        assert!(
            count_limited
                .push(
                    prost_types::FileDescriptorProto {
                        name: Some("overflow.proto".to_string()),
                        ..Default::default()
                    }
                    .encode_to_vec(),
                )
                .is_err()
        );

        let mut byte_limited = ReflectionDescriptorAccumulator::new();
        byte_limited.processed_bytes = MAX_REFLECTION_DESCRIPTOR_BYTES;
        assert!(
            byte_limited
                .push(
                    prost_types::FileDescriptorProto {
                        name: Some("overflow.proto".to_string()),
                        ..Default::default()
                    }
                    .encode_to_vec(),
                )
                .is_err()
        );

        let oversized_response = WireReflectionResponse {
            file_descriptor_response: Some(WireFileDescriptorResponse {
                file_descriptor_proto: vec![vec![0; MAX_REFLECTION_SINGLE_DESCRIPTOR_BYTES + 1]],
            }),
            list_services_response: None,
            error_response: None,
        }
        .encode_to_vec();
        assert!(parse_reflection_file_response(&oversized_response).is_err());

        let error_response = WireReflectionResponse {
            file_descriptor_response: None,
            list_services_response: None,
            error_response: Some(WireErrorResponse {
                error_code: 7,
                error_message: "denied".to_string(),
            }),
        }
        .encode_to_vec();
        assert!(
            decode_reflection_response(&error_response)
                .unwrap_err()
                .contains("denied")
        );

        let partial_error = require_complete_reflection_result(Err(reflection_service_failure(
            "example.Broken",
            "permission denied",
        )))
        .expect_err("a single failed service must reject the whole reflection result");
        assert!(partial_error.contains("example.Broken"));
        assert!(partial_error.contains("permission denied"));
    }

    #[tokio::test]
    async fn unsupported_skip_verify_is_rejected_before_connecting() {
        let error = create_channel_with_tls(
            "https://example.test",
            &GrpcTlsConfig {
                skip_verify: true,
                ..Default::default()
            },
        )
        .await
        .expect_err("certificate verification must not be silently disabled");

        assert!(error.contains("不允许跳过证书验证"));
    }

    #[tokio::test]
    async fn old_stream_cleanup_cannot_remove_replacement() {
        let connections = new_connections();
        let (old_generation, mut old_cancel) =
            register_stream(&connections, "same-id", None, None).await;
        let (new_generation, _new_cancel) =
            register_stream(&connections, "same-id", None, None).await;

        timeout(Duration::from_millis(100), old_cancel.changed())
            .await
            .expect("replacement must cancel the old generation")
            .expect("old cancellation sender should notify");
        assert!(!remove_stream_if_generation(&connections, "same-id", old_generation).await);
        assert_eq!(
            connections
                .lock()
                .await
                .get("same-id")
                .map(|handle| handle.generation),
            Some(new_generation)
        );
    }

    #[tokio::test]
    async fn cancellation_interrupts_pending_transport_future() {
        let (cancel, mut cancel_rx) = watch::channel(false);
        let pending = tokio::spawn(async move {
            await_stream_or_cancel(&mut cancel_rx, future::pending::<()>()).await
        });

        cancel.send(true).expect("pending transport is listening");
        let result = timeout(Duration::from_millis(100), pending)
            .await
            .expect("cancellation must be prompt")
            .expect("transport waiter should not panic");
        assert_eq!(result, Err(StreamCancelled));
    }

    #[tokio::test]
    async fn full_send_does_not_block_stream_cancellation() {
        let connections = new_connections();
        let (sender, _receiver) = mpsc::channel(1);
        sender
            .try_send(Bytes::from_static(b"fills-channel"))
            .expect("channel starts empty");
        register_stream(&connections, "full", Some(sender), None).await;

        let send_connections = connections.clone();
        let blocked_send = tokio::spawn(async move {
            send_stream_bytes(
                &send_connections,
                "full",
                None,
                Bytes::from_static(b"blocked"),
            )
            .await
        });
        tokio::task::yield_now().await;

        timeout(
            Duration::from_millis(100),
            cancel_stream(&connections, "full"),
        )
        .await
        .expect("cancel must not wait for a full message channel")
        .expect("cancel command should succeed");
        let result = timeout(Duration::from_millis(100), blocked_send)
            .await
            .expect("blocked send must observe cancellation")
            .expect("send task should not panic");
        assert_eq!(result, Err("发送失败：流已取消".to_string()));
        assert!(!connections.lock().await.contains_key("full"));
    }
}
