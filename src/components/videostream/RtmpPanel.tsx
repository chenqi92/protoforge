// RTMP 协议配置面板
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import * as vsSvc from "@/services/videoStreamService";
import type { RtmpConfig, RtmpMetadata, RtmpMetadataValue } from "@/types/videostream";

function formatMetadataValue(value: RtmpMetadataValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

interface RtmpPanelProps {
  sessionKey: string;
  expectedGeneration: number | null;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
  config: RtmpConfig;
  onConfigChange: (config: RtmpConfig) => void;
}

export function RtmpPanel({ sessionKey, expectedGeneration, connected, streamUrl: _streamUrl, onStreamUrlChange: _onStreamUrlChange, config, onConfigChange }: RtmpPanelProps) {
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
  const [metadata, setMetadata] = useState<RtmpMetadata | null>(null);
  const [metadataChecked, setMetadataChecked] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void vsSvc.onStreamEvent((event) => {
      if (
        event.sessionId !== sessionKey
        || event.generation !== expectedGeneration
        || event.eventType !== "protocol-data"
        || !event.data
      ) return;
      try {
        const payload = JSON.parse(event.data) as { kind?: string; metadata?: unknown };
        if (
          payload.kind === "rtmp-metadata"
          && payload.metadata
          && typeof payload.metadata === "object"
          && !Array.isArray(payload.metadata)
        ) {
          setMetadata(payload.metadata as RtmpMetadata);
          setMetadataChecked(true);
          setPlayError(null);
        }
      } catch {
        // Ignore protocol-data events owned by other protocol inspectors.
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [expectedGeneration, sessionKey]);

  useEffect(() => {
    setMetadata(null);
    setMetadataChecked(false);
    setMetadataLoading(false);
    setPlayError(null);
    setAppConnected(false);
    setHandshakePhases(prev => prev.map(p => ({ ...p, status: 'pending' })));
  }, [connected, expectedGeneration, sessionKey]);

  const handleHandshake = useCallback(async () => {
    if (expectedGeneration === null) return;
    setHandshaking(true);
    setShowHandshake(true);
    setAppConnected(false);
    setMetadata(null);
    setMetadataChecked(false);
    setPlayError(null);
    try {
      // Mark all phases as active during handshake
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: 'active' })));
      await vsSvc.rtmpHandshake(sessionKey, expectedGeneration);
      // All phases done
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: 'done' })));
    } catch {
      setHandshakePhases(prev => prev.map(p => ({ ...p, status: p.status === 'active' ? 'error' : p.status })));
    }
    setHandshaking(false);
  }, [expectedGeneration, sessionKey]);

  const handleConnect = useCallback(async () => {
    if (expectedGeneration === null) return;
    try {
      await vsSvc.rtmpConnectApp(sessionKey, expectedGeneration);
      setAppConnected(true);
    } catch { /* */ }
  }, [expectedGeneration, sessionKey]);

  const handlePlay = useCallback(async () => {
    if (expectedGeneration === null) return;
    const fallbackStreamKey = _streamUrl.split('/').filter(Boolean).pop() ?? "";
    const effectiveStreamKey = config.streamKey || fallbackStreamKey;
    setMetadata(null);
    setMetadataChecked(false);
    setMetadataLoading(true);
    setPlayError(null);
    try {
      await vsSvc.rtmpPlay(sessionKey, expectedGeneration, effectiveStreamKey);
      setMetadataChecked(true);
    } catch (error) {
      setPlayError(errorMessage(error));
    } finally {
      setMetadataLoading(false);
    }
  }, [_streamUrl, config.streamKey, expectedGeneration, sessionKey]);

  const metadataEntries = Object.entries(metadata ?? {}).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Mode: Pull vs Push */}
      <div className="space-y-1.5">
        <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.rtmp.actions', '协议操作')}
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleHandshake}
              disabled={expectedGeneration === null || handshaking}
              className="btn-ghost-action flex-1"
            >
              {handshaking ? t('videostream.rtmp.handshaking', '握手中...') : t('videostream.rtmp.handshakeBtn', '握手')}
            </button>
            <button
              onClick={handleConnect}
              disabled={!handshakePhases.some(p => p.status === 'done') || appConnected}
              className="btn-ghost-action flex-1"
            >
              {appConnected ? t('videostream.connected', '已连接') : 'Connect'}
            </button>
            <button
              onClick={handlePlay}
              disabled={!appConnected || metadataLoading}
              className="btn-ghost-action flex-1"
            >
              {metadataLoading ? 'Play…' : 'Play'}
            </button>
          </div>
        </div>
      )}

      {/* Handshake Analysis */}
      <div className="space-y-1.5">
        <button
          onClick={() => setShowHandshake(v => !v)}
          className="flex items-center gap-1.5 pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled hover:text-text-secondary transition-colors"
        >
          <svg className={cn("w-3 h-3 transition-transform", showHandshake && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {t('videostream.rtmp.handshake', '握手分析')}
        </button>
        {showHandshake && (
          <div className="space-y-0.5 pl-1">
            {handshakePhases.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 pf-rounded-xs pf-text-xxs font-mono hover:bg-bg-hover transition-colors">
                <span className={cn(
                  "pf-dot shrink-0",
                  p.status === 'done' ? 's-ok' : p.status === 'active' ? 's-conn' : p.status === 'error' ? 's-err' : 's-idle'
                )} />
                <span className="text-accent font-semibold w-6">{p.phase}</span>
                <span className="text-text-tertiary">{p.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AMF / Metadata */}
      <div className="space-y-1.5">
        <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtmp.metadata', '元数据 (onMetaData)')}
        </label>
        {metadata !== null ? (
          <div className="max-h-[240px] overflow-y-auto pf-rounded-sm border border-border-default bg-bg-secondary p-2 pf-text-xxs font-mono">
            {metadataEntries.length > 0
              ? metadataEntries.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 border-b border-border-subtle px-1 py-1.5 last:border-b-0">
                    <span className="min-w-0 truncate text-text-disabled" title={key}>{key}</span>
                    <span className="min-w-0 break-all text-right text-text-primary" title={formatMetadataValue(value)}>
                      {formatMetadataValue(value)}
                    </span>
                  </div>
                ))
              : <div className="py-2 text-center text-text-disabled">{'{}'}</div>}
          </div>
        ) : (
          <div className="pf-rounded-sm border border-border-default bg-bg-secondary p-2 pf-text-xs text-text-disabled text-center py-4">
            {!connected
              ? t('videostream.rtmp.connectFirst', '连接后显示')
              : playError
                ? <span className="whitespace-pre-wrap break-words text-error">
                    {t('videostream.rtmp.playFailed', 'Play failed')}: {playError}
                  </span>
                : metadataChecked
                  ? t('videostream.rtmp.metadataUnavailable', 'No onMetaData received')
                  : t('videostream.rtmp.waitingMetadata', '等待元数据...')}
          </div>
        )}
      </div>
    </div>
  );
}
