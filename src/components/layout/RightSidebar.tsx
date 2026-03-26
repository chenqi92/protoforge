/**
 * RightSidebar — 全局右侧侧边栏
 *
 * 包含两个 Tab：
 * 1. Activity Logs — 统一活动日志流 (HTTP/TCP/UDP/WS/MQTT)
 * 2. Protocol Parser — 协议解析器
 *
 * 通过 react-resizable-panels 集成到 App 布局中，
 * 所有 Workbench（requests, tcpudp, capture, loadtest）均可见。
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ScrollText, FileCode2, Search, Trash2,
  ArrowDownRight, ArrowUpRight, Globe, Network,
  Radio, Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useActivityLogStore, type ActivityLogEntry, type LogSource } from '@/stores/activityLogStore';
import { usePluginStore } from '@/stores/pluginStore';
import { ProtocolParserPanel } from '@/components/plugins/ProtocolParserPanel';

type RightSidebarView = 'logs' | 'parser';

interface RightSidebarProps {
  panelCollapsed: boolean;
  onTogglePanel: () => void;
}

const baseNavItems: { id: RightSidebarView; icon: typeof ScrollText; labelKey: string }[] = [
  { id: 'logs', icon: ScrollText, labelKey: 'rightSidebar.logs' },
];

const parserNavItem = { id: 'parser' as RightSidebarView, icon: FileCode2, labelKey: 'rightSidebar.parser' };

const sourceIcons: Record<LogSource, typeof Globe> = {
  http: Globe,
  tcp: Network,
  udp: Network,
  ws: Wifi,
  mqtt: Radio,
  system: ScrollText,
};

const sourceColors: Record<LogSource, string> = {
  http: 'text-emerald-500',
  tcp: 'text-blue-500',
  udp: 'text-violet-500',
  ws: 'text-amber-500',
  mqtt: 'text-cyan-500',
  system: 'text-text-tertiary',
};

export function RightSidebar({ panelCollapsed, onTogglePanel }: RightSidebarProps) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<RightSidebarView>('logs');
  const [parserInitialData, setParserInitialData] = useState<string | undefined>(undefined);

  // 仅在安装了 protocol-parser 插件时才显示 Parser Tab
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const hasParserPlugin = installedPlugins.some((p) => p.pluginType === 'protocol-parser');
  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (hasParserPlugin) items.push(parserNavItem);
    return items;
  }, [hasParserPlugin]);

  // 如果卸载了所有解析插件，自动切回 logs 视图
  useEffect(() => {
    if (!hasParserPlugin && activeView === 'parser') {
      setActiveView('logs');
    }
  }, [hasParserPlugin, activeView]);

  // 监听来自 MessageLog / 其它模块的解析请求事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.data) {
        setParserInitialData(detail.data);
        setActiveView('parser');
        // 如果侧边栏折叠，则自动展开
        if (panelCollapsed) {
          onTogglePanel();
        }
      }
    };
    window.addEventListener('parse-protocol', handler);
    return () => window.removeEventListener('parse-protocol', handler);
  }, [panelCollapsed, onTogglePanel]);

  const handleNavClick = (view: RightSidebarView) => {
    if (panelCollapsed) {
      setActiveView(view);
      onTogglePanel();
    } else if (activeView === view) {
      onTogglePanel();
    } else {
      setActiveView(view);
    }
  };

  return (
    <div className="h-full flex">
      {/* ── Detail Panel ── */}
      {!panelCollapsed && (
        <div className="flex-1 h-full flex flex-col bg-transparent overflow-hidden min-w-0">
          {activeView === 'logs' && <ActivityLogsView />}
          {activeView === 'parser' && (
            <ProtocolParserPanel
              initialData={parserInitialData}
              className="flex-1 min-h-0"
            />
          )}
        </div>
      )}

      {/* ── Icon Rail (右边缘) ── */}
      <div className="w-12 h-full flex flex-col items-center pt-2 pb-3 bg-transparent border-l border-border-default/60 shrink-0">
        {navItems.map(({ id, icon: Icon, labelKey }) => {
          const label = t(labelKey, id === 'logs' ? '活动日志' : '协议解析');
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                'relative mb-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-all duration-150',
                isActive
                  ? 'text-accent bg-accent-soft'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
              )}
              title={label}
            >
              {isActive && (
                <motion.div
                  layoutId="right-sidebar-active-indicator"
                  className="absolute right-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-l-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={cn('w-4 h-4', isActive && 'drop-shadow-sm')} strokeWidth={isActive ? 2.2 : 1.8} />
            </button>
          );
        })}
        <div className="flex-1" />
      </div>
    </div>
  );
}

