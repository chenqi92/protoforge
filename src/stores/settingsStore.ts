// ProtoForge Settings Store — Zustand + localStorage persistence

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppSettings {
  // ── 通用 ──
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en';
  fontSize: 12 | 13 | 14 | 15 | 16;
  fontFamily: 'mono' | 'system';

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
  fontFamily: 'mono',

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
    }
  )
);
