//! RTMP 协议实现
//! 支持 TCP 握手 (C0/S0/C1/S1/C2/S2)、AMF0 编解码、connect/createStream/play 命令
//! 手写实现，展示原始报文用于协议调试

use std::collections::HashMap;

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::state::{GenerationTagged, ProtocolMessage, StreamEvent};

const DEFAULT_CHUNK_SIZE: usize = 128;
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
const MAX_TRACKED_CHUNK_STREAMS: usize = 128;
const MAX_DECODER_RETAINED_BYTES: usize = 32 * 1024 * 1024;
const MAX_AMF0_DEPTH: usize = 32;
const MAX_AMF0_DECODED_NODES: usize = 4096;
const MAX_AMF0_CONTAINER_ITEMS: usize = 4096;
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

// ── RTMP 握手 ──

/// 执行 RTMP 握手全流程 (C0+C1 → S0+S1+S2 → C2)
pub async fn handshake(
    session_id: &str,
    outer_generation: u64,
    url: &str,
    app: &AppHandle,
) -> Result<TcpStream, String> {
    handshake_with_timeout(
        session_id,
        url,
        Some(app),
        Some(outer_generation),
        HANDSHAKE_TIMEOUT,
    )
    .await
}

async fn handshake_with_timeout(
    session_id: &str,
    url: &str,
    app: Option<&AppHandle>,
    outer_generation: Option<u64>,
    timeout: std::time::Duration,
) -> Result<TcpStream, String> {
    tokio::time::timeout(
        timeout,
        handshake_inner(session_id, url, app, outer_generation),
    )
    .await
    .map_err(|_| format!("RTMP handshake timed out after {:?}", timeout))?
}

async fn handshake_inner(
    session_id: &str,
    url: &str,
    app: Option<&AppHandle>,
    outer_generation: Option<u64>,
) -> Result<TcpStream, String> {
    let (host, port, _app_name, _stream_name) = parse_rtmp_url(url)?;

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("RTMP connect to {} failed: {}", addr, e))?;

    // ── C0: version byte (0x03 = RTMP version 3)
    let c0 = [0x03u8];
    stream
        .write_all(&c0)
        .await
        .map_err(|e| format!("Send C0 failed: {}", e))?;

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "sent",
        "C0 → Version (0x03)",
        &format!("RTMP Handshake C0\nVersion: 3\nBytes: {:02X}", c0[0]),
    );

    // ── C1: 1536 bytes (timestamp + zero + random)
    let mut c1 = vec![0u8; 1536];
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as u32;
    c1[0..4].copy_from_slice(&ts.to_be_bytes());
    c1[4..8].copy_from_slice(&[0, 0, 0, 0]); // zero
    // Fill rest with pseudo-random
    for i in 8..1536 {
        c1[i] = ((i * 37 + 13) % 256) as u8;
    }
    stream
        .write_all(&c1)
        .await
        .map_err(|e| format!("Send C1 failed: {}", e))?;

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "sent",
        "C1 → Handshake (1536 bytes)",
        &format!(
            "RTMP Handshake C1\nTimestamp: {}\nSize: 1536 bytes\nFirst 16 bytes: {}",
            ts,
            hex_preview(&c1, 16)
        ),
    );

    // ── Read S0 (1 byte)
    let mut s0 = [0u8; 1];
    stream
        .read_exact(&mut s0)
        .await
        .map_err(|e| format!("Read S0 failed: {}", e))?;

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "received",
        &format!("S0 ← Version (0x{:02X})", s0[0]),
        &format!(
            "RTMP Handshake S0\nServer version: {}\nBytes: {:02X}",
            s0[0], s0[0]
        ),
    );

    // ── Read S1 (1536 bytes)
    let mut s1 = vec![0u8; 1536];
    stream
        .read_exact(&mut s1)
        .await
        .map_err(|e| format!("Read S1 failed: {}", e))?;

    let s1_ts = u32::from_be_bytes([s1[0], s1[1], s1[2], s1[3]]);
    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "received",
        "S1 ← Handshake (1536 bytes)",
        &format!(
            "RTMP Handshake S1\nServer timestamp: {}\nSize: 1536 bytes\nFirst 16 bytes: {}",
            s1_ts,
            hex_preview(&s1, 16)
        ),
    );

    // ── Read S2 (1536 bytes) — echo of C1
    let mut s2 = vec![0u8; 1536];
    stream
        .read_exact(&mut s2)
        .await
        .map_err(|e| format!("Read S2 failed: {}", e))?;

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "received",
        "S2 ← Echo of C1 (1536 bytes)",
        &format!(
            "RTMP Handshake S2\nSize: 1536 bytes\nFirst 16 bytes: {}",
            hex_preview(&s2, 16)
        ),
    );

    // ── C2: echo of S1
    stream
        .write_all(&s1)
        .await
        .map_err(|e| format!("Send C2 failed: {}", e))?;

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "sent",
        "C2 → Echo of S1 (1536 bytes)",
        &format!("RTMP Handshake C2\nSize: 1536 bytes (echo of S1)"),
    );

    emit_handshake_protocol_msg(
        app,
        session_id,
        outer_generation,
        "info",
        "RTMP handshake completed successfully",
        &format!(
            "Server: {}:{}\nClient version: 3\nServer version: {}",
            host, port, s0[0]
        ),
    );

    Ok(stream)
}

fn emit_handshake_protocol_msg(
    app: Option<&AppHandle>,
    session_id: &str,
    outer_generation: Option<u64>,
    direction: &str,
    summary: &str,
    detail: &str,
) {
    if let Some(app) = app {
        emit_protocol_msg(
            app,
            session_id,
            outer_generation,
            direction,
            summary,
            detail,
        );
    }
}

// ── AMF0 编码 ──

fn amf0_encode_string(s: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x02); // string marker
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
    buf
}

fn amf0_encode_number(n: f64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x00); // number marker
    buf.extend_from_slice(&n.to_be_bytes());
    buf
}

fn amf0_encode_object(pairs: &[(&str, AmfValue)]) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x03); // object marker
    for (key, value) in pairs {
        buf.extend_from_slice(&(key.len() as u16).to_be_bytes());
        buf.extend_from_slice(key.as_bytes());
        match value {
            AmfValue::Number(n) => buf.extend(amf0_encode_number_raw(*n)),
            AmfValue::String(s) => buf.extend(amf0_encode_string_raw(s)),
            AmfValue::Boolean(b) => {
                buf.push(0x01);
                buf.push(if *b { 1 } else { 0 });
            }
        }
    }
    // Object end marker
    buf.extend_from_slice(&[0x00, 0x00, 0x09]);
    buf
}

