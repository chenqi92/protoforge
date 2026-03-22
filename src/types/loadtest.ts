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
  latencyThresholdMs?: number;
}

export interface RequestRecord {
  seq: number;
  elapsedMs: number;
  status: number;
  latencyMs: number;
  bytes: number;
  success: boolean;
  errorMsg?: string;
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
  // ── Advanced statistics ──
  bytesDownloaded: number;
  activeConnections: number;
  ttfbAvgMs: number;
  latencyPoints: number[];
  errorSamples: RequestRecord[];
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
  // ── Advanced statistics ──
  totalBytesDownloaded: number;
  avgThroughputBps: number;
}
