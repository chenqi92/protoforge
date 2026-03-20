// 在应用启动时调用原生 macOS API 启用窗口圆角
// 使用公共 API（App Store 兼容），非 macOS 平台为空操作

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export function useRoundedCorners(cornerRadius: number = 10) {
  useEffect(() => {
    async function enableRoundedCorners() {
      try {
        const window = getCurrentWebviewWindow();
        await invoke("enable_rounded_corners", {
          window,
          cornerRadius,
        });
      } catch (error) {
        // 非 macOS 平台静默失败
        console.debug("Rounded corners not available:", error);
      }
    }

    enableRoundedCorners();
  }, [cornerRadius]);
}
