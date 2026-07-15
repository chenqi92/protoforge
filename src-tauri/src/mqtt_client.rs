// ProtoForge MQTT 客户端
// 基于 rumqttc 实现 MQTT v3.1.1，并用代际 CAS 管理连接生命周期。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;

const MQTT_QUEUE_CAPACITY: usize = 64;
const MAX_MQTT_PACKET_SIZE: usize = 8 * 1024 * 1024;
const MQTT_DISCONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const MQTT_STOP_TIMEOUT: Duration = Duration::from_secs(5);

fn parse_qos(qos: u8) -> Result<rumqttc::QoS, String> {
    match qos {
        0 => Ok(rumqttc::QoS::AtMostOnce),
        1 => Ok(rumqttc::QoS::AtLeastOnce),
        2 => Ok(rumqttc::QoS::ExactlyOnce),
        _ => Err(format!(
            "无效的 QoS 等级: {}，仅支持 0 (AtMostOnce) / 1 (AtLeastOnce) / 2 (ExactlyOnce)",
            qos
        )),
    }
}

fn ensure_publish_size(topic_len: usize, payload_len: usize) -> Result<(), String> {
    if topic_len > u16::MAX as usize {
        return Err("MQTT Topic 超过 65535 字节限制".into());
    }
    let encoded_size = topic_len
        .checked_add(payload_len)
        .and_then(|size| size.checked_add(16))
        .ok_or_else(|| "MQTT 消息大小溢出".to_string())?;
    if encoded_size > MAX_MQTT_PACKET_SIZE {
        Err(format!(
            "MQTT 消息超过 {}MB 限制",
            MAX_MQTT_PACKET_SIZE / 1024 / 1024
        ))
    } else {
        Ok(())
    }
}

struct MqttSlot {
    generation: u64,
    /// `None` 表示 Starting 占位。
    client: Option<rumqttc::AsyncClient>,
    stopping: bool,
    cancel: CancellationToken,
    finished: CancellationToken,
}

struct MqttRegistry {
    entries: Mutex<HashMap<String, MqttSlot>>,
    next_generation: AtomicU64,
}

#[derive(Clone)]
pub struct MqttConnections {
    registry: Arc<MqttRegistry>,
}

pub fn new_connections() -> MqttConnections {
    MqttConnections {
        registry: Arc::new(MqttRegistry {
            entries: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(0),
        }),
    }
}