/* ── Activity Logs View ── */
function ActivityLogsView() {
  const { t } = useTranslation();
  const entries = useActivityLogStore((s) => s.entries);
  const filterRegex = useActivityLogStore((s) => s.filterRegex);
  const clearAll = useActivityLogStore((s) => s.clearAll);
  const setFilterRegex = useActivityLogStore((s) => s.setFilterRegex);

  const [regexError, setRegexError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = useCallback((value: string) => {
    setFilterRegex(value);
    if (value) {
      try {
        new RegExp(value, 'i');
        setRegexError(false);
      } catch {
        setRegexError(true);
      }
    } else {
      setRegexError(false);
    }
  }, [setFilterRegex]);

  const filteredEntries = useMemo(() => {
    if (!filterRegex) return entries;
    try {
      const re = new RegExp(filterRegex, 'i');
      return entries.filter((e) =>
        re.test(e.summary) || re.test(e.source) || (e.rawData && re.test(e.rawData))
      );
    } catch {
      return entries;
    }
  }, [entries, filterRegex]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  const handleParseEntry = (entry: ActivityLogEntry) => {
    if (!entry.rawData) return;
    window.dispatchEvent(new CustomEvent('parse-protocol', { detail: { data: entry.rawData } }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border-subtle/70 bg-transparent px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[var(--fs-sm)] font-semibold text-text-primary">
            {t('rightSidebar.logs', '活动日志')}
          </span>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                onClick={clearAll}
                className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-red-500"
                title={t('sidebar.clearAll', '清空')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('sidebar.clearAll', '清空')}
              </button>
            )}
          </div>
        </div>

        {/* Regex search */}
        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-accent transition-colors" />
          <input
            value={filterRegex}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder={t('rightSidebar.regexSearch', '正则搜索日志...')}
            className={cn(
              'h-[30px] w-full rounded-[10px] border bg-bg-secondary/42 pl-8 pr-3 text-[length:var(--fs-sidebar)] text-text-primary outline-none transition-all placeholder:text-text-tertiary focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]',
              regexError
                ? 'border-red-400 focus:border-red-400'
                : 'border-border-default/80 focus:border-accent'
            )}
          />
          {regexError && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fs-3xs)] text-red-400">
              {t('rightSidebar.invalidRegex', '无效正则')}
            </span>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-1.5 py-1">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-[14px] border border-border-subtle bg-bg-hover shadow-sm">
              <ScrollText className="w-5 h-5 text-text-tertiary" />
            </div>
            <p className="text-[length:var(--fs-sidebar)] font-medium text-text-secondary">
              {entries.length === 0
                ? t('rightSidebar.noLogs', '暂无活动日志')
                : t('rightSidebar.noMatch', '无匹配日志')}
            </p>
            <p className="text-[length:var(--fs-sidebar-sm)] text-text-disabled">
              {t('rightSidebar.noLogsHint', 'HTTP 请求、TCP 通信等操作日志将在此显示')}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const SourceIcon = sourceIcons[entry.source] || ScrollText;
            const dirIcon = entry.direction === 'sent'
              ? <ArrowUpRight className="w-3 h-3 text-amber-500" />
              : entry.direction === 'received'
                ? <ArrowDownRight className="w-3 h-3 text-emerald-500" />
                : null;

            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 px-2 py-[6px] rounded-[8px] hover:bg-bg-hover/50 transition-colors group cursor-default"
              >
                <div className="flex items-center gap-1 mt-0.5 shrink-0">
                  <SourceIcon className={cn('w-3.5 h-3.5', sourceColors[entry.source])} />
                  {dirIcon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--fs-3xs)] text-text-disabled font-mono tabular-nums shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className="text-[var(--fs-3xs)] text-text-disabled uppercase font-semibold shrink-0">
                      {entry.source}
                    </span>
                  </div>
                  <p className="text-[length:var(--fs-sidebar-sm)] text-text-primary truncate mt-0.5" title={entry.summary}>
                    {entry.summary}
                  </p>
                </div>
                {entry.rawData && (
                  <button
                    onClick={() => handleParseEntry(entry)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-accent transition-all shrink-0 mt-0.5"
                    title={t('rightSidebar.parseThis', '解析此报文')}
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