fn amf0_encode_number_raw(n: f64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x00);
    buf.extend_from_slice(&n.to_be_bytes());
    buf
}

fn amf0_encode_string_raw(s: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0x02);
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
    buf
}

enum AmfValue<'a> {
    Number(f64),
    String(&'a str),
    Boolean(bool),
}

// ── AMF0 解码 ──

struct Amf0Reader<'a> {
    data: &'a [u8],
    offset: usize,
    decoded_nodes: usize,
    container_items: usize,
}

impl<'a> Amf0Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            offset: 0,
            decoded_nodes: 0,
            container_items: 0,
        }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.offset)
    }

    fn read_exact(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or_else(|| "AMF0 length overflow".to_string())?;
        if end > self.data.len() {
            return Err(format!(
                "Truncated AMF0 value: need {} bytes, have {}",
                len,
                self.remaining()
            ));
        }
        let value = &self.data[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        Ok(self.read_exact(1)?[0])
    }

    fn read_u16(&mut self) -> Result<u16, String> {
        let bytes = self.read_exact(2)?;
        Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let bytes = self.read_exact(4)?;
        Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn read_f64(&mut self) -> Result<f64, String> {
        let bytes = self.read_exact(8)?;
        Ok(f64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    fn read_utf8(&mut self, len: usize) -> Result<String, String> {
        std::str::from_utf8(self.read_exact(len)?)
            .map(str::to_owned)
            .map_err(|e| format!("Invalid AMF0 UTF-8 string: {}", e))
    }

    fn read_short_string(&mut self) -> Result<String, String> {
        let len = self.read_u16()? as usize;
        self.read_utf8(len)
    }

    fn read_long_string(&mut self) -> Result<String, String> {
        let len = self.read_u32()? as usize;
        self.read_utf8(len)
    }

    fn charge_node(&mut self) -> Result<(), String> {
        if self.decoded_nodes >= MAX_AMF0_DECODED_NODES {
            return Err(format!(
                "AMF0 decoded node budget ({}) exceeded",
                MAX_AMF0_DECODED_NODES
            ));
        }
        self.decoded_nodes += 1;
        Ok(())
    }

    fn charge_container_items(&mut self, count: usize) -> Result<(), String> {
        if count > MAX_AMF0_CONTAINER_ITEMS.saturating_sub(self.container_items) {
            return Err(format!(
                "AMF0 container item budget ({}) exceeded",
                MAX_AMF0_CONTAINER_ITEMS
            ));
        }
        self.container_items += count;
        Ok(())
    }

    fn read_object_entries(&mut self, child_depth: usize) -> Result<Map<String, Value>, String> {
        let mut values = Map::new();
        loop {
            if self.remaining() >= 3
                && self.data[self.offset] == 0
                && self.data[self.offset + 1] == 0
                && self.data[self.offset + 2] == 0x09
            {
                self.offset += 3;
                return Ok(values);
            }

            self.charge_container_items(1)?;
            let key = self.read_short_string()?;
            let value = self.read_value_at_depth(child_depth)?;
            values.insert(key, value);
        }
    }

    fn read_value(&mut self) -> Result<Value, String> {
        self.read_value_at_depth(0)
    }

    fn read_value_at_depth(&mut self, depth: usize) -> Result<Value, String> {
        if depth >= MAX_AMF0_DEPTH {
            return Err(format!(
                "AMF0 maximum recursion depth ({}) exceeded",
                MAX_AMF0_DEPTH
            ));
        }
        self.charge_node()?;

        match self.read_u8()? {
            0x00 => {
                let value = self.read_f64()?;
                Ok(serde_json::Number::from_f64(value)
                    .map(Value::Number)
                    .unwrap_or(Value::Null))
            }
            0x01 => Ok(Value::Bool(self.read_u8()? != 0)),
            0x02 => Ok(Value::String(self.read_short_string()?)),
            0x03 => Ok(Value::Object(self.read_object_entries(depth + 1)?)),
            0x05 | 0x06 | 0x0D => Ok(Value::Null),
            0x07 => {
                let _reference_index = self.read_u16()?;
                Ok(Value::Null)
            }
            0x08 => {
                let _declared_count = self.read_u32()?;
                Ok(Value::Object(self.read_object_entries(depth + 1)?))
            }
            0x0A => {
                let count = self.read_u32()? as usize;
                self.charge_container_items(count)?;
                let mut values = Vec::with_capacity(count.min(1024));
                for _ in 0..count {
                    values.push(self.read_value_at_depth(depth + 1)?);
                }
                Ok(Value::Array(values))
            }
            0x0B => {
                let milliseconds = self.read_f64()?;
                let _timezone = self.read_u16()?;
                Ok(serde_json::Number::from_f64(milliseconds)
                    .map(Value::Number)
                    .unwrap_or(Value::Null))
            }
            0x0C | 0x0F => Ok(Value::String(self.read_long_string()?)),
            0x10 => {
                let _class_name = self.read_short_string()?;
                Ok(Value::Object(self.read_object_entries(depth + 1)?))
            }
            marker => Err(format!("Unsupported AMF0 marker 0x{:02X}", marker)),
        }
    }
}

/// Decode the payload of an RTMP AMF data message and return its onMetaData object.
/// Both the regular `onMetaData` form and the `@setDataFrame`, `onMetaData` form are accepted.
fn parse_on_metadata(payload: &[u8]) -> Result<Option<Map<String, Value>>, String> {
    let mut reader = Amf0Reader::new(payload);
    let first = reader.read_value()?;
    let Some(mut event_name) = first.as_str().map(str::to_owned) else {
        return Ok(None);
    };

    if event_name == "@setDataFrame" {
        let second = reader.read_value()?;
        let Some(name) = second.as_str() else {
            return Ok(None);
        };
        event_name = name.to_string();
    }

    if event_name != "onMetaData" {
        return Ok(None);
    }

    match reader.read_value()? {
        Value::Object(metadata) => Ok(Some(metadata)),
        _ => Err("onMetaData payload is not an AMF0 object or ECMA array".to_string()),
    }
}

// ── RTMP Chunk 编码 ──

#[derive(Debug, Clone)]
struct ChunkStreamState {
    timestamp: u32,
    timestamp_delta: u32,
    message_length: usize,
    message_type_id: u8,
    _message_stream_id: u32,
    extended_timestamp: bool,
    payload: Vec<u8>,
    in_progress: bool,
}

#[derive(Debug)]
struct RtmpMessage {
    message_type_id: u8,
    payload: Vec<u8>,
}

/// Incremental RTMP chunk decoder kept with a session so reads from connect/createStream/play
/// share chunk-size and compressed-header state.
pub(crate) struct RtmpChunkDecoder {
    buffer: Vec<u8>,
    chunk_size: usize,
    streams: HashMap<u32, ChunkStreamState>,
}

impl Default for RtmpChunkDecoder {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            chunk_size: DEFAULT_CHUNK_SIZE,
            streams: HashMap::new(),
        }
    }
}

impl RtmpChunkDecoder {
    fn retained_bytes(&self) -> usize {
        self.streams
            .values()
            .fold(self.buffer.len(), |total, state| {
                total.saturating_add(state.payload.len())
            })
    }

    fn ensure_retained_capacity(&self, additional: usize) -> Result<(), String> {
        let retained = self.retained_bytes();
        if additional > MAX_DECODER_RETAINED_BYTES.saturating_sub(retained) {
            return Err(format!(
                "RTMP decoder retained-byte budget ({}) exceeded",
                MAX_DECODER_RETAINED_BYTES
            ));
        }
        Ok(())
    }

    fn push(&mut self, data: &[u8]) -> Result<Vec<RtmpMessage>, String> {
        self.ensure_retained_capacity(data.len())?;
        self.buffer.extend_from_slice(data);
        let mut messages = Vec::new();

        loop {
            let Some((format, chunk_stream_id, basic_header_len)) =
                parse_basic_header(&self.buffer)
            else {
                break;
            };

            let message_header_len = match format {
                0 => 11,
                1 => 7,
                2 => 3,
                3 => 0,
                _ => unreachable!(),
            };
            let header_end = basic_header_len + message_header_len;
            if self.buffer.len() < header_end {
                break;
            }

            let previous = self.streams.get(&chunk_stream_id);
            if format != 0 && previous.is_none() {
                return Err(format!(
                    "RTMP chunk stream {} used compressed header before a full header",
                    chunk_stream_id
                ));
            }
            if format != 3 && previous.is_some_and(|state| state.in_progress) {
                return Err(format!(
                    "RTMP chunk stream {} started a new message before its previous message completed",
                    chunk_stream_id
                ));
            }

            let message_header = &self.buffer[basic_header_len..header_end];
            let raw_timestamp = if format < 3 {
                read_u24(&message_header[..3])
            } else {
                0
            };
            let extended_timestamp = if format == 3 {
                previous
                    .as_ref()
                    .map(|state| state.extended_timestamp)
                    .unwrap_or(false)
            } else {
                raw_timestamp == 0x00FF_FFFF
            };
            let extended_timestamp_len = usize::from(extended_timestamp) * 4;
            if self.buffer.len() < header_end + extended_timestamp_len {
                break;
            }
            let extended_value = if extended_timestamp {
                let bytes = &self.buffer[header_end..header_end + 4];
                Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            } else {
                None
            };

            let message_length = match format {
                0 | 1 => read_u24(&message_header[3..6]) as usize,
                2 | 3 => previous.expect("checked above").message_length,
                _ => unreachable!(),
            };
            if message_length > MAX_MESSAGE_SIZE {
                return Err(format!(
                    "RTMP message is too large: {} bytes",
                    message_length
                ));
            }

            let payload_len = if format == 3 {
                previous
                    .expect("checked above")
                    .in_progress
                    .then(|| previous.expect("checked above").payload.len())
                    .unwrap_or(0)
            } else {
                0
            };
            let remaining = message_length.saturating_sub(payload_len);
            let chunk_payload_len = remaining.min(self.chunk_size);
            let chunk_end = header_end + extended_timestamp_len + chunk_payload_len;
            if self.buffer.len() < chunk_end {
                break;
            }

            if previous.is_none() && self.streams.len() >= MAX_TRACKED_CHUNK_STREAMS {
                return Err(format!(
                    "RTMP tracked chunk-stream budget ({}) exceeded",
                    MAX_TRACKED_CHUNK_STREAMS
                ));
            }

            // The chunk bytes still live in the input buffer while they are copied into the
            // in-progress payload, so account for that short-lived duplication as well.
            self.ensure_retained_capacity(chunk_payload_len)?;
            let previous = self.streams.remove(&chunk_stream_id);
            let mut state = match format {
                0 => {
                    let timestamp = extended_value.unwrap_or(raw_timestamp);
                    ChunkStreamState {
                        timestamp,
                        timestamp_delta: 0,
                        message_length,
                        message_type_id: message_header[6],
                        _message_stream_id: u32::from_le_bytes([
                            message_header[7],
                            message_header[8],
                            message_header[9],
                            message_header[10],
                        ]),
                        extended_timestamp,
                        payload: Vec::new(),
                        in_progress: true,
                    }
                }
                1 => {
                    let mut state = previous.expect("checked above");
                    let delta = extended_value.unwrap_or(raw_timestamp);
                    state.timestamp = state.timestamp.wrapping_add(delta);
                    state.timestamp_delta = delta;
                    state.message_length = message_length;
                    state.message_type_id = message_header[6];
                    state.extended_timestamp = extended_timestamp;
                    state.payload = Vec::new();
                    state.in_progress = true;
                    state
                }
                2 => {
                    let mut state = previous.expect("checked above");
                    let delta = extended_value.unwrap_or(raw_timestamp);
                    state.timestamp = state.timestamp.wrapping_add(delta);
                    state.timestamp_delta = delta;
                    state.extended_timestamp = extended_timestamp;
                    state.payload = Vec::new();
                    state.in_progress = true;
                    state
                }
                3 => {
                    let mut state = previous.expect("checked above");
                    if !state.in_progress {
                        state.timestamp = state.timestamp.wrapping_add(state.timestamp_delta);
                        state.payload = Vec::new();
                        state.in_progress = true;
                    }
                    state
                }
                _ => unreachable!(),
            };

            state
                .payload
                .try_reserve_exact(chunk_payload_len)
                .map_err(|error| format!("Unable to reserve RTMP decoder payload: {}", error))?;
            state
                .payload
                .extend_from_slice(&self.buffer[header_end + extended_timestamp_len..chunk_end]);
            self.buffer.drain(..chunk_end);

            if state.payload.len() == state.message_length {
                let payload = std::mem::take(&mut state.payload);
                state.in_progress = false;

                if state.message_type_id == 0x01 && payload.len() >= 4 {
                    let new_chunk_size =
                        (u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]])
                            & 0x7FFF_FFFF) as usize;
                    if new_chunk_size == 0 || new_chunk_size > MAX_MESSAGE_SIZE {
                        return Err(format!("Invalid RTMP chunk size: {}", new_chunk_size));
                    }
                    self.chunk_size = new_chunk_size;
                }

                messages.push(RtmpMessage {
                    message_type_id: state.message_type_id,
                    payload,
                });
            }

            self.streams.insert(chunk_stream_id, state);
        }

        Ok(messages)
    }
}