impl MqttConnections {
    async fn reserve(
        &self,
        connection_id: &str,
    ) -> Result<(u64, CancellationToken, CancellationToken), String> {
        let mut entries = self.registry.entries.lock().await;
        if entries.contains_key(connection_id) {
            return Err("该连接已存在".into());
        }
        let generation = self
            .registry
            .next_generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let cancel = CancellationToken::new();
        let finished = CancellationToken::new();
        entries.insert(
            connection_id.to_string(),
            MqttSlot {
                generation,
                client: None,
                stopping: false,
                cancel: cancel.clone(),
                finished: finished.clone(),
            },
        );
        Ok((generation, cancel, finished))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectRequest {
    pub broker_url: String,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub clean_session: bool,
    pub keep_alive_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttMessage {
    pub topic: String,
    pub payload: String,
    pub qos: u8,
    pub retain: bool,
    pub timestamp: String,
    pub direction: String,
}

struct FinishedGuard(CancellationToken);

impl Drop for FinishedGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

#[cfg(test)]
async fn mqtt_is_current(
    connections: &MqttConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    connections
        .registry
        .entries
        .lock()
        .await
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
}

async fn remove_mqtt_if_current(
    connections: &MqttConnections,
    connection_id: &str,
    generation: u64,
) -> bool {
    let mut entries = connections.registry.entries.lock().await;
    if entries
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation)
    {
        entries.remove(connection_id);
        true
    } else {
        false
    }
}

async fn client_for(
    connections: &MqttConnections,
    connection_id: &str,
) -> Result<rumqttc::AsyncClient, String> {
    connections
        .registry
        .entries
        .lock()
        .await
        .get(connection_id)
        .and_then(|slot| (!slot.stopping).then(|| slot.client.clone()).flatten())
        .ok_or_else(|| "连接不存在或仍在建立".to_string())
}

async fn emit_status_if_current(
    app: &AppHandle,
    connections: &MqttConnections,
    connection_id: &str,
    generation: u64,
    status: &str,
) -> bool {
    let entries = connections.registry.entries.lock().await;
    if entries.get(connection_id).is_some_and(|slot| {
        slot.generation == generation && (!slot.stopping || status == "disconnected")
    }) {
        let _ = app.emit(&format!("mqtt-status-{}", connection_id), status);
        true
    } else {
        false
    }
}

async fn emit_message_if_current(
    app: &AppHandle,
    connections: &MqttConnections,
    connection_id: &str,
    generation: u64,
    message: &MqttMessage,
) -> bool {
    let entries = connections.registry.entries.lock().await;
    if entries
        .get(connection_id)
        .is_some_and(|slot| slot.generation == generation && !slot.stopping)
    {
        let _ = app.emit(&format!("mqtt-message-{}", connection_id), message);
        true
    } else {
        false
    }
}

/// 连接 MQTT Broker。
pub async fn connect(
    conn_id: String,
    req: MqttConnectRequest,
    connections: MqttConnections,
    app_handle: AppHandle,
) -> Result<(), String> {
    let url = url::Url::parse(&req.broker_url)
        .map_err(|error| format!("Broker URL 解析失败: {}", error))?;
    let host = url.host_str().unwrap_or("localhost").to_string();
    let port = url.port().unwrap_or(1883);
    let (generation, cancel, finished) = connections.reserve(&conn_id).await?;
    let finished_guard = FinishedGuard(finished);

    let mut options = rumqttc::MqttOptions::new(&req.client_id, &host, port);
    options.set_keep_alive(Duration::from_secs(req.keep_alive_secs.max(5)));
    options.set_clean_session(req.clean_session);
    options.set_max_packet_size(MAX_MQTT_PACKET_SIZE, MAX_MQTT_PACKET_SIZE);
    if let (Some(username), Some(password)) = (&req.username, &req.password) {
        options.set_credentials(username, password);
    }
    let (client, mut event_loop) = rumqttc::AsyncClient::new(options, MQTT_QUEUE_CAPACITY);

    let (start_tx, start_rx) = oneshot::channel();
    let task_finished = CancellationToken::new();
    let guardian_cancel = cancel.clone();
    let guardian_task_finished = task_finished.clone();
    tokio::spawn(async move {
        let _finished_guard = finished_guard;
        let started = tokio::select! {
            biased;
            _ = guardian_cancel.cancelled() => false,
            result = start_rx => result.is_ok(),
        };
        if started {
            guardian_task_finished.cancelled().await;
        }
    });

    {
        let mut entries = connections.registry.entries.lock().await;
        let Some(slot) = entries.get_mut(&conn_id) else {
            return Err("MQTT 连接已取消".into());
        };
        if slot.generation != generation || slot.stopping || cancel.is_cancelled() {
            return Err("MQTT 连接已取消".into());
        }
        slot.client = Some(client);
        if start_tx.send(()).is_err() {
            entries.remove(&conn_id);
            return Err("MQTT 连接任务启动失败".into());
        }
    }

    tokio::spawn(async move {
        let _task_finished_guard = FinishedGuard(task_finished);
        emit_status_if_current(
            &app_handle,
            &connections,
            &conn_id,
            generation,
            "connecting",
        )
        .await;
        let terminal_status = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break "disconnected".to_string(),
                event = event_loop.poll() => match event {
                    Ok(rumqttc::Event::Incoming(rumqttc::Incoming::ConnAck(_))) => {
                        emit_status_if_current(
                            &app_handle,
                            &connections,
                            &conn_id,
                            generation,
                            "connected",
                        ).await;
                    }
                    Ok(rumqttc::Event::Incoming(rumqttc::Incoming::Publish(publish))) => {
                        let message = MqttMessage {
                            topic: publish.topic,
                            payload: String::from_utf8_lossy(&publish.payload).into_owned(),
                            qos: publish.qos as u8,
                            retain: publish.retain,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            direction: "in".into(),
                        };
                        emit_message_if_current(
                            &app_handle,
                            &connections,
                            &conn_id,
                            generation,
                            &message,
                        ).await;
                    }
                    Ok(rumqttc::Event::Incoming(rumqttc::Incoming::Disconnect)) => {
                        break "disconnected".to_string();
                    }
                    Ok(_) => {}
                    Err(error) => break format!("error:{}", error),
                }
            }
        };

        emit_status_if_current(
            &app_handle,
            &connections,
            &conn_id,
            generation,
            &terminal_status,
        )
        .await;
        remove_mqtt_if_current(&connections, &conn_id, generation).await;
    });
    Ok(())
}

