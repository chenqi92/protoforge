import { create } from "zustand";
import type { HttpRequestConfig, HttpResponse } from "@/types/http";
import { createDefaultRequest } from "@/types/http";
import type { SocketMode } from "@/types/tcp";
import type { VideoProtocol } from "@/types/videostream";
import {
  DEFAULT_TCP_TOOL_MODE,
  DEFAULT_VIDEO_TOOL_MODE,
  type ToolSessionOptions,
} from "@/types/toolSession";

export type RequestProtocol = "http" | "ws" | "mqtt" | "grpc";
export type ToolWorkbench = "tcpudp" | "loadtest" | "capture" | "videostream" | "mockserver" | "dbclient" | "toolbox" | "workflow";
export type WorkbenchView = "home" | "requests" | ToolWorkbench;
export type WorkspaceProtocol = RequestProtocol | ToolWorkbench | "collection";

/* ─────────────────────────────────────────────────────────────────────────
 * Forge IA — presentation-layer domain model (additive over the dual store)
 * ──────────────────────────────────────────────────────────────────────── */

/** Per-context lifecycle state, surfaced as the leading status dot (.pf-dot). */
export type ContextState = "idle" | "ok" | "live" | "run" | "err";

/** A Forge "domain" — the activity-rail entries, grouped by capability area. */
export type ForgeDomainId =
  | "api"
  | "realtime"
  | "mock"
  | "workflow"
  | "db"
  | "media"
  | "load"
  | "capture"
  | "toolbox"
  | "plugins";

export type ForgeGroupId = "work" | "data" | "diag" | "ext";

/** lucide icon name (resolved in the rail) — kept as a plain string id. */
export interface ForgeDomain {
  id: ForgeDomainId;
  group: ForgeGroupId;
  icon: string;
  zh: string;
  en: string;
  /** opens a modal instead of mounting a workspace (e.g. plugins market). */
  modal?: boolean;
  /** the WorkbenchView this domain maps onto when one exists. */
  workbench?: WorkbenchView;
}

export const FORGE_GROUPS: Array<{ id: ForgeGroupId; zh: string; en: string }> = [
  { id: "work", zh: "工作", en: "Work" },
  { id: "data", zh: "数据", en: "Data" },
  { id: "diag", zh: "诊断", en: "Diagnostics" },
  { id: "ext", zh: "扩展", en: "Extend" },
];

export const FORGE_DOMAINS: ForgeDomain[] = [
  { id: "api", group: "work", icon: "globe", zh: "API 接口", en: "API", workbench: "requests" },
  { id: "realtime", group: "work", icon: "radio", zh: "实时连接", en: "Realtime", workbench: "requests" },
  { id: "mock", group: "work", icon: "server", zh: "Mock 服务", en: "Mock", workbench: "mockserver" },
  { id: "workflow", group: "work", icon: "zap", zh: "工作流", en: "Workflow", workbench: "workflow" },
  { id: "db", group: "data", icon: "database", zh: "数据库", en: "Database", workbench: "dbclient" },
  { id: "media", group: "data", icon: "video", zh: "视频流", en: "Media", workbench: "videostream" },
  { id: "load", group: "diag", icon: "gauge", zh: "压测", en: "Load Test", workbench: "loadtest" },
  { id: "capture", group: "diag", icon: "waves", zh: "抓包代理", en: "Capture", workbench: "capture" },
  { id: "toolbox", group: "ext", icon: "wrench", zh: "工具箱", en: "Toolbox", workbench: "toolbox" },
  { id: "plugins", group: "ext", icon: "puzzle", zh: "插件市场", en: "Plugins", modal: true },
];

/** Maps a tool workbench to a Forge domain id (for rail active-state + dot). */
const TOOL_TO_DOMAIN: Record<ToolWorkbench, ForgeDomainId> = {
  mockserver: "mock",
  workflow: "workflow",
  dbclient: "db",
  videostream: "media",
  loadtest: "load",
  capture: "capture",
  toolbox: "toolbox",
  tcpudp: "realtime",
};

/** Maps a request protocol to a Forge domain id. */
const PROTOCOL_TO_DOMAIN: Record<RequestProtocol, ForgeDomainId> = {
  http: "api",
  ws: "realtime",
  mqtt: "realtime",
  grpc: "realtime",
};

/** lucide icon name per request protocol (http uses the method tag instead). */
const PROTOCOL_ICON: Record<RequestProtocol, string> = {
  http: "globe",
  ws: "wifi",
  mqtt: "radio",
  grpc: "network",
};

/** lucide icon name per tool workbench, for the unified strip. */
const TOOL_ICON: Record<ToolWorkbench, string> = {
  tcpudp: "network",
  loadtest: "gauge",
  capture: "waves",
  videostream: "video",
  mockserver: "server",
  dbclient: "database",
  toolbox: "wrench",
  workflow: "zap",
};

