// 压测跨窗口配置桥接
// 主窗口 / 独立窗口 → push 配置到 localStorage / BroadcastChannel → 压测工作区读取

import type { HttpRequestConfig } from "@/types/http";
import type { LoadTestConfig } from "@/types/loadtest";
import { useAppStore } from "@/stores/appStore";
import { listOpenToolWindowSessions, openToolWindow } from "./windowManager";

const STORAGE_KEY = "protoforge:loadtest-prefill";
const CHANNEL_NAME = "protoforge:loadtest-prefill";

interface LoadTestPrefillPayload {
  config: Partial<LoadTestConfig>;
  ts: number;
}

function readPayload(raw: string | null): LoadTestPrefillPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 将 HTTP 请求配置推送到当前压测工作区。
 * 默认打开主窗口标签；如果已存在独立压测窗口，则聚焦独立窗口。
 */
export async function pushLoadTestConfig(httpConfig: HttpRequestConfig): Promise<void> {
  const config = httpToLoadTestConfig(httpConfig);
  const payload: LoadTestPrefillPayload = { config, ts: Date.now() };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }

  const detachedSessions = await listOpenToolWindowSessions("loadtest");
  if (detachedSessions.length > 0) {
    await openToolWindow("loadtest", detachedSessions[0]);
    return;
  }

  useAppStore.getState().openToolTab("loadtest");
}

/**
 * 从 localStorage 读取预填配置（读完即清除）
 */
export function popLoadTestConfig(): Partial<LoadTestConfig> | null {
  const payload = readPayload(localStorage.getItem(STORAGE_KEY));
  if (!payload) return null;
  localStorage.removeItem(STORAGE_KEY);
  return payload.config;
}

export function subscribeLoadTestPrefill(callback: (config: Partial<LoadTestConfig>) => void) {
  let channel: BroadcastChannel | null = null;

  const handlePayload = (payload: LoadTestPrefillPayload | null) => {
    if (payload?.config) {
      callback(payload.config);
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    handlePayload(readPayload(event.newValue));
  };

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      handlePayload(event.data as LoadTestPrefillPayload);
    });
  }

  window.addEventListener("storage", handleStorage);

  return () => {
    channel?.close();
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * HttpRequestConfig → LoadTestConfig 转换
 */
function httpToLoadTestConfig(http: HttpRequestConfig): Partial<LoadTestConfig> {
  // Headers
  const headers: Record<string, string> = {};
  for (const h of http.headers || []) {
    if (h.enabled && h.key.trim()) {
      headers[h.key] = h.value;
    }
  }

  // Body
  let body: LoadTestConfig["body"] = undefined;
  if (http.requestMode === "graphql") {
    body = {
      type: "json",
      data: JSON.stringify({
        query: http.graphqlQuery || "",
        variables: (() => {
          try {
            return JSON.parse(http.graphqlVariables || "{}");
          } catch {
            return http.graphqlVariables || {};
          }
        })(),
      }),
    };
  } else {
    switch (http.bodyType) {
      case "json":
        if (http.jsonBody?.trim()) {
          body = { type: "json", data: http.jsonBody };
        }
        break;
      case "raw":
        if (http.rawBody?.trim()) {
          body = { type: "raw", content: http.rawBody, contentType: http.rawContentType || "text/plain" };
        }
        break;
      // form-urlencoded/formData/binary 不适合压测，忽略
    }
  }

  // Auth
  let auth: LoadTestConfig["auth"] = undefined;
  switch (http.authType) {
    case "bearer":
      if (http.bearerToken?.trim()) {
        auth = { type: "bearer", token: http.bearerToken };
      }
      break;
    case "basic":
      if (http.basicUsername?.trim()) {
        auth = { type: "basic", username: http.basicUsername, password: http.basicPassword };
      }
      break;
    case "apiKey":
      if (http.apiKeyName?.trim()) {
        auth = { type: "apiKey", key: http.apiKeyName, value: http.apiKeyValue, addTo: http.apiKeyAddTo };
      }
      break;
  }

  return {
    url: http.url,
    method: http.method,
    headers,
    body,
    auth,
    timeoutMs: http.timeoutMs || 30000,
  };
}
