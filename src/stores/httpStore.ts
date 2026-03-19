import { create } from 'zustand';
import type { HttpRequestConfig, HttpResponse, RequestTab } from '@/types/http';
import { createDefaultRequest } from '@/types/http';

interface HttpStore {
  // Tabs
  tabs: RequestTab[];
  activeTabId: string | null;

  // Actions
  addTab: () => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateConfig: (id: string, updates: Partial<HttpRequestConfig>) => void;
  setResponse: (id: string, response: HttpResponse | null) => void;
  setLoading: (id: string, loading: boolean) => void;
  setError: (id: string, error: string | null) => void;
  getActiveConfig: () => HttpRequestConfig | null;
  getActiveTab: () => RequestTab | null;
}

export const useHttpStore = create<HttpStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: () => {
    const config = createDefaultRequest();
    const tab: RequestTab = {
      id: config.id,
      config,
      response: null,
      loading: false,
      error: null,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  closeTab: (id: string) => {
    set((state) => {
      const next = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        newActiveId = next.length > 0 ? next[next.length - 1].id : null;
      }
      return { tabs: next, activeTabId: newActiveId };
    });
  },

  setActiveTab: (id: string) => set({ activeTabId: id }),

  updateConfig: (id: string, updates: Partial<HttpRequestConfig>) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, config: { ...t.config, ...updates } } : t
      ),
    }));
  },

  setResponse: (id: string, response: HttpResponse | null) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, response } : t
      ),
    }));
  },

  setLoading: (id: string, loading: boolean) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, loading } : t
      ),
    }));
  },

  setError: (id: string, error: string | null) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, error } : t
      ),
    }));
  },

  getActiveConfig: () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab?.config ?? null;
  },

  getActiveTab: () => {
    const state = get();
    return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  },
}));
