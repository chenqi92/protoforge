// ProtoForge History Store — Zustand
// 内存中仅存轻量摘要（不含 requestConfig），按需从 SQLite 加载完整记录

import { create } from 'zustand';
import type { HistoryEntry, HistoryEntrySummary } from '@/types/collections';
import * as svc from '@/services/historyService';
import { useSettingsStore } from '@/stores/settingsStore';

interface HistoryStore {
  entries: HistoryEntrySummary[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchHistory: (limit?: number) => Promise<void>;
  addEntry: (entry: HistoryEntry) => void;
  /** 按需从 SQLite 获取完整记录（含 requestConfig） */
  getEntryDetail: (id: string) => Promise<HistoryEntry | null>;
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  loading: false,
  error: null,

  fetchHistory: async (limit = 200) => {
    set({ loading: true, error: null });
    try {
      const entries = await svc.listHistorySummary(limit);
      set({ entries, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addEntry: (entry: HistoryEntry) => {
    // 从 settings 获取历史记录上限
    const maxCount = useSettingsStore.getState().settings.maxHistoryCount;
    // 乐观更新：只存摘要到内存
    const summary: HistoryEntrySummary = {
      id: entry.id,
      method: entry.method,
      url: entry.url,
      status: entry.status,
      durationMs: entry.durationMs,
      bodySize: entry.bodySize,
      createdAt: entry.createdAt,
    };
    set((s) => ({
      entries: [summary, ...s.entries].slice(0, maxCount),
    }));
    // 异步写入完整记录到 SQLite
    svc.addHistory(entry, maxCount).catch((e) => {
      console.error('Failed to save history:', e);
    });
  },

  getEntryDetail: async (id: string) => {
    try {
      return await svc.getHistoryEntry(id);
    } catch (e) {
      console.error('Failed to load history detail:', e);
      return null;
    }
  },

  deleteEntry: async (id: string) => {
    await svc.deleteHistoryEntry(id);
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },

  clearAll: async () => {
    await svc.clearHistory();
    set({ entries: [] });
  },
}));
