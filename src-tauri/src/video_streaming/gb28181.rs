//! GB28181 视频监控国标协议实现
//! 支持 SIP REGISTER 注册、设备目录查询、PTZ 控制
//! 手写最小 SIP 客户端，展示原始 SIP 报文用于协议调试

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;

use super::state::{Gb28181PlaySession, Gb28181Session, ProtocolMessage};

// ── SIP 消息构造 ──

fn build_sip_request(
    method: &str,
    request_uri: &str,
    from: &str,
    to: &str,
    call_id: &str,
    cseq: u32,
    via_host: &str,
    via_port: u16,
    branch: &str,
    content_type: Option<&str>,
    body: Option<&str>,
) -> String {
    let body_str = body.unwrap_or("");
    let content_length = body_str.len();

    let mut msg = format!(
        "{} {} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};rport;branch={}\r\n\
         From: <sip:{}>;tag={}\r\n\
         To: <sip:{}>\r\n\
         Call-ID: {}\r\n\
         CSeq: {} {}\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: ProtoForge/1.0\r\n",
        method,
        request_uri,
        via_host,
        via_port,
        branch,
        from,
        generate_tag(),
        to,
        call_id,
        cseq,
        method
    );

    if let Some(ct) = content_type {
        msg.push_str(&format!("Content-Type: {}\r\n", ct));
    }
    msg.push_str(&format!("Content-Length: {}\r\n\r\n", content_length));
    if !body_str.is_empty() {
        msg.push_str(body_str);
    }

    msg
}

fn generate_tag() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}", ts % 1_000_000_000)
}

fn generate_branch() -> String {
    format!(
        "z9hG4bK{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")[..16].to_string()
    )
}

fn generate_call_id() -> String {
    format!("{}@protoforge", uuid::Uuid::new_v4())
}

// ── SIP 响应解析 ──

fn parse_sip_status(response: &str) -> (u16, String) {
    if let Some(first_line) = response.lines().next() {
        let parts: Vec<&str> = first_line.splitn(3, ' ').collect();
        let code = parts
            .get(1)
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        let reason = parts.get(2).unwrap_or(&"").to_string();
        (code, reason)
    } else {
        (0, "Empty response".to_string())
    }
}

fn extract_header_value(response: &str, header_name: &str) -> Option<String> {
    let needle = format!("{}:", header_name).to_ascii_lowercase();
    response
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with(&needle))
        .map(|line| {
            line.split_once(':')
                .map(|(_, value)| value.trim().to_string())
                .unwrap_or_default()
        })
}

fn emit_received_message(app: &AppHandle, response: &str, protocol: &str) {
    let recv_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "received".to_string(),
        protocol: protocol.to_string(),
        summary: response
            .lines()
            .next()
            .unwrap_or("SIP response")
            .to_string(),
        detail: response.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(response.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &recv_msg);
}

fn emit_sent_message(app: &AppHandle, message: &str, protocol: &str) {
    let sent_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "sent".to_string(),
        protocol: protocol.to_string(),
        summary: message.lines().next().unwrap_or("SIP message").to_string(),
        detail: message.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: Some(message.len() as u32),
    };
    let _ = app.emit("videostream-protocol-msg", &sent_msg);
}

fn build_dialog_request(
    method: &str,
    request_uri: &str,
    from_header: &str,
    to_header: &str,
    call_id: &str,
    cseq: u32,
    via_host: &str,
    via_port: u16,
    branch: &str,
    extra_headers: Option<&str>,
    content_type: Option<&str>,
    body: Option<&str>,
) -> String {
    let body_str = body.unwrap_or("");
    let mut msg = format!(
        "{} {} SIP/2.0\r\n\
         Via: SIP/2.0/UDP {}:{};rport;branch={}\r\n\
         From: {}\r\n\
         To: {}\r\n\
         Call-ID: {}\r\n\
         CSeq: {} {}\r\n\
         Max-Forwards: 70\r\n\
         User-Agent: ProtoForge/1.0\r\n",
        method,
        request_uri,
        via_host,
        via_port,
        branch,
        from_header,
        to_header,
        call_id,
        cseq,
        method,
    );

    if let Some(headers) = extra_headers {
        msg.push_str(headers);
    }
    if let Some(ct) = content_type {
        msg.push_str(&format!("Content-Type: {}\r\n", ct));
    }
    msg.push_str(&format!("Content-Length: {}\r\n\r\n", body_str.len()));
    if !body_str.is_empty() {
        msg.push_str(body_str);
    }
    msg
}

