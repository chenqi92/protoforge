import { create } from 'zustand';
import type { HttpRequestConfig, HttpResponse } from '@/types/http';
import { createDefaultRequest } from '@/types/http';

export type ProtocolType = 'http' | 'ws' | 'sse' | 'mqtt' | 'collection';

export interface AppTab {
  id: string;
  protocol: ProtocolType;
  label: string;
  // HTTP-specific
  httpConfig?: HttpRequestConfig;
  httpResponse?: HttpResponse | null;
  // General
  loading: boolean;
  error: string | null;
  // WS (placeholder fields)
  wsUrl?: string;
  // Collection settings
  collectionId?: string;
}

interface AppStore {
  tabs: AppTab[];
  activeTabId: string | null;

  addTab: (protocol?: ProtocolType) => string;
  addCollectionTab: (collectionId: string, name: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<AppTab>) => void;
  setTabProtocol: (id: string, protocol: ProtocolType) => void;

  // Tab operations
  renameTab: (id: string, label: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  duplicateTab: (id: string) => void;
  nextTab: () => void;
  prevTab: () => void;

  // HTTP helpers
  updateHttpConfig: (id: string, updates: Partial<HttpRequestConfig>) => void;
  setHttpResponse: (id: string, response: HttpResponse | null) => void;
  setLoading: (id: string, loading: boolean) => void;
  setError: (id: string, error: string | null) => void;

  getActiveTab: () => AppTab | null;
}

export const useAppStore = create<AppStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (protocol: ProtocolType = 'http') => {
    const id = crypto.randomUUID();
    const httpConfig = protocol === 'http' ? createDefaultRequest() : undefined;
    const labels: Record<ProtocolType, string> = {
      http: 'Untitled Request',
      ws: 'WebSocket',
      sse: 'SSE Stream',
      mqtt: 'MQTT Client',
      collection: 'Collection',
    };
    const tab: AppTab = {
      id,
      protocol,
      label: labels[protocol],
      httpConfig,
      httpResponse: null,
      loading: false,
      error: null,
      wsUrl: protocol === 'ws' ? 'ws://localhost:8080' : undefined,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  addCollectionTab: (collectionId: string, name: string) => {
    // Check if already open
    const existing = get().tabs.find((t) => t.protocol === 'collection' && t.collectionId === collectionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = crypto.randomUUID();
    const tab: AppTab = {
      id,
      protocol: 'collection',
      label: name,
      collectionId,
      loading: false,
      error: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const next = s.tabs.filter((t) => t.id !== id);
      let newActive = s.activeTabId;
      if (s.activeTabId === id) {
        newActive = next.length > 0 ? next[next.length - 1].id : null;
      }
      return { tabs: next, activeTabId: newActive };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },

  setTabProtocol: (id, protocol) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const labels: Record<ProtocolType, string> = {
          http: 'Untitled Request', ws: 'WebSocket', sse: 'SSE Stream',
          mqtt: 'MQTT Client', collection: 'Collection',
        };
        return {
          ...t,
          protocol,
          label: t.label === labels[t.protocol] ? labels[protocol] : t.label,
          httpConfig: protocol === 'http' && !t.httpConfig ? createDefaultRequest() : t.httpConfig,
          wsUrl: protocol === 'ws' && !t.wsUrl ? 'ws://localhost:8080' : t.wsUrl,
        };
      }),
    }));
  },

  renameTab: (id, label) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, label } : t)),
    }));
  },

  closeOtherTabs: (id) => {
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id === id),
      activeTabId: id,
    }));
  },

  closeTabsToRight: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const next = s.tabs.slice(0, idx + 1);
      const newActive = next.find((t) => t.id === s.activeTabId) ? s.activeTabId : id;
      return { tabs: next, activeTabId: newActive };
    });
  },

  duplicateTab: (id) => {
    const s = get();
    const src = s.tabs.find((t) => t.id === id);
    if (!src) return;
    const newId = crypto.randomUUID();
    const dup: AppTab = {
      ...structuredClone(src),
      id: newId,
      label: `${src.label} (副本)`,
    };
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const next = [...s.tabs];
      next.splice(idx + 1, 0, dup);
      return { tabs: next, activeTabId: newId };
    });
  },

  nextTab: () => {
    const s = get();
    if (s.tabs.length <= 1) return;
    const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
    const next = (idx + 1) % s.tabs.length;
    set({ activeTabId: s.tabs[next].id });
  },

  prevTab: () => {
    const s = get();
    if (s.tabs.length <= 1) return;
    const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
    const prev = (idx - 1 + s.tabs.length) % s.tabs.length;
    set({ activeTabId: s.tabs[prev].id });
  },

  updateHttpConfig: (id, updates) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.httpConfig ? { ...t, httpConfig: { ...t.httpConfig, ...updates } } : t
      ),
    }));
  },

  setHttpResponse: (id, response) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, httpResponse: response } : t)),
    }));
  },

  setLoading: (id, loading) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, loading } : t)),
    }));
  },

  setError: (id, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, error } : t)),
    }));
  },

  getActiveTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  },
}));
