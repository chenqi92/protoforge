// 内置视频播放器
// HLS: 使用 hls.js 播放
// HTTP-FLV: 待 flv.js 集成
// RTSP/RTMP/其他: 显示流信息面板（浏览器无法直接播放这些协议）

import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { Play, Pause, Square, Volume2, VolumeX, Maximize, AlertCircle } from "lucide-react";

interface VideoPlayerProps {
  url: string | null;
  protocol?: string;
  onError?: (msg: string) => void;
}

export function VideoPlayer({ url, protocol, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [loading, setLoading] = useState(false);
  const [, setCanPlay] = useState(false);

  // Determine if the URL can be played natively
  const isHls = url ? (url.includes('.m3u8') || protocol === 'hls') : false;
  const isNativePlayable = isHls; // Future: add HTTP-FLV with flv.js

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isNativePlayable) {
      setCanPlay(false);
      return;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        maxBufferLength: 5,
        maxMaxBufferLength: 10,
      });
      hlsRef.current = hls;
      setLoading(true);
      setCanPlay(true);

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().then(() => setPlaying(true)).catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setLoading(false);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setTimeout(() => hls.startLoad(), 2000);
          } else {
            onError?.(`HLS 播放错误: ${data.details}`);
            hls.destroy();
          }
        }
      });

      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = url;
      setCanPlay(true);
      setLoading(true);
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        video.play().then(() => setPlaying(true)).catch(() => {});
      });
    } else {
      setCanPlay(false);
    }
  }, [url, isHls, isNativePlayable, onError]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const handleStop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setPlaying(false);
  }, []);

  const handleVolumeChange = useCallback((val: number) => {
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val / 100;
      setMuted(val === 0);
    }
  }, []);

  // Not natively playable — show protocol info
  if (!isNativePlayable && url) {
    return (
      <div className="h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-white/50 text-center">
          <AlertCircle className="w-8 h-8 text-white/30" />
          <div>
            <p className="text-[var(--fs-xs)] font-medium text-white/60">
              {protocol?.toUpperCase() || 'RTSP'} 流暂不支持内嵌播放
            </p>
            <p className="text-[var(--fs-xxs)] text-white/30 mt-1">
              HLS (.m3u8) 格式可直接播放
            </p>
          </div>
          <div className="mt-1 px-3 py-1.5 rounded-[var(--radius-sm)] bg-white/5 border border-white/10 font-mono text-[var(--fs-xxs)] text-white/40 break-all select-text max-w-full">
            {url}
          </div>
        </div>
      </div>
    );
  }

  // No URL
  if (!url) {
    return (
      <div className="h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-white/30">
          <Play className="w-6 h-6" />
          <span className="text-[var(--fs-xxs)]">获取流地址后自动播放</span>
        </div>
      </div>
    );
  }

  // HLS playable
  return (
    <div className="relative h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex flex-col">
      <video
        ref={videoRef}
        className="flex-1 w-full bg-black object-contain"
        playsInline
        muted={muted}
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-accent animate-spin" />
            <span className="text-[var(--fs-xs)]">加载中...</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={handlePlayPause}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button onClick={handleStop}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>

        <button onClick={() => { setMuted(v => !v); if (videoRef.current) videoRef.current.muted = !muted; }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors ml-1"
        >
          {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>
        <input type="range" min={0} max={100} value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
        <div className="flex-1" />
        <button onClick={() => videoRef.current?.requestFullscreen?.()}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors"
        >
          <Maximize className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
