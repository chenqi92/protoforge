// ProtoForge Command Palette (Ctrl+K)
// Forge grouped sections: 导航 Go to (rail domains) / 命令 Commands / 请求 Requests

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search, FileText, Globe, X, Network, Gauge, Radio, Puzzle, Settings, Braces, Waves, Palette, Server, Cookie, Workflow,
  Database, Video, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  useAppStore,
  openForgeDomain,
  FORGE_DOMAINS,
  FORGE_GROUPS,
  type ForgeDomain,
} from '@/stores/appStore';
import { useCollectionStore } from '@/stores/collectionStore';
import type { CollectionItem } from '@/types/collections';

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  radio: Radio,
  server: Server,
  zap: Zap,
  database: Database,
  video: Video,
  gauge: Gauge,
  waves: Waves,
  wrench: Wrench,
  puzzle: Puzzle,
};

interface PaletteItem {
  id: string;
  /** Forge section label, e.g. "导航 Go to". */
  section: string;
  label: string;
  hint?: string;
  /** lucide icon, when not a request method tag. */
  icon?: LucideIcon;
  /** http method → renders a .pf-mtag badge instead of an icon. */
  method?: string;
  action: () => void;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const addTab = useAppStore((s) => s.addTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.startsWith('zh') ?? true;
  const dl = (d: ForgeDomain) => (zh ? d.zh : d.en);

  const collections = useCollectionStore((s) => s.collections);
  const collectionItems = useCollectionStore((s) => s.items);
  const fetchItems = useCollectionStore((s) => s.fetchItems);

  // 打开时重置状态并确保集合项已加载（用于「请求」分组）
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      collections.forEach((c) => {
        if (!collectionItems[c.id]) void fetchItems(c.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const sectionGo = zh ? t('commandPalette.sectionGo', '导航 Go to') : 'Go to';
  const sectionCmd = zh ? t('commandPalette.sectionCmd', '命令 Commands') : 'Commands';
  const sectionReq = zh ? t('commandPalette.sectionReq', '请求 Requests') : 'Requests';

  // Open a saved collection request into a new HTTP tab.
  const openRequestItem = useCallback((item: CollectionItem) => {
    const tabId = addTab('http');
    let headers: { key: string; value: string; enabled: boolean }[] = [];
    try { if (item.headers) { const p = JSON.parse(item.headers); if (Array.isArray(p)) headers = p; } } catch { /* ignore */ }
    updateHttpConfig(tabId, {
      method: (item.method || 'GET') as never,
      url: item.url || '',
      name: item.name,
      ...(headers.length ? { headers } : {}),
    });
    useAppStore.getState().renameTab(tabId, item.name || `${item.method} ${item.url}`);
    onClose();
  }, [addTab, updateHttpConfig, onClose]);

  // 构建分组命令项
  const items = useMemo<PaletteItem[]>(() => {
    const results: PaletteItem[] = [];

    // ── 导航 Go to — rail domains, ordered by group ──
    for (const group of FORGE_GROUPS) {
      for (const d of FORGE_DOMAINS.filter((x) => x.group === group.id)) {
        results.push({
          id: `go-${d.id}`,
          section: sectionGo,
          label: dl(d),
          hint: zh ? d.subZh : d.subEn,
          icon: DOMAIN_ICONS[d.icon] ?? Globe,
          action: () => { openForgeDomain(d.id, { onOpenPluginModal: () => window.dispatchEvent(new CustomEvent('open-plugin-modal')) }); onClose(); },
        });
      }
    }

    // ── 命令 Commands — quick actions ──
    results.push(
      { id: 'cmd-http', section: sectionCmd, label: t('commandPalette.newHttpRequest'), hint: 'Ctrl+N', icon: FileText, action: () => { addTab('http'); onClose(); } },
      { id: 'cmd-gql', section: sectionCmd, label: t('commandPalette.newGraphqlRequest'), icon: Braces, action: () => { const id = addTab('http'); updateHttpConfig(id, { requestMode: 'graphql', name: 'GraphQL Request', method: 'POST' }); onClose(); } },
      { id: 'cmd-ws', section: sectionCmd, label: t('commandPalette.newWsConnection'), icon: Globe, action: () => { addTab('ws'); onClose(); } },
      { id: 'cmd-sse', section: sectionCmd, label: t('commandPalette.newSseConnection'), icon: Waves, action: () => { const id = addTab('http'); updateHttpConfig(id, { requestMode: 'sse', name: 'SSE Stream', method: 'GET' }); onClose(); } },
      { id: 'cmd-mqtt', section: sectionCmd, label: t('commandPalette.newMqttConnection'), icon: Globe, action: () => { addTab('mqtt'); onClose(); } },
      { id: 'cmd-tcp', section: sectionCmd, label: t('commandPalette.openTcpUdp'), icon: Network, action: () => { useAppStore.getState().openToolTab('tcpudp'); onClose(); } },
      { id: 'cmd-cap', section: sectionCmd, label: t('commandPalette.openCapture'), icon: Radio, action: () => { useAppStore.getState().openToolTab('capture'); onClose(); } },
      { id: 'cmd-load', section: sectionCmd, label: t('commandPalette.openLoadtest'), icon: Gauge, action: () => { useAppStore.getState().openToolTab('loadtest'); onClose(); } },
      { id: 'cmd-mock', section: sectionCmd, label: t('commandPalette.openMockServer'), icon: Server, action: () => { useAppStore.getState().openToolTab('mockserver'); onClose(); } },
      { id: 'cmd-flow', section: sectionCmd, label: t('commandPalette.openWorkflow'), icon: Workflow, action: () => { useAppStore.getState().openToolTab('workflow'); onClose(); } },
      { id: 'cmd-plugins', section: sectionCmd, label: t('commandPalette.openPlugins'), icon: Puzzle, action: () => { window.dispatchEvent(new CustomEvent('open-plugin-modal')); onClose(); } },
      { id: 'cmd-settings', section: sectionCmd, label: t('commandPalette.openSettings'), hint: '⌘,', icon: Settings, action: () => { window.dispatchEvent(new CustomEvent('open-settings-modal')); onClose(); } },
      { id: 'cmd-cookie', section: sectionCmd, label: t('commandPalette.openCookieManager'), icon: Cookie, action: () => { window.dispatchEvent(new CustomEvent('open-cookie-manager')); onClose(); } },
      { id: 'cmd-design', section: sectionCmd, label: 'Design System', hint: 'Dev', icon: Palette, action: () => { window.dispatchEvent(new CustomEvent('open-design-system')); onClose(); } },
    );

    // ── 请求 Requests — saved collection requests (already-loaded items) ──
    for (const col of collections) {
      const list = collectionItems[col.id] || [];
      for (const item of list) {
        if (item.itemType !== 'request') continue;
        results.push({
          id: `req-${item.id}`,
          section: sectionReq,
          label: item.name,
          hint: item.url || col.name,
          method: item.method || 'GET',
          action: () => openRequestItem(item),
        });
      }
    }

    if (!query.trim()) return results;
    const q = query.toLowerCase();
    return results.filter(
      (it) => it.label.toLowerCase().includes(q) || (it.hint?.toLowerCase().includes(q)) || (it.method?.toLowerCase().includes(q)),
    );
  }, [query, addTab, onClose, t, updateHttpConfig, collections, collectionItems, openRequestItem, sectionGo, sectionCmd, sectionReq, dl]);

  // 分组渲染顺序（保留 results 中的相对顺序）
  const grouped = useMemo(() => {
    const order: string[] = [sectionGo, sectionCmd, sectionReq];
    const map = new Map<string, PaletteItem[]>();
    for (const it of items) {
      if (!map.has(it.section)) map.set(it.section, []);
      map.get(it.section)!.push(it);
    }
    return order.filter((s) => map.has(s)).map((s) => ({ section: s, items: map.get(s)! }));
  }, [items, sectionGo, sectionCmd, sectionReq]);

  // 键盘导航（基于扁平 items 索引）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && items[selectedIdx]) {
      e.preventDefault();
      items[selectedIdx].action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [items, selectedIdx, onClose]);

  if (!isOpen) return null;

  let flatIdx = -1;

  return (
    <>
      <div className="fixed inset-0 bg-[rgba(20,28,40,0.34)] backdrop-blur-sm z-[var(--z-tooltip)] dark:bg-[rgba(5,6,8,0.62)]" onClick={onClose} />
      <div className="fixed left-1/2 top-[15%] z-[var(--z-tooltip)] flex max-h-[460px] w-[620px] max-w-[92vw] -translate-x-1/2 flex-col overflow-hidden rounded-[12px] border border-border-strong bg-bg-elevated text-popover-foreground shadow-lg">
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5 dark:border-white/[0.05]">
          <Search className="w-4 h-4 text-text-disabled shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder')}
            className="h-10 flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-disabled"
          />
          <button onClick={onClose} aria-label={t('commandPalette.closeLabel')} className="pf-rounded-md p-1.5 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grouped results */}
        <div className="flex-1 overflow-auto py-2">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-disabled pf-text-base">
              {t('commandPalette.noResults')}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.section} className="mb-1">
                <div className="px-5 pb-1 pt-2 pf-text-xxs font-bold uppercase tracking-[0.06em] text-text-tertiary">
                  {group.section}
                </div>
                {group.items.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  const isSel = idx === selectedIdx;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={cn(
                        'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[7px] px-2.5 py-2 text-left transition-colors',
                        isSel ? 'bg-muted dark:bg-white/[0.06]' : 'hover:bg-muted/60 dark:hover:bg-white/[0.03]',
                      )}
                    >
                      {item.method ? (
                        <span className={cn('pf-mtag shrink-0 w-[34px] text-center', `m-${item.method.toLowerCase()}`)}>{item.method}</span>
                      ) : Icon ? (
                        <Icon className={cn('w-4 h-4 shrink-0', isSel ? 'text-accent' : 'text-text-disabled')} />
                      ) : null}
                      <span className={cn('flex-1 min-w-0 truncate pf-text-base font-medium', isSel ? 'text-accent' : 'text-text-primary')}>
                        {item.label}
                      </span>
                      {item.hint && <span className="shrink-0 truncate pf-text-xs text-text-disabled max-w-[180px]">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t border-border-subtle bg-muted/30 px-4 py-2.5 pf-text-xxs text-text-tertiary dark:border-white/[0.05] dark:bg-white/[0.02]">
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">↑↓</kbd> {t('commandPalette.select')}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">Enter</kbd> {t('commandPalette.confirm')}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default pf-text-3xs">Esc</kbd> {t('commandPalette.closeLabel')}</span>
        </div>
      </div>
    </>
  );
}
