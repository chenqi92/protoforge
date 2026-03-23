import { create } from "zustand";
import type { HttpRequestConfig, HttpResponse } from "@/types/http";
import { createDefaultRequest } from "@/types/http";

export type RequestProtocol = "http" | "ws" | "mqtt";
export type ToolWorkbench = "tcpudp" | "loadtest" | "capture";
export type WorkbenchView = "home" | "requests" | ToolWorkbench;
export type WorkspaceProtocol = RequestProtocol | ToolWorkbench | "collection";

export interface ToolSession {
  id: string;
  tool: ToolWorkbench;
  customLabel?: string | null;
}

export interface AppTab {
  id: string;
  protocol: RequestProtocol;
  label: string;
  customLabel?: string | null;
  linkedCollectionItemId?: string | null;
  linkedCollectionId?: string | null;
  linkedCollectionParentId?: string | null;
  linkedCollectionSortOrder?: number | null;
  linkedCollectionCreatedAt?: string | null;
  savedRequestSignature?: string | null;
  httpConfig?: HttpRequestConfig;
  httpResponse?: HttpResponse | null;
  loading: boolean;
  error: string | null;
  wsUrl?: string;
}

interface AppStore {
  tabs: AppTab[];
  activeTabId: string | null;
  activeWorkbench: WorkbenchView;
  activeCollectionId: string | null;
  toolSessions: Record<ToolWorkbench, ToolSession[]>;
  activeToolSessionIds: Record<ToolWorkbench, string | null>;

  addTab: (protocol?: RequestProtocol) => string;
  openToolTab: (tool: ToolWorkbench, sessionId?: string) => string;
  addToolSession: (tool: ToolWorkbench) => string;
  setActiveToolSession: (tool: ToolWorkbench, sessionId: string) => void;
  closeToolSession: (tool: ToolWorkbench, sessionId: string) => void;
  openCollectionPanel: (collectionId: string) => void;
  closeCollectionPanel: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  setActiveWorkbench: (workbench: WorkbenchView) => void;
  updateTab: (id: string, updates: Partial<AppTab>) => void;
  setTabProtocol: (id: string, protocol: RequestProtocol) => void;

  renameTab: (id: string, label: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  duplicateTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  nextTab: () => void;
  prevTab: () => void;

  updateHttpConfig: (id: string, updates: Partial<HttpRequestConfig>) => void;
  setHttpResponse: (id: string, response: HttpResponse | null) => void;
  setLoading: (id: string, loading: boolean) => void;
  setError: (id: string, error: string | null) => void;

  getActiveTab: () => AppTab | null;
}

const requestLabels: Record<RequestProtocol, string> = {
  http: "Untitled Request",
  ws: "WebSocket",
  mqtt: "MQTT Client",
};

function createToolSession(tool: ToolWorkbench, id?: string): ToolSession {
  return {
    id: id ?? crypto.randomUUID(),
    tool,
    customLabel: null,
  };
}

export const useAppStore = create<AppStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeWorkbench: "home",
  activeCollectionId: null,
  toolSessions: {
    tcpudp: [],
    loadtest: [],
    capture: [],
  },
  activeToolSessionIds: {
    tcpudp: null,
    loadtest: null,
    capture: null,
  },

