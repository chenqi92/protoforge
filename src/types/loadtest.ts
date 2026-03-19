// 压测配置和指标类型定义

export interface LoadTestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: { type: string; content?: string; data?: string; contentType?: string };
  auth?: { type: string; token?: string; username?: string; password?: string; key?: string; value?: string; addTo?: string };
  concurrency: number;
  durationSecs?: number;
  totalRequests?: number;
  timeoutMs?: number;
  rpsLimit?: number;
}

export interface MetricsSnapshot {
  testId: string;
  timestamp: string;
  elapsedSecs: number;
  totalRequests: number;
  totalErrors: number;
  rps: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  statusCodes: Record<number, number>;
}

export interface LoadTestComplete {
  testId: string;
  totalRequests: number;
  totalErrors: number;
  totalDurationSecs: number;
  avgRps: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  statusCodes: Record<number, number>;
}
