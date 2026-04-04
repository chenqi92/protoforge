// Mock Server 类型定义

export interface MockRoute {
  id: string;
  /** HTTP 方法，undefined 表示匹配所有方法 */
  method?: string;
  /** 路由模式：支持 :param、*、** */
  pattern: string;
  /** 响应状态码 */
  statusCode: number;
  /** 响应头 */
  headers: Record<string, string>;
  /** 响应体模板（支持 {{}} 变量插值） */
  bodyTemplate: string;
  /** 延迟毫秒数 */
  delayMs?: number;
  /** 路由优先级（数值越大优先级越高） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
  /** 可选描述 */
  description: string;
  /** 条件响应示例列表 */
  examples: MockExample[];
  /** JS 脚本动态响应 */
  script?: string;
  /** 响应序列 */
  sequence: SequenceItem[];
  /** 序列用完后是否循环 */
  sequenceLoop: boolean;
}

/** 条件响应示例 */
export interface MockExample {
  id: string;
  name: string;
  matchCondition: MatchCondition;
  statusCode: number;
  headers: Record<string, string>;
  bodyTemplate: string;
  delayMs?: number;
}

/** 匹配条件 — discriminated union */
export type MatchCondition =
  | { type: "header"; name: string; value: string }
  | { type: "bodyContains"; value: string }
  | { type: "bodyJsonPath"; path: string; value: string }
  | { type: "bodyRegex"; pattern: string }
  | { type: "default" };

/** 响应序列项 */
export interface SequenceItem {
  id: string;
  statusCode: number;
  headers: Record<string, string>;
  bodyTemplate: string;
  delayMs?: number;
}

export interface MockRequestLog {
  id: string;
  sessionId: string;
  timestamp: string;
  method: string;
  path: string;
  query: string;
  requestHeaders: [string, string][];
  requestBody?: string;
  matchedRouteId?: string;
  matchedPattern?: string;
  responseStatus: number;
  responseBody: string;
  delayMs: number;
  durationMs: number;
}

export interface MockServerStatusInfo {
  sessionId: string;
  running: boolean;
  port: number;
  routeCount: number;
  logCount: number;
  totalHits: number;
}

/** 持久化配置 */
export interface MockServerConfig {
  id: string;
  sessionLabel: string;
  port: number;
  routesJson: string;
  proxyTarget?: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建空路由的工厂函数 */
export function createEmptyRoute(): MockRoute {
  return {
    id: crypto.randomUUID(),
    method: "GET",
    pattern: "/",
    statusCode: 200,
    headers: {},
    bodyTemplate: '{\n  "message": "Hello from Mock Server"\n}',
    delayMs: undefined,
    priority: 0,
    enabled: true,
    description: "",
    examples: [],
    script: undefined,
    sequence: [],
    sequenceLoop: true,
  };
}

/** 创建空示例 */
export function createEmptyExample(): MockExample {
  return {
    id: crypto.randomUUID(),
    name: "",
    matchCondition: { type: "default" },
    statusCode: 200,
    headers: {},
    bodyTemplate: '{\n  "message": "example"\n}',
    delayMs: undefined,
  };
}

/** 创建空序列项 */
export function createEmptySequenceItem(): SequenceItem {
  return {
    id: crypto.randomUUID(),
    statusCode: 200,
    headers: {},
    bodyTemplate: '{\n  "step": 1\n}',
    delayMs: undefined,
  };
}
