import { useEffect, useRef, useState } from "react";
import { Loader, MonitorPlay } from "lucide-react";
import { loadEasyPlayer } from "@/lib/easyPlayerLoader";
import type { EasyPlayerInstance, EasyPlayerOptions } from "@/types/easyplayer";

interface EasyPlayerSurfaceProps {
  url: string;
  liveMode?: boolean;
  onReady?: () => void;
  onError?: (msg: string) => void;
}

export function EasyPlayerSurface({ url, liveMode = true, onReady, onError }: EasyPlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<EasyPlayerInstance | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;

    let cancelled = false;
    let readyNotified = false;
    let cleanupHandlers: Array<() => void> = [];

    const destroyPlayer = async () => {
      cleanupHandlers.forEach((fn) => fn());
      cleanupHandlers = [];

      const player = playerRef.current;
      playerRef.current = null;
      if (!player?.destroy) {
        container.replaceChildren();
        return;
      }

      try {
        await player.destroy();
      } catch {
        // Ignore third-party destroy errors on teardown.
      }

      container.replaceChildren();
    };

    const bind = (player: EasyPlayerInstance, event: string, handler: (payload?: unknown) => void) => {
      player.on?.(event, handler);
      cleanupHandlers.push(() => player.off?.(event, handler));
    };

    const init = async () => {
      setLoading(true);
      setStatus("加载 EasyPlayer 内核...");

      try {
        const EasyPlayerCtor = await loadEasyPlayer();
        if (cancelled || !containerRef.current) return;

        const options: EasyPlayerOptions = {
          isLive: liveMode,
          hasAudio: true,
          muted: false,
          stretch: false,
          supportHls265: true,
          loadingTimeout: 10,
          loadingTimeoutReplayTimes: 3,
          useMSE: true,
          useWCS: true,
          useWasm: true,
          autoWasm: true,
          useSIMD: true,
          showBandwidth: true,
          showPerformance: true,
          supportDblclickFullscreen: true,
          hasControl: true,
          controlAutoHide: true,
          operateBtns: {
            fullscreen: true,
            screenshot: true,
            play: true,
            audio: true,
            record: true,
            stretch: true,
            zoom: true,
            quality: !liveMode,
            ptz: false,
          },
          playbackConfig: {
            showControl: true,
            showRateBtn: !liveMode,
            rateConfig: [
              { label: "0.5x", value: 0.5 },
              { label: "1.0x", value: 1 },
              { label: "1.5x", value: 1.5 },
              { label: "2.0x", value: 2 },
            ],
          },
        };

        const player = new EasyPlayerCtor(containerRef.current, options);
        playerRef.current = player;

        bind(player, "play", () => {
          if (cancelled) return;
          setLoading(false);
          setStatus("");
          if (!readyNotified) {
            readyNotified = true;
            onReadyRef.current?.();
          }
        });
        bind(player, "pause", () => {
          if (cancelled) return;
          setStatus("已暂停");
        });
        bind(player, "recordStart", () => {
          if (cancelled) return;
          setStatus("录制中...");
        });
        bind(player, "recordEnd", () => {
          if (cancelled) return;
          setStatus("");
        });
        bind(player, "videoInfo", (payload) => {
          if (cancelled || typeof payload !== "object" || !payload) return;
          const info = payload as { width?: number; height?: number; encType?: string; fps?: number };
          const parts = [
            info.encType,
            info.width && info.height ? `${info.width}x${info.height}` : "",
            info.fps ? `${info.fps}fps` : "",
          ].filter(Boolean);
          if (parts.length > 0) {
            setStatus(parts.join("  "));
          }
        });
        bind(player, "error", (payload) => {
          if (cancelled) return;
          setLoading(false);
          const message = typeof payload === "string"
            ? payload
            : payload instanceof Error
              ? payload.message
              : payload
                ? JSON.stringify(payload)
                : "播放器异常";
          onErrorRef.current?.(`EasyPlayer: ${message}`);
        });

        if (!liveMode && player.playback) {
          await player.playback(url);
        } else {
          await player.play(url);
        }
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      }
    };

    void init();

    return () => {
      cancelled = true;
      void destroyPlayer();
    };
  }, [liveMode, url]);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={containerRef} className="h-full w-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/80">
            <Loader className="w-6 h-6 animate-spin" />
            <span className="text-[var(--fs-xxs)] font-mono">{status || "播放器初始化中..."}</span>
          </div>
        </div>
      )}

      {!loading && status && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-[var(--radius-xs)] bg-black/45 px-2 py-1 text-[var(--fs-3xs)] font-mono text-white/75">
          {status}
        </div>
      )}

      {!url && (
        <div className="absolute inset-0 flex items-center justify-center text-white/35">
          <div className="flex flex-col items-center gap-2">
            <MonitorPlay className="w-6 h-6" />
            <span className="text-[var(--fs-xxs)]">等待可播放的媒体地址</span>
          </div>
        </div>
      )}
    </div>
  );
}
