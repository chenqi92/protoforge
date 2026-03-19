// 压测跨窗口配置桥接
// 主窗口 → push 配置到 localStorage → 打开压测窗口 → pop 读取

import type { HttpRequestConfig } from "@/types/http";
import type { LoadTestConfig } from "@/types/loadtest";
import { openToolWindow } from "./windowManager";

const STORAGE_KEY = "protoforge:loadtest-prefill";

/**
 * 将 HTTP 请求配置推送到 localStorage 并打开压测窗口
 */
export async function pushLoadTestConfig(httpConfig: HttpRequestConfig): Promise<void> {
  const config = httpToLoadTestConfig(httpConfig);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  await openToolWindow("loadtest");
}

/**
 * 从 localStorage 读取预填配置（读完即清除）
 */
export function popLoadTestConfig(): Partial<LoadTestConfig> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  localStorage.removeItem(STORAGE_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
