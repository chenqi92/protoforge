import { useRef, useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  Circle,
  Loader,
  Maximize,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";

interface NativeVideoSurfaceProps {
  url: string | null;
  sessionId: string;
  onError?: (msg: string) => void;
  onReady?: () => void;
  onStop?: () => void;
  liveMode?: boolean;
}

interface InitEvent {
  sessionId: string;
  codec: string;
  width: number;
  height: number;
  hasAudio: boolean;
}

interface DataEvent {
  sessionId: string;
  seq: number;
  data: string;
}

interface ErrorEvent {
  sessionId: string;
  error: string;
}

type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type HlsConstructor = typeof import("hls.js").default;
type HlsInstance = InstanceType<HlsConstructor>;

function codecToMime(codec: string, hasAudio: boolean): string {
  const normalized = codec.toLowerCase();
  const audio = hasAudio ? ', mp4a.40.2' : "";
  if (normalized.includes("h264") || normalized.includes("avc")) {
    return `video/mp4; codecs="avc1.42E01E${audio}"`;
  }
  if (normalized.includes("h265") || normalized.includes("hevc") || normalized.includes("hev")) {
    return `video/mp4; codecs="hev1.1.6.L93.B0${audio}"`;
  }
  return `video/mp4; codecs="avc1.42E01E${audio}"`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function screenshotFileName() {
  return `protoforge-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
}

function recordingFileName() {
  return `protoforge-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
}

function preferredRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export function NativeVideoSurface({ url, sessionId, onError, onReady, onStop, liveMode = true }: NativeVideoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const readyNotifiedRef = useRef(false);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const isHls = url?.startsWith("hls:") ?? false;
  const isTauri = url?.startsWith("tauri:") ?? false;

  useEffect(() => {
    readyNotifiedRef.current = false;
  }, [url]);

  const notifyReady = useCallback(() => {
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    onReadyRef.current?.();
  }, []);

  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isHls) return;

    const hlsUrl = url.slice(4);
    let disposed = false;
    let cleanup: (() => void) | undefined;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const setupNativePlayback = () => {
      setLoading(true);
      setStatus("加载 HLS...");
      video.src = hlsUrl;
      const onLoaded = () => {
        setLoading(false);
        setStatus("");
        void video.play().then(() => {
          setPlaying(true);
          notifyReady();
        }).catch(() => {});
      };
      const onNativeError = () => {
        setLoading(false);
        onErrorRef.current?.("HLS: 浏览器原生播放失败");
      };
      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onNativeError);
      cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onNativeError);
      };
    };

    const setupHlsPlayback = async () => {
      try {
        const { default: Hls } = await import("hls.js/light");
        if (disposed) return;

        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            liveSyncDurationCount: 2,
            maxBufferLength: 5,
          });
          hlsRef.current = hls;
          setLoading(true);
          setStatus("加载 HLS...");
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false);
            setStatus("");
            void video.play().then(() => {
              setPlaying(true);
              notifyReady();
            }).catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; details: string }) => {
            if (data.fatal) {
              setLoading(false);
              onErrorRef.current?.(`HLS: ${data.details}`);
            }
          });
          cleanup = () => {
            hls.destroy();
            hlsRef.current = null;
          };
          return;
        }
      } catch {
        // Fall back to native playback if the lightweight HLS bundle fails to load.
      }

      if (disposed) return;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        setupNativePlayback();
        return;
      }

      setLoading(false);
      onErrorRef.current?.("HLS: 当前运行环境不支持 hls.js 或原生 HLS");
    };

    void setupHlsPlayback();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isHls, notifyReady, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isTauri) return;

    let cancelled = false;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    const pendingBuffers: ArrayBuffer[] = [];
    let sourceBufferReady = false;
    let unlistenInit: (() => void) | null = null;
    let unlistenData: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let objectUrl: string | null = null;
    let playAttempted = false;

    setLoading(true);
    setStatus("等待流数据...");

    function trimBufferedRanges() {
      if (!sourceBuffer || sourceBuffer.updating || !video || video.buffered.length === 0) return;
      try {
        const bufferedStart = video.buffered.start(0);
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const safeTail = liveMode ? 8 : 30;
        const removeEnd = Math.min(video.currentTime - safeTail, bufferedEnd - safeTail);
        if (removeEnd - bufferedStart > 2) {
          sourceBuffer.remove(bufferedStart, removeEnd);
        }
      } catch {
        // Ignore transient buffered range errors.
      }
    }

    function syncToPlaybackTarget() {
      if (!video || video.buffered.length === 0 || video.paused || !liveMode) {
        if (video) {
          video.playbackRate = playbackRate;
        }
        return;
      }

      try {
        const bufferEnd = video.buffered.end(video.buffered.length - 1);
        const lag = bufferEnd - video.currentTime;
        if (lag > 8) {
          video.currentTime = Math.max(bufferEnd - 1, 0);
          video.playbackRate = 1;
        } else if (lag > 2.5) {
          video.playbackRate = 1.03;
        } else {
          video.playbackRate = 1;
        }
      } catch {
        video.playbackRate = playbackRate;
      }
    }

    function flushPending() {
      if (!sourceBuffer || sourceBuffer.updating || pendingBuffers.length === 0) return;
      const chunk = pendingBuffers.shift();
      if (!chunk) return;

      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (error) {
        if (sourceBuffer.buffered.length > 0) {
          try {
            const start = sourceBuffer.buffered.start(0);
            const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
            const removeEnd = Math.min(video?.currentTime ?? end - 4, end - 4);
            if (removeEnd - start > 2) {
              sourceBuffer.remove(start, removeEnd);
              pendingBuffers.unshift(chunk);
            }
          } catch {
            onErrorRef.current?.(`MSE append 失败: ${String(error)}`);
          }
        } else {
          onErrorRef.current?.(`MSE append 失败: ${String(error)}`);
        }
      }
    }

    function tryPlay() {
      if (playAttempted || !video) return;
      playAttempted = true;
      video.muted = true;
      void video.play().then(() => {
        setPlaying(true);
        setLoading(false);
        setStatus("");
        notifyReady();
        setTimeout(() => {
          if (video) {
            video.muted = false;
            video.volume = volume / 100;
          }
        }, 300);
      }).catch(() => {
        playAttempted = false;
      });
    }

    const setup = async () => {
      unlistenInit = await listen<InitEvent>("player-init", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;

        const { codec, width, height, hasAudio } = event.payload;
        const mime = codecToMime(codec, hasAudio);
        setStatus(`${codec.toUpperCase()} ${width > 0 ? `${width}x${height}` : ""}${hasAudio ? " 🔊" : ""}`);

        if (!MediaSource.isTypeSupported(mime)) {
          onErrorRef.current?.(`浏览器不支持编码: ${mime}`);
          setLoading(false);
          return;
        }

        mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        video.src = objectUrl;

        mediaSource.addEventListener("sourceopen", () => {
          if (cancelled || !mediaSource) return;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(mime);
            sourceBuffer.mode = "segments";
            sourceBuffer.addEventListener("updateend", () => {
              trimBufferedRanges();
              flushPending();
              if (video.buffered.length > 0) {
                if (!playAttempted) tryPlay();
                syncToPlaybackTarget();
              }
            });
            sourceBufferReady = true;
            setLoading(false);
            setStatus("缓冲中...");
            flushPending();
          } catch (error) {
            onErrorRef.current?.(`MSE 错误: ${String(error)}`);
            setLoading(false);
          }
        });
      });

      unlistenData = await listen<DataEvent>("player-data", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;

        const raw = atob(event.payload.data);
        const buffer = new ArrayBuffer(raw.length);
        const view = new Uint8Array(buffer);
        for (let index = 0; index < raw.length; index += 1) {
          view[index] = raw.charCodeAt(index);
        }

        if (!sourceBufferReady || !sourceBuffer) {
          pendingBuffers.push(buffer);
          return;
        }

        if (!sourceBuffer.updating) {
          try {
            sourceBuffer.appendBuffer(buffer);
          } catch {
            pendingBuffers.push(buffer);
          }
        } else {
          pendingBuffers.push(buffer);
        }

        if (pendingBuffers.length > 120) {
          setStatus("前端缓冲繁忙，正在追赶实时流...");
        }
      });

      unlistenError = await listen<ErrorEvent>("player-error", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;
        setLoading(false);
        setStatus("");
        onErrorRef.current?.(event.payload.error);
      });
    };

    void setup();

    return () => {
      cancelled = true;
      unlistenInit?.();
      unlistenData?.();
      unlistenError?.();
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isTauri, liveMode, notifyReady, playbackRate, sessionId, url, volume]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => {});
      return;
    }

    video.pause();
    setPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    if (onStop) {
      onStop();
      return;
    }
    videoRef.current?.pause();
    setPlaying(false);
  }, [onStop]);

  const handleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }, [muted]);

  const handleScreenshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      onErrorRef.current?.("当前没有可截图的视频帧。");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || video.clientWidth;
    canvas.height = video.videoHeight || video.clientHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      onErrorRef.current?.("截图失败：无法创建画布上下文。");
      return;
    }

    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (error) {
      onErrorRef.current?.(`截图失败: ${String(error)}`);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        onErrorRef.current?.("截图失败：生成图片数据为空。");
        return;
      }
      triggerDownload(blob, screenshotFileName());
    }, "image/png");
  }, []);

  const handleToggleRecording = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      return;
    }

    const capturableVideo = video as CapturableVideoElement;
    const createCaptureStream = capturableVideo.captureStream ?? capturableVideo.mozCaptureStream;
    if (typeof createCaptureStream !== "function") {
      onErrorRef.current?.("当前运行环境不支持录制视频。");
      return;
    }

    const mediaStream = createCaptureStream.call(capturableVideo);
    const mimeType = preferredRecorderMimeType();
    if (!mimeType) {
      onErrorRef.current?.("当前运行环境不支持 MediaRecorder。");
      return;
    }

    try {
      const recorder = new MediaRecorder(mediaStream, { mimeType });
      recorderRef.current = recorder;
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
      };
      recorder.onstart = () => {
        setRecording(true);
        setStatus("录制中...");
      };
      recorder.onstop = () => {
        setRecording(false);
        setStatus("");
        const blob = new Blob(recordChunksRef.current, { type: mimeType });
        triggerDownload(blob, recordingFileName());
        recordChunksRef.current = [];
      };
      recorder.start(1000);
    } catch (error) {
      onErrorRef.current?.(`启动录制失败: ${String(error)}`);
    }
  }, []);

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  if (!url) {
    return (
      <div className="h-full w-full bg-black pf-rounded-md overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-white/30">
          <Play className="w-6 h-6" />
          <span className="pf-text-xxs">获取流地址后播放</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black pf-rounded-md overflow-hidden flex flex-col">
      <video ref={videoRef} className="flex-1 min-h-0 w-full bg-black object-contain" playsInline muted={muted} />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/70">
            <Loader className="w-6 h-6 animate-spin" />
            {status && <span className="pf-text-xxs font-mono">{status}</span>}
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button
          onClick={handlePlayPause}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={handleStop}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleMute}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/60 hover:text-white transition-colors ml-1"
        >
          {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            const nextMuted = nextVolume === 0;
            setVolume(nextVolume);
            setMuted(nextMuted);
            if (videoRef.current) {
              videoRef.current.volume = nextVolume / 100;
              videoRef.current.muted = nextMuted;
            }
          }}
          className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
        {!liveMode && (
          <select
            value={playbackRate}
            onChange={(event) => {
              const nextRate = Number(event.target.value);
              setPlaybackRate(nextRate);
              if (videoRef.current) {
                videoRef.current.playbackRate = nextRate;
              }
            }}
            className="h-6 pf-rounded-xs border border-white/10 bg-black/40 px-1.5 pf-text-3xs text-white/75 outline-none"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2.0x</option>
          </select>
        )}
        <button
          onClick={handleScreenshot}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/60 hover:text-white transition-colors"
          title="截图"
        >
          <Camera className="w-3 h-3" />
        </button>
        <button
          onClick={handleToggleRecording}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/60 hover:text-white transition-colors"
          title={recording ? "停止录制" : "开始录制"}
        >
          <Circle className={`w-3 h-3 ${recording ? "fill-red-500 text-red-500" : ""}`} />
        </button>
        <div className="flex-1" />
        {status && !loading && <span className="pf-text-3xs text-white/40 font-mono">{status}</span>}
        <button
          onClick={() => videoRef.current?.requestFullscreen?.()}
          className="flex h-6 w-6 items-center justify-center pf-rounded-xs text-white/60 hover:text-white transition-colors"
        >
          <Maximize className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
