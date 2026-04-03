// 视频流调试工作台 — 七协议模式切换
// 布局：Tabs+URL 固定顶部 → 可拖拽分栏（上：视频+配置 | 下：协议报文）
import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Camera, Radio, Film, ListVideo, Webcam, Shield, Zap, Aperture, MonitorPlay, GripHorizontal, GripVertical, History, X, Download, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { modeLikelyNeedsFfmpeg, resolvePlaybackTarget, supportsIntegratedPlayback } from "@/lib/videoPlayback";
import type {
  FfmpegStatus,
  ProtocolMessage,
  RtmpConfig,
  RtspConfig,
  SrtConfig,
  StreamInfo,
  StreamStats,
  VideoProtocol,
} from "@/types/videostream";
import * as vsSvc from "@/services/videoStreamService";
import { VideoPlayer } from "./VideoPlayer";
import { RtspPanel } from "./RtspPanel";
import { RtmpPanel } from "./RtmpPanel";
import { HttpFlvPanel } from "./HttpFlvPanel";
import { HlsPanel } from "./HlsPanel";
import { WebRtcPanel } from "./WebRtcPanel";
import { Gb28181Panel } from "./Gb28181Panel";
import { SrtPanel } from "./SrtPanel";
import { OnvifPanel } from "./OnvifPanel";

const MODES: { value: VideoProtocol; labelKey: string; hintKey: string; icon: React.ReactNode }[] = [
  { value: "onvif",    labelKey: "videostream.modes.onvif",   hintKey: "videostream.modes.onvifHint",   icon: <Aperture className="w-3.5 h-3.5" /> },
  { value: "rtsp",     labelKey: "videostream.modes.rtsp",    hintKey: "videostream.modes.rtspHint",    icon: <Camera className="w-3.5 h-3.5" /> },
  { value: "rtmp",     labelKey: "videostream.modes.rtmp",    hintKey: "videostream.modes.rtmpHint",    icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "http-flv", labelKey: "videostream.modes.httpFlv", hintKey: "videostream.modes.httpFlvHint", icon: <Film className="w-3.5 h-3.5" /> },
  { value: "hls",      labelKey: "videostream.modes.hls",     hintKey: "videostream.modes.hlsHint",     icon: <ListVideo className="w-3.5 h-3.5" /> },
  { value: "webrtc",   labelKey: "videostream.modes.webrtc",  hintKey: "videostream.modes.webrtcHint",  icon: <Webcam className="w-3.5 h-3.5" /> },
  { value: "gb28181",  labelKey: "videostream.modes.gb28181", hintKey: "videostream.modes.gb28181Hint", icon: <Shield className="w-3.5 h-3.5" /> },
  { value: "srt",      labelKey: "videostream.modes.srt",     hintKey: "videostream.modes.srtHint",     icon: <Zap className="w-3.5 h-3.5" /> },
];

const MODE_COLORS: Record<VideoProtocol, string> = {
  rtsp: 'bg-blue-500', rtmp: 'bg-rose-500', 'http-flv': 'bg-orange-500',
  hls: 'bg-emerald-500', webrtc: 'bg-indigo-500', gb28181: 'bg-cyan-600', srt: 'bg-violet-500', onvif: 'bg-teal-500',
};

const MAX_VISIBLE_VIDEO_MESSAGES = 400;

type RecentStream = { url: string; protocol: VideoProtocol; label?: string };

function rsKey() { return 'pf:recent-streams'; }

function loadRecentStreams(): RecentStream[] {
  try { return JSON.parse(localStorage.getItem(rsKey()) || '[]'); } catch { return []; }
}

function sanitizeRecentStreamLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = parsed.username ? "***" : "";
    }
    if (parsed.password) {
      parsed.password = "***";
    }
    for (const key of ["token", "passphrase", "password", "auth", "signature"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "***");
      }
    }
    return parsed.toString();
  } catch {
    return url
      .replace(/\/\/([^/@:]+):([^@/]+)@/g, "//$1:***@")
      .replace(/([?&](?:token|passphrase|password|auth|signature)=)[^&]+/gi, "$1***");
  }
}

function saveRecentStream(url: string, protocol: VideoProtocol) {
  const list = loadRecentStreams().filter(r => !(r.url === url && r.protocol === protocol));
  localStorage.setItem(rsKey(), JSON.stringify([{ url, protocol, label: sanitizeRecentStreamLabel(url) }, ...list].slice(0, 12)));
}

