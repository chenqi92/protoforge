//! ONVIF 设备管理协议实现
//! 支持 WS-Discovery 设备发现、设备信息获取、媒体 Profile 管理、PTZ 控制、预置位管理
//! 使用手写 SOAP over HTTP，展示原始报文用于协议调试

use sha1::{Sha1, Digest};
use tauri::{AppHandle, Emitter};

use super::state::{OnvifSession, ProtocolMessage};

// ── WS-Security UsernameToken 认证 ──

fn build_wsse_header(username: &str, password: &str) -> String {
    let nonce_bytes: [u8; 16] = rand_nonce();
    let nonce_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, nonce_bytes);
    let created = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // PasswordDigest = Base64(SHA1(nonce + created + password))
    let mut hasher = Sha1::new();
    hasher.update(&nonce_bytes);
    hasher.update(created.as_bytes());
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    let digest_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, digest);

    format!(
        r#"<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <UsernameToken>
        <Username>{}</Username>
        <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{}</Password>
        <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{}</Nonce>
        <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{}</Created>
      </UsernameToken>
    </Security>"#,
        username, digest_b64, nonce_b64, created
    )
}

fn rand_nonce() -> [u8; 16] {
    let mut buf = [0u8; 16];
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let seed = ts.as_nanos();
    for (i, b) in buf.iter_mut().enumerate() {
        *b = ((seed >> (i * 4)) & 0xFF) as u8;
    }
    buf
}

// ── 通用 SOAP 请求 ──

fn build_soap_envelope(header_content: &str, body_content: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Header>{}</s:Header>
  <s:Body>{}</s:Body>
</s:Envelope>"#,
        header_content, body_content
    )
}

