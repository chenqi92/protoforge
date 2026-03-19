// 抓包代理服务层 — Tauri command 前端封装

import { invoke } from "@tauri-apps/api/core";
import type { CapturedEntry, ProxyStatusInfo } from "@/types/capture";

export async function startProxy(port: number): Promise<void> {
  return invoke("proxy_start", { port });
}

export async function stopProxy(): Promise<void> {
  return invoke("proxy_stop");
}

export async function getProxyStatus(): Promise<ProxyStatusInfo> {
  return invoke("proxy_status");
}

export async function getEntries(): Promise<CapturedEntry[]> {
  return invoke("proxy_get_entries");
}

export async function clearEntries(): Promise<void> {
  return invoke("proxy_clear");
}

export async function exportCaCert(): Promise<string> {
  return invoke("proxy_export_ca");
}
