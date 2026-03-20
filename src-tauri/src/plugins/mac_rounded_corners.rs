#![allow(deprecated)]
use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSWindow, NSWindowStyleMask, NSView, NSWindowTitleVisibility},
    base::id,
};

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

/// Enables modern window style with rounded corners and shadow (macOS only).
/// Uses only public APIs — App Store compatible.
/// Hides native traffic lights since we use a custom titlebar.
#[tauri::command]
pub fn enable_rounded_corners<R: Runtime>(
    _app: AppHandle<R>,
    window: WebviewWindow<R>,
    corner_radius: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let radius = corner_radius.unwrap_or(10.0);

        window
            .with_webview(move |webview| {
                #[cfg(target_os = "macos")]
                unsafe {
                    let ns_window = webview.ns_window() as id;

                    let mut style_mask = ns_window.styleMask();

                    // Add styles that enable native rounded corners
                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    style_mask |= NSWindowStyleMask::NSTitledWindowMask;
                    style_mask |= NSWindowStyleMask::NSClosableWindowMask;
                    style_mask |= NSWindowStyleMask::NSMiniaturizableWindowMask;
                    style_mask |= NSWindowStyleMask::NSResizableWindowMask;

                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
                    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                    ns_window.setHasShadow_(cocoa::base::YES);
                    ns_window.setOpaque_(cocoa::base::NO);

                    // Set corner radius via layer
                    let content_view = ns_window.contentView();
                    content_view.setWantsLayer(cocoa::base::YES);

                    let layer: id = msg_send![content_view, layer];
                    if !layer.is_null() {
                        let _: () = msg_send![layer, setCornerRadius: radius];
                        let _: () = msg_send![layer, setMasksToBounds: cocoa::base::YES];
                    }

                    // Hide native traffic lights (we use custom window controls)
                    let close_button: id = msg_send![ns_window, standardWindowButton: 0u64];
                    let miniaturize_button: id = msg_send![ns_window, standardWindowButton: 1u64];
                    let zoom_button: id = msg_send![ns_window, standardWindowButton: 2u64];

                    if !close_button.is_null() {
                        let _: () = msg_send![close_button, setHidden: cocoa::base::YES];
                    }
                    if !miniaturize_button.is_null() {
                        let _: () = msg_send![miniaturize_button, setHidden: cocoa::base::YES];
                    }
                    if !zoom_button.is_null() {
                        let _: () = msg_send![zoom_button, setHidden: cocoa::base::YES];
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
