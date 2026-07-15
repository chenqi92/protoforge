import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  BreakpointRule,
  CapturedEntry,
  PausedRequest,
  PausedRequestRemoved,
  ProxyStatusInfo,
  ResumeModification,
} from "@/types/capture";
import * as captureService from "@/services/captureService";
import { registerToolStoreDetacher } from "@/stores/toolStoreLifecycle";

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

const MAX_RENDERER_CAPTURE_ENTRIES = 5_000;
const MAX_RENDERER_CAPTURE_BYTES = 64 * 1024 * 1024;
const captureUtf8Encoder = new TextEncoder();

function capturedEntrySize(entry: CapturedEntry): number {
  let bytes = 64;
  const values = [
    entry.sessionId,
    entry.id,
    entry.method,
    entry.url,
    entry.host,
    entry.path,
    entry.statusText,
    entry.requestBody,
    entry.responseBody,
    entry.requestBodyRaw,
    entry.responseBodyRaw,
    entry.contentType,
    entry.requestContentType,
    entry.timestamp,
    entry.httpVersion,
  ];
  for (const value of values) {
    if (value) bytes += captureUtf8Encoder.encode(value).byteLength;
  }
  for (const [name, value] of [...entry.requestHeaders, ...entry.responseHeaders]) {
    bytes += captureUtf8Encoder.encode(name).byteLength;
    bytes += captureUtf8Encoder.encode(value).byteLength;
  }
  return bytes;
}

const captureStores = new Map<string, CaptureStoreApi>();
const captureStoreCleanupFns = new Map<string, () => void>();

async function registerCaptureListeners(
  registrations: Promise<UnlistenFn>[],
): Promise<UnlistenFn[]> {
  const results = await Promise.allSettled(registrations);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    // Promise.all would discard listeners that registered before a sibling
    // failed, leaking callbacks and duplicating captured entries on retry.
    for (const result of results) {
      if (result.status === 'fulfilled') result.value();
    }
    throw failure.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<UnlistenFn>).value);
}

