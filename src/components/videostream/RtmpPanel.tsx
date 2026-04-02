// RTMP 协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import * as vsSvc from "@/services/videoStreamService";
import type { RtmpConfig } from "@/types/videostream";

interface RtmpPanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
  config: RtmpConfig;
  onConfigChange: (config: RtmpConfig) => void;
}

export function RtmpPanel({ sessionKey, connected, streamUrl: _streamUrl, onStreamUrlChange: _onStreamUrlChange, config, onConfigChange }: RtmpPanelProps) {
  const { t } = useTranslation();
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
    const fallbackStreamKey = _streamUrl.split('/').filter(Boolean).pop() ?? "";
    const effectiveStreamKey = config.streamKey || fallbackStreamKey;
    try {
      await vsSvc.rtmpPlay(sessionKey, effectiveStreamKey);
    } catch { /* */ }
  }, [_streamUrl, config.streamKey, sessionKey]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Mode: Pull vs Push */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtmp.mode', '模式')}
        </label>
        <SegmentedControl
          value={config.mode}
          onChange={(mode) => onConfigChange({ ...config, mode: mode as RtmpConfig["mode"] })}
          options={[
            { value: 'pull', label: t('videostream.rtmp.pull', '拉流') },
            { value: 'push', label: t('videostream.rtmp.push', '推流') },
          ]}
          disabled={connected}
        />
      </div>

      {/* Stream Key (Push mode) */}
      {config.mode === 'push' && (
        <div className="space-y-1.5">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.rtmp.streamKey', '推流密钥')}
          </label>
          <input
            value={config.streamKey}
            onChange={(e) => onConfigChange({ ...config, streamKey: e.target.value })}
            placeholder="live_xxx"
            disabled={connected}
            className="wb-field-sm w-full font-mono disabled:opacity-50"
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
              className="btn-ghost-action flex-1"
            >
              {handshaking ? '握手中...' : '握手'}
            </button>
            <button
              onClick={handleConnect}
              disabled={!handshakePhases.some(p => p.status === 'done') || appConnected}
              className="btn-ghost-action flex-1"
            >
              {appConnected ? '已连接' : 'Connect'}
            </button>
            <button
              onClick={handlePlay}
              disabled={!appConnected}
              className="btn-ghost-action flex-1"
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
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-[var(--radius-xs)] text-[var(--fs-xxs)] font-mono">
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
        <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-2 text-[var(--fs-xs)] text-text-disabled text-center py-4">
          {connected
            ? t('videostream.rtmp.waitingMetadata', '等待元数据...')
            : t('videostream.rtmp.connectFirst', '连接后显示')}
        </div>
      </div>
    </div>
  );
}
