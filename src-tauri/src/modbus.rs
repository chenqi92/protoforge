//! Modbus TCP/RTU master connections plus TCP/RTU slave simulators.

use std::collections::HashMap;
use std::future::Future;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Notify, RwLock};
use tokio::task::{JoinHandle, JoinSet};
use tokio_serial::{ClearBuffer, SerialPort, SerialPortBuilderExt};
use tokio_util::sync::CancellationToken;

use crate::tcp_client::bytes_to_hex;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SLAVE_STOP_TIMEOUT: Duration = Duration::from_secs(1);
const SLAVE_FRAME_TIMEOUT: Duration = Duration::from_secs(5);
const SLAVE_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_SLAVE_CLIENTS: usize = 128;
const MAX_MBAP_LENGTH: usize = 254; // Unit id (1 byte) + maximum PDU (253 bytes).
const MAX_RTU_FRAME_LENGTH: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSerialConfig {
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
    pub flow_control: String,
}

impl ModbusSerialConfig {
    fn builder(&self, port_name: &str) -> Result<tokio_serial::SerialPortBuilder, String> {
        if self.baud_rate == 0 || self.baud_rate > 4_000_000 {
            return Err(format!("无效波特率: {}", self.baud_rate));
        }
        let data_bits = match self.data_bits {
            5 => tokio_serial::DataBits::Five,
            6 => tokio_serial::DataBits::Six,
            7 => tokio_serial::DataBits::Seven,
            8 => tokio_serial::DataBits::Eight,
            value => return Err(format!("无效数据位: {value}")),
        };
        let stop_bits = match self.stop_bits {
            1 => tokio_serial::StopBits::One,
            2 => tokio_serial::StopBits::Two,
            value => return Err(format!("无效停止位: {value}")),
        };
        let parity = match self.parity.as_str() {
            "none" => tokio_serial::Parity::None,
            "odd" => tokio_serial::Parity::Odd,
            "even" => tokio_serial::Parity::Even,
            value => return Err(format!("无效校验位: {value}")),
        };
        let flow_control = match self.flow_control.as_str() {
            "none" => tokio_serial::FlowControl::None,
            "software" => tokio_serial::FlowControl::Software,
            "hardware" => tokio_serial::FlowControl::Hardware,
            value => return Err(format!("无效流控模式: {value}")),
        };
        Ok(tokio_serial::new(port_name, self.baud_rate)
            .data_bits(data_bits)
            .stop_bits(stop_bits)
            .parity(parity)
            .flow_control(flow_control))
    }