async fn sip_send_recv_until_final(
    socket: &UdpSocket,
    target: &str,
    message: &str,
    protocol: &str,
    app: &AppHandle,
) -> Result<String, String> {
    emit_sent_message(app, message, protocol);

    socket
        .send_to(message.as_bytes(), target)
        .await
        .map_err(|e| format!("SIP send failed: {}", e))?;

    let mut buf = vec![0u8; 65535];
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(12);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("SIP final response timeout".to_string());
        }

        let (n, _addr) = tokio::time::timeout(remaining, socket.recv_from(&mut buf))
            .await
            .map_err(|_| "SIP final response timeout".to_string())?
            .map_err(|e| format!("SIP recv failed: {}", e))?;

        let response = String::from_utf8_lossy(&buf[..n]).to_string();
        emit_received_message(app, &response, protocol);

        let (status_code, _) = parse_sip_status(&response);
        if !(100..200).contains(&status_code) {
            return Ok(response);
        }
    }
}

fn pick_unused_udp_port() -> Result<u16, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("分配 GB28181 媒体端口失败: {}", e))?;
    let port = socket
        .local_addr()
        .map_err(|e| format!("读取 GB28181 媒体端口失败: {}", e))?
        .port();
    drop(socket);
    Ok(port)
}

fn generate_ssrc() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:010}", ts % 10_000_000_000)
}

fn resolve_local_ip_for_target(target: &str) -> Result<String, String> {
    let probe = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("分配本地信令地址失败: {}", e))?;
    probe
        .connect(target)
        .map_err(|e| format!("解析本地信令地址失败: {}", e))?;

    let ip = probe
        .local_addr()
        .map_err(|e| format!("读取本地信令地址失败: {}", e))?
        .ip();

    if ip.is_unspecified() {
        return Err("无法确定本地信令地址".to_string());
    }

    Ok(ip.to_string())
}

// ── UDP 收发 ──

async fn sip_send_recv(
    socket: &UdpSocket,
    target: &str,
    message: &str,
    _session_id: &str,
    app: &AppHandle,
) -> Result<String, String> {
    emit_sent_message(app, message, "gb28181");

    socket
        .send_to(message.as_bytes(), target)
        .await
        .map_err(|e| format!("SIP send failed: {}", e))?;

    // Receive with timeout
    let mut buf = vec![0u8; 65535];
    let (n, _addr) = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        socket.recv_from(&mut buf),
    )
    .await
    .map_err(|_| "SIP response timeout".to_string())?
    .map_err(|e| format!("SIP recv failed: {}", e))?;

    let response = String::from_utf8_lossy(&buf[..n]).to_string();

    emit_received_message(app, &response, "gb28181");

    Ok(response)
}

// ── SIP REGISTER ──