fn parse_basic_header(data: &[u8]) -> Option<(u8, u32, usize)> {
    let first = *data.first()?;
    let format = first >> 6;
    match first & 0x3F {
        0 => Some((format, data.get(1).copied()? as u32 + 64, 2)),
        1 => Some((
            format,
            data.get(1).copied()? as u32 + (data.get(2).copied()? as u32 * 256) + 64,
            3,
        )),
        chunk_stream_id => Some((format, chunk_stream_id as u32, 1)),
    }
}

fn read_u24(data: &[u8]) -> u32 {
    ((data[0] as u32) << 16) | ((data[1] as u32) << 8) | data[2] as u32
}

fn build_rtmp_chunk(
    chunk_stream_id: u8,
    msg_type_id: u8,
    msg_stream_id: u32,
    payload: &[u8],
) -> Vec<u8> {
    let mut buf = Vec::new();

    // Chunk Basic Header (fmt=0, csid)
    buf.push(chunk_stream_id & 0x3F); // fmt=0 (full header)

    // Chunk Message Header (fmt 0 = 11 bytes)
    // Timestamp (3 bytes)
    buf.extend_from_slice(&[0x00, 0x00, 0x00]);
    // Message length (3 bytes)
    let len = payload.len() as u32;
    buf.push(((len >> 16) & 0xFF) as u8);
    buf.push(((len >> 8) & 0xFF) as u8);
    buf.push((len & 0xFF) as u8);
    // Message type ID (1 byte)
    buf.push(msg_type_id);
    // Message stream ID (4 bytes, little-endian)
    buf.extend_from_slice(&msg_stream_id.to_le_bytes());

    // Payload, split at the RTMP default chunk size. Continuation chunks use fmt=3.
    let first_chunk_len = payload.len().min(DEFAULT_CHUNK_SIZE);
    buf.extend_from_slice(&payload[..first_chunk_len]);
    let mut offset = first_chunk_len;
    while offset < payload.len() {
        buf.push(0xC0 | (chunk_stream_id & 0x3F));
        let end = (offset + DEFAULT_CHUNK_SIZE).min(payload.len());
        buf.extend_from_slice(&payload[offset..end]);
        offset = end;
    }

    buf
}

