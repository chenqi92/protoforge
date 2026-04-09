// ProtoForge Workflow Store — manages workflow list, active editing, execution state

import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  Workflow,
  WorkflowProgressEvent,
  NodeResult,
  ExecutionStatus,
} from '@/types/workflow';
import * as api from '@/services/workflowService';

interface WorkflowStore {
  // ── Data ──
  workflows: Workflow[];
  loading: boolean;

  // ── Active editing ──
  activeWorkflowId: string | null;
  dirty: boolean;

  // ── Execution ──
  executionId: string | null;
  executionStatus: ExecutionStatus | null;
  executionError: string | null;
  executionProgress: WorkflowProgressEvent | null;
  nodeResults: NodeResult[];

  // ── Actions: CRUD ──
  fetchWorkflows: () => Promise<void>;
  createWorkflow: (name: string) => Promise<Workflow>;
  saveWorkflow: (workflow: Workflow) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  setActiveWorkflowId: (id: string | null) => void;
  setDirty: (dirty: boolean) => void;

  // ── Actions: Execution ──
  runWorkflow: (id: string) => Promise<void>;
  cancelExecution: () => Promise<void>;
  clearExecution: () => void;

  // ── Event listener ──
  subscribeProgress: () => Promise<UnlistenFn>;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  loading: false,
  activeWorkflowId: null,
  dirty: false,
  executionId: null,
  executionStatus: null,
  executionError: null,
  executionProgress: null,
  nodeResults: [],

  fetchWorkflows: async () => {
    set({ loading: true });
    try {
      const workflows = await api.listWorkflows();
      set({ workflows, loading: false });
    } catch (e) {
      console.error('[workflow] fetch failed:', e);
      set({ loading: false });
    }
  },

  createWorkflow: async (name: string) => {
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      name,
      description: '',
      nodes: [],
      edges: [],
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created = await api.createWorkflow(workflow);
    set((s) => ({ workflows: [...s.workflows, created], activeWorkflowId: created.id }));
    return created;
  },

  saveWorkflow: async (workflow: Workflow) => {
    const updated = { ...workflow, updatedAt: new Date().toISOString() };
    await api.updateWorkflow(updated);
    set((s) => ({
      workflows: s.workflows.map((w) => (w.id === updated.id ? updated : w)),
      dirty: false,
    }));
  },

  deleteWorkflow: async (id: string) => {
    await api.deleteWorkflow(id);
    set((s) => ({
      workflows: s.workflows.filter((w) => w.id !== id),
      activeWorkflowId: s.activeWorkflowId === id ? null : s.activeWorkflowId,
    }));
  },

  setActiveWorkflowId: (id) => set({ activeWorkflowId: id, dirty: false }),
  setDirty: (dirty) => set({ dirty }),

  runWorkflow: async (id: string) => {
    set({ executionStatus: 'running', executionError: null, nodeResults: [], executionProgress: null });
    try {
      const executionId = await api.runWorkflow(id);
      set({ executionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ executionStatus: 'failed', executionId: null, executionError: msg });
      console.error('[workflow] run failed:', e);
    }
  },

  cancelExecution: async () => {
    const { executionId } = get();
    if (!executionId) return;
    try {
      await api.cancelWorkflow(executionId);
      set({ executionStatus: 'cancelled' });
    } catch (e) {
      console.error('[workflow] cancel failed:', e);
    }
  },

  clearExecution: () =>
    set({ executionId: null, executionStatus: null, executionError: null, executionProgress: null, nodeResults: [] }),

  subscribeProgress: async () => {
    return listen<WorkflowProgressEvent>('workflow-progress', (event) => {
      const progress = event.payload;
      // Use functional set() to read + write state atomically, avoiding race conditions
      // when multiple progress events arrive in quick succession
      set((state) => {
        let nodeResults = state.nodeResults;
        if (progress.nodeResult) {
          const idx = nodeResults.findIndex((r) => r.nodeId === progress.nodeResult!.nodeId);
          if (idx >= 0) {
            nodeResults = [...nodeResults];
            nodeResults[idx] = progress.nodeResult;
          } else {
            nodeResults = [...nodeResults, progress.nodeResult];
          }
        }
        return {
          executionProgress: progress,
          executionStatus: progress.status,
          nodeResults,
        };
      });
    });
  },
}));