const DEFAULT_RTSP_CONFIG: RtspConfig = {
  url: "",
  username: "",
  password: "",
  transport: "tcp",
  authMethod: "none",
};

const DEFAULT_RTMP_CONFIG: RtmpConfig = {
  url: "",
  mode: "pull",
  streamKey: "",
};

const DEFAULT_SRT_CONFIG: SrtConfig = {
  host: "127.0.0.1",
  port: 9000,
  mode: "caller",
  passphrase: "",
  latency: 120,
  streamId: "",
};

export const VideoStreamWorkspace = memo(function VideoStreamWorkspace({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoProtocol>("onvif");
  const sessionKey = useRef(sessionId ?? crypto.randomUUID()).current;
  const activeMode = MODES.find((m) => m.value === mode) || MODES[0];

  // ── State ──
  const [recentStreams, setRecentStreams] = useState<RecentStream[]>(loadRecentStreams);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [rtspConfig, setRtspConfig] = useState<RtspConfig>(DEFAULT_RTSP_CONFIG);
  const [rtmpConfig, setRtmpConfig] = useState<RtmpConfig>(DEFAULT_RTMP_CONFIG);
  const [srtConfig, setSrtConfig] = useState<SrtConfig>(DEFAULT_SRT_CONFIG);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [messageMap, setMessageMap] = useState<Record<string, ProtocolMessage[]>>({});
  const filteredMessages = useMemo(() => messageMap[mode] ?? [], [messageMap, mode]);
  const visibleMessages = useMemo(() => {
    if (filteredMessages.length <= MAX_VISIBLE_VIDEO_MESSAGES) {
      return filteredMessages;
    }

    return filteredMessages.slice(-MAX_VISIBLE_VIDEO_MESSAGES);
  }, [filteredMessages]);
  const [, setPlaying] = useState(false); // kept for event handler compat
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [ffmpegProgressText, setFfmpegProgressText] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!logEndRef.current || logEndRef.current.offsetParent === null) {
      return;
    }
    logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages.length]);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | null = null;

    const loadStatus = async () => {
      try {
        const status = await vsSvc.ffmpegStatus();
        if (!disposed) setFfmpegStatus(status);
      } catch {
        if (!disposed) setFfmpegStatus(null);
      }
    };

    void loadStatus();
    void vsSvc.onFfmpegDownloadProgress((progress) => {
      if (disposed) return;
      setFfmpegProgressText(progress.stage);
      setFfmpegStatus((prev) => prev ? { ...prev, downloading: progress.progress < 1 } : prev);
    }).then((fn) => { if (!disposed) unlistenProgress = fn; });

    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, []);

  // ── Events ──
  useEffect(() => {
    let disposed = false;
    let unlistenEvent: (() => void) | null = null;
    let unlistenStats: (() => void) | null = null;
    let unlistenMsg: (() => void) | null = null;
    const setup = async () => {
      const ue = await vsSvc.onStreamEvent((e) => {
        if (e.sessionId !== sessionKey) return;
        switch (e.eventType) {
          case 'connected': setConnected(true); break;
          case 'disconnected':
            setConnected(false);
            setConnecting(false);
            setPlaying(false);
            setPlaybackReady(false);
            setPlaybackPathLabel(null);
            setStreamInfo(null);
            setStats(null);
            break;
          case 'error':
            setConnecting(false);
            setConnected(false);
            setPlaybackReady(false);
            if (e.data) setPlayerError(e.data);
            break;
          case 'stream-info': if (e.data) { try { setStreamInfo(JSON.parse(e.data)); } catch { /* */ } } break;
        }
      });
      if (disposed) { ue(); return; } unlistenEvent = ue;
      const us = await vsSvc.onStreamStats((s) => { if (s.sessionId !== sessionKey) return; setStats(s); });
      if (disposed) { us(); return; } unlistenStats = us;
      const um = await vsSvc.onProtocolMessage((m) => {
        setMessageMap((prev) => {
          const key = m.protocol || 'unknown';
          const bucket = prev[key] ?? [];
          return { ...prev, [key]: [...bucket.slice(-499), m] };
        });
      });
      if (disposed) { um(); return; } unlistenMsg = um;
    };
    setup();
    return () => { disposed = true; unlistenEvent?.(); unlistenStats?.(); unlistenMsg?.(); vsSvc.disconnectStream(sessionKey).catch(() => {}); };
  }, [sessionKey]);

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playbackReady, setPlaybackReady] = useState(false);
  const [playbackPathLabel, setPlaybackPathLabel] = useState<string | null>(null);

  const refreshFfmpegStatus = useCallback(async () => {
    try {
      setFfmpegStatus(await vsSvc.ffmpegStatus());
    } catch {
      setFfmpegStatus(null);
    }
  }, []);

  const handleDownloadFfmpeg = useCallback(async () => {
    setPlayerError(null);
    setFfmpegProgressText("准备下载 FFmpeg...");
    try {
      await vsSvc.ffmpegDownload();
      await refreshFfmpegStatus();
      setFfmpegProgressText("FFmpeg 安装完成");
    } catch (error) {
      setPlayerError(String(error));
      await refreshFfmpegStatus();
    }
  }, [refreshFfmpegStatus]);

  const resolveActiveUrl = useCallback(() => {
    const explicitUrl = streamUrl.trim();
    if (explicitUrl) return explicitUrl;
    if (mode === "srt") return `srt://${srtConfig.host}:${srtConfig.port}`;
    return "";
  }, [mode, srtConfig.host, srtConfig.port, streamUrl]);

  const buildConnectConfig = useCallback((activeUrl: string) => {
    switch (mode) {
      case "rtsp":
        return { protocol: mode, config: { ...rtspConfig, url: activeUrl } };
      case "rtmp":
        return { protocol: mode, config: { ...rtmpConfig, url: activeUrl } };
      case "http-flv":
        return { protocol: mode, config: { url: activeUrl } };
      case "hls":
        return { protocol: mode, config: { url: activeUrl } };
      case "srt": {
        let host = srtConfig.host;
        let port = srtConfig.port;
        try {
          const parsed = new URL(activeUrl);
          host = parsed.hostname || host;
          port = parsed.port ? Number(parsed.port) : port;
        } catch {
          // Keep panel config if the URL is not parseable.
        }
        return { protocol: mode, config: { ...srtConfig, host, port } };
      }
      default:
        return null;
    }
  }, [mode, rtmpConfig, rtspConfig, srtConfig]);

  const handleDisconnectPlayer = useCallback(async () => {
    await vsSvc.disconnectStream(sessionKey).catch(() => {});
    setShowPlayer(false);
    setPlaying(false);
    setConnecting(false);
    setPlaybackReady(false);
    setPlaybackPathLabel(null);
    setPlayerUrl(null);
    setConnected(false);
    setStreamInfo(null);
    setStats(null);
  }, [sessionKey]);

  const handleConnect = useCallback(async () => {
    if (showPlayer) {
      await handleDisconnectPlayer();
      return;
    }
    const activeUrl = resolveActiveUrl();
    if (!activeUrl) return;
    if (!supportsIntegratedPlayback(mode, activeUrl)) {
      setPlayerError(mode === "webrtc"
        ? "当前仅支持直接输入可播放的 WebRTC 媒体地址，例如 webrtc/http/ws 网关地址；面板里的 SDP/ICE 调试流程本身不是播放器地址。"
        : "GB28181 需要先拿到实际媒体地址，再启动播放。请在面板里的“媒体地址”或顶部 URL 栏填写 RTSP、HLS、HTTP-FLV 或 WebRTC 网关地址。");
      return;
    }

    const playbackTarget = resolvePlaybackTarget(mode, activeUrl);
    if (playbackTarget.requiresFfmpeg) {
      const status = ffmpegStatus ?? await vsSvc.ffmpegStatus().catch(() => null);
      if (status) setFfmpegStatus(status);
      if (status && !status.available) {
        setPlayerError("FFmpeg 未安装，当前模式无法启动内置播放器。");
        return;
      }
    }

    setPlayerError(null);
    saveRecentStream(activeUrl, mode);
    setRecentStreams(loadRecentStreams());

    const connectPayload = buildConnectConfig(activeUrl);
    if (connectPayload) {
      try {
        await vsSvc.connectStream(sessionKey, connectPayload.protocol, connectPayload.config);
      } catch (error) {
        setPlayerError(String(error));
        return;
      }
    }

    // Set the expected player URL first so listeners are mounted before backend emits data.
    setPlaybackReady(false);
    setPlaybackPathLabel(playbackTarget.label);
    setPlayerUrl(playbackTarget.engine === "tauri-mse" || !playbackTarget.requiresPlayerLoad ? playbackTarget.url : null);
    setShowPlayer(true);
    setPlaying(true);
    setConnecting(true);
    if (playbackTarget.engine === "tauri-mse") {
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
    }
    if (playbackTarget.requiresPlayerLoad) {
      try {
        const resolvedUrl = await vsSvc.playerLoad(sessionKey, mode, activeUrl, connectPayload?.config);
        setPlayerUrl(resolvedUrl);
      } catch (e) {
        setPlayerError(String(e));
        setConnecting(false);
        setPlaying(false);
        setPlaybackReady(false);
        setPlaybackPathLabel(null);
        setShowPlayer(false);
        setPlayerUrl(null);
        await vsSvc.disconnectStream(sessionKey).catch(() => {});
      }
    }
  }, [showPlayer, resolveActiveUrl, mode, ffmpegStatus, buildConnectConfig, sessionKey, handleDisconnectPlayer]);

  const selectedMsg = selectedMsgId ? filteredMessages.find(m => m.id === selectedMsgId) : null;

  // ── Protocol config panel ──
  const renderProtocolConfig = () => {
    switch (mode) {
      case 'rtsp':
        return (
          <RtspPanel
            sessionKey={sessionKey}
            connected={connected}
            streamUrl={streamUrl}
            onStreamUrlChange={setStreamUrl}
            config={rtspConfig}
            onConfigChange={setRtspConfig}
          />
        );
      case 'rtmp':
        return (
          <RtmpPanel
            sessionKey={sessionKey}
            connected={connected}
            streamUrl={streamUrl}
            onStreamUrlChange={setStreamUrl}
            config={rtmpConfig}
            onConfigChange={setRtmpConfig}
          />
        );
      case 'http-flv': return <HttpFlvPanel sessionKey={sessionKey} connected={connected} />;
      case 'hls': return <HlsPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} />;
      case 'webrtc': return <WebRtcPanel sessionKey={sessionKey} connected={connected} />;
      case 'gb28181': return <Gb28181Panel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
      case 'srt': return <SrtPanel sessionKey={sessionKey} connected={connected} config={srtConfig} onConfigChange={setSrtConfig} />;
      case 'onvif': return <OnvifPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
    }
  };

  const activePlaybackUrl = resolveActiveUrl();
  const ffmpegRequired = activePlaybackUrl
    ? resolvePlaybackTarget(mode, activePlaybackUrl).requiresFfmpeg
    : modeLikelyNeedsFfmpeg(mode);
  const playbackStateLabel = !showPlayer
    ? "未播放"
    : connecting
      ? "启动中"
      : playbackReady
        ? "播放中"
        : "等待中";

  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden overflow-y-hidden bg-transparent p-3">
      {/* ── Fixed: Mode Tabs ── */}
      <div className="wb-tool-strip shrink-0">
        <div className="wb-tool-strip-main">
          <div className="wb-tool-segment">
            {MODES.map((m) => (
              <button key={m.value} onClick={() => setMode(m.value)} className={cn(mode === m.value && "is-active")}>
                {m.icon}{t(m.labelKey)}
              </button>
            ))}
          </div>
          <span className="wb-tool-inline-note">{t(activeMode.hintKey)}</span>
        </div>
        <div className="wb-tool-strip-actions">
          <span className="wb-tool-chip">
            {mode === 'rtsp' ? 'RTSP/RTP' : mode === 'rtmp' ? 'RTMP/FLV' : mode === 'http-flv' ? 'HTTP-FLV'
              : mode === 'hls' ? 'HLS/TS' : mode === 'webrtc' ? 'WebRTC/ICE' : mode === 'gb28181' ? 'GB/T 28181' : mode === 'onvif' ? 'ONVIF/SOAP' : 'SRT'}
          </span>
          {playbackPathLabel && <span className="wb-tool-chip">{playbackPathLabel}</span>}
        </div>
      </div>

      {/* ── Fixed: URL Bar ── */}
      <div className="shrink-0 pt-3">
        <div className="flex min-h-[38px] items-center gap-2 pf-rounded-md border border-border-default/80 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
          <div className={cn("flex h-7 shrink-0 items-center justify-center gap-1.5 pf-rounded-sm px-2.5 pf-text-xs font-semibold text-white shadow-sm", MODE_COLORS[mode])}>
            {activeMode.icon}
            <span>{mode === 'http-flv' ? 'FLV' : mode === 'gb28181' ? 'GB' : mode.toUpperCase()}</span>
          </div>
          <input
            value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)}
            placeholder={mode === 'rtsp' ? 'rtsp://admin:password@192.168.1.100:554/stream1' : mode === 'rtmp' ? 'rtmp://live.example.com/app/stream' : mode === 'http-flv' ? 'http://live.example.com/live/stream.flv' : mode === 'hls' ? 'https://example.com/live/index.m3u8' : mode === 'webrtc' ? 'wss://signal.example.com/ws' : mode === 'gb28181' ? 'rtsp:// / http(s):// / ws(s):// / webrtc:// 媒体地址' : 'srt://live.example.com:9000'}
            disabled={showPlayer}
            className="h-7 flex-1 bg-transparent pf-text-sm font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
            onKeyDown={(e) => e.key === 'Enter' && !showPlayer && handleConnect()}
          />
          <button onClick={handleConnect} disabled={connecting || (!activePlaybackUrl && !showPlayer)}
            className={cn("wb-primary-btn min-w-[80px] px-3", showPlayer ? "bg-error hover:bg-error/90" : connecting ? "bg-warning cursor-wait opacity-70" : "bg-accent hover:bg-accent-hover hover:shadow-md")}
          >
            {showPlayer ? t('videostream.disconnect', '断开') : connecting ? t('videostream.connecting', '连接中...') : t('videostream.play', '播放')}
          </button>
        </div>
      </div>

      {/* ── Recent Streams ── */}
      {recentStreams.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap px-0.5 pt-1.5">
          <div className="flex items-center gap-1 text-text-disabled shrink-0">
            <History className="w-3 h-3" />
            <span className="pf-text-xxs font-semibold uppercase tracking-wide">
              {t('tcp.recentConnections', '最近')}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {recentStreams.slice(0, 8).map((r, i) => (
              <div key={i} className="group flex items-center pf-rounded-sm border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40">
                <button
                  onClick={() => { setStreamUrl(r.url); setMode(r.protocol); }}
                  className="h-[22px] px-2 pf-text-xxs font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors flex items-center gap-1"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", MODE_COLORS[r.protocol]?.replace('bg-', 'bg-') || 'bg-text-disabled')} />
                  <span className="truncate max-w-[180px]" title={r.label || r.url}>{r.label || r.url}</span>
                </button>
                <button
                  onClick={() => {
                    const updated = loadRecentStreams().filter((_, j) => j !== i);
                    localStorage.setItem(rsKey(), JSON.stringify(updated));
                    setRecentStreams(updated);
                  }}
                  className="hidden group-hover:flex h-[22px] w-5 items-center justify-center text-text-disabled hover:text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {ffmpegRequired && ffmpegStatus && !ffmpegStatus.available && (
        <div className="shrink-0 flex items-center gap-2 pf-rounded-sm border border-warning/20 bg-warning/8 px-3 py-2 mt-2">
          <span className="pf-text-xxs text-warning flex-1">
            内置播放器依赖 FFmpeg。当前未检测到可用安装{ffmpegProgressText ? `，${ffmpegProgressText}` : "。"}
          </span>
          <button
            onClick={handleDownloadFfmpeg}
            disabled={ffmpegStatus.downloading}
            className="h-7 px-2.5 pf-rounded-sm bg-warning text-white pf-text-xxs font-semibold hover:bg-warning/90 disabled:opacity-60"
          >
            <Download className="w-3 h-3" />
            {ffmpegStatus.downloading ? "下载中..." : "下载 FFmpeg"}
          </button>
        </div>
      )}

      {/* ── Player error toast ── */}
      {playerError && (
        <div className="shrink-0 flex items-center gap-2 pf-rounded-sm bg-error/10 border border-error/20 px-3 py-1.5 mt-2">
          <span className="text-error pf-text-sm">&#9888;</span>
          <span className="flex-1 pf-text-xxs text-error">{playerError}</span>
          <button onClick={() => setPlayerError(null)} className="text-error/60 hover:text-error"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ── Resizable: vertical split (top: config+player, bottom: protocol log) ── */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden pt-3">
        <PanelGroup orientation="horizontal">
          {/* ═══ Left Panel: Protocol Config ═══ */}
          <Panel id="vs-left" defaultSize={35} minSize={20}>
            <div className="h-full pf-rounded-md border border-border-default/80 bg-bg-primary overflow-hidden flex flex-col">
              <div className="wb-pane-header shrink-0">
                <span className="pf-text-xs font-semibold text-text-secondary">
                  {t('videostream.protocolConfig', '协议配置')}
                </span>
                <span className="pf-text-3xs text-text-disabled font-mono">{mode.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-3">
                <div className="min-w-0 max-w-full overflow-x-hidden">
                  {renderProtocolConfig()}
                </div>
              </div>
            </div>
          </Panel>

          {/* Vertical resize handle */}
          <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
            <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
            <GripVertical className="relative w-3 h-4 text-text-disabled/30 group-hover:text-accent/50 transition-colors" />
          </PanelResizeHandle>

          {/* ═══ Right Panel: Video + Log ═══ */}
          <Panel id="vs-right" defaultSize={65} minSize={30}>
            <PanelGroup orientation="vertical">
              {/* ═══ Top Right Panel: Video Player ═══ */}
              <Panel id="vs-player" defaultSize={55} minSize={20}>
                <div className="h-full pf-rounded-md border border-border-default/80 bg-black overflow-hidden flex flex-col relative">
                  <div className="flex-1 w-full bg-[#0a0a0a] flex flex-col items-center justify-center relative overflow-hidden">
                    {showPlayer ? (
                      <div className="absolute inset-0 w-full h-full flex flex-col">
                        <VideoPlayer
                          url={playerUrl}
                          sessionId={sessionKey}
                          liveMode={mode !== "hls"}
                          onStop={() => {
                            void handleDisconnectPlayer();
                          }}
                          onReady={() => {
                            setConnecting(false);
                            setConnected(true);
                            setPlaybackReady(true);
                          }}
                          onError={(error) => {
                            setConnecting(false);
                            setConnected(false);
                            setPlaybackReady(false);
                            setPlayerError(error);
                          }}
                        />
                        {connecting && !playerUrl && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                            <div className="flex flex-col items-center gap-2 text-white/75">
                              <Loader className="w-6 h-6 animate-spin" />
                              <span className="pf-text-xxs font-mono">
                                {playbackPathLabel === "本地 HLS 网关" ? "启动本地媒体网关..." : "等待播放器初始化..."}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 text-text-disabled/40">
                        <MonitorPlay className="w-10 h-10 opacity-60" />
                        <span className="pf-text-xs font-medium text-text-disabled/80">等待视频流接入...</span>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              {/* Horizontal resize handle */}
              <PanelResizeHandle className="relative h-[7px] shrink-0 cursor-row-resize group flex items-center justify-center">
                <div className="absolute inset-x-0 top-[3px] h-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
                <GripHorizontal className="relative w-4 h-3 text-text-disabled/30 group-hover:text-accent/50 transition-colors" />
              </PanelResizeHandle>

              {/* ═══ Bottom Right Panel: Protocol Message Log ═══ */}
              <Panel id="vs-log" defaultSize={45} minSize={10}>
            <div className="h-full pf-rounded-md border border-border-default/80 bg-bg-primary overflow-hidden flex flex-col">
              {/* Log header with status */}
              <div className="wb-pane-header shrink-0">
                <span className="pf-text-xs font-semibold text-text-secondary">
                  {t('videostream.protocolLog', '协议报文')}
                </span>
                <span className="pf-text-xxs text-text-disabled">{filteredMessages.length} {t('videostream.messages', '条')}</span>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-text-disabled/40")} />
                  <span className="pf-text-3xs text-text-disabled">{connected ? t('videostream.connected', '已连接') : t('videostream.idle', '空闲')}</span>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    !showPlayer ? "bg-text-disabled/40" : connecting ? "bg-warning animate-pulse" : playbackReady ? "bg-sky-400" : "bg-text-disabled/60",
                  )} />
                  <span className="pf-text-3xs text-text-disabled">{playbackStateLabel}</span>
                </div>
                {streamInfo && (
                  <div className="flex items-center gap-1.5 ml-2 pf-text-3xs text-text-disabled font-mono">
                    <span>{streamInfo.codec}</span>
                    {streamInfo.width > 0 && <span>{streamInfo.width}×{streamInfo.height}</span>}
                    {streamInfo.bitrate > 0 && <span>{streamInfo.bitrate}kbps</span>}
                  </div>
                )}
                {stats && (
                  <div className="flex items-center gap-1.5 ml-2 pf-text-3xs font-mono">
                    <span className="text-text-disabled">{stats.packetsReceived} pkts</span>
                    {stats.packetsLost > 0 && <span className="text-red-400">{stats.packetsLost} lost</span>}
                  </div>
                )}
                {filteredMessages.length > 0 && (
                  <button onClick={() => {
                    const blob = new Blob([JSON.stringify(filteredMessages, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `protocol-messages-${mode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                    className="pf-text-3xs text-text-disabled hover:text-accent transition-colors"
                    title={t('videostream.exportMessages', '导出报文')}
                  >
                    <Download className="w-3 h-3" />
                  </button>
                )}
                {filteredMessages.length > 0 && (
                  <button onClick={() => { setMessageMap(prev => ({ ...prev, [mode]: [] })); setSelectedMsgId(null); }}
                    className="pf-text-3xs text-text-disabled hover:text-red-500 transition-colors ml-2"
                  >{t('sidebar.clearAll', '清空')}</button>
                )}
              </div>

              {/* Log content with optional detail split */}
              <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                {/* Message List */}
                <div className={cn("min-w-0 overflow-y-auto overflow-x-hidden", selectedMsg ? "w-1/2 border-r border-border-default/30" : "flex-1")}>
                  {filteredMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-disabled">
                      <div className="flex h-10 w-10 items-center justify-center pf-rounded-md bg-bg-secondary/60 border border-border-default/40">
                        <MonitorPlay className="w-5 h-5 text-text-disabled/60" />
                      </div>
                      <span className="pf-text-xs font-medium">{t('videostream.noMessages', '暂无协议报文')}</span>
                      <span className="pf-text-xxs text-text-disabled/60">{t('videostream.noMessagesHint', '连接流后将在此显示协议交互日志')}</span>
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-border-default/20">
                        {visibleMessages.map((msg) => (
                          <button key={msg.id} onClick={() => setSelectedMsgId(selectedMsgId === msg.id ? null : msg.id)}
                            className={cn("w-full text-left px-3 py-1.5 hover:bg-bg-hover/50 transition-colors",
                              selectedMsgId === msg.id && "bg-accent/5 border-l-2 border-l-accent"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn("pf-text-3xs font-bold uppercase w-10 shrink-0",
                                msg.direction === 'sent' ? 'text-amber-500' : msg.direction === 'received' ? 'text-emerald-500' : 'text-blue-400'
                              )}>
                                {msg.direction === 'sent' ? '→ SENT' : msg.direction === 'received' ? '← RECV' : 'ℹ INFO'}
                              </span>
                              <span className="pf-text-3xs text-text-disabled font-mono shrink-0">
                                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}.{String(new Date(msg.timestamp).getMilliseconds()).padStart(3, '0')}
                              </span>
                              {msg.size != null && msg.size > 0 && <span className="pf-text-3xs text-text-disabled shrink-0">{msg.size}B</span>}
                              <span className="pf-text-xxs text-text-primary truncate flex-1">{msg.summary}</span>
                            </div>
                          </button>
                        ))}
                        <div ref={logEndRef} />
                      </div>
                      {filteredMessages.length > MAX_VISIBLE_VIDEO_MESSAGES ? (
                        <div className="border-t border-border-default/30 px-3 py-1.5 pf-text-xxs text-text-disabled">
                          {`为保证性能，仅显示最近 ${MAX_VISIBLE_VIDEO_MESSAGES} 条协议报文`}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Detail pane */}
                {selectedMsg && (
                  <div className="flex w-1/2 min-w-0 flex-col overflow-hidden">
                    <div className="shrink-0 px-3 py-1 border-b border-border-default/40 bg-bg-secondary/20 flex items-center justify-between">
                      <span className="pf-text-xxs font-semibold text-text-secondary">{t('videostream.messageDetail', '报文详情')}</span>
                      <button onClick={() => setSelectedMsgId(null)} className="pf-text-xxs text-text-disabled hover:text-text-secondary p-1">✕</button>
                    </div>
                    <pre className="flex-1 overflow-auto p-2.5 pf-text-xxs font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
                      {selectedMsg.detail}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  </div>
</div>
  );
});

VideoStreamWorkspace.displayName = "VideoStreamWorkspace";
