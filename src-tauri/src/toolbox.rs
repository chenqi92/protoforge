// 工具箱模块 — 图片缩放、图标生成、图片压缩、图片合并、批量重命名

use image::Rgba;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct ToolboxBatchResult {
    pub success_count: usize,
    pub errors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxCompressOptions {
    /// 输出格式: "keep" | "png" | "jpeg"
    pub format: String,
    /// JPEG 质量 1-100
    pub jpeg_quality: u8,
    /// PNG 压缩级别: "fast" | "default" | "best"
    pub png_compression: String,
    /// 文件名后缀（追加在 stem 后），例如 "_compressed"，可为空
    pub suffix: String,
    /// 当输出文件已存在时是否覆盖
    pub overwrite: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxCompressItem {
    pub source: String,
    pub output: String,
    pub original_size: u64,
    pub compressed_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxCompressResult {
    pub success_count: usize,
    pub errors: Vec<String>,
    pub items: Vec<ToolboxCompressItem>,
    pub total_original: u64,
    pub total_compressed: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxMergeItem {
    pub source: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub rotation: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxMergeOptions {
    pub canvas_w: u32,
    pub canvas_h: u32,
    pub background: String,
    pub format: String,
    pub jpeg_quality: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxMergeResult {
    pub output: String,
    pub size: u64,
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

/// 批量压缩图片（PNG / JPEG 重编码）
#[tauri::command]
pub async fn toolbox_compress_images(
    source_paths: Vec<String>,
    output_dir: String,
    options: ToolboxCompressOptions,
) -> Result<ToolboxCompressResult, String> {
    tokio::task::spawn_blocking(move || {
        let out = PathBuf::from(&output_dir);
        std::fs::create_dir_all(&out).map_err(|e| format!("创建输出目录失败: {e}"))?;

        let mut success_count = 0usize;
        let mut errors: Vec<String> = Vec::new();
        let mut items: Vec<ToolboxCompressItem> = Vec::new();
        let mut total_original: u64 = 0;
        let mut total_compressed: u64 = 0;

        for src_path in &source_paths {
            let src = Path::new(src_path);
            let stem = src
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image")
                .to_string();
            let original_ext = src
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();

            // 决定输出格式
            let target_format = match options.format.as_str() {
                "png" => "png",
                "jpeg" | "jpg" => "jpeg",
                _ => match original_ext.as_str() {
                    "jpg" | "jpeg" => "jpeg",
                    _ => "png",
                },
            };
            let target_ext = if target_format == "jpeg" { "jpg" } else { "png" };

            let original_size = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);

            let img = match image::open(src) {
                Ok(img) => img,
                Err(e) => {
                    errors.push(format!("{}: {e}", src.display()));
                    continue;
                }
            };

            let dest_name = format!("{stem}{}.{target_ext}", options.suffix);
            let dest = out.join(&dest_name);
            if dest.exists() && !options.overwrite {
                errors.push(format!("{dest_name}: 目标已存在（未启用覆盖）"));
                continue;
            }

            let encode_result = match target_format {
                "jpeg" => encode_jpeg(&img, &dest, options.jpeg_quality),
                _ => encode_png(&img, &dest, &options.png_compression),
            };

            match encode_result {
                Ok(()) => {
                    let compressed_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
                    success_count += 1;
                    total_original += original_size;
                    total_compressed += compressed_size;
                    items.push(ToolboxCompressItem {
                        source: src_path.clone(),
                        output: dest.to_string_lossy().to_string(),
                        original_size,
                        compressed_size,
                    });
                }
                Err(e) => errors.push(format!("{dest_name}: {e}")),
            }
        }

        Ok(ToolboxCompressResult {
            success_count,
            errors,
            items,
            total_original,
            total_compressed,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
}

fn encode_jpeg(img: &image::DynamicImage, dest: &Path, quality: u8) -> Result<(), String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;

    let q = quality.clamp(1, 100);
    let file = std::fs::File::create(dest).map_err(|e| format!("创建文件失败: {e}"))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, q);

    // JPEG 不支持 alpha，需先合成到白底
    let rgb = img.to_rgb8();
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG 编码失败: {e}"))?;
    Ok(())
}

fn encode_png(img: &image::DynamicImage, dest: &Path, level: &str) -> Result<(), String> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    use std::io::BufWriter;

    let compression = match level {
        "fast" => CompressionType::Fast,
        "best" => CompressionType::Best,
        _ => CompressionType::Default,
    };

    let file = std::fs::File::create(dest).map_err(|e| format!("创建文件失败: {e}"))?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(writer, compression, FilterType::Adaptive);

    let rgba = img.to_rgba8();
    encoder
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("PNG 编码失败: {e}"))?;
    Ok(())
}

fn parse_hex_color(s: &str) -> Rgba<u8> {
    if s.eq_ignore_ascii_case("transparent") {
        return Rgba([0, 0, 0, 0]);
    }
    let s = s.trim_start_matches('#');
    if s.len() == 8 {
        let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(255);
        let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(255);
        let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(255);
        let a = u8::from_str_radix(&s[6..8], 16).unwrap_or(255);
        return Rgba([r, g, b, a]);
    }
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(255);
        let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(255);
        let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(255);
        return Rgba([r, g, b, 255]);
    }
    Rgba([255, 255, 255, 255])
}

/// 将 RGBA 画布编码为 JPEG 字节（用于 .jpg 直存或嵌入 PDF）
fn encode_canvas_as_jpeg(canvas: &image::RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    use image::codecs::jpeg::JpegEncoder;
    let rgb = image::DynamicImage::ImageRgba8(canvas.clone()).to_rgb8();
    let mut buf: Vec<u8> = Vec::with_capacity((rgb.width() * rgb.height()) as usize);
    {
        let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| format!("JPEG 编码失败: {e}"))?;
    }
    Ok(buf)
}

/// 构建一个最小化单页 PDF（PDF 1.4），将给定 JPEG 作为 DCTDecode 图像 XObject 嵌入。
/// 页面尺寸 = 图像像素尺寸（1 px = 1 pt，约 72 DPI 显示）。
fn build_pdf_with_jpeg(jpeg: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::with_capacity(jpeg.len() + 1024);
    let mut offsets: Vec<usize> = Vec::with_capacity(5);

    // 文件头（含二进制标记字节，便于识别为二进制 PDF）
    buf.extend_from_slice(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

    // 1: Catalog
    offsets.push(buf.len());
    buf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    // 2: Pages
    offsets.push(buf.len());
    buf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n");

    // 3: Page
    offsets.push(buf.len());
    let page = format!(
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n",
        w = width,
        h = height,
    );
    buf.extend_from_slice(page.as_bytes());

    // 4: Image XObject (DCTDecode = 直接嵌入 JPEG 字节流)
    offsets.push(buf.len());
    let img_header = format!(
        "4 0 obj\n<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len} >>\nstream\n",
        w = width,
        h = height,
        len = jpeg.len(),
    );
    buf.extend_from_slice(img_header.as_bytes());
    buf.extend_from_slice(jpeg);
    buf.extend_from_slice(b"\nendstream\nendobj\n");

    // 5: Page content stream — 将 Im0 拉伸到整页
    offsets.push(buf.len());
    let content = format!("q\n{w} 0 0 {h} 0 0 cm\n/Im0 Do\nQ\n", w = width, h = height);
    let content_obj = format!(
        "5 0 obj\n<< /Length {len} >>\nstream\n{content}endstream\nendobj\n",
        len = content.len(),
        content = content,
    );
    buf.extend_from_slice(content_obj.as_bytes());

    // xref
    let xref_offset = buf.len();
    buf.extend_from_slice(b"xref\n0 6\n");
    buf.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        buf.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
    }

    // trailer
    let trailer = format!(
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
        xref_offset
    );
    buf.extend_from_slice(trailer.as_bytes());

    buf
}

/// 将多张图片合并为一张（支持任意位置/尺寸/旋转）
#[tauri::command]
pub async fn toolbox_merge_images(
    items: Vec<ToolboxMergeItem>,
    options: ToolboxMergeOptions,
    output_path: String,
) -> Result<ToolboxMergeResult, String> {
    tokio::task::spawn_blocking(move || {
        if items.is_empty() {
            return Err("没有可合并的图片".to_string());
        }
        let canvas_w = options.canvas_w.max(1);
        let canvas_h = options.canvas_h.max(1);

        // JPEG / PDF 不支持透明，强制使用不透明背景（透明 → 白色）
        let mut bg = parse_hex_color(&options.background);
        let needs_opaque = options.format == "jpeg" || options.format == "pdf";
        if needs_opaque && bg.0[3] < 255 {
            bg = Rgba([255, 255, 255, 255]);
        }

        let mut canvas = image::RgbaImage::from_pixel(canvas_w, canvas_h, bg);

        for item in &items {
            let src = image::open(&item.source)
                .map_err(|e| format!("打开 {} 失败: {e}", item.source))?;

            let w = item.w.round().max(1.0) as u32;
            let h = item.h.round().max(1.0) as u32;
            let resized =
                image::imageops::resize(&src, w, h, image::imageops::FilterType::Lanczos3);

            let rotated = match item.rotation % 360 {
                90 => image::imageops::rotate90(&resized),
                180 => image::imageops::rotate180(&resized),
                270 => image::imageops::rotate270(&resized),
                _ => resized,
            };

            let x = item.x.round() as i64;
            let y = item.y.round() as i64;
            image::imageops::overlay(&mut canvas, &rotated, x, y);
        }

        let dest = PathBuf::from(&output_path);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        match options.format.as_str() {
            "jpeg" => {
                let q = options.jpeg_quality.clamp(1, 100);
                let jpeg = encode_canvas_as_jpeg(&canvas, q)?;
                std::fs::write(&dest, &jpeg).map_err(|e| format!("写入失败: {e}"))?;
            }
            "pdf" => {
                let q = options.jpeg_quality.clamp(1, 100);
                let jpeg = encode_canvas_as_jpeg(&canvas, q)?;
                let pdf = build_pdf_with_jpeg(&jpeg, canvas_w, canvas_h);
                std::fs::write(&dest, &pdf).map_err(|e| format!("写入失败: {e}"))?;
            }
            _ => {
                canvas
                    .save(&dest)
                    .map_err(|e| format!("保存失败: {e}"))?;
            }
        }

        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        Ok(ToolboxMergeResult {
            output: dest.to_string_lossy().to_string(),
            size,
        })
    })
    .await
    .map_err(|e| format!("任务执行失败: {e}"))?
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
