// TCP/UDP 类型定义

// ── 基础类型 ──

export type SocketMode = 'tcp-client' | 'tcp-server' | 'udp-client' | 'udp-server' | 'serial' | 'modbus' | 'modbus-slave';
export type DataFormat = 'auto' | 'text' | 'hex' | 'base64' | 'gbk' | 'json';

export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf';

export const LINE_ENDING_MAP: Record<LineEnding, string> = {
  none: '',
  lf: '\n',
  cr: '\r',
  crlf: '\r\n',
};
export type DataEncoding = 'utf8' | 'hex' | 'base64' | 'gbk';

// ── 消息 ──

export interface TcpMessage {
  id: string;
  direction: 'sent' | 'received' | 'system';
  data: string;
  rawHex: string;           // 始终保存原始十六进制表示
  encoding: DataEncoding;
  timestamp: string;
  size: number;
  remoteAddr?: string;
  clientId?: string;
}

// ── 事件（后端推送） ──

export interface TcpEvent {
  connectionId: string;
  eventType:
    | 'connected'
    | 'data'
    | 'disconnected'
    | 'error'
    | 'started'
    | 'client-connected'
    | 'client-data'
    | 'client-disconnected'
    | 'bound';
  data?: string;
  rawHex?: string;          // 后端同时推送十六进制表示
  remoteAddr?: string;
  clientId?: string;
  size?: number;
  timestamp: string;
}

// ── TCP 服务端客户端 ──

export interface TcpServerClient {
  id: string;
  remoteAddr: string;
  connectedAt: string;
}

// ── 统计信息 ──

export interface ConnectionStats {
  sentBytes: number;
  receivedBytes: number;
  sentCount: number;
  receivedCount: number;
}

// ── 发送历史 ──

export interface SendHistoryItem {
  id: string;
  data: string;
  format: DataFormat;
  timestamp: string;
  label?: string;           // 用户可自定义别名
}

// ── 快捷指令 ──

export interface QuickCommand {
  id: string;
  name: string;
  data: string;
  format: DataFormat;
  color?: string;           // 标签颜色
}
