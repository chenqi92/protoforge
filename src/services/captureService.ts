// 抓包代理服务层 — Tauri command 前端封装

import { invoke } from "@tauri-apps/api/core";
import type {
  BreakpointRule,
  CapturedEntry,
  PausedRequest,
  ProxyStatusInfo,
  ResumeModification,
} from "@/types/capture";

export async function startProxy(sessionId: string, port: number): Promise<void> {
  return invoke("proxy_start", { sessionId, port });
}

export async function stopProxy(sessionId: string): Promise<void> {
  return invoke("proxy_stop", { sessionId });
}

export async function getProxyStatus(sessionId: string): Promise<ProxyStatusInfo> {
  return invoke("proxy_status", { sessionId });
}

export async function getEntries(sessionId: string): Promise<CapturedEntry[]> {
  return invoke("proxy_get_entries", { sessionId });
}

export async function clearEntries(sessionId: string): Promise<void> {
  return invoke("proxy_clear", { sessionId });
}

export async function exportCaCert(): Promise<string> {
  return invoke("proxy_export_ca");
}

export async function testProxyConnection(port: number): Promise<string> {
  return invoke("proxy_test_connection", { port });
}

// ── 重放 ──
export async function replayEntry(sessionId: string, entryId: string): Promise<CapturedEntry> {
  return invoke("proxy_replay_entry", { sessionId, entryId });
}

// ── 断点 ──
export async function setBreakpoints(
  sessionId: string,
  patterns: BreakpointRule[]
): Promise<void> {
  return invoke("proxy_set_breakpoints", { sessionId, patterns });
}

export async function listBreakpoints(sessionId: string): Promise<BreakpointRule[]> {
  return invoke("proxy_list_breakpoints", { sessionId });
}

export async function listPaused(sessionId: string): Promise<PausedRequest[]> {
  return invoke("proxy_list_paused", { sessionId });
}

export async function resumeRequest(
  sessionId: string,
  pausedId: string,
  modified?: ResumeModification
): Promise<void> {
  return invoke("proxy_resume", { sessionId, pausedId, modified: modified ?? null });
}
