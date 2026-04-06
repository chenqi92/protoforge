// 工具箱模块 — 图片缩放、图标生成、批量重命名

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct ToolboxBatchResult {
    pub success_count: usize,
    pub errors: Vec<String>,
}

#[derive(Deserialize)]
pub struct ToolboxIconPlatforms {
    pub ios: bool,
    pub macos: bool,
    pub windows: bool,
    pub favicon: bool,
}

#[derive(Serialize)]
pub struct ToolboxFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 将图片缩放到指定尺寸列表
#[tauri::command]
pub async fn toolbox_resize_screenshots(
    source_paths: Vec<String>,
    target_sizes: Vec<(u32, u32)>,
    output_dir: String,
) -> Result<ToolboxBatchResult, String> {
    tokio::task::spawn_blocking(move || {
        let out = PathBuf::from(&output_dir);
        std::fs::create_dir_all(&out).map_err(|e| format!("创建输出目录失败: {e}"))?;

        let mut success_count = 0usize;
        let mut errors = Vec::new();

        for src_path in &source_paths {
            let img = match image::open(src_path) {
                Ok(img) => img,
                Err(e) => {
                    errors.push(format!("{}: {e}", src_path));
                    continue;
                }
            };

            let stem = Path::new(src_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image");

            for &(w, h) in &target_sizes {
                let resized = image::imageops::resize(
                    &img,
                    w,
                    h,
                    image::imageops::FilterType::Lanczos3,
                );

                let filename = format!("{stem}_{w}x{h}.png");
                let dest = out.join(&filename);

                match resized.save(&dest) {
                    Ok(_) => success_count += 1,
                    Err(e) => errors.push(format!("{filename}: {e}")),
                }
            }
        }

        Ok(ToolboxBatchResult {
            success_count,
            errors,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// iOS 图标尺寸列表
const IOS_SIZES: &[u32] = &[20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];
/// macOS 图标尺寸列表
const MACOS_SIZES: &[u32] = &[16, 32, 64, 128, 256, 512, 1024];
/// Windows ICO 包含的尺寸
const WINDOWS_ICO_SIZES: &[u32] = &[16, 32, 48, 256];
/// Favicon PNG 尺寸
const FAVICON_SIZES: &[u32] = &[16, 32, 48, 64, 128, 256];
/// Favicon ICO 包含的尺寸
const FAVICON_ICO_SIZES: &[u32] = &[16, 32, 48];

/// 生成多平台图标
#[tauri::command]
pub async fn toolbox_generate_icons(
    source_path: String,
    platforms: ToolboxIconPlatforms,
    output_dir: String,
) -> Result<ToolboxBatchResult, String> {
    tokio::task::spawn_blocking(move || {
        let img = image::open(&source_path)
            .map_err(|e| format!("打开图片失败: {e}"))?;

        let out = PathBuf::from(&output_dir);
        let mut success_count = 0usize;
        let mut errors = Vec::new();

        // iOS
        if platforms.ios {
            let dir = out.join("ios");
            std::fs::create_dir_all(&dir).ok();
            for &size in IOS_SIZES {
                let resized = image::imageops::resize(
                    &img,
                    size,
                    size,
                    image::imageops::FilterType::Lanczos3,
                );
                let dest = dir.join(format!("icon_{size}x{size}.png"));
                match resized.save(&dest) {
                    Ok(_) => success_count += 1,
                    Err(e) => errors.push(format!("ios/icon_{size}x{size}.png: {e}")),
                }
            }
        }

        // macOS
        if platforms.macos {
            let dir = out.join("macos");
            std::fs::create_dir_all(&dir).ok();
            for &size in MACOS_SIZES {
                let resized = image::imageops::resize(
                    &img,
                    size,
                    size,
                    image::imageops::FilterType::Lanczos3,
                );
                let dest = dir.join(format!("icon_{size}x{size}.png"));
                match resized.save(&dest) {
                    Ok(_) => success_count += 1,
                    Err(e) => errors.push(format!("macos/icon_{size}x{size}.png: {e}")),
                }
            }
        }

        // Windows ICO
        if platforms.windows {
            let dir = out.join("windows");
            std::fs::create_dir_all(&dir).ok();
            match create_ico(&img, WINDOWS_ICO_SIZES, &dir.join("app.ico")) {
                Ok(count) => success_count += count,
                Err(e) => errors.push(format!("windows/app.ico: {e}")),
            }
        }

        // Favicon
        if platforms.favicon {
            let dir = out.join("favicon");
            std::fs::create_dir_all(&dir).ok();
            for &size in FAVICON_SIZES {
                let resized = image::imageops::resize(
                    &img,
                    size,
                    size,
                    image::imageops::FilterType::Lanczos3,
                );
                let dest = dir.join(format!("favicon-{size}x{size}.png"));
                match resized.save(&dest) {
                    Ok(_) => success_count += 1,
                    Err(e) => errors.push(format!("favicon/favicon-{size}x{size}.png: {e}")),
                }
            }
            match create_ico(&img, FAVICON_ICO_SIZES, &dir.join("favicon.ico")) {
                Ok(count) => success_count += count,
                Err(e) => errors.push(format!("favicon/favicon.ico: {e}")),
            }
        }

        Ok(ToolboxBatchResult {
            success_count,
            errors,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 创建 ICO 文件，包含多个尺寸
fn create_ico(
    img: &image::DynamicImage,
    sizes: &[u32],
    dest: &Path,
) -> Result<usize, String> {
    use image::codecs::ico::IcoEncoder;
    use std::io::BufWriter;

    let file = std::fs::File::create(dest)
        .map_err(|e| format!("创建 ICO 文件失败: {e}"))?;
    let writer = BufWriter::new(file);

    // 先生成所有尺寸的 RGBA 数据
    let mut frames: Vec<image::RgbaImage> = Vec::new();
    for &size in sizes {
        let resized = image::imageops::resize(
            img,
            size,
            size,
            image::imageops::FilterType::Lanczos3,
        );
        frames.push(resized);
    }

    let encoder = IcoEncoder::new(writer);
    let ico_images: Vec<_> = frames
        .iter()
        .map(|frame| {
            image::codecs::ico::IcoFrame::as_png(
                frame.as_raw(),
                frame.width(),
                frame.height(),
                image::ColorType::Rgba8.into(),
            )
            .expect("ICO frame encoding failed")
        })
        .collect();

    encoder
        .encode_images(&ico_images)
        .map_err(|e| format!("ICO 编码失败: {e}"))?;

    Ok(1) // ICO 文件算 1 个成功
}

/// 列出目录中的文件和文件夹
#[tauri::command]
pub async fn toolbox_list_directory(path: String) -> Result<Vec<ToolboxFileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        let mut entries = Vec::new();

        let read_dir = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取目录失败: {e}"))?;

        for entry in read_dir {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("读取目录条目失败: {e}");
                    continue;
                }
            };

            let name = entry.file_name().to_string_lossy().to_string();
            // 跳过隐藏文件
            if name.starts_with('.') {
                continue;
            }

            let metadata = entry.metadata().ok();
            let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

            entries.push(ToolboxFileEntry { name, is_dir, size });
        }

        // 文件夹在前，文件在后，各自按名称排序
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

/// 批量重命名文件/文件夹
#[tauri::command]
pub async fn toolbox_batch_rename(
    directory: String,
    renames: Vec<(String, String)>,
) -> Result<ToolboxBatchResult, String> {
    tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&directory);
        let mut success_count = 0usize;
        let mut errors = Vec::new();

        // 先检查目标名是否有冲突
        let mut targets: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (_, new_name) in &renames {
            if !targets.insert(new_name.clone()) {
                return Err(format!("目标名称冲突: {new_name}"));
            }
        }

        // 检查目标名是否与已有文件冲突（排除自身重命名的情况）
        let rename_sources: std::collections::HashSet<&str> =
            renames.iter().map(|(old, _)| old.as_str()).collect();
        for (_, new_name) in &renames {
            let target_path = dir.join(new_name);
            if target_path.exists() && !rename_sources.contains(new_name.as_str()) {
                return Err(format!("目标已存在: {new_name}"));
            }
        }

        // 使用临时名称做两阶段重命名，避免循环冲突
        let mut temp_names: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new();
        for (old_name, new_name) in &renames {
            if old_name == new_name {
                continue;
            }
            let old_path = dir.join(old_name);
            let new_path = dir.join(new_name);
            let temp_path = dir.join(format!(".toolbox_rename_tmp_{}", uuid::Uuid::new_v4()));
            temp_names.push((old_path, temp_path, new_path));
        }

        // 第一阶段：重命名为临时名称
        for (old_path, temp_path, _) in &temp_names {
            if let Err(e) = std::fs::rename(old_path, temp_path) {
                errors.push(format!(
                    "{}: {e}",
                    old_path.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
        }

        // 第二阶段：从临时名称重命名为最终名称
        for (_, temp_path, new_path) in &temp_names {
            match std::fs::rename(temp_path, new_path) {
                Ok(_) => success_count += 1,
                Err(e) => errors.push(format!(
                    "{}: {e}",
                    new_path.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }

        Ok(ToolboxBatchResult {
            success_count,
            errors,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}
