import { create } from 'zustand';
import type { HttpRequestConfig, HttpResponse, RequestTab } from '@/types/http';
import { createDefaultRequest } from '@/types/http';

export type ProtocolType = 'http' | 'ws' | 'sse' | 'mqtt' | 'tcp' | 'udp';

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
  // WS/TCP/UDP (placeholder fields)
  wsUrl?: string;
  tcpHost?: string;
  tcpPort?: number;
}

interface AppStore {
  tabs: AppTab[];
  activeTabId: string | null;

  addTab: (protocol?: ProtocolType) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<AppTab>) => void;
  setTabProtocol: (id: string, protocol: ProtocolType) => void;

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
      tcp: 'TCP Connection',
      udp: 'UDP Socket',
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
      tcpHost: protocol === 'tcp' || protocol === 'udp' ? 'localhost' : undefined,
      tcpPort: protocol === 'tcp' || protocol === 'udp' ? 8080 : undefined,
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
          mqtt: 'MQTT Client', tcp: 'TCP Connection', udp: 'UDP Socket',
        };
        return {
          ...t,
          protocol,
          label: t.label === labels[t.protocol] ? labels[protocol] : t.label,
          httpConfig: protocol === 'http' && !t.httpConfig ? createDefaultRequest() : t.httpConfig,
          wsUrl: protocol === 'ws' && !t.wsUrl ? 'ws://localhost:8080' : t.wsUrl,
          tcpHost: (protocol === 'tcp' || protocol === 'udp') && !t.tcpHost ? 'localhost' : t.tcpHost,
          tcpPort: (protocol === 'tcp' || protocol === 'udp') && !t.tcpPort ? 8080 : t.tcpPort,
        };
      }),
    }));
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
