// HLS 协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ChevronRight, RefreshCw, ListVideo } from "lucide-react";
import type { HlsPlaylistInfo } from "@/types/videostream";
import * as vsSvc from "@/services/videoStreamService";

interface HlsPanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
}

export function HlsPanel({ sessionKey, connected, streamUrl }: HlsPanelProps) {
  const { t } = useTranslation();
  const [playlist, setPlaylist] = useState<HlsPlaylistInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedVariant, setExpandedVariant] = useState<number | null>(null);

  const parsePlaylist = useCallback(async () => {
    if (!streamUrl.trim()) return;
    setLoading(true);
    try {
      const result = await vsSvc.hlsParsePlaylist(sessionKey, streamUrl);
      setPlaylist(result as unknown as HlsPlaylistInfo);
    } catch {
      // Parse error — silently ignore
    }
    setLoading(false);
  }, [sessionKey, streamUrl]);

  // Suppress unused variable warnings for props/state used only for future integration
  void connected;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Parse button */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.hls.playlist', '播放列表')}
        </label>
        <div className="flex gap-1.5">
          <button
            onClick={parsePlaylist}
            disabled={!streamUrl.trim() || loading}
            className="wb-primary-btn flex-1 px-3 bg-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ListVideo className="w-3.5 h-3.5" />}
            {t('videostream.hls.parse', '解析 m3u8')}
          </button>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={cn(
              "h-7 px-2 rounded-[var(--radius-sm)] border text-[var(--fs-xxs)] font-medium transition-colors",
              autoRefresh
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-default/60 text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t('videostream.hls.autoRefresh', '自动刷新')}
          </button>
        </div>
      </div>

      {/* Playlist Info */}
      {playlist && (
        <div className="space-y-3">
          <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-2 space-y-1 text-[var(--fs-xxs)] font-mono">
            <div className="flex justify-between"><span className="text-text-disabled">Type</span><span className="text-text-primary">{playlist.type === 'master' ? 'Master Playlist' : 'Media Playlist'}</span></div>
            {playlist.version && <div className="flex justify-between"><span className="text-text-disabled">Version</span><span className="text-text-primary">{playlist.version}</span></div>}
            {playlist.targetDuration && <div className="flex justify-between"><span className="text-text-disabled">Target Duration</span><span className="text-text-primary">{playlist.targetDuration}s</span></div>}
            {playlist.mediaSequence !== undefined && <div className="flex justify-between"><span className="text-text-disabled">Media Sequence</span><span className="text-text-primary">{playlist.mediaSequence}</span></div>}
          </div>

          {/* Variants (Master Playlist) */}
          {playlist.variants && playlist.variants.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('videostream.hls.variants', '码率档位')} ({playlist.variants.length})
              </label>
              <div className="space-y-0.5">
                {playlist.variants.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedVariant(expandedVariant === i ? null : i)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-xs)] bg-bg-secondary/30 hover:bg-bg-hover/50 text-left transition-colors"
                  >
                    <ChevronRight className={cn("w-3 h-3 text-text-disabled transition-transform", expandedVariant === i && "rotate-90")} />
                    <span className="text-[var(--fs-xxs)] font-mono text-accent font-medium">{Math.round(v.bandwidth / 1000)}kbps</span>
                    {v.resolution && <span className="text-[var(--fs-xxs)] text-text-tertiary">{v.resolution}</span>}
                    {v.codecs && <span className="text-[var(--fs-3xs)] text-text-disabled truncate">{v.codecs}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Segments (Media Playlist) */}
          {playlist.segments && playlist.segments.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('videostream.hls.segments', '分片列表')} ({playlist.segments.length})
              </label>
              <div className="max-h-[160px] overflow-y-auto space-y-0.5 rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-1">
                {playlist.segments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 text-[var(--fs-xxs)] font-mono">
                    <span className="text-text-disabled w-6 shrink-0">#{seg.sequence}</span>
                    <span className="text-emerald-500 w-12 shrink-0">{seg.duration.toFixed(1)}s</span>
                    <span className="text-text-tertiary truncate flex-1">{seg.uri}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
