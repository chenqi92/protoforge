// 视频流协议调试 — 类型定义

export type VideoProtocol = 'rtsp' | 'rtmp' | 'http-flv' | 'hls' | 'webrtc' | 'gb28181' | 'srt' | 'onvif';

export interface OnvifConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface OnvifDeviceInfo {
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  hardwareId: string;
}

export interface OnvifProfile {
  token: string;
  name: string;
  videoEncoding: string;
  resolution: string;
  fps: number;
  streamUri: string;
}

export interface OnvifPreset {
  token: string;
  name: string;
}

// ── 流信息 ──

export interface StreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  profile?: string;
  level?: string;
}

export interface StreamStats {
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  bitrate: number;
  fps: number;
  jitter?: number;
  rtt?: number;
  uptime: number;
}

// ── 事件 ──

export interface StreamEvent {
  sessionId: string;
  eventType: 'connected' | 'disconnected' | 'error' | 'stream-info' | 'stats-update' | 'protocol-data';
  data?: string;
  timestamp: string;
}

export interface ProtocolMessage {
  id: string;
  direction: 'sent' | 'received' | 'info';
  protocol: VideoProtocol;
  summary: string;
  detail: string;
  timestamp: string;
  size?: number;
}

// ── 协议配置 ──

export interface RtspConfig {
  url: string;
  username: string;
  password: string;
  transport: 'tcp' | 'udp';
  authMethod: 'none' | 'basic' | 'digest';
}

export interface RtmpConfig {
  url: string;
  mode: 'pull' | 'push';
  streamKey: string;
}

export interface HttpFlvConfig {
  url: string;
}

export interface HlsConfig {
  url: string;
}

export interface WebRtcConfig {
  signalUrl: string;
  stunServers: string[];
  turnServers: { url: string; username: string; credential: string }[];
  mode: 'offer' | 'answer';
}

export interface Gb28181Config {
  sipServerIp: string;
  sipServerPort: number;
  sipDomain: string;
  deviceId: string;
  username: string;
  password: string;
  localPort: number;
  transport: 'udp' | 'tcp';
}

export interface SrtConfig {
  host: string;
  port: number;
  mode: 'caller' | 'listener' | 'rendezvous';
  passphrase: string;
  latency: number;
  streamId: string;
}

// ── FLV/HLS 分析类型 ──

export interface FlvTag {
  id: number;
  type: 'audio' | 'video' | 'script';
  size: number;
  timestamp: number;
  codecInfo?: string;
  keyframe?: boolean;
}

export interface HlsPlaylistInfo {
  playlistType: 'master' | 'media';
  version?: number;
  targetDuration?: number;
  mediaSequence?: number;
  isLive: boolean;
  totalDuration: number;
  variants: HlsVariant[];
  segments: HlsSegment[];
}

export interface HlsVariant {
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  url: string;
}

export interface HlsSegment {
  duration: number;
  uri: string;
  sequence: number;
  byteRange?: string;
}

export interface FfmpegStatus {
  available: boolean;
  path?: string | null;
  source: string;
  downloading: boolean;
}

export interface FfmpegDownloadProgress {
  progress: number;
  downloaded: number;
  total: number;
  stage: string;
}

// ── SDP 解析 ──

export interface SdpInfo {
  raw: string;
  sessionName?: string;
  mediaDescriptions: SdpMedia[];
}

export interface SdpMedia {
  type: string;
  port: number;
  protocol: string;
  formats: string[];
  attributes: Record<string, string>;
  codec?: string;
  clockRate?: number;
}
