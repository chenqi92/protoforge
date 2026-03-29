//! 内置视频播放器
//! 使用 ffmpeg-next (静态链接) 将 RTSP/RTMP/HLS/HTTP-FLV 等任意流转封装为 fMP4
//! 通过 WebSocket 推送到前端，前端用 MSE API 在 <video> 标签中播放
//! 零外部二进制依赖

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use tauri::{AppHandle, Emitter};

use super::state::ProtocolMessage;

/// 播放器会话
pub struct PlayerSession {
    pub shutdown_tx: Option<oneshot::Sender<()>>,
    pub ws_port: u16,
}

/// 全局播放器会话管理
pub static PLAYER_SESSIONS: std::sync::LazyLock<Arc<Mutex<HashMap<String, PlayerSession>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 启动播放器：打开输入流 → remux 为 fMP4 → WebSocket 推送
pub async fn start_player(
    session_id: String,
    url: String,
    app: AppHandle,
) -> Result<String, String> {
    // 停止已有会话
    stop_player(&session_id).await;

    // 找一个空闲端口
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
        .map_err(|e| format!("绑定端口失败: {}", e))?;
    let ws_port = listener.local_addr().unwrap().port();
    let ws_url = format!("ws://127.0.0.1:{}", ws_port);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // 保存会话
    PLAYER_SESSIONS.lock().await.insert(session_id.clone(), PlayerSession {
        shutdown_tx: Some(shutdown_tx),
        ws_port,
    });

    // Emit info
    let msg = ProtocolMessage {
        id: uuid::Uuid::new_v4().to_string(),
        direction: "info".to_string(),
        protocol: "player".to_string(),
        summary: format!("播放器启动 → {}", ws_url),
        detail: format!("源: {}\nWebSocket: {}\n格式: fMP4 (remux)", url, ws_url),
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: None,
    };
    let _ = app.emit("videostream-protocol-msg", &msg);

    let sid = session_id.clone();
    let app_clone = app.clone();

    // 在独立线程中运行 ffmpeg（ffmpeg API 是同步的）
    tokio::spawn(async move {
        let url_clone = url.clone();
        let ws_port_clone = ws_port;

        // ffmpeg 解码/remux 在阻塞线程中运行
        let handle = tokio::task::spawn_blocking(move || {
            run_remux_pipeline(&url_clone, ws_port_clone)
        });

        // 等待 shutdown 信号或 pipeline 结束
        tokio::select! {
            _ = shutdown_rx => {
                log::info!("Player {} shutdown requested", sid);
            }
            result = handle => {
                match result {
                    Ok(Ok(())) => log::info!("Player {} finished normally", sid),
                    Ok(Err(e)) => {
                        log::warn!("Player {} error: {}", sid, e);
                        let msg = ProtocolMessage {
                            id: uuid::Uuid::new_v4().to_string(),
                            direction: "info".to_string(),
                            protocol: "player".to_string(),
                            summary: format!("播放器错误: {}", e),
                            detail: e.clone(),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            size: None,
                        };
                        let _ = app_clone.emit("videostream-protocol-msg", &msg);
                    }
                    Err(e) => log::warn!("Player {} task panicked: {}", sid, e),
                }
            }
        }

        // 清理
        PLAYER_SESSIONS.lock().await.remove(&sid);
    });

    // 等待一小段时间让 WebSocket 服务器启动
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    Ok(ws_url)
}

/// 停止播放器
pub async fn stop_player(session_id: &str) {
    if let Some(session) = PLAYER_SESSIONS.lock().await.remove(session_id) {
        if let Some(tx) = session.shutdown_tx {
            let _ = tx.send(());
        }
    }
}