async fn soap_request(
    url: &str,
    action: &str,
    body: &str,
    _session_id: &str,
    auth: Option<(&str, &str)>,
    app: &AppHandle,
) -> Result<String, String> {
    let header = if let Some((user, pass)) = auth {
        build_wsse_header(user, pass)
    } else {
        String::new()
    };
    let envelope = build_soap_envelope(&header, body);

    // Emit sent message
    let sent_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: "onvif".to_string(),
        summary: format!("SOAP POST {} → {}", action, url),
        detail: envelope.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(envelope.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &sent_msg);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .post(url)
        .header("Content-Type", "application/soap+xml; charset=utf-8")
        .header("SOAPAction", action)
        .body(envelope)
        .send()
        .await
        .map_err(|e| format!("SOAP request failed: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(|e| format!("Read response error: {}", e))?;

    // Emit received message
    let recv_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "received".to_string(),
        protocol: "onvif".to_string(),
        summary: format!("HTTP {} — {} response ({} bytes)", status.as_u16(), action, body_text.len()),
        detail: body_text.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(body_text.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &recv_msg);

    if !status.is_success() {
        return Err(format!("SOAP error HTTP {}: {}", status, extract_soap_fault(&body_text)));
    }

    Ok(body_text)
}

fn extract_soap_fault(xml: &str) -> String {
    // Simple extraction of fault string
    if let Some(start) = xml.find("<faultstring>") {
        if let Some(end) = xml[start..].find("</faultstring>") {
            return xml[start + 13..start + end].to_string();
        }
    }
    if let Some(start) = xml.find("<SOAP-ENV:Reason>") {
        if let Some(end) = xml[start..].find("</SOAP-ENV:Reason>") {
            return xml[start + 17..start + end].to_string();
        }
    }
    "Unknown SOAP fault".to_string()
}

// ── XML 简易提取工具 ──

fn extract_tag_content(xml: &str, tag: &str) -> Option<String> {
    // Try with namespace prefix patterns: <ns:Tag>, <tds:Tag>, etc.
    // Also try plain <Tag>
    for prefix in &["", "tds:", "trt:", "tt:", "tptz:", "d:", "wsdd:", "wsa:"] {
        let open = format!("<{}{}", prefix, tag);
        if let Some(start_pos) = xml.find(&open) {
            let rest = &xml[start_pos..];
            // Find the > that closes the opening tag
            if let Some(gt) = rest.find('>') {
                // Check for self-closing tag
                if rest.as_bytes().get(gt - 1) == Some(&b'/') {
                    return Some(String::new());
                }
                let content_start = gt + 1;
                let close_tag = format!("</{}{}>", prefix, tag);
                if let Some(close_pos) = rest.find(&close_tag) {
                    return Some(rest[content_start..close_pos].to_string());
                }
            }
        }
    }
    None
}

fn extract_all_tags<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let mut results = Vec::new();
    let mut search = xml;
    loop {
        // Try with various namespace prefixes
        let mut found = None;
        for prefix in &["", "tds:", "trt:", "tt:", "tptz:", "d:", "wsdd:", "wsa:"] {
            let open = format!("<{}{}", prefix, tag);
            let close = format!("</{}{}>", prefix, tag);
            if let Some(start) = search.find(&open) {
                if let Some(end) = search[start..].find(&close) {
                    let full_end = start + end + close.len();
                    found = Some((start, full_end, &search[start..full_end]));
                    break;
                }
            }
        }
        if let Some((_start, end, content)) = found {
            results.push(content);
            search = &search[end..];
        } else {
            break;
        }
    }
    results
}

// ── WS-Discovery 设备发现 ──

pub async fn discover(app: &AppHandle) -> Result<Vec<serde_json::Value>, String> {
    use tokio::net::UdpSocket;

    let probe_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>uuid:{}</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>"#,
        uuid::Uuid::new_v4()
    );

    // Emit sent message
    let sent_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: "onvif".to_string(),
        summary: "WS-Discovery Probe → 239.255.255.250:3702".to_string(),
        detail: probe_xml.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(probe_xml.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &sent_msg);

    let socket = UdpSocket::bind("0.0.0.0:0").await
        .map_err(|e| format!("Bind UDP socket failed: {}", e))?;

    // Allow broadcast/multicast
    socket.set_broadcast(true).map_err(|e| format!("Set broadcast failed: {}", e))?;

    let multicast_addr: std::net::SocketAddr = "239.255.255.250:3702".parse().unwrap();
    socket.send_to(probe_xml.as_bytes(), multicast_addr).await
        .map_err(|e| format!("Send probe failed: {}", e))?;

    let mut devices = Vec::new();
    let mut buf = vec![0u8; 65535];

    // Wait for responses with timeout
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match tokio::time::timeout_at(deadline, socket.recv_from(&mut buf)).await {
            Ok(Ok((n, addr))) => {
                let response = String::from_utf8_lossy(&buf[..n]).to_string();

                // Emit received
                let recv_msg = ProtocolMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    direction: "received".to_string(),
                    protocol: "onvif".to_string(),
                    summary: format!("WS-Discovery ProbeMatch from {}", addr),
                    detail: response.clone(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    size: Some(n as u32),
                };
                let _ = app.emit("videostream-protocol-msg", &recv_msg);

                // Parse XAddrs from response
                if let Some(xaddrs) = extract_tag_content(&response, "XAddrs") {
                    for xaddr in xaddrs.split_whitespace() {
                        if let Ok(url) = url::Url::parse(xaddr) {
                            let host = url.host_str().unwrap_or("").to_string();
                            let port = url.port().unwrap_or(80);
                            let name = extract_tag_content(&response, "Scopes")
                                .and_then(|s| {
                                    s.split_whitespace()
                                        .find(|scope| scope.contains("onvif://www.onvif.org/name/"))
                                        .map(|scope| scope.replace("onvif://www.onvif.org/name/", ""))
                                });
                            devices.push(serde_json::json!({
                                "host": host,
                                "port": port,
                                "name": name,
                                "xaddr": xaddr,
                            }));
                        }
                    }
                }
            }
            Ok(Err(e)) => {
                log::warn!("WS-Discovery recv error: {}", e);
                break;
            }
            Err(_) => break, // timeout
        }
    }

    // Emit info summary
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "onvif".to_string(),
        summary: format!("WS-Discovery: found {} device(s)", devices.len()),
        detail: serde_json::to_string_pretty(&devices).unwrap_or_default(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(devices)
}

// ── 设备信息 ──

