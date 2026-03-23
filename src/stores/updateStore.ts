// ProtoForge Update Store — 集中管理应用更新状态
// 供 StatusBar、SettingsModal、UpdateChecker 共享

import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

export interface UpdateInfo {
  version: string;
  date: string;
  body: string;
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
    const { status } = get();
    if (status === 'checking' || status === 'downloading') return;

    set({ status: 'checking', error: null, dismissed: false });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        set({
          updateInfo: {
            version: update.version,
            date: update.date || '',
            body: update.body || '',
          },
          latestVersion: update.version,
          status: 'available',
          lastCheckTime: Date.now(),
        });
      } else {
        set({ status: 'up-to-date', latestVersion: null, lastCheckTime: Date.now() });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 开发模式下 updater 未配置 / 非 Tauri 环境 / platforms 为空 — 静默忽略
      if (
        msg.includes('not configured') ||
        msg.includes('No such plugin') ||
        msg.includes('not found') ||
        msg.includes('fallback platforms') ||
        msg.includes('invoke') ||
        msg.includes('__TAURI__')
      ) {
        set({ status: 'idle' });
        return;
      }
      set({ error: msg, status: 'error' });
    }
  },

  installUpdate: async () => {
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