/** A unified, presentation-layer view of any open context (AppTab or ToolSession). */
export interface UnifiedTab {
  /** stable id — the AppTab.id or `${tool}:${sessionId}` for tool sessions. */
  id: string;
  kind: "request" | "tool";
  /** underlying source ids for action dispatch. */
  tabId?: string;
  tool?: ToolWorkbench;
  sessionId?: string;
  protocol?: RequestProtocol;
  domain: ForgeDomainId;
  title: string;
  /** http method, when applicable, for the .pf-mtag badge. */
  method?: string;
  /** lucide icon name for non-http contexts. */
  icon: string;
  state: ContextState;
}

export interface ToolSession {
  id: string;
  tool: ToolWorkbench;
  customLabel?: string | null;
  tcpMode?: SocketMode | null;
  videoMode?: VideoProtocol | null;
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
  /** Per-context lifecycle state, keyed by UnifiedTab.id. Drives the status dot. */
  contextStates: Record<string, ContextState>;

  addTab: (protocol?: RequestProtocol) => string;
  openToolTab: (tool: ToolWorkbench, sessionId?: string, options?: ToolSessionOptions) => string;
  addToolSession: (tool: ToolWorkbench, options?: ToolSessionOptions) => string;
  setActiveToolSession: (tool: ToolWorkbench, sessionId: string) => void;
  closeToolSession: (tool: ToolWorkbench, sessionId: string) => void;
  updateToolSession: (tool: ToolWorkbench, sessionId: string, updates: ToolSessionOptions) => void;
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

  /* ── Forge IA selectors / actions (additive) ──────────────────────────── */
  /** Sets the lifecycle state for a unified-context id (drives the status dot). */
  setContextState: (contextId: string, state: ContextState) => void;
  /** The unified list of every open context (requests + tool sessions). */
  getUnifiedTabs: () => UnifiedTab[];
  /** The UnifiedTab.id that is currently active, given activeWorkbench. */
  getActiveUnifiedTabId: () => string | null;
  /** Resolves the Forge domain currently in focus (for rail highlight + status). */
  getActiveDomain: () => ForgeDomainId | null;
}

/** Builds the stable unified id for a tool session. */
export function toolContextId(tool: ToolWorkbench, sessionId: string): string {
  return `${tool}:${sessionId}`;
}

const requestLabels: Record<RequestProtocol, string> = {
  http: "Untitled Request",
  ws: "WebSocket",
  mqtt: "MQTT Client",
  grpc: "gRPC Client",
};