function createCaptureSessionStore(sessionId: string) {
  let listenerPromise: Promise<UnlistenFn[]> | null = null;
  let listenerSubscribers = 0;
  let entriesDestructiveEpoch = 0;
  let entriesLiveEpoch = 0;
  let entriesRequestSequence = 0;
  let entriesReloadScheduled = false;
  let clearedThroughCaptureSeq = 0;
  let pausedDestructiveEpoch = 0;
  let pausedLiveEpoch = 0;
  let pausedRequestSequence = 0;
  let pausedReloadScheduled = false;
  let statusOperationEpoch = 0;
  let statusRequestSequence = 0;
  let pendingLifecycleActionEpoch: number | null = null;
  let lifecycleQueue: Promise<void> = Promise.resolve();
  let retainedEntryBytes = 0;
  const retainedEntrySizes = new Map<string, number>();
  const pausedTombstones = new Set<string>();

  const retainNewestEntries = (entries: CapturedEntry[]): CapturedEntry[] => {
    const retained: CapturedEntry[] = [];
    const sizes = new Map<string, number>();
    let bytes = 0;

    for (
      let index = entries.length - 1;
      index >= 0 && retained.length < MAX_RENDERER_CAPTURE_ENTRIES;
      index -= 1
    ) {
      const entry = entries[index];
      const size = capturedEntrySize(entry);
      if (size > MAX_RENDERER_CAPTURE_BYTES) continue;
      if (bytes + size > MAX_RENDERER_CAPTURE_BYTES) break;
      retained.push(entry);
      sizes.set(entry.id, size);
      bytes += size;
    }

    retained.reverse();
    retainedEntrySizes.clear();
    for (const [id, size] of sizes) retainedEntrySizes.set(id, size);
    retainedEntryBytes = bytes;
    return retained;
  };

  const rememberPausedTombstone = (requestId: string) => {
    // UUIDs are not reused. A bounded tombstone set also blocks a delayed
    // breakpoint event after its request was resumed or automatically removed.
    if (pausedTombstones.size >= 4096) {
      const oldest = pausedTombstones.values().next().value;
      if (oldest !== undefined) pausedTombstones.delete(oldest);
    }
    pausedTombstones.add(requestId);
  };

  const entrySurvivesClearFence = (entry: CapturedEntry) => {
    if (clearedThroughCaptureSeq === 0) return true;
    return Number.isSafeInteger(entry.captureSeq) && entry.captureSeq > clearedThroughCaptureSeq;
  };

  const enqueueLifecycleMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleQueue.then(operation, operation);
    lifecycleQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const disposeListeners = () => {
    listenerSubscribers = 0;
    const activePromise = listenerPromise;
    listenerPromise = null;
    if (activePromise) {
      void activePromise
        .then((unlisteners) => unlisteners.forEach((fn) => fn()))
        .catch(() => {});
    }
    retainedEntrySizes.clear();
    retainedEntryBytes = 0;
  };
  captureStoreCleanupFns.set(sessionId, disposeListeners);

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
      const actionEpoch = ++statusOperationEpoch;
      pendingLifecycleActionEpoch = actionEpoch;
      const syncBreakpointsAfterStart = () => {
        const rules = get().breakpoints;
        if (rules.length > 0) {
          captureService.setBreakpoints(sessionId, rules).catch((err) => {
            console.error(`[CAPTURE] 启动后同步断点规则失败:`, err);
          });
        }
      };
      try {
        const existingStatus = await enqueueLifecycleMutation(async () => {
          try {
            const status = await captureService.getProxyStatus(sessionId);
            if (status.running && status.port === p) return status;
          } catch {
            // The start command remains the source of truth when the optional
            // idempotency preflight is unavailable.
          }
          await captureService.startProxy(sessionId, p);
          return null;
        });
        if (statusOperationEpoch !== actionEpoch) return;
        // Invalidate status requests started while the mutation was in flight.
        statusOperationEpoch += 1;
        pendingLifecycleActionEpoch = null;
        set({ running: true, port: existingStatus?.port ?? p, error: null });
        // 把已配置的断点规则推送到后端（确保启动前设置的规则生效）
        syncBreakpointsAfterStart();
      } catch (e) {
        const msg = String(e);
        if (statusOperationEpoch === actionEpoch) {
          let status: ProxyStatusInfo | null = null;
          try {
            status = await captureService.getProxyStatus(sessionId);
          } catch {
            // Preserve the command error if reconciliation is unavailable.
          }
          if (statusOperationEpoch !== actionEpoch) throw e;
          statusOperationEpoch += 1;
          pendingLifecycleActionEpoch = null;
          if (status?.running && status.port === p) {
            set({ running: true, port: status.port, error: null });
            syncBreakpointsAfterStart();
            return;
          }
          if (status) {
            set({ running: status.running, port: status.port, error: msg });
          } else {
            set({ error: msg });
          }
        }
        throw e;
      }
    },

    stopCapture: async () => {
      const actionEpoch = ++statusOperationEpoch;
      pendingLifecycleActionEpoch = actionEpoch;
      try {
        await enqueueLifecycleMutation(async () => {
          try {
            const status = await captureService.getProxyStatus(sessionId);
            if (!status.running) return;
          } catch {
            // Fall through to the mutation if status probing fails.
          }
          await captureService.stopProxy(sessionId);
        });
        // Every successful stop invalidates paused snapshots, even when a newer
        // queued start is now the latest lifecycle intent.
        pausedDestructiveEpoch += 1;
        for (const request of get().pausedRequests) rememberPausedTombstone(request.id);
        set({ pausedRequests: [] });
        if (statusOperationEpoch !== actionEpoch) return;
        statusOperationEpoch += 1;
        pendingLifecycleActionEpoch = null;
        set({ running: false, pausedRequests: [], error: null });
      } catch (e) {
        if (statusOperationEpoch === actionEpoch) {
          let status: ProxyStatusInfo | null = null;
          try {
            status = await captureService.getProxyStatus(sessionId);
          } catch {
            // Preserve the command error if reconciliation is unavailable.
          }
          if (statusOperationEpoch !== actionEpoch) throw e;
          statusOperationEpoch += 1;
          pendingLifecycleActionEpoch = null;
          if (status && !status.running) {
            pausedDestructiveEpoch += 1;
            for (const request of get().pausedRequests) rememberPausedTombstone(request.id);
            set({ running: false, port: status.port, pausedRequests: [], error: null });
            return;
          }
          if (status) {
            set({ running: true, port: status.port, error: String(e) });
          } else {
            set({ error: String(e) });
          }
        }
        throw e;
      }
    },

    clearEntries: async () => {
      const clearedThrough = await captureService.clearEntries(sessionId);
      clearedThroughCaptureSeq = Math.max(clearedThroughCaptureSeq, clearedThrough);
      entriesDestructiveEpoch += 1;
      set((state) => {
        const entries = retainNewestEntries(state.entries.filter(entrySurvivesClearFence));
        return {
          entries,
          selectedEntryId: entries.some((entry) => entry.id === state.selectedEntryId)
            ? state.selectedEntryId
            : entries[entries.length - 1]?.id ?? null,
        };
      });
      if (!entriesReloadScheduled) {
        entriesReloadScheduled = true;
        queueMicrotask(() => {
          entriesReloadScheduled = false;
          void get().loadEntries();
        });
      }
    },

    setFilter: (filter) => set({ filter }),
    setSelectedEntry: (id) => set({ selectedEntryId: id }),
    setDetailTab: (tab) => set({ detailTab: tab }),

    refreshStatus: async () => {
      const operationEpoch = statusOperationEpoch;
      const requestSequence = ++statusRequestSequence;
      try {
        const status: ProxyStatusInfo = await captureService.getProxyStatus(sessionId);
        if (
          statusOperationEpoch !== operationEpoch
          || statusRequestSequence !== requestSequence
          || pendingLifecycleActionEpoch !== null
        ) return;
        if (!status.running) {
          pausedDestructiveEpoch += 1;
          for (const request of get().pausedRequests) rememberPausedTombstone(request.id);
          set({ running: false, port: status.port, pausedRequests: [] });
          return;
        }
        set({ running: status.running, port: status.port });
      } catch (e) {
        console.error(`[CAPTURE] refreshStatus 失败:`, e);
      }
    },

    loadEntries: async () => {
      try {
        const requestDestructiveEpoch = entriesDestructiveEpoch;
        const requestLiveEpoch = entriesLiveEpoch;
        const requestSequence = ++entriesRequestSequence;
        const snapshot = await captureService.getEntries(sessionId);
        if (entriesRequestSequence !== requestSequence) return;
        // A clear completed after this snapshot began. The response may contain
        // precisely the rows clear removed, so it must never be merged.
        if (entriesDestructiveEpoch !== requestDestructiveEpoch) {
          if (!entriesReloadScheduled) {
            entriesReloadScheduled = true;
            queueMicrotask(() => {
              entriesReloadScheduled = false;
              void get().loadEntries();
            });
          }
          return;
        }
        const entries = snapshot.filter(entrySurvivesClearFence);
        set((state) => {
          let nextEntries = entries;
          if (entriesLiveEpoch !== requestLiveEpoch) {
            const merged = new Map(entries.map((entry) => [entry.id, entry]));
            for (const entry of state.entries) {
              const snapshotEntry = merged.get(entry.id);
              if (entry.completed || !snapshotEntry?.completed) merged.set(entry.id, entry);
            }
            nextEntries = Array.from(merged.values()).slice(-5000);
          }
          nextEntries = retainNewestEntries(nextEntries);
          return {
            entries: nextEntries,
            selectedEntryId: nextEntries.some((entry) => entry.id === state.selectedEntryId)
              ? state.selectedEntryId
              : nextEntries[nextEntries.length - 1]?.id ?? null,
          };
        });
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
        const requestDestructiveEpoch = pausedDestructiveEpoch;
        const requestLiveEpoch = pausedLiveEpoch;
        const requestSequence = ++pausedRequestSequence;
        const paused = await captureService.listPaused(sessionId);
        if (pausedRequestSequence !== requestSequence) return;
        // Never merge a snapshot that predates resume, stop, timeout, or an
        // automatic backend removal: doing so resurrects deleted requests.
        if (pausedDestructiveEpoch !== requestDestructiveEpoch) {
          if (!pausedReloadScheduled) {
            pausedReloadScheduled = true;
            queueMicrotask(() => {
              pausedReloadScheduled = false;
              void get().loadPaused();
            });
          }
          return;
        }
        const visiblePaused = paused.filter((request) => !pausedTombstones.has(request.id));
        set((state) => {
          if (pausedLiveEpoch === requestLiveEpoch) {
            return { pausedRequests: visiblePaused };
          }
          const merged = new Map(visiblePaused.map((request) => [request.id, request]));
          for (const request of state.pausedRequests) {
            if (!pausedTombstones.has(request.id)) merged.set(request.id, request);
          }
          return { pausedRequests: Array.from(merged.values()) };
        });
      } catch (e) {
        console.error(`[CAPTURE] loadPaused 失败:`, e);
      }
    },

    resumePaused: async (pausedId: string, modified?: ResumeModification) => {
      await captureService.resumeRequest(sessionId, pausedId, modified);
      rememberPausedTombstone(pausedId);
      pausedDestructiveEpoch += 1;
      set((state) => ({
        pausedRequests: state.pausedRequests.filter((p) => p.id !== pausedId),
      }));
    },

    initListener: async () => {
      listenerSubscribers += 1;
      if (!listenerPromise) {
        listenerPromise = registerCaptureListeners([
          listen<CapturedEntry>("capture-event", (event) => {
            const entry = event.payload;
            if (entry.sessionId !== sessionId) {
              return;
            }
            if (!entrySurvivesClearFence(entry)) return;

            entriesLiveEpoch += 1;
            set((state) => {
              const existingIndex = state.entries.findIndex((item) => item.id === entry.id);
              if (existingIndex >= 0) {
                const existing = state.entries[existingIndex];
                // A delayed request-start event must not downgrade a completed
                // response that was already delivered or loaded by snapshot.
                if (existing.completed && !entry.completed) return state;
                const nextEntries = [...state.entries];
                nextEntries[existingIndex] = entry;
                retainedEntryBytes -= retainedEntrySizes.get(entry.id) ?? capturedEntrySize(existing);
                const replacementSize = capturedEntrySize(entry);
                retainedEntrySizes.set(entry.id, replacementSize);
                retainedEntryBytes += replacementSize;
                while (
                  nextEntries.length > 0
                  && (nextEntries.length > MAX_RENDERER_CAPTURE_ENTRIES
                    || retainedEntryBytes > MAX_RENDERER_CAPTURE_BYTES)
                ) {
                  const removed = nextEntries.shift()!;
                  retainedEntryBytes -= retainedEntrySizes.get(removed.id) ?? capturedEntrySize(removed);
                  retainedEntrySizes.delete(removed.id);
                }
                return {
                  entries: nextEntries,
                  selectedEntryId: nextEntries.some((item) => item.id === state.selectedEntryId)
                    ? state.selectedEntryId
                    : nextEntries[nextEntries.length - 1]?.id ?? null,
                };
              }

              const nextEntries = [...state.entries, entry];
              const entrySize = capturedEntrySize(entry);
              retainedEntrySizes.set(entry.id, entrySize);
              retainedEntryBytes += entrySize;
              while (
                nextEntries.length > 0
                && (nextEntries.length > MAX_RENDERER_CAPTURE_ENTRIES
                  || retainedEntryBytes > MAX_RENDERER_CAPTURE_BYTES)
              ) {
                const removed = nextEntries.shift()!;
                retainedEntryBytes -= retainedEntrySizes.get(removed.id) ?? capturedEntrySize(removed);
                retainedEntrySizes.delete(removed.id);
              }

              return {
                entries: nextEntries,
                selectedEntryId: nextEntries.some((item) => item.id === state.selectedEntryId)
                  ? state.selectedEntryId
                  : nextEntries[nextEntries.length - 1]?.id ?? null,
              };
            });
          }),
          listen<PausedRequest>("capture-breakpoint", (event) => {
            const paused = event.payload;
            if (paused.sessionId !== sessionId) {
              return;
            }
            if (pausedTombstones.has(paused.id)) return;
            pausedLiveEpoch += 1;
            set((state) =>
              state.pausedRequests.some((p) => p.id === paused.id)
                ? state
                : { pausedRequests: [...state.pausedRequests, paused] }
            );
          }),
          listen<PausedRequestRemoved>("capture:paused-removed", (event) => {
            const removed = event.payload;
            if (removed.sessionId !== sessionId) return;
            rememberPausedTombstone(removed.requestId);
            pausedDestructiveEpoch += 1;
            set((state) => ({
              pausedRequests: state.pausedRequests.filter(
                (request) => request.id !== removed.requestId,
              ),
            }));
          }),
        ]);
      }

      const activePromise = listenerPromise;
      try {
        await activePromise;
      } catch (error) {
        listenerSubscribers = Math.max(0, listenerSubscribers - 1);
        if (listenerPromise === activePromise) listenerPromise = null;
        throw error;
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        listenerSubscribers = Math.max(0, listenerSubscribers - 1);
        if (listenerSubscribers === 0 && listenerPromise === activePromise) {
          listenerPromise = null;
          void activePromise.then((unlisteners) => unlisteners.forEach((fn) => fn()));
        }
      };
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
  detachCaptureStore(sessionId);
}

/** 在异步后端销毁前同步分离当前前端实例，避免误删同 ID 的新实例。 */
export function detachCaptureStore(sessionId: string): CaptureStoreApi | undefined {
  const store = captureStores.get(sessionId);
  if (!store) return undefined;
  captureStoreCleanupFns.get(sessionId)?.();
  captureStoreCleanupFns.delete(sessionId);
  if (captureStores.get(sessionId) === store) captureStores.delete(sessionId);
  return store;
}

registerToolStoreDetacher("capture", (sessionId) => {
  detachCaptureStore(sessionId);
  return undefined;
});
