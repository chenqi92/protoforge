//! FFmpeg 运行时管理器
//! 按需下载 FFmpeg CLI 到应用数据目录，支持 Windows/macOS 平台差异

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// FFmpeg 版本号（用于下载 URL 和本地目录命名）
const FFMPEG_VERSION: &str = "7.1.1";

/// FFmpeg 下载状态
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    /// 是否已安装可用
    pub available: bool,
    /// ffmpeg 可执行文件路径（如果可用）
    pub path: Option<String>,
    /// 来源说明
    pub source: String,
    /// 是否正在下载
    pub downloading: bool,
}

/// 下载进度事件
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    /// 0.0 ~ 1.0
    progress: f64,
    /// 已下载字节数
    downloaded: u64,
    /// 总字节数（可能为 0 表示未知）
    total: u64,
    /// 阶段描述
    stage: String,
}

/// 全局下载锁，防止并发下载
static DOWNLOAD_LOCK: std::sync::LazyLock<Arc<Mutex<bool>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(false)));

/// 获取 FFmpeg 的安装状态
pub async fn get_status(app: &AppHandle) -> FfmpegStatus {
    // 1. 检查应用数据目录中是否已下载
    if let Some(path) = get_local_ffmpeg_path(app) {
        if path.exists() {
            return FfmpegStatus {
                available: true,
                path: Some(path.to_string_lossy().to_string()),
                source: "local".to_string(),
                downloading: false,
            };
        }
    }

    // 2. 检查系统 PATH 中是否有 ffmpeg
    if let Some(path) = find_system_ffmpeg() {
        return FfmpegStatus {
            available: true,
            path: Some(path.to_string_lossy().to_string()),
            source: "system".to_string(),
            downloading: false,
        };
    }

    // 3. 不可用
    let downloading = *DOWNLOAD_LOCK.lock().await;
    FfmpegStatus {
        available: false,
        path: None,
        source: "none".to_string(),
        downloading,
    }
}

/// 获取可用的 ffmpeg 路径，优先使用本地下载的版本
pub async fn ensure_ffmpeg(app: &AppHandle) -> Result<PathBuf, String> {
    // 优先使用本地下载的
    if let Some(path) = get_local_ffmpeg_path(app) {
        if path.exists() {
            return Ok(path);
        }
    }
    // 其次使用系统的
    if let Some(path) = find_system_ffmpeg() {
        return Ok(path);
    }
    Err("FFmpeg 未安装。请在视频流模块中点击「下载 FFmpeg」按钮。".to_string())
}

/// 获取 ffprobe 路径（与 ffmpeg 同目录）
pub async fn get_ffprobe_path(app: &AppHandle) -> Result<PathBuf, String> {
    let ffmpeg = ensure_ffmpeg(app).await?;
    let dir = ffmpeg.parent().ok_or("Invalid ffmpeg path")?;
    let ffprobe = if cfg!(windows) {
        dir.join("ffprobe.exe")
    } else {
        dir.join("ffprobe")
    };
    if ffprobe.exists() {
        Ok(ffprobe)
    } else {
        // 有些发行版中 ffprobe 可能在 PATH 中
        find_system_binary("ffprobe").ok_or_else(|| "ffprobe 未找到".to_string())
    }
}

/// 下载 FFmpeg 到应用数据目录
pub async fn download(app: &AppHandle) -> Result<PathBuf, String> {
    // 获取下载锁
    let mut lock = DOWNLOAD_LOCK.lock().await;
    if *lock {
        return Err("FFmpeg 正在下载中，请勿重复操作".to_string());
    }
    *lock = true;
    drop(lock);

    let result = do_download(app).await;

    // 释放锁
    *DOWNLOAD_LOCK.lock().await = false;

    result
}