pub async fn get_device_info(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    app: &AppHandle,
) -> Result<(serde_json::Value, OnvifSession), String> {
    let device_url = format!("http://{}:{}/onvif/device_service", host, port);

    let body = "<tds:GetDeviceInformation/>";
    let response = soap_request(
        &device_url,
        "http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation",
        body,
        session_id,
        Some((username, password)),
        app,
    ).await?;

    let manufacturer = extract_tag_content(&response, "Manufacturer").unwrap_or_else(|| "Unknown".to_string());
    let model = extract_tag_content(&response, "Model").unwrap_or_else(|| "Unknown".to_string());
    let firmware = extract_tag_content(&response, "FirmwareVersion").unwrap_or_else(|| "Unknown".to_string());
    let serial = extract_tag_content(&response, "SerialNumber").unwrap_or_else(|| "Unknown".to_string());
    let hardware = extract_tag_content(&response, "HardwareId").unwrap_or_else(|| "Unknown".to_string());

    // Also get service URLs via GetCapabilities
    let cap_body = r#"<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>"#;
    let cap_response = soap_request(
        &device_url,
        "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
        cap_body,
        session_id,
        Some((username, password)),
        app,
    ).await.unwrap_or_default();

    let media_url = extract_tag_content(&cap_response, "Media")
        .and_then(|m| extract_tag_content(&m, "XAddr"))
        .unwrap_or_else(|| format!("http://{}:{}/onvif/media_service", host, port));

    let ptz_url = extract_tag_content(&cap_response, "PTZ")
        .and_then(|m| extract_tag_content(&m, "XAddr"))
        .unwrap_or_else(|| format!("http://{}:{}/onvif/ptz_service", host, port));

    let session = OnvifSession {
        host: host.to_string(),
        port,
        username: username.to_string(),
        password: password.to_string(),
        device_service_url: device_url,
        media_service_url: media_url,
        ptz_service_url: ptz_url,
    };

    let info = serde_json::json!({
        "manufacturer": manufacturer,
        "model": model,
        "firmwareVersion": firmware,
        "serialNumber": serial,
        "hardwareId": hardware,
    });

    Ok((info, session))
}

// ── 获取媒体 Profiles ──

