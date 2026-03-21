// 抓包代理服务层 — Tauri command 前端封装

import { invoke } from "@tauri-apps/api/core";
import type { CapturedEntry, ProxyStatusInfo } from "@/types/capture";

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
