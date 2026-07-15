import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Trash2, Search, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { activateOnKey } from '@/lib/a11y';
import { useTranslation } from 'react-i18next';
import { getStatusColor } from '@/types/http';
import { useContextMenu, buildClipboardItems, useZoneFallback } from '@/components/ui/ContextMenu';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { ContextMenuEntry } from '@/components/ui/ContextMenu';

export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  bodySize: number | null;
  timestamp: string;
  requestConfig: unknown;
  responseSummary: string | null;
}

interface HistoryPanelProps {
  onRestoreRequest?: (config: unknown) => void;
}

export function HistoryPanel({ onRestoreRequest }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Demo data (will be replaced with IPC calls when running in Tauri)
  useEffect(() => {
    // In production: invoke('list_history', { limit: 100 }).then(setHistory)
  }, []);

  const filteredHistory = history.filter((h) =>
    !search || h.url.toLowerCase().includes(search.toLowerCase()) ||
    h.method.toLowerCase().includes(search.toLowerCase())
  );

  const groupByDate = (items: HistoryItem[]) => {
    const groups: Record<string, HistoryItem[]> = {};
    const now = new Date();
    for (const item of items) {
      const date = new Date(item.timestamp);
      const diff = Math.floor((now.getTime() - date.getTime()) / 86400000);
      let label: string;
      if (diff === 0) label = t('sidebar.today');
      else if (diff === 1) label = t('sidebar.yesterday');
      else if (diff < 7) label = t('history.lastWeek');
      else label = t('sidebar.earlier');
      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    }
    return groups;
  };

  const groups = groupByDate(filteredHistory);
  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  // ── Context menu ──
  const { showMenu, MenuComponent } = useContextMenu();
  const { handleZoneFallback, ZoneFallbackMenu } = useZoneFallback(t);
  const handleItemContextMenu = (e: React.MouseEvent, item: HistoryItem) => {
    const clipboardItems = buildClipboardItems(e, t);
    const items: ContextMenuEntry[] = [
      ...clipboardItems,
      { id: 'copy-url', label: t('contextMenu.copyUrl', '复制 URL'), onClick: () => copyTextToClipboard(item.url) },
      { id: 'copy-method-url', label: t('contextMenu.copyMethodUrl', '复制 Method + URL'), onClick: () => copyTextToClipboard(`${item.method} ${item.url}`) },
    ];
    if (onRestoreRequest) {
      items.push({ type: 'divider' });
      items.push({ id: 'restore', label: t('contextMenu.openInNewTab', '在新标签页打开'), onClick: () => onRestoreRequest(item.requestConfig) });
    }
    items.push({ type: 'divider' });
    items.push({ id: 'delete', label: t('contextMenu.delete', '删除'), danger: true, onClick: () => {
      setHistory((prev) => prev.filter((h) => h.id !== item.id));
      // In production: invoke('delete_history_entry', { id: item.id })
    }});
    showMenu(e, items);
  };

  if (history.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center pf-rounded-xl border border-border-subtle bg-bg-secondary/75 text-text-disabled">
          <Clock className="h-6 w-6 opacity-70" />
        </div>
        <p className="mt-4 pf-text-base font-semibold text-text-secondary">{t('sidebar.noHistory')}</p>
        <p className="mt-2 max-w-xs pf-text-xs leading-5 text-text-tertiary">{t('sidebar.noHistoryHint')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-contextmenu-zone="history" onContextMenu={handleZoneFallback}>
      {MenuComponent}
      {ZoneFallbackMenu}
      {/* Search + Clear */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <div className="flex-1 flex items-center gap-1.5 bg-bg-elevated border border-border-subtle pf-rounded-sm px-2 py-1 focus-within:border-accent/50 transition-colors">
          <Search className="w-3.5 h-3.5 text-text-disabled shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            className="flex-1 bg-transparent pf-text-xs text-text-primary placeholder:text-text-disabled focus:outline-none"
          />
        </div>
        <button
          onClick={() => { setHistory([]); /* invoke('clear_history') */ }}
          className="flex items-center justify-center w-7 h-7 pf-rounded-sm text-text-tertiary hover:text-error hover:bg-error/10 transition-colors"
          title={t('history.clearHistory')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Grouped list */}
      <div className="flex-1 overflow-auto px-1.5 py-1">
        {Object.entries(groups).map(([label, items]) => (
          <div key={label} className="mb-1">
            <div className="flex items-center gap-2 px-2 py-1.5 pf-text-xxs font-bold text-text-tertiary uppercase tracking-[0.06em] bg-bg-primary/60 backdrop-blur sticky top-0 z-10">
              <span>{label}</span>
              <span className="font-mono text-text-disabled tabular-nums">{items.length}</span>
            </div>
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const isOpen = expanded === item.id;
                return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    onKeyDown={activateOnKey(() => setExpanded(isOpen ? null : item.id))}
                    onContextMenu={(e) => handleItemContextMenu(e, item)}
                    className={cn(
                      'relative flex items-center gap-2 h-[30px] px-2 rounded-[5px] cursor-pointer group transition-colors',
                      isOpen ? 'bg-accent-soft' : 'hover:bg-bg-hover',
                      isOpen && 'before:content-[\'\'] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent',
                    )}
                  >
                    <span className={cn('pf-mtag w-9 shrink-0 uppercase', `m-${item.method.toLowerCase()}`)}>
                      {item.method}
                    </span>
                    <span className={cn(
                      'flex-1 pf-text-xs truncate font-mono',
                      isOpen ? 'text-text-primary' : 'text-text-secondary',
                    )}>
                      {item.url}
                    </span>
                    {item.status != null && (
                      <span className={cn('pf-text-3xs font-bold font-mono tabular-nums', getStatusColor(item.status))}>
                        {item.status}
                      </span>
                    )}
                    {item.durationMs != null && (
                      <span className="pf-text-3xs text-text-disabled font-mono tabular-nums">{item.durationMs}ms</span>
                    )}
                    <span className="pf-text-3xs text-text-disabled font-mono tabular-nums">{formatTime(item.timestamp)}</span>
                    <ChevronRight className={cn(
                      'w-3 h-3 text-text-disabled transition-transform shrink-0',
                      isOpen && 'rotate-90 text-accent'
                    )} />
                  </div>

                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="px-2 pb-1.5 pt-0.5"
                    >
                      <button
                        onClick={() => onRestoreRequest?.(item.requestConfig)}
                        className="flex items-center gap-1.5 h-6 px-2 pf-rounded-sm pf-text-xs font-medium text-accent hover:bg-accent-soft transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('history.restore')}
                      </button>
                    </motion.div>
                  )}
                </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