    fn silent_interval(&self) -> Duration {
        let parity_bits = u32::from(self.parity != "none");
        let bits_per_character =
            1 + u32::from(self.data_bits) + parity_bits + u32::from(self.stop_bits);
        // Modbus specifies at least 3.5 character times; at baud rates above
        // 19200 the fixed 1.75ms interval from the serial-line guide applies.
        if self.baud_rate > 19_200 {
            Duration::from_micros(1_750)
        } else {
            let micros =
                (3_500_000u64 * u64::from(bits_per_character)).div_ceil(u64::from(self.baud_rate));
            Duration::from_micros(micros)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusEvent {
    pub conn_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusTcpStatus {
    pub connected: bool,
    pub conn_id: String,
    pub host: String,
    pub port: u16,
    pub connected_since: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusRtuStatus {
    pub connected: bool,
    pub conn_id: String,
    pub port_name: String,
    pub config: ModbusSerialConfig,
    pub connected_since: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveRegisterEntry {
    pub address: u16,
    pub value: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveBitEntry {
    pub address: u16,
    pub value: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveRegisterSeed {
    pub address: u32,
    pub value: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveBitSeed {
    pub address: u32,
    pub value: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveStatus {
    pub running: bool,
    pub conn_id: String,
    pub generation: String,
    pub transport: String,
    pub unit_id: u8,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baud_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_bits: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_bits: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_control: Option<String>,
    pub holding_registers: Vec<ModbusSlaveRegisterEntry>,
    pub coils: Vec<ModbusSlaveBitEntry>,
    pub input_registers: Vec<ModbusSlaveRegisterEntry>,
    pub discrete_inputs: Vec<ModbusSlaveBitEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusSlaveEvent {
    pub conn_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_addr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_id: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_code: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_address: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_hex: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusResponse {
    pub function_code: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registers: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coils: Option<Vec<bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_count: Option<u16>,
    pub raw_hex: String,
    pub duration_ms: u64,
    pub timestamp: String,
}

#[derive(Debug)]
struct RequestSpec {
    function_code: u8,
    start_address: u16,
    quantity: u16,
    values: Vec<u16>,
    pdu: Vec<u8>,
}

pub(crate) struct ModbusTcpHandle {
    generation: uuid::Uuid,
    stream: Arc<Mutex<TcpStream>>,
    next_transaction_id: Arc<AtomicU16>,
    cancel: CancellationToken,
    status: ModbusTcpStatus,
}

impl Clone for ModbusTcpHandle {
    fn clone(&self) -> Self {
        Self {
            generation: self.generation,
            stream: Arc::clone(&self.stream),
            next_transaction_id: Arc::clone(&self.next_transaction_id),
            cancel: self.cancel.clone(),
            status: self.status.clone(),
        }
    }
}

struct ModbusRtuIo {
    stream: tokio_serial::SerialStream,
    last_exchange_end: Instant,
}

#[derive(Clone)]
pub(crate) struct ModbusRtuHandle {
    generation: uuid::Uuid,
    io: Arc<Mutex<ModbusRtuIo>>,
    cancel: CancellationToken,
    silent_interval: Duration,
    status: ModbusRtuStatus,
}

#[derive(Clone)]
enum ModbusMasterHandle {
    Tcp(ModbusTcpHandle),
    Rtu(ModbusRtuHandle),
}

impl ModbusMasterHandle {
    fn generation(&self) -> uuid::Uuid {
        match self {
            Self::Tcp(handle) => handle.generation,
            Self::Rtu(handle) => handle.generation,
        }
    }

    fn transport(&self) -> TransportKind {
        match self {
            Self::Tcp(_) => TransportKind::Tcp,
            Self::Rtu(_) => TransportKind::Rtu,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TransportKind {
    Tcp,
    Rtu,
}

struct PendingConnect {
    generation: uuid::Uuid,
    cancel: CancellationToken,
    transport: TransportKind,
}

#[derive(Default)]
struct ModbusSlaveBank {
    holding_registers: HashMap<u16, u16>,
    coils: HashMap<u16, bool>,
    input_registers: HashMap<u16, u16>,
    discrete_inputs: HashMap<u16, bool>,
}

fn build_slave_bank(
    holding_registers: Vec<ModbusSlaveRegisterSeed>,
    coils: Vec<ModbusSlaveBitSeed>,
    input_registers: Vec<ModbusSlaveRegisterSeed>,
    discrete_inputs: Vec<ModbusSlaveBitSeed>,
) -> Result<ModbusSlaveBank, String> {
    if [
        holding_registers.len(),
        coils.len(),
        input_registers.len(),
        discrete_inputs.len(),
    ]
    .into_iter()
    .any(|length| length > usize::from(u16::MAX) + 1)
    {
        return Err("Modbus Slave 单个数据区最多包含 65536 个条目".to_string());
    }

    let mut bank = ModbusSlaveBank::default();
    for entry in holding_registers {
        bank.holding_registers.insert(
            checked_u16(entry.address, "保持寄存器地址")?,
            checked_u16(entry.value, "保持寄存器值")?,
        );
    }
    for entry in coils {
        bank.coils
            .insert(checked_u16(entry.address, "线圈地址")?, entry.value);
    }
    for entry in input_registers {
        bank.input_registers.insert(
            checked_u16(entry.address, "输入寄存器地址")?,
            checked_u16(entry.value, "输入寄存器值")?,
        );
    }
    for entry in discrete_inputs {
        bank.discrete_inputs
            .insert(checked_u16(entry.address, "离散输入地址")?, entry.value);
    }
    Ok(bank)
}

#[derive(Debug, Clone)]
struct ModbusTcpSlaveStatus {
    conn_id: String,
    host: String,
    port: u16,
    unit_id: u8,
    started_at: String,
}

#[derive(Clone)]
struct ModbusTcpSlaveHandle {
    generation: uuid::Uuid,
    cancel: CancellationToken,
    bank: Arc<RwLock<ModbusSlaveBank>>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
    status: ModbusTcpSlaveStatus,
}

#[derive(Debug, Clone)]
struct ModbusRtuSlaveStatus {
    conn_id: String,
    port_name: String,
    config: ModbusSerialConfig,
    unit_id: u8,
    started_at: String,
}

#[derive(Clone)]
struct ModbusRtuSlaveHandle {
    generation: uuid::Uuid,
    cancel: CancellationToken,
    bank: Arc<RwLock<ModbusSlaveBank>>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
    status: ModbusRtuSlaveStatus,
}

#[derive(Clone)]
enum ModbusSlaveHandle {
    Tcp(ModbusTcpSlaveHandle),
    Rtu(ModbusRtuSlaveHandle),
}

impl ModbusSlaveHandle {
    fn generation(&self) -> uuid::Uuid {
        match self {
            Self::Tcp(handle) => handle.generation,
            Self::Rtu(handle) => handle.generation,
        }
    }

    fn transport(&self) -> TransportKind {
        match self {
            Self::Tcp(_) => TransportKind::Tcp,
            Self::Rtu(_) => TransportKind::Rtu,
        }
    }

    fn bank(&self) -> &Arc<RwLock<ModbusSlaveBank>> {
        match self {
            Self::Tcp(handle) => &handle.bank,
            Self::Rtu(handle) => &handle.bank,
        }
    }

    fn cancel(&self) -> &CancellationToken {
        match self {
            Self::Tcp(handle) => &handle.cancel,
            Self::Rtu(handle) => &handle.cancel,
        }
    }

    fn task(&self) -> &Arc<Mutex<Option<JoinHandle<()>>>> {
        match self {
            Self::Tcp(handle) => &handle.task,
            Self::Rtu(handle) => &handle.task,
        }
    }
}

struct PendingSlaveStart {
    generation: uuid::Uuid,
    cancel: CancellationToken,
    transport: TransportKind,
}

#[derive(Default)]
struct ModbusTcpStateInner {
    connections: HashMap<String, ModbusMasterHandle>,
    pending: HashMap<String, PendingConnect>,
    slave_connections: HashMap<String, ModbusSlaveHandle>,
    slave_pending: HashMap<String, PendingSlaveStart>,
    // Gates are intentionally retained for the process lifetime. Reusing the
    // same gate is what makes every lifecycle transition for a conn_id linear.
    slave_lifecycle_gates: HashMap<String, Arc<Mutex<()>>>,
}

#[derive(Default)]
pub struct ModbusTcpState {
    inner: Arc<Mutex<ModbusTcpStateInner>>,
}

pub fn new_connections() -> ModbusTcpState {
    ModbusTcpState::default()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn emit_event(app: &AppHandle, conn_id: &str, event_type: &str, data: Option<String>) {
    let _ = app.emit(
        "modbus-event",
        ModbusEvent {
            conn_id: conn_id.to_string(),
            event_type: event_type.to_string(),
            data,
            timestamp: now_iso(),
        },
    );
}

async fn emit_master_connected_if_current(
    app: &AppHandle,
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
    data: String,
) {
    let inner = state.inner.lock().await;
    if inner
        .connections
        .get(conn_id)
        .is_some_and(|handle| handle.generation() == generation)
    {
        // Emit under the state lock so a disconnect/replacement cannot make
        // this lifecycle notification stale before it reaches the event bus.
        emit_event(app, conn_id, "connected", Some(data));
    }
}

async fn emit_master_inactive_event(
    app: &AppHandle,
    state: &ModbusTcpState,
    conn_id: &str,
    event_type: &str,
    data: Option<String>,
) {
    let inner = state.inner.lock().await;
    if !inner.connections.contains_key(conn_id) && !inner.pending.contains_key(conn_id) {
        emit_event(app, conn_id, event_type, data);
    }
}

fn emit_slave_event(app: Option<&AppHandle>, event: ModbusSlaveEvent) {
    if let Some(app) = app {
        let _ = app.emit("modbus-slave-event", event);
    }
}

fn emit_slave_lifecycle(
    app: Option<&AppHandle>,
    conn_id: &str,
    event_type: &str,
    error: Option<String>,
    generation: Option<uuid::Uuid>,
) {
    emit_slave_event(
        app,
        ModbusSlaveEvent {
            conn_id: conn_id.to_string(),
            event_type: event_type.to_string(),
            generation: generation.map(|value| value.to_string()),
            client_addr: None,
            unit_id: None,
            function_code: None,
            start_address: None,
            quantity: None,
            values: None,
            raw_hex: error,
            timestamp: now_iso(),
        },
    );
}

fn checked_u16(value: u32, field: &str) -> Result<u16, String> {
    u16::try_from(value).map_err(|_| format!("{field} 超出 0..65535 范围"))
}

fn validate_address_range(start_address: u32, quantity: u32) -> Result<(u16, u16), String> {
    if quantity == 0 {
        return Err("quantity 必须大于 0".to_string());
    }
    let end = start_address
        .checked_add(quantity)
        .ok_or_else(|| "地址范围溢出".to_string())?;
    if start_address > u16::MAX as u32 || end > u16::MAX as u32 + 1 {
        return Err("请求地址范围超出 0..65535".to_string());
    }
    Ok((start_address as u16, quantity as u16))
}

fn require_quantity(quantity: u32, max: u32, function_code: u8) -> Result<(), String> {
    if !(1..=max).contains(&quantity) {
        return Err(format!(
            "功能码 {function_code} 的 quantity 必须在 1..{max} 范围内"
        ));
    }
    Ok(())
}

fn convert_values(values: Vec<u32>) -> Result<Vec<u16>, String> {
    values
        .into_iter()
        .map(|value| checked_u16(value, "写入值"))
        .collect()
}

fn build_request_spec(
    function_code: u16,
    start_address: u32,
    quantity: u32,
    values: Vec<u32>,
) -> Result<RequestSpec, String> {
    let function_code = u8::try_from(function_code)
        .map_err(|_| format!("不支持的 Modbus 功能码: {function_code}"))?;
    let (start_address_u16, quantity_u16) = validate_address_range(start_address, quantity)?;
    let mut values = convert_values(values)?;
    let mut pdu = Vec::with_capacity(253);
    pdu.push(function_code);
    pdu.extend_from_slice(&start_address_u16.to_be_bytes());

    match function_code {
        1 | 2 => {
            require_quantity(quantity, 2000, function_code)?;
            if !values.is_empty() {
                return Err("读线圈请求不能包含写入值".to_string());
            }
            pdu.extend_from_slice(&quantity_u16.to_be_bytes());
        }
        3 | 4 => {
            require_quantity(quantity, 125, function_code)?;
            if !values.is_empty() {
                return Err("读寄存器请求不能包含写入值".to_string());
            }
            pdu.extend_from_slice(&quantity_u16.to_be_bytes());
        }
        5 => {
            require_quantity(quantity, 1, function_code)?;
            if values.len() != 1 || !matches!(values[0], 0 | 1 | 0xff00) {
                return Err("功能码 5 需要一个线圈值（0、1 或 0xFF00）".to_string());
            }
            let encoded = if values[0] == 0 { 0u16 } else { 0xff00u16 };
            values[0] = encoded;
            pdu.extend_from_slice(&encoded.to_be_bytes());
        }
        6 => {
            require_quantity(quantity, 1, function_code)?;
            if values.len() != 1 {
                return Err("功能码 6 需要一个寄存器值".to_string());
            }
            pdu.extend_from_slice(&values[0].to_be_bytes());
        }
        15 => {
            require_quantity(quantity, 1968, function_code)?;
            if values.len() != quantity as usize || values.iter().any(|value| *value > 1) {
                return Err(format!("功能码 15 需要恰好 {quantity} 个 0/1 线圈值"));
            }
            pdu.extend_from_slice(&quantity_u16.to_be_bytes());
            let byte_count = quantity.div_ceil(8) as usize;
            pdu.push(byte_count as u8);
            pdu.resize(pdu.len() + byte_count, 0);
            let data_offset = pdu.len() - byte_count;
            for (index, value) in values.iter().enumerate() {
                if *value != 0 {
                    pdu[data_offset + index / 8] |= 1 << (index % 8);
                }
            }
        }
        16 => {
            require_quantity(quantity, 123, function_code)?;
            if values.len() != quantity as usize {
                return Err(format!("功能码 16 需要恰好 {quantity} 个寄存器值"));
            }
            pdu.extend_from_slice(&quantity_u16.to_be_bytes());
            pdu.push((values.len() * 2) as u8);
            for value in &values {
                pdu.extend_from_slice(&value.to_be_bytes());
            }
        }
        _ => return Err(format!("不支持的 Modbus 功能码: {function_code}")),
    }

    if pdu.len() > 253 {
        return Err("Modbus PDU 超过 253 字节".to_string());
    }

    Ok(RequestSpec {
        function_code,
        start_address: start_address_u16,
        quantity: quantity_u16,
        values,
        pdu,
    })
}

fn build_mbap_frame(transaction_id: u16, unit_id: u8, pdu: &[u8]) -> Result<Vec<u8>, String> {
    if pdu.is_empty() || pdu.len() > 253 {
        return Err("Modbus PDU 长度必须在 1..253 字节范围内".to_string());
    }
    let length = u16::try_from(pdu.len() + 1).map_err(|_| "MBAP 长度溢出".to_string())?;
    let mut frame = Vec::with_capacity(7 + pdu.len());
    frame.extend_from_slice(&transaction_id.to_be_bytes());
    frame.extend_from_slice(&0u16.to_be_bytes());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.push(unit_id);
    frame.extend_from_slice(pdu);
    Ok(frame)
}

#[derive(Debug)]
struct WireResponse {
    raw: Vec<u8>,
    pdu: Vec<u8>,
}

fn validate_mbap_header(
    header: &[u8; 7],
    transaction_id: u16,
    unit_id: u8,
) -> Result<usize, String> {
    let response_transaction = u16::from_be_bytes([header[0], header[1]]);
    if response_transaction != transaction_id {
        return Err(format!(
            "事务 ID 不匹配: 期望 {transaction_id}, 收到 {response_transaction}"
        ));
    }
    let protocol_id = u16::from_be_bytes([header[2], header[3]]);
    if protocol_id != 0 {
        return Err(format!("无效 MBAP 协议 ID: {protocol_id}"));
    }
    let length = u16::from_be_bytes([header[4], header[5]]) as usize;
    if !(2..=MAX_MBAP_LENGTH).contains(&length) {
        return Err(format!("无效 MBAP 长度: {length}"));
    }
    if header[6] != unit_id {
        return Err(format!(
            "单元 ID 不匹配: 期望 {unit_id}, 收到 {}",
            header[6]
        ));
    }
    Ok(length)
}

async fn exchange_mbap(
    stream: &mut TcpStream,
    request: &[u8],
    transaction_id: u16,
    unit_id: u8,
) -> Result<WireResponse, String> {
    stream
        .write_all(request)
        .await
        .map_err(|error| format!("Modbus TCP 请求写入失败: {error}"))?;

    let mut header = [0u8; 7];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| format!("Modbus TCP 响应头读取失败: {error}"))?;

    let length = validate_mbap_header(&header, transaction_id, unit_id)?;

    let mut pdu = vec![0u8; length - 1];
    stream
        .read_exact(&mut pdu)
        .await
        .map_err(|error| format!("Modbus TCP 响应体读取失败: {error}"))?;

    let mut raw = Vec::with_capacity(header.len() + pdu.len());
    raw.extend_from_slice(&header);
    raw.extend_from_slice(&pdu);
    Ok(WireResponse { raw, pdu })
}

fn modbus_crc16(data: &[u8]) -> u16 {
    let mut crc = 0xffffu16;
    for byte in data {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            };
        }
    }
    crc
}

fn build_rtu_frame(unit_id: u8, pdu: &[u8]) -> Result<Vec<u8>, String> {
    if pdu.is_empty() || pdu.len() > 253 {
        return Err("Modbus PDU 长度必须在 1..253 字节范围内".to_string());
    }
    let mut frame = Vec::with_capacity(pdu.len() + 3);
    frame.push(unit_id);
    frame.extend_from_slice(pdu);
    let crc = modbus_crc16(&frame);
    frame.extend_from_slice(&crc.to_le_bytes());
    Ok(frame)
}

fn expected_rtu_response_length(
    spec: &RequestSpec,
    prefix: &[u8; 3],
    unit_id: u8,
) -> Result<usize, String> {
    if prefix[0] != unit_id {
        return Err(format!(
            "单元 ID 不匹配: 期望 {unit_id}, 收到 {}",
            prefix[0]
        ));
    }
    if prefix[1] == (spec.function_code | 0x80) {
        return Ok(5);
    }
    if prefix[1] != spec.function_code {
        return Err(format!(
            "功能码不匹配: 期望 {}, 收到 {}",
            spec.function_code, prefix[1]
        ));
    }
    match spec.function_code {
        1 | 2 => {
            let expected_bytes = usize::from(spec.quantity).div_ceil(8);
            if usize::from(prefix[2]) != expected_bytes {
                return Err(format!(
                    "线圈响应字节计数无效: 期望 {expected_bytes}, 收到 {}",
                    prefix[2]
                ));
            }
            Ok(expected_bytes + 5)
        }
        3 | 4 => {
            let expected_bytes = usize::from(spec.quantity) * 2;
            if usize::from(prefix[2]) != expected_bytes {
                return Err(format!(
                    "寄存器响应字节计数无效: 期望 {expected_bytes}, 收到 {}",
                    prefix[2]
                ));
            }
            Ok(expected_bytes + 5)
        }
        5 | 6 | 15 | 16 => Ok(8),
        _ => Err(format!("不支持的 Modbus 功能码: {}", spec.function_code)),
    }
}

fn validate_rtu_unit_operation(unit_id: u8, function_code: u8) -> Result<(), String> {
    if unit_id == 0 && matches!(function_code, 1..=4) {
        return Err("Modbus RTU 广播地址 0 不能执行读操作".to_string());
    }
    Ok(())
}

fn rtu_broadcast_ack_pdu(spec: &RequestSpec) -> Result<Vec<u8>, String> {
    match spec.function_code {
        5 | 6 => Ok(spec.pdu.clone()),
        15 | 16 => {
            let mut response = vec![spec.function_code];
            response.extend_from_slice(&spec.start_address.to_be_bytes());
            response.extend_from_slice(&spec.quantity.to_be_bytes());
            Ok(response)
        }
        _ => Err("Modbus RTU 广播仅支持写功能码 5/6/15/16".to_string()),
    }
}

#[derive(Debug)]
enum RtuExchangeError {
    Io(String),
    Protocol(String),
}

impl RtuExchangeError {
    fn message(&self) -> &str {
        match self {
            Self::Io(message) | Self::Protocol(message) => message,
        }
    }

    fn is_fatal(&self) -> bool {
        matches!(self, Self::Io(_))
    }
}

async fn exchange_rtu(
    io: &mut ModbusRtuIo,
    silent_interval: Duration,
    request: &[u8],
    spec: &RequestSpec,
    unit_id: u8,
) -> Result<WireResponse, RtuExchangeError> {
    let elapsed = io.last_exchange_end.elapsed();
    if elapsed < silent_interval {
        tokio::time::sleep(silent_interval - elapsed).await;
    }
    io.stream.clear(ClearBuffer::Input).map_err(|error| {
        RtuExchangeError::Io(format!("清理 Modbus RTU 输入缓冲区失败: {error}"))
    })?;
    io.stream
        .write_all(request)
        .await
        .map_err(|error| RtuExchangeError::Io(format!("Modbus RTU 请求写入失败: {error}")))?;
    io.stream
        .flush()
        .await
        .map_err(|error| RtuExchangeError::Io(format!("Modbus RTU 请求刷新失败: {error}")))?;

    let mut prefix = [0u8; 3];
    io.stream
        .read_exact(&mut prefix)
        .await
        .map_err(|error| RtuExchangeError::Io(format!("Modbus RTU 响应头读取失败: {error}")))?;
    let frame_length =
        expected_rtu_response_length(spec, &prefix, unit_id).map_err(RtuExchangeError::Protocol)?;
    if !(5..=256).contains(&frame_length) {
        return Err(RtuExchangeError::Protocol(format!(
            "无效 Modbus RTU 响应长度: {frame_length}"
        )));
    }
    let mut raw = vec![0u8; frame_length];
    raw[..3].copy_from_slice(&prefix);
    io.stream
        .read_exact(&mut raw[3..])
        .await
        .map_err(|error| RtuExchangeError::Io(format!("Modbus RTU 响应体读取失败: {error}")))?;
    io.last_exchange_end = Instant::now();

    let received_crc = u16::from_le_bytes([raw[frame_length - 2], raw[frame_length - 1]]);
    let expected_crc = modbus_crc16(&raw[..frame_length - 2]);
    if received_crc != expected_crc {
        return Err(RtuExchangeError::Protocol(format!(
            "Modbus RTU CRC 不匹配: 期望 {expected_crc:04X}, 收到 {received_crc:04X}"
        )));
    }
    let pdu = raw[1..frame_length - 2].to_vec();
    Ok(WireResponse { raw, pdu })
}

async fn write_rtu_broadcast(
    io: &mut ModbusRtuIo,
    silent_interval: Duration,
    request: &[u8],
) -> Result<(), String> {
    let elapsed = io.last_exchange_end.elapsed();
    if elapsed < silent_interval {
        tokio::time::sleep(silent_interval - elapsed).await;
    }
    io.stream
        .clear(ClearBuffer::Input)
        .map_err(|error| format!("清理 Modbus RTU 输入缓冲区失败: {error}"))?;
    io.stream
        .write_all(request)
        .await
        .map_err(|error| format!("Modbus RTU 广播写入失败: {error}"))?;
    io.stream
        .flush()
        .await
        .map_err(|error| format!("Modbus RTU 广播刷新失败: {error}"))?;
    io.last_exchange_end = Instant::now();
    Ok(())
}

fn exception_message(code: u8) -> &'static str {
    match code {
        1 => "非法功能码",
        2 => "非法数据地址",
        3 => "非法数据值",
        4 => "从站设备故障",
        5 => "确认",
        6 => "从站设备忙",
        8 => "存储奇偶校验错误",
        10 => "网关路径不可用",
        11 => "网关目标设备无响应",
        _ => "未知异常",
    }
}

fn parse_response_pdu(
    spec: &RequestSpec,
    pdu: &[u8],
) -> Result<(Option<Vec<u16>>, Option<Vec<bool>>, Option<u16>), String> {
    if pdu.is_empty() {
        return Err("Modbus 响应 PDU 为空".to_string());
    }
    if pdu[0] == (spec.function_code | 0x80) {
        if pdu.len() != 2 {
            return Err("Modbus 异常响应长度无效".to_string());
        }
        return Err(format!(
            "Modbus 异常 {}: {}",
            pdu[1],
            exception_message(pdu[1])
        ));
    }
    if pdu[0] != spec.function_code {
        return Err(format!(
            "功能码不匹配: 期望 {}, 收到 {}",
            spec.function_code, pdu[0]
        ));
    }

    match spec.function_code {
        1 | 2 => {
            if pdu.len() < 2 {
                return Err("线圈响应缺少字节计数".to_string());
            }
            let expected_bytes = usize::from(spec.quantity).div_ceil(8);
            let byte_count = pdu[1] as usize;
            if byte_count != expected_bytes || pdu.len() != byte_count + 2 {
                return Err(format!(
                    "线圈响应长度无效: 期望 {expected_bytes} 数据字节, 收到 {byte_count}"
                ));
            }
            let coils = (0..usize::from(spec.quantity))
                .map(|index| pdu[2 + index / 8] & (1 << (index % 8)) != 0)
                .collect();
            Ok((None, Some(coils), None))
        }
        3 | 4 => {
            if pdu.len() < 2 {
                return Err("寄存器响应缺少字节计数".to_string());
            }
            let expected_bytes = usize::from(spec.quantity) * 2;
            let byte_count = pdu[1] as usize;
            if byte_count != expected_bytes || pdu.len() != byte_count + 2 {
                return Err(format!(
                    "寄存器响应长度无效: 期望 {expected_bytes} 数据字节, 收到 {byte_count}"
                ));
            }
            let registers = pdu[2..]
                .chunks_exact(2)
                .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
                .collect();
            Ok((Some(registers), None, None))
        }
        5 | 6 => {
            if pdu.len() != 5 {
                return Err(format!("写单值响应长度无效: {}", pdu.len()));
            }
            let address = u16::from_be_bytes([pdu[1], pdu[2]]);
            let value = u16::from_be_bytes([pdu[3], pdu[4]]);
            if address != spec.start_address || value != spec.values[0] {
                return Err("写单值响应未回显请求地址和值".to_string());
            }
            Ok((None, None, Some(1)))
        }
        15 | 16 => {
            if pdu.len() != 5 {
                return Err(format!("写多值响应长度无效: {}", pdu.len()));
            }
            let address = u16::from_be_bytes([pdu[1], pdu[2]]);
            let quantity = u16::from_be_bytes([pdu[3], pdu[4]]);
            if address != spec.start_address || quantity != spec.quantity {
                return Err("写多值响应未回显请求地址和数量".to_string());
            }
            Ok((None, None, Some(quantity)))
        }
        _ => Err(format!("不支持的 Modbus 功能码: {}", spec.function_code)),
    }
}

async fn shutdown_handle(handle: ModbusMasterHandle) {
    match handle {
        ModbusMasterHandle::Tcp(handle) => {
            handle.cancel.cancel();
            let shutdown = async {
                let mut stream = handle.stream.lock().await;
                let _ = stream.shutdown().await;
            };
            let _ = tokio::time::timeout(Duration::from_secs(1), shutdown).await;
        }
        ModbusMasterHandle::Rtu(handle) => {
            handle.cancel.cancel();
            let close = async {
                let io = handle.io.lock().await;
                let _ = io.stream.clear(ClearBuffer::All);
            };
            let _ = tokio::time::timeout(Duration::from_secs(1), close).await;
        }
    }
}

async fn remove_generation(state: &ModbusTcpState, conn_id: &str, generation: uuid::Uuid) -> bool {
    let removed = {
        let mut inner = state.inner.lock().await;
        if inner
            .connections
            .get(conn_id)
            .is_some_and(|handle| handle.generation() == generation)
        {
            inner.connections.remove(conn_id)
        } else {
            None
        }
    };
    if let Some(handle) = removed {
        shutdown_handle(handle).await;
        true
    } else {
        false
    }
}

async fn clear_pending_generation(state: &ModbusTcpState, conn_id: &str, generation: uuid::Uuid) {
    let mut inner = state.inner.lock().await;
    if inner
        .pending
        .get(conn_id)
        .is_some_and(|pending| pending.generation == generation)
    {
        inner.pending.remove(conn_id);
    }
}

async fn begin_pending(
    state: &ModbusTcpState,
    conn_id: &str,
    transport: TransportKind,
) -> (uuid::Uuid, CancellationToken) {
    let generation = uuid::Uuid::new_v4();
    let cancel = CancellationToken::new();
    let previous = {
        let mut inner = state.inner.lock().await;
        inner.pending.insert(
            conn_id.to_string(),
            PendingConnect {
                generation,
                cancel: cancel.clone(),
                transport,
            },
        )
    };
    if let Some(previous) = previous {
        previous.cancel.cancel();
    }
    (generation, cancel)
}

async fn install_pending_handle(
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
    handle: ModbusMasterHandle,
) -> Result<Option<ModbusMasterHandle>, ModbusMasterHandle> {
    let mut inner = state.inner.lock().await;
    if inner
        .pending
        .get(conn_id)
        .is_some_and(|pending| pending.generation == generation)
    {
        inner.pending.remove(conn_id);
        Ok(inner.connections.insert(conn_id.to_string(), handle))
    } else {
        Err(handle)
    }
}

async fn connect_and_install<F>(
    state: &ModbusTcpState,
    conn_id: &str,
    host: &str,
    port: u16,
    connector: F,
) -> Result<(uuid::Uuid, Option<ModbusMasterHandle>), String>
where
    F: Future<Output = std::io::Result<TcpStream>>,
{
    let (generation, pending_cancel) = begin_pending(state, conn_id, TransportKind::Tcp).await;

    let stream_result = tokio::select! {
        _ = pending_cancel.cancelled() => Err("Modbus TCP 连接已取消".to_string()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, connector) => {
            result
                .map_err(|_| format!("连接 {host}:{port} 超时"))
                .and_then(|result| result.map_err(|error| format!("连接 {host}:{port} 失败: {error}")))
        }
    };
    let stream = match stream_result {
        Ok(stream) => stream,
        Err(error) => {
            clear_pending_generation(state, conn_id, generation).await;
            return Err(error);
        }
    };
    if let Err(error) = stream.set_nodelay(true) {
        clear_pending_generation(state, conn_id, generation).await;
        return Err(format!("配置 Modbus TCP 连接失败: {error}"));
    }

    let status = ModbusTcpStatus {
        connected: true,
        conn_id: conn_id.to_string(),
        host: host.to_string(),
        port,
        connected_since: now_iso(),
    };
    let handle = ModbusMasterHandle::Tcp(ModbusTcpHandle {
        generation,
        stream: Arc::new(Mutex::new(stream)),
        next_transaction_id: Arc::new(AtomicU16::new(1)),
        cancel: CancellationToken::new(),
        status,
    });

    let install_result = install_pending_handle(state, conn_id, generation, handle).await;
    match install_result {
        Ok(previous) => Ok((generation, previous)),
        Err(handle) => {
            shutdown_handle(handle).await;
            Err("Modbus TCP 连接已取消".to_string())
        }
    }
}

async fn open_rtu_and_install<F>(
    state: &ModbusTcpState,
    conn_id: &str,
    port_name: &str,
    config: ModbusSerialConfig,
    opener: F,
) -> Result<(uuid::Uuid, Option<ModbusMasterHandle>), String>
where
    F: Future<Output = Result<tokio_serial::SerialStream, String>>,
{
    let (generation, pending_cancel) = begin_pending(state, conn_id, TransportKind::Rtu).await;
    let stream_result = tokio::select! {
        _ = pending_cancel.cancelled() => Err("Modbus RTU 打开已取消".to_string()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, opener) => {
            result.map_err(|_| format!("打开串口 {port_name} 超时")).and_then(|result| result)
        }
    };
    let stream = match stream_result {
        Ok(stream) => stream,
        Err(error) => {
            clear_pending_generation(state, conn_id, generation).await;
            return Err(error);
        }
    };

    let silent_interval = config.silent_interval();
    let status = ModbusRtuStatus {
        connected: true,
        conn_id: conn_id.to_string(),
        port_name: port_name.to_string(),
        config,
        connected_since: now_iso(),
    };
    let handle = ModbusMasterHandle::Rtu(ModbusRtuHandle {
        generation,
        io: Arc::new(Mutex::new(ModbusRtuIo {
            stream,
            last_exchange_end: Instant::now()
                .checked_sub(silent_interval)
                .unwrap_or_else(Instant::now),
        })),
        cancel: CancellationToken::new(),
        silent_interval,
        status,
    });
    match install_pending_handle(state, conn_id, generation, handle).await {
        Ok(previous) => Ok((generation, previous)),
        Err(handle) => {
            shutdown_handle(handle).await;
            Err("Modbus RTU 打开已取消".to_string())
        }
    }
}

async fn cancel_connection(
    state: &ModbusTcpState,
    conn_id: &str,
    transport: TransportKind,
) -> (Option<ModbusMasterHandle>, bool) {
    let (active, pending) = {
        let mut inner = state.inner.lock().await;
        let active = if inner
            .connections
            .get(conn_id)
            .is_some_and(|handle| handle.transport() == transport)
        {
            inner.connections.remove(conn_id)
        } else {
            None
        };
        let pending = if inner
            .pending
            .get(conn_id)
            .is_some_and(|pending| pending.transport == transport)
        {
            inner.pending.remove(conn_id)
        } else {
            None
        };
        (active, pending)
    };
    if let Some(pending) = pending.as_ref() {
        pending.cancel.cancel();
    }
    let had_pending = pending.is_some();
    (active, had_pending)
}

#[tauri::command]
pub async fn modbus_tcp_connect(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    let host = host.trim().to_string();
    if conn_id.is_empty() || conn_id.len() > 512 || conn_id.chars().any(char::is_control) {
        return Err("无效的 Modbus 连接 ID".to_string());
    }
    if host.is_empty() || host.len() > 253 || host.chars().any(char::is_control) {
        return Err("无效的 Modbus TCP 主机名".to_string());
    }
    if port == 0 {
        return Err("Modbus TCP 端口必须在 1..65535 范围内".to_string());
    }

    let (generation, previous) = connect_and_install(
        &state,
        &conn_id,
        &host,
        port,
        TcpStream::connect((host.as_str(), port)),
    )
    .await?;
    if let Some(previous) = previous {
        shutdown_handle(previous).await;
    }

    emit_master_connected_if_current(&app, &state, &conn_id, generation, format!("{host}:{port}"))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_disconnect(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<(), String> {
    let (removed, had_pending) = cancel_connection(&state, &conn_id, TransportKind::Tcp).await;
    let had_active = removed.is_some();
    if let Some(handle) = removed {
        shutdown_handle(handle).await;
    }
    if had_active || had_pending {
        emit_master_inactive_event(&app, &state, &conn_id, "disconnected", None).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn modbus_tcp_status(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<Option<ModbusTcpStatus>, String> {
    Ok(match state.inner.lock().await.connections.get(&conn_id) {
        Some(ModbusMasterHandle::Tcp(handle)) => Some(handle.status.clone()),
        _ => None,
    })
}

#[tauri::command]
pub async fn modbus_rtu_open(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    port_name: String,
    config: ModbusSerialConfig,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    let port_name = port_name.trim().to_string();
    if conn_id.is_empty() || conn_id.len() > 512 || conn_id.chars().any(char::is_control) {
        return Err("无效的 Modbus 连接 ID".to_string());
    }
    if port_name.is_empty() || port_name.len() > 1_024 || port_name.chars().any(char::is_control) {
        return Err("无效的串口名称".to_string());
    }
    let builder = config.builder(&port_name)?;
    let display_port = port_name.clone();
    let (generation, previous) =
        open_rtu_and_install(&state, &conn_id, &port_name, config, async move {
            builder
                .open_native_async()
                .map_err(|error| format!("打开串口 {display_port} 失败: {error}"))
        })
        .await?;
    if let Some(previous) = previous {
        shutdown_handle(previous).await;
    }
    emit_master_connected_if_current(
        &app,
        &state,
        &conn_id,
        generation,
        format!("RTU {port_name}"),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_close(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<(), String> {
    let (removed, had_pending) = cancel_connection(&state, &conn_id, TransportKind::Rtu).await;
    let had_active = removed.is_some();
    if let Some(handle) = removed {
        shutdown_handle(handle).await;
    }
    if had_active || had_pending {
        emit_master_inactive_event(&app, &state, &conn_id, "disconnected", None).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn modbus_rtu_status(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<Option<ModbusRtuStatus>, String> {
    Ok(match state.inner.lock().await.connections.get(&conn_id) {
        Some(ModbusMasterHandle::Rtu(handle)) => Some(handle.status.clone()),
        _ => None,
    })
}

async fn execute_tcp_request(
    app: &AppHandle,
    state: &ModbusTcpState,
    conn_id: &str,
    handle: &ModbusTcpHandle,
    spec: &RequestSpec,
    unit_id: u8,
) -> Result<WireResponse, String> {
    let transaction_id = handle.next_transaction_id.fetch_add(1, Ordering::Relaxed);
    let request = build_mbap_frame(transaction_id, unit_id, &spec.pdu)?;
    let mut stream = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus TCP 连接已断开".to_string()),
        stream = handle.stream.lock() => stream,
    };
    let exchange_result = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus TCP 连接已断开".to_string()),
        result = tokio::time::timeout(
            REQUEST_TIMEOUT,
            exchange_mbap(&mut stream, &request, transaction_id, unit_id),
        ) => {
            result.map_err(|_| "Modbus TCP 请求超时".to_string()).and_then(|result| result)
        }
    };
    drop(stream);
    match exchange_result {
        Ok(response) => Ok(response),
        Err(error) => {
            if remove_generation(state, conn_id, handle.generation).await {
                emit_master_inactive_event(app, state, conn_id, "error", Some(error.clone())).await;
            }
            Err(error)
        }
    }
}

async fn execute_rtu_request(
    app: &AppHandle,
    state: &ModbusTcpState,
    conn_id: &str,
    handle: &ModbusRtuHandle,
    spec: &RequestSpec,
    unit_id: u8,
) -> Result<WireResponse, String> {
    validate_rtu_unit_operation(unit_id, spec.function_code)?;
    let request = build_rtu_frame(unit_id, &spec.pdu)?;
    if unit_id == 0 {
        return execute_rtu_broadcast(app, state, conn_id, handle, spec, &request).await;
    }
    let mut io = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus RTU 连接已断开".to_string()),
        io = handle.io.lock() => io,
    };
    let exchange_result = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus RTU 连接已断开".to_string()),
        result = tokio::time::timeout(
            REQUEST_TIMEOUT,
            exchange_rtu(&mut io, handle.silent_interval, &request, spec, unit_id),
        ) => {
            match result {
                Ok(result) => result,
                Err(_) => Err(RtuExchangeError::Protocol("Modbus RTU 请求超时".to_string())),
            }
        }
    };
    match exchange_result {
        Ok(response) => Ok(response),
        Err(error) => {
            io.last_exchange_end = Instant::now();
            let clear_failed = io.stream.clear(ClearBuffer::Input).is_err();
            let fatal = error.is_fatal() || clear_failed;
            let message = error.message().to_string();
            drop(io);
            if fatal && remove_generation(state, conn_id, handle.generation).await {
                emit_master_inactive_event(app, state, conn_id, "error", Some(message.clone()))
                    .await;
            }
            Err(message)
        }
    }
}

async fn execute_rtu_broadcast(
    app: &AppHandle,
    state: &ModbusTcpState,
    conn_id: &str,
    handle: &ModbusRtuHandle,
    spec: &RequestSpec,
    request: &[u8],
) -> Result<WireResponse, String> {
    let mut io = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus RTU 连接已断开".to_string()),
        io = handle.io.lock() => io,
    };
    let result = tokio::select! {
        _ = handle.cancel.cancelled() => return Err("Modbus RTU 连接已断开".to_string()),
        result = tokio::time::timeout(
            REQUEST_TIMEOUT,
            write_rtu_broadcast(&mut io, handle.silent_interval, request),
        ) => {
            result.map_err(|_| "Modbus RTU 广播写入超时".to_string()).and_then(|result| result)
        }
    };
    drop(io);
    if let Err(error) = result {
        if remove_generation(state, conn_id, handle.generation).await {
            emit_master_inactive_event(app, state, conn_id, "error", Some(error.clone())).await;
        }
        return Err(error);
    }

    let pdu = rtu_broadcast_ack_pdu(spec)?;
    Ok(WireResponse {
        raw: Vec::new(),
        pdu,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn modbus_execute(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    unit_id: u16,
    function_code: u16,
    start_address: u32,
    quantity: u32,
    values: Vec<u32>,
) -> Result<ModbusResponse, String> {
    let unit_id = u8::try_from(unit_id).map_err(|_| "unitId 必须在 0..255 范围内".to_string())?;
    let spec = build_request_spec(function_code, start_address, quantity, values)?;
    let handle = state
        .inner
        .lock()
        .await
        .connections
        .get(&conn_id)
        .cloned()
        .ok_or_else(|| "Modbus 连接不存在或已断开".to_string())?;
    let started = Instant::now();
    let response = match &handle {
        ModbusMasterHandle::Tcp(handle) => {
            execute_tcp_request(&app, &state, &conn_id, handle, &spec, unit_id).await?
        }
        ModbusMasterHandle::Rtu(handle) => {
            execute_rtu_request(&app, &state, &conn_id, handle, &spec, unit_id).await?
        }
    };

    // A complete, correctly framed Modbus exception or malformed PDU is a
    // request-level failure. The underlying connection remains usable.
    let (registers, coils, write_count) = parse_response_pdu(&spec, &response.pdu)?;
    Ok(ModbusResponse {
        function_code: spec.function_code,
        registers,
        coils,
        write_count,
        raw_hex: bytes_to_hex(&response.raw),
        duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        timestamp: now_iso(),
    })
}

#[derive(Debug, PartialEq, Eq)]
struct SlavePduResponse {
    pdu: Vec<u8>,
    function_code: u8,
    start_address: Option<u16>,
    quantity: Option<u16>,
    values: Option<Vec<u16>>,
}

fn slave_exception(
    function_code: u8,
    exception_code: u8,
    start_address: Option<u16>,
    quantity: Option<u16>,
) -> SlavePduResponse {
    SlavePduResponse {
        pdu: vec![function_code | 0x80, exception_code],
        function_code,
        start_address,
        quantity,
        values: None,
    }
}

fn slave_address_range_valid(start_address: u16, quantity: u16) -> bool {
    u32::from(start_address) + u32::from(quantity) <= u32::from(u16::MAX) + 1
}

fn slave_start_quantity(pdu: &[u8]) -> (u16, u16) {
    (
        u16::from_be_bytes([pdu[1], pdu[2]]),
        u16::from_be_bytes([pdu[3], pdu[4]]),
    )
}

async fn process_slave_pdu(bank: &Arc<RwLock<ModbusSlaveBank>>, pdu: &[u8]) -> SlavePduResponse {
    let Some(&function_code) = pdu.first() else {
        return slave_exception(0, 1, None, None);
    };

    match function_code {
        1 | 2 => {
            if pdu.len() != 5 {
                return slave_exception(function_code, 3, None, None);
            }
            let (start_address, quantity) = slave_start_quantity(pdu);
            if !(1..=2_000).contains(&quantity) {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            if !slave_address_range_valid(start_address, quantity) {
                return slave_exception(function_code, 2, Some(start_address), Some(quantity));
            }
            let byte_count = usize::from(quantity).div_ceil(8);
            let mut response = vec![function_code, byte_count as u8];
            response.resize(2 + byte_count, 0);
            let bank = bank.read().await;
            for offset in 0..quantity {
                let address = start_address + offset;
                let value = if function_code == 1 {
                    bank.coils.get(&address).copied().unwrap_or(false)
                } else {
                    bank.discrete_inputs.get(&address).copied().unwrap_or(false)
                };
                if value {
                    let index = usize::from(offset);
                    response[2 + index / 8] |= 1u8 << (index % 8);
                }
            }
            SlavePduResponse {
                pdu: response,
                function_code,
                start_address: Some(start_address),
                quantity: Some(quantity),
                values: None,
            }
        }
        3 | 4 => {
            if pdu.len() != 5 {
                return slave_exception(function_code, 3, None, None);
            }
            let (start_address, quantity) = slave_start_quantity(pdu);
            if !(1..=125).contains(&quantity) {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            if !slave_address_range_valid(start_address, quantity) {
                return slave_exception(function_code, 2, Some(start_address), Some(quantity));
            }
            let mut response = Vec::with_capacity(2 + usize::from(quantity) * 2);
            response.push(function_code);
            response.push((quantity * 2) as u8);
            let bank = bank.read().await;
            for offset in 0..quantity {
                let address = start_address + offset;
                let value = if function_code == 3 {
                    bank.holding_registers.get(&address).copied().unwrap_or(0)
                } else {
                    bank.input_registers.get(&address).copied().unwrap_or(0)
                };
                response.extend_from_slice(&value.to_be_bytes());
            }
            SlavePduResponse {
                pdu: response,
                function_code,
                start_address: Some(start_address),
                quantity: Some(quantity),
                values: None,
            }
        }
        5 => {
            if pdu.len() != 5 {
                return slave_exception(function_code, 3, None, None);
            }
            let address = u16::from_be_bytes([pdu[1], pdu[2]]);
            let encoded = u16::from_be_bytes([pdu[3], pdu[4]]);
            let value = match encoded {
                0x0000 => false,
                0xff00 => true,
                _ => {
                    return slave_exception(function_code, 3, Some(address), Some(1));
                }
            };
            bank.write().await.coils.insert(address, value);
            SlavePduResponse {
                pdu: pdu.to_vec(),
                function_code,
                start_address: Some(address),
                quantity: Some(1),
                values: Some(vec![u16::from(value)]),
            }
        }
        6 => {
            if pdu.len() != 5 {
                return slave_exception(function_code, 3, None, None);
            }
            let address = u16::from_be_bytes([pdu[1], pdu[2]]);
            let value = u16::from_be_bytes([pdu[3], pdu[4]]);
            bank.write().await.holding_registers.insert(address, value);
            SlavePduResponse {
                pdu: pdu.to_vec(),
                function_code,
                start_address: Some(address),
                quantity: Some(1),
                values: Some(vec![value]),
            }
        }
        15 => {
            if pdu.len() < 6 {
                return slave_exception(function_code, 3, None, None);
            }
            let (start_address, quantity) = slave_start_quantity(pdu);
            if !(1..=1_968).contains(&quantity) {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            if !slave_address_range_valid(start_address, quantity) {
                return slave_exception(function_code, 2, Some(start_address), Some(quantity));
            }
            let byte_count = usize::from(pdu[5]);
            let expected_byte_count = usize::from(quantity).div_ceil(8);
            if byte_count != expected_byte_count || pdu.len() != 6 + byte_count {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            let values: Vec<u16> = (0..usize::from(quantity))
                .map(|index| u16::from(pdu[6 + index / 8] & (1u8 << (index % 8)) != 0))
                .collect();
            {
                let mut bank = bank.write().await;
                for (offset, value) in values.iter().copied().enumerate() {
                    bank.coils.insert(start_address + offset as u16, value != 0);
                }
            }
            let mut response = vec![function_code];
            response.extend_from_slice(&start_address.to_be_bytes());
            response.extend_from_slice(&quantity.to_be_bytes());
            SlavePduResponse {
                pdu: response,
                function_code,
                start_address: Some(start_address),
                quantity: Some(quantity),
                values: Some(values),
            }
        }
        16 => {
            if pdu.len() < 6 {
                return slave_exception(function_code, 3, None, None);
            }
            let (start_address, quantity) = slave_start_quantity(pdu);
            if !(1..=123).contains(&quantity) {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            if !slave_address_range_valid(start_address, quantity) {
                return slave_exception(function_code, 2, Some(start_address), Some(quantity));
            }
            let byte_count = usize::from(pdu[5]);
            if byte_count != usize::from(quantity) * 2 || pdu.len() != 6 + byte_count {
                return slave_exception(function_code, 3, Some(start_address), Some(quantity));
            }
            let values: Vec<u16> = pdu[6..]
                .chunks_exact(2)
                .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
                .collect();
            {
                let mut bank = bank.write().await;
                for (offset, value) in values.iter().copied().enumerate() {
                    bank.holding_registers
                        .insert(start_address + offset as u16, value);
                }
            }
            let mut response = vec![function_code];
            response.extend_from_slice(&start_address.to_be_bytes());
            response.extend_from_slice(&quantity.to_be_bytes());
            SlavePduResponse {
                pdu: response,
                function_code,
                start_address: Some(start_address),
                quantity: Some(quantity),
                values: Some(values),
            }
        }
        _ => slave_exception(function_code, 1, None, None),
    }
}

#[derive(Debug)]
struct SlaveTcpAdu {
    transaction_id: u16,
    unit_id: u8,
    pdu: Vec<u8>,
    raw: Vec<u8>,
}

#[derive(Debug)]
enum SlaveAduReadError {
    Io(String),
    Protocol(String),
}

impl SlaveAduReadError {
    fn message(&self) -> &str {
        match self {
            Self::Io(message) | Self::Protocol(message) => message,
        }
    }
}

fn validate_slave_mbap_header(header: &[u8; 7], unit_id: u8) -> Result<usize, String> {
    let protocol_id = u16::from_be_bytes([header[2], header[3]]);
    if protocol_id != 0 {
        return Err(format!("无效 MBAP 协议 ID: {protocol_id}"));
    }
    let length = usize::from(u16::from_be_bytes([header[4], header[5]]));
    if !(2..=MAX_MBAP_LENGTH).contains(&length) {
        return Err(format!("无效 MBAP 长度: {length}"));
    }
    if header[6] != unit_id {
        return Err(format!(
            "单元 ID 不匹配: 期望 {unit_id}, 收到 {}",
            header[6]
        ));
    }
    Ok(length)
}

async fn read_slave_tcp_adu(
    stream: &mut TcpStream,
    unit_id: u8,
) -> Result<Option<SlaveTcpAdu>, SlaveAduReadError> {
    let mut header = [0u8; 7];
    let first_byte = stream
        .read(&mut header[..1])
        .await
        .map_err(|error| SlaveAduReadError::Io(format!("读取 MBAP 头失败: {error}")))?;
    if first_byte == 0 {
        return Ok(None);
    }
    tokio::time::timeout(SLAVE_FRAME_TIMEOUT, stream.read_exact(&mut header[1..]))
        .await
        .map_err(|_| SlaveAduReadError::Protocol("读取完整 MBAP 头超时".to_string()))?
        .map_err(|error| SlaveAduReadError::Io(format!("读取完整 MBAP 头失败: {error}")))?;
    let length =
        validate_slave_mbap_header(&header, unit_id).map_err(SlaveAduReadError::Protocol)?;
    let mut pdu = vec![0u8; length - 1];
    tokio::time::timeout(SLAVE_FRAME_TIMEOUT, stream.read_exact(&mut pdu))
        .await
        .map_err(|_| SlaveAduReadError::Protocol("读取 Modbus TCP PDU 超时".to_string()))?
        .map_err(|error| SlaveAduReadError::Io(format!("读取 Modbus TCP PDU 失败: {error}")))?;
    let mut raw = Vec::with_capacity(header.len() + pdu.len());
    raw.extend_from_slice(&header);
    raw.extend_from_slice(&pdu);
    Ok(Some(SlaveTcpAdu {
        transaction_id: u16::from_be_bytes([header[0], header[1]]),
        unit_id: header[6],
        pdu,
        raw,
    }))
}

fn emit_slave_client_error(
    app: Option<&AppHandle>,
    conn_id: &str,
    client_addr: &str,
    message: String,
    generation: uuid::Uuid,
) {
    emit_slave_event(
        app,
        ModbusSlaveEvent {
            conn_id: conn_id.to_string(),
            event_type: "error".to_string(),
            generation: Some(generation.to_string()),
            client_addr: Some(client_addr.to_string()),
            unit_id: None,
            function_code: None,
            start_address: None,
            quantity: None,
            values: None,
            raw_hex: Some(message),
            timestamp: now_iso(),
        },
    );
}

fn emit_slave_request_frame(
    app: Option<&AppHandle>,
    conn_id: &str,
    generation: uuid::Uuid,
    client_addr: Option<&str>,
    unit_id: u8,
    raw: &[u8],
    response: &SlavePduResponse,
) {
    emit_slave_event(
        app,
        ModbusSlaveEvent {
            conn_id: conn_id.to_string(),
            event_type: "request".to_string(),
            generation: Some(generation.to_string()),
            client_addr: client_addr.map(str::to_string),
            unit_id: Some(unit_id),
            function_code: Some(response.function_code),
            start_address: response.start_address,
            quantity: response.quantity,
            values: response.values.clone(),
            raw_hex: Some(bytes_to_hex(raw)),
            timestamp: now_iso(),
        },
    );
}

fn emit_slave_request(
    app: Option<&AppHandle>,
    conn_id: &str,
    generation: uuid::Uuid,
    client_addr: &str,
    adu: &SlaveTcpAdu,
    response: &SlavePduResponse,
) {
    emit_slave_request_frame(
        app,
        conn_id,
        generation,
        Some(client_addr),
        adu.unit_id,
        &adu.raw,
        response,
    );
}

async fn serve_slave_tcp_client(
    mut stream: TcpStream,
    client_addr: String,
    conn_id: String,
    generation: uuid::Uuid,
    unit_id: u8,
    bank: Arc<RwLock<ModbusSlaveBank>>,
    cancel: CancellationToken,
    app: Option<AppHandle>,
) {
    if let Err(error) = stream.set_nodelay(true) {
        emit_slave_client_error(
            app.as_ref(),
            &conn_id,
            &client_addr,
            format!("配置客户端连接失败: {error}"),
            generation,
        );
        return;
    }

    loop {
        let adu = tokio::select! {
            biased;
            _ = cancel.cancelled() => return,
            result = tokio::time::timeout(
                SLAVE_IDLE_TIMEOUT,
                read_slave_tcp_adu(&mut stream, unit_id),
            ) => {
                result.unwrap_or_else(|_| {
                    Err(SlaveAduReadError::Protocol(
                        "Modbus TCP 客户端空闲超时".to_string(),
                    ))
                })
            },
        };
        let adu = match adu {
            Ok(Some(adu)) => adu,
            Ok(None) => return,
            Err(error) => {
                if !cancel.is_cancelled() {
                    emit_slave_client_error(
                        app.as_ref(),
                        &conn_id,
                        &client_addr,
                        error.message().to_string(),
                        generation,
                    );
                }
                return;
            }
        };

        let response = process_slave_pdu(&bank, &adu.pdu).await;
        emit_slave_request(
            app.as_ref(),
            &conn_id,
            generation,
            &client_addr,
            &adu,
            &response,
        );
        let response_frame = match build_mbap_frame(adu.transaction_id, unit_id, &response.pdu) {
            Ok(frame) => frame,
            Err(error) => {
                emit_slave_client_error(app.as_ref(), &conn_id, &client_addr, error, generation);
                return;
            }
        };
        let write_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => return,
            result = stream.write_all(&response_frame) => result,
        };
        if let Err(error) = write_result {
            if !cancel.is_cancelled() {
                emit_slave_client_error(
                    app.as_ref(),
                    &conn_id,
                    &client_addr,
                    format!("写入 Modbus TCP 响应失败: {error}"),
                    generation,
                );
            }
            return;
        }
    }
}

async fn drain_slave_clients(clients: &mut JoinSet<()>) {
    let drained = tokio::time::timeout(SLAVE_STOP_TIMEOUT, async {
        while clients.join_next().await.is_some() {}
    })
    .await
    .is_ok();
    if !drained {
        clients.abort_all();
        let _ = tokio::time::timeout(Duration::from_millis(250), async {
            while clients.join_next().await.is_some() {}
        })
        .await;
    }
}

async fn run_slave_tcp_listener(
    listener: TcpListener,
    ready: Arc<Notify>,
    state: Weak<Mutex<ModbusTcpStateInner>>,
    generation: uuid::Uuid,
    conn_id: String,
    unit_id: u8,
    bank: Arc<RwLock<ModbusSlaveBank>>,
    cancel: CancellationToken,
    app: Option<AppHandle>,
) {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => return,
        _ = ready.notified() => {}
    }

    let mut clients = JoinSet::new();
    let listener_error = loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break None,
            completed = clients.join_next(), if !clients.is_empty() => {
                if let Some(Err(error)) = completed {
                    emit_slave_lifecycle(
                        app.as_ref(),
                        &conn_id,
                        "error",
                        Some(format!("Modbus TCP 客户端任务异常结束: {error}")),
                        Some(generation),
                    );
                }
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, address)) => {
                        if clients.len() >= MAX_SLAVE_CLIENTS {
                            emit_slave_client_error(
                                app.as_ref(),
                                &conn_id,
                                &address.to_string(),
                                format!("客户端数量超过上限 {MAX_SLAVE_CLIENTS}"),
                                generation,
                            );
                            continue;
                        }
                        clients.spawn(serve_slave_tcp_client(
                            stream,
                            address.to_string(),
                            conn_id.clone(),
                            generation,
                            unit_id,
                            Arc::clone(&bank),
                            cancel.clone(),
                            app.clone(),
                        ));
                    }
                    Err(error) => break Some(format!("Modbus TCP 监听失败: {error}")),
                }
            }
        }
    };

    cancel.cancel();
    drain_slave_clients(&mut clients).await;
    drop(listener);

    if let Some(error) = listener_error {
        if let Some(state) = state.upgrade() {
            let mut inner = state.lock().await;
            if inner
                .slave_connections
                .get(&conn_id)
                .is_some_and(|handle| handle.generation() == generation)
            {
                inner.slave_connections.remove(&conn_id);
                // Keep removal and notification ordered against a replacement's
                // `started` event, which uses the same state lock.
                emit_slave_lifecycle(
                    app.as_ref(),
                    &conn_id,
                    "error",
                    Some(error),
                    Some(generation),
                );
                emit_slave_lifecycle(app.as_ref(), &conn_id, "stopped", None, Some(generation));
            }
        }
    }
}

async fn read_slave_rtu_frame(
    stream: &mut tokio_serial::SerialStream,
    silent_interval: Duration,
) -> Result<Option<Vec<u8>>, SlaveAduReadError> {
    let mut byte = [0u8; 1];
    let first = stream
        .read(&mut byte)
        .await
        .map_err(|error| SlaveAduReadError::Io(format!("读取 Modbus RTU 数据失败: {error}")))?;
    if first == 0 {
        return Ok(None);
    }

    let mut frame = Vec::with_capacity(MAX_RTU_FRAME_LENGTH);
    frame.push(byte[0]);
    let mut oversized = false;
    loop {
        match tokio::time::timeout(silent_interval, stream.read(&mut byte)).await {
            Err(_) => break,
            Ok(Ok(0)) => break,
            Ok(Ok(_)) => {
                if frame.len() < MAX_RTU_FRAME_LENGTH {
                    frame.push(byte[0]);
                } else {
                    oversized = true;
                }
            }
            Ok(Err(error)) => {
                return Err(SlaveAduReadError::Io(format!(
                    "读取 Modbus RTU 数据失败: {error}"
                )));
            }
        }
    }
    if oversized {
        return Err(SlaveAduReadError::Protocol(format!(
            "Modbus RTU 帧超过最大长度 {MAX_RTU_FRAME_LENGTH}"
        )));
    }
    Ok(Some(frame))
}

#[derive(Debug)]
struct SlaveRtuFrameOutcome {
    unit_id: u8,
    response: SlavePduResponse,
    response_frame: Option<Vec<u8>>,
}

async fn process_slave_rtu_frame(
    bank: &Arc<RwLock<ModbusSlaveBank>>,
    configured_unit_id: u8,
    frame: &[u8],
) -> Result<Option<SlaveRtuFrameOutcome>, String> {
    if !(4..=MAX_RTU_FRAME_LENGTH).contains(&frame.len()) {
        return Err(format!("无效 Modbus RTU 帧长度: {}", frame.len()));
    }
    let received_crc = u16::from_le_bytes([frame[frame.len() - 2], frame[frame.len() - 1]]);
    let expected_crc = modbus_crc16(&frame[..frame.len() - 2]);
    if received_crc != expected_crc {
        return Err(format!(
            "Modbus RTU CRC 不匹配: 期望 {expected_crc:04X}, 收到 {received_crc:04X}; {}",
            bytes_to_hex(frame)
        ));
    }

    let unit_id = frame[0];
    if unit_id != 0 && unit_id != configured_unit_id {
        return Ok(None);
    }
    let pdu = &frame[1..frame.len() - 2];
    let response = process_slave_pdu(bank, pdu).await;
    let response_frame = if unit_id == 0 {
        None
    } else {
        Some(build_rtu_frame(configured_unit_id, &response.pdu)?)
    };
    Ok(Some(SlaveRtuFrameOutcome {
        unit_id,
        response,
        response_frame,
    }))
}

#[allow(clippy::too_many_arguments)]
async fn run_slave_rtu_worker(
    mut stream: tokio_serial::SerialStream,
    silent_interval: Duration,
    ready: Arc<Notify>,
    state: Weak<Mutex<ModbusTcpStateInner>>,
    generation: uuid::Uuid,
    conn_id: String,
    configured_unit_id: u8,
    bank: Arc<RwLock<ModbusSlaveBank>>,
    cancel: CancellationToken,
    app: Option<AppHandle>,
) {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => return,
        _ = ready.notified() => {}
    }

    let fatal_error = loop {
        let frame_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => break None,
            result = read_slave_rtu_frame(&mut stream, silent_interval) => result,
        };
        let frame = match frame_result {
            Ok(Some(frame)) => frame,
            Ok(None) => break Some("Modbus RTU Slave 串口已关闭".to_string()),
            Err(SlaveAduReadError::Protocol(error)) => {
                emit_slave_lifecycle(
                    app.as_ref(),
                    &conn_id,
                    "error",
                    Some(error),
                    Some(generation),
                );
                continue;
            }
            Err(SlaveAduReadError::Io(error)) => break Some(error),
        };

        let outcome = match process_slave_rtu_frame(&bank, configured_unit_id, &frame).await {
            Ok(Some(outcome)) => outcome,
            Ok(None) => continue,
            Err(error) => {
                emit_slave_lifecycle(
                    app.as_ref(),
                    &conn_id,
                    "error",
                    Some(error),
                    Some(generation),
                );
                continue;
            }
        };
        emit_slave_request_frame(
            app.as_ref(),
            &conn_id,
            generation,
            None,
            outcome.unit_id,
            &frame,
            &outcome.response,
        );
        let Some(response_frame) = outcome.response_frame else {
            // Unit 0 is an RTU broadcast. Writes have already been applied;
            // reads and malformed requests are likewise never answered.
            continue;
        };
        let write_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => break None,
            // `SerialStream::flush` calls blocking `tcdrain` on Unix. A full
            // async write already enqueues the complete RTU frame and keeps
            // cancellation/timers responsive on both real ports and PTYs.
            result = tokio::time::timeout(REQUEST_TIMEOUT, stream.write_all(&response_frame)) => result,
        };
        match write_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => break Some(format!("写入 Modbus RTU Slave 响应失败: {error}")),
            Err(_) => break Some("写入 Modbus RTU Slave 响应超时".to_string()),
        }
    };

    drop(stream);
    if let Some(error) = fatal_error {
        if let Some(state) = state.upgrade() {
            let mut inner = state.lock().await;
            if inner
                .slave_connections
                .get(&conn_id)
                .is_some_and(|handle| handle.generation() == generation)
            {
                inner.slave_connections.remove(&conn_id);
                emit_slave_lifecycle(
                    app.as_ref(),
                    &conn_id,
                    "error",
                    Some(error),
                    Some(generation),
                );
                emit_slave_lifecycle(app.as_ref(), &conn_id, "stopped", None, Some(generation));
            }
        }
    }
}

async fn shutdown_slave_handle(handle: ModbusSlaveHandle) {
    handle.cancel().cancel();
    let task = handle.task().lock().await.take();
    if let Some(mut task) = task {
        if tokio::time::timeout(SLAVE_STOP_TIMEOUT, &mut task)
            .await
            .is_err()
        {
            task.abort();
            let _ = tokio::time::timeout(Duration::from_millis(250), task).await;
        }
    }
}

async fn emit_slave_stopped_if_inactive(
    app: Option<&AppHandle>,
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
) {
    let inner = state.inner.lock().await;
    if !inner.slave_connections.contains_key(conn_id) {
        // Emit while holding the state lock so a replacement's `started`
        // event cannot overtake this final `stopped` notification.
        emit_slave_lifecycle(app, conn_id, "stopped", None, Some(generation));
    }
}

async fn clear_slave_pending_generation(
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
) {
    let mut inner = state.inner.lock().await;
    if inner
        .slave_pending
        .get(conn_id)
        .is_some_and(|pending| pending.generation == generation)
    {
        inner.slave_pending.remove(conn_id);
    }
}

async fn begin_slave_start(
    state: &ModbusTcpState,
    conn_id: &str,
    transport: TransportKind,
) -> (uuid::Uuid, CancellationToken, Arc<Mutex<()>>) {
    let generation = uuid::Uuid::new_v4();
    let cancel = CancellationToken::new();
    let (previous, gate) = {
        let mut inner = state.inner.lock().await;
        let gate = Arc::clone(
            inner
                .slave_lifecycle_gates
                .entry(conn_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        );
        let previous = inner.slave_pending.insert(
            conn_id.to_string(),
            PendingSlaveStart {
                generation,
                cancel: cancel.clone(),
                transport,
            },
        );
        (previous, gate)
    };
    if let Some(previous) = previous {
        previous.cancel.cancel();
    }
    (generation, cancel, gate)
}

async fn take_slave_for_start(
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
    pending_cancel: &CancellationToken,
) -> Result<Option<ModbusSlaveHandle>, String> {
    let mut inner = state.inner.lock().await;
    if pending_cancel.is_cancelled()
        || !inner
            .slave_pending
            .get(conn_id)
            .is_some_and(|pending| pending.generation == generation)
    {
        return Err("Modbus Slave 启动已取消".to_string());
    }
    let previous = inner.slave_connections.remove(conn_id);
    if let Some(previous) = previous.as_ref() {
        previous.cancel().cancel();
    }
    Ok(previous)
}

async fn ensure_slave_start_current(
    state: &ModbusTcpState,
    conn_id: &str,
    generation: uuid::Uuid,
    pending_cancel: &CancellationToken,
) -> Result<(), String> {
    let current = {
        let inner = state.inner.lock().await;
        !pending_cancel.is_cancelled()
            && inner
                .slave_pending
                .get(conn_id)
                .is_some_and(|pending| pending.generation == generation)
    };
    if current {
        Ok(())
    } else {
        Err("Modbus Slave 启动已取消".to_string())
    }
}

async fn start_tcp_slave_with_listener<F>(
    app: Option<AppHandle>,
    state: &ModbusTcpState,
    conn_id: &str,
    host: &str,
    unit_id: u8,
    initial_bank: ModbusSlaveBank,
    listener_future: F,
) -> Result<uuid::Uuid, String>
where
    F: Future<Output = Result<TcpListener, String>>,
{
    let (generation, pending_cancel, lifecycle_gate) =
        begin_slave_start(state, conn_id, TransportKind::Tcp).await;
    let _lifecycle_guard = match tokio::select! {
        biased;
        _ = pending_cancel.cancelled() => None,
        guard = Arc::clone(&lifecycle_gate).lock_owned() => Some(guard),
    } {
        Some(guard) => guard,
        None => {
            clear_slave_pending_generation(state, conn_id, generation).await;
            return Err("Modbus TCP Slave 启动已取消".to_string());
        }
    };
    let previous = take_slave_for_start(state, conn_id, generation, &pending_cancel)
        .await
        .map_err(|_| "Modbus TCP Slave 启动已取消".to_string())?;
    if let Some(previous) = previous {
        let previous_generation = previous.generation();
        shutdown_slave_handle(previous).await;
        emit_slave_stopped_if_inactive(app.as_ref(), state, conn_id, previous_generation).await;
    }
    if ensure_slave_start_current(state, conn_id, generation, &pending_cancel)
        .await
        .is_err()
    {
        clear_slave_pending_generation(state, conn_id, generation).await;
        return Err("Modbus TCP Slave 启动已取消".to_string());
    }

    let listener_result = tokio::select! {
        biased;
        _ = pending_cancel.cancelled() => Err("Modbus TCP Slave 启动已取消".to_string()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, listener_future) => {
            result
                .map_err(|_| "Modbus TCP Slave 绑定超时".to_string())
                .and_then(|result| result)
        }
    };
    let listener = match listener_result {
        Ok(listener) => listener,
        Err(error) => {
            clear_slave_pending_generation(state, conn_id, generation).await;
            return Err(error);
        }
    };
    let bound_port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            clear_slave_pending_generation(state, conn_id, generation).await;
            return Err(format!("读取 Modbus TCP Slave 绑定地址失败: {error}"));
        }
    };
    let bank = Arc::new(RwLock::new(initial_bank));
    let ready = Arc::new(Notify::new());
    let cancel = CancellationToken::new();
    let task = tokio::spawn(run_slave_tcp_listener(
        listener,
        Arc::clone(&ready),
        Arc::downgrade(&state.inner),
        generation,
        conn_id.to_string(),
        unit_id,
        Arc::clone(&bank),
        cancel.clone(),
        app.clone(),
    ));
    let handle = ModbusSlaveHandle::Tcp(ModbusTcpSlaveHandle {
        generation,
        cancel,
        bank,
        task: Arc::new(Mutex::new(Some(task))),
        status: ModbusTcpSlaveStatus {
            conn_id: conn_id.to_string(),
            host: host.to_string(),
            port: bound_port,
            unit_id,
            started_at: now_iso(),
        },
    });

    let installed = {
        let mut inner = state.inner.lock().await;
        let current = inner
            .slave_pending
            .get(conn_id)
            .is_some_and(|pending| pending.generation == generation)
            && !pending_cancel.is_cancelled();
        if current {
            inner.slave_pending.remove(conn_id);
            inner
                .slave_connections
                .insert(conn_id.to_string(), handle.clone());
            emit_slave_lifecycle(app.as_ref(), conn_id, "started", None, Some(generation));
            true
        } else {
            false
        }
    };
    if !installed {
        shutdown_slave_handle(handle).await;
        return Err("Modbus TCP Slave 启动已取消".to_string());
    }
    ready.notify_one();
    Ok(generation)
}

#[allow(clippy::too_many_arguments)]
async fn start_rtu_slave_with_stream<F>(
    app: Option<AppHandle>,
    state: &ModbusTcpState,
    conn_id: &str,
    port_name: &str,
    config: ModbusSerialConfig,
    unit_id: u8,
    initial_bank: ModbusSlaveBank,
    stream_future: F,
) -> Result<uuid::Uuid, String>
where
    F: Future<Output = Result<tokio_serial::SerialStream, String>>,
{
    let (generation, pending_cancel, lifecycle_gate) =
        begin_slave_start(state, conn_id, TransportKind::Rtu).await;
    let _lifecycle_guard = match tokio::select! {
        biased;
        _ = pending_cancel.cancelled() => None,
        guard = Arc::clone(&lifecycle_gate).lock_owned() => Some(guard),
    } {
        Some(guard) => guard,
        None => {
            clear_slave_pending_generation(state, conn_id, generation).await;
            return Err("Modbus RTU Slave 启动已取消".to_string());
        }
    };
    let previous = take_slave_for_start(state, conn_id, generation, &pending_cancel)
        .await
        .map_err(|_| "Modbus RTU Slave 启动已取消".to_string())?;
    if let Some(previous) = previous {
        let previous_generation = previous.generation();
        shutdown_slave_handle(previous).await;
        emit_slave_stopped_if_inactive(app.as_ref(), state, conn_id, previous_generation).await;
    }
    if ensure_slave_start_current(state, conn_id, generation, &pending_cancel)
        .await
        .is_err()
    {
        clear_slave_pending_generation(state, conn_id, generation).await;
        return Err("Modbus RTU Slave 启动已取消".to_string());
    }

    let stream_result = tokio::select! {
        biased;
        _ = pending_cancel.cancelled() => Err("Modbus RTU Slave 启动已取消".to_string()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, stream_future) => {
            result
                .map_err(|_| "Modbus RTU Slave 打开串口超时".to_string())
                .and_then(|result| result)
        }
    };
    let stream = match stream_result {
        Ok(stream) => stream,
        Err(error) => {
            clear_slave_pending_generation(state, conn_id, generation).await;
            return Err(error);
        }
    };

    let silent_interval = config.silent_interval();
    let bank = Arc::new(RwLock::new(initial_bank));
    let ready = Arc::new(Notify::new());
    let cancel = CancellationToken::new();
    let task = tokio::spawn(run_slave_rtu_worker(
        stream,
        silent_interval,
        Arc::clone(&ready),
        Arc::downgrade(&state.inner),
        generation,
        conn_id.to_string(),
        unit_id,
        Arc::clone(&bank),
        cancel.clone(),
        app.clone(),
    ));
    let handle = ModbusSlaveHandle::Rtu(ModbusRtuSlaveHandle {
        generation,
        cancel,
        bank,
        task: Arc::new(Mutex::new(Some(task))),
        status: ModbusRtuSlaveStatus {
            conn_id: conn_id.to_string(),
            port_name: port_name.to_string(),
            config,
            unit_id,
            started_at: now_iso(),
        },
    });

    let installed = {
        let mut inner = state.inner.lock().await;
        let current = inner
            .slave_pending
            .get(conn_id)
            .is_some_and(|pending| pending.generation == generation)
            && !pending_cancel.is_cancelled();
        if current {
            inner.slave_pending.remove(conn_id);
            inner
                .slave_connections
                .insert(conn_id.to_string(), handle.clone());
            emit_slave_lifecycle(app.as_ref(), conn_id, "started", None, Some(generation));
            true
        } else {
            false
        }
    };
    if !installed {
        shutdown_slave_handle(handle).await;
        return Err("Modbus RTU Slave 启动已取消".to_string());
    }
    ready.notify_one();
    Ok(generation)
}

async fn stop_slave_transport(
    app: Option<&AppHandle>,
    state: &ModbusTcpState,
    conn_id: &str,
    transport: TransportKind,
) -> Result<(), String> {
    // Cancel an in-flight start before waiting for its lifecycle gate. This is
    // what lets stop interrupt a slow bind/open without permitting a newer
    // transition to overtake resource teardown.
    let (lifecycle_gate, pending) = {
        let mut inner = state.inner.lock().await;
        let lifecycle_gate = Arc::clone(
            inner
                .slave_lifecycle_gates
                .entry(conn_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        );
        let pending = if inner
            .slave_pending
            .get(conn_id)
            .is_some_and(|pending| pending.transport == transport)
        {
            inner.slave_pending.remove(conn_id)
        } else {
            None
        };
        if let Some(active) = inner
            .slave_connections
            .get(conn_id)
            .filter(|active| active.transport() == transport)
        {
            active.cancel().cancel();
        }
        (lifecycle_gate, pending)
    };
    if let Some(pending) = pending {
        pending.cancel.cancel();
    }

    let _lifecycle_guard = lifecycle_gate.lock_owned().await;
    let active = {
        let mut inner = state.inner.lock().await;
        let active = if inner
            .slave_connections
            .get(conn_id)
            .is_some_and(|active| active.transport() == transport)
        {
            inner.slave_connections.remove(conn_id)
        } else {
            None
        };
        if let Some(active) = active.as_ref() {
            active.cancel().cancel();
        }
        active
    };
    if let Some(active) = active {
        let generation = active.generation();
        shutdown_slave_handle(active).await;
        emit_slave_stopped_if_inactive(app, state, conn_id, generation).await;
    }
    Ok(())
}

async fn stop_slave_generation(
    app: Option<&AppHandle>,
    state: &ModbusTcpState,
    conn_id: &str,
    expected_generation: uuid::Uuid,
) -> Result<(), String> {
    // A panel may be stopping an old generation while another caller is
    // replacing it. Check once before waiting for the lifecycle gate, then
    // check again while holding that gate so the replacement is never removed.
    let lifecycle_gate = {
        let mut inner = state.inner.lock().await;
        let active = inner
            .slave_connections
            .get(conn_id)
            .ok_or_else(|| "Modbus Slave 未运行".to_string())?;
        if active.generation() != expected_generation {
            return Err("Modbus Slave 会话已替换".to_string());
        }
        active.cancel().cancel();
        Arc::clone(
            inner
                .slave_lifecycle_gates
                .entry(conn_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    };

    let _lifecycle_guard = lifecycle_gate.lock_owned().await;
    let active = {
        let mut inner = state.inner.lock().await;
        match inner.slave_connections.get(conn_id) {
            Some(active) if active.generation() == expected_generation => {
                inner.slave_connections.remove(conn_id)
            }
            Some(_) => return Err("Modbus Slave 会话已替换".to_string()),
            None => return Err("Modbus Slave 未运行".to_string()),
        }
    };
    if let Some(active) = active {
        shutdown_slave_handle(active).await;
        emit_slave_stopped_if_inactive(app, state, conn_id, expected_generation).await;
    }
    Ok(())
}

fn validate_slave_conn_id(conn_id: &str) -> Result<(), String> {
    if conn_id.is_empty() || conn_id.len() > 512 || conn_id.chars().any(char::is_control) {
        return Err("无效的 Modbus Slave 连接 ID".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn modbus_slave_tcp_start(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    host: String,
    port: u16,
    unit_id: u16,
    holding_registers: Vec<ModbusSlaveRegisterSeed>,
    coils: Vec<ModbusSlaveBitSeed>,
    input_registers: Vec<ModbusSlaveRegisterSeed>,
    discrete_inputs: Vec<ModbusSlaveBitSeed>,
) -> Result<String, String> {
    let conn_id = conn_id.trim().to_string();
    let host = host.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    if host.is_empty() || host.len() > 253 || host.chars().any(char::is_control) {
        return Err("无效的 Modbus TCP Slave 绑定主机".to_string());
    }
    let bind_host = host
        .parse::<IpAddr>()
        .map_err(|_| "Modbus TCP Slave 绑定主机必须是有效 IP 地址".to_string())?;
    if port == 0 {
        return Err("Modbus TCP Slave 端口必须在 1..65535 范围内".to_string());
    }
    let unit_id = u8::try_from(unit_id)
        .map_err(|_| "Modbus TCP Slave unitId 必须在 0..255 范围内".to_string())?;
    let initial_bank =
        build_slave_bank(holding_registers, coils, input_registers, discrete_inputs)?;
    let bind_error_host = host.clone();
    let result = start_tcp_slave_with_listener(
        Some(app.clone()),
        &state,
        &conn_id,
        &host,
        unit_id,
        initial_bank,
        async move {
            TcpListener::bind((bind_host, port)).await.map_err(|error| {
                format!("绑定 Modbus TCP Slave {bind_error_host}:{port} 失败: {error}")
            })
        },
    )
    .await;
    if let Err(error) = result.as_ref() {
        if !error.contains("已取消") {
            emit_slave_lifecycle(Some(&app), &conn_id, "error", Some(error.clone()), None);
        }
    }
    result.map(|generation| generation.to_string())
}

#[tauri::command]
pub async fn modbus_slave_tcp_stop(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    stop_slave_transport(Some(&app), &state, &conn_id, TransportKind::Tcp).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn modbus_slave_rtu_start(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    port_name: String,
    config: ModbusSerialConfig,
    unit_id: u16,
    holding_registers: Vec<ModbusSlaveRegisterSeed>,
    coils: Vec<ModbusSlaveBitSeed>,
    input_registers: Vec<ModbusSlaveRegisterSeed>,
    discrete_inputs: Vec<ModbusSlaveBitSeed>,
) -> Result<String, String> {
    let conn_id = conn_id.trim().to_string();
    let port_name = port_name.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    if port_name.is_empty() || port_name.len() > 1_024 || port_name.chars().any(char::is_control) {
        return Err("无效的 Modbus RTU Slave 串口名称".to_string());
    }
    let unit_id = u8::try_from(unit_id)
        .ok()
        .filter(|unit_id| (1..=247).contains(unit_id))
        .ok_or_else(|| "Modbus RTU Slave unitId 必须在 1..247 范围内".to_string())?;
    let builder = config.builder(&port_name)?;
    let initial_bank =
        build_slave_bank(holding_registers, coils, input_registers, discrete_inputs)?;
    let display_port = port_name.clone();
    let result = start_rtu_slave_with_stream(
        Some(app.clone()),
        &state,
        &conn_id,
        &port_name,
        config,
        unit_id,
        initial_bank,
        async move {
            builder
                .open_native_async()
                .map_err(|error| format!("打开 Modbus RTU Slave 串口 {display_port} 失败: {error}"))
        },
    )
    .await;
    if let Err(error) = result.as_ref() {
        if !error.contains("已取消") {
            emit_slave_lifecycle(Some(&app), &conn_id, "error", Some(error.clone()), None);
        }
    }
    result.map(|generation| generation.to_string())
}

#[tauri::command]
pub async fn modbus_slave_rtu_stop(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    stop_slave_transport(Some(&app), &state, &conn_id, TransportKind::Rtu).await
}

#[tauri::command]
pub async fn modbus_slave_stop(
    app: AppHandle,
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    expected_generation: String,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    let expected_generation = uuid::Uuid::parse_str(expected_generation.trim())
        .map_err(|_| "无效的 Modbus Slave generation".to_string())?;
    stop_slave_generation(Some(&app), &state, &conn_id, expected_generation).await
}

async fn update_slave_bank<F>(
    state: &ModbusTcpState,
    conn_id: &str,
    expected_generation: Option<uuid::Uuid>,
    update: F,
) -> Result<(), String>
where
    F: FnOnce(&mut ModbusSlaveBank),
{
    let (generation, bank) = {
        let inner = state.inner.lock().await;
        let handle = inner
            .slave_connections
            .get(conn_id)
            .ok_or_else(|| "Modbus Slave 未运行".to_string())?;
        if expected_generation.is_some_and(|expected| expected != handle.generation()) {
            return Err("Modbus Slave 会话已替换".to_string());
        }
        (handle.generation(), Arc::clone(handle.bank()))
    };
    {
        let mut bank = bank.write().await;
        update(&mut bank);
    }
    let still_current = state
        .inner
        .lock()
        .await
        .slave_connections
        .get(conn_id)
        .is_some_and(|current| current.generation() == generation);
    if still_current {
        Ok(())
    } else {
        Err("Modbus Slave 会话已替换".to_string())
    }
}

async fn apply_slave_bank_batch(
    state: &ModbusTcpState,
    conn_id: &str,
    expected_generation: uuid::Uuid,
    updates: ModbusSlaveBank,
) -> Result<(), String> {
    update_slave_bank(state, conn_id, Some(expected_generation), move |bank| {
        bank.holding_registers.extend(updates.holding_registers);
        bank.coils.extend(updates.coils);
        bank.input_registers.extend(updates.input_registers);
        bank.discrete_inputs.extend(updates.discrete_inputs);
    })
    .await
}

async fn slave_status_snapshot(state: &ModbusTcpState, conn_id: &str) -> Option<ModbusSlaveStatus> {
    // Copying a large sparse bank can overlap a stop/restart. Revalidate the
    // generation after the copy and retry once rather than returning stale data.
    for _ in 0..2 {
        let handle = state
            .inner
            .lock()
            .await
            .slave_connections
            .get(conn_id)
            .cloned()?;
        let (mut holding_registers, mut coils, mut input_registers, mut discrete_inputs) = {
            let bank = handle.bank().read().await;
            (
                bank.holding_registers
                    .iter()
                    .map(|(&address, &value)| ModbusSlaveRegisterEntry { address, value })
                    .collect::<Vec<_>>(),
                bank.coils
                    .iter()
                    .map(|(&address, &value)| ModbusSlaveBitEntry { address, value })
                    .collect::<Vec<_>>(),
                bank.input_registers
                    .iter()
                    .map(|(&address, &value)| ModbusSlaveRegisterEntry { address, value })
                    .collect::<Vec<_>>(),
                bank.discrete_inputs
                    .iter()
                    .map(|(&address, &value)| ModbusSlaveBitEntry { address, value })
                    .collect::<Vec<_>>(),
            )
        };
        let still_current = state
            .inner
            .lock()
            .await
            .slave_connections
            .get(conn_id)
            .is_some_and(|current| current.generation() == handle.generation());
        if !still_current {
            continue;
        }
        holding_registers.sort_unstable_by_key(|entry| entry.address);
        coils.sort_unstable_by_key(|entry| entry.address);
        input_registers.sort_unstable_by_key(|entry| entry.address);
        discrete_inputs.sort_unstable_by_key(|entry| entry.address);
        let status = match handle {
            ModbusSlaveHandle::Tcp(handle) => ModbusSlaveStatus {
                running: true,
                conn_id: handle.status.conn_id,
                generation: handle.generation.to_string(),
                transport: "tcp".to_string(),
                unit_id: handle.status.unit_id,
                started_at: handle.status.started_at,
                host: Some(handle.status.host),
                port: Some(handle.status.port),
                port_name: None,
                baud_rate: None,
                data_bits: None,
                stop_bits: None,
                parity: None,
                flow_control: None,
                holding_registers,
                coils,
                input_registers,
                discrete_inputs,
            },
            ModbusSlaveHandle::Rtu(handle) => ModbusSlaveStatus {
                running: true,
                conn_id: handle.status.conn_id,
                generation: handle.generation.to_string(),
                transport: "rtu".to_string(),
                unit_id: handle.status.unit_id,
                started_at: handle.status.started_at,
                host: None,
                port: None,
                port_name: Some(handle.status.port_name),
                baud_rate: Some(handle.status.config.baud_rate),
                data_bits: Some(handle.status.config.data_bits),
                stop_bits: Some(handle.status.config.stop_bits),
                parity: Some(handle.status.config.parity),
                flow_control: Some(handle.status.config.flow_control),
                holding_registers,
                coils,
                input_registers,
                discrete_inputs,
            },
        };
        return Some(status);
    }
    None
}

#[tauri::command]
pub async fn modbus_slave_status(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
) -> Result<Option<ModbusSlaveStatus>, String> {
    let conn_id = conn_id.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    Ok(slave_status_snapshot(&state, &conn_id).await)
}

#[tauri::command]
pub async fn modbus_slave_apply_batch(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    expected_generation: String,
    holding_registers: Vec<ModbusSlaveRegisterSeed>,
    coils: Vec<ModbusSlaveBitSeed>,
    input_registers: Vec<ModbusSlaveRegisterSeed>,
    discrete_inputs: Vec<ModbusSlaveBitSeed>,
) -> Result<(), String> {
    let conn_id = conn_id.trim().to_string();
    validate_slave_conn_id(&conn_id)?;
    let expected_generation = uuid::Uuid::parse_str(expected_generation.trim())
        .map_err(|_| "无效的 Modbus Slave generation".to_string())?;
    let updates = build_slave_bank(holding_registers, coils, input_registers, discrete_inputs)?;
    apply_slave_bank_batch(&state, &conn_id, expected_generation, updates).await
}

#[tauri::command]
pub async fn modbus_slave_set_holding_register(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    address: u32,
    value: u32,
) -> Result<(), String> {
    let address = checked_u16(address, "寄存器地址")?;
    let value = checked_u16(value, "寄存器值")?;
    update_slave_bank(&state, &conn_id, None, |bank| {
        bank.holding_registers.insert(address, value);
    })
    .await
}

#[tauri::command]
pub async fn modbus_slave_set_coil(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    address: u32,
    value: bool,
) -> Result<(), String> {
    let address = checked_u16(address, "线圈地址")?;
    update_slave_bank(&state, &conn_id, None, |bank| {
        bank.coils.insert(address, value);
    })
    .await
}

#[tauri::command]
pub async fn modbus_slave_set_input_register(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    address: u32,
    value: u32,
) -> Result<(), String> {
    let address = checked_u16(address, "输入寄存器地址")?;
    let value = checked_u16(value, "输入寄存器值")?;
    update_slave_bank(&state, &conn_id, None, |bank| {
        bank.input_registers.insert(address, value);
    })
    .await
}

#[tauri::command]
pub async fn modbus_slave_set_discrete_input(
    state: State<'_, ModbusTcpState>,
    conn_id: String,
    address: u32,
    value: bool,
) -> Result<(), String> {
    let address = checked_u16(address, "离散输入地址")?;
    update_slave_bank(&state, &conn_id, None, |bank| {
        bank.discrete_inputs.insert(address, value);
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn encodes_fc15_bits_lsb_first() {
        let spec = build_request_spec(15, 0x0013, 10, vec![1, 0, 1, 1, 0, 0, 1, 1, 1, 0])
            .expect("FC15 request should encode");
        assert_eq!(
            spec.pdu,
            vec![0x0f, 0x00, 0x13, 0x00, 0x0a, 0x02, 0xcd, 0x01]
        );
    }

    #[test]
    fn normalizes_fc5_wire_value() {
        let spec = build_request_spec(5, 7, 1, vec![1]).expect("FC5 request should encode");
        assert_eq!(spec.values, vec![0xff00]);
        assert_eq!(spec.pdu, vec![5, 0, 7, 0xff, 0]);
        assert!(parse_response_pdu(&spec, &[5, 0, 7, 0xff, 0]).is_ok());
    }

    #[test]
    fn computes_crc_and_builds_rtu_frame() {
        let payload = [0x01, 0x03, 0x00, 0x00, 0x00, 0x0a];
        assert_eq!(modbus_crc16(&payload), 0xcdc5);
        let frame = build_rtu_frame(1, &[3, 0, 0, 0, 10]).unwrap();
        assert_eq!(frame, vec![1, 3, 0, 0, 0, 10, 0xc5, 0xcd]);
    }

    #[test]
    fn derives_rtu_response_lengths_and_validates_prefix() {
        let registers = build_request_spec(3, 0, 2, vec![]).unwrap();
        assert_eq!(
            expected_rtu_response_length(&registers, &[1, 3, 4], 1).unwrap(),
            9
        );
        let coils = build_request_spec(1, 0, 10, vec![]).unwrap();
        assert_eq!(
            expected_rtu_response_length(&coils, &[1, 1, 2], 1).unwrap(),
            7
        );
        assert_eq!(
            expected_rtu_response_length(&registers, &[1, 0x83, 2], 1).unwrap(),
            5
        );
        assert!(expected_rtu_response_length(&registers, &[2, 3, 4], 1).is_err());
        assert!(expected_rtu_response_length(&registers, &[1, 4, 4], 1).is_err());
    }

    #[test]
    fn handles_rtu_broadcast_semantics() {
        assert!(validate_rtu_unit_operation(0, 3).is_err());
        assert!(validate_rtu_unit_operation(0, 16).is_ok());
        assert!(validate_rtu_unit_operation(1, 3).is_ok());

        let write_many = build_request_spec(16, 10, 2, vec![0x1234, 0xabcd]).unwrap();
        assert_eq!(
            rtu_broadcast_ack_pdu(&write_many).unwrap(),
            vec![16, 0, 10, 0, 2]
        );
        let write_coil = build_request_spec(5, 7, 1, vec![1]).unwrap();
        assert_eq!(
            rtu_broadcast_ack_pdu(&write_coil).unwrap(),
            vec![5, 0, 7, 0xff, 0]
        );
    }

    #[tokio::test]
    async fn serves_all_supported_slave_function_codes() {
        let bank = Arc::new(RwLock::new(ModbusSlaveBank::default()));
        {
            let mut bank = bank.write().await;
            bank.coils.insert(0, true);
            bank.coils.insert(2, true);
            bank.coils.insert(7, true);
            bank.coils.insert(8, true);
            bank.discrete_inputs.insert(1, true);
            bank.discrete_inputs.insert(3, true);
            bank.holding_registers.insert(10, 0x1234);
            bank.holding_registers.insert(11, 0xabcd);
            bank.input_registers.insert(20, 0x0102);
        }

        assert_eq!(
            process_slave_pdu(&bank, &[1, 0, 0, 0, 9]).await.pdu,
            vec![1, 2, 0x85, 0x01]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[2, 0, 0, 0, 5]).await.pdu,
            vec![2, 1, 0x0a]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[3, 0, 10, 0, 2]).await.pdu,
            vec![3, 4, 0x12, 0x34, 0xab, 0xcd]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[4, 0, 20, 0, 1]).await.pdu,
            vec![4, 2, 0x01, 0x02]
        );

        let write_coil = process_slave_pdu(&bank, &[5, 0, 4, 0xff, 0]).await;
        assert_eq!(write_coil.pdu, vec![5, 0, 4, 0xff, 0]);
        assert_eq!(write_coil.values, Some(vec![1]));
        let write_register = process_slave_pdu(&bank, &[6, 0, 12, 0xbe, 0xef]).await;
        assert_eq!(write_register.pdu, vec![6, 0, 12, 0xbe, 0xef]);
        assert_eq!(write_register.values, Some(vec![0xbeef]));

        let write_coils = process_slave_pdu(&bank, &[15, 0, 30, 0, 10, 2, 0x4d, 0x03]).await;
        assert_eq!(write_coils.pdu, vec![15, 0, 30, 0, 10]);
        assert_eq!(write_coils.values, Some(vec![1, 0, 1, 1, 0, 0, 1, 0, 1, 1]));
        let write_registers =
            process_slave_pdu(&bank, &[16, 0, 40, 0, 2, 4, 0x12, 0x34, 0xab, 0xcd]).await;
        assert_eq!(write_registers.pdu, vec![16, 0, 40, 0, 2]);
        assert_eq!(write_registers.values, Some(vec![0x1234, 0xabcd]));

        let bank = bank.read().await;
        assert_eq!(bank.coils.get(&4), Some(&true));
        assert_eq!(bank.coils.get(&31), Some(&false));
        assert_eq!(bank.coils.get(&39), Some(&true));
        assert_eq!(bank.holding_registers.get(&12), Some(&0xbeef));
        assert_eq!(bank.holding_registers.get(&40), Some(&0x1234));
        assert_eq!(bank.holding_registers.get(&41), Some(&0xabcd));
    }

    #[tokio::test]
    async fn returns_standard_slave_exceptions() {
        let bank = Arc::new(RwLock::new(ModbusSlaveBank::default()));
        assert_eq!(process_slave_pdu(&bank, &[7]).await.pdu, vec![0x87, 1]);
        assert_eq!(
            process_slave_pdu(&bank, &[3, 0, 0, 0, 0]).await.pdu,
            vec![0x83, 3]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[3, 0xff, 0xff, 0, 2]).await.pdu,
            vec![0x83, 2]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[5, 0, 1, 0x01, 0x00]).await.pdu,
            vec![0x85, 3]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[15, 0, 0, 0, 9, 1, 0xff])
                .await
                .pdu,
            vec![0x8f, 3]
        );
        assert_eq!(
            process_slave_pdu(&bank, &[16, 0, 0, 0, 2, 2, 0, 1])
                .await
                .pdu,
            vec![0x90, 3]
        );
    }

    #[test]
    fn validates_slave_mbap_header_fields() {
        let valid = [0x12, 0x34, 0, 0, 0, 6, 7];
        assert_eq!(validate_slave_mbap_header(&valid, 7).unwrap(), 6);

        let mut invalid = valid;
        invalid[3] = 1;
        assert!(validate_slave_mbap_header(&invalid, 7).is_err());
        invalid = valid;
        invalid[4..6].copy_from_slice(&1u16.to_be_bytes());
        assert!(validate_slave_mbap_header(&invalid, 7).is_err());
        invalid = valid;
        invalid[4..6].copy_from_slice(&255u16.to_be_bytes());
        assert!(validate_slave_mbap_header(&invalid, 7).is_err());
        invalid = valid;
        invalid[6] = 8;
        assert!(validate_slave_mbap_header(&invalid, 7).is_err());
    }

    #[test]
    fn validates_initial_slave_bank_entries() {
        let bank = build_slave_bank(
            vec![ModbusSlaveRegisterSeed {
                address: 65_535,
                value: 65_535,
            }],
            vec![ModbusSlaveBitSeed {
                address: 7,
                value: true,
            }],
            vec![],
            vec![],
        )
        .unwrap();
        assert_eq!(bank.holding_registers.get(&65_535), Some(&65_535));
        assert_eq!(bank.coils.get(&7), Some(&true));
        assert!(
            build_slave_bank(
                vec![ModbusSlaveRegisterSeed {
                    address: 65_536,
                    value: 0,
                }],
                vec![],
                vec![],
                vec![],
            )
            .is_err()
        );
        assert!(
            build_slave_bank(
                vec![ModbusSlaveRegisterSeed {
                    address: 0,
                    value: 65_536,
                }],
                vec![],
                vec![],
                vec![],
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_invalid_quantities_values_and_address_overflow() {
        assert!(build_request_spec(3, 0, 126, vec![]).is_err());
        assert!(build_request_spec(15, 0, 2, vec![1]).is_err());
        assert!(build_request_spec(16, 0, 2, vec![1, 70_000]).is_err());
        assert!(build_request_spec(3, 65_535, 2, vec![]).is_err());
    }

    #[test]
    fn validates_all_mbap_header_fields() {
        let valid = [0x12, 0x34, 0, 0, 0, 6, 9];
        assert_eq!(validate_mbap_header(&valid, 0x1234, 9).unwrap(), 6);

        let mut invalid = valid;
        invalid[3] = 1;
        assert!(
            validate_mbap_header(&invalid, 0x1234, 9)
                .unwrap_err()
                .contains("协议 ID")
        );
        invalid = valid;
        invalid[4..6].copy_from_slice(&1u16.to_be_bytes());
        assert!(
            validate_mbap_header(&invalid, 0x1234, 9)
                .unwrap_err()
                .contains("长度")
        );
        invalid = valid;
        invalid[6] = 10;
        assert!(
            validate_mbap_header(&invalid, 0x1234, 9)
                .unwrap_err()
                .contains("单元 ID")
        );
    }

    #[test]
    fn decodes_read_responses_and_exceptions() {
        let register_spec = build_request_spec(3, 10, 2, vec![]).unwrap();
        let (registers, coils, count) =
            parse_response_pdu(&register_spec, &[3, 4, 0x12, 0x34, 0xab, 0xcd]).unwrap();
        assert_eq!(registers, Some(vec![0x1234, 0xabcd]));
        assert_eq!(coils, None);
        assert_eq!(count, None);

        let coil_spec = build_request_spec(1, 0, 10, vec![]).unwrap();
        let (_, coils, _) =
            parse_response_pdu(&coil_spec, &[1, 2, 0b0100_1101, 0b0000_0011]).unwrap();
        assert_eq!(
            coils,
            Some(vec![
                true, false, true, true, false, false, true, false, true, true
            ])
        );
        assert!(
            parse_response_pdu(&register_spec, &[0x83, 2])
                .unwrap_err()
                .contains("非法数据地址")
        );
    }

    #[tokio::test]
    async fn exchanges_mbap_frame_over_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = [0u8; 7];
            stream.read_exact(&mut header).await.unwrap();
            assert_eq!(u16::from_be_bytes([header[0], header[1]]), 0x1234);
            assert_eq!(&header[2..4], &[0, 0]);
            assert_eq!(header[6], 9);
            let length = u16::from_be_bytes([header[4], header[5]]) as usize;
            let mut pdu = vec![0u8; length - 1];
            stream.read_exact(&mut pdu).await.unwrap();
            assert_eq!(pdu, vec![3, 0, 10, 0, 2]);

            let response = build_mbap_frame(0x1234, 9, &[3, 4, 0x12, 0x34, 0xab, 0xcd]).unwrap();
            stream.write_all(&response).await.unwrap();
        });

        let mut client = TcpStream::connect(address).await.unwrap();
        let spec = build_request_spec(3, 10, 2, vec![]).unwrap();
        let request = build_mbap_frame(0x1234, 9, &spec.pdu).unwrap();
        let response = exchange_mbap(&mut client, &request, 0x1234, 9)
            .await
            .unwrap();
        let (registers, _, _) = parse_response_pdu(&spec, &response.pdu).unwrap();
        assert_eq!(registers, Some(vec![0x1234, 0xabcd]));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn serves_tcp_slave_end_to_end_and_stops_idle_client() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = ModbusTcpState::default();
        let mut initial_bank = ModbusSlaveBank::default();
        initial_bank.holding_registers.insert(20, 0x1111);
        initial_bank.holding_registers.insert(21, 0x2222);
        start_tcp_slave_with_listener(
            None,
            &state,
            "slave-e2e",
            "127.0.0.1",
            0,
            initial_bank,
            async move { Ok(listener) },
        )
        .await
        .unwrap();

        let mut client = TcpStream::connect(address).await.unwrap();
        let initial_read = build_mbap_frame(9, 0, &[3, 0, 20, 0, 2]).unwrap();
        let initial_response = exchange_mbap(&mut client, &initial_read, 9, 0)
            .await
            .unwrap();
        assert_eq!(initial_response.pdu, vec![3, 4, 0x11, 0x11, 0x22, 0x22]);

        let write_request =
            build_mbap_frame(10, 0, &[16, 0, 20, 0, 2, 4, 0x12, 0x34, 0xab, 0xcd]).unwrap();
        let write_response = exchange_mbap(&mut client, &write_request, 10, 0)
            .await
            .unwrap();
        assert_eq!(write_response.pdu, vec![16, 0, 20, 0, 2]);

        let read_request = build_mbap_frame(11, 0, &[3, 0, 20, 0, 2]).unwrap();
        let read_response = exchange_mbap(&mut client, &read_request, 11, 0)
            .await
            .unwrap();
        assert_eq!(read_response.pdu, vec![3, 4, 0x12, 0x34, 0xab, 0xcd]);

        let status = slave_status_snapshot(&state, "slave-e2e").await.unwrap();
        assert_eq!(status.transport, "tcp");
        assert_eq!(status.port, Some(address.port()));
        assert_eq!(status.unit_id, 0);
        assert_eq!(
            status
                .holding_registers
                .iter()
                .map(|entry| (entry.address, entry.value))
                .collect::<Vec<_>>(),
            vec![(20, 0x1234), (21, 0xabcd)]
        );

        tokio::time::timeout(
            Duration::from_secs(2),
            stop_slave_transport(None, &state, "slave-e2e", TransportKind::Tcp),
        )
        .await
        .expect("slave stop must be bounded")
        .unwrap();
        assert!(slave_status_snapshot(&state, "slave-e2e").await.is_none());
        let mut byte = [0u8; 1];
        let closed = tokio::time::timeout(Duration::from_secs(2), client.read(&mut byte))
            .await
            .expect("idle client must be cancelled when the slave stops");
        assert!(matches!(closed, Ok(0) | Err(_)));
    }

    #[tokio::test]
    async fn stop_cancels_delayed_tcp_slave_start_before_install() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let state = Arc::new(ModbusTcpState::default());
        let gate = Arc::new(Notify::new());
        let start_task = {
            let state = Arc::clone(&state);
            let gate = Arc::clone(&gate);
            tokio::spawn(async move {
                start_tcp_slave_with_listener(
                    None,
                    &state,
                    "slave-race",
                    "127.0.0.1",
                    1,
                    ModbusSlaveBank::default(),
                    async move {
                        gate.notified().await;
                        Ok(listener)
                    },
                )
                .await
            })
        };
        for _ in 0..100 {
            if state
                .inner
                .lock()
                .await
                .slave_pending
                .contains_key("slave-race")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            state
                .inner
                .lock()
                .await
                .slave_pending
                .contains_key("slave-race")
        );
        stop_slave_transport(None, &state, "slave-race", TransportKind::Tcp)
            .await
            .unwrap();
        gate.notify_waiters();
        let error = start_task.await.unwrap().unwrap_err();
        assert!(error.contains("已取消"));
        let inner = state.inner.lock().await;
        assert!(!inner.slave_connections.contains_key("slave-race"));
        assert!(!inner.slave_pending.contains_key("slave-race"));
    }

    #[tokio::test]
    async fn concurrent_slave_restarts_wait_for_previous_listener_release() {
        use std::sync::atomic::AtomicBool;

        let state = Arc::new(ModbusTcpState::default());
        let held_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = held_listener.local_addr().unwrap();
        let active_cancel = CancellationToken::new();
        let release = Arc::new(Notify::new());
        let held_task = {
            let cancel = active_cancel.clone();
            let release = Arc::clone(&release);
            tokio::spawn(async move {
                cancel.cancelled().await;
                release.notified().await;
                drop(held_listener);
            })
        };
        state.inner.lock().await.slave_connections.insert(
            "serialized-restart".to_string(),
            ModbusSlaveHandle::Tcp(ModbusTcpSlaveHandle {
                generation: uuid::Uuid::new_v4(),
                cancel: active_cancel.clone(),
                bank: Arc::new(RwLock::new(ModbusSlaveBank::default())),
                task: Arc::new(Mutex::new(Some(held_task))),
                status: ModbusTcpSlaveStatus {
                    conn_id: "serialized-restart".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: address.port(),
                    unit_id: 1,
                    started_at: now_iso(),
                },
            }),
        );

        let first_opener_polled = Arc::new(AtomicBool::new(false));
        let first = {
            let state = Arc::clone(&state);
            let polled = Arc::clone(&first_opener_polled);
            tokio::spawn(async move {
                start_tcp_slave_with_listener(
                    None,
                    &state,
                    "serialized-restart",
                    "127.0.0.1",
                    1,
                    ModbusSlaveBank::default(),
                    async move {
                        polled.store(true, Ordering::SeqCst);
                        TcpListener::bind(address)
                            .await
                            .map_err(|error| error.to_string())
                    },
                )
                .await
            })
        };
        for _ in 0..100 {
            if active_cancel.is_cancelled() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(active_cancel.is_cancelled());

        let second_opener_polled = Arc::new(AtomicBool::new(false));
        let second = {
            let state = Arc::clone(&state);
            let polled = Arc::clone(&second_opener_polled);
            tokio::spawn(async move {
                start_tcp_slave_with_listener(
                    None,
                    &state,
                    "serialized-restart",
                    "127.0.0.1",
                    1,
                    ModbusSlaveBank::default(),
                    async move {
                        polled.store(true, Ordering::SeqCst);
                        TcpListener::bind(address)
                            .await
                            .map_err(|error| error.to_string())
                    },
                )
                .await
            })
        };

        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!first_opener_polled.load(Ordering::SeqCst));
        assert!(!second_opener_polled.load(Ordering::SeqCst));
        release.notify_one();

        assert!(first.await.unwrap().unwrap_err().contains("已取消"));
        second.await.unwrap().unwrap();
        assert!(second_opener_polled.load(Ordering::SeqCst));
        assert_eq!(
            slave_status_snapshot(&state, "serialized-restart")
                .await
                .unwrap()
                .port,
            Some(address.port())
        );
        stop_slave_transport(None, &state, "serialized-restart", TransportKind::Tcp)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn slave_batch_is_atomic_and_detects_generation_replacement() {
        let state = Arc::new(ModbusTcpState::default());
        let old_bank = Arc::new(RwLock::new(ModbusSlaveBank::default()));
        let old_generation = uuid::Uuid::new_v4();
        state.inner.lock().await.slave_connections.insert(
            "batch-race".to_string(),
            ModbusSlaveHandle::Tcp(ModbusTcpSlaveHandle {
                generation: old_generation,
                cancel: CancellationToken::new(),
                bank: Arc::clone(&old_bank),
                task: Arc::new(Mutex::new(None)),
                status: ModbusTcpSlaveStatus {
                    conn_id: "batch-race".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 502,
                    unit_id: 1,
                    started_at: now_iso(),
                },
            }),
        );

        let old_guard = old_bank.write().await;
        let update_task = {
            let state = Arc::clone(&state);
            tokio::spawn(async move {
                let mut updates = ModbusSlaveBank::default();
                updates.holding_registers.insert(1, 0x1234);
                updates.coils.insert(2, true);
                updates.input_registers.insert(3, 0xabcd);
                updates.discrete_inputs.insert(4, true);
                apply_slave_bank_batch(&state, "batch-race", old_generation, updates).await
            })
        };
        for _ in 0..100 {
            if Arc::strong_count(&old_bank) >= 3 {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(Arc::strong_count(&old_bank) >= 3);

        let replacement_bank = Arc::new(RwLock::new(ModbusSlaveBank::default()));
        let replacement_generation = uuid::Uuid::new_v4();
        state.inner.lock().await.slave_connections.insert(
            "batch-race".to_string(),
            ModbusSlaveHandle::Tcp(ModbusTcpSlaveHandle {
                generation: replacement_generation,
                cancel: CancellationToken::new(),
                bank: Arc::clone(&replacement_bank),
                task: Arc::new(Mutex::new(None)),
                status: ModbusTcpSlaveStatus {
                    conn_id: "batch-race".to_string(),
                    host: "127.0.0.1".to_string(),
                    port: 503,
                    unit_id: 1,
                    started_at: now_iso(),
                },
            }),
        );
        drop(old_guard);

        assert!(update_task.await.unwrap().unwrap_err().contains("已替换"));
        let old = old_bank.read().await;
        assert_eq!(old.holding_registers.get(&1), Some(&0x1234));
        assert_eq!(old.coils.get(&2), Some(&true));
        assert_eq!(old.input_registers.get(&3), Some(&0xabcd));
        assert_eq!(old.discrete_inputs.get(&4), Some(&true));
        drop(old);
        let replacement = replacement_bank.read().await;
        assert!(replacement.holding_registers.is_empty());
        assert!(replacement.coils.is_empty());
        assert!(replacement.input_registers.is_empty());
        assert!(replacement.discrete_inputs.is_empty());
        drop(replacement);

        let mut stale_updates = ModbusSlaveBank::default();
        stale_updates.holding_registers.insert(9, 0x9999);
        assert!(
            apply_slave_bank_batch(&state, "batch-race", old_generation, stale_updates)
                .await
                .unwrap_err()
                .contains("已替换")
        );
        assert!(replacement_bank.read().await.holding_registers.is_empty());

        assert!(
            stop_slave_generation(None, &state, "batch-race", old_generation)
                .await
                .unwrap_err()
                .contains("已替换")
        );
        assert_eq!(
            slave_status_snapshot(&state, "batch-race")
                .await
                .unwrap()
                .generation,
            replacement_generation.to_string()
        );
    }

    #[tokio::test]
    async fn disconnect_cancels_delayed_connect_before_install() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(ModbusTcpState::default());
        let gate = Arc::new(tokio::sync::Notify::new());
        let connect_task = {
            let state = Arc::clone(&state);
            let gate = Arc::clone(&gate);
            tokio::spawn(async move {
                connect_and_install(&state, "race", "127.0.0.1", address.port(), async move {
                    gate.notified().await;
                    TcpStream::connect(address).await
                })
                .await
            })
        };

        for _ in 0..100 {
            if state.inner.lock().await.pending.contains_key("race") {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(state.inner.lock().await.pending.contains_key("race"));
        let (active, had_pending) = cancel_connection(&state, "race", TransportKind::Tcp).await;
        assert!(active.is_none());
        assert!(had_pending);
        gate.notify_waiters();

        let error = match connect_task.await.unwrap() {
            Ok(_) => panic!("cancelled connect must not install a connection"),
            Err(error) => error,
        };
        assert!(error.contains("已取消"));
        let inner = state.inner.lock().await;
        assert!(!inner.connections.contains_key("race"));
        assert!(!inner.pending.contains_key("race"));
        drop(listener);
    }

    #[cfg(unix)]
    fn open_pty() -> (std::fs::File, String) {
        use std::ffi::CStr;
        use std::os::fd::FromRawFd;

        let mut master = -1;
        let mut slave = -1;
        let mut name = [0 as libc::c_char; 1024];
        let result = unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                name.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        assert_eq!(
            result,
            0,
            "openpty failed: {}",
            std::io::Error::last_os_error()
        );
        let path = unsafe { CStr::from_ptr(name.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        unsafe { libc::close(slave) };
        let master = unsafe { std::fs::File::from_raw_fd(master) };
        (master, path)
    }

    #[cfg(unix)]
    fn test_serial_config() -> ModbusSerialConfig {
        ModbusSerialConfig {
            baud_rate: 19_200,
            data_bits: 8,
            stop_bits: 1,
            parity: "none".to_string(),
            flow_control: "none".to_string(),
        }
    }

    #[cfg(unix)]
    fn test_pty_builder(path: &str) -> tokio_serial::SerialPortBuilder {
        // macOS rejects IOSSIOSPEED on pseudo terminals. A zero baud rate
        // keeps the PTY's existing speed while still exercising SerialStream.
        tokio_serial::new(path, 0)
            .data_bits(tokio_serial::DataBits::Eight)
            .stop_bits(tokio_serial::StopBits::One)
            .parity(tokio_serial::Parity::None)
            .flow_control(tokio_serial::FlowControl::None)
            .exclusive(false)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn serves_rtu_slave_seeded_writes_broadcasts_and_rejects_bad_crc() {
        let (mut peer, stream) = tokio_serial::SerialStream::pair().unwrap();
        let state = ModbusTcpState::default();
        let config = test_serial_config();
        let mut initial_bank = ModbusSlaveBank::default();
        initial_bank.holding_registers.insert(10, 0x1234);
        start_rtu_slave_with_stream(
            None,
            &state,
            "rtu-slave-e2e",
            "pair",
            config.clone(),
            1,
            initial_bank,
            async move { Ok(stream) },
        )
        .await
        .unwrap();

        let seeded_read = build_rtu_frame(1, &[3, 0, 10, 0, 1]).unwrap();
        peer.write_all(&seeded_read).await.unwrap();
        peer.flush().await.unwrap();
        let expected_seeded = build_rtu_frame(1, &[3, 2, 0x12, 0x34]).unwrap();
        let mut seeded_response = vec![0u8; expected_seeded.len()];
        tokio::time::timeout(
            Duration::from_secs(2),
            peer.read_exact(&mut seeded_response),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(seeded_response, expected_seeded);

        let write = build_rtu_frame(1, &[6, 0, 11, 0xbe, 0xef]).unwrap();
        peer.write_all(&write).await.unwrap();
        peer.flush().await.unwrap();
        let mut write_response = vec![0u8; write.len()];
        tokio::time::timeout(Duration::from_secs(2), peer.read_exact(&mut write_response))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(write_response, write);

        let broadcast = build_rtu_frame(0, &[6, 0, 12, 0xca, 0xfe]).unwrap();
        peer.write_all(&broadcast).await.unwrap();
        peer.flush().await.unwrap();
        let mut unexpected = [0u8; 1];
        assert!(
            tokio::time::timeout(Duration::from_millis(50), peer.read(&mut unexpected))
                .await
                .is_err(),
            "RTU broadcast writes must not receive a response"
        );

        let broadcast_read = build_rtu_frame(0, &[3, 0, 10, 0, 1]).unwrap();
        peer.write_all(&broadcast_read).await.unwrap();
        peer.flush().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), peer.read(&mut unexpected))
                .await
                .is_err(),
            "RTU broadcast reads must not receive a response"
        );

        let mut bad_crc = build_rtu_frame(1, &[6, 0, 13, 0xde, 0xad]).unwrap();
        *bad_crc.last_mut().unwrap() ^= 0xff;
        peer.write_all(&bad_crc).await.unwrap();
        peer.flush().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), peer.read(&mut unexpected))
                .await
                .is_err(),
            "bad CRC frames must not receive a response"
        );

        let status = slave_status_snapshot(&state, "rtu-slave-e2e")
            .await
            .unwrap();
        assert_eq!(status.transport, "rtu");
        assert_eq!(status.port_name.as_deref(), Some("pair"));
        assert_eq!(status.baud_rate, Some(19_200));
        assert_eq!(status.unit_id, 1);
        assert_eq!(
            status
                .holding_registers
                .iter()
                .map(|entry| (entry.address, entry.value))
                .collect::<Vec<_>>(),
            vec![(10, 0x1234), (11, 0xbeef), (12, 0xcafe)]
        );

        tokio::time::timeout(
            Duration::from_secs(2),
            stop_slave_transport(None, &state, "rtu-slave-e2e", TransportKind::Rtu),
        )
        .await
        .expect("RTU slave stop must be bounded")
        .unwrap();
        assert!(
            slave_status_snapshot(&state, "rtu-slave-e2e")
                .await
                .is_none()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stop_cancels_delayed_rtu_slave_start_before_install() {
        let (_peer, stream) = tokio_serial::SerialStream::pair().unwrap();
        let state = Arc::new(ModbusTcpState::default());
        let gate = Arc::new(Notify::new());
        let start_task = {
            let state = Arc::clone(&state);
            let gate = Arc::clone(&gate);
            tokio::spawn(async move {
                start_rtu_slave_with_stream(
                    None,
                    &state,
                    "rtu-slave-race",
                    "pair-race",
                    test_serial_config(),
                    1,
                    ModbusSlaveBank::default(),
                    async move {
                        gate.notified().await;
                        Ok(stream)
                    },
                )
                .await
            })
        };
        for _ in 0..100 {
            if state
                .inner
                .lock()
                .await
                .slave_pending
                .get("rtu-slave-race")
                .is_some_and(|pending| pending.transport == TransportKind::Rtu)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            state
                .inner
                .lock()
                .await
                .slave_pending
                .contains_key("rtu-slave-race")
        );
        stop_slave_transport(None, &state, "rtu-slave-race", TransportKind::Rtu)
            .await
            .unwrap();
        gate.notify_waiters();
        let error = start_task.await.unwrap().unwrap_err();
        assert!(error.contains("已取消"));
        let inner = state.inner.lock().await;
        assert!(!inner.slave_connections.contains_key("rtu-slave-race"));
        assert!(!inner.slave_pending.contains_key("rtu-slave-race"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn exchanges_rtu_frame_over_pty() {
        let (master, slave_path) = open_pty();
        let mut master = tokio::fs::File::from_std(master);
        let config = test_serial_config();
        let stream = test_pty_builder(&slave_path).open_native_async().unwrap();
        let server = tokio::spawn(async move {
            let mut request = [0u8; 8];
            master.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [1, 3, 0, 10, 0, 2, 0xe4, 0x09]);
            let response = build_rtu_frame(1, &[3, 4, 0x12, 0x34, 0xab, 0xcd]).unwrap();
            master.write_all(&response).await.unwrap();
            master.flush().await.unwrap();
        });

        let spec = build_request_spec(3, 10, 2, vec![]).unwrap();
        let request = build_rtu_frame(1, &spec.pdu).unwrap();
        let silent_interval = config.silent_interval();
        let mut io = ModbusRtuIo {
            stream,
            last_exchange_end: Instant::now()
                .checked_sub(silent_interval)
                .unwrap_or_else(Instant::now),
        };
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            exchange_rtu(&mut io, silent_interval, &request, &spec, 1),
        )
        .await
        .unwrap()
        .unwrap();
        let (registers, _, _) = parse_response_pdu(&spec, &response.pdu).unwrap();
        assert_eq!(registers, Some(vec![0x1234, 0xabcd]));
        server.await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn writes_rtu_broadcast_without_waiting_for_response() {
        let (master, slave_path) = open_pty();
        let mut master = tokio::fs::File::from_std(master);
        let config = test_serial_config();
        let stream = test_pty_builder(&slave_path).open_native_async().unwrap();
        let spec = build_request_spec(16, 10, 2, vec![0x1234, 0xabcd]).unwrap();
        let request = build_rtu_frame(0, &spec.pdu).unwrap();
        let expected_request = request.clone();
        let server = tokio::spawn(async move {
            let mut received = vec![0u8; expected_request.len()];
            master.read_exact(&mut received).await.unwrap();
            assert_eq!(received, expected_request);
            // RTU broadcasts do not have a response frame.
        });

        let silent_interval = config.silent_interval();
        let mut io = ModbusRtuIo {
            stream,
            last_exchange_end: Instant::now()
                .checked_sub(silent_interval)
                .unwrap_or_else(Instant::now),
        };
        tokio::time::timeout(
            Duration::from_secs(2),
            write_rtu_broadcast(&mut io, silent_interval, &request),
        )
        .await
        .expect("broadcast write must not wait for a response")
        .unwrap();
        server.await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn close_cancels_delayed_rtu_open() {
        let (master, slave_path) = open_pty();
        let state = Arc::new(ModbusTcpState::default());
        let gate = Arc::new(tokio::sync::Notify::new());
        let config = test_serial_config();
        let open_task = {
            let state = Arc::clone(&state);
            let gate = Arc::clone(&gate);
            let path = slave_path.clone();
            let config_for_open = config.clone();
            tokio::spawn(async move {
                let builder = test_pty_builder(&path);
                open_rtu_and_install(&state, "rtu-race", &path, config_for_open, async move {
                    gate.notified().await;
                    builder
                        .open_native_async()
                        .map_err(|error| error.to_string())
                })
                .await
            })
        };
        for _ in 0..100 {
            if state.inner.lock().await.pending.contains_key("rtu-race") {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(state.inner.lock().await.pending.contains_key("rtu-race"));
        let (active, pending) = cancel_connection(&state, "rtu-race", TransportKind::Rtu).await;
        assert!(active.is_none());
        assert!(pending);
        gate.notify_waiters();
        let result = open_task.await.unwrap();
        assert!(matches!(result, Err(ref error) if error.contains("已取消")));
        assert!(
            state
                .inner
                .lock()
                .await
                .connections
                .get("rtu-race")
                .is_none()
        );
        drop(master);
    }

    #[tokio::test]
    async fn rejects_mismatched_transaction_id() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 12];
            stream.read_exact(&mut request).await.unwrap();
            let response = build_mbap_frame(99, 1, &[3, 2, 0, 1]).unwrap();
            stream.write_all(&response).await.unwrap();
        });

        let mut client = TcpStream::connect(address).await.unwrap();
        let request = build_mbap_frame(98, 1, &[3, 0, 0, 0, 1]).unwrap();
        let error = exchange_mbap(&mut client, &request, 98, 1)
            .await
            .unwrap_err();
        assert!(error.contains("事务 ID 不匹配"));
    }
}
