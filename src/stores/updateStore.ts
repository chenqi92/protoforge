// ProtoForge Update Store — 集中管理应用更新状态
// 供 StatusBar、SettingsModal、UpdateChecker 共享
// 策略：优先使用 Tauri updater，失败时 fallback 到 GitHub API 比对版本号

import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

export interface UpdateInfo {
  version: string;
  date: string;
  body: string;
  /** 如果为 true，说明此次检测是通过 GitHub API fallback 发现的（不支持自动安装） */
  isFallback?: boolean;
  /** GitHub Release 页面 URL（仅 fallback 时提供） */
  releaseUrl?: string;
}

interface UpdateStore {
  currentVersion: string;
  latestVersion: string | null;
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: number;
  error: string | null;
  dismissed: boolean;
  lastCheckTime: number | null;

  // Actions
  initVersion: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismiss: () => void;
  resetDismiss: () => void;
}

const GITHUB_REPO = 'chenqi92/protoforge';

/** 语义化版本比较：a > b 返回正数，a < b 返回负数，相等返回 0 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
  currentVersion: '',
  latestVersion: null,
  status: 'idle',
  updateInfo: null,
  progress: 0,
  error: null,
  dismissed: false,
  lastCheckTime: null,

  initVersion: async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const version = await getVersion();
      set({ currentVersion: version });
    } catch {
      // Fallback: 无法获取版本时保持空字符串
    }
  },

  checkForUpdate: async () => {
    const { status, currentVersion } = get();
    if (status === 'checking' || status === 'downloading') return;

    set({ status: 'checking', error: null, dismissed: false });

    // ── 策略 1: Tauri 原生 updater ──
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        set({
          updateInfo: {
            version: update.version,
            date: update.date || '',
            body: update.body || '',
            isFallback: false,
          },
          latestVersion: update.version,
          status: 'available',
          lastCheckTime: Date.now(),
        });
        return; // Tauri updater 成功检测到更新
      }
      // update === null → Tauri 认为已是最新版，但可能是 platforms 为空导致的误判
      // 继续执行 fallback
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 开发模式 / 未配置 / 非 Tauri 环境 — 继续 fallback
      if (
        msg.includes('not configured') ||
        msg.includes('No such plugin') ||
        msg.includes('not found') ||
        msg.includes('fallback platforms') ||
        msg.includes('invoke') ||
        msg.includes('__TAURI__')
      ) {
        // 静默继续 fallback
      } else {
        // 真正的网络/解析错误，继续 fallback
        console.warn('Tauri updater failed, trying GitHub API fallback:', msg);
      }
    }

    // ── 策略 2: GitHub API Fallback ──
    if (!currentVersion) {
      set({ status: 'idle' });
      return;
    }

    try {
      const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (!resp.ok) throw new Error(`GitHub API: ${resp.status}`);

      const data = await resp.json();
      const remoteVersion = (data.tag_name || '').replace(/^v/, '');

      if (remoteVersion && compareVersions(remoteVersion, currentVersion) > 0) {
        set({
          updateInfo: {
            version: remoteVersion,
            date: data.published_at || '',
            body: data.body || '',
            isFallback: true,
            releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
          },
          latestVersion: remoteVersion,
          status: 'available',
          lastCheckTime: Date.now(),
        });
      } else {
        set({ status: 'up-to-date', latestVersion: null, lastCheckTime: Date.now() });
      }
    } catch (err) {
      console.warn('GitHub API fallback also failed:', err);
      set({ status: 'up-to-date', lastCheckTime: Date.now() });
    }
  },

  installUpdate: async () => {
    const { updateInfo } = get();

    // Fallback 模式：打开浏览器到 Release 页面
    if (updateInfo?.isFallback && updateInfo.releaseUrl) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(updateInfo.releaseUrl);
      } catch {
        window.open(updateInfo.releaseUrl, '_blank');
      }
      return;
    }

    // Tauri 原生安装
    set({ status: 'downloading', progress: 0 });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = (event.data as { contentLength?: number })?.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += (event.data as { chunkLength: number }).chunkLength;
          if (contentLength > 0) {
            set({ progress: Math.round((downloaded / contentLength) * 100) });
          }
        } else if (event.event === 'Finished') {
          set({ status: 'ready' });
        }
      });

      set({ status: 'ready' });
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : String(err),
        status: 'error',
      });
    }
  },

  restartApp: async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      // fallback
    }
  },

  dismiss: () => set({ dismissed: true }),
  resetDismiss: () => set({ dismissed: false }),
}));
