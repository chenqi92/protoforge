// 串口服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SerialPortInfo, SerialPortConfig, SerialEvent } from '@/types/serial';

// ── 端口枚举 ──

export async function serialListPorts(): Promise<SerialPortInfo[]> {
  return invoke<SerialPortInfo[]>('serial_list_ports');
}

// ── 端口开关 ──

export async function serialOpen(portId: string, portName: string, config: SerialPortConfig): Promise<void> {
  return invoke('serial_open', { portId, portName, config });
}

export async function serialClose(portId: string): Promise<void> {
  return invoke('serial_close', { portId });
}

// ── 数据发送 ──

export async function serialSend(portId: string, data: string, encoding: string = 'ascii'): Promise<void> {
  return invoke('serial_send', { portId, data, encoding });
}

// ── 事件监听 ──

export function onSerialEvent(callback: (event: SerialEvent) => void): Promise<UnlistenFn> {
  return listen<SerialEvent>('serial-event', (e) => callback(e.payload));
}