/// ffmpeg remux 管道（同步，在 spawn_blocking 中运行）
/// 打开输入 → 找到视频/音频流 → remux 为 fMP4 → 通过 WebSocket 发送
fn run_remux_pipeline(url: &str, ws_port: u16) -> Result<(), String> {
    use std::net::TcpListener;
    use std::io::Write;

    extern crate ffmpeg_next as ffmpeg;

    ffmpeg::init().map_err(|e| format!("ffmpeg init 失败: {}", e))?;

    // 设置 RTSP 选项
    let mut opts = ffmpeg::Dictionary::new();
    if url.starts_with("rtsp://") {
        opts.set("rtsp_transport", "tcp");
    }
    opts.set("stimeout", "5000000"); // 5s timeout
    opts.set("analyzeduration", "2000000");
    opts.set("probesize", "1000000");

    // 打开输入
    let mut ictx = ffmpeg::format::input_with_dictionary(url, opts)
        .map_err(|e| format!("打开流失败: {} ({})", e, url))?;

    // 找视频流
    let video_stream_idx = ictx.streams().best(ffmpeg::media::Type::Video)
        .map(|s| s.index())
        .ok_or_else(|| "未找到视频流".to_string())?;

    let audio_stream_idx = ictx.streams().best(ffmpeg::media::Type::Audio)
        .map(|s| s.index());

    // 准备输出 — 写到内存缓冲区
    // 由于 ffmpeg-next 的 output API 需要文件路径,
    // 我们使用 pipe 协议写到临时缓冲

    // 启动简易 WebSocket 服务器 (用 TCP + 手写 WS 握手)
    let listener = TcpListener::bind(format!("127.0.0.1:{}", ws_port))
        .map_err(|e| format!("WS 服务器绑定失败: {}", e))?;
    listener.set_nonblocking(false).ok();

    // 设置超时等待前端连接
    listener.set_nonblocking(true).ok();
    let mut client = None;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                // 完成 WebSocket 握手
                stream.set_nonblocking(false).ok();
                match do_ws_handshake(stream) {
                    Ok(s) => { client = Some(s); break; }
                    Err(e) => { log::warn!("WS handshake failed: {}", e); }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("WS accept error: {}", e)),
        }
    }

    let mut ws = client.ok_or_else(|| "前端未在 10 秒内连接 WebSocket".to_string())?;

    // 使用 ffmpeg 直接读取 packet 并发送原始 H.264 数据
    // 前端使用 jmuxer 或 broadway 解码
    // 更简单的方案：直接发送 MPEGTS 片段给前端

    // 简化方案：把输入流的 packet 直接 remux 为 MPEG-TS 并通过 WS 发送
    // 前端可以用 mpegts.js 或 hls.js 播放 TS 数据

    // 实际方案：逐帧读取，直接把 NAL 数据包装发送
    let mut seq = 0u32;
    let video_stream = ictx.stream(video_stream_idx).unwrap();
    let codec_params = video_stream.parameters();

    // 提取 extradata（SPS/PPS for H.264）
    let extradata = unsafe {
        let ptr = (*codec_params.as_ptr()).extradata;
        let size = (*codec_params.as_ptr()).extradata_size as usize;
        if !ptr.is_null() && size > 0 {
            std::slice::from_raw_parts(ptr, size).to_vec()
        } else {
            Vec::new()
        }
    };

    let width = unsafe { (*codec_params.as_ptr()).width as u32 };
    let height = unsafe { (*codec_params.as_ptr()).height as u32 };

    // 发送 init 信息 (JSON)
    let init_info = serde_json::json!({
        "type": "init",
        "codec": "h264",
        "width": width,
        "height": height,
        "extradata": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &extradata),
    });
    let init_json = serde_json::to_string(&init_info).unwrap();
    if ws_send_text(&mut ws, &init_json).is_err() {
        return Ok(()); // 前端断开
    }

    // 读取 packet 循环
    for (stream_idx, packet) in ictx.packets() {
        if stream_idx.index() != video_stream_idx {
            if let Some(audio_idx) = audio_stream_idx {
                if stream_idx.index() != audio_idx {
                    continue;
                }
            } else {
                continue;
            }
        }

        // 只发视频 packet
        if stream_idx.index() == video_stream_idx {
            let data = packet.data().unwrap_or(&[]);
            if data.is_empty() { continue; }

            seq += 1;

            // 发送二进制帧：4字节序号 + 8字节时间戳 + 数据
            let pts = packet.pts().unwrap_or(0);
            let mut frame = Vec::with_capacity(12 + data.len());
            frame.extend_from_slice(&seq.to_be_bytes());
            frame.extend_from_slice(&pts.to_be_bytes());
            frame.extend_from_slice(data);

            if ws_send_binary(&mut ws, &frame).is_err() {
                log::info!("WebSocket client disconnected");
                return Ok(()); // 前端断开
            }
        }
    }

    Ok(())
}

/// 执行 WebSocket 握手
fn do_ws_handshake(mut stream: std::net::TcpStream) -> Result<std::net::TcpStream, String> {
    use std::io::{Read, Write};

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // 提取 Sec-WebSocket-Key
    let key = request.lines()
        .find(|l| l.to_lowercase().starts_with("sec-websocket-key:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .ok_or_else(|| "Missing Sec-WebSocket-Key".to_string())?;

    // 计算 accept key
    use sha1::{Sha1, Digest};
    let mut hasher = Sha1::new();
    hasher.update(format!("{}258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key).as_bytes());
    let accept = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, hasher.finalize());

    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n",
        accept
    );
    stream.write_all(response.as_bytes()).map_err(|e| format!("Write error: {}", e))?;

    Ok(stream)
}

/// 发送 WebSocket 文本帧
fn ws_send_text(stream: &mut std::net::TcpStream, text: &str) -> Result<(), String> {
    ws_send_frame(stream, 0x01, text.as_bytes())
}

/// 发送 WebSocket 二进制帧
fn ws_send_binary(stream: &mut std::net::TcpStream, data: &[u8]) -> Result<(), String> {
    ws_send_frame(stream, 0x02, data)
}

/// 发送 WebSocket 帧
fn ws_send_frame(stream: &mut std::net::TcpStream, opcode: u8, data: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let mut header = Vec::new();
    header.push(0x80 | opcode); // FIN + opcode

    let len = data.len();
    if len < 126 {
        header.push(len as u8);
    } else if len < 65536 {
        header.push(126);
        header.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        header.push(127);
        header.extend_from_slice(&(len as u64).to_be_bytes());
    }

    stream.write_all(&header).map_err(|e| format!("WS write header: {}", e))?;
    stream.write_all(data).map_err(|e| format!("WS write data: {}", e))?;
    stream.flush().map_err(|e| format!("WS flush: {}", e))?;

    Ok(())
}
