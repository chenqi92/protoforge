// Mock Server 服务层 — Tauri command 前端封装

import { invoke } from "@tauri-apps/api/core";
import type {
  MockRoute,
  MockRequestLog,
  MockServerStatusInfo,
} from "@/types/mockserver";

export async function startMockServer(
  sessionId: string,
  port: number,
  routes: MockRoute[],
): Promise<void> {
  return invoke("mock_server_start", { sessionId, port, routes });
}

export async function stopMockServer(sessionId: string): Promise<void> {
  return invoke("mock_server_stop", { sessionId });
}

export async function updateMockRoutes(
  sessionId: string,
  routes: MockRoute[],
): Promise<void> {
  return invoke("mock_server_update_routes", { sessionId, routes });
}

export async function getMockServerLog(
  sessionId: string,
): Promise<MockRequestLog[]> {
  return invoke("mock_server_get_log", { sessionId });
}

export async function clearMockServerLog(sessionId: string): Promise<void> {
  return invoke("mock_server_clear_log", { sessionId });
}

export async function getMockServerStatus(
  sessionId: string,
): Promise<MockServerStatusInfo> {
  return invoke("mock_server_status", { sessionId });
}