/// 实际下载逻辑
async fn do_download(app: &AppHandle) -> Result<PathBuf, String> {
    let install_dir = get_ffmpeg_dir(app).ok_or("无法获取应用数据目录")?;
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let (url, archive_name) = get_download_url();
    log::info!("Downloading FFmpeg from: {}", url);

    emit_progress(app, 0.0, 0, 0, "正在连接下载服务器...");

    // 下载文件
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP 客户端错误: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败，HTTP 状态码: {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let archive_path = install_dir.join(&archive_name);

    // 流式下载到文件
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&archive_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入失败: {}", e))?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            downloaded as f64 / total_size as f64
        } else {
            0.0
        };
        emit_progress(
            app,
            progress * 0.8,
            downloaded,
            total_size,
            "正在下载 FFmpeg...",
        );
    }
    file.flush()
        .await
        .map_err(|e| format!("刷新文件失败: {}", e))?;
    drop(file);

    emit_progress(app, 0.85, downloaded, total_size, "正在解压...");

    // 解压
    extract_archive(&archive_path, &install_dir)?;

    // 清理压缩包
    let _ = std::fs::remove_file(&archive_path);

    emit_progress(app, 1.0, downloaded, total_size, "FFmpeg 安装完成");

    // 验证安装
    let ffmpeg_path = get_local_ffmpeg_path(app).ok_or("解压后未找到 ffmpeg 可执行文件")?;

    if !ffmpeg_path.exists() {
        return Err(format!(
            "解压完成但未找到 ffmpeg: {}",
            ffmpeg_path.display()
        ));
    }

    // macOS: 设置可执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&ffmpeg_path, std::fs::Permissions::from_mode(0o755));
        // ffprobe 也设置权限
        let ffprobe = ffmpeg_path.parent().unwrap().join("ffprobe");
        if ffprobe.exists() {
            let _ = std::fs::set_permissions(&ffprobe, std::fs::Permissions::from_mode(0o755));
        }
    }

    log::info!("FFmpeg installed to: {}", ffmpeg_path.display());
    Ok(ffmpeg_path)
}

/// 获取下载 URL 和压缩包名称
fn get_download_url() -> (String, String) {
    if cfg!(target_os = "windows") {
        // GyanD essentials build (Windows, static, ~85MB)
        let name = format!("ffmpeg-{}-essentials_build.zip", FFMPEG_VERSION);
        let url = format!(
            "https://github.com/GyanD/codexffmpeg/releases/download/{}/{}",
            FFMPEG_VERSION, name
        );
        (url, name)
    } else {
        // macOS: evermeet.cx static build
        // Fallback: use GitHub releases with universal build
        let name = "ffmpeg.zip".to_string();
        let url = "https://evermeet.cx/ffmpeg/getrelease/zip".to_string();
        (url, name)
    }
}

/// 解压下载的压缩包
fn extract_archive(
    archive_path: &std::path::Path,
    install_dir: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("打开压缩包失败: {}", e))?;

    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("读取 ZIP 格式失败: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败: {}", e))?;

        let name = match entry.enclosed_name() {
            Some(name) => name.to_owned(),
            None => continue,
        };

        // Windows GyanD builds have a top-level directory like "ffmpeg-7.1.1-essentials_build/"
        // We want to flatten: extract bin/ffmpeg.exe -> install_dir/ffmpeg.exe
        let name_str = name.to_string_lossy().to_string();

        // Only extract executables we need
        let is_target = if cfg!(windows) {
            name_str.ends_with("bin/ffmpeg.exe")
                || name_str.ends_with("bin/ffprobe.exe")
                || name_str.ends_with("bin\\ffmpeg.exe")
                || name_str.ends_with("bin\\ffprobe.exe")
        } else {
            name_str == "ffmpeg"
                || name_str.ends_with("/ffmpeg")
                || name_str == "ffprobe"
                || name_str.ends_with("/ffprobe")
        };

        if !is_target || entry.is_dir() {
            continue;
        }

        let file_name = std::path::Path::new(&name_str)
            .file_name()
            .unwrap()
            .to_owned();
        let output_path = install_dir.join(&file_name);

        let mut outfile =
            std::fs::File::create(&output_path).map_err(|e| format!("创建文件失败: {}", e))?;
        std::io::copy(&mut entry, &mut outfile).map_err(|e| format!("解压文件失败: {}", e))?;

        log::info!("Extracted: {} -> {}", name_str, output_path.display());
    }

    Ok(())
}

/// 获取 FFmpeg 安装目录
fn get_ffmpeg_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("ffmpeg"))
}

/// 获取本地下载的 ffmpeg 可执行文件完整路径
fn get_local_ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = get_ffmpeg_dir(app)?;
    let exe = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    Some(dir.join(exe))
}

/// 在系统 PATH 中查找 ffmpeg
fn find_system_ffmpeg() -> Option<PathBuf> {
    find_system_binary("ffmpeg")
}

/// 在系统 PATH 中查找指定二进制
fn find_system_binary(name: &str) -> Option<PathBuf> {
    let cmd_name = if cfg!(windows) {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let full = dir.join(&cmd_name);
            if full.is_file() { Some(full) } else { None }
        })
    })
}

/// 推送下载进度事件
fn emit_progress(app: &AppHandle, progress: f64, downloaded: u64, total: u64, stage: &str) {
    let _ = app.emit(
        "ffmpeg-download-progress",
        DownloadProgress {
            progress,
            downloaded,
            total,
            stage: stage.to_string(),
        },
    );
}
