import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  BreakpointRule,
  CapturedEntry,
  PausedRequest,
  ProxyStatusInfo,
  ResumeModification,
} from "@/types/capture";
import * as captureService from "@/services/captureService";

type DetailTab = "headers" | "body" | "preview";

interface CaptureStoreState {
  sessionId: string;
  running: boolean;
  port: number;
  entries: CapturedEntry[];
  selectedEntryId: string | null;
  filter: string;
  detailTab: DetailTab;
  error: string | null;
  breakpoints: BreakpointRule[];
  pausedRequests: PausedRequest[];
  startCapture: (port?: number) => Promise<void>;
  stopCapture: () => Promise<void>;
  clearEntries: () => Promise<void>;
  setFilter: (filter: string) => void;
  setSelectedEntry: (id: string | null) => void;
  setDetailTab: (tab: DetailTab) => void;
  refreshStatus: () => Promise<void>;
  loadEntries: () => Promise<void>;
  exportCaCert: () => Promise<string>;
  initListener: () => Promise<UnlistenFn>;
  testConnection: () => Promise<string>;
  // 重放
  replayEntry: (entryId: string) => Promise<CapturedEntry>;
  // 断点规则
  loadBreakpoints: () => Promise<void>;
  syncBreakpoints: (rules: BreakpointRule[]) => Promise<void>;
  addBreakpoint: (rule: Omit<BreakpointRule, "id">) => Promise<void>;
  updateBreakpoint: (id: string, patch: Partial<Omit<BreakpointRule, "id">>) => Promise<void>;
  removeBreakpoint: (id: string) => Promise<void>;
  toggleBreakpoint: (id: string) => Promise<void>;
  // 挂起请求
  loadPaused: () => Promise<void>;
  resumePaused: (pausedId: string, modified?: ResumeModification) => Promise<void>;
}

type CaptureStoreApi = ReturnType<typeof createCaptureSessionStore>;

const captureStores = new Map<string, CaptureStoreApi>();

