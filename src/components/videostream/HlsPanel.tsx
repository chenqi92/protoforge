// HLS 协议配置面板
import { useState, useCallback, useEffect } from "react";
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

  useEffect(() => {
    if (!autoRefresh || !streamUrl.trim()) return;
    const timer = window.setInterval(() => {
      void parsePlaylist();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, parsePlaylist, streamUrl]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Parse button */}
      <div className="space-y-1.5">
        <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
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
              "h-7 px-2 pf-rounded-sm border pf-text-xxs font-medium transition-colors",
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
          <div className="pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 p-2 space-y-1 pf-text-xxs font-mono">
            <div className="flex justify-between"><span className="text-text-disabled">Type</span><span className="text-text-primary">{playlist.playlistType === 'master' ? 'Master Playlist' : 'Media Playlist'}</span></div>
            {playlist.version && <div className="flex justify-between"><span className="text-text-disabled">Version</span><span className="text-text-primary">{playlist.version}</span></div>}
            {playlist.targetDuration && <div className="flex justify-between"><span className="text-text-disabled">Target Duration</span><span className="text-text-primary">{playlist.targetDuration}s</span></div>}
            {playlist.mediaSequence !== undefined && <div className="flex justify-between"><span className="text-text-disabled">Media Sequence</span><span className="text-text-primary">{playlist.mediaSequence}</span></div>}
            <div className="flex justify-between"><span className="text-text-disabled">Live</span><span className="text-text-primary">{playlist.isLive ? 'Yes' : 'No'}</span></div>
            <div className="flex justify-between"><span className="text-text-disabled">Total</span><span className="text-text-primary">{playlist.totalDuration.toFixed(1)}s</span></div>
          </div>

          {/* Variants (Master Playlist) */}
          {playlist.variants && playlist.variants.length > 0 && (
            <div className="space-y-1.5">
              <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('videostream.hls.variants', '码率档位')} ({playlist.variants.length})
              </label>
              <div className="space-y-0.5">
                {playlist.variants.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedVariant(expandedVariant === i ? null : i)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 pf-rounded-xs bg-bg-secondary/30 hover:bg-bg-hover/50 text-left transition-colors"
                  >
                    <ChevronRight className={cn("w-3 h-3 text-text-disabled transition-transform", expandedVariant === i && "rotate-90")} />
                    <span className="pf-text-xxs font-mono text-accent font-medium">{Math.round(v.bandwidth / 1000)}kbps</span>
                    {v.resolution && <span className="pf-text-xxs text-text-tertiary">{v.resolution}</span>}
                    {v.codecs && <span className="pf-text-3xs text-text-disabled truncate">{v.codecs}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Segments (Media Playlist) */}
          {playlist.segments && playlist.segments.length > 0 && (
            <div className="space-y-1.5">
              <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('videostream.hls.segments', '分片列表')} ({playlist.segments.length})
              </label>
              <div className="max-h-[160px] overflow-y-auto space-y-0.5 pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 p-1">
                {playlist.segments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 pf-text-xxs font-mono">
                    <span className="text-text-disabled w-6 shrink-0">#{seg.sequence}</span>
                    <span className="text-emerald-500 dark:text-emerald-300 w-12 shrink-0">{seg.duration.toFixed(1)}s</span>
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