pub async fn subscribe(
    conn_id: &str,
    topic: &str,
    qos: u8,
    connections: MqttConnections,
) -> Result<(), String> {
    let qos = parse_qos(qos)?;
    let client = client_for(&connections, conn_id).await?;
    client
        .subscribe(topic, qos)
        .await
        .map_err(|error| format!("订阅失败: {}", error))
}

pub async fn unsubscribe(
    conn_id: &str,
    topic: &str,
    connections: MqttConnections,
) -> Result<(), String> {
    let client = client_for(&connections, conn_id).await?;
    client
        .unsubscribe(topic)
        .await
        .map_err(|error| format!("取消订阅失败: {}", error))
}

pub async fn publish(
    conn_id: &str,
    topic: &str,
    payload: &str,
    qos: u8,
    retain: bool,
    connections: MqttConnections,
) -> Result<(), String> {
    ensure_publish_size(topic.len(), payload.len())?;
    let qos = parse_qos(qos)?;
    let client = client_for(&connections, conn_id).await?;
    client
        .publish(topic, qos, retain, payload.as_bytes())
        .await
        .map_err(|error| format!("发布失败: {}", error))
}

pub async fn disconnect(conn_id: &str, connections: MqttConnections) -> Result<(), String> {
    let (generation, client, cancel, finished) = {
        let mut entries = connections.registry.entries.lock().await;
        let slot = entries
            .get_mut(conn_id)
            .ok_or_else(|| "连接不存在".to_string())?;
        if slot.stopping {
            return Err("连接正在断开".into());
        }
        slot.stopping = true;
        (
            slot.generation,
            slot.client.clone(),
            slot.cancel.clone(),
            slot.finished.clone(),
        )
    };

    if let Some(client) = client {
        let _ = tokio::time::timeout(MQTT_DISCONNECT_TIMEOUT, client.disconnect()).await;
    }
    cancel.cancel();
    let _ = tokio::time::timeout(MQTT_STOP_TIMEOUT, finished.cancelled()).await;
    remove_mqtt_if_current(&connections, conn_id, generation).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qos_is_strictly_validated() {
        assert!(parse_qos(0).is_ok());
        assert!(parse_qos(2).is_ok());
        assert!(parse_qos(3).is_err());
    }

    #[tokio::test]
    async fn concurrent_same_id_reservation_is_atomic() {
        let connections = new_connections();
        let first = connections.reserve("same-id").await.unwrap();
        assert!(connections.reserve("same-id").await.is_err());
        drop(first);
    }

    #[tokio::test]
    async fn stale_cleanup_does_not_remove_new_generation() {
        let connections = new_connections();
        let (first, _, _) = connections.reserve("same-id").await.unwrap();
        assert!(remove_mqtt_if_current(&connections, "same-id", first).await);
        let (second, _, _) = connections.reserve("same-id").await.unwrap();
        assert!(!remove_mqtt_if_current(&connections, "same-id", first).await);
        assert!(mqtt_is_current(&connections, "same-id", second).await);
    }

    #[tokio::test]
    async fn disconnect_cancels_and_waits_for_starting_worker() {
        let connections = new_connections();
        let (generation, cancel, finished) = connections.reserve("pending").await.unwrap();
        let worker_connections = connections.clone();
        let worker_cancel = cancel.clone();
        let worker_finished = finished.clone();
        tokio::spawn(async move {
            worker_cancel.cancelled().await;
            remove_mqtt_if_current(&worker_connections, "pending", generation).await;
            worker_finished.cancel();
        });

        disconnect("pending", connections.clone()).await.unwrap();
        assert!(cancel.is_cancelled());
        assert!(finished.is_cancelled());
        assert!(connections.registry.entries.lock().await.is_empty());
    }

    #[test]
    fn mqtt_payload_limit_is_bounded() {
        assert!(ensure_publish_size(1, MAX_MQTT_PACKET_SIZE - 17).is_ok());
        assert!(ensure_publish_size(1, MAX_MQTT_PACKET_SIZE - 16).is_err());
        assert!(ensure_publish_size(u16::MAX as usize + 1, 0).is_err());
    }
}
