// ProtoForge Command Palette (Ctrl+K)
// 全局搜索：集合/请求/环境/历史

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, FileText, Globe, X, Network, Gauge, Radio, Puzzle, Settings, Braces, Waves, Palette, Server, Cookie, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';

interface SearchItem {
  type: 'collection' | 'request' | 'environment' | 'history' | 'action';
  label: string;
  description?: string;
  icon: typeof Search;
  action: () => void;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const addTab = useAppStore((s) => s.addTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const { t } = useTranslation();

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // 构建搜索项
  const items = useMemo<SearchItem[]>(() => {
    const results: SearchItem[] = [];

    // Quick actions
    results.push(
      { type: 'action', label: t('commandPalette.newHttpRequest'), description: 'Ctrl+N', icon: FileText, action: () => { addTab('http'); onClose(); } },
      {
        type: 'action',
        label: t('commandPalette.newGraphqlRequest'),
        icon: Braces,
        action: () => {
          const tabId = addTab('http');
          updateHttpConfig(tabId, { requestMode: 'graphql', name: 'GraphQL Request', method: 'POST' });
          onClose();
        }
      },
      { type: 'action', label: t('commandPalette.newWsConnection'), icon: Globe, action: () => { addTab('ws'); onClose(); } },
      {
        type: 'action',
        label: t('commandPalette.newSseConnection'),
        icon: Waves,
        action: () => {
          const tabId = addTab('http');
          updateHttpConfig(tabId, { requestMode: 'sse', name: 'SSE Stream', method: 'GET' });
          onClose();
        }
      },
      { type: 'action', label: t('commandPalette.newMqttConnection'), icon: Globe, action: () => { addTab('mqtt'); onClose(); } },
      { type: 'action', label: t('commandPalette.openTcpUdp'), icon: Network, action: () => { openToolTab('tcpudp'); onClose(); } },
      { type: 'action', label: t('commandPalette.openCapture'), icon: Radio, action: () => { openToolTab('capture'); onClose(); } },
      { type: 'action', label: t('commandPalette.openLoadtest'), icon: Gauge, action: () => { openToolTab('loadtest'); onClose(); } },
      { type: 'action', label: t('commandPalette.openMockServer'), icon: Server, action: () => { openToolTab('mockserver'); onClose(); } },
      { type: 'action', label: t('commandPalette.openWorkflow'), icon: Workflow, action: () => { openToolTab('workflow'); onClose(); } },
      { type: 'action', label: t('commandPalette.openPlugins'), icon: Puzzle, action: () => { window.dispatchEvent(new CustomEvent('open-plugin-modal')); onClose(); } },
      { type: 'action', label: t('commandPalette.openSettings'), icon: Settings, action: () => { window.dispatchEvent(new CustomEvent('open-settings-modal')); onClose(); } },
      { type: 'action', label: t('commandPalette.openCookieManager'), icon: Cookie, action: () => { window.dispatchEvent(new CustomEvent('open-cookie-manager')); onClose(); } },
      { type: 'action', label: 'Design System', description: 'Dev', icon: Palette, action: () => { window.dispatchEvent(new CustomEvent('open-design-system')); onClose(); } },
    );

    // Filter by query
    if (!query.trim()) return results;
    const q = query.toLowerCase();
    return results.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q))
    );
  }, [query, addTab, onClose, openToolTab, t, updateHttpConfig]);

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => (i + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && items[selectedIdx]) {
      e.preventDefault();
      items[selectedIdx].action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [items, selectedIdx, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[var(--z-tooltip)]" onClick={onClose} />
      <div className="fixed left-1/2 top-[15%] z-[var(--z-tooltip)] flex max-h-[460px] w-[620px] max-w-[92vw] -translate-x-1/2 flex-col overflow-hidden pf-rounded-xl border border-white/60 bg-bg-primary shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-border-default/80 bg-bg-primary/78 px-5 py-3">
          <Search className="w-4 h-4 text-text-disabled shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder')}
            className="h-10 flex-1 bg-transparent pf-text-md text-text-primary outline-none placeholder:text-text-disabled"
          />
          <button onClick={onClose} className="pf-rounded-md p-1.5 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto bg-bg-secondary/18 py-2.5">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-disabled pf-text-base">
              {t('commandPalette.noResults')}
            </div>
          ) : (
            items.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={i}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={cn(
                    "mx-2 flex w-[calc(100%-1rem)] items-center gap-3 pf-rounded-lg px-4 py-3 text-left transition-colors",
                    i === selectedIdx ? "bg-bg-primary/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]" : "hover:bg-bg-hover/70"
                  )}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", i === selectedIdx ? "text-accent" : "text-text-disabled")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("pf-text-base font-medium truncate", i === selectedIdx ? "text-accent" : "text-text-primary")}>
                      {item.label}
                    </p>
                    {item.description && <p className="pf-text-xs text-text-disabled truncate">{item.description}</p>}
                  </div>
                  <span className={cn("pf-text-xxs uppercase tracking-wider shrink-0",
                    item.type === 'action' ? "text-accent/60" :
                    item.type === 'collection' ? "text-blue-500/60" :
                    item.type === 'environment' ? "text-emerald-500/60" :
                    "text-text-disabled"
                  )}>
                    {item.type === 'action' ? t('commandPalette.typeAction') : item.type === 'collection' ? t('commandPalette.typeCollection') : item.type === 'environment' ? t('commandPalette.typeEnvironment') : item.type === 'history' ? t('commandPalette.typeHistory') : t('commandPalette.typeRequest')}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t border-border-default/80 bg-bg-primary/78 px-4 py-2.5 pf-text-xxs text-text-disabled">
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">↑↓</kbd> {t('commandPalette.select')}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">Enter</kbd> {t('commandPalette.confirm')}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">Esc</kbd> {t('commandPalette.closeLabel')}</span>
        </div>
      </div>
    </>
  );
}
