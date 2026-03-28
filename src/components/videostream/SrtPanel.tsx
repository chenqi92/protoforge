// SRT 协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";

interface SrtPanelProps {
  sessionKey: string;
  connected: boolean;
}

export function SrtPanel({ sessionKey, connected: _connected }: SrtPanelProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(9000);
  const [mode, setMode] = useState<'caller' | 'listener' | 'rendezvous'>('caller');
  const [passphrase, setPassphrase] = useState('');
  const [latency, setLatency] = useState(120);
  const [streamId, setStreamId] = useState('');
  const [showEncryption, setShowEncryption] = useState(false);
  const [srtConnecting, setSrtConnecting] = useState(false);
  const [srtConnected, setSrtConnected] = useState(false);

  // Stats (will be populated by backend events)
  const [srtStats] = useState({
    rtt: 0,
    bandwidth: 0,
    retransmitRate: 0,
    dropRate: 0,
    sendRate: 0,
    recvRate: 0,
  });

  const handleSrtConnect = useCallback(async () => {
    setSrtConnecting(true);
    try {
      await vsSvc.srtConnect(sessionKey, { host, port, mode, passphrase, latency, streamId });
      setSrtConnected(true);
    } catch { /* */ }
    setSrtConnecting(false);
  }, [sessionKey, host, port, mode, passphrase, latency, streamId]);

  const handleSrtDisconnect = useCallback(async () => {
    try {
      await vsSvc.srtDisconnect(sessionKey);
      setSrtConnected(false);
    } catch { /* */ }
  }, [sessionKey]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Host / Port */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.srt.target', '目标地址')}
        </label>
        <div className="grid grid-cols-[1fr_80px] gap-1.5">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" disabled={srtConnected}
            className="h-7 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50" />
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} placeholder="9000" disabled={srtConnected}
            className="h-7 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50" />
        </div>
      </div>

      {/* Connection Mode */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.srt.mode', '连接模式')}
        </label>
        <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
          {(['caller', 'listener', 'rendezvous'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={srtConnected}
              className={cn(
                "h-full flex-1 text-[var(--fs-3xs)] font-semibold uppercase tracking-wide transition-colors",
                mode === m ? "bg-accent text-white" : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
              )}
            >
              {m === 'caller' ? 'Caller' : m === 'listener' ? 'Listener' : 'Rendezvous'}
            </button>
          ))}
        </div>
        <p className="text-[var(--fs-3xs)] text-text-disabled">
          {mode === 'caller' ? t('videostream.srt.callerDesc', 'Caller 主动连接到远端 Listener')
            : mode === 'listener' ? t('videostream.srt.listenerDesc', 'Listener 监听端口等待连接')
            : t('videostream.srt.rendezvousDesc', 'Rendezvous 双向同时建立连接')}
        </p>
      </div>

      {/* Stream ID */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          Stream ID
        </label>
        <input value={streamId} onChange={(e) => setStreamId(e.target.value)} placeholder="#!::r=live/stream1" disabled={srtConnected}
          className="h-7 w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50"
        />
      </div>

      {/* Latency */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.srt.latency', '延迟')} (ms)
          </label>
          <span className="text-[var(--fs-xxs)] font-mono text-accent">{latency}ms</span>
        </div>
        <input type="range" min={20} max={8000} step={10} value={latency} onChange={(e) => setLatency(Number(e.target.value))}
          disabled={srtConnected}
          className="w-full h-1.5 accent-accent rounded-full appearance-none bg-bg-secondary/60"
        />
        <div className="flex justify-between text-[var(--fs-3xs)] text-text-disabled">
          <span>20ms</span><span>低延迟</span><span>8000ms</span>
        </div>
      </div>

      {/* Encryption */}
      <div className="space-y-1.5">
        <button onClick={() => setShowEncryption(v => !v)}
          className="flex items-center gap-1.5 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled hover:text-text-secondary transition-colors"
        >
          <Lock className="w-3 h-3" />
          {t('videostream.srt.encryption', '加密设置')}
          <svg className={cn("w-3 h-3 transition-transform", showEncryption && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {showEncryption && (
          <div className="space-y-1.5 pl-1">
            <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={t('videostream.srt.passphrase', '加密口令 (可选)')} disabled={srtConnected}
              className="h-7 w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50"
            />
            <p className="text-[var(--fs-3xs)] text-text-disabled">
              {t('videostream.srt.encryptionHint', 'AES-128/192/256 加密，口令长度 10-79 字符')}
            </p>
          </div>
        )}
      </div>

      {/* SRT Connect/Disconnect */}
      <div className="space-y-1.5">
        {!srtConnected ? (
          <button onClick={handleSrtConnect} disabled={srtConnecting}
            className="h-7 w-full rounded-[6px] border border-border-default/60 bg-accent/10 text-[var(--fs-xxs)] font-semibold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
            {srtConnecting ? 'SRT 连接中...' : 'SRT 连接'}
          </button>
        ) : (
          <button onClick={handleSrtDisconnect}
            className="h-7 w-full rounded-[6px] border border-red-500/40 bg-red-500/10 text-[var(--fs-xxs)] font-semibold text-red-400 hover:bg-red-500/20 transition-colors">
            SRT 断开
          </button>
        )}
      </div>

      {/* Connection Stats */}
      {srtConnected && (
        <div className="space-y-1.5">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.srt.stats', '连接统计')}
          </label>
          <div className="rounded-[6px] border border-border-default/60 bg-bg-secondary/30 p-2 grid grid-cols-2 gap-y-1.5 gap-x-3 text-[var(--fs-xxs)] font-mono">
            <div className="flex justify-between"><span className="text-text-disabled">RTT</span><span className="text-text-primary">{srtStats.rtt}ms</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Bandwidth</span><span className="text-text-primary">{srtStats.bandwidth}Mbps</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Retransmit</span><span className="text-text-primary">{srtStats.retransmitRate}%</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Drop</span><span className={cn(srtStats.dropRate > 0 ? "text-red-400" : "text-text-primary")}>{srtStats.dropRate}%</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Send</span><span className="text-text-primary">{srtStats.sendRate}kbps</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Recv</span><span className="text-text-primary">{srtStats.recvRate}kbps</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