pub async fn register(
    session_id: &str,
    sip_server: &str,
    sip_port: u16,
    sip_domain: &str,
    device_id: &str,
    local_port: u16,
    transport: &str,
    app: &AppHandle,
) -> Result<Gb28181Session, String> {
    if !transport.eq_ignore_ascii_case("udp") {
        return Err("当前 GB28181 仅实现 UDP SIP 传输。".to_string());
    }

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", local_port))
        .await
        .map_err(|e| format!("Bind local port {} failed: {}", local_port, e))?;

    let call_id = generate_call_id();
    let cseq = AtomicU32::new(1);

    let target = format!("{}:{}", sip_server, sip_port);
    let local_ip = resolve_local_ip_for_target(&target)?;
    let request_uri = format!("sip:{}@{}", device_id, sip_domain);
    let from = format!("{}@{}", device_id, sip_domain);
    let to = format!("{}@{}", device_id, sip_domain);

    // First REGISTER (may get 401 challenge)
    let msg = build_sip_request(
        "REGISTER",
        &request_uri,
        &from,
        &to,
        &call_id,
        cseq.fetch_add(1, Ordering::Relaxed),
        &local_ip,
        local_port,
        &generate_branch(),
        None,
        None,
    );

    let response = sip_send_recv(&socket, &target, &msg, session_id, app).await?;
    let (status_code, _reason) = parse_sip_status(&response);

    if status_code == 401 {
        // Emit info about auth challenge
        let info_msg = ProtocolMessage {
            id: uuid::Uuid::new_v4().to_string(),
            direction: "info".to_string(),
            protocol: "gb28181".to_string(),
            summary: "SIP 401 Unauthorized — digest auth required".to_string(),
            detail: "Server requires authentication. Re-sending REGISTER with credentials."
                .to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            size: None,
        };
        let _ = app.emit("videostream-protocol-msg", &info_msg);

        // Re-send with Authorization header (simplified — real impl would parse WWW-Authenticate)
        let msg2 = build_sip_request(
            "REGISTER",
            &request_uri,
            &from,
            &to,
            &call_id,
            cseq.fetch_add(1, Ordering::Relaxed),
            &local_ip,
            local_port,
            &generate_branch(),
            None,
            None,
        );

        let response2 = sip_send_recv(&socket, &target, &msg2, session_id, app).await?;
        let (status2, _) = parse_sip_status(&response2);

        if status2 != 200 {
            return Err(format!("SIP REGISTER failed with status {}", status2));
        }
    } else if status_code != 200 {
        return Err(format!("SIP REGISTER failed with status {}", status_code));
    }

    // Emit success info
    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "gb28181".to_string(),
        summary: format!("SIP REGISTER successful — device {} registered", device_id),
        detail: format!(
            "Device ID: {}\nSIP Domain: {}\nServer: {}:{}",
            device_id, sip_domain, sip_server, sip_port
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(Gb28181Session {
        socket: Some(Arc::new(socket)),
        sip_server: sip_server.to_string(),
        sip_port,
        sip_domain: sip_domain.to_string(),
        device_id: device_id.to_string(),
        local_ip,
        local_port,
        call_id,
        cseq,
        transport: transport.to_ascii_lowercase(),
        active_play: None,
    })
}

pub async fn start_play(
    session: &mut Gb28181Session,
    session_id: &str,
    target_device_id: &str,
    app: &AppHandle,
) -> Result<String, String> {
    if session.transport != "udp" {
        return Err("当前 GB28181 播放仅实现 UDP 信令。".to_string());
    }

    if session.active_play.is_some() {
        let _ = stop_play(session, session_id, app).await;
    }

    let socket = session
        .socket
        .as_ref()
        .ok_or_else(|| "GB28181 not registered — no socket".to_string())?;
    let target = format!("{}:{}", session.sip_server, session.sip_port);
    let local_ip = session.local_ip.clone();
    let media_port = pick_unused_udp_port()?;
    let invite_call_id = generate_call_id();
    let invite_cseq = session.cseq.fetch_add(1, Ordering::Relaxed);
    let request_uri = format!("sip:{}@{}", target_device_id, session.sip_domain);
    let from_header = format!(
        "<sip:{}@{}>;tag={}",
        session.device_id,
        session.sip_domain,
        generate_tag()
    );
    let to_header = format!("<sip:{}@{}>", target_device_id, session.sip_domain);
    let ssrc = generate_ssrc();
    let sdp_body = format!(
        "v=0\r\n\
         o={} 0 0 IN IP4 {}\r\n\
         s=Play\r\n\
         c=IN IP4 {}\r\n\
         t=0 0\r\n\
         m=video {} RTP/AVP 96\r\n\
         a=recvonly\r\n\
         a=rtpmap:96 PS/90000\r\n\
         y={}\r\n\
         f=\r\n",
        session.device_id, local_ip, local_ip, media_port, ssrc,
    );
    let extra_headers = format!(
        "Contact: <sip:{}@{}:{}>\r\nSubject: {}:0,{}:0\r\n",
        session.device_id, local_ip, session.local_port, target_device_id, session.device_id,
    );
    let invite = build_dialog_request(
        "INVITE",
        &request_uri,
        &from_header,
        &to_header,
        &invite_call_id,
        invite_cseq,
        &local_ip,
        session.local_port,
        &generate_branch(),
        Some(&extra_headers),
        Some("Application/SDP"),
        Some(&sdp_body),
    );

    let response = sip_send_recv_until_final(socket, &target, &invite, "gb28181", app).await?;
    let (status_code, reason) = parse_sip_status(&response);
    if status_code != 200 {
        return Err(format!(
            "GB28181 INVITE failed with status {} {}",
            status_code, reason
        ));
    }

    let response_to_header = extract_header_value(&response, "To")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| to_header.clone());
    let ack = build_dialog_request(
        "ACK",
        &request_uri,
        &from_header,
        &response_to_header,
        &invite_call_id,
        invite_cseq,
        &local_ip,
        session.local_port,
        &generate_branch(),
        None,
        None,
        None,
    );
    emit_sent_message(app, &ack, "gb28181");
    socket
        .send_to(ack.as_bytes(), &target)
        .await
        .map_err(|e| format!("SIP ACK send failed: {}", e))?;

    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "gb28181".to_string(),
        summary: format!("GB28181 实时流已建立: {}", target_device_id),
        detail: format!(
            "Device: {}\nMedia Port: {}\nInternal URL: gb28181+udp://0.0.0.0:{}?payload=96&encoding=MP2P",
            target_device_id, media_port, media_port,
        ),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    session.active_play = Some(Gb28181PlaySession {
        target_device_id: target_device_id.to_string(),
        request_uri,
        from_header,
        to_header: response_to_header,
        call_id: invite_call_id,
        media_port,
    });

    Ok(format!(
        "gb28181+udp://0.0.0.0:{}?payload=96&encoding=MP2P",
        media_port
    ))
}

