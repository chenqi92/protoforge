import { useEffect, useMemo, useState } from "react";
import { EasyPlayerSurface } from "./EasyPlayerSurface";
import { NativeVideoSurface } from "./NativeVideoSurface";
import { isDirectMediaUrl, stripPlayerPrefix } from "@/lib/videoPlayback";

interface VideoPlayerProps {
  url: string | null;
  sessionId: string;
  onError?: (msg: string) => void;
  onReady?: () => void;
  liveMode?: boolean;
}

export function VideoPlayer({ url, sessionId, onError, onReady, liveMode = true }: VideoPlayerProps) {
  const [forceNativeFallback, setForceNativeFallback] = useState(false);

  const normalizedUrl = useMemo(() => {
    if (!url) return null;
    return url.startsWith("tauri:") ? url : stripPlayerPrefix(url);
  }, [url]);

  const prefersEasyPlayer = useMemo(() => {
    if (!normalizedUrl) return false;
    if (normalizedUrl.startsWith("tauri:")) return false;
    return isDirectMediaUrl(normalizedUrl);
  }, [normalizedUrl]);

  useEffect(() => {
    setForceNativeFallback(false);
  }, [normalizedUrl]);

  if (!normalizedUrl) {
    return <NativeVideoSurface url={null} sessionId={sessionId} onError={onError} onReady={onReady} liveMode={liveMode} />;
  }

  if (prefersEasyPlayer && !forceNativeFallback) {
    return (
      <EasyPlayerSurface
        url={normalizedUrl}
        liveMode={liveMode}
        onReady={onReady}
        onError={(message) => {
          const canFallbackToNativeHls = normalizedUrl.includes(".m3u8");
          if (canFallbackToNativeHls && (message.includes("脚本加载失败") || message.includes("构造函数"))) {
            setForceNativeFallback(true);
            return;
          }
          onError?.(message);
        }}
      />
    );
  }

  const nativeUrl = normalizedUrl.startsWith("tauri:")
    ? normalizedUrl
    : normalizedUrl.includes(".m3u8")
      ? `hls:${normalizedUrl}`
      : normalizedUrl;

  return <NativeVideoSurface url={nativeUrl} sessionId={sessionId} onError={onError} onReady={onReady} liveMode={liveMode} />;
}
