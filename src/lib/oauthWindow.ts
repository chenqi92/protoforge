// OAuth 2.0 Authorization Code 弹窗
// 通过 Rust 后端创建 WebviewWindow + on_navigation 拦截 redirect_uri

import { invoke } from "@tauri-apps/api/core";

export interface OAuthWindowConfig {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface OAuthResult {
  code: string;
  state?: string;
}

/**
 * 打开 OAuth 授权弹窗，返回授权码。
 *
 * 通过 Rust 命令 `open_oauth_window` 实现：
 * 1. Rust 侧构建 OAuth 授权 URL 并创建 WebviewWindow
 * 2. 通过 `on_navigation` 事件拦截 redirect_uri
 * 3. 自动提取 code 参数并返回
 * 4. 窗口被用户手动关闭时返回错误
 */
export async function openOAuthWindow(config: OAuthWindowConfig): Promise<OAuthResult> {
  const { authUrl, clientId, redirectUri, scope } = config;

  // 生成随机 state 防 CSRF
  const state = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const result = await invoke<{ code: string; state: string | null }>("open_oauth_window", {
    req: {
      authUrl,
      clientId,
      redirectUri,
      scope: scope || null,
      state,
    },
  });

  return {
    code: result.code,
    state: result.state ?? undefined,
  };
}
