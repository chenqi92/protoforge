// Mock Server Zustand Store — 每个 session 独立实例

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  MockRoute,
  MockRequestLog,
  MockServerStatusInfo,
  MockServerConfig,
} from "@/types/mockserver";
import { createEmptyRoute } from "@/types/mockserver";
import * as mockService from "@/services/mockServerService";

interface MockServerStoreState {
  sessionId: string;
  running: boolean;
  port: number;
  routes: MockRoute[];
  selectedRouteId: string | null;
  logs: MockRequestLog[];
  totalHits: number;
  error: string | null;
  proxyTarget: string;
  configId: string | null;

  // 路由管理
  addRoute: () => void;
  addRouteFromTemplate: (partial: Partial<MockRoute>) => void;
  updateRoute: (id: string, patch: Partial<MockRoute>) => void;
  removeRoute: (id: string) => void;
  duplicateRoute: (id: string) => void;
  reorderRoutes: (fromIndex: number, toIndex: number) => void;
  setSelectedRoute: (id: string | null) => void;

  // 服务器生命周期
  startServer: (port?: number) => Promise<void>;
  stopServer: () => Promise<void>;
  setPort: (port: number) => void;

  // 热更新路由到运行中的服务器
  syncRoutesToServer: () => Promise<void>;

  // 代理
  setProxyTarget: (target: string) => Promise<void>;

  // 持久化
  saveConfig: () => Promise<void>;
  loadConfig: (id: string) => Promise<void>;

  // 导入/导出
  importRoutes: (routes: MockRoute[]) => void;
  exportRoutes: () => MockRoute[];

  // 日志
  clearLogs: () => Promise<void>;
  loadLogs: () => Promise<void>;

  // 状态
  refreshStatus: () => Promise<void>;

  // 事件监听
  initListener: () => Promise<UnlistenFn>;
}

type MockServerStoreApi = ReturnType<typeof createMockServerSessionStore>;

const stores = new Map<string, MockServerStoreApi>();
const cleanupFns = new Map<string, () => void>();

