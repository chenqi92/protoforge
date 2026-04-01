// 内置视频播放器
// HLS: hls.js 直接播放
// RTSP/RTMP/其他: 后端 FFmpeg 输出 fMP4 → Tauri 事件推送 → MSE 直接 appendBuffer 播放

import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { listen } from "@tauri-apps/api/event";
import { Play, Pause, Square, Volume2, VolumeX, Maximize, Loader } from "lucide-react";

interface VideoPlayerProps {
  url: string | null; // "hls:https://..." or "tauri:rtsp://..." or direct URL
  sessionId: string;
  onError?: (msg: string) => void;
}

interface InitEvent {
  sessionId: string;
  codec: string;
  width: number;
  height: number;
}

interface DataEvent {
  sessionId: string;
  seq: number;
  data: string; // base64-encoded fMP4 chunk
}

interface ErrorEvent {
  sessionId: string;
  error: string;
}

/** Map FFmpeg codec name to MSE mime codec string */
function codecToMime(codec: string): string {
  const c = codec.toLowerCase();
  if (c.includes("h264") || c.includes("avc")) return 'video/mp4; codecs="avc1.42E01E"';
  if (c.includes("h265") || c.includes("hevc") || c.includes("hev")) return 'video/mp4; codecs="hev1.1.6.L93.B0"';
  // Fallback — most streams are H.264
  return 'video/mp4; codecs="avc1.42E01E"';
}

export function VideoPlayer({ url, sessionId, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const isHls = url?.startsWith("hls:") ?? false;
  const isTauri = url?.startsWith("tauri:") ?? false;

  // Cleanup
  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  // ── HLS playback (unchanged) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isHls) return;

    const hlsUrl = url.slice(4); // remove "hls:" prefix
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 5 });
      hlsRef.current = hls;
      setLoading(true);
      setStatus("加载 HLS...");
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false); setStatus("");
        video.play().then(() => setPlaying(true)).catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { setLoading(false); onError?.(`HLS: ${data.details}`); }
      });
      return () => { hls.destroy(); hlsRef.current = null; };
    }
  }, [url, isHls, onError]);

  // ── Tauri event playback (FFmpeg fMP4 → MSE direct append) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isTauri) return;

    let cancelled = false;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    const pendingBuffers: ArrayBuffer[] = [];
    let sbReady = false;
    let unlistenInit: (() => void) | null = null;
    let unlistenData: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let objectUrl: string | null = null;
    let playAttempted = false;

    setLoading(true);
    setStatus("等待流数据...");

    /** Flush pending buffers when SourceBuffer is ready */
    function flushPending() {
      if (!sourceBuffer || sourceBuffer.updating || pendingBuffers.length === 0) return;
      const chunk = pendingBuffers.shift()!;
      try {
        sourceBuffer.appendBuffer(chunk);
      } catch {
        // QuotaExceededError — evict old data & retry
        if (sourceBuffer.buffered.length > 0) {
          try {
            const start = sourceBuffer.buffered.start(0);
            const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
            if (end - start > 10) {
              sourceBuffer.remove(start, end - 5);
            }
          } catch { /* ignore */ }
        }
      }
    }

    /** Try to start playback once we have some data */
    function tryPlay() {
      if (playAttempted || !video) return;
      playAttempted = true;
      video.play().then(() => setPlaying(true)).catch(() => {
        // autoplay blocked — user needs to click play
        playAttempted = false;
      });
    }

    async function setup() {
      // Listen for init event (codec metadata)
      unlistenInit = await listen<InitEvent>("player-init", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;
        const { codec, width, height } = event.payload;

        const mime = codecToMime(codec);
        setStatus(`${codec.toUpperCase()} ${width > 0 ? `${width}x${height}` : ""}`);

        if (!MediaSource.isTypeSupported(mime)) {
          onError?.(`浏览器不支持编码: ${mime}`);
          setLoading(false);
          return;
        }

        // Create MSE
        mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        video!.src = objectUrl;

        mediaSource.addEventListener("sourceopen", () => {
          if (cancelled || !mediaSource) return;
          try {
            sourceBuffer = mediaSource!.addSourceBuffer(mime);
            sourceBuffer.mode = "segments";
            sourceBuffer.addEventListener("updateend", () => {
              flushPending();
              // Auto-play once we have some buffered data
              if (video && video.buffered.length > 0 && !playAttempted) {
                tryPlay();
              }
            });
            sbReady = true;
            setLoading(false);
            setStatus("播放中");
            // Flush any data that arrived before SourceBuffer was ready
            flushPending();
          } catch (e) {
            onError?.(`MSE 错误: ${e}`);
            setLoading(false);
          }
        });
      });

      // Listen for fMP4 data chunks
      unlistenData = await listen<DataEvent>("player-data", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;

        // Decode base64 → ArrayBuffer
        const raw = atob(event.payload.data);
        const buf = new ArrayBuffer(raw.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < raw.length; i++) {
          view[i] = raw.charCodeAt(i);
        }

        if (!sbReady || !sourceBuffer) {
          // Buffer data until SourceBuffer is ready
          pendingBuffers.push(buf);
          // Prevent unbounded buffering before init
          if (pendingBuffers.length > 100) pendingBuffers.splice(0, 50);
          return;
        }

        if (!sourceBuffer.updating) {
          try {
            sourceBuffer.appendBuffer(buf);
          } catch {
            pendingBuffers.push(buf);
          }
        } else {
          pendingBuffers.push(buf);
          // Limit pending queue to prevent memory blowup
          if (pendingBuffers.length > 60) pendingBuffers.splice(0, 30);
        }
      });

      // Listen for player errors from FFmpeg backend
      unlistenError = await listen<ErrorEvent>("player-error", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;
        setLoading(false);
        setStatus("");
        onError?.(event.payload.error);
      });
    }

    setup();

    return () => {
      cancelled = true;
      unlistenInit?.();
      unlistenData?.();
      unlistenError?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, isTauri, sessionId, onError]);

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); }
    else { v.pause(); setPlaying(false); }
  }, []);

  const handleStop = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  if (!url) {
    return (
      <div className="h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-white/30">
          <Play className="w-6 h-6" />
          <span className="text-[var(--fs-xxs)]">获取流地址后播放</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex flex-col">
      <video ref={videoRef} className="flex-1 w-full bg-black object-contain" playsInline muted={muted} />

      {(loading || status) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/70">
            {loading && <Loader className="w-6 h-6 animate-spin" />}
            {status && <span className="text-[var(--fs-xxs)] font-mono">{status}</span>}
          </div>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={handlePlayPause}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>
        <button onClick={handleStop}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        ><Square className="w-3 h-3" /></button>

        <button onClick={() => { setMuted(v => !v); if (videoRef.current) videoRef.current.muted = !muted; }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors ml-1"
        >{muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}</button>
        <input type="range" min={0} max={100} value={volume}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (videoRef.current) { videoRef.current.volume = v / 100; setMuted(v === 0); } }}
          className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
        <div className="flex-1" />
        {status && !loading && <span className="text-[var(--fs-3xs)] text-white/40 font-mono">{status}</span>}
        <button onClick={() => videoRef.current?.requestFullscreen?.()}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors"
        ><Maximize className="w-3 h-3" /></button>
      </div>
    </div>
  );
}
