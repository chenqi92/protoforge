// 视频流调试工作台 — 七协议模式切换
// 布局：Tabs+URL 固定顶部 → 可拖拽分栏（上：视频+配置 | 下：协议报文）
import { useState, useEffect, useRef, useCallback } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Camera, Radio, Film, ListVideo, Webcam, Shield, Zap, Aperture, MonitorPlay, Play, Pause, Square, Volume2, GripHorizontal, History, X, Download } from "lucide-react";
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
import { OnvifPanel } from "./OnvifPanel";

const MODES: { value: VideoProtocol; labelKey: string; hintKey: string; icon: React.ReactNode }[] = [
  { value: "rtsp",     labelKey: "videostream.modes.rtsp",    hintKey: "videostream.modes.rtspHint",    icon: <Camera className="w-3.5 h-3.5" /> },
  { value: "rtmp",     labelKey: "videostream.modes.rtmp",    hintKey: "videostream.modes.rtmpHint",    icon: <Radio className="w-3.5 h-3.5" /> },
  { value: "http-flv", labelKey: "videostream.modes.httpFlv", hintKey: "videostream.modes.httpFlvHint", icon: <Film className="w-3.5 h-3.5" /> },
  { value: "hls",      labelKey: "videostream.modes.hls",     hintKey: "videostream.modes.hlsHint",     icon: <ListVideo className="w-3.5 h-3.5" /> },
  { value: "webrtc",   labelKey: "videostream.modes.webrtc",  hintKey: "videostream.modes.webrtcHint",  icon: <Webcam className="w-3.5 h-3.5" /> },
  { value: "gb28181",  labelKey: "videostream.modes.gb28181", hintKey: "videostream.modes.gb28181Hint", icon: <Shield className="w-3.5 h-3.5" /> },
  { value: "srt",      labelKey: "videostream.modes.srt",     hintKey: "videostream.modes.srtHint",     icon: <Zap className="w-3.5 h-3.5" /> },
  { value: "onvif",    labelKey: "videostream.modes.onvif",   hintKey: "videostream.modes.onvifHint",   icon: <Aperture className="w-3.5 h-3.5" /> },
];

const MODE_COLORS: Record<VideoProtocol, string> = {
  rtsp: 'bg-blue-500', rtmp: 'bg-rose-500', 'http-flv': 'bg-orange-500',
  hls: 'bg-emerald-500', webrtc: 'bg-indigo-500', gb28181: 'bg-cyan-600', srt: 'bg-violet-500', onvif: 'bg-teal-500',
};

type RecentStream = { url: string; protocol: VideoProtocol; label?: string };

function rsKey() { return 'pf:recent-streams'; }

function loadRecentStreams(): RecentStream[] {
  try { return JSON.parse(localStorage.getItem(rsKey()) || '[]'); } catch { return []; }
}

function saveRecentStream(url: string, protocol: VideoProtocol) {
  const list = loadRecentStreams().filter(r => !(r.url === url && r.protocol === protocol));
  localStorage.setItem(rsKey(), JSON.stringify([{ url, protocol }, ...list].slice(0, 12)));
}