function createMockServerSessionStore(sessionId: string) {
  let listenerPromise: Promise<UnlistenFn> | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleAutoSave(get: () => MockServerStoreState) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      const state = get();
      if (state.configId) {
        void state.saveConfig();
      }
    }, 800);
  }

  // 注册清理函数
  cleanupFns.set(sessionId, () => {
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    if (listenerPromise) { void listenerPromise.then((fn) => fn()); listenerPromise = null; }
  });

  return createStore<MockServerStoreState>((set, get) => ({
    sessionId,
    running: false,
    port: 3100,
    routes: [],
    selectedRouteId: null,
    logs: [],
    totalHits: 0,
    error: null,
    proxyTarget: "",
    configId: null,

    addRoute: () => {
      const newRoute = createEmptyRoute();
      set((s) => ({
        routes: [...s.routes, newRoute],
        selectedRouteId: newRoute.id,
      }));
      scheduleAutoSave(get);
    },

    addRouteFromTemplate: (partial) => {
      const newRoute: MockRoute = { ...createEmptyRoute(), ...partial, id: crypto.randomUUID() };
      set((s) => ({
        routes: [...s.routes, newRoute],
        selectedRouteId: newRoute.id,
      }));
      scheduleAutoSave(get);
    },

    updateRoute: (id, patch) => {
      set((s) => ({
        routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }));
      scheduleAutoSave(get);
    },

    removeRoute: (id) => {
      set((s) => ({
        routes: s.routes.filter((r) => r.id !== id),
        selectedRouteId: s.selectedRouteId === id ? null : s.selectedRouteId,
      }));
      scheduleAutoSave(get);
    },

    duplicateRoute: (id) => {
      const state = get();
      const source = state.routes.find((r) => r.id === id);
      if (!source) return;
      const copy: MockRoute = {
        ...source,
        id: crypto.randomUUID(),
        description: source.description ? `${source.description} (copy)` : "(copy)",
      };
      const idx = state.routes.findIndex((r) => r.id === id);
      const newRoutes = [...state.routes];
      newRoutes.splice(idx + 1, 0, copy);
      set({ routes: newRoutes, selectedRouteId: copy.id });
      scheduleAutoSave(get);
    },

    reorderRoutes: (fromIndex, toIndex) => {
      set((s) => {
        const newRoutes = [...s.routes];
        const [moved] = newRoutes.splice(fromIndex, 1);
        newRoutes.splice(toIndex, 0, moved);
        return { routes: newRoutes };
      });
      scheduleAutoSave(get);
    },

    setSelectedRoute: (id) => set({ selectedRouteId: id }),

    startServer: async (port?: number) => {
      const p = port ?? get().port;
      const routes = get().routes;
      try {
        await mockService.startMockServer(sessionId, p, routes);
        set({ running: true, port: p, error: null });
        // 首次启动自动创建持久化配置
        if (!get().configId) {
          set({ configId: sessionId });
          void get().saveConfig();
        }
      } catch (e) {
        const msg = String(e);
        set({ error: msg });
        throw e;
      }
    },

    stopServer: async () => {
      try {
        await mockService.stopMockServer(sessionId);
        set({ running: false, error: null });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    setPort: (port) => {
      set({ port });
      scheduleAutoSave(get);
    },

    syncRoutesToServer: async () => {
      if (!get().running) return;
      try {
        await mockService.updateMockRoutes(sessionId, get().routes);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    setProxyTarget: async (target) => {
      set({ proxyTarget: target });
      if (get().running) {
        await mockService.setProxyTarget(sessionId, target || null);
      }
      scheduleAutoSave(get);
    },

    saveConfig: async () => {
      const state = get();
      const now = new Date().toISOString();
      const config: MockServerConfig = {
        id: state.configId || sessionId,
        sessionLabel: "",
        port: state.port,
        routesJson: JSON.stringify(state.routes),
        proxyTarget: state.proxyTarget || undefined,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await mockService.saveMockConfig(config);
        if (!state.configId) set({ configId: config.id });
      } catch (e) {
        console.error("[MockServer] 保存配置失败:", e);
      }
    },

    loadConfig: async (id) => {
      try {
        const config = await mockService.loadMockConfig(id);
        if (!config) return;
        const routes: MockRoute[] = JSON.parse(config.routesJson || "[]");
        set({
          configId: config.id,
          port: config.port,
          routes,
          proxyTarget: config.proxyTarget || "",
          selectedRouteId: routes.length > 0 ? routes[0].id : null,
        });
      } catch (e) {
        console.error("[MockServer] 加载配置失败:", e);
      }
    },

    importRoutes: (routes) => {
      set({ routes, selectedRouteId: routes.length > 0 ? routes[0].id : null });
      scheduleAutoSave(get);
    },

    exportRoutes: () => get().routes,

    clearLogs: async () => {
      await mockService.clearMockServerLog(sessionId);
      set({ logs: [], totalHits: 0 });
    },

    loadLogs: async () => {
      const logs = await mockService.getMockServerLog(sessionId);
      set({ logs });
    },

    refreshStatus: async () => {
      try {
        const status: MockServerStatusInfo =
          await mockService.getMockServerStatus(sessionId);
        set({
          running: status.running,
          port: status.port,
          totalHits: status.totalHits,
        });
      } catch {
        // ignore
      }
    },

    initListener: () => {
      if (!listenerPromise) {
        listenerPromise = listen<MockRequestLog>(
          "mock-server-hit",
          (event) => {
            const log = event.payload;
            if (log.sessionId !== sessionId) return;
            set((s) => {
              const newLogs = [...s.logs, log];
              if (newLogs.length > 2000) newLogs.splice(0, newLogs.length - 2000);
              return {
                logs: newLogs,
                totalHits: s.totalHits + 1,
              };
            });
          },
        );
      }
      return Promise.resolve(() => {});
    },
  }));
}

function getOrCreateStore(sessionId: string): MockServerStoreApi {
  let store = stores.get(sessionId);
  if (!store) {
    store = createMockServerSessionStore(sessionId);
    stores.set(sessionId, store);
  }
  return store;
}

/** React hook */
export function useMockServerStore<T>(
  sessionId: string,
  selector: (state: MockServerStoreState) => T,
): T {
  return useStore(getOrCreateStore(sessionId), selector);
}

export function getMockServerStoreApi(sessionId: string): MockServerStoreApi {
  return getOrCreateStore(sessionId);
}

export function destroyMockServerStore(sessionId: string) {
  const cleanup = cleanupFns.get(sessionId);
  if (cleanup) { cleanup(); cleanupFns.delete(sessionId); }
  stores.delete(sessionId);
}
