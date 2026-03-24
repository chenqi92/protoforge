// ProtoForge Workflow Engine — TypeScript 类型定义
// 精确镜像 Rust 端的类型（camelCase）

// ═══════════════════════════════════════════
//  流程定义
// ═══════════════════════════════════════════

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: FlowVariable[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowNode {
  id: string;
  name: string;
  nodeType: NodeType;
  /** 节点特定配置（JSON），由 nodeType 决定 schema */
  config: Record<string, unknown>;
  /** 节点在画布上的坐标（前端使用） */
  position?: NodePosition;
}

export interface NodePosition {
  x: number;
  y: number;
}

/** 节点类型 — 每种类型对应独立的配置 schema */
export type NodeType =
  | 'httpRequest'
  | 'tcpSend'
  | 'udpSend'
  | 'delay'
  | 'script'
  | 'extractData'
  | 'base64Encode'
  | 'base64Decode';

export interface FlowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 可选条件表达式（预留） */
  condition?: string;
}

export interface FlowVariable {
  key: string;
  value: string;
  description: string;
}

// ═══════════════════════════════════════════
//  执行结果
// ═══════════════════════════════════════════

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  nodeResults: NodeResult[];
  startedAt: string;
  finishedAt?: string;
  totalDurationMs: number;
}

export interface NodeResult {
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  status: ExecutionStatus;
  /** 节点输出 JSON */
  output: unknown;
  error?: string;
  durationMs: number;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ═══════════════════════════════════════════
//  事件载荷
// ═══════════════════════════════════════════

export interface WorkflowProgressEvent {
  executionId: string;
  workflowId: string;
  currentStep: number;
  totalSteps: number;
  currentNodeId: string;
  currentNodeName: string;
  status: ExecutionStatus;
  nodeResult?: NodeResult;
}

// ═══════════════════════════════════════════
//  各节点配置类型
// ═══════════════════════════════════════════

/** HTTP 请求节点配置 */
export interface HttpNodeConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  body?: {
    type: 'none' | 'raw' | 'json' | 'formUrlencoded';
    content?: string;
    contentType?: string;
    data?: string;
    fields?: Record<string, string>;
  };
  auth?: {
    type: 'bearer' | 'basic' | 'apiKey';
    token?: string;
    username?: string;
    password?: string;
    key?: string;
    value?: string;
    addTo?: string;
  };
  timeoutMs?: number;
  followRedirects?: boolean;
  sslVerify?: boolean;
}

/** TCP 发送节点配置 */
export interface TcpSendNodeConfig {
  host: string;
  port: number;
  data: string;
  encoding?: 'utf8' | 'hex';
  /** 等待响应超时（毫秒），0 = 不等待 */
  readTimeoutMs?: number;
}

/** UDP 发送节点配置 */
export interface UdpSendNodeConfig {
  targetHost: string;
  targetPort: number;
  data: string;
  encoding?: 'utf8' | 'hex';
  localAddr?: string;
  readTimeoutMs?: number;
}

/** 延时节点配置 */
export interface DelayNodeConfig {
  delayMs: number;
}

/** 脚本节点配置 */
export interface ScriptNodeConfig {
  script: string;
}

/** 数据提取节点配置 */
export interface ExtractDataNodeConfig {
  source: string;
  mode: 'jsonPath' | 'regex' | 'fixed';
  expression: string;
}

/** Base64 编解码节点配置 */
export interface Base64NodeConfig {
  input: string;
}

/** 节点类型到配置类型的映射 */
export type NodeConfigMap = {
  httpRequest: HttpNodeConfig;
  tcpSend: TcpSendNodeConfig;
  udpSend: UdpSendNodeConfig;
  delay: DelayNodeConfig;
  script: ScriptNodeConfig;
  extractData: ExtractDataNodeConfig;
  base64Encode: Base64NodeConfig;
  base64Decode: Base64NodeConfig;
};

/** 节点类型元信息（前端展示用） */
export const NODE_TYPE_META: Record<NodeType, { label: string; icon: string; color: string }> = {
  httpRequest: { label: 'HTTP 请求', icon: 'globe', color: '#3b82f6' },
  tcpSend: { label: 'TCP 发送', icon: 'plug', color: '#10b981' },
  udpSend: { label: 'UDP 发送', icon: 'radio', color: '#8b5cf6' },
  delay: { label: '延时等待', icon: 'clock', color: '#f59e0b' },
  script: { label: '脚本', icon: 'code', color: '#ef4444' },
  extractData: { label: '数据提取', icon: 'filter', color: '#06b6d4' },
  base64Encode: { label: 'Base64 编码', icon: 'lock', color: '#64748b' },
  base64Decode: { label: 'Base64 解码', icon: 'unlock', color: '#64748b' },
};