export function VideoStreamWorkspace({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<VideoProtocol>("rtsp");
  const sessionKey = useRef(sessionId ?? crypto.randomUUID()).current;
  const activeMode = MODES.find((m) => m.value === mode) || MODES[0];

  // ── State ──
  const [recentStreams, setRecentStreams] = useState<RecentStream[]>(loadRecentStreams);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [protocolMessages, setProtocolMessages] = useState<ProtocolMessage[]>([]);
  const [playing, setPlaying] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [protocolMessages.length]);

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
    else { if (!streamUrl.trim()) return; setConnecting(true); saveRecentStream(streamUrl, mode); setRecentStreams(loadRecentStreams()); try { await vsSvc.connectStream(sessionKey, mode, { url: streamUrl }); } catch { setConnecting(false); } }
  }, [connected, sessionKey, mode, streamUrl]);

  const handlePlay = useCallback(async () => { if (!connected) return; try { await vsSvc.playerLoad(sessionKey, streamUrl); setPlaying(true); } catch { /* */ } }, [connected, sessionKey, streamUrl]);
  const handlePause = useCallback(async () => { await vsSvc.playerControl(sessionKey, 'pause').catch(() => {}); setPlaying(false); }, [sessionKey]);
  const handleStop = useCallback(async () => { await vsSvc.playerControl(sessionKey, 'stop').catch(() => {}); setPlaying(false); }, [sessionKey]);

  const selectedMsg = selectedMsgId ? protocolMessages.find(m => m.id === selectedMsgId) : null;

  // ── Protocol config panel ──
  const renderProtocolConfig = () => {
    switch (mode) {
      case 'rtsp': return <RtspPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
      case 'rtmp': return <RtmpPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
      case 'http-flv': return <HttpFlvPanel sessionKey={sessionKey} connected={connected} />;
      case 'hls': return <HlsPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} />;
      case 'webrtc': return <WebRtcPanel sessionKey={sessionKey} connected={connected} />;
      case 'gb28181': return <Gb28181Panel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
      case 'srt': return <SrtPanel sessionKey={sessionKey} connected={connected} />;
      case 'onvif': return <OnvifPanel sessionKey={sessionKey} connected={connected} streamUrl={streamUrl} onStreamUrlChange={setStreamUrl} />;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent p-3">
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
        </div>
      </div>

      {/* ── Fixed: URL Bar ── */}
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

      {/* ── Recent Streams ── */}
      {recentStreams.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap px-0.5 pt-1.5">
          <div className="flex items-center gap-1 text-text-disabled shrink-0">
            <History className="w-3 h-3" />
            <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wide">
              {t('tcp.recentConnections', '最近')}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {recentStreams.slice(0, 8).map((r, i) => (
              <div key={i} className="group flex items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden transition-all hover:border-accent/40">
                <button
                  onClick={() => { setStreamUrl(r.url); setMode(r.protocol); }}
                  className="h-[22px] px-2 text-[var(--fs-xxs)] font-mono text-text-secondary hover:text-text-primary hover:bg-accent-soft transition-colors flex items-center gap-1"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", MODE_COLORS[r.protocol]?.replace('bg-', 'bg-') || 'bg-text-disabled')} />
                  <span className="truncate max-w-[180px]">{r.url}</span>
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

      {/* ── Resizable: vertical split (top: video+config, bottom: protocol log) ── */}
      <div className="flex-1 min-h-0 pt-3">
        <PanelGroup orientation="vertical">
          {/* ═══ Top Panel: Video Player + Protocol Config ═══ */}
          <Panel id="vs-top" defaultSize="55%" minSize="25%">
            <PanelGroup orientation="horizontal">
              {/* Video Player */}
              <Panel id="vs-player" defaultSize="60%" minSize="30%">
                <div className="h-full rounded-[var(--radius-md)] border border-border-default/75 bg-black overflow-hidden flex flex-col">
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
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
                <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
              </PanelResizeHandle>

              {/* Protocol Config */}
              <Panel id="vs-config" defaultSize="40%" minSize="20%">
                <div className="h-full rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden flex flex-col">
                  <div className="shrink-0 px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30 flex items-center justify-between">
                    <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                      {t('videostream.protocolConfig', '协议配置')}
                    </span>
                    <span className="text-[var(--fs-3xs)] text-text-disabled font-mono">{mode.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    {renderProtocolConfig()}
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          {/* Horizontal resize handle */}
          <PanelResizeHandle className="relative h-[7px] shrink-0 cursor-row-resize group flex items-center justify-center">
            <div className="absolute inset-x-0 top-[3px] h-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
            <GripHorizontal className="relative w-4 h-3 text-text-disabled/30 group-hover:text-accent/50 transition-colors" />
          </PanelResizeHandle>

          {/* ═══ Bottom Panel: Protocol Message Log ═══ */}
          <Panel id="vs-log" defaultSize="45%" minSize="10%">
            <div className="h-full rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary overflow-hidden flex flex-col">
              {/* Log header with status */}
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-default/60 bg-bg-secondary/30">
                <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
                  {t('videostream.protocolLog', '协议报文')}
                </span>
                <span className="text-[var(--fs-xxs)] text-text-disabled">{protocolMessages.length} {t('videostream.messages', '条')}</span>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-text-disabled/40")} />
                  <span className="text-[var(--fs-3xs)] text-text-disabled">{connected ? t('videostream.connected', '已连接') : t('videostream.idle', '空闲')}</span>
                </div>
                {streamInfo && (
                  <div className="flex items-center gap-1.5 ml-2 text-[var(--fs-3xs)] text-text-disabled font-mono">
                    <span>{streamInfo.codec}</span>
                    {streamInfo.width > 0 && <span>{streamInfo.width}×{streamInfo.height}</span>}
                    {streamInfo.bitrate > 0 && <span>{streamInfo.bitrate}kbps</span>}
                  </div>
                )}
                {stats && (
                  <div className="flex items-center gap-1.5 ml-2 text-[var(--fs-3xs)] font-mono">
                    <span className="text-text-disabled">{stats.packetsReceived} pkts</span>
                    {stats.packetsLost > 0 && <span className="text-red-400">{stats.packetsLost} lost</span>}
                  </div>
                )}
                {protocolMessages.length > 0 && (
                  <button onClick={() => {
                    const blob = new Blob([JSON.stringify(protocolMessages, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `protocol-messages-${mode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                    className="text-[var(--fs-3xs)] text-text-disabled hover:text-accent transition-colors"
                    title={t('videostream.exportMessages', '导出报文')}
                  >
                    <Download className="w-3 h-3" />
                  </button>
                )}
                {protocolMessages.length > 0 && (
                  <button onClick={() => { setProtocolMessages([]); setSelectedMsgId(null); }}
                    className="text-[var(--fs-3xs)] text-text-disabled hover:text-red-500 transition-colors ml-2"
                  >{t('sidebar.clearAll', '清空')}</button>
                )}
              </div>

              {/* Log content with optional detail split */}
              <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Message List */}
                <div className={cn("overflow-y-auto", selectedMsg ? "w-1/2 border-r border-border-default/30" : "flex-1")}>
                  {protocolMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-text-disabled">
                      <MonitorPlay className="w-6 h-6 text-text-disabled/40" />
                      <span className="text-[var(--fs-xs)]">{t('videostream.noMessages', '暂无协议报文')}</span>
                      <span className="text-[var(--fs-xxs)] text-text-disabled/60">{t('videostream.noMessagesHint', '连接流后将在此显示协议交互日志')}</span>
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

                {/* Detail pane */}
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
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
