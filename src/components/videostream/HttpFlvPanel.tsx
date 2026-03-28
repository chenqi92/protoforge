// HTTP-FLV 协议配置面板
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { FlvTag } from "@/types/videostream";

interface HttpFlvPanelProps {
  sessionKey: string;
  connected: boolean;
}

export function HttpFlvPanel({ sessionKey, connected }: HttpFlvPanelProps) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<FlvTag[]>([]);
  const [filter, setFilter] = useState<'all' | 'audio' | 'video' | 'script'>('all');
  const [selectedTag, setSelectedTag] = useState<FlvTag | null>(null);

  const filtered = filter === 'all' ? tags : tags.filter(tag => tag.type === filter);

  // Suppress unused variable warnings for props/state used only for future integration
  void sessionKey;
  void setTags;
  void selectedTag;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* FLV Header */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          FLV Header
        </label>
        <div className="rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-2 text-[var(--fs-xxs)] font-mono space-y-0.5">
          {connected ? (
            <>
              <div className="flex justify-between"><span className="text-text-disabled">Signature</span><span className="text-text-primary">FLV</span></div>
              <div className="flex justify-between"><span className="text-text-disabled">Version</span><span className="text-text-primary">1</span></div>
              <div className="flex justify-between"><span className="text-text-disabled">Flags</span><span className="text-text-primary">Audio + Video</span></div>
              <div className="flex justify-between"><span className="text-text-disabled">Header Size</span><span className="text-text-primary">9 bytes</span></div>
            </>
          ) : (
            <div className="text-text-disabled text-center py-2">{t('videostream.flv.connectFirst', '连接后解析')}</div>
          )}
        </div>
      </div>

      {/* Tag Filter */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.flv.tagFilter', 'Tag 过滤')}
        </label>
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('videostream.flv.all', '全部') },
            { value: 'video', label: 'VIDEO' },
            { value: 'audio', label: 'AUDIO' },
            { value: 'script', label: 'SCRIPT' },
          ]}
          size="sm"
        />
      </div>

      {/* Tag List */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
            FLV Tags
          </label>
          <span className="text-[var(--fs-3xs)] text-text-disabled">{filtered.length} tags</span>
        </div>
        <div className="max-h-[200px] overflow-y-auto rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30">
          {filtered.length === 0 ? (
            <div className="text-[var(--fs-xs)] text-text-disabled text-center py-6">
              {connected ? t('videostream.flv.waitingTags', '等待 FLV Tag...') : t('videostream.flv.connectFirst', '连接后解析')}
            </div>
          ) : (
            <div className="divide-y divide-border-default/20">
              {filtered.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setSelectedTag(tag)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-bg-hover/50 transition-colors text-[var(--fs-xxs)] font-mono",
                    selectedTag?.id === tag.id && "bg-accent/5"
                  )}
                >
                  <span className={cn(
                    "w-12 shrink-0 font-semibold",
                    tag.type === 'video' ? 'text-blue-500' : tag.type === 'audio' ? 'text-emerald-500' : 'text-amber-500'
                  )}>
                    {tag.type}
                  </span>
                  <span className="text-text-tertiary w-16 shrink-0">{tag.size}B</span>
                  <span className="text-text-disabled">{tag.timestamp}ms</span>
                  {tag.keyframe && <span className="text-amber-500 text-[var(--fs-3xs)]">KEY</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