fn build_play_chunk(stream_key: &str, message_stream_id: u32) -> (Vec<u8>, usize) {
    let mut payload = Vec::new();
    payload.extend(amf0_encode_string("play"));
    payload.extend(amf0_encode_number(0.0)); // transaction ID
    payload.push(0x05); // null command object
    payload.extend(amf0_encode_string(stream_key));
    let payload_len = payload.len();
    (
        build_rtmp_chunk(8, 0x14, message_stream_id, &payload),
        payload_len,
    )
}

#[derive(Default)]
struct ReadSummary {
    bytes: usize,
    preview: Vec<u8>,
}

struct WaitCommandResult {
    summary: ReadSummary,
    return_value: Option<Value>,
}

struct AmfCommandResponse {
    name: String,
    transaction_id: f64,
    return_value: Option<Value>,
}

impl ReadSummary {
    fn observe(&mut self, data: &[u8]) {
        self.bytes += data.len();
        let remaining = 32usize.saturating_sub(self.preview.len());
        self.preview
            .extend_from_slice(&data[..data.len().min(remaining)]);
    }
}

fn amf_message_payload(message: &RtmpMessage, amf0_type: u8, amf3_type: u8) -> Option<&[u8]> {
    if message.message_type_id == amf0_type {
        Some(&message.payload)
    } else if message.message_type_id == amf3_type {
        Some(
            message
                .payload
                .strip_prefix(&[0x00])
                .unwrap_or(&message.payload),
        )
    } else {
        None
    }
}

fn parse_command_response(message: &RtmpMessage) -> Result<Option<AmfCommandResponse>, String> {
    let Some(payload) = amf_message_payload(message, 0x14, 0x11) else {
        return Ok(None);
    };
    let mut reader = Amf0Reader::new(payload);
    let name = reader.read_value()?;
    let Some(name) = name.as_str().map(str::to_owned) else {
        return Ok(None);
    };
    let transaction_id = reader.read_value()?;
    let Some(transaction_id) = transaction_id.as_f64() else {
        return Ok(None);
    };

    // The third AMF value is the command object. createStream's returned stream ID is fourth.
    if reader.remaining() > 0 {
        let _command_object = reader.read_value()?;
    }
    let return_value = if reader.remaining() > 0 {
        Some(reader.read_value()?)
    } else {
        None
    };

    Ok(Some(AmfCommandResponse {
        name,
        transaction_id,
        return_value,
    }))
}

fn matching_command_response(
    message: &RtmpMessage,
    expected_transaction_id: f64,
) -> Result<Option<AmfCommandResponse>, String> {
    let Some(response) = parse_command_response(message)? else {
        return Ok(None);
    };
    if response.transaction_id != expected_transaction_id
        || (response.name != "_result" && response.name != "_error")
    {
        return Ok(None);
    }
    Ok(Some(response))
}

fn create_stream_id(return_value: Option<&Value>) -> Result<u32, String> {
    let stream_id = return_value
        .and_then(Value::as_f64)
        .ok_or_else(|| "createStream response did not include a numeric stream ID".to_string())?;
    if !stream_id.is_finite()
        || stream_id < 1.0
        || stream_id > u32::MAX as f64
        || stream_id.fract() != 0.0
    {
        return Err(format!(
            "createStream returned invalid stream ID: {}",
            stream_id
        ));
    }
    Ok(stream_id as u32)
}

