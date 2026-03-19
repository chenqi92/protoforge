// TCP/UDP 类型定义

export type TcpMode = 'client' | 'server';
export type DataEncoding = 'utf8' | 'hex' | 'base64';

export interface TcpMessage {
  id: string;
  direction: 'sent' | 'received';
  data: string;
  encoding: DataEncoding;
  timestamp: string;
  size: number;
  remoteAddr?: string;
  clientId?: string;
}

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
  remoteAddr?: string;
  clientId?: string;
  size?: number;
  timestamp: string;
}

export interface TcpServerClient {
  id: string;
  remoteAddr: string;
  connectedAt: string;
}
