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
  };
}
