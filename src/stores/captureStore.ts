// 抓包状态管理 — Zustand store
// 管理代理运行状态、捕获条目列表、选中条目和过滤状态

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CapturedEntry, ProxyStatusInfo } from "@/types/capture";
import * as captureService from "@/services/captureService";

interface CaptureStore {
  // 状态
  running: boolean;
  port: number;
  entries: CapturedEntry[];
  selectedEntryId: string | null;
  filter: string;
  detailTab: "headers" | "body" | "preview";

  // 操作
  startCapture: (port?: number) => Promise<void>;
  stopCapture: () => Promise<void>;
  clearEntries: () => Promise<void>;
  setFilter: (filter: string) => void;
  setSelectedEntry: (id: string | null) => void;
  setDetailTab: (tab: "headers" | "body" | "preview") => void;
  refreshStatus: () => Promise<void>;
  exportCaCert: () => Promise<string>;

  // 事件监听
  initListener: () => Promise<UnlistenFn>;
}

export const useCaptureStore = create<CaptureStore>((set, get) => ({
  running: false,
  port: 9090,
  entries: [],
  selectedEntryId: null,
  filter: "",
  detailTab: "headers",

  startCapture: async (port?: number) => {
    const p = port ?? get().port;
    try {
      await captureService.startProxy(p);
      set({ running: true, port: p });
    } catch (e) {
      console.error("启动代理失败:", e);
      throw e;
    }
  },

  stopCapture: async () => {
    try {
      await captureService.stopProxy();
      set({ running: false });
    } catch (e) {
      console.error("停止代理失败:", e);
      throw e;
    }
  },

  clearEntries: async () => {
    try {
      await captureService.clearEntries();
      set({ entries: [], selectedEntryId: null });
    } catch (e) {
      console.error("清空条目失败:", e);
    }
  },

  setFilter: (filter) => set({ filter }),
  setSelectedEntry: (id) => set({ selectedEntryId: id }),
  setDetailTab: (tab) => set({ detailTab: tab }),

  refreshStatus: async () => {
    try {
      const status: ProxyStatusInfo = await captureService.getProxyStatus();
      set({ running: status.running, port: status.port });
    } catch (e) {
      console.error("获取代理状态失败:", e);
    }
  },

  exportCaCert: async () => {
    return captureService.exportCaCert();
  },

  initListener: async () => {
    const unlisten = await listen<CapturedEntry>("capture-event", (event) => {
      const entry = event.payload;
      set((state) => {
        // 如果是已完成的条目，替换对应的 pending 条目
        if (entry.completed) {
          const existingIndex = state.entries.findIndex(
            (e) => e.id === entry.id
          );
          if (existingIndex >= 0) {
            const next = [...state.entries];
            next[existingIndex] = entry;
            return { entries: next };
          }
        }
        // 限制最大 5000 条
        const next =
          state.entries.length >= 5000
            ? [...state.entries.slice(1), entry]
            : [...state.entries, entry];
        return { entries: next };
      });
    });
    return unlisten;
  },
}));
