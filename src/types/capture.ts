// 抓包模块类型定义 — 与 Rust CapturedEntry / ProxyStatusInfo 对齐

export interface CapturedEntry {
  id: string;
  method: string;
  url: string;
  host: string;
  path: string;
  status?: number;
  statusText?: string;
  requestHeaders: [string, string][];
  responseHeaders: [string, string][];
  requestBody?: string;
  responseBody?: string;
  contentType?: string;
  requestSize: number;
  responseSize: number;
  durationMs: number;
  timestamp: string;
  completed: boolean;
}

export interface ProxyStatusInfo {
  running: boolean;
  port: number;
  entryCount: number;
}
