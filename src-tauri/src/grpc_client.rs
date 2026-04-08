// ProtoForge gRPC 客户端引擎
// 支持 Proto 文件解析、gRPC Reflection、Unary / Server-Streaming 调用

use bytes::{Buf, BufMut, Bytes, BytesMut};
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor};
use tauri::Emitter;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::codec::{Codec, Decoder, Encoder};
use tonic::transport::Channel;
use tonic::Status;

// ══════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════

pub type GrpcConnections = Arc<Mutex<HashMap<String, GrpcHandle>>>;

pub fn new_connections() -> GrpcConnections {
    Arc::new(Mutex::new(HashMap::new()))
}

pub(crate) struct GrpcHandle {
    #[allow(dead_code)]
    pub channel: Channel,
    pub cancel: tokio::sync::watch::Sender<bool>,
    /// Message sender for client-streaming / bidi-streaming
    pub msg_sender: Option<tokio::sync::mpsc::Sender<Bytes>>,
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
    pub event_type: String, // "data" | "completed" | "error"
    pub data: Option<String>,
    pub status_code: Option<i32>,
    pub status_message: Option<String>,
    pub timestamp: String,
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

    fn encode(&mut self, item: Self::Item, dst: &mut tonic::codec::EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct RawBytesDecoder;

impl Decoder for RawBytesDecoder {
    type Item = Bytes;
    type Error = Status;

    fn decode(&mut self, src: &mut tonic::codec::DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
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

// We store descriptor pools per load to allow multiple proto files
static DESCRIPTOR_POOLS: std::sync::LazyLock<Mutex<HashMap<String, DescriptorPool>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// ══════════════════════════════════════════════
//  Proto file loading
// ══════════════════════════════════════════════

/// Load and compile a .proto file, returning service/method descriptors
pub async fn load_proto_file(proto_path: &str) -> Result<ProtoLoadResult, String> {
    let path = Path::new(proto_path);
    if !path.exists() {
        return Err(format!("Proto 文件不存在: {}", proto_path));
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Compile the proto file
    let include_dir = path.parent().unwrap_or(Path::new("."));
    let fds = protox::compile(&[proto_path], &[include_dir])
        .map_err(|e| format!("Proto 编译失败: {}", e))?;

    let pool = DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| format!("描述符池构建失败: {}", e))?;

    let services = build_service_infos(&pool);

    // Cache the pool
    DESCRIPTOR_POOLS
        .lock()
        .await
        .insert(proto_path.to_string(), pool);

    Ok(ProtoLoadResult {
        services,
        file_name,
    })
}

/// Load from raw proto content string (for pasted definitions)
pub async fn load_proto_content(content: &str, key: &str) -> Result<ProtoLoadResult, String> {
    // Write to a temporary file, compile, then clean up
    let tmp_dir = std::env::temp_dir().join("protoforge_proto");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;
    let tmp_file = tmp_dir.join("input.proto");
    std::fs::write(&tmp_file, content)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    let fds = protox::compile(
        &[tmp_file.to_str().unwrap_or("input.proto")],
        &[tmp_dir.to_str().unwrap_or(".")],
    )
    .map_err(|e| format!("Proto 编译失败: {}", e))?;

    let pool = DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| format!("描述符池构建失败: {}", e))?;

    let services = build_service_infos(&pool);

    DESCRIPTOR_POOLS
        .lock()
        .await
        .insert(key.to_string(), pool);

    Ok(ProtoLoadResult {
        services,
        file_name: "input.proto".to_string(),
    })
}

// ══════════════════════════════════════════════
//  gRPC Reflection
// ══════════════════════════════════════════════

/// Use gRPC server reflection to discover services
pub async fn reflect_services(url: &str) -> Result<ProtoLoadResult, String> {
    let channel = create_channel(url).await?;
    let mut client = tonic::client::Grpc::new(channel);
    client.ready().await.map_err(|e| format!("连接失败: {}", e))?;

    // Call grpc.reflection.v1.ServerReflection/ServerReflectionInfo
    // This is a bidi stream, but we only send one request
    let list_req = build_reflection_list_request();
    let req_bytes = encode_message(&list_req);

    let path = "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo"
        .parse::<http::uri::PathAndQuery>()
        .map_err(|e| format!("Path 解析失败: {}", e))?;

    // Try v1 first, then v1alpha
    let result = call_reflection_stream(&mut client, &path, req_bytes.clone()).await;

    let response_bytes = match result {
        Ok(b) => b,
        Err(_) => {
            // Try v1alpha
            let path_alpha = "/grpc.reflection.v1alpha.ServerReflectionInfo/ServerReflectionInfo"
                .parse::<http::uri::PathAndQuery>()
                .map_err(|e| format!("Path 解析失败: {}", e))?;
            call_reflection_stream(&mut client, &path_alpha, req_bytes)
                .await
                .map_err(|e| format!("Reflection 调用失败 (v1 和 v1alpha): {}", e))?
        }
    };

    // Parse the reflection response to get service names
    let service_names = parse_reflection_list_response(&response_bytes)?;

    if service_names.is_empty() {
        return Err("服务器未返回任何服务".to_string());
    }

    // For each service, request its file descriptor
    let mut all_fds_bytes: Vec<Vec<u8>> = Vec::new();
    for svc_name in &service_names {
        let fd_req = build_reflection_file_request(svc_name);
        let fd_req_bytes = encode_message(&fd_req);

        let path2 = "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo"
            .parse::<http::uri::PathAndQuery>()
            .unwrap();

        if let Ok(resp_bytes) = call_reflection_stream(&mut client, &path2, fd_req_bytes.clone()).await {
            if let Ok(fds) = parse_reflection_file_response(&resp_bytes) {
                all_fds_bytes.extend(fds);
            }
        } else {
            // Try v1alpha
            let path_alpha = "/grpc.reflection.v1alpha.ServerReflectionInfo/ServerReflectionInfo"
                .parse::<http::uri::PathAndQuery>()
                .unwrap();
            if let Ok(resp_bytes) = call_reflection_stream(&mut client, &path_alpha, fd_req_bytes).await {
                if let Ok(fds) = parse_reflection_file_response(&resp_bytes) {
                    all_fds_bytes.extend(fds);
                }
            }
        }
    }

    // Build descriptor pool from collected file descriptors
    let mut fds_set = prost_types::FileDescriptorSet { file: Vec::new() };
    for fd_bytes in &all_fds_bytes {
        if let Ok(fd) = prost_types::FileDescriptorProto::decode(fd_bytes.as_slice()) {
            fds_set.file.push(fd);
        }
    }

    let pool = DescriptorPool::from_file_descriptor_set(fds_set)
        .map_err(|e| format!("描述符池构建失败: {}", e))?;
    let services = build_service_infos(&pool);

    let key = format!("reflect:{}", url);
    DESCRIPTOR_POOLS.lock().await.insert(key, pool);

    Ok(ProtoLoadResult {
        services,
        file_name: format!("reflection@{}", url),
    })
}

// ══════════════════════════════════════════════
//  gRPC Calls
// ══════════════════════════════════════════════

/// Make a unary gRPC call
pub async fn call_unary(
    url: &str,
    proto_key: &str,
    method_full_name: &str,
    request_json: &str,
    metadata: &HashMap<String, String>,
) -> Result<GrpcCallResult, String> {
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).ok_or("Proto 未加载，请先加载 .proto 文件或使用 Reflection")?;

    let method_desc = find_method(pool, method_full_name)?;
    let input_desc = method_desc.input();

    // Build request message from JSON
    let mut deserializer = serde_json::Deserializer::from_str(request_json);
    let request_msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("JSON → Protobuf 转换失败: {}", e))?;

    let request_bytes = request_msg.encode_to_vec();
    drop(pools);

    let channel = create_channel(url).await?;
    let mut client = tonic::client::Grpc::new(channel);
    client.ready().await.map_err(|e| format!("连接失败: {}", e))?;

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
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).unwrap();
    let method_desc = find_method(pool, method_full_name)?;
    let output_desc = method_desc.output();

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
    proto_key: &str,
    method_full_name: &str,
    request_json: &str,
    metadata: &HashMap<String, String>,
) -> Result<(), String> {
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).ok_or("Proto 未加载")?;
    let method_desc = find_method(pool, method_full_name)?;
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

    let output_full_name = output_desc.full_name().to_string();
    let proto_key_owned = proto_key.to_string();
    drop(pools);

    let channel = create_channel(url).await?;
    let mut client = tonic::client::Grpc::new(channel.clone());
    client.ready().await.map_err(|e| format!("连接失败: {}", e))?;

    let mut tonic_req = tonic::Request::new(Bytes::from(request_bytes));
    for (k, v) in metadata {
        if let (Ok(key), Ok(val)) = (
            k.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            v.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            tonic_req.metadata_mut().insert(key, val);
        }
    }

    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut conns = connections.lock().await;
        conns.insert(
            connection_id.to_string(),
            GrpcHandle {
                channel,
                cancel: cancel_tx,
                msg_sender: None,
            },
        );
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();

    tokio::spawn(async move {
        let result = client.server_streaming(tonic_req, path, RawBytesCodec).await;

        match result {
            Ok(response) => {
                let mut stream = response.into_inner();
                use futures_util::StreamExt;

                loop {
                    tokio::select! {
                        _ = cancel_rx.changed() => {
                            break;
                        }
                        item = stream.next() => {
                            match item {
                                Some(Ok(resp_bytes)) => {
                                    let pools = DESCRIPTOR_POOLS.lock().await;
                                    let json = if let Some(pool) = pools.get(&proto_key_owned) {
                                        if let Some(msg_desc) = pool.get_message_by_name(&output_full_name) {
                                            match DynamicMessage::decode(msg_desc, resp_bytes) {
                                                Ok(msg) => serde_json::to_string_pretty(&msg).unwrap_or_default(),
                                                Err(e) => format!("{{\"error\": \"解码失败: {}\"}}", e),
                                            }
                                        } else {
                                            "{}".to_string()
                                        }
                                    } else {
                                        "{}".to_string()
                                    };

                                    let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                                        connection_id: conn_id.clone(),
                                        event_type: "data".to_string(),
                                        data: Some(json),
                                        status_code: None,
                                        status_message: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                }
                                Some(Err(e)) => {
                                    let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                                        connection_id: conn_id.clone(),
                                        event_type: "error".to_string(),
                                        data: Some(e.message().to_string()),
                                        status_code: Some(e.code() as i32),
                                        status_message: Some(e.message().to_string()),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                    break;
                                }
                                None => break,
                            }
                        }
                    }
                }

                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "completed".to_string(),
                    data: None,
                    status_code: Some(0),
                    status_message: Some("Stream completed".to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            Err(e) => {
                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "error".to_string(),
                    data: Some(e.message().to_string()),
                    status_code: Some(e.code() as i32),
                    status_message: Some(e.message().to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
        }

        conns.lock().await.remove(&conn_id);
    });

    Ok(())
}

/// Start a client-streaming gRPC call.
/// Returns immediately; use `stream_send_message` to push messages and `stream_close_send` to finish.
/// The single response is emitted as a `grpc-stream-event` with event_type = "data".
pub async fn call_client_stream(
    app: tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    url: &str,
    proto_key: &str,
    method_full_name: &str,
    metadata: &HashMap<String, String>,
) -> Result<(), String> {
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).ok_or("Proto 未加载")?;
    let method_desc = find_method(pool, method_full_name)?;
    let output_desc = method_desc.output();
    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;
    let output_full_name = output_desc.full_name().to_string();
    let proto_key_owned = proto_key.to_string();
    drop(pools);

    let channel = create_channel(url).await?;
    let mut client = tonic::client::Grpc::new(channel.clone());
    client.ready().await.map_err(|e| format!("连接失败: {}", e))?;

    let (msg_tx, msg_rx) = tokio::sync::mpsc::channel::<Bytes>(64);
    let (cancel_tx, _cancel_rx) = tokio::sync::watch::channel(false);

    {
        let mut conns = connections.lock().await;
        conns.insert(
            connection_id.to_string(),
            GrpcHandle {
                channel,
                cancel: cancel_tx,
                msg_sender: Some(msg_tx),
            },
        );
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();

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
        let result = client.client_streaming(tonic_req, path, RawBytesCodec).await;
        match result {
            Ok(response) => {
                let resp_bytes = response.into_inner();
                let pools = DESCRIPTOR_POOLS.lock().await;
                let json = if let Some(pool) = pools.get(&proto_key_owned) {
                    if let Some(msg_desc) = pool.get_message_by_name(&output_full_name) {
                        match DynamicMessage::decode(msg_desc, resp_bytes) {
                            Ok(msg) => serde_json::to_string_pretty(&msg).unwrap_or_default(),
                            Err(e) => format!("{{\"error\": \"解码失败: {}\"}}", e),
                        }
                    } else {
                        "{}".to_string()
                    }
                } else {
                    "{}".to_string()
                };
                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "data".to_string(),
                    data: Some(json),
                    status_code: Some(0),
                    status_message: Some("OK".to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            Err(e) => {
                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "error".to_string(),
                    data: Some(e.message().to_string()),
                    status_code: Some(e.code() as i32),
                    status_message: Some(e.message().to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
        }

        let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
            connection_id: conn_id.clone(),
            event_type: "completed".to_string(),
            data: None,
            status_code: Some(0),
            status_message: Some("Stream completed".to_string()),
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
        conns.lock().await.remove(&conn_id);
    });

    Ok(())
}

/// Start a bidirectional streaming gRPC call.
/// Returns immediately; use `stream_send_message` to push messages.
/// Responses arrive as `grpc-stream-event` events.
pub async fn call_bidi_stream(
    app: tauri::AppHandle,
    connections: &GrpcConnections,
    connection_id: &str,
    url: &str,
    proto_key: &str,
    method_full_name: &str,
    metadata: &HashMap<String, String>,
) -> Result<(), String> {
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).ok_or("Proto 未加载")?;
    let method_desc = find_method(pool, method_full_name)?;
    let output_desc = method_desc.output();
    let path = format!(
        "/{}/{}",
        method_desc.parent_service().full_name(),
        method_desc.name()
    )
    .parse::<http::uri::PathAndQuery>()
    .map_err(|e| format!("Path 解析失败: {}", e))?;
    let output_full_name = output_desc.full_name().to_string();
    let proto_key_owned = proto_key.to_string();
    drop(pools);

    let channel = create_channel(url).await?;
    let mut client = tonic::client::Grpc::new(channel.clone());
    client.ready().await.map_err(|e| format!("连接失败: {}", e))?;

    let (msg_tx, msg_rx) = tokio::sync::mpsc::channel::<Bytes>(64);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

    {
        let mut conns = connections.lock().await;
        conns.insert(
            connection_id.to_string(),
            GrpcHandle {
                channel,
                cancel: cancel_tx,
                msg_sender: Some(msg_tx),
            },
        );
    }

    let conn_id = connection_id.to_string();
    let conns = connections.clone();

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
        let result = client.streaming(tonic_req, path, RawBytesCodec).await;
        match result {
            Ok(response) => {
                let mut resp_stream = response.into_inner();
                use futures_util::StreamExt;

                loop {
                    tokio::select! {
                        _ = cancel_rx.changed() => { break; }
                        item = resp_stream.next() => {
                            match item {
                                Some(Ok(resp_bytes)) => {
                                    let pools = DESCRIPTOR_POOLS.lock().await;
                                    let json = if let Some(pool) = pools.get(&proto_key_owned) {
                                        if let Some(msg_desc) = pool.get_message_by_name(&output_full_name) {
                                            match DynamicMessage::decode(msg_desc, resp_bytes) {
                                                Ok(msg) => serde_json::to_string_pretty(&msg).unwrap_or_default(),
                                                Err(e) => format!("{{\"error\": \"解码失败: {}\"}}", e),
                                            }
                                        } else { "{}".to_string() }
                                    } else { "{}".to_string() };

                                    let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                                        connection_id: conn_id.clone(),
                                        event_type: "data".to_string(),
                                        data: Some(json),
                                        status_code: None,
                                        status_message: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                }
                                Some(Err(e)) => {
                                    let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                                        connection_id: conn_id.clone(),
                                        event_type: "error".to_string(),
                                        data: Some(e.message().to_string()),
                                        status_code: Some(e.code() as i32),
                                        status_message: Some(e.message().to_string()),
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                    break;
                                }
                                None => break,
                            }
                        }
                    }
                }

                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "completed".to_string(),
                    data: None,
                    status_code: Some(0),
                    status_message: Some("Stream completed".to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            Err(e) => {
                let _ = app.emit("grpc-stream-event", GrpcStreamEvent {
                    connection_id: conn_id.clone(),
                    event_type: "error".to_string(),
                    data: Some(e.message().to_string()),
                    status_code: Some(e.code() as i32),
                    status_message: Some(e.message().to_string()),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
        }
        conns.lock().await.remove(&conn_id);
    });

    Ok(())
}

/// Send a message on an active client-streaming or bidi-streaming call
pub async fn stream_send_message(
    connections: &GrpcConnections,
    connection_id: &str,
    proto_key: &str,
    method_full_name: &str,
    message_json: &str,
) -> Result<(), String> {
    let pools = DESCRIPTOR_POOLS.lock().await;
    let pool = pools.get(proto_key).ok_or("Proto 未加载")?;
    let method_desc = find_method(pool, method_full_name)?;
    let input_desc = method_desc.input();

    let mut deserializer = serde_json::Deserializer::from_str(message_json);
    let msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("JSON → Protobuf 转换失败: {}", e))?;
    let msg_bytes = Bytes::from(msg.encode_to_vec());
    drop(pools);

    let conns = connections.lock().await;
    let handle = conns
        .get(connection_id)
        .ok_or("流连接不存在")?;
    let sender = handle
        .msg_sender
        .as_ref()
        .ok_or("此连接不支持发送消息（非 streaming 模式）")?;
    sender
        .send(msg_bytes)
        .await
        .map_err(|_| "发送失败：流已关闭".to_string())
}

/// Close the send side of a client-streaming or bidi-streaming call.
/// For client streams this triggers the server response.
pub async fn stream_close_send(
    connections: &GrpcConnections,
    connection_id: &str,
) -> Result<(), String> {
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
    let mut conns = connections.lock().await;
    if let Some(handle) = conns.remove(connection_id) {
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
    /// Skip server certificate verification (insecure, for testing only)
    pub skip_verify: bool,
}

async fn create_channel(url: &str) -> Result<Channel, String> {
    create_channel_with_tls(url, &GrpcTlsConfig::default()).await
}

pub async fn create_channel_with_tls(url: &str, tls: &GrpcTlsConfig) -> Result<Channel, String> {
    let mut endpoint = Channel::from_shared(url.to_string())
        .map_err(|e| format!("无效的 gRPC 地址: {}", e))?
        .connect_timeout(std::time::Duration::from_secs(10));

    let use_tls = tls.enabled
        || url.starts_with("https://")
        || url.starts_with("grpcs://");

    if use_tls {
        let mut tls_config = tonic::transport::ClientTlsConfig::new();

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
        if let Ok(uri) = url.parse::<http::Uri>() {
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
                            is_repeated: f.cardinality()
                                == prost_reflect::Cardinality::Repeated,
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

async fn call_reflection_stream(
    client: &mut tonic::client::Grpc<Channel>,
    path: &http::uri::PathAndQuery,
    request_bytes: Bytes,
) -> Result<Bytes, String> {
    let req = tonic::Request::new(request_bytes);
    // Reflection is a bidi stream, but for list/file requests we only send one message
    // We use server_streaming as an approximation (send one request, get one response)
    let response = client
        .server_streaming(req, path.clone(), RawBytesCodec)
        .await
        .map_err(|e| format!("Reflection 调用失败: {}", e))?;

    let mut stream = response.into_inner();
    use futures_util::StreamExt;
    match stream.next().await {
        Some(Ok(bytes)) => Ok(bytes),
        Some(Err(e)) => Err(format!("Reflection 响应错误: {}", e)),
        None => Err("Reflection 未返回数据".to_string()),
    }
}

fn parse_reflection_list_response(data: &[u8]) -> Result<Vec<String>, String> {
    // ServerReflectionResponse.list_services_response.service[].name
    // Field 6 = list_services_response (message), which has field 1 = service (repeated message)
    // Each service message has field 1 = name (string)
    // We use a simple manual parser since we don't have the generated types
    let mut names = Vec::new();
    // Try to find string fields in the response - look for service names
    // This is a simplified parser that extracts all strings from the message
    extract_service_names(data, &mut names);
    Ok(names)
}

fn extract_service_names(data: &[u8], names: &mut Vec<String>) {
    let mut i = 0;
    while i < data.len() {
        // Read field tag
        let (tag, new_i) = match decode_varint(data, i) {
            Some(v) => v,
            None => break,
        };
        i = new_i;
        let wire_type = tag & 0x7;
        let _field_number = tag >> 3;

        match wire_type {
            0 => {
                // varint
                match decode_varint(data, i) {
                    Some((_, ni)) => i = ni,
                    None => break,
                }
            }
            1 => {
                // 64-bit
                i += 8;
            }
            2 => {
                // length-delimited
                let (len, ni) = match decode_varint(data, i) {
                    Some(v) => v,
                    None => break,
                };
                i = ni;
                let end = i + len as usize;
                if end > data.len() {
                    break;
                }
                let sub = &data[i..end];
                // Try as string first (field_number == 1 in ServiceResponse)
                if let Ok(s) = std::str::from_utf8(sub) {
                    if !s.is_empty()
                        && s.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_')
                        && s.contains('.')
                    {
                        names.push(s.to_string());
                    }
                }
                // Also recurse into sub-messages
                extract_service_names(sub, names);
                i = end;
            }
            5 => {
                // 32-bit
                i += 4;
            }
            _ => break,
        }
    }
}

fn parse_reflection_file_response(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    // Extract file_descriptor_proto bytes from the response
    let mut fds = Vec::new();
    extract_file_descriptors(data, &mut fds);
    Ok(fds)
}

fn extract_file_descriptors(data: &[u8], fds: &mut Vec<Vec<u8>>) {
    let mut i = 0;
    while i < data.len() {
        let (tag, new_i) = match decode_varint(data, i) {
            Some(v) => v,
            None => break,
        };
        i = new_i;
        let wire_type = tag & 0x7;

        match wire_type {
            0 => {
                match decode_varint(data, i) {
                    Some((_, ni)) => i = ni,
                    None => break,
                }
            }
            1 => {
                i += 8;
            }
            2 => {
                let (len, ni) = match decode_varint(data, i) {
                    Some(v) => v,
                    None => break,
                };
                i = ni;
                let end = i + len as usize;
                if end > data.len() {
                    break;
                }
                let sub = &data[i..end];
                // Try to decode as FileDescriptorProto
                if prost_types::FileDescriptorProto::decode(sub).is_ok() {
                    fds.push(sub.to_vec());
                }
                // Also recurse
                extract_file_descriptors(sub, fds);
                i = end;
            }
            5 => {
                i += 4;
            }
            _ => break,
        }
    }
}

fn decode_varint(data: &[u8], start: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift = 0;
    let mut i = start;
    loop {
        if i >= data.len() {
            return None;
        }
        let b = data[i] as u64;
        result |= (b & 0x7f) << shift;
        i += 1;
        if b & 0x80 == 0 {
            return Some((result, i));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
}
