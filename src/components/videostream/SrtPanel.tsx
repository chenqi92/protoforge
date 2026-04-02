// SRT 协议配置面板
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Lock } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";
import type { SrtConfig } from "@/types/videostream";

interface SrtPanelProps {
  sessionKey: string;
  connected: boolean;
  config: SrtConfig;
  onConfigChange: (config: SrtConfig) => void;
}

const EMPTY_SRT_STATS = {
  rtt: 0,
  bandwidth: 0,
  retransmitRate: 0,
  dropRate: 0,
  sendRate: 0,
  recvRate: 0,
};

export function SrtPanel({ sessionKey, connected, config, onConfigChange }: SrtPanelProps) {
  const { t } = useTranslation();
  const [showEncryption, setShowEncryption] = useState(false);
  const [probeConnecting, setProbeConnecting] = useState(false);
  const [probeConnected, setProbeConnected] = useState(false);
  const [srtStats, setSrtStats] = useState(EMPTY_SRT_STATS);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await vsSvc.srtStats(sessionKey) as Partial<typeof EMPTY_SRT_STATS>;
      setSrtStats({
        rtt: Number(stats.rtt ?? 0),
        bandwidth: Number(stats.bandwidth ?? 0),
        retransmitRate: Number(stats.retransmitRate ?? 0),
        dropRate: Number(stats.dropRate ?? 0),
        sendRate: Number(stats.sendRate ?? 0),
        recvRate: Number(stats.recvRate ?? 0),
      });
      setProbeConnected(true);
    } catch {
      setProbeConnected(false);
      setSrtStats(EMPTY_SRT_STATS);
    }
  }, [sessionKey]);

  useEffect(() => {
    if (!probeConnected) return;

    void refreshStats();
    const timer = window.setInterval(() => {
      void refreshStats();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [probeConnected, refreshStats]);

  const handleProbeStart = useCallback(async () => {
    setProbeConnecting(true);
    try {
      await vsSvc.srtConnect(sessionKey, {
        host: config.host,
        port: config.port,
        mode: config.mode,
        passphrase: config.passphrase,
        latency: config.latency,
        streamId: config.streamId,
      });
      setProbeConnected(true);
      await refreshStats();
    } catch {
      // Connection errors are surfaced by the shared workspace.
    }
    setProbeConnecting(false);
  }, [config.host, config.latency, config.mode, config.passphrase, config.port, config.streamId, refreshStats, sessionKey]);

  const handleProbeStop = useCallback(async () => {
    try {
      await vsSvc.srtDisconnect(sessionKey);
      setProbeConnected(false);
      setSrtStats(EMPTY_SRT_STATS);
    } catch {
      // Ignore disconnect cleanup errors.
    }
  }, [sessionKey]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 px-3 py-2 text-[var(--fs-xxs)] text-text-secondary leading-relaxed">
        顶部播放按钮负责实际视频播放，这里用于 SRT 握手探测和会话统计。
        {connected && <span className="ml-1 text-accent">当前播放器链路已启动。</span>}
      </div>

      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.srt.target', '目标地址')}
        </label>
        <div className="grid grid-cols-[1fr_80px] gap-1.5">
          <input
            value={config.host}
            onChange={(e) => onConfigChange({ ...config, host: e.target.value })}
            placeholder="127.0.0.1"
            disabled={probeConnected}
            className="wb-field-sm font-mono disabled:opacity-50"
          />
          <input
            type="number"
            value={config.port}
            onChange={(e) => onConfigChange({ ...config, port: Number(e.target.value) })}
            placeholder="9000"
            disabled={probeConnected}
            className="wb-field-sm font-mono disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.srt.mode', '连接模式')}
        </label>
        <SegmentedControl
          value={config.mode}
          onChange={(mode) => onConfigChange({ ...config, mode: mode as SrtConfig["mode"] })}
          options={[
            { value: 'caller', label: 'Caller' },
            { value: 'listener', label: 'Listener' },
            { value: 'rendezvous', label: 'Rendezvous' },
          ]}
          disabled={probeConnected}
        />
        <p className="text-[var(--fs-3xs)] text-text-disabled">
          {config.mode === 'caller' ? t('videostream.srt.callerDesc', 'Caller 主动连接到远端 Listener')
            : config.mode === 'listener' ? t('videostream.srt.listenerDesc', 'Listener 监听端口等待连接')
            : t('videostream.srt.rendezvousDesc', 'Rendezvous 双向同时建立连接')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          Stream ID
        </label>
        <input
          value={config.streamId}
          onChange={(e) => onConfigChange({ ...config, streamId: e.target.value })}
          placeholder="#!::r=live/stream1"
          disabled={probeConnected}
          className="wb-field-sm w-full font-mono disabled:opacity-50"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.srt.latency', '延迟')} (ms)
          </label>
          <span className="text-[var(--fs-xxs)] font-mono text-accent">{config.latency}ms</span>
        </div>
        <input
          type="range"
          min={20}
          max={8000}
          step={10}
          value={config.latency}
          onChange={(e) => onConfigChange({ ...config, latency: Number(e.target.value) })}
          disabled={probeConnected}
          className="w-full h-1.5 accent-accent rounded-full appearance-none bg-bg-secondary/60"
        />
        <div className="flex justify-between text-[var(--fs-3xs)] text-text-disabled">
          <span>20ms</span><span>低延迟</span><span>8000ms</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <button
          onClick={() => setShowEncryption(v => !v)}
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
            <input
              value={config.passphrase}
              onChange={(e) => onConfigChange({ ...config, passphrase: e.target.value })}
              placeholder={t('videostream.srt.passphrase', '加密口令 (可选)')}
              disabled={probeConnected}
              className="wb-field-sm w-full font-mono disabled:opacity-50"
            />
            <p className="text-[var(--fs-3xs)] text-text-disabled">
              {t('videostream.srt.encryptionHint', 'AES-128/192/256 加密，口令长度 10-79 字符')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {!probeConnected ? (
          <button onClick={handleProbeStart} disabled={probeConnecting} className="btn-ghost-action w-full">
            {probeConnecting ? 'SRT 探测中...' : 'SRT 握手探测'}
          </button>
        ) : (
          <button onClick={handleProbeStop} className="btn-action btn-danger btn-action-sm w-full">
            清理探测会话
          </button>
        )}
      </div>

      {probeConnected && (
        <div className="space-y-1.5">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.srt.stats', '连接统计')}
          </label>
          <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-2 grid grid-cols-2 gap-y-1.5 gap-x-3 text-[var(--fs-xxs)] font-mono">
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
