// 视频流调试工作台 — 七协议模式切换
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Radio, Film, ListVideo, Webcam, Shield, Zap, MonitorPlay, Play, Pause, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { VideoProtocol, StreamInfo, StreamStats, ProtocolMessage } from "@/types/videostream";
import * as vsSvc from "@/services/videoStreamService";
import { RtspPanel } from "./RtspPanel";
import { RtmpPanel } from "./RtmpPanel";
import { HttpFlvPanel } from "./HttpFlvPanel";
import { HlsPanel } from "./HlsPanel";
import { WebRtcPanel } from "./WebRtcPanel";
import { Gb28181Panel } from "./Gb28181Panel";
import { SrtPanel } from "./SrtPanel";

const MODES: { value: VideoProtocol; labelKey: string; hintKey: string; icon: React.ReactNode }[] = [
  { value: "rtsp",     labelKey: "videostream.modes.rtsp",    hintKey: "videostream.modes.rtspHint",    icon: <Camera className="w-3.5 h-3.5" /> },
  { value: "rtmp",     labelKey: "videostream.modes.rtmp",    hintKey: "videostream.modes.rtmpHint",    icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "http-flv", labelKey: "videostream.modes.httpFlv", hintKey: "videostream.modes.httpFlvHint", icon: <Film className="w-3.5 h-3.5" /> },
  { value: "hls",      labelKey: "videostream.modes.hls",     hintKey: "videostream.modes.hlsHint",     icon: <ListVideo className="w-3.5 h-3.5" /> },
  { value: "webrtc",   labelKey: "videostream.modes.webrtc",  hintKey: "videostream.modes.webrtcHint",  icon: <Webcam className="w-3.5 h-3.5" /> },
  { value: "gb28181",  labelKey: "videostream.modes.gb28181", hintKey: "videostream.modes.gb28181Hint", icon: <Shield className="w-3.5 h-3.5" /> },
  { value: "srt",      labelKey: "videostream.modes.srt",     hintKey: "videostream.modes.srtHint",     icon: <Zap className="w-3.5 h-3.5" /> },
];

