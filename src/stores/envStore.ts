// ProtoForge Environment Store — Zustand

import { create } from 'zustand';
import type { Environment, EnvVariable, GlobalVariable } from '@/types/collections';
import { nowISO } from '@/types/collections';
import * as svc from '@/services/envService';

interface EnvStore {
  environments: Environment[];
  activeEnvId: string | null;
  variables: Record<string, EnvVariable[]>;  // envId → variables
  globalVariables: GlobalVariable[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchEnvironments: () => Promise<void>;
  fetchVariables: (envId: string) => Promise<void>;
  fetchGlobalVariables: () => Promise<void>;
  createEnvironment: (name: string) => Promise<Environment>;
  setActive: (id: string | null) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  saveVariables: (envId: string, vars: EnvVariable[]) => Promise<void>;
  saveGlobalVars: (vars: GlobalVariable[]) => Promise<void>;
  getResolvedVariables: () => Record<string, string>;
}

export const useEnvStore = create<EnvStore>((set, get) => ({
  environments: [],
  activeEnvId: null,
  variables: {},
  globalVariables: [],
  loading: false,
  error: null,

  fetchEnvironments: async () => {
    set({ loading: true, error: null });
    try {
      const environments = await svc.listEnvironments();
      const active = environments.find((e) => e.isActive === 1);
      set({ environments, activeEnvId: active?.id || null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchVariables: async (envId: string) => {
    try {
      const vars = await svc.listEnvVariables(envId);
      set((s) => ({ variables: { ...s.variables, [envId]: vars } }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchGlobalVariables: async () => {
    try {
      const globalVariables = await svc.listGlobalVariables();
      set({ globalVariables });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createEnvironment: async (name: string) => {
    const now = nowISO();
    const env: Environment = {
      id: crypto.randomUUID(),
      name,
      isActive: 0,
      sortOrder: get().environments.length,
      createdAt: now,
      updatedAt: now,
    };
    const created = await svc.createEnvironment(env);
    set((s) => ({ environments: [...s.environments, created] }));
    return created;
  },

  setActive: async (id: string | null) => {
    await svc.setActiveEnvironment(id);
    set((s) => ({
      activeEnvId: id,
      environments: s.environments.map((e) => ({
        ...e,
        isActive: e.id === id ? 1 : 0,
      })),
    }));
  },

  deleteEnvironment: async (id: string) => {
    await svc.deleteEnvironment(id);
    set((s) => ({
      environments: s.environments.filter((e) => e.id !== id),
      activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
      variables: Object.fromEntries(Object.entries(s.variables).filter(([k]) => k !== id)),
    }));
  },

  saveVariables: async (envId: string, vars: EnvVariable[]) => {
    await svc.saveEnvVariables(envId, vars);
    set((s) => ({ variables: { ...s.variables, [envId]: vars } }));
  },

  saveGlobalVars: async (vars: GlobalVariable[]) => {
    await svc.saveGlobalVariables(vars);
    set({ globalVariables: vars });
  },

  // 获取当前活跃环境的已解析变量（用于 URL/Header 中的 {{var}} 替换）
  getResolvedVariables: () => {
    const state = get();
    const result: Record<string, string> = {};

    // 全局变量优先级低
    for (const gv of state.globalVariables) {
      if (gv.enabled) result[gv.key] = gv.value;
    }

    // 环境变量覆盖全局变量
    if (state.activeEnvId) {
      const envVars = state.variables[state.activeEnvId] || [];
      for (const ev of envVars) {
        if (ev.enabled) result[ev.key] = ev.value;
      }
    }

    return result;
  },
}));