function createToolSession(tool: ToolWorkbench, id?: string, options?: ToolSessionOptions): ToolSession {
  return {
    id: id ?? crypto.randomUUID(),
    tool,
    customLabel: options?.customLabel ?? null,
    tcpMode: tool === "tcpudp" ? options?.tcpMode ?? DEFAULT_TCP_TOOL_MODE : null,
    videoMode: tool === "videostream" ? options?.videoMode ?? DEFAULT_VIDEO_TOOL_MODE : null,
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
    videostream: [],
    mockserver: [],
    dbclient: [],
    toolbox: [],
    workflow: [],
  },
  activeToolSessionIds: {
    tcpudp: null,
    loadtest: null,
    capture: null,
    videostream: null,
    mockserver: null,
    dbclient: null,
    toolbox: null,
    workflow: null,
  },
  contextStates: {},

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

  openToolTab: (tool, sessionId, options) => {
    const state = get();
    const existingSessions = state.toolSessions[tool];
    const requestedSession = sessionId
      ? existingSessions.find((item) => item.id === sessionId) ?? createToolSession(tool, sessionId, options)
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

    const session = createToolSession(tool, undefined, options);
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

  addToolSession: (tool, options) => {
    const session = createToolSession(tool, undefined, options);
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

  updateToolSession: (tool, sessionId, updates) => {
    set((state) => ({
      toolSessions: {
        ...state.toolSessions,
        [tool]: state.toolSessions[tool].map((session) => (
          session.id === sessionId
            ? {
                ...session,
                customLabel: updates.customLabel === undefined ? session.customLabel : updates.customLabel,
                tcpMode: tool === "tcpudp"
                  ? (updates.tcpMode ?? session.tcpMode ?? DEFAULT_TCP_TOOL_MODE)
                  : session.tcpMode,
                videoMode: tool === "videostream"
                  ? (updates.videoMode ?? session.videoMode ?? DEFAULT_VIDEO_TOOL_MODE)
                  : session.videoMode,
              }
            : session
        )),
      },
    }));
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
      // Guard against out-of-range indices (e.g. unified-strip indices that don't
      // map onto the request-tabs-only array) so we never splice in `undefined`.
      if (
        fromIndex < 0 ||
        fromIndex >= state.tabs.length ||
        toIndex < 0 ||
        toIndex > state.tabs.length
      ) {
        return {};
      }
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

  setContextState: (contextId, contextState) => {
    set((state) => ({
      contextStates: { ...state.contextStates, [contextId]: contextState },
    }));
  },

  getUnifiedTabs: () => {
    const state = get();
    const result: UnifiedTab[] = [];

    for (const tab of state.tabs) {
      const protocol = tab.protocol;
      const title =
        tab.customLabel?.trim() ||
        (protocol === "http" && tab.httpConfig?.name?.trim() && tab.httpConfig.name !== "Untitled Request"
          ? tab.httpConfig.name.trim()
          : "") ||
        (protocol === "http" ? tab.httpConfig?.url?.trim() : "") ||
        tab.label;

      // Default state: loading -> run, error -> err, otherwise explicit override or idle.
      const fallback: ContextState = tab.loading ? "run" : tab.error ? "err" : "idle";

      result.push({
        id: tab.id,
        kind: "request",
        tabId: tab.id,
        protocol,
        domain: PROTOCOL_TO_DOMAIN[protocol],
        title: title || tab.label,
        method: protocol === "http" ? tab.httpConfig?.method : undefined,
        icon: PROTOCOL_ICON[protocol],
        state: state.contextStates[tab.id] ?? fallback,
      });
    }

    (Object.keys(state.toolSessions) as ToolWorkbench[]).forEach((tool) => {
      for (const session of state.toolSessions[tool]) {
        const contextId = toolContextId(tool, session.id);
        // Tools without an explicit override default to idle (live connections set 'live').
        result.push({
          id: contextId,
          kind: "tool",
          tool,
          sessionId: session.id,
          domain: TOOL_TO_DOMAIN[tool],
          title: session.customLabel?.trim() || FORGE_DOMAINS.find((d) => d.id === TOOL_TO_DOMAIN[tool])?.en || tool,
          icon: TOOL_ICON[tool],
          state: state.contextStates[contextId] ?? "idle",
        });
      }
    });

    return result;
  },

  getActiveUnifiedTabId: () => {
    const state = get();
    const workbench = state.activeWorkbench;
    if (workbench === "home") return null;
    if (workbench === "requests") {
      return state.activeTabId;
    }
    // tool workbench
    const sessionId = state.activeToolSessionIds[workbench];
    return sessionId ? toolContextId(workbench, sessionId) : null;
  },

  getActiveDomain: () => {
    const state = get();
    const workbench = state.activeWorkbench;
    if (workbench === "home") return null;
    if (workbench === "requests") {
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      return tab ? PROTOCOL_TO_DOMAIN[tab.protocol] : "api";
    }
    return TOOL_TO_DOMAIN[workbench];
  },
}));

/**
 * Dispatches a Forge rail domain to the existing nav actions.
 * Reuses addTab / openToolTab / setActiveTab — never bypasses the dual model.
 * `onOpenPluginModal` is supplied by App.tsx for the modal-only domain.
 *
 * Behavior mirrors the prototype: focus an existing context for that domain if
 * one is open, otherwise create one (or switch to the tool workbench, which
 * lazily creates a session via openToolTab when empty).
 */
export function openForgeDomain(
  domainId: ForgeDomainId,
  opts: { onOpenPluginModal?: () => void } = {},
): void {
  const store = useAppStore.getState();

  if (domainId === "plugins") {
    opts.onOpenPluginModal?.();
    return;
  }

  if (domainId === "api") {
    // Focus an existing http tab if present, else open a new one.
    const existing = store.tabs.find((t) => t.protocol === "http");
    if (existing) {
      store.setActiveTab(existing.id);
    } else {
      store.addTab("http");
    }
    return;
  }

  if (domainId === "realtime") {
    // Realtime spans ws/mqtt/grpc request tabs AND the tcp/udp tool.
    // Prefer focusing an existing realtime request tab; else fall back to the
    // tcp/udp tool workbench (which is the dedicated long-connection surface).
    const existing = store.tabs.find(
      (t) => t.protocol === "ws" || t.protocol === "mqtt" || t.protocol === "grpc",
    );
    if (existing) {
      store.setActiveTab(existing.id);
      return;
    }
    if (store.toolSessions.tcpudp.length > 0) {
      store.openToolTab("tcpudp");
      return;
    }
    // Nothing open yet — start a WebSocket request as the default realtime entry.
    store.addTab("ws");
    return;
  }

  // Remaining domains map 1:1 onto a tool workbench.
  const domain = FORGE_DOMAINS.find((d) => d.id === domainId);
  const workbench = domain?.workbench;
  if (workbench && workbench !== "home" && workbench !== "requests") {
    store.openToolTab(workbench);
  }
}