export function VideoStreamWorkspace({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoProtocol>("rtsp");
  const sessionKey = useRef(sessionId ?? crypto.randomUUID()).current;
  const activeMode = MODES.find((m) => m.value === mode) || MODES[0];

  // ── 共享状态 ──
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [protocolMessages, setProtocolMessages] = useState<ProtocolMessage[]>([]);
  const [playing, setPlaying] = useState(false);

  // ── 事件监听 ──
  useEffect(() => {
    let disposed = false;
    let unlistenEvent: (() => void) | null = null;
    let unlistenStats: (() => void) | null = null;
    let unlistenMsg: (() => void) | null = null;

    const setup = async () => {
      const ue = await vsSvc.onStreamEvent((e) => {
        if (e.sessionId !== sessionKey) return;
        switch (e.eventType) {
          case 'connected':
            setConnected(true);
            setConnecting(false);
            break;
          case 'disconnected':
            setConnected(false);
            setConnecting(false);
            setPlaying(false);
            setStreamInfo(null);
            setStats(null);
            break;
          case 'error':
            setConnecting(false);
            break;
          case 'stream-info':
            if (e.data) {
              try { setStreamInfo(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
            }
            break;
        }
      });
      if (disposed) { ue(); return; }
      unlistenEvent = ue;

      const us = await vsSvc.onStreamStats((s) => {
        if (s.sessionId !== sessionKey) return;
        setStats(s);
      });
      if (disposed) { us(); return; }
      unlistenStats = us;

      const um = await vsSvc.onProtocolMessage((m) => {
        setProtocolMessages((prev) => [...prev.slice(-499), m]);
      });
      if (disposed) { um(); return; }
      unlistenMsg = um;
    };

    setup();
    return () => {
      disposed = true;
      unlistenEvent?.();
      unlistenStats?.();
      unlistenMsg?.();
      vsSvc.disconnectStream(sessionKey).catch(() => {});
    };
  }, [sessionKey]);

  // ── 连接/断开 ──
  const handleConnect = useCallback(async () => {
    if (connected) {
      await vsSvc.disconnectStream(sessionKey).catch(() => {});
      setConnected(false);
      setPlaying(false);
    } else {
      if (!streamUrl.trim()) return;
      setConnecting(true);
      try {
        await vsSvc.connectStream(sessionKey, mode, { url: streamUrl });
      } catch {
        setConnecting(false);
      }
    }
  }, [connected, sessionKey, mode, streamUrl]);

  // ── 播控 ──
  const handlePlay = useCallback(async () => {
    if (!connected) return;
    try {
      await vsSvc.playerLoad(sessionKey, streamUrl);
      setPlaying(true);
    } catch { /* ignore play errors */ }
  }, [connected, sessionKey, streamUrl]);

  const handlePause = useCallback(async () => {
    await vsSvc.playerControl(sessionKey, 'pause').catch(() => {});
    setPlaying(false);
  }, [sessionKey]);

  const handleStop = useCallback(async () => {
    await vsSvc.playerControl(sessionKey, 'stop').catch(() => {});
    setPlaying(false);
  }, [sessionKey]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent p-3">
      {/* Mode Tab Strip */}
      <div className="wb-tool-strip shrink-0">
        <div className="wb-tool-strip-main">
          <div className="wb-tool-segment">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={cn(mode === m.value && "is-active")}
              >
                {m.icon}
                {t(m.labelKey)}
              </button>
            ))}
          </div>
          <span className="wb-tool-inline-note">{t(activeMode.hintKey)}</span>
        </div>
        <div className="wb-tool-strip-actions">
          <span className="wb-tool-chip">
            {mode === 'rtsp' ? 'RTSP/RTP'
              : mode === 'rtmp' ? 'RTMP/FLV'
              : mode === 'http-flv' ? 'HTTP-FLV'
              : mode === 'hls' ? 'HLS/TS'
              : mode === 'webrtc' ? 'WebRTC/ICE'
              : mode === 'gb28181' ? 'GB/T 28181'
              : 'SRT'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
        {/* Video Player Area */}
        <div className="shrink-0 rounded-[var(--radius-md)] border border-border-default/75 bg-black overflow-hidden">
          <div className="relative w-full" style={{ paddingTop: '42%' }}>
            <div className="absolute inset-0 flex items-center justify-center">
              {!playing ? (
                <div className="flex flex-col items-center gap-3 text-white/30">
                  <MonitorPlay className="w-12 h-12" />
                  <span className="text-[var(--fs-sm)] font-medium">
                    {t('videostream.player.idle', '等待播放...')}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-white/50">
                  <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white/70 animate-spin" />
                  <span className="text-[var(--fs-xs)]">
                    {t('videostream.player.rendering', 'libmpv 渲染区域')}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Player Controls */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-t from-black/80 to-black/40">
            <button
              onClick={playing ? handlePause : handlePlay}
              disabled={!connected}
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={handleStop}
              disabled={!playing}
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5 ml-2">
              <Volume2 className="w-3.5 h-3.5 text-white/50" />
              <input
                type="range" min={0} max={100} defaultValue={80}
                className="w-20 h-1 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
            </div>
            <div className="flex-1" />
            {/* Stream info badges */}
            {streamInfo && (
              <div className="flex items-center gap-2 text-[var(--fs-xxs)] text-white/60 font-mono">
                <span className="px-1.5 py-0.5 rounded bg-white/10">{streamInfo.codec}</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">{streamInfo.width}x{streamInfo.height}</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">{streamInfo.fps}fps</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">{streamInfo.bitrate}kbps</span>
              </div>
            )}
            {stats && (
              <div className="flex items-center gap-2 text-[var(--fs-xxs)] text-white/40 font-mono">
                <span>{stats.packetsReceived} pkts</span>
                {stats.packetsLost > 0 && <span className="text-red-400">{stats.packetsLost} lost</span>}
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Connection + Protocol Config + Message Log */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* URL Input Bar */}
          <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
            <div className={cn(
              "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm",
              mode === 'rtsp' ? 'bg-blue-500' : mode === 'rtmp' ? 'bg-rose-500' : mode === 'http-flv' ? 'bg-orange-500' : mode === 'hls' ? 'bg-emerald-500' : mode === 'webrtc' ? 'bg-indigo-500' : mode === 'gb28181' ? 'bg-cyan-600' : 'bg-violet-500'
            )}>
              {activeMode.icon}
              <span>{mode.toUpperCase()}</span>
            </div>
            <input
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder={
                mode === 'rtsp' ? 'rtsp://admin:password@192.168.1.100:554/stream1'
                : mode === 'rtmp' ? 'rtmp://live.example.com/app/stream'
                : mode === 'http-flv' ? 'http://live.example.com/live/stream.flv'
                : mode === 'hls' ? 'https://example.com/live/index.m3u8'
                : mode === 'webrtc' ? 'wss://signal.example.com/ws'
                : mode === 'gb28181' ? '34020000001320000001'
                : 'srt://live.example.com:9000'
              }
              disabled={connected}
              className="h-7 flex-1 bg-transparent text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
              onKeyDown={(e) => e.key === 'Enter' && !connected && handleConnect()}
            />
            <button
              onClick={handleConnect}
              disabled={connecting || (!streamUrl.trim() && !connected)}
              className={cn(
                "wb-primary-btn min-w-[80px] px-3",
                connected
                  ? "bg-red-500 hover:bg-red-600"
                  : connecting
                    ? "bg-amber-500 cursor-wait opacity-70"
                    : "bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 hover:shadow-md"
              )}
            >
              {connected ? (
                <>{t('videostream.disconnect', '断开')}</>
              ) : connecting ? (
                <>{t('videostream.connecting', '连接中...')}</>
              ) : (
                <>{t('videostream.connect', '连接')}</>
              )}
            </button>
          </div>

          {/* Protocol-specific panel + message log */}
          <div className="flex min-h-0 flex-1 gap-3">
            {/* Left: Protocol config */}
            <div className="w-[320px] shrink-0 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-y-auto">
              <div className="px-3 py-2.5 border-b border-border-default/60 bg-bg-secondary/30">
                <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                  {t('videostream.protocolConfig', '协议配置')}
                </span>
              </div>
              <div className="p-3">
                {mode === 'rtsp' && (
                  <RtspPanel
                    sessionKey={sessionKey}
                    connected={connected}
                    streamUrl={streamUrl}
                    onStreamUrlChange={setStreamUrl}
                  />
                )}
                {mode === 'rtmp' && (
                  <RtmpPanel
                    sessionKey={sessionKey}
                    connected={connected}
                    streamUrl={streamUrl}
                    onStreamUrlChange={setStreamUrl}
                  />
                )}
                {mode === 'http-flv' && (
                  <HttpFlvPanel
                    sessionKey={sessionKey}
                    connected={connected}
                  />
                )}
                {mode === 'hls' && (
                  <HlsPanel
                    sessionKey={sessionKey}
                    connected={connected}
                    streamUrl={streamUrl}
                  />
                )}
                {mode === 'webrtc' && (
                  <WebRtcPanel
                    sessionKey={sessionKey}
                    connected={connected}
                  />
                )}
                {mode === 'gb28181' && (
                  <Gb28181Panel
                    sessionKey={sessionKey}
                    connected={connected}
                    streamUrl={streamUrl}
                    onStreamUrlChange={setStreamUrl}
                  />
                )}
                {mode === 'srt' && (
                  <SrtPanel
                    sessionKey={sessionKey}
                    connected={connected}
                  />
                )}
              </div>
            </div>

            {/* Right: Protocol message log */}
            <div className="flex-1 min-w-0 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden flex flex-col">
              <div className="px-3 py-2.5 border-b border-border-default/60 bg-bg-secondary/30 flex items-center justify-between">
                <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                  {t('videostream.protocolLog', '协议报文')}
                </span>
                <div className="flex items-center gap-2 text-[var(--fs-xxs)] text-text-disabled">
                  <span>{protocolMessages.length} {t('videostream.messages', '条')}</span>
                  {protocolMessages.length > 0 && (
                    <button
                      onClick={() => setProtocolMessages([])}
                      className="text-text-disabled hover:text-red-500 transition-colors"
                    >
                      {t('sidebar.clearAll', '清空')}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {protocolMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-disabled">
                    <MonitorPlay className="w-8 h-8 text-text-disabled/40" />
                    <span className="text-[var(--fs-sm)]">{t('videostream.noMessages', '暂无协议报文')}</span>
                    <span className="text-[var(--fs-xs)]">{t('videostream.noMessagesHint', '连接流后将在此显示协议交互日志')}</span>
                  </div>
                ) : (
                  <div className="divide-y divide-border-default/30">
                    {protocolMessages.map((msg) => (
                      <div key={msg.id} className="px-3 py-2 hover:bg-bg-hover/50 transition-colors group cursor-default">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={cn(
                            "text-[var(--fs-3xs)] font-bold uppercase",
                            msg.direction === 'sent' ? 'text-amber-500' : msg.direction === 'received' ? 'text-emerald-500' : 'text-text-disabled'
                          )}>
                            {msg.direction === 'sent' ? '-> SENT' : msg.direction === 'received' ? '<- RECV' : 'i INFO'}
                          </span>
                          <span className="text-[var(--fs-3xs)] text-text-disabled font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                            .{String(new Date(msg.timestamp).getMilliseconds()).padStart(3, '0')}
                          </span>
                          {msg.size !== undefined && (
                            <span className="text-[var(--fs-3xs)] text-text-disabled">{msg.size}B</span>
                          )}
                        </div>
                        <p className="text-[var(--fs-xs)] text-text-primary truncate">{msg.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
