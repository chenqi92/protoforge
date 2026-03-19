// ProtoForge History Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HistoryEntry } from '@/types/collections';

export async function listHistory(limit: number = 100): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>('list_history', { limit });
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  await invoke('add_history', { entry });
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await invoke('delete_history_entry', { id });
}

export async function clearHistory(): Promise<void> {
  await invoke('clear_history');
}
