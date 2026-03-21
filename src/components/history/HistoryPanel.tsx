import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Trash2, Search, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getMethodColor, getStatusColor } from '@/types/http';

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

  if (history.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-disabled">
        <Clock className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">{t('sidebar.noHistory')}</p>
        <p className="text-xs mt-1">{t('sidebar.noHistoryHint')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search + Clear */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <div className="flex-1 flex items-center gap-1.5 bg-bg-elevated border border-border-subtle rounded-[var(--radius-sm)] px-2 py-1">
          <Search className="w-3.5 h-3.5 text-text-disabled shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-disabled focus:outline-none"
          />
        </div>
        <button
          onClick={() => { setHistory([]); /* invoke('clear_history') */ }}
          className="text-text-tertiary hover:text-error transition-colors p-1"
          title={t('history.clearHistory')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Grouped list */}
      <div className="flex-1 overflow-auto">
        {Object.entries(groups).map(([label, items]) => (
          <div key={label}>
            <div className="px-3 py-1.5 text-[10px] font-medium text-text-disabled uppercase tracking-wider bg-bg-primary/50 sticky top-0">
              {label}
            </div>
            <AnimatePresence>
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-b border-border-subtle last:border-0"
                >
                  <div
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 cursor-pointer',
                      'hover:bg-bg-hover transition-colors group',
                    )}
                  >
                    <span className={cn('text-[10px] font-bold w-10 shrink-0', getMethodColor(item.method as any))}>
                      {item.method}
                    </span>
                    <span className="flex-1 text-xs text-text-secondary truncate font-mono">
                      {item.url}
                    </span>
                    {item.status && (
                      <span className={cn('text-[10px] font-bold', getStatusColor(item.status))}>
                        {item.status}
                      </span>
                    )}
                    {item.durationMs && (
                      <span className="text-[10px] text-text-disabled">{item.durationMs}ms</span>
                    )}
                    <span className="text-[10px] text-text-disabled">{formatTime(item.timestamp)}</span>
                    <ChevronRight className={cn(
                      'w-3 h-3 text-text-disabled transition-transform',
                      expanded === item.id && 'rotate-90'
                    )} />
                  </div>

                  {expanded === item.id && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      className="px-3 pb-2"
                    >
                      <button
                        onClick={() => onRestoreRequest?.(item.requestConfig)}
                        className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('history.restore')}
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
