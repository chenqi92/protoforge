// ProtoForge Environment Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { Environment, EnvVariable, GlobalVariable } from '@/types/collections';

// ── Environments ──

export async function listEnvironments(): Promise<Environment[]> {
  return invoke<Environment[]>('list_environments');
}

export async function createEnvironment(environment: Environment): Promise<Environment> {
  return invoke<Environment>('create_environment', { environment });
}

export async function setActiveEnvironment(id: string | null): Promise<void> {
  await invoke('set_active_environment', { id });
}

export async function getActiveEnvironment(): Promise<Environment | null> {
  return invoke<Environment | null>('get_active_environment');
}

export async function deleteEnvironment(id: string): Promise<void> {
  await invoke('delete_environment', { id });
}

// ── Environment Variables ──

export async function listEnvVariables(environmentId: string): Promise<EnvVariable[]> {
  return invoke<EnvVariable[]>('list_env_variables', { environmentId });
}

export async function saveEnvVariables(environmentId: string, variables: EnvVariable[]): Promise<void> {
  await invoke('save_env_variables', { environmentId, variables });
}

// ── Global Variables ──

export async function listGlobalVariables(): Promise<GlobalVariable[]> {
  return invoke<GlobalVariable[]>('list_global_variables');
}

export async function saveGlobalVariables(variables: GlobalVariable[]): Promise<void> {
  await invoke('save_global_variables', { variables });
}
