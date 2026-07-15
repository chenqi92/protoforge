//! Asynchronous serial-port sessions used by the protocol debugging workbench.

use std::collections::HashMap;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicU8, Ordering},
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, OnceCell, mpsc, oneshot};
use tokio_serial::{SerialPort, SerialPortBuilderExt, SerialPortType};
use tokio_util::sync::CancellationToken;

use crate::tcp_client::{bytes_to_hex, decode_received_data, decode_send_data};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SEND_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
    pub flow_control: String,
}

impl SerialConfig {
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub port_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SerialSignals {
    pub cts: bool,
    pub dsr: bool,
    pub ri: bool,
    pub cd: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialEvent {
    pub port_id: String,
    pub generation: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<usize>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signals: Option<SerialSignals>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialStatus {
    pub open: bool,
    pub generation: String,
    pub port_name: String,
    pub config: SerialConfig,
    pub dtr: bool,
    pub rts: bool,
    pub signals: SerialSignals,
    pub connected_since: String,
}

const COMMAND_QUEUED: u8 = 0;
const COMMAND_STARTED: u8 = 1;
const COMMAND_COMPLETED: u8 = 2;
const COMMAND_CANCELLED_BEFORE_START: u8 = 3;
const COMMAND_CANCELLED_IN_FLIGHT: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandCancelOutcome {
    BeforeStart,
    InFlight,
    Completed,
}

/// Coordinates the caller's response deadline with the worker's side effect.
///
/// The atomic transition from queued to started prevents a timed-out queued
/// command from executing later. If cancellation wins after start, the worker
/// observes `cancelled()` and tears down the session because a serial write may
/// already have been partially committed by the OS.
#[derive(Clone)]
struct CommandControl {
    state: Arc<AtomicU8>,
    cancellation: CancellationToken,
}

impl CommandControl {
    fn new() -> Self {
        Self {
            state: Arc::new(AtomicU8::new(COMMAND_QUEUED)),
            cancellation: CancellationToken::new(),
        }
    }

    fn is_cancelled(&self) -> bool {
        matches!(
            self.state.load(Ordering::SeqCst),
            COMMAND_CANCELLED_BEFORE_START | COMMAND_CANCELLED_IN_FLIGHT
        )
    }

    /// Claims the command immediately before its side effect.
    fn begin(&self) -> bool {
        self.state
            .compare_exchange(
                COMMAND_QUEUED,
                COMMAND_STARTED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    /// Marks the side effect and status update complete before responding.
    fn complete(&self) -> bool {
        self.state
            .compare_exchange(
                COMMAND_STARTED,
                COMMAND_COMPLETED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn cancel(&self) -> CommandCancelOutcome {
        loop {
            let current = self.state.load(Ordering::SeqCst);
            let (next, outcome) = match current {
                COMMAND_QUEUED => (
                    COMMAND_CANCELLED_BEFORE_START,
                    CommandCancelOutcome::BeforeStart,
                ),
                COMMAND_STARTED => (COMMAND_CANCELLED_IN_FLIGHT, CommandCancelOutcome::InFlight),
                COMMAND_COMPLETED => return CommandCancelOutcome::Completed,
                COMMAND_CANCELLED_BEFORE_START => return CommandCancelOutcome::BeforeStart,
                COMMAND_CANCELLED_IN_FLIGHT => return CommandCancelOutcome::InFlight,
                _ => unreachable!("invalid serial command state"),
            };
            if self
                .state
                .compare_exchange(current, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                self.cancellation.cancel();
                return outcome;
            }
        }
    }

    async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }
}

enum SerialCommand {
    Write {
        bytes: Vec<u8>,
        control: CommandControl,
        response: oneshot::Sender<Result<(), String>>,
    },
    SetDtr {
        value: bool,
        control: CommandControl,
        response: oneshot::Sender<Result<(), String>>,
    },
    SetRts {
        value: bool,
        control: CommandControl,
        response: oneshot::Sender<Result<(), String>>,
    },
    Close {
        response: oneshot::Sender<()>,
    },
}

#[derive(Clone)]
pub(crate) struct SerialHandle {
    command_tx: mpsc::Sender<SerialCommand>,
    status: Arc<RwLock<SerialStatus>>,
    abort_handle: tokio::task::AbortHandle,
    shutdown: Arc<OnceCell<()>>,
}

pub(crate) enum ConnectionSlot<H> {
    Pending {
        generation: uuid::Uuid,
        retiring: Option<H>,
    },
    Open {
        generation: uuid::Uuid,
        handle: H,
    },
    Tombstone {
        generation: uuid::Uuid,
        retiring: Option<H>,
    },
}

struct OpenReservation<H> {
    retiring: Option<H>,
    replaced_generation: Option<uuid::Uuid>,
}

struct Cancellation<H> {
    generation: uuid::Uuid,
    retiring: Option<H>,
    was_active: bool,
}

pub(crate) type SerialConnectionSlot = ConnectionSlot<SerialHandle>;
pub type SerialConnections = Arc<Mutex<HashMap<String, SerialConnectionSlot>>>;

pub fn new_connections() -> SerialConnections {
    Arc::new(Mutex::new(HashMap::new()))
}

fn reserve_open<H: Clone>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    generation: uuid::Uuid,
) -> OpenReservation<H> {
    let (retiring, replaced_generation) = match connections.remove(port_id) {
        Some(ConnectionSlot::Open { generation, handle }) => (Some(handle), Some(generation)),
        Some(ConnectionSlot::Pending { retiring, .. })
        | Some(ConnectionSlot::Tombstone { retiring, .. }) => (retiring, None),
        None => (None, None),
    };
    connections.insert(
        port_id.to_string(),
        ConnectionSlot::Pending {
            generation,
            retiring: retiring.clone(),
        },
    );
    OpenReservation {
        retiring,
        replaced_generation,
    }
}

fn cancel_current<H: Clone>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
) -> Option<Cancellation<H>> {
    let current = connections.remove(port_id)?;
    let (generation, retiring, was_active) = match current {
        ConnectionSlot::Pending {
            generation,
            retiring,
        } => (generation, retiring, true),
        ConnectionSlot::Open { generation, handle } => (generation, Some(handle), true),
        ConnectionSlot::Tombstone {
            generation,
            retiring,
        } => (generation, retiring, false),
    };
    connections.insert(
        port_id.to_string(),
        ConnectionSlot::Tombstone {
            generation,
            retiring: retiring.clone(),
        },
    );
    Some(Cancellation {
        generation,
        retiring,
        was_active,
    })
}

fn cancel_generation<H: Clone>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    expected_generation: uuid::Uuid,
) -> Option<Cancellation<H>> {
    let matches_generation = matches!(
        connections.get(port_id),
        Some(ConnectionSlot::Pending { generation, .. })
            | Some(ConnectionSlot::Open { generation, .. })
            | Some(ConnectionSlot::Tombstone { generation, .. })
            if *generation == expected_generation
    );
    matches_generation
        .then(|| cancel_current(connections, port_id))
        .flatten()
}

fn is_pending_generation<H>(
    connections: &HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    generation: uuid::Uuid,
) -> bool {
    matches!(
        connections.get(port_id),
        Some(ConnectionSlot::Pending {
            generation: current,
            ..
        }) if *current == generation
    )
}

fn install_if_pending<H>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    generation: uuid::Uuid,
    handle: H,
) -> Result<(), H> {
    if !is_pending_generation(connections, port_id, generation) {
        return Err(handle);
    }
    connections.insert(
        port_id.to_string(),
        ConnectionSlot::Open { generation, handle },
    );
    Ok(())
}

fn remove_open_generation<H>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    generation: uuid::Uuid,
) -> bool {
    let matches_generation = matches!(
        connections.get(port_id),
        Some(ConnectionSlot::Open {
            generation: current,
            ..
        }) if *current == generation
    );
    if matches_generation {
        connections.remove(port_id);
    }
    matches_generation
}

fn clear_inactive_generation<H>(
    connections: &mut HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    generation: uuid::Uuid,
) -> bool {
    let matches_generation = matches!(
        connections.get(port_id),
        Some(ConnectionSlot::Pending {
            generation: current,
            ..
        }) | Some(ConnectionSlot::Tombstone {
            generation: current,
            ..
        }) if *current == generation
    );
    if matches_generation {
        connections.remove(port_id);
    }
    matches_generation
}

fn clone_open_handle_for_generation<H: Clone>(
    connections: &HashMap<String, ConnectionSlot<H>>,
    port_id: &str,
    expected_generation: uuid::Uuid,
) -> Result<H, String> {
    match connections.get(port_id) {
        Some(ConnectionSlot::Open { generation, handle }) if *generation == expected_generation => {
            Ok(handle.clone())
        }
        Some(ConnectionSlot::Open { .. }) => Err("串口会话已被替换".to_string()),
        Some(ConnectionSlot::Pending { .. } | ConnectionSlot::Tombstone { .. }) | None => {
            Err("串口未打开".to_string())
        }
    }
}

fn parse_generation(generation: &str) -> Result<uuid::Uuid, String> {
    uuid::Uuid::parse_str(generation).map_err(|_| "串口 generation 无效".to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn emit_event(app: Option<&AppHandle>, event: SerialEvent) {
    if let Some(app) = app {
        let _ = app.emit("serial-event", event);
    }
}

fn simple_event(
    port_id: &str,
    generation: uuid::Uuid,
    event_type: &str,
    data: Option<String>,
) -> SerialEvent {
    SerialEvent {
        port_id: port_id.to_string(),
        generation: generation.to_string(),
        event_type: event_type.to_string(),
        data,
        raw_hex: None,
        size: None,
        timestamp: now_iso(),
        signals: None,
    }
}

fn read_status(status: &RwLock<SerialStatus>) -> SerialStatus {
    status
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn with_status(status: &RwLock<SerialStatus>, update: impl FnOnce(&mut SerialStatus)) {
    let mut guard = status
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    update(&mut guard);
}

fn emit_then_start_worker(
    start_tx: oneshot::Sender<()>,
    emit_opened: impl FnOnce(),
) -> Result<(), ()> {
    emit_opened();
    start_tx.send(())
}

enum WorkerExit {
    Closed(Option<oneshot::Sender<()>>),
    Error(String),
}

async fn run_serial_worker(
    port_id: String,
    mut stream: tokio_serial::SerialStream,
    mut command_rx: mpsc::Receiver<SerialCommand>,
    status: Arc<RwLock<SerialStatus>>,
    app: Option<AppHandle>,
    connections: Option<SerialConnections>,
    generation: uuid::Uuid,
    start_rx: Option<oneshot::Receiver<()>>,
    command_timeout: Duration,
) {
    if let Some(start_rx) = start_rx {
        if start_rx.await.is_err() {
            with_status(&status, |status| status.open = false);
            return;
        }
    }
    let mut buffer = vec![0u8; 64 * 1024];
    let mut signal_timer = tokio::time::interval(Duration::from_millis(500));
    signal_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_signals: Option<SerialSignals> = None;

    let exit = loop {
        tokio::select! {
            command = command_rx.recv() => {
                match command {
                    Some(SerialCommand::Write { bytes, control, response }) => {
                        // Check both when dequeued and atomically again immediately before write.
                        if control.is_cancelled() || !control.begin() {
                            let _ = response.send(Err("串口命令已在执行前取消".to_string()));
                            continue;
                        }

                        let write_result = tokio::select! {
                            biased;
                            _ = control.cancelled() => None,
                            result = tokio::time::timeout(command_timeout, stream.write_all(&bytes)) => Some(result),
                        };
                        let Some(write_result) = write_result else {
                            let error = "串口写入等待响应时超时，结果未知；连接已关闭以避免重复写入".to_string();
                            let _ = response.send(Err(error.clone()));
                            break WorkerExit::Error(error);
                        };

                        match write_result {
                            Ok(Ok(())) if control.complete() => {
                                let _ = response.send(Ok(()));
                            }
                            Ok(Ok(())) => {
                                let error = "串口写入完成时调用方已超时，结果未知；连接已关闭以避免重复写入".to_string();
                                let _ = response.send(Err(error.clone()));
                                break WorkerExit::Error(error);
                            }
                            Ok(Err(error)) => {
                                let message = format!("串口写入失败且结果未知: {error}；连接已关闭");
                                let _ = control.complete();
                                let _ = response.send(Err(message.clone()));
                                break WorkerExit::Error(message);
                            }
                            Err(_) => {
                                let message = "串口写入超时且结果未知；连接已关闭以避免重复写入".to_string();
                                let _ = control.complete();
                                let _ = response.send(Err(message.clone()));
                                break WorkerExit::Error(message);
                            }
                        }
                    }
                    Some(SerialCommand::SetDtr { value, control, response }) => {
                        if control.is_cancelled() || !control.begin() {
                            let _ = response.send(Err("串口命令已在执行前取消".to_string()));
                            continue;
                        }
                        let result = stream
                            .write_data_terminal_ready(value)
                            .map_err(|error| format!("设置 DTR 失败: {error}"));
                        if result.is_ok() {
                            with_status(&status, |status| status.dtr = value);
                        }
                        if control.complete() {
                            let _ = response.send(result);
                        } else {
                            let error = "DTR 命令执行时调用方已超时，结果未知；连接已关闭".to_string();
                            let _ = response.send(Err(error.clone()));
                            break WorkerExit::Error(error);
                        }
                    }
                    Some(SerialCommand::SetRts { value, control, response }) => {
                        if control.is_cancelled() || !control.begin() {
                            let _ = response.send(Err("串口命令已在执行前取消".to_string()));
                            continue;
                        }
                        let result = stream
                            .write_request_to_send(value)
                            .map_err(|error| format!("设置 RTS 失败: {error}"));
                        if result.is_ok() {
                            with_status(&status, |status| status.rts = value);
                        }
                        if control.complete() {
                            let _ = response.send(result);
                        } else {
                            let error = "RTS 命令执行时调用方已超时，结果未知；连接已关闭".to_string();
                            let _ = response.send(Err(error.clone()));
                            break WorkerExit::Error(error);
                        }
                    }
                    Some(SerialCommand::Close { response }) => {
                        break WorkerExit::Closed(Some(response));
                    }
                    None => break WorkerExit::Closed(None),
                }
            }
            read_result = stream.read(&mut buffer) => {
                match read_result {
                    Ok(0) => break WorkerExit::Closed(None),
                    Ok(size) => {
                        let bytes = &buffer[..size];
                        emit_event(app.as_ref(), SerialEvent {
                            port_id: port_id.clone(),
                            generation: generation.to_string(),
                            event_type: "data".to_string(),
                            data: Some(decode_received_data(bytes, "auto")),
                            raw_hex: Some(bytes_to_hex(bytes)),
                            size: Some(size),
                            timestamp: now_iso(),
                            signals: None,
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => break WorkerExit::Error(format!("串口读取失败: {error}")),
                }
            }
            _ = signal_timer.tick() => {
                let values = (
                    stream.read_clear_to_send(),
                    stream.read_data_set_ready(),
                    stream.read_ring_indicator(),
                    stream.read_carrier_detect(),
                );
                if let (Ok(cts), Ok(dsr), Ok(ri), Ok(cd)) = values {
                    let signals = SerialSignals { cts, dsr, ri, cd };
                    // Status is a snapshot API, so refresh it on every successful poll
                    // even when no edge-triggered event needs to be emitted.
                    with_status(&status, |status| status.signals = signals.clone());
                    if last_signals.as_ref() != Some(&signals) {
                        last_signals = Some(signals.clone());
                        emit_event(app.as_ref(), SerialEvent {
                            port_id: port_id.clone(),
                            generation: generation.to_string(),
                            event_type: "signals".to_string(),
                            data: None,
                            raw_hex: None,
                            size: None,
                            timestamp: now_iso(),
                            signals: Some(signals),
                        });
                    }
                }
            }
        }
    };

    with_status(&status, |status| status.open = false);
    let (terminal_type, terminal_data) = match &exit {
        WorkerExit::Closed(_) => ("closed", None),
        WorkerExit::Error(error) => ("error", Some(error.clone())),
    };
    if let Some(connections) = connections {
        let mut handles = connections.lock().await;
        if remove_open_generation(&mut handles, &port_id, generation) {
            // Keep generation validation and terminal publication in the same
            // critical section so a newer opened event cannot be overtaken.
            emit_event(
                app.as_ref(),
                simple_event(&port_id, generation, terminal_type, terminal_data),
            );
        }
    } else {
        emit_event(
            app.as_ref(),
            simple_event(&port_id, generation, terminal_type, terminal_data),
        );
    }

    if let WorkerExit::Closed(Some(response)) = exit {
        let _ = response.send(());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EnqueueError {
    Timeout,
    Closed,
}

async fn enqueue_with_timeout<T>(
    sender: &mpsc::Sender<T>,
    value: T,
    timeout: Duration,
) -> Result<(), EnqueueError> {
    tokio::time::timeout(timeout, sender.send(value))
        .await
        .map_err(|_| EnqueueError::Timeout)?
        .map_err(|_| EnqueueError::Closed)
}

async fn stop_handle_with_timeout(handle: &SerialHandle, command_timeout: Duration) {
    let command_tx = handle.command_tx.clone();
    let abort_handle = handle.abort_handle.clone();
    let status = handle.status.clone();
    handle
        .shutdown
        .get_or_init(|| async move {
            let (response_tx, response_rx) = oneshot::channel();
            let enqueued = enqueue_with_timeout(
                &command_tx,
                SerialCommand::Close {
                    response: response_tx,
                },
                command_timeout,
            )
            .await
            .is_ok();
            let closed_gracefully = enqueued
                && tokio::time::timeout(command_timeout, response_rx)
                    .await
                    .is_ok_and(|result| result.is_ok());

            if !closed_gracefully {
                // 队列已满、worker 卡死或已经退出时，关闭操作也必须有界。
                abort_handle.abort();
            }
            with_status(&status, |status| status.open = false);
        })
        .await;
}

async fn stop_handle(handle: &SerialHandle) {
    stop_handle_with_timeout(handle, COMMAND_TIMEOUT).await;
}

async fn close_connection(
    port_id: &str,
    expected_generation: Option<uuid::Uuid>,
    connections: &SerialConnections,
    app: Option<&AppHandle>,
) -> Result<bool, String> {
    let cancellation = {
        let mut slots = connections.lock().await;
        let cancellation = match expected_generation {
            Some(generation) => cancel_generation(&mut slots, port_id, generation),
            None => cancel_current(&mut slots, port_id),
        };
        if cancellation
            .as_ref()
            .is_some_and(|cancellation| cancellation.was_active)
        {
            // 在持锁状态下发布逻辑关闭，保证后续重连的 opened 事件不会先于它。
            let generation = cancellation.as_ref().unwrap().generation;
            emit_event(app, simple_event(port_id, generation, "closed", None));
        }
        cancellation
    };

    let Some(cancellation) = cancellation else {
        return Ok(false);
    };
    if let Some(handle) = cancellation.retiring.as_ref() {
        stop_handle(handle).await;
    }

    let mut slots = connections.lock().await;
    clear_inactive_generation(&mut slots, port_id, cancellation.generation);
    Ok(true)
}

async fn request_result_with_timeouts(
    command_tx: &mpsc::Sender<SerialCommand>,
    command: impl FnOnce(CommandControl, oneshot::Sender<Result<(), String>>) -> SerialCommand,
    enqueue_timeout: Duration,
    response_timeout: Duration,
) -> Result<(), String> {
    let control = CommandControl::new();
    let (response_tx, mut response_rx) = oneshot::channel();
    if let Err(error) = enqueue_with_timeout(
        command_tx,
        command(control.clone(), response_tx),
        enqueue_timeout,
    )
    .await
    {
        let _ = control.cancel();
        return Err(match error {
            EnqueueError::Timeout => "串口命令入队超时".to_string(),
            EnqueueError::Closed => "串口会话已关闭".to_string(),
        });
    }

    match tokio::time::timeout(response_timeout, &mut response_rx).await {
        Ok(result) => result.map_err(|_| "串口会话已关闭".to_string())?,
        Err(_) => match control.cancel() {
            CommandCancelOutcome::BeforeStart => Err("串口命令超时，已在执行前取消".to_string()),
            CommandCancelOutcome::InFlight => {
                Err("串口命令超时且已经开始执行，结果未知；连接正在关闭".to_string())
            }
            CommandCancelOutcome::Completed => response_rx
                .await
                .map_err(|_| "串口会话已关闭".to_string())?,
        },
    }
}

async fn request_result(
    command_tx: &mpsc::Sender<SerialCommand>,
    command: impl FnOnce(CommandControl, oneshot::Sender<Result<(), String>>) -> SerialCommand,
) -> Result<(), String> {
    request_result_with_timeouts(
        command_tx,
        command,
        COMMAND_TIMEOUT,
        COMMAND_TIMEOUT + Duration::from_secs(1),
    )
    .await
}

#[tauri::command]
pub async fn serial_list_ports() -> Result<Vec<SerialPortInfo>, String> {
    tokio::task::spawn_blocking(|| {
        tokio_serial::available_ports()
            .map_err(|error| format!("枚举串口失败: {error}"))
            .map(|ports| {
                ports
                    .into_iter()
                    .map(|port| {
                        let (description, manufacturer) = match port.port_type {
                            SerialPortType::UsbPort(info) => {
                                let description = info.product.or_else(|| {
                                    Some(format!("USB {:04X}:{:04X}", info.vid, info.pid))
                                });
                                (description, info.manufacturer)
                            }
                            SerialPortType::PciPort => (Some("PCI serial port".to_string()), None),
                            SerialPortType::BluetoothPort => {
                                (Some("Bluetooth serial port".to_string()), None)
                            }
                            SerialPortType::Unknown => (None, None),
                        };
                        SerialPortInfo {
                            port_name: port.port_name,
                            description,
                            manufacturer,
                        }
                    })
                    .collect()
            })
    })
    .await
    .map_err(|error| format!("枚举串口任务失败: {error}"))?
}

#[tauri::command]
pub async fn serial_open(
    port_id: String,
    port_name: String,
    config: SerialConfig,
    app: AppHandle,
    connections: State<'_, SerialConnections>,
) -> Result<SerialStatus, String> {
    if port_id.trim().is_empty() || port_id.len() > 256 {
        return Err("串口会话 ID 无效".to_string());
    }
    if port_name.trim().is_empty() || port_name.len() > 4096 {
        return Err("串口名称无效".to_string());
    }

    let builder = config.builder(&port_name)?;
    let connections = connections.inner().clone();
    let generation = uuid::Uuid::new_v4();
    let reservation = {
        let mut slots = connections.lock().await;
        let reservation = reserve_open(&mut slots, &port_id, generation);
        if let Some(replaced_generation) = reservation.replaced_generation {
            // 逻辑重连先关闭旧 generation；旧 worker 的后续事件会被 generation 校验抑制。
            emit_event(
                Some(&app),
                simple_event(&port_id, replaced_generation, "closed", None),
            );
        }
        reservation
    };
    if let Some(handle) = reservation.retiring.as_ref() {
        // 多个并发 open/close 会共享 SerialHandle 内的 OnceCell，只执行一次物理关闭。
        stop_handle(handle).await;
    }

    // 等待旧 worker 关闭期间，当前 open 可能已被 close 或更新的 open 取代。
    let still_pending = {
        let slots = connections.lock().await;
        is_pending_generation(&slots, &port_id, generation)
    };
    if !still_pending {
        return Err("串口打开请求已取消或被新的重连取代".to_string());
    }

    let stream = match builder.open_native_async() {
        Ok(stream) => stream,
        Err(error) => {
            let mut slots = connections.lock().await;
            let was_current = is_pending_generation(&slots, &port_id, generation);
            clear_inactive_generation(&mut slots, &port_id, generation);
            return if was_current {
                Err(format!("打开串口 '{port_name}' 失败: {error}"))
            } else {
                Err("串口打开请求已取消或被新的重连取代".to_string())
            };
        }
    };
    // 设备已成功打开后再次在同一临界区校验并安装。若 generation 已失效，
    // 直接在当前任务中 drop stream，避免旧设备句柄滞留到异步 worker 调度。
    let mut slots = connections.lock().await;
    if !is_pending_generation(&slots, &port_id, generation) {
        clear_inactive_generation(&mut slots, &port_id, generation);
        drop(slots);
        drop(stream);
        return Err("串口打开请求已取消或被新的重连取代".to_string());
    }

    let connected_since = now_iso();
    let status = Arc::new(RwLock::new(SerialStatus {
        open: true,
        generation: generation.to_string(),
        port_name: port_name.clone(),
        config: config.clone(),
        dtr: false,
        rts: false,
        signals: SerialSignals::default(),
        connected_since,
    }));
    let (command_tx, command_rx) = mpsc::channel(64);
    let (start_tx, start_rx) = oneshot::channel();
    let worker = tokio::spawn(run_serial_worker(
        port_id.clone(),
        stream,
        command_rx,
        status.clone(),
        Some(app.clone()),
        Some(connections.clone()),
        generation,
        Some(start_rx),
        COMMAND_TIMEOUT,
    ));
    let handle = SerialHandle {
        command_tx,
        status: status.clone(),
        abort_handle: worker.abort_handle(),
        shutdown: Arc::new(OnceCell::new()),
    };
    if install_if_pending(&mut slots, &port_id, generation, handle).is_err() {
        // 上面的校验与安装持有同一把锁，正常情况下不可达；保持安全降级。
        drop(slots);
        drop(start_tx);
        drop(worker);
        return Err("串口打开请求已取消或被新的重连取代".to_string());
    }
    // Publish opened while the connection lock is held, then release the worker
    // gate. Data and the immediately-ready first signal tick cannot overtake it.
    if emit_then_start_worker(start_tx, || {
        emit_event(
            Some(&app),
            simple_event(&port_id, generation, "opened", None),
        );
    })
    .is_err()
    {
        remove_open_generation(&mut slots, &port_id, generation);
        with_status(&status, |status| status.open = false);
        emit_event(
            Some(&app),
            simple_event(
                &port_id,
                generation,
                "error",
                Some("串口 worker 启动失败".to_string()),
            ),
        );
        drop(slots);
        drop(worker);
        return Err("串口 worker 启动失败".to_string());
    }

    let opened_status = read_status(&status);
    drop(slots);
    drop(worker);
    Ok(opened_status)
}

#[tauri::command]
pub async fn serial_close(
    port_id: String,
    app: AppHandle,
    connections: State<'_, SerialConnections>,
) -> Result<(), String> {
    close_connection(&port_id, None, connections.inner(), Some(&app))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn serial_close_generation(
    port_id: String,
    generation: String,
    app: AppHandle,
    connections: State<'_, SerialConnections>,
) -> Result<bool, String> {
    let generation = parse_generation(&generation)?;
    close_connection(&port_id, Some(generation), connections.inner(), Some(&app)).await
}

#[tauri::command]
pub async fn serial_send(
    port_id: String,
    generation: String,
    data: String,
    encoding: String,
    connections: State<'_, SerialConnections>,
) -> Result<(), String> {
    let generation = parse_generation(&generation)?;
    let bytes = decode_send_data(&data, &encoding)?;
    if bytes.len() > MAX_SEND_BYTES {
        return Err(format!(
            "串口发送数据超过上限（{} MiB）",
            MAX_SEND_BYTES / 1024 / 1024
        ));
    }
    let handle = {
        let slots = connections.lock().await;
        clone_open_handle_for_generation(&slots, &port_id, generation)?
    };
    request_result(&handle.command_tx, |control, response| {
        SerialCommand::Write {
            bytes,
            control,
            response,
        }
    })
    .await
}

#[tauri::command]
pub async fn serial_set_dtr(
    port_id: String,
    generation: String,
    value: bool,
    connections: State<'_, SerialConnections>,
) -> Result<(), String> {
    let generation = parse_generation(&generation)?;
    let handle = {
        let slots = connections.lock().await;
        clone_open_handle_for_generation(&slots, &port_id, generation)?
    };
    request_result(&handle.command_tx, |control, response| {
        SerialCommand::SetDtr {
            value,
            control,
            response,
        }
    })
    .await
}

#[tauri::command]
pub async fn serial_set_rts(
    port_id: String,
    generation: String,
    value: bool,
    connections: State<'_, SerialConnections>,
) -> Result<(), String> {
    let generation = parse_generation(&generation)?;
    let handle = {
        let slots = connections.lock().await;
        clone_open_handle_for_generation(&slots, &port_id, generation)?
    };
    request_result(&handle.command_tx, |control, response| {
        SerialCommand::SetRts {
            value,
            control,
            response,
        }
    })
    .await
}

#[tauri::command]
pub async fn serial_get_status(
    port_id: String,
    connections: State<'_, SerialConnections>,
) -> Result<Option<SerialStatus>, String> {
    // The status lock is synchronous and only protects a small in-memory
    // snapshot, so it can be read while the slot map lock still pins the
    // generation. No close/reconnect can replace the slot between the two.
    let slots = connections.lock().await;
    snapshot_open_status(&slots, &port_id)
}

fn snapshot_open_status(
    slots: &HashMap<String, SerialConnectionSlot>,
    port_id: &str,
) -> Result<Option<SerialStatus>, String> {
    match slots.get(port_id) {
        Some(ConnectionSlot::Open { generation, handle }) => {
            let status = read_status(&handle.status);
            if status.generation != generation.to_string() {
                return Err("串口状态 generation 不一致".to_string());
            }
            Ok(Some(status))
        }
        Some(ConnectionSlot::Pending { .. } | ConnectionSlot::Tombstone { .. }) | None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> SerialConfig {
        SerialConfig {
            baud_rate: 9_600,
            data_bits: 8,
            stop_bits: 1,
            parity: "none".to_string(),
            flow_control: "none".to_string(),
        }
    }

    fn test_status(generation: uuid::Uuid, port_name: &str) -> SerialStatus {
        SerialStatus {
            open: true,
            generation: generation.to_string(),
            port_name: port_name.to_string(),
            config: test_config(),
            dtr: false,
            rts: false,
            signals: SerialSignals::default(),
            connected_since: now_iso(),
        }
    }

    #[test]
    fn serial_config_rejects_invalid_values() {
        let mut config = test_config();
        config.data_bits = 9;
        assert!(config.builder("ignored").is_err());
        config = test_config();
        config.parity = "mark".to_string();
        assert!(config.builder("ignored").is_err());
    }

    #[test]
    fn non_ascii_hex_is_rejected_without_panicking() {
        assert!(decode_send_data("€0", "hex").is_err());
    }

    #[test]
    fn newer_open_generation_rejects_stale_install_and_worker_cleanup() {
        let mut connections: HashMap<String, ConnectionSlot<&'static str>> = HashMap::new();
        let old_generation = uuid::Uuid::new_v4();
        let new_generation = uuid::Uuid::new_v4();

        reserve_open(&mut connections, "port", old_generation);
        let reservation = reserve_open(&mut connections, "port", new_generation);
        assert!(reservation.replaced_generation.is_none());
        assert!(reservation.retiring.is_none());

        assert_eq!(
            install_if_pending(&mut connections, "port", old_generation, "stale-handle"),
            Err("stale-handle")
        );
        assert_eq!(
            install_if_pending(&mut connections, "port", new_generation, "new-handle"),
            Ok(())
        );
        assert!(!remove_open_generation(
            &mut connections,
            "port",
            old_generation
        ));
        assert!(matches!(
            connections.get("port"),
            Some(ConnectionSlot::Open {
                generation,
                handle: "new-handle"
            }) if *generation == new_generation
        ));
    }

    #[test]
    fn close_tombstone_cancels_pending_open_before_reconnect() {
        let mut connections: HashMap<String, ConnectionSlot<&'static str>> = HashMap::new();
        let cancelled_generation = uuid::Uuid::new_v4();
        let reconnect_generation = uuid::Uuid::new_v4();

        reserve_open(&mut connections, "port", cancelled_generation);
        let cancellation = cancel_current(&mut connections, "port").unwrap();
        assert!(cancellation.was_active);
        assert_eq!(cancellation.generation, cancelled_generation);
        assert!(matches!(
            connections.get("port"),
            Some(ConnectionSlot::Tombstone { generation, .. })
                if *generation == cancelled_generation
        ));

        let reservation = reserve_open(&mut connections, "port", reconnect_generation);
        assert!(reservation.retiring.is_none());
        assert_eq!(
            install_if_pending(
                &mut connections,
                "port",
                cancelled_generation,
                "cancelled-handle"
            ),
            Err("cancelled-handle")
        );
        assert_eq!(
            install_if_pending(
                &mut connections,
                "port",
                reconnect_generation,
                "reconnected-handle"
            ),
            Ok(())
        );
    }

    #[test]
    fn conditional_close_cannot_cancel_a_replacement_generation() {
        let mut connections: HashMap<String, ConnectionSlot<&'static str>> = HashMap::new();
        let old_generation = uuid::Uuid::new_v4();
        let replacement_generation = uuid::Uuid::new_v4();

        reserve_open(&mut connections, "port", replacement_generation);
        install_if_pending(
            &mut connections,
            "port",
            replacement_generation,
            "replacement-handle",
        )
        .unwrap();

        assert_eq!(
            clone_open_handle_for_generation(&connections, "port", old_generation),
            Err("串口会话已被替换".to_string())
        );
        assert_eq!(
            clone_open_handle_for_generation(&connections, "port", replacement_generation),
            Ok("replacement-handle")
        );
        assert!(cancel_generation(&mut connections, "port", old_generation).is_none());
        assert!(matches!(
            connections.get("port"),
            Some(ConnectionSlot::Open {
                generation,
                handle: "replacement-handle"
            }) if *generation == replacement_generation
        ));

        let cancellation =
            cancel_generation(&mut connections, "port", replacement_generation).unwrap();
        assert_eq!(cancellation.generation, replacement_generation);
        assert!(cancellation.was_active);
    }

    #[test]
    fn reconnect_carries_retiring_handle_without_allowing_old_worker_removal() {
        let mut connections: HashMap<String, ConnectionSlot<&'static str>> = HashMap::new();
        let old_generation = uuid::Uuid::new_v4();
        let new_generation = uuid::Uuid::new_v4();

        reserve_open(&mut connections, "port", old_generation);
        install_if_pending(&mut connections, "port", old_generation, "old-handle").unwrap();
        let reservation = reserve_open(&mut connections, "port", new_generation);
        assert_eq!(reservation.replaced_generation, Some(old_generation));
        assert_eq!(reservation.retiring, Some("old-handle"));
        install_if_pending(&mut connections, "port", new_generation, "new-handle").unwrap();

        assert!(!remove_open_generation(
            &mut connections,
            "port",
            old_generation
        ));
        assert!(matches!(
            connections.get("port"),
            Some(ConnectionSlot::Open {
                generation,
                handle: "new-handle"
            }) if *generation == new_generation
        ));
    }

    #[tokio::test]
    async fn request_enqueue_timeout_is_bounded_when_queue_is_full() {
        let (command_tx, _command_rx) = mpsc::channel(1);
        let (occupied_response, _occupied_rx) = oneshot::channel();
        command_tx
            .send(SerialCommand::Write {
                bytes: vec![1],
                control: CommandControl::new(),
                response: occupied_response,
            })
            .await
            .unwrap();

        let result = request_result_with_timeouts(
            &command_tx,
            |control, response| SerialCommand::Write {
                bytes: vec![2],
                control,
                response,
            },
            Duration::ZERO,
            Duration::from_secs(1),
        )
        .await;

        assert_eq!(result.unwrap_err(), "串口命令入队超时");
    }

    #[test]
    fn opened_is_published_before_worker_gate_is_released() {
        let (start_tx, mut start_rx) = oneshot::channel();
        let mut emitted = false;

        emit_then_start_worker(start_tx, || {
            assert!(matches!(
                start_rx.try_recv(),
                Err(oneshot::error::TryRecvError::Empty)
            ));
            emitted = true;
        })
        .unwrap();

        assert!(emitted);
        assert_eq!(start_rx.try_recv(), Ok(()));
    }

    #[tokio::test]
    async fn response_timeout_cancels_queued_command_before_start() {
        let (command_tx, mut command_rx) = mpsc::channel(1);
        let result = request_result_with_timeouts(
            &command_tx,
            |control, response| SerialCommand::Write {
                bytes: vec![1],
                control,
                response,
            },
            Duration::from_secs(1),
            Duration::ZERO,
        )
        .await;

        assert_eq!(result.unwrap_err(), "串口命令超时，已在执行前取消");
        let command = command_rx.recv().await.unwrap();
        let SerialCommand::Write { control, .. } = command else {
            panic!("expected write command");
        };
        assert!(control.is_cancelled());
        assert!(
            !control.begin(),
            "cancelled queued command must never start"
        );
    }

    #[test]
    fn in_flight_timeout_wins_against_late_completion() {
        let control = CommandControl::new();
        assert!(control.begin());
        assert_eq!(control.cancel(), CommandCancelOutcome::InFlight);
        assert!(control.is_cancelled());
        assert!(
            !control.complete(),
            "late completion must observe cancellation"
        );
    }

    #[tokio::test]
    async fn close_enqueue_timeout_aborts_worker_without_hanging() {
        let (command_tx, _command_rx) = mpsc::channel(1);
        let (occupied_response, _occupied_rx) = oneshot::channel();
        command_tx
            .send(SerialCommand::Close {
                response: occupied_response,
            })
            .await
            .unwrap();
        let status = Arc::new(RwLock::new(test_status(uuid::Uuid::new_v4(), "test")));
        let worker = tokio::spawn(std::future::pending::<()>());
        let handle = SerialHandle {
            command_tx,
            status: status.clone(),
            abort_handle: worker.abort_handle(),
            shutdown: Arc::new(OnceCell::new()),
        };

        stop_handle_with_timeout(&handle, Duration::ZERO).await;

        assert!(!read_status(&status).open);
        assert!(worker.await.unwrap_err().is_cancelled());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn serial_worker_writes_and_closes_without_hanging() {
        let (mut peer, stream) = tokio_serial::SerialStream::pair().unwrap();
        let generation = uuid::Uuid::new_v4();
        let status = Arc::new(RwLock::new(test_status(generation, "pty")));
        let (command_tx, command_rx) = mpsc::channel(4);
        let worker = tokio::spawn(run_serial_worker(
            "test".to_string(),
            stream,
            command_rx,
            status.clone(),
            None,
            None,
            generation,
            None,
            Duration::from_secs(1),
        ));

        let (response_tx, response_rx) = oneshot::channel();
        command_tx
            .send(SerialCommand::Write {
                bytes: b"hello".to_vec(),
                control: CommandControl::new(),
                response: response_tx,
            })
            .await
            .unwrap();
        response_rx.await.unwrap().unwrap();
        let mut received = [0u8; 5];
        tokio::time::timeout(Duration::from_secs(1), peer.read_exact(&mut received))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&received, b"hello");

        let (close_tx, close_rx) = oneshot::channel();
        command_tx
            .send(SerialCommand::Close { response: close_tx })
            .await
            .unwrap();
        close_rx.await.unwrap();
        worker.await.unwrap();
        assert!(!read_status(&status).open);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn started_write_timeout_closes_session_instead_of_allowing_retry() {
        let (_peer, stream) = tokio_serial::SerialStream::pair().unwrap();
        let generation = uuid::Uuid::new_v4();
        let status = Arc::new(RwLock::new(test_status(generation, "pty-timeout")));
        let (command_tx, command_rx) = mpsc::channel(4);
        let worker = tokio::spawn(run_serial_worker(
            "timeout-test".to_string(),
            stream,
            command_rx,
            status.clone(),
            None,
            None,
            generation,
            None,
            Duration::ZERO,
        ));

        let result = request_result_with_timeouts(
            &command_tx,
            |control, response| SerialCommand::Write {
                // Larger than a PTY buffer, so the zero deadline cannot finish
                // the complete write synchronously.
                bytes: vec![0; 1024 * 1024],
                control,
                response,
            },
            Duration::from_secs(1),
            Duration::from_secs(1),
        )
        .await;

        assert!(result.unwrap_err().contains("连接已关闭"));
        tokio::time::timeout(Duration::from_secs(1), worker)
            .await
            .expect("worker must terminate after an unknown write result")
            .unwrap();
        assert!(!read_status(&status).open);
    }

    #[tokio::test]
    async fn status_snapshot_rejects_a_mismatched_generation() {
        let slot_generation = uuid::Uuid::new_v4();
        let stale_generation = uuid::Uuid::new_v4();
        let (command_tx, _command_rx) = mpsc::channel(1);
        let worker = tokio::spawn(std::future::pending::<()>());
        let handle = SerialHandle {
            command_tx,
            status: Arc::new(RwLock::new(test_status(stale_generation, "stale"))),
            abort_handle: worker.abort_handle(),
            shutdown: Arc::new(OnceCell::new()),
        };
        let mut slots = HashMap::new();
        slots.insert(
            "port".to_string(),
            ConnectionSlot::Open {
                generation: slot_generation,
                handle,
            },
        );

        assert_eq!(
            snapshot_open_status(&slots, "port").unwrap_err(),
            "串口状态 generation 不一致"
        );
        worker.abort();
    }
}
