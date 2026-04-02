import type { VideoProtocol } from "@/types/videostream";

export type PlaybackEngine = "easyplayer" | "gateway-hls" | "tauri-mse";

export interface PlaybackTarget {
  engine: PlaybackEngine;
  url: string;
  requiresPlayerLoad: boolean;
  requiresFfmpeg: boolean;
  label: string;
}

const DIRECT_MEDIA_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:", "webrtc:"]);
const GATEWAY_PROTOCOLS = new Set<VideoProtocol>(["rtsp", "rtmp", "srt", "onvif", "gb28181"]);

function parseUrlProtocol(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

export function stripPlayerPrefix(url: string): string {
  if (url.startsWith("tauri:")) return url.slice(6);
  if (url.startsWith("hls:")) return url.slice(4);
  return url;
}

export function isDirectMediaUrl(url: string): boolean {
  return DIRECT_MEDIA_PROTOCOLS.has(parseUrlProtocol(url) ?? "");
}

export function supportsIntegratedPlayback(mode: VideoProtocol, url: string): boolean {
  const rawUrl = stripPlayerPrefix(url).trim();
  if (!rawUrl) return false;

  if (mode === "gb28181" && !/^([a-z][a-z0-9+.-]*):\/\//i.test(rawUrl)) {
    return false;
  }

  if (mode === "webrtc") {
    return isDirectMediaUrl(rawUrl);
  }

  return true;
}

export function resolvePlaybackTarget(mode: VideoProtocol, url: string): PlaybackTarget {
  const rawUrl = stripPlayerPrefix(url).trim();
  if (mode === "hls" || isDirectMediaUrl(rawUrl)) {
    return {
      engine: "easyplayer",
      url: rawUrl,
      requiresPlayerLoad: false,
      requiresFfmpeg: false,
      label: "EasyPlayer 直连",
    };
  }

  if (GATEWAY_PROTOCOLS.has(mode)) {
    return {
      engine: "gateway-hls",
      url: rawUrl,
      requiresPlayerLoad: true,
      requiresFfmpeg: true,
      label: "本地 HLS 网关",
    };
  }

  return {
    engine: "tauri-mse",
    url: `tauri:${rawUrl}`,
    requiresPlayerLoad: true,
    requiresFfmpeg: true,
    label: "原生 MSE",
  };
}

export function modeLikelyNeedsFfmpeg(mode: VideoProtocol): boolean {
  return mode === "rtsp" || mode === "rtmp" || mode === "srt" || mode === "onvif" || mode === "gb28181";
}
