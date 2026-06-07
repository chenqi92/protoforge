// 抓包模块类型定义 — 与 Rust CapturedEntry / ProxyStatusInfo 对齐

export interface CapturedEntry {
  sessionId: string;
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
  /** base64 编码的原始 request body 字节（用于 Hex 视图） */
  requestBodyRaw?: string;
  /** base64 编码的原始 response body 字节（用于 Hex 视图） */
  responseBodyRaw?: string;
  contentType?: string;
  /** 请求的 Content-Type */
  requestContentType?: string;
  requestSize: number;
  responseSize: number;
  durationMs: number;
  timestamp: string;
  completed: boolean;
  /** HTTP 版本 (如 "HTTP/1.1") */
  httpVersion?: string;
}

export interface ProxyStatusInfo {
  sessionId: string;
  running: boolean;
  port: number;
  entryCount: number;
}

/** 断点匹配规则 — 与 Rust BreakpointRule 对齐 */
export interface BreakpointRule {
  id: string;
  /** 为空表示通配；非空时需匹配（method 精确、host/path 包含） */
  method?: string;
  host?: string;
  path?: string;
  enabled: boolean;
}

/** 命中断点后被挂起的请求 — 与 Rust PausedRequest 对齐 */
export interface PausedRequest {
  sessionId: string;
  id: string;
  method: string;
  url: string;
  host: string;
  path: string;
  requestHeaders: [string, string][];
  requestBody?: string;
  timestamp: string;
}

/** 放行时携带的修改 — 与 Rust ResumeModification 对齐（全部可选） */
export interface ResumeModification {
  method?: string;
  url?: string;
  headers?: [string, string][];
  body?: string;
}