  addTab: (protocol: RequestProtocol = "http") => {
    const id = crypto.randomUUID();
    const tab: AppTab = {
      id,
      protocol,
      label: requestLabels[protocol],
      customLabel: null,
      linkedCollectionItemId: null,
      linkedCollectionId: null,
      linkedCollectionParentId: null,
      linkedCollectionSortOrder: null,
      linkedCollectionCreatedAt: null,
      savedRequestSignature: null,
      httpConfig: protocol === "http" ? createDefaultRequest() : undefined,
      httpResponse: null,
      loading: false,
      error: null,
      wsUrl: protocol === "ws" ? "ws://localhost:8080" : undefined,
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      activeWorkbench: "requests",
      activeCollectionId: null,
    }));

    return id;
  },

  openToolTab: (tool, sessionId) => {
    const state = get();
    const existingSessions = state.toolSessions[tool];
    const requestedSession = sessionId
      ? existingSessions.find((item) => item.id === sessionId) ?? createToolSession(tool, sessionId)
      : null;

    if (requestedSession && existingSessions.some((item) => item.id === requestedSession.id)) {
      set((current) => ({
        activeWorkbench: tool,
        activeCollectionId: null,
        activeToolSessionIds: {
          ...current.activeToolSessionIds,
          [tool]: requestedSession.id,
        },
      }));
      return requestedSession.id;
    }

    if (requestedSession) {
      set((current) => ({
        activeWorkbench: tool,
        activeCollectionId: null,
        toolSessions: {
          ...current.toolSessions,
          [tool]: [...current.toolSessions[tool], requestedSession],
        },
        activeToolSessionIds: {
          ...current.activeToolSessionIds,
          [tool]: requestedSession.id,
        },
      }));
      return requestedSession.id;
    }

    if (existingSessions.length > 0) {
      const nextActiveId = state.activeToolSessionIds[tool] && existingSessions.some((item) => item.id === state.activeToolSessionIds[tool])
        ? state.activeToolSessionIds[tool]
        : existingSessions[existingSessions.length - 1].id;

      set((current) => ({
        activeWorkbench: tool,
        activeCollectionId: null,
        activeToolSessionIds: {
          ...current.activeToolSessionIds,
          [tool]: nextActiveId,
        },
      }));
      return nextActiveId;
    }

    const session = createToolSession(tool);
    set((current) => ({
      activeWorkbench: tool,
      activeCollectionId: null,
      toolSessions: {
        ...current.toolSessions,
        [tool]: [...current.toolSessions[tool], session],
      },
      activeToolSessionIds: {
        ...current.activeToolSessionIds,
        [tool]: session.id,
      },
    }));
    return session.id;
  },

  addToolSession: (tool) => {
    const session = createToolSession(tool);
    set((state) => ({
      activeWorkbench: tool,
      activeCollectionId: null,
      toolSessions: {
        ...state.toolSessions,
        [tool]: [...state.toolSessions[tool], session],
      },
      activeToolSessionIds: {
        ...state.activeToolSessionIds,
        [tool]: session.id,
      },
    }));
    return session.id;
  },

  setActiveToolSession: (tool, sessionId) => {
    set((state) => ({
      activeWorkbench: tool,
      activeCollectionId: null,
      activeToolSessionIds: {
        ...state.activeToolSessionIds,
        [tool]: sessionId,
      },
    }));
  },

  closeToolSession: (tool, sessionId) => {
    set((state) => {
      const sessions = state.toolSessions[tool];
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) {
        return {};
      }

      const nextSessions = sessions.filter((item) => item.id !== sessionId);

      if (nextSessions.length === 0) {
        const replacement = createToolSession(tool);
        return {
          toolSessions: {
            ...state.toolSessions,
            [tool]: [replacement],
          },
          activeToolSessionIds: {
            ...state.activeToolSessionIds,
            [tool]: replacement.id,
          },
          activeWorkbench: tool,
          activeCollectionId: null,
        };
      }

      const fallbackSession = nextSessions[Math.min(index, nextSessions.length - 1)];
      const nextActiveId = state.activeToolSessionIds[tool] === sessionId
        ? fallbackSession.id
        : state.activeToolSessionIds[tool];

      return {
        toolSessions: {
          ...state.toolSessions,
          [tool]: nextSessions,
        },
        activeToolSessionIds: {
          ...state.activeToolSessionIds,
          [tool]: nextActiveId,
        },
      };
    });
  },

  openCollectionPanel: (collectionId) => {
    set({
      activeWorkbench: "requests",
      activeCollectionId: collectionId,
      activeTabId: null,
    });
  },

  closeCollectionPanel: () => {
    set({ activeCollectionId: null });
  },

  closeTab: (id) => {
    set((state) => {
      const nextTabs = state.tabs.filter((tab) => tab.id !== id);
      let nextActiveId = state.activeTabId;

      if (state.activeTabId === id) {
        nextActiveId = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null;
      }

      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
      };
    });
  },

  setActiveTab: (id) => {
    set({
      activeTabId: id,
      activeWorkbench: "requests",
      activeCollectionId: null,
    });
  },

  setActiveWorkbench: (workbench) => {
    set({ activeWorkbench: workbench });
  },

  updateTab: (id, updates) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...updates } : tab)),
    }));
  },

  setTabProtocol: (id, protocol) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab;

        return {
          ...tab,
          protocol,
          label: tab.label === requestLabels[tab.protocol] ? requestLabels[protocol] : tab.label,
          httpConfig: protocol === "http" && !tab.httpConfig ? createDefaultRequest() : tab.httpConfig,
          wsUrl: protocol === "ws" && !tab.wsUrl ? "ws://localhost:8080" : tab.wsUrl,
        };
      }),
    }));
  },

  renameTab: (id, label) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, label, customLabel: label } : tab)),
    }));
  },

  closeOtherTabs: (id) => {
    set((state) => ({
      tabs: state.tabs.filter((tab) => tab.id === id),
      activeTabId: id,
      activeWorkbench: "requests",
      activeCollectionId: null,
    }));
  },

  closeTabsToRight: (id) => {
    set((state) => {
      const currentIndex = state.tabs.findIndex((tab) => tab.id === id);
      const nextTabs = state.tabs.slice(0, currentIndex + 1);
      const nextActiveId = nextTabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : id;

      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
        activeWorkbench: "requests",
        activeCollectionId: null,
      };
    });
  },

  duplicateTab: (id) => {
    const state = get();
    const source = state.tabs.find((tab) => tab.id === id);
    if (!source) return;

    const newId = crypto.randomUUID();
    const duplicate: AppTab = {
      ...structuredClone(source),
      id: newId,
      label: `${source.label} (副本)`,
      linkedCollectionItemId: null,
      linkedCollectionId: null,
      linkedCollectionParentId: null,
      linkedCollectionSortOrder: null,
      linkedCollectionCreatedAt: null,
      savedRequestSignature: null,
    };

    set((current) => {
      const sourceIndex = current.tabs.findIndex((tab) => tab.id === id);
      const nextTabs = [...current.tabs];
      nextTabs.splice(sourceIndex + 1, 0, duplicate);

      return {
        tabs: nextTabs,
        activeTabId: newId,
        activeWorkbench: "requests",
        activeCollectionId: null,
      };
    });
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const nextTabs = [...state.tabs];
      const [moved] = nextTabs.splice(fromIndex, 1);
      nextTabs.splice(toIndex, 0, moved);
      return { tabs: nextTabs };
    });
  },

  nextTab: () => {
    const state = get();
    if (state.tabs.length <= 1) return;

    const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
    const nextIndex = (currentIndex + 1) % state.tabs.length;
    set({
      activeTabId: state.tabs[nextIndex].id,
      activeWorkbench: "requests",
      activeCollectionId: null,
    });
  },

  prevTab: () => {
    const state = get();
    if (state.tabs.length <= 1) return;

    const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
    const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length;
    set({
      activeTabId: state.tabs[prevIndex].id,
      activeWorkbench: "requests",
      activeCollectionId: null,
    });
  },

  updateHttpConfig: (id, updates) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && tab.httpConfig ? { ...tab, httpConfig: { ...tab.httpConfig, ...updates } } : tab
      ),
    }));
  },

  setHttpResponse: (id, response) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, httpResponse: response } : tab)),
    }));
  },

  setLoading: (id, loading) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, loading } : tab)),
    }));
  },

  setError: (id, error) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, error } : tab)),
    }));
  },

  getActiveTab: () => {
    const state = get();
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  },
}));