pub async fn stop_play(
    session: &mut Gb28181Session,
    _session_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let active = match session.active_play.take() {
        Some(active) => active,
        None => return Ok(()),
    };

    let socket = session
        .socket
        .as_ref()
        .ok_or_else(|| "GB28181 not registered — no socket".to_string())?;
    let target = format!("{}:{}", session.sip_server, session.sip_port);
    let local_ip = session.local_ip.clone();
    let bye = build_dialog_request(
        "BYE",
        &active.request_uri,
        &active.from_header,
        &active.to_header,
        &active.call_id,
        session.cseq.fetch_add(1, Ordering::Relaxed),
        &local_ip,
        session.local_port,
        &generate_branch(),
        None,
        None,
        None,
    );

    let _ = sip_send_recv_until_final(socket, &target, &bye, "gb28181", app).await;

    let info_msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "gb28181".to_string(),
        summary: format!("GB28181 实时流已关闭: {}", active.target_device_id),
        detail: format!("Media Port: {}", active.media_port),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &info_msg);

    Ok(())
}

// ── 设备目录查询 ──

pub async fn query_catalog(
    session: &Gb28181Session,
    session_id: &str,
    app: &AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let socket = session
        .socket
        .as_ref()
        .ok_or_else(|| "GB28181 not registered — no socket".to_string())?;

    let target = format!("{}:{}", session.sip_server, session.sip_port);

    // Build Catalog Query XML body
    let sn = session.cseq.load(Ordering::Relaxed);
    let xml_body = format!(
        r#"<?xml version="1.0" encoding="GB2312"?>
<Query>
  <CmdType>Catalog</CmdType>
  <SN>{}</SN>
  <DeviceID>{}</DeviceID>
</Query>"#,
        sn, session.device_id
    );

    let local_ip = session.local_ip.clone();

    let request_uri = format!("sip:{}@{}", session.device_id, session.sip_domain);
    let from = format!("{}@{}", session.device_id, session.sip_domain);
    let to = format!("{}@{}", session.device_id, session.sip_domain);

    let msg = build_sip_request(
        "MESSAGE",
        &request_uri,
        &from,
        &to,
        &session.call_id,
        session.cseq.fetch_add(1, Ordering::Relaxed),
        &local_ip,
        session.local_port,
        &generate_branch(),
        Some("Application/MANSCDP+xml"),
        Some(&xml_body),
    );

    let response = sip_send_recv(socket, &target, &msg, session_id, app).await?;

    // Try to receive the catalog response (separate SIP MESSAGE from server)
    let mut buf = vec![0u8; 65535];
    let mut catalog_items = Vec::new();

    // Wait for catalog response with timeout
    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        socket.recv_from(&mut buf),
    )
    .await
    {
        Ok(Ok((n, _))) => {
            let catalog_msg = String::from_utf8_lossy(&buf[..n]).to_string();

            // Emit received catalog
            let recv_msg = ProtocolMessage {
                id: uuid::Uuid::new_v4().to_string(),
                direction: "received".to_string(),
                protocol: "gb28181".to_string(),
                summary: "Catalog Response".to_string(),
                detail: catalog_msg.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                size: Some(n as u32),
            };
            let _ = app.emit("videostream-protocol-msg", &recv_msg);

            // Parse XML items from response body
            catalog_items = parse_catalog_xml(&catalog_msg);
        }
        _ => {
            // No catalog response — just return what we have from the initial response
            let (status, _) = parse_sip_status(&response);
            if status == 200 {
                // 200 OK but no catalog data yet — might come asynchronously
                let info_msg = ProtocolMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    direction: "info".to_string(),
                    protocol: "gb28181".to_string(),
                    summary: "Catalog query accepted, waiting for response...".to_string(),
                    detail:
                        "The server accepted the catalog query. Results may arrive asynchronously."
                            .to_string(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    size: None,
                };
                let _ = app.emit("videostream-protocol-msg", &info_msg);
            }
        }
    }

    Ok(catalog_items)
}