function createCaptureSessionStore(sessionId: string) {
  let listenerPromise: Promise<UnlistenFn> | null = null;

  return createStore<CaptureStoreState>((set, get) => ({
    sessionId,
    running: false,
    port: 9090,
    entries: [],
    selectedEntryId: null,
    filter: "",
    detailTab: "headers",
    error: null,
    breakpoints: [],
    pausedRequests: [],

    startCapture: async (port?: number) => {
      const p = port ?? get().port;
      try {
        await captureService.startProxy(sessionId, p);
        set({ running: true, port: p, error: null });
        // 把已配置的断点规则推送到后端（确保启动前设置的规则生效）
        const rules = get().breakpoints;
        if (rules.length > 0) {
          captureService.setBreakpoints(sessionId, rules).catch((err) => {
            console.error(`[CAPTURE] 启动后同步断点规则失败:`, err);
          });
        }
      } catch (e) {
        const msg = String(e);
        set({ error: msg });
        throw e;
      }
    },

    stopCapture: async () => {
      await captureService.stopProxy(sessionId);
      set({ running: false, pausedRequests: [] });
    },

    clearEntries: async () => {
      await captureService.clearEntries(sessionId);
      set({ entries: [], selectedEntryId: null });
    },

    setFilter: (filter) => set({ filter }),
    setSelectedEntry: (id) => set({ selectedEntryId: id }),
    setDetailTab: (tab) => set({ detailTab: tab }),

    refreshStatus: async () => {
      try {
        const status: ProxyStatusInfo = await captureService.getProxyStatus(sessionId);
        set({ running: status.running, port: status.port });
      } catch (e) {
        console.error(`[CAPTURE] refreshStatus 失败:`, e);
      }
    },

    loadEntries: async () => {
      try {
        const entries = await captureService.getEntries(sessionId);
        set((state) => ({
          entries,
          selectedEntryId: entries.some((entry) => entry.id === state.selectedEntryId)
            ? state.selectedEntryId
            : entries[entries.length - 1]?.id ?? null,
        }));
      } catch (e) {
        console.error(`[CAPTURE] loadEntries 失败:`, e);
      }
    },

    exportCaCert: async () => captureService.exportCaCert(),

    testConnection: async () => {
      const port = get().port;
      return captureService.testProxyConnection(port);
    },

    replayEntry: async (entryId: string) => {
      return captureService.replayEntry(sessionId, entryId);
    },

    loadBreakpoints: async () => {
      try {
        const rules = await captureService.listBreakpoints(sessionId);
        set({ breakpoints: rules });
      } catch (e) {
        console.error(`[CAPTURE] loadBreakpoints 失败:`, e);
      }
    },

    syncBreakpoints: async (rules: BreakpointRule[]) => {
      set({ breakpoints: rules });
      try {
        await captureService.setBreakpoints(sessionId, rules);
      } catch (e) {
        console.error(`[CAPTURE] setBreakpoints 失败:`, e);
      }
    },

    addBreakpoint: async (rule) => {
      const next = [
        ...get().breakpoints,
        { ...rule, id: crypto.randomUUID() } as BreakpointRule,
      ];
      await get().syncBreakpoints(next);
    },

    updateBreakpoint: async (id, patch) => {
      const next = get().breakpoints.map((r) => (r.id === id ? { ...r, ...patch } : r));
      await get().syncBreakpoints(next);
    },

    removeBreakpoint: async (id) => {
      const next = get().breakpoints.filter((r) => r.id !== id);
      await get().syncBreakpoints(next);
    },

    toggleBreakpoint: async (id) => {
      const next = get().breakpoints.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      );
      await get().syncBreakpoints(next);
    },

    loadPaused: async () => {
      try {
        const paused = await captureService.listPaused(sessionId);
        set({ pausedRequests: paused });
      } catch (e) {
        console.error(`[CAPTURE] loadPaused 失败:`, e);
      }
    },

    resumePaused: async (pausedId: string, modified?: ResumeModification) => {
      await captureService.resumeRequest(sessionId, pausedId, modified);
      set((state) => ({
        pausedRequests: state.pausedRequests.filter((p) => p.id !== pausedId),
      }));
    },

    initListener: async () => {
      if (!listenerPromise) {
        listenerPromise = Promise.all([
          listen<CapturedEntry>("capture-event", (event) => {
            const entry = event.payload;
            if (entry.sessionId !== sessionId) {
              return;
            }

            set((state) => {
              if (entry.completed) {
                const existingIndex = state.entries.findIndex((item) => item.id === entry.id);
                if (existingIndex >= 0) {
                  const nextEntries = [...state.entries];
                  nextEntries[existingIndex] = entry;
                  return { entries: nextEntries };
                }
              }

              const nextEntries =
                state.entries.length >= 5000
                  ? [...state.entries.slice(1), entry]
                  : [...state.entries, entry];

              return { entries: nextEntries };
            });
          }),
          listen<PausedRequest>("capture-breakpoint", (event) => {
            const paused = event.payload;
            if (paused.sessionId !== sessionId) {
              return;
            }
            set((state) =>
              state.pausedRequests.some((p) => p.id === paused.id)
                ? state
                : { pausedRequests: [...state.pausedRequests, paused] }
            );
          }),
        ]).then((unlisteners) => () => {
          listenerPromise = null;
          unlisteners.forEach((fn) => fn());
        });
      }

      return listenerPromise;
    },
  }));
}

export function getCaptureStore(sessionId: string): CaptureStoreApi {
  let store = captureStores.get(sessionId);

  if (!store) {
    store = createCaptureSessionStore(sessionId);
    captureStores.set(sessionId, store);
  }

  return store;
}

export function useCaptureStore<T>(
  sessionId: string,
  selector: (state: CaptureStoreState) => T
): T {
  return useStore(getCaptureStore(sessionId), selector);
}

/** 释放指定会话的 store 实例，防止内存泄漏 */
export function destroyCaptureStore(sessionId: string) {
  captureStores.delete(sessionId);
}
