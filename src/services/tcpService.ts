// TCP/UDP 服务层 — Tauri IPC 封装 + 编码转换工具
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TcpEvent, DataFormat } from '@/types/tcp';

// ═══════════════════════════════════════════
//  编码转换工具
// ═══════════════════════════════════════════

/** ASCII 字符串 → Hex 字符串 (带空格分隔) */
export function asciiToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/** Hex 字符串 → ASCII 字符串 */
export function hexToAscii(hex: string): string {
  const bytes = hexToBytes(hex);
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

/** Hex 字符串 → 字节数组 */
export function hexToBytes(hex: string): number[] {
  const cleaned = hex.replace(/0[xX]/g, '').replace(/[\s,]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

/** 字节数组 → Hex 字符串 */
export function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/** Hex 字符串 → Uint8Array */
export function hexToUint8Array(hex: string): Uint8Array {
  return new Uint8Array(hexToBytes(hex));
}

/** ASCII → Base64 */
export function asciiToBase64(str: string): string {
  return btoa(str);
}

/** Base64 → ASCII */
export function base64ToAscii(b64: string): string {
  try { return atob(b64.trim()); } catch { return b64; }
}

/** Hex → Base64 */
export function hexToBase64(hex: string): string {
  const bytes = hexToBytes(hex);
  return btoa(String.fromCharCode(...bytes));
}

/** Base64 → Hex */
export function base64ToHex(b64: string): string {
  try {
    const raw = atob(b64.trim());
    return Array.from(raw)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(' ');
  } catch { return b64; }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  try {
    const raw = atob(b64.trim());
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeGbk(bytes: Uint8Array): string {
  try {
    return new TextDecoder('gbk', { fatal: false }).decode(bytes);
  } catch {
    return decodeText(bytes);
  }
}

function prettyJson(input: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

export function measurePayloadSize(data: string, format: DataFormat): number {
  if (!data) return 0;
  if (format === 'hex') {
    return hexToBytes(data).length;
  }
  if (format === 'base64') {
    return base64ToBytes(data).length;
  }
  return new TextEncoder().encode(data).length;
}

export function normalizeSendEncoding(format: DataFormat): string {
  if (format === 'hex' || format === 'base64' || format === 'gbk') {
    return format;
  }
  return 'utf8';
}

export function estimateRawHex(data: string, format: DataFormat): string {
  if (!data) return '';
  if (format === 'hex') return bytesToHex(hexToBytes(data));
  if (format === 'base64') return bytesToHex(base64ToBytes(data));
  return bytesToHex(new TextEncoder().encode(data));
}

/** 在多种格式之间转换显示内容 */
export function convertFormat(data: string, rawHex: string, to: DataFormat): string {
  if (to === 'auto') return data;

  const bytes = rawHex ? hexToUint8Array(rawHex) : (
    to === 'hex'
      ? hexToUint8Array(data)
      : to === 'base64'
        ? base64ToBytes(data)
        : new TextEncoder().encode(data)
  );

  if (to === 'hex') return bytesToHex(bytes);
  if (to === 'base64') return bytesToBase64(bytes);
  if (to === 'gbk') return decodeGbk(bytes);

  const text = decodeText(bytes);
  if (to === 'json') return prettyJson(text);
  return text;
}

// ═══════════════════════════════════════════
//  TCP Client
// ═══════════════════════════════════════════

export async function tcpConnect(connectionId: string, host: string, port: number): Promise<void> {
  return invoke('tcp_connect', { connectionId, host, port });
}

export async function tcpSend(connectionId: string, data: string, encoding: string = 'utf8'): Promise<void> {
  return invoke('tcp_send', { connectionId, data, encoding });
}

export async function tcpDisconnect(connectionId: string): Promise<void> {
  return invoke('tcp_disconnect', { connectionId });
}

export function onTcpEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('tcp-event', (e) => callback(e.payload));
}

// ═══════════════════════════════════════════
//  TCP Server
// ═══════════════════════════════════════════

export async function tcpServerStart(serverId: string, host: string, port: number): Promise<void> {
  return invoke('tcp_server_start', { serverId, host, port });
}

export async function tcpServerSend(serverId: string, clientId: string, data: string, encoding: string = 'utf8'): Promise<void> {
  return invoke('tcp_server_send', { serverId, clientId, data, encoding });
}

export async function tcpServerBroadcast(serverId: string, data: string, encoding: string = 'utf8'): Promise<number> {
  return invoke('tcp_server_broadcast', { serverId, data, encoding });
}

export async function tcpServerStop(serverId: string): Promise<void> {
  return invoke('tcp_server_stop', { serverId });
}

export function onTcpServerEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('tcp-server-event', (e) => callback(e.payload));
}

// ═══════════════════════════════════════════
//  UDP
// ═══════════════════════════════════════════

export async function udpBind(socketId: string, localAddr: string): Promise<void> {
  return invoke('udp_bind', { socketId, localAddr });
}

export async function udpSendTo(socketId: string, data: string, targetAddr: string, encoding: string = 'utf8'): Promise<void> {
  return invoke('udp_send_to', { socketId, data, targetAddr, encoding });
}

export async function udpClose(socketId: string): Promise<void> {
  return invoke('udp_close', { socketId });
}

export function onUdpEvent(callback: (event: TcpEvent) => void): Promise<UnlistenFn> {
  return listen<TcpEvent>('udp-event', (e) => callback(e.payload));
}

// ═══════════════════════════════════════════
//  活跃连接查询（刷新后状态恢复）
// ═══════════════════════════════════════════

export interface ActiveTcpConnection {
  connectionId: string;
}

export interface ActiveTcpServer {
  serverId: string;
  clientIds: string[];
  clientAddrs: string[];
}

export interface ActiveUdpSocket {
  socketId: string;
}

export async function tcpListConnections(): Promise<ActiveTcpConnection[]> {
  return invoke('tcp_list_connections');
}

export async function tcpListServers(): Promise<ActiveTcpServer[]> {
  return invoke('tcp_list_servers');
}

export async function udpListSockets(): Promise<ActiveUdpSocket[]> {
  return invoke('udp_list_sockets');
}
