// ProtoForge History Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HistoryEntry, HistoryEntrySummary } from '@/types/collections';

export async function listHistory(limit: number = 100): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>('list_history', { limit });
}

/** 轻量列表：不含 requestConfig / responseSummary */
export async function listHistorySummary(limit: number = 100): Promise<HistoryEntrySummary[]> {
  return invoke<HistoryEntrySummary[]>('list_history_summary', { limit });
}

/** 按 ID 获取完整历史记录（含 requestConfig） */
export async function getHistoryEntry(id: string): Promise<HistoryEntry> {
  return invoke<HistoryEntry>('get_history_entry', { id });
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
