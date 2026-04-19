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

export type AccentColor = 'indigo' | 'cyan' | 'emerald' | 'violet';

export interface AppSettings {
  // ── 通用 ──
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en';
  fontSize: 12 | 13 | 14 | 15 | 16;
  fontFamily: string; // 内置字体 ID 或插件贡献的 fontId
  accentColor: AccentColor;

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
  rightSidebarWidth: number; // percentage
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
  // Default to system — respect OS preference on first launch (Linear default).
  // Existing users retain their persisted choice via the store's migration logic.
  theme: 'system',
  language: 'zh-CN',
  fontSize: 13,
  fontFamily: 'inter',
  accentColor: 'indigo',

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
  rightSidebarWidth: 22,
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
      version: 1,
      // Custom merge: deep-merge persisted `settings` onto current state's defaults so any
      // field added to `defaultSettings` after a user's last save still gets its default value
      // (instead of being `undefined` after rehydration). Without this, zustand persist does a
      // shallow merge that replaces the entire `settings` object, losing any newly-introduced
      // fields. This was the root cause of the proxy toggle showing as ON for upgraded users —
      // their persisted state had no `proxyEnabled`, leaving it `undefined`, which made Base UI's
      // Switch lock into uncontrolled mode on first render and behave inconsistently.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<SettingsStore> & {
          settings?: Partial<AppSettings>;
        };
        return {
          ...currentState,
          ...persisted,
          settings: {
            ...currentState.settings,
            ...(persisted.settings ?? {}),
          },
        };
      },
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
    }
  )
);
