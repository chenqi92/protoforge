import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';

// Safe storage adapter: falls back to in-memory storage if localStorage is blocked
// (e.g. by WebView2 Tracking Prevention)
const memoryStore = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return memoryStore.get(name) ?? null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      memoryStore.set(name, value);
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      memoryStore.delete(name);
    }
  },
};

export interface AppSettings {
  // ── 通用 ──
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en';
  fontSize: 12 | 13 | 14 | 15 | 16;
  fontFamily: string; // 内置字体 ID 或插件贡献的 fontId

  // ── 请求默认值 ──
  defaultTimeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  sslVerify: boolean;
  autoSaveCookies: boolean;

  // ── 代理 ──
  proxyEnabled: boolean;
  proxyType: 'http' | 'socks5';
  proxyHost: string;
  proxyPort: number;
  proxyAuth: boolean;
  proxyUsername: string;
  proxyPassword: string;

  // ── 数据 ──
  maxHistoryCount: number;
  autoSaveInterval: number; // seconds, 0 = disabled

  // ── 窗口状态记忆 ──
  sidebarWidth: number;    // percentage
  windowWidth: number;
  windowHeight: number;

  // ── 新建标签页 ──
  defaultNewProtocol: string; // 上次选择的协议类型
}

interface SettingsStore {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

const defaultSettings: AppSettings = {
  theme: 'light',
  language: 'zh-CN',
  fontSize: 13,
  fontFamily: 'inter',

  defaultTimeoutMs: 30000,
  followRedirects: true,
  maxRedirects: 5,
  sslVerify: true,
  autoSaveCookies: false,

  proxyEnabled: false,
  proxyType: 'http',
  proxyHost: '',
  proxyPort: 8080,
  proxyAuth: false,
  proxyUsername: '',
  proxyPassword: '',

  maxHistoryCount: 200,
  autoSaveInterval: 0,

  sidebarWidth: 44,
  windowWidth: 1280,
  windowHeight: 800,

  defaultNewProtocol: 'http',
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: { ...defaultSettings },
      update: (key, value) =>
        set((s) => ({
          settings: { ...s.settings, [key]: value },
        })),
      reset: () => set({ settings: { ...defaultSettings } }),
    }),
    {
      name: 'protoforge-settings',
      storage: createJSONStorage(() => safeStorage),
      migrate: (persistedState: unknown) => {
        const state = persistedState as { settings?: Record<string, unknown> };
        if (state?.settings) {
          // 迁移旧的 fontFamily: 'mono' 等无效值回退到 inter
          const ff = state.settings.fontFamily;
          if (ff === 'mono' || typeof ff !== 'string' || ff === '') {
            state.settings.fontFamily = 'inter';
          }
        }
        return state as unknown as SettingsStore;
      },
      version: 1,
    }
  )
);