fn metadata_from_message(message: &RtmpMessage) -> Result<Option<Map<String, Value>>, String> {
    let Some(payload) = amf_message_payload(message, 0x12, 0x0F) else {
        return Ok(None);
    };
    parse_on_metadata(payload)
}

/// Return a user-facing failure when the play command is rejected. RTMP play
/// uses transaction id 0 and reports failures through `onStatus` (or `_error`),
/// so waiting only for metadata can otherwise turn StreamNotFound into success.
fn play_command_failure(message: &RtmpMessage) -> Result<Option<String>, String> {
    let Some(response) = parse_command_response(message)? else {
        return Ok(None);
    };
    if response.name != "onStatus" && response.name != "_error" {
        return Ok(None);
    }

    let status = response.return_value.as_ref().and_then(Value::as_object);
    let level = status
        .and_then(|value| value.get("level"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let code = status
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let description = status
        .and_then(|value| value.get("description"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let known_failure = matches!(
        code,
        "NetStream.Play.StreamNotFound"
            | "NetStream.Play.Failed"
            | "NetStream.Play.FileStructureInvalid"
            | "NetStream.Play.NoSupportedTrackFound"
    );
    if response.name != "_error" && !level.eq_ignore_ascii_case("error") && !known_failure {
        return Ok(None);
    }

    let mut details = Vec::new();
    if !code.is_empty() {
        details.push(code);
    }
    if !description.is_empty() {
        details.push(description);
    }
    if details.is_empty() {
        details.push(if response.name == "_error" {
            "server returned _error"
        } else {
            "server returned an error status"
        });
    }
    Ok(Some(format!("RTMP play failed: {}", details.join(": "))))
}

async fn read_messages(
    stream: &mut TcpStream,
    decoder: &mut RtmpChunkDecoder,
    timeout: std::time::Duration,
    context: &str,
) -> Result<(Vec<RtmpMessage>, Vec<u8>), String> {
    let mut buffer = vec![0u8; 16 * 1024];
    let read = tokio::time::timeout(timeout, stream.read(&mut buffer))
        .await
        .map_err(|_| format!("{} timeout", context))?
        .map_err(|e| format!("{} failed: {}", context, e))?;
    if read == 0 {
        return Err(format!("{} failed: server closed the connection", context));
    }
    buffer.truncate(read);
    let messages = decoder.push(&buffer)?;
    Ok((messages, buffer))
}

async fn wait_for_command_result(
    stream: &mut TcpStream,
    decoder: &mut RtmpChunkDecoder,
    context: &str,
    expected_transaction_id: f64,
) -> Result<WaitCommandResult, String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut summary = ReadSummary::default();

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("{} timeout", context));
        }
        let (messages, raw) = read_messages(stream, decoder, remaining, context).await?;
        summary.observe(&raw);

        for message in messages {
            let Some(response) = matching_command_response(&message, expected_transaction_id)?
            else {
                continue;
            };
            if response.name == "_result" {
                return Ok(WaitCommandResult {
                    summary,
                    return_value: response.return_value,
                });
            }
            return Err(format!(
                "{} returned _error for transaction {}",
                context, expected_transaction_id
            ));
        }
    }
}

async fn wait_for_metadata(
    stream: &mut TcpStream,
    decoder: &mut RtmpChunkDecoder,
) -> Result<(Option<Map<String, Value>>, ReadSummary, Option<String>), String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut summary = ReadSummary::default();
    let mut parse_error = None;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Ok((None, summary, parse_error));
        }

        let (messages, raw) = match read_messages(stream, decoder, remaining, "play response").await
        {
            Ok(result) => result,
            Err(error) if summary.bytes > 0 && error.ends_with(" timeout") => {
                return Ok((None, summary, parse_error));
            }
            Err(error) => return Err(error),
        };
        summary.observe(&raw);

        for message in messages {
            if let Some(error) = play_command_failure(&message)? {
                return Err(error);
            }
            match metadata_from_message(&message) {
                Ok(Some(metadata)) => return Ok((Some(metadata), summary, parse_error)),
                Ok(None) => {}
                Err(error) => parse_error = Some(error),
            }
        }
    }
}

fn emit_metadata(
    app: &AppHandle,
    session_id: &str,
    outer_generation: u64,
    metadata: &Map<String, Value>,
) {
    let detail = serde_json::to_string_pretty(metadata).unwrap_or_else(|_| "{}".to_string());
    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "received",
        &format!("onMetaData ({} fields)", metadata.len()),
        &detail,
    );

    let data = serde_json::json!({
        "kind": "rtmp-metadata",
        "metadata": metadata,
    });
    let event = StreamEvent {
        session_id: session_id.to_string(),
        generation: Some(outer_generation),
        event_type: "protocol-data".to_string(),
        data: Some(data.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("videostream-event", &event);
}

// ── RTMP connect 命令 ──

pub async fn connect_app(
    stream: &mut TcpStream,
    decoder: &mut RtmpChunkDecoder,
    session_id: &str,
    outer_generation: u64,
    url: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let (_host, _port, app_name, _stream_name) = parse_rtmp_url(url)?;

    // tcUrl = rtmp://host[:port]/app (without stream key, per RTMP spec)
    let tc_url = {
        let without_scheme = url.strip_prefix("rtmp://").unwrap_or(url);
        match without_scheme.find('/') {
            Some(first_slash) => {
                let after_host = &without_scheme[first_slash + 1..];
                // app is everything before the next '/'
                match after_host.find('/') {
                    Some(second_slash) => format!(
                        "rtmp://{}/{}",
                        &without_scheme[..first_slash],
                        &after_host[..second_slash]
                    ),
                    None => format!("rtmp://{}/{}", &without_scheme[..first_slash], after_host),
                }
            }
            None => url.to_string(),
        }
    };

    // Build connect command
    let mut payload = Vec::new();
    payload.extend(amf0_encode_string("connect"));
    payload.extend(amf0_encode_number(1.0)); // transaction ID

    // Command object
    payload.extend(amf0_encode_object(&[
        ("app", AmfValue::String(&app_name)),
        ("flashVer", AmfValue::String("ProtoForge/1.0")),
        ("tcUrl", AmfValue::String(&tc_url)),
        ("fpad", AmfValue::Boolean(false)),
        ("capabilities", AmfValue::Number(239.0)),
        ("audioCodecs", AmfValue::Number(3575.0)),
        ("videoCodecs", AmfValue::Number(252.0)),
        ("videoFunction", AmfValue::Number(1.0)),
    ]));

    let chunk = build_rtmp_chunk(3, 0x14, 0, &payload); // 0x14 = AMF0 command

    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "sent",
        "connect command (AMF0)",
        &format!(
            "RTMP connect\nApp: {}\ntcUrl: {}\nPayload size: {} bytes\nChunk size: {} bytes",
            app_name,
            url,
            payload.len(),
            chunk.len()
        ),
    );

    stream
        .write_all(&chunk)
        .await
        .map_err(|e| format!("Send connect failed: {}", e))?;

    let response = wait_for_command_result(stream, decoder, "connect response", 1.0).await?;
    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "received",
        &format!("connect response ({} bytes)", response.summary.bytes),
        &format!(
            "RTMP connect response\nSize: {} bytes\nFirst 32 bytes: {}",
            response.summary.bytes,
            hex_preview(&response.summary.preview, 32)
        ),
    );

    Ok(())
}

