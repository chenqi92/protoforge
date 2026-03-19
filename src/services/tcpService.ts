// TCP/UDP 服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TcpEvent } from '@/types/tcp';

// ── TCP Client ──

export async function tcpConnect(connectionId: string, host: string, port: number): Promise<void> {
  return invoke('tcp_connect', { connectionId, host, port });
}

export async function tcpSend(connectionId: string, data: string): Promise<void> {
  return invoke('tcp_send', { connectionId, data });
}

export async function tcpDisconnect(connectionId: string): Promise<void> {
  return invoke('tcp_disconnect', { connectionId });
}

export function onTcpEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('tcp-event', (e) => callback(e.payload));
}

// ── TCP Server ──

export async function tcpServerStart(serverId: string, host: string, port: number): Promise<void> {
  return invoke('tcp_server_start', { serverId, host, port });
}

export async function tcpServerSend(serverId: string, clientId: string, data: string): Promise<void> {
  return invoke('tcp_server_send', { serverId, clientId, data });
}

export async function tcpServerBroadcast(serverId: string, data: string): Promise<number> {
  return invoke('tcp_server_broadcast', { serverId, data });
}

export async function tcpServerStop(serverId: string): Promise<void> {
  return invoke('tcp_server_stop', { serverId });
}

export function onTcpServerEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('tcp-server-event', (e) => callback(e.payload));
}

// ── UDP ──

export async function udpBind(socketId: string, localAddr: string): Promise<void> {
  return invoke('udp_bind', { socketId, localAddr });
}

export async function udpSendTo(socketId: string, data: string, targetAddr: string): Promise<void> {
  return invoke('udp_send_to', { socketId, data, targetAddr });
}

export async function udpClose(socketId: string): Promise<void> {
  return invoke('udp_close', { socketId });
}

export function onUdpEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('udp-event', (e) => callback(e.payload));
}
