// ProtoForge MQTT 客户端
// 基于 rumqttc 实现 MQTT v3.1.1 连接、订阅、发布

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub struct MqttConnection {
    client: rumqttc::AsyncClient,
    cancel_tx: tokio::sync::oneshot::Sender<()>,
}

pub type MqttConnections = Arc<Mutex<HashMap<String, MqttConnection>>>;

pub fn new_connections() -> MqttConnections {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectRequest {
    pub broker_url: String,   // e.g. "mqtt://broker.example.com:1883"
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
    pub direction: String,  // "in" | "out"
}

/// 连接 MQTT Broker
pub async fn connect(
    conn_id: String,
    req: MqttConnectRequest,
    connections: MqttConnections,
    app_handle: AppHandle,
) -> Result<(), String> {
    {
        let conns = connections.lock().await;
        if conns.contains_key(&conn_id) {
            return Err("该连接已存在".to_string());
        }
    }

    // 解析 URL
    let url = url::Url::parse(&req.broker_url)
        .map_err(|e| format!("Broker URL 解析失败: {}", e))?;
    let host = url.host_str().unwrap_or("localhost").to_string();
    let port = url.port().unwrap_or(1883);

    let mut mqttoptions = rumqttc::MqttOptions::new(&req.client_id, &host, port);
    mqttoptions.set_keep_alive(std::time::Duration::from_secs(req.keep_alive_secs.max(5)));
    mqttoptions.set_clean_session(req.clean_session);

    if let (Some(user), Some(pass)) = (&req.username, &req.password) {
        mqttoptions.set_credentials(user, pass);
    }

    let (client, mut eventloop) = rumqttc::AsyncClient::new(mqttoptions, 64);

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    // 保存连接
    {
        let mut conns = connections.lock().await;
        conns.insert(conn_id.clone(), MqttConnection { client, cancel_tx });
    }

    let connections_clone = connections.clone();
    let conn_id_clone = conn_id.clone();

    // 后台事件循环
    tokio::spawn(async move {
        let emit_msg = |msg: MqttMessage| {
            let _ = app_handle.emit(&format!("mqtt-message-{}", conn_id_clone), &msg);
        };
        let emit_status = |status: &str| {
            let _ = app_handle.emit(&format!("mqtt-status-{}", conn_id_clone), status);
        };

        emit_status("connecting");
        let mut cancel_rx = cancel_rx;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    emit_status("disconnected");
                    break;
                }
                event = eventloop.poll() => {
                    match event {
                        Ok(notification) => {
                            match notification {
                                rumqttc::Event::Incoming(rumqttc::Incoming::ConnAck(_)) => {
                                    emit_status("connected");
                                }
                                rumqttc::Event::Incoming(rumqttc::Incoming::Publish(publish)) => {
                                    let msg = MqttMessage {
                                        topic: publish.topic.clone(),
                                        payload: String::from_utf8_lossy(&publish.payload).to_string(),
                                        qos: publish.qos as u8,
                                        retain: publish.retain,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                        direction: "in".to_string(),
                                    };
                                    emit_msg(msg);
                                }
                                rumqttc::Event::Incoming(rumqttc::Incoming::Disconnect) => {
                                    emit_status("disconnected");
                                    break;
                                }
                                _ => {}
                            }
                        }
                        Err(e) => {
                            emit_status(&format!("error:{}", e));
                            break;
                        }
                    }
                }
            }
        }

        // 清理
        let mut conns = connections_clone.lock().await;
        conns.remove(&conn_id_clone);
    });

    Ok(())
}

/// 订阅 topic
pub async fn subscribe(
    conn_id: &str,
    topic: &str,
    qos: u8,
    connections: MqttConnections,
) -> Result<(), String> {
    let conns = connections.lock().await;
    let conn = conns.get(conn_id).ok_or("连接不存在")?;
    let mqttqos = match qos {
        0 => rumqttc::QoS::AtMostOnce,
        1 => rumqttc::QoS::AtLeastOnce,
        _ => rumqttc::QoS::ExactlyOnce,
    };
    conn.client.subscribe(topic, mqttqos).await
        .map_err(|e| format!("订阅失败: {}", e))
}

/// 取消订阅
pub async fn unsubscribe(
    conn_id: &str,
    topic: &str,
    connections: MqttConnections,
) -> Result<(), String> {
    let conns = connections.lock().await;
    let conn = conns.get(conn_id).ok_or("连接不存在")?;
    conn.client.unsubscribe(topic).await
        .map_err(|e| format!("取消订阅失败: {}", e))
}

/// 发布消息
pub async fn publish(
    conn_id: &str,
    topic: &str,
    payload: &str,
    qos: u8,
    retain: bool,
    connections: MqttConnections,
) -> Result<(), String> {
    let conns = connections.lock().await;
    let conn = conns.get(conn_id).ok_or("连接不存在")?;
    let mqttqos = match qos {
        0 => rumqttc::QoS::AtMostOnce,
        1 => rumqttc::QoS::AtLeastOnce,
        _ => rumqttc::QoS::ExactlyOnce,
    };
    conn.client.publish(topic, mqttqos, retain, payload.as_bytes()).await
        .map_err(|e| format!("发布失败: {}", e))
}

/// 断开连接
pub async fn disconnect(conn_id: &str, connections: MqttConnections) -> Result<(), String> {
    let mut conns = connections.lock().await;
    if let Some(conn) = conns.remove(conn_id) {
        // 先通知后台任务退出，再执行协议层断开（避免 broker 不响应导致阻塞）
        let _ = conn.cancel_tx.send(());
        let _ = conn.client.disconnect().await;
        Ok(())
    } else {
        Err("连接不存在".to_string())
    }
}
