// WebSocket 类型定义

export interface WsMessage {
  id: string;
  kind: 'status' | 'message' | 'error';
  direction?: 'sent' | 'received';
  title: string;
  data: string;
  dataType: 'text' | 'binary';
  timestamp: string;
  size: number;
  status?: 'connected' | 'disconnected';
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