pub async fn get_profiles(
    session: &OnvifSession,
    session_id: &str,
    app: &AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let body = "<trt:GetProfiles/>";
    let response = soap_request(
        &session.media_service_url,
        "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
        body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    let mut profiles = Vec::new();
    let profile_blocks = extract_all_tags(&response, "Profiles");

    for block in profile_blocks {
        let token = extract_attr(block, "token").unwrap_or_default();
        let name = extract_tag_content(block, "Name").unwrap_or_else(|| token.clone());

        let video_encoding = extract_tag_content(block, "Encoding").unwrap_or_else(|| "H264".to_string());

        let width = extract_tag_content(block, "Width")
            .and_then(|w| w.parse::<u32>().ok())
            .unwrap_or(0);
        let height = extract_tag_content(block, "Height")
            .and_then(|h| h.parse::<u32>().ok())
            .unwrap_or(0);
        let resolution = if width > 0 && height > 0 {
            format!("{}x{}", width, height)
        } else {
            "Unknown".to_string()
        };

        let fps = extract_tag_content(block, "FrameRateLimit")
            .and_then(|f| f.parse::<f64>().ok())
            .unwrap_or(25.0);

        profiles.push(serde_json::json!({
            "token": token,
            "name": name,
            "videoEncoding": video_encoding,
            "resolution": resolution,
            "fps": fps,
            "streamUri": "",
        }));
    }

    // Emit info
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "onvif".to_string(),
        summary: format!("Found {} media profile(s)", profiles.len()),
        detail: serde_json::to_string_pretty(&profiles).unwrap_or_default(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(profiles)
}

fn extract_attr(xml: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = xml.find(&pattern) {
        let rest = &xml[start + pattern.len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

// ── 获取流地址 ──

pub async fn get_stream_uri(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    app: &AppHandle,
) -> Result<String, String> {
    let body = format!(
        r#"<trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>{}</trt:ProfileToken>
    </trt:GetStreamUri>"#,
        profile_token
    );

    let response = soap_request(
        &session.media_service_url,
        "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    let uri = extract_tag_content(&response, "Uri")
        .unwrap_or_default();

    Ok(uri)
}

// ── PTZ 控制 ──

pub async fn ptz_continuous_move(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    direction: &str,
    speed: f64,
    app: &AppHandle,
) -> Result<(), String> {
    // Normalize speed to 0.0-1.0 range (frontend sends 1-10)
    let norm_speed = (speed / 10.0).clamp(0.0, 1.0);

    let (pan, tilt, zoom) = match direction {
        "up" => (0.0, norm_speed, 0.0),
        "down" => (0.0, -norm_speed, 0.0),
        "left" => (-norm_speed, 0.0, 0.0),
        "right" => (norm_speed, 0.0, 0.0),
        "zoom_in" => (0.0, 0.0, norm_speed),
        "zoom_out" => (0.0, 0.0, -norm_speed),
        _ => return Err(format!("Unknown PTZ direction: {}", direction)),
    };

    let body = format!(
        r#"<tptz:ContinuousMove>
      <tptz:ProfileToken>{}</tptz:ProfileToken>
      <tptz:Velocity>
        <tt:PanTilt x="{}" y="{}"/>
        <tt:Zoom x="{}"/>
      </tptz:Velocity>
    </tptz:ContinuousMove>"#,
        profile_token, pan, tilt, zoom
    );

    soap_request(
        &session.ptz_service_url,
        "http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    Ok(())
}

pub async fn ptz_stop(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let body = format!(
        r#"<tptz:Stop>
      <tptz:ProfileToken>{}</tptz:ProfileToken>
      <tptz:PanTilt>true</tptz:PanTilt>
      <tptz:Zoom>true</tptz:Zoom>
    </tptz:Stop>"#,
        profile_token
    );

    soap_request(
        &session.ptz_service_url,
        "http://www.onvif.org/ver20/ptz/wsdl/Stop",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    Ok(())
}

// ── 预置位管理 ──

pub async fn get_presets(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    app: &AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let body = format!(
        r#"<tptz:GetPresets>
      <tptz:ProfileToken>{}</tptz:ProfileToken>
    </tptz:GetPresets>"#,
        profile_token
    );

    let response = soap_request(
        &session.ptz_service_url,
        "http://www.onvif.org/ver20/ptz/wsdl/GetPresets",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    let mut presets = Vec::new();
    let preset_blocks = extract_all_tags(&response, "Preset");

    for block in preset_blocks {
        let token = extract_attr(block, "token").unwrap_or_default();
        let name = extract_tag_content(block, "Name").unwrap_or_else(|| token.clone());
        presets.push(serde_json::json!({
            "token": token,
            "name": name,
        }));
    }

    Ok(presets)
}

pub async fn goto_preset(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    preset_token: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let body = format!(
        r#"<tptz:GotoPreset>
      <tptz:ProfileToken>{}</tptz:ProfileToken>
      <tptz:PresetToken>{}</tptz:PresetToken>
    </tptz:GotoPreset>"#,
        profile_token, preset_token
    );

    soap_request(
        &session.ptz_service_url,
        "http://www.onvif.org/ver20/ptz/wsdl/GotoPreset",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    Ok(())
}

pub async fn set_preset(
    session: &OnvifSession,
    session_id: &str,
    profile_token: &str,
    preset_name: &str,
    app: &AppHandle,
) -> Result<String, String> {
    let body = format!(
        r#"<tptz:SetPreset>
      <tptz:ProfileToken>{}</tptz:ProfileToken>
      <tptz:PresetName>{}</tptz:PresetName>
    </tptz:SetPreset>"#,
        profile_token, preset_name
    );

    let response = soap_request(
        &session.ptz_service_url,
        "http://www.onvif.org/ver20/ptz/wsdl/SetPreset",
        &body,
        session_id,
        Some((&session.username, &session.password)),
        app,
    ).await?;

    let token = extract_tag_content(&response, "PresetToken")
        .unwrap_or_else(|| format!("preset-{}", chrono::Utc::now().timestamp_millis()));

    Ok(token)
}
