//! ONVIF 设备管理协议实现
//! 支持 WS-Discovery 设备发现、设备信息获取、媒体 Profile 管理、PTZ 控制、预置位管理
//! 使用手写 SOAP over HTTP，展示原始报文用于协议调试

use sha1::{Sha1, Digest};
use tauri::{AppHandle, Emitter};

use super::state::{OnvifSession, ProtocolMessage};

/// Detect the primary LAN IPv4 address by connecting to an external target.
/// This avoids picking VPN/proxy interfaces (e.g. Surge on macOS).
fn detect_lan_ip() -> Option<std::net::Ipv4Addr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // Connect to a public IP (doesn't actually send data) to let the OS pick the right interface
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

// ── WS-Security UsernameToken 认证 ──
// ONVIF Profile S requires WS-UsernameToken with PasswordDigest.
// Formula: PasswordDigest = Base64(SHA-1(nonce_raw + created_utf8 + password_utf8))

fn build_wsse_header(username: &str, password: &str) -> String {
    use base64::Engine;

    let nonce_bytes: [u8; 20] = rand_nonce();
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce_bytes);
    let created = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // PasswordDigest = Base64(SHA1(nonce_raw + created + password))
    let mut hasher = Sha1::new();
    hasher.update(nonce_bytes);
    hasher.update(created.as_bytes());
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    let digest_b64 = base64::engine::general_purpose::STANDARD.encode(digest);

    format!(
        r#"<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>{}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{}</wsse:Nonce>
        <wsu:Created>{}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>"#,
        username, digest_b64, nonce_b64, created
    )
}

fn rand_nonce() -> [u8; 20] {
    let mut buf = [0u8; 20];
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Mix timestamp nanos with process id for better uniqueness
    let seed = ts.as_nanos();
    let pid = std::process::id() as u128;
    let mixed = seed ^ (pid << 32);
    for (i, b) in buf.iter_mut().enumerate() {
        // Use different bit ranges and multiply by a prime for spread
        let val = (mixed.wrapping_mul(6364136223846793005).wrapping_add(i as u128 * 1442695040888963407)) >> (i * 3);
        *b = (val & 0xFF) as u8;
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
    let header = match auth {
        Some((user, pass)) if !user.is_empty() || !pass.is_empty() => build_wsse_header(user, pass),
        _ => String::new(),
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
        let fault = extract_soap_fault(&body_text);
        let friendly = if fault.to_lowercase().contains("authority") || fault.to_lowercase().contains("auth") {
            format!("认证失败 ({}): 请检查用户名和密码是否正确", fault)
        } else if fault.to_lowercase().contains("not authorized") {
            format!("未授权: 该操作需要认证，请填写正确的凭证")
        } else if fault.to_lowercase().contains("action not supported") {
            format!("不支持的操作: 设备不支持该功能 ({})", fault)
        } else {
            format!("SOAP 错误 (HTTP {}): {}", status.as_u16(), fault)
        };
        return Err(friendly);
    }

    Ok(body_text)
}

fn extract_soap_fault(xml: &str) -> String {
    // Try multiple fault text patterns used by different ONVIF devices
    for tag in &["faultstring", "Text", "Reason"] {
        if let Some(text) = extract_tag_content(xml, tag) {
            let clean = text.trim().to_string();
            if !clean.is_empty() {
                // Recursively extract inner text if it's still XML
                if clean.contains('<') {
                    if let Some(inner) = extract_tag_content(&clean, "Text") {
                        return inner.trim().to_string();
                    }
                }
                return clean;
            }
        }
    }
    "Unknown SOAP fault".to_string()
}

// ── XML 简易提取工具 ──

fn extract_tag_content(xml: &str, tag: &str) -> Option<String> {
    // Flexible search: find any <...tag or <prefix:tag pattern
    // This handles dynamic namespace prefixes like ns0:, ns1:, tds:, etc.
    let mut search_pos = 0;
    while search_pos < xml.len() {
        // Find the tag name anywhere (with or without prefix)
        let remaining = &xml[search_pos..];
        // Look for ":Tag" or "<Tag" patterns
        let found_pos = remaining.find(&format!(":{}", tag))
            .or_else(|| remaining.find(&format!("<{}", tag)));

        let abs_pos = match found_pos {
            Some(p) => search_pos + p,
            None => return None,
        };

        // Walk back to find the '<'
        let lt_pos = xml[..abs_pos].rfind('<')?;
        let rest = &xml[lt_pos..];

        // Verify this is an opening tag (not a closing tag)
        if rest.starts_with("</") {
            search_pos = abs_pos + 1;
            continue;
        }

        // Extract the full tag name including prefix (e.g. "trt:Profiles")
        let tag_start = &rest[1..]; // skip '<'
        let tag_end = tag_start.find(|c: char| c == ' ' || c == '>' || c == '/')?;
        let full_tag = &tag_start[..tag_end];

        // Verify the tag name ends with our target (handles ns0:Tag, trt:Tag, etc.)
        if !full_tag.ends_with(tag) {
            search_pos = abs_pos + 1;
            continue;
        }

        // Find the closing '>' of the opening tag
        let gt = rest.find('>')?;
        // Check for self-closing
        if rest.as_bytes().get(gt - 1) == Some(&b'/') {
            return Some(String::new());
        }

        let content_start = lt_pos + gt + 1;
        // Build closing tag
        let close_tag = format!("</{}>", full_tag);
        if let Some(close_pos) = xml[content_start..].find(&close_tag) {
            return Some(xml[content_start..content_start + close_pos].to_string());
        }

        search_pos = content_start;
    }
    None
}

fn extract_all_tags<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let mut results = Vec::new();
    let mut search_pos = 0;
    let tag_suffix = format!(":{}", tag);

    while search_pos < xml.len() {
        let remaining = &xml[search_pos..];

        // Find ":Tag" or "<Tag" pattern
        let found = remaining.find(&tag_suffix)
            .or_else(|| remaining.find(&format!("<{}", tag)));
        let rel_pos = match found {
            Some(p) => p,
            None => break,
        };
        let abs_pos = search_pos + rel_pos;

        // Walk back to find '<'
        let lt_pos = match xml[..abs_pos].rfind('<') {
            Some(p) => p,
            None => { search_pos = abs_pos + 1; continue; }
        };

        let rest = &xml[lt_pos..];
        if rest.starts_with("</") {
            search_pos = abs_pos + 1;
            continue;
        }

        // Extract full tag name
        let tag_start = &rest[1..];
        let tag_end = match tag_start.find(|c: char| c == ' ' || c == '>' || c == '/') {
            Some(p) => p,
            None => { search_pos = abs_pos + 1; continue; }
        };
        let full_tag = &tag_start[..tag_end];

        if !full_tag.ends_with(tag) {
            search_pos = abs_pos + 1;
            continue;
        }

        // Find the matching close tag
        let close_tag = format!("</{}>", full_tag);
        if let Some(close_pos) = xml[lt_pos..].find(&close_tag) {
            let end = lt_pos + close_pos + close_tag.len();
            results.push(&xml[lt_pos..end]);
            search_pos = end;
        } else {
            search_pos = abs_pos + 1;
        }
    }
    results
}

