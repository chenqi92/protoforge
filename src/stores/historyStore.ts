// ProtoForge History Store — Zustand

import { create } from 'zustand';
import type { HistoryEntry } from '@/types/collections';
import * as svc from '@/services/historyService';

interface HistoryStore {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchHistory: (limit?: number) => Promise<void>;
  addEntry: (entry: HistoryEntry) => void;
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  loading: false,
  error: null,

  fetchHistory: async (limit = 100) => {
    set({ loading: true, error: null });
    try {
      const entries = await svc.listHistory(limit);
      set({ entries, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addEntry: (entry: HistoryEntry) => {
    // 乐观更新：先加到本地，再异步写库
    set((s) => ({
      entries: [entry, ...s.entries].slice(0, 500),
    }));
    svc.addHistory(entry).catch((e) => {
      console.error('Failed to save history:', e);
    });
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
