import { create } from 'zustand';
import type { PluginManifest, ProtocolParser } from '@/types/plugin';
import * as pluginService from '@/services/pluginService';

interface PluginStore {
  installedPlugins: PluginManifest[];
  availablePlugins: PluginManifest[];
  protocolParsers: ProtocolParser[];
  loading: boolean;

  fetchInstalledPlugins: () => Promise<void>;
  fetchAvailablePlugins: () => Promise<void>;
  fetchProtocolParsers: () => Promise<void>;
  refreshRegistry: () => Promise<void>;
  installPlugin: (pluginId: string) => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  installedPlugins: [],
  availablePlugins: [],
  protocolParsers: [],
  loading: false,

  fetchInstalledPlugins: async () => {
    try {
      const plugins = await pluginService.listPlugins();
      set({ installedPlugins: plugins });
    } catch (e) {
      console.error('Failed to fetch installed plugins:', e);
    }
  },

  fetchAvailablePlugins: async () => {
    try {
      set({ loading: true });
      const plugins = await pluginService.listAvailablePlugins();
      set({ availablePlugins: plugins, loading: false });
    } catch (e) {
      console.error('Failed to fetch available plugins:', e);
      set({ loading: false });
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
          p.id === pluginId ? { ...p, installed: true } : p
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
          p.id === pluginId ? { ...p, installed: false } : p
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
}));