// ── RTMP play 命令 ──

pub async fn play(
    stream: &mut TcpStream,
    decoder: &mut RtmpChunkDecoder,
    session_id: &str,
    outer_generation: u64,
    stream_key: &str,
    app: &AppHandle,
) -> Result<(), String> {
    // createStream command
    let mut cs_payload = Vec::new();
    cs_payload.extend(amf0_encode_string("createStream"));
    cs_payload.extend(amf0_encode_number(2.0)); // transaction ID
    cs_payload.push(0x05); // null

    let cs_chunk = build_rtmp_chunk(3, 0x14, 0, &cs_payload);

    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "sent",
        "createStream command",
        &format!(
            "RTMP createStream\nTransaction ID: 2\nPayload: {} bytes",
            cs_payload.len()
        ),
    );

    stream
        .write_all(&cs_chunk)
        .await
        .map_err(|e| format!("Send createStream failed: {}", e))?;

    let create_stream_response =
        wait_for_command_result(stream, decoder, "createStream response", 2.0).await?;
    let message_stream_id = create_stream_id(create_stream_response.return_value.as_ref())?;
    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "received",
        &format!(
            "createStream response ({} bytes)",
            create_stream_response.summary.bytes
        ),
        &format!(
            "Size: {} bytes\nMessage stream ID: {}\nFirst 32 bytes: {}",
            create_stream_response.summary.bytes,
            message_stream_id,
            hex_preview(&create_stream_response.summary.preview, 32)
        ),
    );

    // play command
    let (play_chunk, play_payload_len) = build_play_chunk(stream_key, message_stream_id);

    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "sent",
        &format!("play \"{}\"", stream_key),
        &format!(
            "RTMP play\nStream key: {}\nMessage stream ID: {}\nPayload: {} bytes",
            stream_key, message_stream_id, play_payload_len
        ),
    );

    stream
        .write_all(&play_chunk)
        .await
        .map_err(|e| format!("Send play failed: {}", e))?;

    let (metadata, response, parse_error) = wait_for_metadata(stream, decoder).await?;
    emit_protocol_msg(
        app,
        session_id,
        Some(outer_generation),
        "received",
        &format!("play response ({} bytes)", response.bytes),
        &format!(
            "Size: {} bytes\nFirst 32 bytes: {}",
            response.bytes,
            hex_preview(&response.preview, 32)
        ),
    );
    if let Some(error) = parse_error {
        emit_protocol_msg(
            app,
            session_id,
            Some(outer_generation),
            "info",
            "Unable to decode RTMP metadata",
            &error,
        );
    }
    if let Some(metadata) = metadata {
        emit_metadata(app, session_id, outer_generation, &metadata);
    }

    Ok(())
}

// ── 辅助函数 ──

fn parse_rtmp_url(url: &str) -> Result<(String, u16, String, String), String> {
    let without_scheme = url
        .strip_prefix("rtmp://")
        .ok_or_else(|| "URL must start with rtmp://".to_string())?;

    let (host_port, path) = match without_scheme.find('/') {
        Some(idx) => (&without_scheme[..idx], &without_scheme[idx + 1..]),
        None => (without_scheme, ""),
    };

    let (host, port) = match host_port.rfind(':') {
        Some(idx) => {
            let port = host_port[idx + 1..].parse::<u16>().unwrap_or(1935);
            (host_port[..idx].to_string(), port)
        }
        None => (host_port.to_string(), 1935),
    };

    // Split path into app_name/stream_name
    let (app_name, stream_name) = match path.find('/') {
        Some(idx) => (path[..idx].to_string(), path[idx + 1..].to_string()),
        None => (path.to_string(), String::new()),
    };

    Ok((host, port, app_name, stream_name))
}