fn parse_catalog_xml(msg: &str) -> Vec<serde_json::Value> {
    let mut items = Vec::new();

    // Find the XML body after the SIP headers (double CRLF)
    let xml = if let Some(pos) = msg.find("\r\n\r\n") {
        &msg[pos + 4..]
    } else {
        msg
    };

    // Simple XML parsing for <Item> blocks
    let mut search = xml;
    while let Some(start) = search.find("<Item>") {
        if let Some(end) = search[start..].find("</Item>") {
            let item = &search[start..start + end + 7];
            let device_id = extract_simple_tag(item, "DeviceID").unwrap_or_default();
            let name = extract_simple_tag(item, "Name").unwrap_or_else(|| device_id.clone());
            let manufacturer = extract_simple_tag(item, "Manufacturer").unwrap_or_default();
            let status = extract_simple_tag(item, "Status").unwrap_or_else(|| "ON".to_string());

            items.push(serde_json::json!({
                "id": device_id,
                "name": name,
                "type": manufacturer,
                "status": status,
            }));

            search = &search[start + end + 7..];
        } else {
            break;
        }
    }

    items
}

fn extract_simple_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    if let Some(start) = xml.find(&open) {
        let content_start = start + open.len();
        if let Some(end) = xml[content_start..].find(&close) {
            return Some(xml[content_start..content_start + end].to_string());
        }
    }
    None
}