// ── WS-Discovery 设备发现 ──

pub async fn discover(app: &AppHandle) -> Result<Vec<serde_json::Value>, String> {
    use tokio::net::UdpSocket;

    // WS-Discovery Probe — xmlns:dn declared for NetworkVideoTransmitter type
    let probe_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>uuid:{}</a:MessageID>
    <a:ReplyTo>
      <a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address>
    </a:ReplyTo>
    <a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
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

    let multicast_group: std::net::Ipv4Addr = "239.255.255.250".parse().unwrap();

    // Detect the local LAN IP to bind multicast to the correct interface.
    // On macOS with VPN/proxy (e.g. Surge), binding to 0.0.0.0 picks the wrong
    // interface, causing "No route to host". We must use IP_MULTICAST_IF.
    let local_ip = detect_lan_ip().unwrap_or(std::net::Ipv4Addr::UNSPECIFIED);
    log::info!("WS-Discovery: using local IP {} for multicast", local_ip);

    // Set socket options for multicast interface binding
    {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let fd = socket.as_raw_fd();
            // IP_MULTICAST_IF -- set outgoing multicast interface
            let ip_bytes = local_ip.octets();
            unsafe {
                libc::setsockopt(
                    fd,
                    libc::IPPROTO_IP,
                    libc::IP_MULTICAST_IF,
                    ip_bytes.as_ptr() as *const libc::c_void,
                    4,
                );
                // IP_MULTICAST_TTL
                let ttl: libc::c_int = 4;
                libc::setsockopt(
                    fd,
                    libc::IPPROTO_IP,
                    libc::IP_MULTICAST_TTL,
                    &ttl as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                );
                // IP_ADD_MEMBERSHIP -- join multicast group on LAN interface
                let mreq = libc::ip_mreq {
                    imr_multiaddr: libc::in_addr { s_addr: u32::from_ne_bytes(multicast_group.octets()) },
                    imr_interface: libc::in_addr { s_addr: u32::from_ne_bytes(local_ip.octets()) },
                };
                libc::setsockopt(
                    fd,
                    libc::IPPROTO_IP,
                    libc::IP_ADD_MEMBERSHIP,
                    &mreq as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::ip_mreq>() as libc::socklen_t,
                );
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawSocket;
            let raw = socket.as_raw_socket() as libc::SOCKET;
            // Winsock2 constants
            const IPPROTO_IP: libc::c_int = 0;
            const IP_MULTICAST_IF: libc::c_int = 9;
            const IP_MULTICAST_TTL: libc::c_int = 10;
            const IP_ADD_MEMBERSHIP: libc::c_int = 12;
            unsafe {
                // IP_MULTICAST_IF — set outgoing multicast interface
                let ip_bytes = local_ip.octets();
                libc::setsockopt(
                    raw,
                    IPPROTO_IP,
                    IP_MULTICAST_IF,
                    ip_bytes.as_ptr() as *const i8,
                    4,
                );
                // IP_MULTICAST_TTL
                let ttl: i32 = 4;
                libc::setsockopt(
                    raw,
                    IPPROTO_IP,
                    IP_MULTICAST_TTL,
                    &ttl as *const _ as *const i8,
                    std::mem::size_of::<i32>() as i32,
                );
                // IP_ADD_MEMBERSHIP — join multicast group on LAN interface
                #[repr(C)]
                struct IpMreq {
                    imr_multiaddr: [u8; 4],
                    imr_interface: [u8; 4],
                }
                let mreq = IpMreq {
                    imr_multiaddr: multicast_group.octets(),
                    imr_interface: local_ip.octets(),
                };
                libc::setsockopt(
                    raw,
                    IPPROTO_IP,
                    IP_ADD_MEMBERSHIP,
                    &mreq as *const _ as *const i8,
                    std::mem::size_of::<IpMreq>() as i32,
                );
            }
        }
    }
    socket.set_broadcast(true).map_err(|e| format!("Set broadcast failed: {}", e))?;

    let multicast_addr: std::net::SocketAddr = "239.255.255.250:3702".parse().unwrap();

    // Send the probe multiple times to improve reliability
    for _ in 0..3 {
        socket.send_to(probe_xml.as_bytes(), multicast_addr).await
            .map_err(|e| format!("Send probe failed: {}", e))?;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let mut devices = Vec::new();
    let mut seen_addrs = std::collections::HashSet::new();
    let mut buf = vec![0u8; 65535];

    // Wait for responses with 5s timeout (ONVIF devices can be slow)
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
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

                // Parse XAddrs from response — try multiple tag name patterns
                let xaddrs_str = extract_tag_content(&response, "XAddrs")
                    .or_else(|| extract_tag_content(&response, "ProbeMatch")
                        .and_then(|pm| extract_tag_content(&pm, "XAddrs")));

                if let Some(xaddrs) = xaddrs_str {
                    for xaddr in xaddrs.split_whitespace() {
                        if let Ok(url) = url::Url::parse(xaddr) {
                            let host = url.host_str().unwrap_or("").to_string();
                            let port = url.port().unwrap_or(80);
                            let key = format!("{}:{}", host, port);
                            if seen_addrs.contains(&key) { continue; }
                            seen_addrs.insert(key);

                            let name = extract_tag_content(&response, "Scopes")
                                .and_then(|s| {
                                    s.split_whitespace()
                                        .find(|scope| scope.contains("onvif://www.onvif.org/name/") || scope.contains("/name/"))
                                        .map(|scope| {
                                            scope.rsplit('/').next().unwrap_or("").to_string()
                                        })
                                });
                            devices.push(serde_json::json!({
                                "host": host,
                                "port": port,
                                "name": name,
                                "xaddr": xaddr,
                            }));
                        }
                    }
                } else {
                    // Fallback: extract from sender address if no XAddrs found
                    let host = addr.ip().to_string();
                    let key = format!("{}:80", host);
                    if !seen_addrs.contains(&key) && !host.starts_with("127.") {
                        seen_addrs.insert(key);
                        devices.push(serde_json::json!({
                            "host": host,
                            "port": 80,
                            "name": null,
                            "xaddr": format!("http://{}:80/onvif/device_service", host),
                        }));
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
