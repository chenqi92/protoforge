// RTMP 协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import * as vsSvc from "@/services/videoStreamService";

interface RtmpPanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
}

export function RtmpPanel({ sessionKey, connected, streamUrl: _streamUrl, onStreamUrlChange: _onStreamUrlChange }: RtmpPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'pull' | 'push'>('pull');
  const [streamKey, setStreamKey] = useState('');
  const [showHandshake, setShowHandshake] = useState(false);
  const [handshaking, setHandshaking] = useState(false);
  const [handshakePhases, setHandshakePhases] = useState([
    { phase: 'C0', status: 'pending', desc: 'Client version byte' },
    { phase: 'S0', status: 'pending', desc: 'Server version byte' },
    { phase: 'C1', status: 'pending', desc: 'Client random bytes (1536B)' },
    { phase: 'S1', status: 'pending', desc: 'Server random bytes (1536B)' },
    { phase: 'C2', status: 'pending', desc: 'Client echo of S1' },
    { phase: 'S2', status: 'pending', desc: 'Server echo of C1' },
  ]);
  const [appConnected, setAppConnected] = useState(false);

  const handleHandshake = useCallback(async () => {
    setHandshaking(true);
    setShowHandshake(true);
    try {
      // Mark all phases as active during handshake
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: 'active' })));
      await vsSvc.rtmpHandshake(sessionKey);
      // All phases done
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: 'done' })));
    } catch {
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: p.status === 'active' ? 'error' : p.status })));
    }
    setHandshaking(false);
  }, [sessionKey]);

  const handleConnect = useCallback(async () => {
    try {
      await vsSvc.rtmpConnectApp(sessionKey);
      setAppConnected(true);
    } catch { /* */ }
  }, [sessionKey]);

  const handlePlay = useCallback(async () => {
    try {
      await vsSvc.rtmpPlay(sessionKey, streamKey);
    } catch { /* */ }
  }, [sessionKey, streamKey]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Mode: Pull vs Push */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtmp.mode', '模式')}
        </label>
        <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
          {(['pull', 'push'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={connected}
              className={cn(
                "h-full flex-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-colors",
                mode === m ? "bg-accent text-white" : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover",
                connected && "opacity-50"
              )}
            >
              {m === 'pull' ? t('videostream.rtmp.pull', '拉流') : t('videostream.rtmp.push', '推流')}
            </button>
          ))}
        </div>
      </div>

      {/* Stream Key (Push mode) */}
      {mode === 'push' && (
        <div className="space-y-1.5">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.rtmp.streamKey', '推流密钥')}
          </label>
          <input
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder="live_xxx"
            disabled={connected}
            className="h-7 w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      )}

      {/* Handshake & Protocol Actions */}
      {connected && (
        <div className="space-y-2">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.rtmp.actions', '协议操作')}
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleHandshake}
              disabled={handshaking}
              className="h-7 flex-1 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 text-[var(--fs-xxs)] font-semibold text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              {handshaking ? '握手中...' : '握手'}
            </button>
            <button
              onClick={handleConnect}
              disabled={!handshakePhases.some(p => p.status === 'done') || appConnected}
              className="h-7 flex-1 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 text-[var(--fs-xxs)] font-semibold text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              {appConnected ? '已连接' : 'Connect'}
            </button>
            <button
              onClick={handlePlay}
              disabled={!appConnected}
              className="h-7 flex-1 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 text-[var(--fs-xxs)] font-semibold text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              Play
            </button>
          </div>
        </div>
      )}

      {/* Handshake Analysis */}
      <div className="space-y-1.5">
        <button
          onClick={() => setShowHandshake(v => !v)}
          className="flex items-center gap-1.5 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled hover:text-text-secondary transition-colors"
        >
          <svg className={cn("w-3 h-3 transition-transform", showHandshake && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {t('videostream.rtmp.handshake', '握手分析')}
        </button>
        {showHandshake && (
          <div className="space-y-0.5 pl-1">
            {handshakePhases.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-[4px] text-[var(--fs-xxs)] font-mono">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  p.status === 'done' ? 'bg-emerald-500' : p.status === 'active' ? 'bg-amber-500 animate-pulse' : p.status === 'error' ? 'bg-red-500' : 'bg-text-disabled/40'
                )} />
                <span className="text-accent font-semibold w-6">{p.phase}</span>
                <span className="text-text-tertiary">{p.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AMF / Metadata placeholder */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtmp.metadata', '元数据 (onMetaData)')}
        </label>
        <div className="rounded-[6px] border border-border-default/60 bg-bg-secondary/30 p-2 text-[var(--fs-xs)] text-text-disabled text-center py-4">
          {connected
            ? t('videostream.rtmp.waitingMetadata', '等待元数据...')
            : t('videostream.rtmp.connectFirst', '连接后显示')}
        </div>
      </div>
    </div>
  );
}