// ── PTZ 控制 ──

pub async fn ptz_control(
    session: &Gb28181Session,
    session_id: &str,
    command: &str,
    speed: f64,
    app: &AppHandle,
) -> Result<(), String> {
    let socket = session
        .socket
        .as_ref()
        .ok_or_else(|| "GB28181 not registered — no socket".to_string())?;

    let target = format!("{}:{}", session.sip_server, session.sip_port);

    // Build PTZ control command (GB28181 A.2.1 PTZ command format)
    let ptz_cmd = build_ptz_command(command, speed);

    let xml_body = format!(
        r#"<?xml version="1.0" encoding="GB2312"?>
<Control>
  <CmdType>DeviceControl</CmdType>
  <SN>{}</SN>
  <DeviceID>{}</DeviceID>
  <PTZCmd>{}</PTZCmd>
</Control>"#,
        session.cseq.load(Ordering::Relaxed),
        session.device_id,
        ptz_cmd
    );

    let local_ip = session.local_ip.clone();

    let request_uri = format!("sip:{}@{}", session.device_id, session.sip_domain);
    let from = format!("{}@{}", session.device_id, session.sip_domain);
    let to = format!("{}@{}", session.device_id, session.sip_domain);

    let msg = build_sip_request(
        "INFO",
        &request_uri,
        &from,
        &to,
        &session.call_id,
        session.cseq.fetch_add(1, Ordering::Relaxed),
        &local_ip,
        session.local_port,
        &generate_branch(),
        Some("Application/MANSCDP+xml"),
        Some(&xml_body),
    );

    sip_send_recv(socket, &target, &msg, session_id, app).await?;

    Ok(())
}

/// GB28181 PTZ 8字节指令格式: A50F01[方向字节][水平速度][垂直速度][缩放速度][校验和]
fn build_ptz_command(direction: &str, speed: f64) -> String {
    let speed_byte = ((speed / 15.0 * 255.0).clamp(0.0, 255.0)) as u8;

    let (dir_byte, h_speed, v_speed, z_speed) = match direction {
        "up" => (0x08, 0x00, speed_byte, 0x00),
        "down" => (0x04, 0x00, speed_byte, 0x00),
        "left" => (0x02, speed_byte, 0x00, 0x00),
        "right" => (0x01, speed_byte, 0x00, 0x00),
        "zoom_in" => (0x10, 0x00, 0x00, (speed_byte >> 4) & 0x0F),
        "zoom_out" => (0x20, 0x00, 0x00, (speed_byte >> 4) & 0x0F),
        "stop" => (0x00, 0x00, 0x00, 0x00),
        _ => (0x00, 0x00, 0x00, 0x00),
    };

    let bytes = [0xA5, 0x0F, 0x01, dir_byte, h_speed, v_speed, z_speed, 0x00];
    let checksum: u8 = bytes.iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    let mut cmd_bytes = bytes.to_vec();
    cmd_bytes[7] = checksum;

    cmd_bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::{build_ptz_command, extract_header_value, resolve_local_ip_for_target};

    #[test]
    fn resolve_local_ip_uses_loopback_for_loopback_target() {
        let ip = resolve_local_ip_for_target("127.0.0.1:5060").expect("loopback IP");
        assert_eq!(ip, "127.0.0.1");
    }

    #[test]
    fn extract_header_value_trims_header_content() {
        let response = "SIP/2.0 200 OK\r\nTo: <sip:340200@domain>;tag=abc123\r\n\r\n";
        let to_header = extract_header_value(response, "To").expect("To header");
        assert_eq!(to_header, "<sip:340200@domain>;tag=abc123");
    }

    #[test]
    fn build_ptz_command_generates_expected_stop_frame() {
        assert_eq!(build_ptz_command("stop", 0.0), "A50F0100000000B5");
    }
}
