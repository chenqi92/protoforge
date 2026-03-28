// 视频流调试工作台 — 七协议模式切换
// 布局：上方 Tabs+URL → 左中右三栏（协议配置 | 视频播放器 | 协议报文）
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Radio, Film, ListVideo, Webcam, Shield, Zap, MonitorPlay, Play, Pause, Square, Volume2, ChevronDown, ChevronRight } from "lucide-react";
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

const MODE_COLORS: Record<VideoProtocol, string> = {
  rtsp: 'bg-blue-500', rtmp: 'bg-rose-500', 'http-flv': 'bg-orange-500',
  hls: 'bg-emerald-500', webrtc: 'bg-indigo-500', gb28181: 'bg-cyan-600', srt: 'bg-violet-500',
};

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
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [protocolMessages.length]);

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
          case 'connected': setConnected(true); setConnecting(false); break;
          case 'disconnected': setConnected(false); setConnecting(false); setPlaying(false); setStreamInfo(null); setStats(null); break;
          case 'error': setConnecting(false); break;
          case 'stream-info': if (e.data) { try { setStreamInfo(JSON.parse(e.data)); } catch { /* */ } } break;
        }
      });
      if (disposed) { ue(); return; } unlistenEvent = ue;
      const us = await vsSvc.onStreamStats((s) => { if (s.sessionId !== sessionKey) return; setStats(s); });
      if (disposed) { us(); return; } unlistenStats = us;
      const um = await vsSvc.onProtocolMessage((m) => { setProtocolMessages((prev) => [...prev.slice(-499), m]); });
      if (disposed) { um(); return; } unlistenMsg = um;
    };
    setup();
    return () => { disposed = true; unlistenEvent?.(); unlistenStats?.(); unlistenMsg?.(); vsSvc.disconnectStream(sessionKey).catch(() => {}); };
  }, [sessionKey]);

  const handleConnect = useCallback(async () => {
    if (connected) { await vsSvc.disconnectStream(sessionKey).catch(() => {}); setConnected(false); setPlaying(false); }
    else { if (!streamUrl.trim()) return; setConnecting(true); try { await vsSvc.connectStream(sessionKey, mode, { url: streamUrl }); } catch { setConnecting(false); } }
  }, [connected, sessionKey, mode, streamUrl]);

  const handlePlay = useCallback(async () => { if (!connected) return; try { await vsSvc.playerLoad(sessionKey, streamUrl); setPlaying(true); } catch { /* */ } }, [connected, sessionKey, streamUrl]);
  const handlePause = useCallback(async () => { await vsSvc.playerControl(sessionKey, 'pause').catch(() => {}); setPlaying(false); }, [sessionKey]);
  const handleStop = useCallback(async () => { await vsSvc.playerControl(sessionKey, 'stop').catch(() => {}); setPlaying(false); }, [sessionKey]);

  const selectedMsg = selectedMsgId ? protocolMessages.find(m => m.id === selectedMsgId) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent p-3">
      {/* ── Row 1: Mode Tab Strip ── */}
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
              : mode === 'hls' ? 'HLS/TS' : mode === 'webrtc' ? 'WebRTC/ICE' : mode === 'gb28181' ? 'GB/T 28181' : 'SRT'}
          </span>
        </div>
      </div>

      {/* ── Row 2: URL Input Bar ── */}
      <div className="shrink-0 pt-3">
        <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
          <div className={cn("flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[var(--fs-xs)] font-semibold text-white shadow-sm", MODE_COLORS[mode])}>
            {activeMode.icon}
            <span>{mode === 'http-flv' ? 'FLV' : mode === 'gb28181' ? 'GB' : mode.toUpperCase()}</span>
          </div>
          <input
            value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)}
            placeholder={mode === 'rtsp' ? 'rtsp://admin:password@192.168.1.100:554/stream1' : mode === 'rtmp' ? 'rtmp://live.example.com/app/stream' : mode === 'http-flv' ? 'http://live.example.com/live/stream.flv' : mode === 'hls' ? 'https://example.com/live/index.m3u8' : mode === 'webrtc' ? 'wss://signal.example.com/ws' : mode === 'gb28181' ? '34020000001320000001' : 'srt://live.example.com:9000'}
            disabled={connected}
            className="h-7 flex-1 bg-transparent text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
            onKeyDown={(e) => e.key === 'Enter' && !connected && handleConnect()}
          />
          <button onClick={handleConnect} disabled={connecting || (!streamUrl.trim() && !connected)}
            className={cn("wb-primary-btn min-w-[80px] px-3", connected ? "bg-red-500 hover:bg-red-600" : connecting ? "bg-amber-500 cursor-wait opacity-70" : "bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 hover:shadow-md")}
          >
            {connected ? t('videostream.disconnect', '断开') : connecting ? t('videostream.connecting', '连接中...') : t('videostream.connect', '连接')}
          </button>
        </div>
      </div>

      {/* ── Row 3: 上下分栏 — 上方（视频+配置左右排列）下方（协议报文） ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">

        {/* ── 上半区：视频播放器（左）+ 协议配置（右）── */}
        <div className="flex gap-3 shrink-0" style={{ height: '45%', minHeight: '200px' }}>

          {/* 视频播放器 */}
          <div className="flex-1 min-w-0 rounded-[var(--radius-md)] border border-border-default/75 bg-black overflow-hidden flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              {!playing ? (
                <div className="flex flex-col items-center gap-2 text-white/30">
                  <MonitorPlay className="w-10 h-10" />
                  <span className="text-[var(--fs-xs)] font-medium">{t('videostream.player.idle', '等待播放...')}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-white/50">
                  <div className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white/70 animate-spin" />
                  <span className="text-[var(--fs-xxs)]">libmpv</span>
                </div>
              )}
            </div>
            {/* Controls */}
            <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-black/30">
              <button onClick={playing ? handlePause : handlePlay} disabled={!connected}
                className="flex h-6 w-6 items-center justify-center rounded-[5px] text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
              >{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>
              <button onClick={handleStop} disabled={!playing}
                className="flex h-6 w-6 items-center justify-center rounded-[5px] text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
              ><Square className="w-3 h-3" /></button>
              <Volume2 className="w-3 h-3 text-white/40 ml-1" />
              <input type="range" min={0} max={100} defaultValue={80}
                className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <div className="flex-1" />
              {streamInfo && (
                <div className="flex items-center gap-1 text-[var(--fs-3xs)] text-white/50 font-mono">
                  <span className="px-1 rounded bg-white/10">{streamInfo.codec}</span>
                  {streamInfo.width > 0 && <span className="px-1 rounded bg-white/10">{streamInfo.width}×{streamInfo.height}</span>}
                  {streamInfo.fps > 0 && <span className="px-1 rounded bg-white/10">{streamInfo.fps}fps</span>}
                </div>
              )}
              {stats && (
                <div className="flex items-center gap-1.5 text-[var(--fs-3xs)] text-white/40 font-mono">
                  <span>{stats.packetsReceived} pkts</span>
                  {stats.packetsLost > 0 && <span className="text-red-400">{stats.packetsLost} lost</span>}
                </div>
              )}
            </div>
          </div>

          {/* 协议配置 */}
          <div className="w-[300px] shrink-0 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden flex flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30">
              <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                {t('videostream.protocolConfig', '协议配置')}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {mode === 'rtsp' && <RtspPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />}
              {mode === 'rtmp' && <RtmpPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />}
              {mode === 'http-flv' && <HttpFlvPanel sessionKey={sessionKey} connected={connected} />}
              {mode === 'hls' && <HlsPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} />}
              {mode === 'webrtc' && <WebRtcPanel sessionKey={sessionKey} connected={connected} />}
              {mode === 'gb28181' && <Gb28181Panel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />}
              {mode === 'srt' && <SrtPanel sessionKey={sessionKey} connected={connected} />}
            </div>
          </div>
        </div>

        {/* ── 下半区：协议报文日志（可折叠） ── */}
        <div className={cn(
          "rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden flex flex-col",
          logCollapsed ? "shrink-0" : "flex-1 min-h-[120px]"
        )}>
          <button
            onClick={() => setLogCollapsed(v => !v)}
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30 hover:bg-bg-hover/50 transition-colors w-full text-left"
          >
            {logCollapsed ? <ChevronRight className="w-3 h-3 text-text-disabled" /> : <ChevronDown className="w-3 h-3 text-text-disabled" />}
            <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
              {t('videostream.protocolLog', '协议报文')}
            </span>
            <span className="text-[var(--fs-xxs)] text-text-disabled ml-1">{protocolMessages.length} {t('videostream.messages', '条')}</span>
            <div className="flex-1" />
            {/* Connection status dot */}
            <div className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-text-disabled/40")} />
              <span className="text-[var(--fs-3xs)] text-text-disabled">{connected ? t('videostream.connected', '已连接') : t('videostream.idle', '空闲')}</span>
            </div>
            {streamInfo && (
              <div className="flex items-center gap-1.5 ml-3 text-[var(--fs-3xs)] text-text-disabled font-mono">
                <span>{streamInfo.codec}</span>
                {streamInfo.width > 0 && <span>{streamInfo.width}×{streamInfo.height}</span>}
                {streamInfo.bitrate > 0 && <span>{streamInfo.bitrate}kbps</span>}
              </div>
            )}
            {protocolMessages.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setProtocolMessages([]); setSelectedMsgId(null); }}
                className="text-[var(--fs-3xs)] text-text-disabled hover:text-red-500 transition-colors ml-2"
              >{t('sidebar.clearAll', '清空')}</button>
            )}
          </button>

          {!logCollapsed && (
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Message List */}
              <div className={cn("overflow-y-auto", selectedMsg ? "w-1/2 border-r border-border-default/30" : "flex-1")}>
                {protocolMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-text-disabled">
                    <MonitorPlay className="w-6 h-6 text-text-disabled/40" />
                    <span className="text-[var(--fs-xs)]">{t('videostream.noMessages', '暂无协议报文')}</span>
                  </div>
                ) : (
                  <div className="divide-y divide-border-default/20">
                    {protocolMessages.map((msg) => (
                      <button key={msg.id} onClick={() => setSelectedMsgId(selectedMsgId === msg.id ? null : msg.id)}
                        className={cn("w-full text-left px-3 py-1 hover:bg-bg-hover/50 transition-colors",
                          selectedMsgId === msg.id && "bg-accent/5 border-l-2 border-l-accent"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[var(--fs-3xs)] font-bold uppercase w-10 shrink-0",
                            msg.direction === 'sent' ? 'text-amber-500' : msg.direction === 'received' ? 'text-emerald-500' : 'text-blue-400'
                          )}>
                            {msg.direction === 'sent' ? '→ SENT' : msg.direction === 'received' ? '← RECV' : 'ℹ INFO'}
                          </span>
                          <span className="text-[var(--fs-3xs)] text-text-disabled font-mono shrink-0">
                            {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}.{String(new Date(msg.timestamp).getMilliseconds()).padStart(3, '0')}
                          </span>
                          {msg.size != null && msg.size > 0 && <span className="text-[var(--fs-3xs)] text-text-disabled shrink-0">{msg.size}B</span>}
                          <span className="text-[var(--fs-xxs)] text-text-primary truncate flex-1">{msg.summary}</span>
                        </div>
                      </button>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>

              {/* Message Detail (right half, shown when selected) */}
              {selectedMsg && (
                <div className="w-1/2 flex flex-col overflow-hidden">
                  <div className="shrink-0 px-3 py-1 border-b border-border-default/40 bg-bg-secondary/20 flex items-center justify-between">
                    <span className="text-[var(--fs-xxs)] font-semibold text-text-secondary">{t('videostream.messageDetail', '报文详情')}</span>
                    <button onClick={() => setSelectedMsgId(null)} className="text-[var(--fs-xxs)] text-text-disabled hover:text-text-secondary p-1">✕</button>
                  </div>
                  <pre className="flex-1 overflow-auto p-2.5 text-[var(--fs-xxs)] font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
                    {selectedMsg.detail}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
