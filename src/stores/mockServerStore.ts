// Mock Server Zustand Store — 每个 session 独立实例

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  MockRoute,
  MockRequestLog,
  MockServerStatusInfo,
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

  // 路由管理
  addRoute: () => void;
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

function createMockServerSessionStore(sessionId: string) {
  let listenerPromise: Promise<UnlistenFn> | null = null;

  return createStore<MockServerStoreState>((set, get) => ({
    sessionId,
    running: false,
    port: 3100,
    routes: [],
    selectedRouteId: null,
    logs: [],
    totalHits: 0,
    error: null,

    addRoute: () => {
      const newRoute = createEmptyRoute();
      set((s) => ({
        routes: [...s.routes, newRoute],
        selectedRouteId: newRoute.id,
      }));
    },

    updateRoute: (id, patch) => {
      set((s) => ({
        routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }));
    },

    removeRoute: (id) => {
      set((s) => ({
        routes: s.routes.filter((r) => r.id !== id),
        selectedRouteId:
          s.selectedRouteId === id ? null : s.selectedRouteId,
      }));
    },

    duplicateRoute: (id) => {
      const state = get();
      const source = state.routes.find((r) => r.id === id);
      if (!source) return;
      const copy: MockRoute = {
        ...source,
        id: crypto.randomUUID(),
        description: source.description
          ? `${source.description} (copy)`
          : "(copy)",
      };
      const idx = state.routes.findIndex((r) => r.id === id);
      const newRoutes = [...state.routes];
      newRoutes.splice(idx + 1, 0, copy);
      set({ routes: newRoutes, selectedRouteId: copy.id });
    },

    reorderRoutes: (fromIndex, toIndex) => {
      set((s) => {
        const newRoutes = [...s.routes];
        const [moved] = newRoutes.splice(fromIndex, 1);
        newRoutes.splice(toIndex, 0, moved);
        return { routes: newRoutes };
      });
    },

    setSelectedRoute: (id) => set({ selectedRouteId: id }),

    startServer: async (port?: number) => {
      const p = port ?? get().port;
      const routes = get().routes;
      try {
        await mockService.startMockServer(sessionId, p, routes);
        set({ running: true, port: p, error: null });
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

    setPort: (port) => set({ port }),

    syncRoutesToServer: async () => {
      if (!get().running) return;
      try {
        await mockService.updateMockRoutes(sessionId, get().routes);
      } catch (e) {
        set({ error: String(e) });
      }
    },

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
      // Store 级别的 listener，只创建一次，不随组件 unmount 销毁
      // 避免切换 tab 后回来丢失事件
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
      // 返回空 unlisten — listener 跟随 store 生命周期，由 destroyMockServerStore 清理
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

/** React hook — 使用方式: useMockServerStore(sessionId, s => s.running) */
export function useMockServerStore<T>(
  sessionId: string,
  selector: (state: MockServerStoreState) => T,
): T {
  return useStore(getOrCreateStore(sessionId), selector);
}

export function getMockServerStoreApi(sessionId: string): MockServerStoreApi {
  return getOrCreateStore(sessionId);
}

/** 销毁 session store（session 关闭时调用，防止内存泄漏） */
export function destroyMockServerStore(sessionId: string) {
  const store = stores.get(sessionId);
  if (store) {
    // 清理事件监听
    const state = store.getState();
    // initListener 内部的 listenerPromise 会在 GC 时释放
    stores.delete(sessionId);
  }
}
