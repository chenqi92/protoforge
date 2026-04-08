// ProtoForge History Store — Zustand
// 内存中仅存轻量摘要（不含 requestConfig），按需从 SQLite 加载完整记录

import { create } from 'zustand';
import type { HistoryEntry, HistoryEntrySummary } from '@/types/collections';
import * as svc from '@/services/historyService';
import { useSettingsStore } from '@/stores/settingsStore';

const PAGE_SIZE = 50;

interface HistoryStore {
  entries: HistoryEntrySummary[];
  loading: boolean;
  error: string | null;
  /** Whether there are potentially more entries to load */
  hasMore: boolean;
  /** Last write error (shown briefly in UI) */
  writeError: string | null;

  // Actions
  fetchHistory: () => Promise<void>;
  loadMore: () => Promise<void>;
  addEntry: (entry: HistoryEntry) => void;
  /** 按需从 SQLite 获取完整记录（含 requestConfig） */
  getEntryDetail: (id: string) => Promise<HistoryEntry | null>;
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  clearWriteError: () => void;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  hasMore: true,
  writeError: null,

  fetchHistory: async () => {
    set({ loading: true, error: null });
    try {
      const entries = await svc.listHistorySummary(PAGE_SIZE);
      set({ entries, loading: false, hasMore: entries.length >= PAGE_SIZE });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.loading || !state.hasMore) return;
    set({ loading: true });
    try {
      const maxCount = useSettingsStore.getState().settings.maxHistoryCount;
      const currentCount = state.entries.length;
      const nextBatch = Math.min(PAGE_SIZE, maxCount - currentCount);
      if (nextBatch <= 0) {
        set({ loading: false, hasMore: false });
        return;
      }
      // Use offset-based pagination: fetch entries older than the last one we have
      const allEntries = await svc.listHistorySummary(currentCount + nextBatch);
      const hasMore = allEntries.length >= currentCount + nextBatch && allEntries.length < maxCount;
      set({ entries: allEntries, loading: false, hasMore });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addEntry: (entry: HistoryEntry) => {
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
      writeError: null,
    }));
    // 异步写入完整记录到 SQLite
    svc.addHistory(entry, maxCount).catch((e) => {
      const msg = String(e);
      console.error('Failed to save history:', msg);
      set({ writeError: msg });
      // Auto-clear after 5s
      setTimeout(() => {
        if (get().writeError === msg) set({ writeError: null });
      }, 5000);
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
    set({ entries: [], hasMore: false });
  },

  clearWriteError: () => set({ writeError: null }),
}));
