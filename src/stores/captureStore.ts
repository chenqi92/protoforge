import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { CapturedEntry, ProxyStatusInfo } from "@/types/capture";
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

    startCapture: async (port?: number) => {
      const p = port ?? get().port;
      try {
        await captureService.startProxy(sessionId, p);
        set({ running: true, port: p, error: null });
        console.log(`[CAPTURE] 代理已启动: session=${sessionId}, port=${p}`);
      } catch (e) {
        const msg = String(e);
        console.error(`[CAPTURE] 代理启动失败: ${msg}`);
        set({ error: msg });
        throw e;
      }
    },

    stopCapture: async () => {
      await captureService.stopProxy(sessionId);
      set({ running: false });
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

    initListener: async () => {
      if (!listenerPromise) {
        console.log(`[CAPTURE] 正在注册事件监听器: session=${sessionId}`);
        listenerPromise = listen<CapturedEntry>("capture-event", (event) => {
          const entry = event.payload;
          console.log("[CAPTURE] 收到事件:", entry.sessionId, "期望:", sessionId, "url:", entry.url, "匹配:", entry.sessionId === sessionId);
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
        }).then((unlisten) => () => {
          listenerPromise = null;
          unlisten();
        });
      }

      return listenerPromise;
    },
  }));
}

function getCaptureStore(sessionId: string): CaptureStoreApi {
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
