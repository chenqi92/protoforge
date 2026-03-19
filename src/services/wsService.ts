// WebSocket 服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { WsEvent } from '@/types/ws';

export async function wsConnect(connectionId: string, url: string): Promise<void> {
  return invoke('ws_connect', { connectionId, url });
}

export async function wsSend(connectionId: string, message: string): Promise<void> {
  return invoke('ws_send', { connectionId, message });
}

export async function wsDisconnect(connectionId: string): Promise<void> {
  return invoke('ws_disconnect', { connectionId });
}

export function onWsEvent(callback: (event: WsEvent) => void): Promise<UnlistenFn> {
  return listen<WsEvent>('ws-event', (e) => callback(e.payload));
}
