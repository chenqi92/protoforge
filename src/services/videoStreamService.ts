// 视频流调试服务层 — Tauri IPC 包装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  FfmpegDownloadProgress,
  FfmpegStatus,
  StreamInfo,
  StreamStats,
  StreamEvent,
  ProtocolMessage,
  VideoProtocol,
} from '@/types/videostream';

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

export async function playerLoad(sessionId: string, protocol: VideoProtocol, url: string, config?: object): Promise<string> {
  return invoke('vs_player_load', { sessionId, protocol, url, config: config ? JSON.stringify(config) : null });
}

export async function playerControl(sessionId: string, action: 'play' | 'pause' | 'stop'): Promise<void> {
  return invoke('vs_player_control', { sessionId, action });
}

export async function playerSetVolume(sessionId: string, volume: number): Promise<void> {
  return invoke('vs_player_set_volume', { sessionId, volume });
}

export async function ffmpegStatus(): Promise<FfmpegStatus> {
  return invoke('vs_ffmpeg_status');
}

export async function ffmpegDownload(): Promise<string> {
  return invoke('vs_ffmpeg_download');
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

export async function gb28181Unregister(sessionId: string): Promise<void> {
  return invoke('vs_gb_unregister', { sessionId });
}

export async function gb28181StartLive(sessionId: string, channelId: string): Promise<string> {
  return invoke('vs_gb_start_live', { sessionId, channelId });
}

export async function gb28181StopLive(sessionId: string): Promise<void> {
  return invoke('vs_gb_stop_live', { sessionId });
}

// ── ONVIF 专用 ──

export async function onvifDiscover(): Promise<object[]> {
  return invoke('vs_onvif_discover');
}

export async function onvifGetDeviceInfo(sessionId: string, config: object): Promise<object> {
  return invoke('vs_onvif_device_info', { sessionId, config: JSON.stringify(config) });
}

export async function onvifGetProfiles(sessionId: string): Promise<object[]> {
  return invoke('vs_onvif_get_profiles', { sessionId });
}

export async function onvifGetStreamUri(sessionId: string, profileToken: string): Promise<string> {
  return invoke('vs_onvif_get_stream_uri', { sessionId, profileToken });
}

export async function onvifPtzMove(sessionId: string, direction: string, speed: number, profileToken?: string): Promise<void> {
  return invoke('vs_onvif_ptz_move', { sessionId, direction, speed, profileToken });
}

export async function onvifPtzStop(sessionId: string, profileToken?: string): Promise<void> {
  return invoke('vs_onvif_ptz_stop', { sessionId, profileToken });
}

export async function onvifGetPresets(sessionId: string, profileToken?: string): Promise<object[]> {
  return invoke('vs_onvif_get_presets', { sessionId, profileToken });
}

export async function onvifGotoPreset(sessionId: string, presetToken: string, profileToken?: string): Promise<void> {
  return invoke('vs_onvif_goto_preset', { sessionId, presetToken, profileToken });
}

export async function onvifSetPreset(sessionId: string, presetName: string, profileToken?: string): Promise<string> {
  return invoke('vs_onvif_set_preset', { sessionId, presetName, profileToken });
}

export async function onvifClose(sessionId: string): Promise<void> {
  return invoke('vs_onvif_close', { sessionId });
}

// ── RTMP 专用 ──

export async function rtmpHandshake(sessionId: string): Promise<void> {
  return invoke('vs_rtmp_handshake', { sessionId });
}

export async function rtmpConnectApp(sessionId: string): Promise<void> {
  return invoke('vs_rtmp_connect_app', { sessionId });
}

export async function rtmpPlay(sessionId: string, streamKey: string): Promise<void> {
  return invoke('vs_rtmp_play', { sessionId, streamKey });
}

// ── SRT 专用 ──

export async function srtConnect(sessionId: string, config: object): Promise<void> {
  return invoke('vs_srt_connect', { sessionId, config: JSON.stringify(config) });
}

export async function srtDisconnect(sessionId: string): Promise<void> {
  return invoke('vs_srt_disconnect', { sessionId });
}

export async function srtStats(sessionId: string): Promise<object> {
  return invoke('vs_srt_stats', { sessionId });
}

// ── WebRTC 专用 ──

export async function webrtcCreateOffer(sessionId: string, config: object): Promise<string> {
  return invoke('vs_webrtc_create_offer', { sessionId, config: JSON.stringify(config) });
}

export async function webrtcSetAnswer(sessionId: string, sdp: string): Promise<void> {
  return invoke('vs_webrtc_set_answer', { sessionId, sdp });
}

export async function webrtcAddIce(sessionId: string, candidate: string): Promise<void> {
  return invoke('vs_webrtc_add_ice', { sessionId, candidate });
}

export async function webrtcClose(sessionId: string): Promise<void> {
  return invoke('vs_webrtc_close', { sessionId });
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

export async function onFfmpegDownloadProgress(cb: (progress: FfmpegDownloadProgress) => void): Promise<UnlistenFn> {
  return listen<FfmpegDownloadProgress>('ffmpeg-download-progress', (event) => cb(event.payload));
}