fn hex_preview(data: &[u8], max: usize) -> String {
    let len = data.len().min(max);
    data[..len]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

fn emit_protocol_msg(
    app: &AppHandle,
    session_id: &str,
    outer_generation: Option<u64>,
    direction: &str,
    summary: &str,
    detail: &str,
) {
    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        direction: direction.to_string(),
        protocol: "rtmp".to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    if let Some(generation) = outer_generation {
        let _ = app.emit(
            "videostream-protocol-msg",
            &GenerationTagged::new(&msg, generation),
        );
    } else {
        let _ = app.emit("videostream-protocol-msg", &msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn push_property(payload: &mut Vec<u8>, key: &str, value: Vec<u8>) {
        payload.extend_from_slice(&(key.len() as u16).to_be_bytes());
        payload.extend_from_slice(key.as_bytes());
        payload.extend(value);
    }

    fn push_u24(buffer: &mut Vec<u8>, value: usize) {
        buffer.extend_from_slice(&[
            ((value >> 16) & 0xFF) as u8,
            ((value >> 8) & 0xFF) as u8,
            (value & 0xFF) as u8,
        ]);
    }

    fn push_first_chunk(
        wire: &mut Vec<u8>,
        chunk_stream_id: u8,
        message_type_id: u8,
        message_length: usize,
        payload: &[u8],
    ) {
        wire.push(chunk_stream_id & 0x3F);
        wire.extend_from_slice(&[0, 0, 0]);
        push_u24(wire, message_length);
        wire.push(message_type_id);
        wire.extend_from_slice(&1u32.to_le_bytes());
        wire.extend_from_slice(payload);
    }

    #[test]
    fn parses_on_metadata_ecma_array() {
        let mut payload = amf0_encode_string("onMetaData");
        payload.push(0x08);
        payload.extend_from_slice(&4u32.to_be_bytes());
        push_property(&mut payload, "duration", amf0_encode_number_raw(12.5));
        push_property(&mut payload, "width", amf0_encode_number_raw(1920.0));
        push_property(&mut payload, "stereo", vec![0x01, 0x01]);
        push_property(&mut payload, "videocodecid", amf0_encode_string_raw("avc1"));
        payload.extend_from_slice(&[0x00, 0x00, 0x09]);

        let metadata = parse_on_metadata(&payload)
            .expect("metadata should decode")
            .expect("onMetaData should be recognized");

        assert_eq!(metadata.get("duration"), Some(&json!(12.5)));
        assert_eq!(metadata.get("width"), Some(&json!(1920.0)));
        assert_eq!(metadata.get("stereo"), Some(&json!(true)));
        assert_eq!(metadata.get("videocodecid"), Some(&json!("avc1")));
    }

    #[test]
    fn parses_set_data_frame_and_reassembled_chunked_metadata() {
        let mut payload = amf0_encode_string("@setDataFrame");
        payload.extend(amf0_encode_string("onMetaData"));
        payload.push(0x03);

        let long_encoder = "ProtoForge encoder metadata ".repeat(8);
        push_property(
            &mut payload,
            "encoder",
            amf0_encode_string_raw(&long_encoder),
        );

        let mut keyframes = vec![0x03];
        let mut times = vec![0x0A];
        times.extend_from_slice(&2u32.to_be_bytes());
        times.extend(amf0_encode_number_raw(0.0));
        times.extend(amf0_encode_number_raw(5.5));
        push_property(&mut keyframes, "times", times);
        keyframes.extend_from_slice(&[0x00, 0x00, 0x09]);
        push_property(&mut payload, "keyframes", keyframes);
        payload.extend_from_slice(&[0x00, 0x00, 0x09]);

        let wire = build_rtmp_chunk(5, 0x12, 1, &payload);
        let mut decoder = RtmpChunkDecoder::default();
        let mut messages = Vec::new();
        for fragment in wire.chunks(17) {
            messages.extend(decoder.push(fragment).expect("chunk should decode"));
        }

        assert_eq!(messages.len(), 1);
        let metadata = metadata_from_message(&messages[0])
            .expect("metadata should decode")
            .expect("onMetaData should be recognized");
        assert_eq!(metadata.get("encoder"), Some(&json!(long_encoder)));
        assert_eq!(metadata["keyframes"]["times"], json!([0.0, 5.5]));
    }

    #[test]
    fn rejects_truncated_on_metadata_value() {
        let mut payload = amf0_encode_string("onMetaData");
        payload.extend_from_slice(&[0x08, 0x00, 0x00, 0x00, 0x01, 0x00]);
        assert!(parse_on_metadata(&payload).is_err());
    }

    #[test]
    fn rejects_amf0_values_beyond_recursion_depth_budget() {
        let mut payload = Vec::new();
        for _ in 0..MAX_AMF0_DEPTH {
            payload.push(0x0A); // strict array
            payload.extend_from_slice(&1u32.to_be_bytes());
        }
        payload.push(0x05); // null at a depth beyond the limit

        let error = Amf0Reader::new(&payload)
            .read_value()
            .expect_err("deeply nested AMF0 must be rejected");
        assert!(error.contains("maximum recursion depth"));
    }

    #[test]
    fn rejects_amf0_arrays_beyond_container_item_budget() {
        let mut payload = vec![0x0A]; // strict array
        payload.extend_from_slice(&((MAX_AMF0_CONTAINER_ITEMS + 1) as u32).to_be_bytes());

        let error = Amf0Reader::new(&payload)
            .read_value()
            .expect_err("oversized AMF0 array must be rejected before allocation");
        assert!(error.contains("container item budget"));
    }

    #[test]
    fn rejects_amf0_values_beyond_decoded_node_budget() {
        let payload = vec![0x05; MAX_AMF0_DECODED_NODES + 1];
        let mut reader = Amf0Reader::new(&payload);
        for _ in 0..MAX_AMF0_DECODED_NODES {
            assert_eq!(
                reader.read_value().expect("node within budget"),
                Value::Null
            );
        }

        let error = reader
            .read_value()
            .expect_err("decoded node budget must be enforced across top-level values");
        assert!(error.contains("decoded node budget"));
    }

    #[test]
    fn matches_transaction_and_uses_create_stream_result_id() {
        let mut payload = amf0_encode_string("_result");
        payload.extend(amf0_encode_number(2.0));
        payload.push(0x05); // null command object
        payload.extend(amf0_encode_number(7.0));
        let message = RtmpMessage {
            message_type_id: 0x14,
            payload,
        };

        assert!(
            matching_command_response(&message, 1.0)
                .expect("response should decode")
                .is_none(),
            "a response for another transaction must be ignored"
        );
        let response = matching_command_response(&message, 2.0)
            .expect("response should decode")
            .expect("transaction 2 should match");
        let message_stream_id =
            create_stream_id(response.return_value.as_ref()).expect("stream ID should decode");
        assert_eq!(message_stream_id, 7);

        let (play_chunk, _) = build_play_chunk("camera", message_stream_id);
        assert_eq!(
            u32::from_le_bytes([play_chunk[8], play_chunk[9], play_chunk[10], play_chunk[11],]),
            7
        );
    }

    #[test]
    fn detects_play_on_status_failures_without_rejecting_start() {
        let status_message = |level: &str, code: &str, description: &str| {
            let mut payload = amf0_encode_string("onStatus");
            payload.extend(amf0_encode_number(0.0));
            payload.push(0x05); // null command object
            payload.extend(amf0_encode_object(&[
                ("level", AmfValue::String(level)),
                ("code", AmfValue::String(code)),
                ("description", AmfValue::String(description)),
            ]));
            RtmpMessage {
                message_type_id: 0x14,
                payload,
            }
        };

        let missing = status_message("error", "NetStream.Play.StreamNotFound", "No such stream");
        let error = play_command_failure(&missing)
            .expect("status should decode")
            .expect("StreamNotFound must fail play");
        assert!(error.contains("NetStream.Play.StreamNotFound"));
        assert!(error.contains("No such stream"));

        let started = status_message("status", "NetStream.Play.Start", "Playback started");
        assert!(
            play_command_failure(&started)
                .expect("start status should decode")
                .is_none()
        );

        let mut error_payload = amf0_encode_string("_error");
        error_payload.extend(amf0_encode_number(0.0));
        error_payload.push(0x05);
        let error_message = RtmpMessage {
            message_type_id: 0x14,
            payload: error_payload,
        };
        assert!(
            play_command_failure(&error_message)
                .expect("_error should decode")
                .expect("_error must fail play")
                .contains("server returned _error")
        );
    }

    #[tokio::test]
    async fn handshake_times_out_against_silent_peer() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind silent RTMP listener");
        let port = listener.local_addr().expect("listener address").port();
        let silent_peer = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.expect("accept RTMP client");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            drop(socket);
        });

        let url = format!("rtmp://127.0.0.1:{}/live/camera", port);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            handshake_with_timeout(
                "silent-peer-test",
                &url,
                None,
                None,
                std::time::Duration::from_millis(100),
            ),
        )
        .await
        .expect("handshake helper must honor its deadline");
        silent_peer.abort();

        let error = result.expect_err("silent peer must time out");
        assert!(error.contains("RTMP handshake timed out after 100ms"));
    }

    #[test]
    fn decodes_extended_timestamp_continuations_after_chunk_size_change() {
        let mut wire = Vec::new();

        // Server control message: Set Chunk Size to 64 bytes.
        wire.push(0x02);
        wire.extend_from_slice(&[0x00, 0x00, 0x00]);
        push_u24(&mut wire, 4);
        wire.push(0x01);
        wire.extend_from_slice(&0u32.to_le_bytes());
        wire.extend_from_slice(&64u32.to_be_bytes());

        let payload = vec![0xAB; 150];
        let extended_timestamp = 0x0102_0304u32;
        wire.push(0x05);
        wire.extend_from_slice(&[0xFF, 0xFF, 0xFF]);
        push_u24(&mut wire, payload.len());
        wire.push(0x12);
        wire.extend_from_slice(&1u32.to_le_bytes());
        wire.extend_from_slice(&extended_timestamp.to_be_bytes());
        wire.extend_from_slice(&payload[..64]);

        for continuation in payload[64..].chunks(64) {
            wire.push(0xC5);
            wire.extend_from_slice(&extended_timestamp.to_be_bytes());
            wire.extend_from_slice(continuation);
        }

        let mut decoder = RtmpChunkDecoder::default();
        let mut messages = Vec::new();
        for fragment in wire.chunks(11) {
            messages.extend(decoder.push(fragment).expect("chunk should decode"));
        }

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type_id, 0x01);
        assert_eq!(messages[1].message_type_id, 0x12);
        assert_eq!(messages[1].payload, payload);
    }

    #[test]
    fn decodes_interleaved_partial_messages_on_distinct_chunk_streams() {
        let mut wire = Vec::new();
        push_first_chunk(&mut wire, 3, 0x12, 8, b"abcd");
        push_first_chunk(&mut wire, 4, 0x14, 8, b"1234");
        wire.push(0xC3);
        wire.extend_from_slice(b"efgh");
        wire.push(0xC4);
        wire.extend_from_slice(b"5678");

        let mut decoder = RtmpChunkDecoder::default();
        decoder.chunk_size = 4;
        let mut messages = Vec::new();
        for fragment in wire.chunks(3) {
            messages.extend(
                decoder
                    .push(fragment)
                    .expect("interleaved chunks should decode"),
            );
        }

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type_id, 0x12);
        assert_eq!(messages[0].payload, b"abcdefgh");
        assert_eq!(messages[1].message_type_id, 0x14);
        assert_eq!(messages[1].payload, b"12345678");
    }

    #[test]
    fn rejects_new_header_on_chunk_stream_with_unfinished_message() {
        let mut first = Vec::new();
        push_first_chunk(&mut first, 3, 0x12, 8, b"abcd");
        let mut replacement = Vec::new();
        push_first_chunk(&mut replacement, 3, 0x12, 1, b"z");

        let mut decoder = RtmpChunkDecoder::default();
        decoder.chunk_size = 4;
        assert!(
            decoder
                .push(&first)
                .expect("first partial chunk")
                .is_empty()
        );
        let error = decoder
            .push(&replacement)
            .expect_err("a non-continuation header must not replace partial state");
        assert!(error.contains("before its previous message completed"));
    }

    #[test]
    fn limits_tracked_chunk_stream_ids() {
        let mut decoder = RtmpChunkDecoder::default();
        for chunk_stream_id in 2..(2 + MAX_TRACKED_CHUNK_STREAMS as u32) {
            let mut message = Vec::new();
            if chunk_stream_id < 64 {
                push_first_chunk(&mut message, chunk_stream_id as u8, 0x12, 0, b"");
            } else if chunk_stream_id < 320 {
                message.push(0);
                message.push((chunk_stream_id - 64) as u8);
                message.extend_from_slice(&[0; 3]);
                push_u24(&mut message, 0);
                message.push(0x12);
                message.extend_from_slice(&1u32.to_le_bytes());
            }
            assert!(decoder.push(&message).expect("stream within budget").len() == 1);
        }

        let mut overflow = Vec::new();
        overflow.push(0);
        overflow.push(MAX_TRACKED_CHUNK_STREAMS as u8);
        overflow.extend_from_slice(&[0; 3]);
        push_u24(&mut overflow, 0);
        overflow.push(0x12);
        overflow.extend_from_slice(&1u32.to_le_bytes());
        let error = decoder
            .push(&overflow)
            .expect_err("another chunk-stream ID must exceed the budget");
        assert!(error.contains("tracked chunk-stream budget"));
    }

    #[test]
    fn accounts_for_buffer_and_partial_payload_in_retained_byte_budget() {
        let mut decoder = RtmpChunkDecoder::default();
        decoder.buffer.extend_from_slice(&[0; 7]);
        decoder.streams.insert(
            3,
            ChunkStreamState {
                timestamp: 0,
                timestamp_delta: 0,
                message_length: 4,
                message_type_id: 0x12,
                _message_stream_id: 1,
                extended_timestamp: false,
                payload: vec![1, 2, 3, 4],
                in_progress: true,
            },
        );

        assert_eq!(decoder.retained_bytes(), 11);
        assert!(
            decoder
                .ensure_retained_capacity(MAX_DECODER_RETAINED_BYTES - 11)
                .is_ok()
        );
        assert!(
            decoder
                .ensure_retained_capacity(MAX_DECODER_RETAINED_BYTES - 10)
                .is_err()
        );
    }
}
