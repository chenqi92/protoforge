// 压测服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LoadTestConfig, MetricsSnapshot, LoadTestComplete } from '@/types/loadtest';

export async function startLoadTest(testId: string, config: LoadTestConfig): Promise<void> {
  return invoke('start_load_test', { testId, config });
}

export async function stopLoadTest(testId: string): Promise<void> {
  return invoke('stop_load_test', { testId });
}

export function onLoadTestMetrics(callback: (snapshot: MetricsSnapshot) => void): Promise<UnlistenFn> {
  return listen<MetricsSnapshot>('loadtest-metrics', (e) => callback(e.payload));
}

export function onLoadTestComplete(callback: (result: LoadTestComplete) => void): Promise<UnlistenFn> {
  return listen<LoadTestComplete>('loadtest-complete', (e) => callback(e.payload));
}
