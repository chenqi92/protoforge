// WebSocket 类型定义

export interface WsMessage {
  id: string;
  direction: 'sent' | 'received';
  data: string;
  dataType: 'text' | 'binary';
  timestamp: string;
  size: number;
}

export interface WsEvent {
  connectionId: string;
  eventType: 'connected' | 'message' | 'disconnected' | 'error';
  data?: string;
  dataType?: string;
  size?: number;
  timestamp: string;
  reason?: 'normal' | 'error' | 'server_close'; // 仅 disconnected 事件携带
}
