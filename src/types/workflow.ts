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
  | 'wsSend'
  | 'tcpSend'
  | 'udpSend'
  | 'mqttPublish'
  | 'dbQuery'
  | 'delay'
  | 'script'
  | 'extractData'
  | 'jsonParse'
  | 'jsonStringify'
  | 'textTransform'
  | 'base64Encode'
  | 'base64Decode'
  | 'urlEncode'
  | 'urlDecode'
  | 'hash'
  // Phase 1 新增 — 流程控制 & 辅助
  | 'condition'
  | 'loop'
  | 'parallel'
  | 'setVariable'
  | 'timestamp'
  | 'uuid'
  | 'log'
  | 'assertion'
  | 'start'
  | 'end';

export interface FlowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 可选条件表达式 */
  condition?: string;
  /** 边上显示的文字标签（如 "成功" / "失败"） */
  label?: string;
  /** 源端口 ID（用于条件分支 true/false） */
  sourceHandle?: string;
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

/** WebSocket 发送节点配置 */
export interface WsSendNodeConfig {
  url: string;
  headersJson: string;
  message: string;
  messageType?: 'text' | 'hex';
  waitTimeoutMs?: number;
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

/** MQTT 发布节点配置 */
export interface MqttPublishNodeConfig {
  brokerUrl: string;
  clientId: string;
  topic: string;
  payload: string;
  qos?: 0 | 1 | 2;
  retain?: boolean;
  username?: string;
  password?: string;
  cleanSession?: boolean;
  keepAliveSecs?: number;
}

/** 数据库查询节点配置 */
export interface DbQueryNodeConfig {
  dbType: 'postgresql' | 'mysql' | 'sqlite' | 'influxdb';
  mode: 'query' | 'statement';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled?: boolean;
  filePath?: string;
  org?: string;
  token?: string;
  influxVersion?: '1.x' | '2.x' | '3.x';
  sql: string;
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

/** JSON 解析节点配置 */
export interface JsonParseNodeConfig {
  input: string;
}

/** JSON 序列化节点配置 */
export interface JsonStringifyNodeConfig {
  input: string;
  pretty?: boolean;
}

/** 文本转换节点配置 */
export interface TextTransformNodeConfig {
  input: string;
  operation: 'trim' | 'uppercase' | 'lowercase' | 'replace';
  search?: string;
  replacement?: string;
}

/** Base64 编解码节点配置 */
export interface Base64NodeConfig {
  input: string;
}

/** URL 编解码节点配置 */
export interface UrlCodecNodeConfig {
  input: string;
}

/** 哈希节点配置 */
export interface HashNodeConfig {
  input: string;
  algorithm: 'sha1' | 'sha256';
}

/** 条件判断节点配置 */
export interface ConditionNodeConfig {
  /** 条件表达式，如 {{prev.status}} == 200 */
  expression: string;
}

/** 循环节点配置 */
export interface LoopNodeConfig {
  /** 循环次数 */
  iterations: number;
}

/** 并行节点配置 */
export interface ParallelNodeConfig {
  /** 最大并行度 (0 = 无限制) */
  maxConcurrency: number;
}

/** 设置变量节点配置 */
export interface SetVariableNodeConfig {
  key: string;
  value: string;
}

/** 时间戳节点配置 */
export interface TimestampNodeConfig {
  format: 'unixMs' | 'unix' | 'iso8601';
}

/** 日志输出节点配置 */
export interface LogNodeConfig {
  message: string;
  level: 'info' | 'warn' | 'error';
}

/** 断言节点配置 */
export interface AssertionNodeConfig {
  target: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'matches';
  expected: string;
  name: string;
}

/** 起始/结束节点无配置 */
export type StartEndNodeConfig = Record<string, never>;

/** 节点类型到配置类型的映射 */
export type NodeConfigMap = {
  httpRequest: HttpNodeConfig;
  wsSend: WsSendNodeConfig;
  tcpSend: TcpSendNodeConfig;
  udpSend: UdpSendNodeConfig;
  mqttPublish: MqttPublishNodeConfig;
  dbQuery: DbQueryNodeConfig;
  delay: DelayNodeConfig;
  script: ScriptNodeConfig;
  extractData: ExtractDataNodeConfig;
  jsonParse: JsonParseNodeConfig;
  jsonStringify: JsonStringifyNodeConfig;
  textTransform: TextTransformNodeConfig;
  base64Encode: Base64NodeConfig;
  base64Decode: Base64NodeConfig;
  urlEncode: UrlCodecNodeConfig;
  urlDecode: UrlCodecNodeConfig;
  hash: HashNodeConfig;
  condition: ConditionNodeConfig;
  loop: LoopNodeConfig;
  parallel: ParallelNodeConfig;
  setVariable: SetVariableNodeConfig;
  timestamp: TimestampNodeConfig;
  uuid: StartEndNodeConfig;
  log: LogNodeConfig;
  assertion: AssertionNodeConfig;
  start: StartEndNodeConfig;
  end: StartEndNodeConfig;
};

// ═══════════════════════════════════════════
//  节点类型元信息 & 分类
// ═══════════════════════════════════════════

/** 节点视觉形状 */
export type NodeShape = 'rectangle' | 'circle' | 'diamond';

/** 节点类型元信息（前端展示用） */
export const NODE_TYPE_META: Record<NodeType, { label: string; icon: string; color: string; shape: NodeShape }> = {
  // 触发
  start:         { label: '开始',        icon: 'play-circle', color: '#22c55e', shape: 'circle' },
  end:           { label: '结束',        icon: 'stop-circle', color: '#ef4444', shape: 'circle' },
  // 网络请求
  httpRequest:   { label: 'HTTP 请求',   icon: 'globe',       color: '#3b82f6', shape: 'rectangle' },
  wsSend:        { label: 'WebSocket',   icon: 'zap',         color: '#f59e0b', shape: 'rectangle' },
  tcpSend:       { label: 'TCP 发送',    icon: 'plug',        color: '#10b981', shape: 'rectangle' },
  udpSend:       { label: 'UDP 发送',    icon: 'radio',       color: '#8b5cf6', shape: 'rectangle' },
  mqttPublish:   { label: 'MQTT 发布',   icon: 'radio',       color: '#7c3aed', shape: 'rectangle' },
  dbQuery:       { label: '数据库查询',  icon: 'database',    color: '#d97706', shape: 'rectangle' },
  // 流程控制
  condition:     { label: '条件判断',    icon: 'git-branch',  color: '#f59e0b', shape: 'diamond' },
  loop:          { label: '循环',        icon: 'repeat',      color: '#06b6d4', shape: 'rectangle' },
  parallel:      { label: '并行执行',    icon: 'columns',     color: '#a855f7', shape: 'rectangle' },
  delay:         { label: '延时等待',    icon: 'clock',       color: '#f59e0b', shape: 'rectangle' },
  // 数据处理
  extractData:   { label: '数据提取',    icon: 'filter',      color: '#06b6d4', shape: 'rectangle' },
  jsonParse:     { label: 'JSON 解析',   icon: 'file-json',   color: '#0ea5e9', shape: 'rectangle' },
  jsonStringify: { label: 'JSON 序列化', icon: 'braces',      color: '#0284c7', shape: 'rectangle' },
  textTransform: { label: '文本转换',    icon: 'case-sensitive', color: '#f97316', shape: 'rectangle' },
  setVariable:   { label: '设置变量',    icon: 'variable',    color: '#14b8a6', shape: 'rectangle' },
  script:        { label: '脚本',        icon: 'code',        color: '#ef4444', shape: 'rectangle' },
  base64Encode:  { label: 'Base64 编码', icon: 'lock',        color: '#64748b', shape: 'rectangle' },
  base64Decode:  { label: 'Base64 解码', icon: 'unlock',      color: '#64748b', shape: 'rectangle' },
  urlEncode:     { label: 'URL 编码',    icon: 'link-2',      color: '#6366f1', shape: 'rectangle' },
  urlDecode:     { label: 'URL 解码',    icon: 'unlink-2',    color: '#818cf8', shape: 'rectangle' },
  hash:          { label: '哈希计算',    icon: 'hash',        color: '#7c3aed', shape: 'rectangle' },
  timestamp:     { label: '时间戳',      icon: 'calendar-clock', color: '#0f766e', shape: 'rectangle' },
  uuid:          { label: 'UUID',        icon: 'fingerprint', color: '#4f46e5', shape: 'rectangle' },
  // 验证
  assertion:     { label: '断言',        icon: 'check-square',color: '#22c55e', shape: 'rectangle' },
  log:           { label: '日志输出',    icon: 'message-square',color:'#64748b', shape: 'rectangle' },
};

/** 节点分类 — 用于面板分组展示 */
export interface NodeCategory {
  id: string;
  labelKey: string; // i18n key
  nodes: NodeType[];
}

export const NODE_CATEGORIES: NodeCategory[] = [
  { id: 'trigger',  labelKey: 'workflow.categories.trigger',  nodes: ['start', 'end'] },
  { id: 'network',  labelKey: 'workflow.categories.network',  nodes: ['httpRequest', 'wsSend', 'tcpSend', 'udpSend', 'mqttPublish'] },
  { id: 'integration', labelKey: 'workflow.categories.integration', nodes: ['dbQuery'] },
  { id: 'flow',     labelKey: 'workflow.categories.flow',     nodes: ['condition', 'loop', 'parallel', 'delay'] },
  { id: 'data',     labelKey: 'workflow.categories.data',     nodes: ['extractData', 'jsonParse', 'jsonStringify', 'textTransform', 'setVariable', 'script'] },
  { id: 'codec',    labelKey: 'workflow.categories.codec',    nodes: ['base64Encode', 'base64Decode', 'urlEncode', 'urlDecode', 'hash'] },
  { id: 'utility',  labelKey: 'workflow.categories.utility',  nodes: ['timestamp', 'uuid'] },
  { id: 'test',     labelKey: 'workflow.categories.test',     nodes: ['assertion', 'log'] },
];
