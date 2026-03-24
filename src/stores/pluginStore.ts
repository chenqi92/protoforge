import { create } from 'zustand';
import type { PluginManifest, PluginType, ProtocolParser } from '@/types/plugin';
import * as pluginService from '@/services/pluginService';

interface PluginStore {
  installedPlugins: PluginManifest[];
  availablePlugins: PluginManifest[];
  protocolParsers: ProtocolParser[];
  /** 首次加载中（无任何缓存数据时为 true） */
  loading: boolean;
  /** 后台静默刷新中 */
  refreshing: boolean;
  /** store 是否已完成首次初始化 */
  initialized: boolean;

  /** 仅在首次或数据为空时触发加载，已有缓存时直接复用 */
  initializeIfNeeded: () => Promise<void>;
  fetchInstalledPlugins: () => Promise<void>;
  fetchAvailablePlugins: () => Promise<void>;
  fetchProtocolParsers: () => Promise<void>;
  refreshRegistry: () => Promise<void>;
  installPlugin: (pluginId: string) => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<void>;
  updatePlugin: (pluginId: string) => Promise<void>;
  getInstalledByType: (type: PluginType) => PluginManifest[];
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  installedPlugins: [],
  availablePlugins: [],
  protocolParsers: [],
  loading: false,
  refreshing: false,
  initialized: false,

  initializeIfNeeded: async () => {
    const state = get();
    // 已初始化且有数据 → 跳过，直接复用缓存
    if (state.initialized && (state.installedPlugins.length > 0 || state.availablePlugins.length > 0)) {
      return;
    }
    // 首次加载 → 显示 loading
    set({ loading: true });
    try {
      const [installed, available] = await Promise.all([
        pluginService.listPlugins(),
        pluginService.listAvailablePlugins(),
      ]);
      set({
        installedPlugins: installed,
        availablePlugins: available,
        loading: false,
        initialized: true,
      });
    } catch (e) {
      console.error('Failed to initialize plugin store:', e);
      set({ loading: false, initialized: true });
    }
  },

  fetchInstalledPlugins: async () => {
    try {
      const plugins = await pluginService.listPlugins();
      set({ installedPlugins: plugins });
    } catch (e) {
      console.error('Failed to fetch installed plugins:', e);
    }
  },

  fetchAvailablePlugins: async () => {
    const state = get();
    // 已有数据 → 后台静默刷新，不显示 loading
    if (state.availablePlugins.length > 0) {
      set({ refreshing: true });
      try {
        const plugins = await pluginService.listAvailablePlugins();
        set({ availablePlugins: plugins, refreshing: false });
      } catch (e) {
        console.error('Failed to fetch available plugins:', e);
        set({ refreshing: false });
      }
    } else {
      // 无数据 → 显示 loading
      set({ loading: true });
      try {
        const plugins = await pluginService.listAvailablePlugins();
        set({ availablePlugins: plugins, loading: false });
      } catch (e) {
        console.error('Failed to fetch available plugins:', e);
        set({ loading: false });
      }
    }
  },

  fetchProtocolParsers: async () => {
    try {
      const parsers = await pluginService.getProtocolParsers();
      set({ protocolParsers: parsers });
    } catch (e) {
      console.error('Failed to fetch protocol parsers:', e);
    }
  },

  refreshRegistry: async () => {
    try {
      set({ loading: true });
      await pluginService.refreshRegistry();
      // Re-fetch available after refresh
      const plugins = await pluginService.listAvailablePlugins();
      set({ availablePlugins: plugins, loading: false });
    } catch (e) {
      console.error('Failed to refresh registry:', e);
      set({ loading: false });
    }
  },

  installPlugin: async (pluginId: string) => {
    try {
      const manifest = await pluginService.installPlugin(pluginId);
      set((s) => ({
        installedPlugins: [...s.installedPlugins, manifest],
        availablePlugins: s.availablePlugins.map((p) =>
          p.id === pluginId ? { ...p, installed: true, hasUpdate: false, latestVersion: undefined } : p
        ),
      }));
      // Refresh protocol parsers after install
      const parsers = await pluginService.getProtocolParsers();
      set({ protocolParsers: parsers });
    } catch (e) {
      console.error('Failed to install plugin:', e);
      throw e;
    }
  },

  uninstallPlugin: async (pluginId: string) => {
    try {
      await pluginService.uninstallPlugin(pluginId);
      set((s) => ({
        installedPlugins: s.installedPlugins.filter((p) => p.id !== pluginId),
        availablePlugins: s.availablePlugins.map((p) =>
          p.id === pluginId ? { ...p, installed: false, hasUpdate: false, latestVersion: undefined } : p
        ),
      }));
      // Refresh protocol parsers after uninstall
      const parsers = await pluginService.getProtocolParsers();
      set({ protocolParsers: parsers });
    } catch (e) {
      console.error('Failed to uninstall plugin:', e);
      throw e;
    }
  },

  /** 升级插件：卸载旧版本 → 安装新版本 → 刷新数据 */
  updatePlugin: async (pluginId: string) => {
    try {
      // 后端 install 已支持升级逻辑（自动清理旧版本）
      const manifest = await pluginService.installPlugin(pluginId);
      set((s) => ({
        installedPlugins: s.installedPlugins.map((p) =>
          p.id === pluginId ? manifest : p
        ),
        availablePlugins: s.availablePlugins.map((p) =>
          p.id === pluginId ? { ...p, version: manifest.version, installed: true, hasUpdate: false, latestVersion: undefined } : p
        ),
      }));
      // Refresh protocol parsers after update
      const parsers = await pluginService.getProtocolParsers();
      set({ protocolParsers: parsers });
    } catch (e) {
      console.error('Failed to update plugin:', e);
      throw e;
    }
  },

  getInstalledByType: (type: PluginType): PluginManifest[] => {
    return get().installedPlugins.filter(
      (p: PluginManifest) => p.pluginType === type
    );
  },
}));
