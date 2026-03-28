// 视频流调试服务层 — Tauri IPC 包装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { StreamInfo, StreamStats, StreamEvent, ProtocolMessage, VideoProtocol } from '@/types/videostream';

// ── 连接控制 ──

export async function connectStream(sessionId: string, protocol: VideoProtocol, config: object): Promise<void> {
  return invoke('vs_connect', { sessionId, protocol, config: JSON.stringify(config) });
}

export async function disconnectStream(sessionId: string): Promise<void> {
  return invoke('vs_disconnect', { sessionId });
}

export async function probeStream(url: string): Promise<StreamInfo> {
  return invoke('vs_probe', { url });
}

// ── 播放器控制 ──

export async function playerLoad(sessionId: string, url: string): Promise<void> {
  return invoke('vs_player_load', { sessionId, url });
}

export async function playerControl(sessionId: string, action: 'play' | 'pause' | 'stop'): Promise<void> {
  return invoke('vs_player_control', { sessionId, action });
}

export async function playerSetVolume(sessionId: string, volume: number): Promise<void> {
  return invoke('vs_player_set_volume', { sessionId, volume });
}

// ── RTSP 专用 ──

export async function rtspCommand(sessionId: string, method: string): Promise<string> {
  return invoke('vs_rtsp_command', { sessionId, method });
}

// ── HLS 专用 ──

export async function hlsParsePlaylist(sessionId: string, url: string): Promise<object> {
  return invoke('vs_hls_parse_playlist', { sessionId, url });
}

// ── GB28181 专用 ──

export async function gb28181Register(sessionId: string, config: object): Promise<void> {
  return invoke('vs_gb_register', { sessionId, config: JSON.stringify(config) });
}

export async function gb28181QueryCatalog(sessionId: string): Promise<object[]> {
  return invoke('vs_gb_query_catalog', { sessionId });
}

export async function gb28181Ptz(sessionId: string, command: string, speed: number): Promise<void> {
  return invoke('vs_gb_ptz', { sessionId, command, speed });
}

// ── 事件监听 ──

export async function onStreamEvent(cb: (e: StreamEvent) => void): Promise<UnlistenFn> {
  return listen<StreamEvent>('videostream-event', (event) => cb(event.payload));
}

export async function onStreamStats(cb: (s: { sessionId: string } & StreamStats) => void): Promise<UnlistenFn> {
  return listen<{ sessionId: string } & StreamStats>('videostream-stats', (event) => cb(event.payload));
}

export async function onProtocolMessage(cb: (m: ProtocolMessage) => void): Promise<UnlistenFn> {
  return listen<ProtocolMessage>('videostream-protocol-msg', (event) => cb(event.payload));
}
