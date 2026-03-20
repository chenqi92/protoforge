// macOS 窗口圆角插件
// 现在使用原生窗口装饰 (decorations: true + titleBarStyle: Overlay)
// 此模块保留以兼容现有调用，但不再需要运行时修改窗口样式

use tauri::{AppHandle, Runtime, WebviewWindow};

/// No-op: 原生窗口已自带圆角和交通灯按钮，无需运行时修改。
/// 保留此命令以兼容前端调用，避免 invoke 报错。
#[tauri::command]
pub fn enable_rounded_corners<R: Runtime>(
    _app: AppHandle<R>,
    _window: WebviewWindow<R>,
    _corner_radius: Option<f64>,
) -> Result<(), String> {
    Ok(())
}
