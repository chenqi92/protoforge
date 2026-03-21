// ProtoForge Command Palette (Ctrl+K)
// 全局搜索：集合/请求/环境/历史

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, FileText, Globe, X, Network, Gauge, Radio, Puzzle, Settings } from 'lucide-react';
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
  const openToolTab = useAppStore((s) => s.openToolTab);

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
      { type: 'action', label: '新建 HTTP 请求', description: 'Ctrl+N', icon: FileText, action: () => { addTab('http'); onClose(); } },
      { type: 'action', label: '新建 WebSocket 连接', icon: Globe, action: () => { addTab('ws'); onClose(); } },
      { type: 'action', label: '新建 SSE 连接', icon: Globe, action: () => { addTab('sse'); onClose(); } },
      { type: 'action', label: '新建 MQTT 连接', icon: Globe, action: () => { addTab('mqtt'); onClose(); } },
      { type: 'action', label: '打开 TCP/UDP 工作台', icon: Network, action: () => { openToolTab('tcpudp'); onClose(); } },
      { type: 'action', label: '打开抓包工作台', icon: Radio, action: () => { openToolTab('capture'); onClose(); } },
      { type: 'action', label: '打开压测工作台', icon: Gauge, action: () => { openToolTab('loadtest'); onClose(); } },
      { type: 'action', label: '打开插件中心', icon: Puzzle, action: () => { window.dispatchEvent(new CustomEvent('open-plugin-modal')); onClose(); } },
      { type: 'action', label: '打开偏好设置', icon: Settings, action: () => { window.dispatchEvent(new CustomEvent('open-settings-modal')); onClose(); } },
    );

    // Filter by query
    if (!query.trim()) return results;
    const q = query.toLowerCase();
    return results.filter(item =>
      item.label.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q))
    );
  }, [query, addTab, onClose, openToolTab]);

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
      <div className="fixed inset-0 bg-black/40 z-[999] backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-[15%] z-[1000] flex max-h-[460px] w-[620px] max-w-[92vw] -translate-x-1/2 flex-col overflow-hidden rounded-[24px] border border-white/60 bg-bg-primary/96 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl">
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-border-default/75 bg-bg-primary/78 px-5 py-3">
          <Search className="w-4 h-4 text-text-disabled shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="搜索操作、请求、集合..."
            className="h-10 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-disabled"
          />
          <button onClick={onClose} className="rounded-[12px] p-1.5 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto bg-bg-secondary/18 py-2.5">
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-disabled text-[13px]">
              未找到结果
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
                    "mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[14px] px-4 py-3 text-left transition-colors",
                    i === selectedIdx ? "bg-bg-primary/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]" : "hover:bg-bg-hover/70"
                  )}
                >
                  <Icon className={cn("w-4 h-4 shrink-0", i === selectedIdx ? "text-accent" : "text-text-disabled")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px] font-medium truncate", i === selectedIdx ? "text-accent" : "text-text-primary")}>
                      {item.label}
                    </p>
                    {item.description && <p className="text-[11px] text-text-disabled truncate">{item.description}</p>}
                  </div>
                  <span className={cn("text-[10px] uppercase tracking-wider shrink-0",
                    item.type === 'action' ? "text-accent/60" :
                    item.type === 'collection' ? "text-blue-500/60" :
                    item.type === 'environment' ? "text-emerald-500/60" :
                    "text-text-disabled"
                  )}>
                    {item.type === 'action' ? '操作' : item.type === 'collection' ? '集合' : item.type === 'environment' ? '环境' : item.type === 'history' ? '历史' : '请求'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 border-t border-border-default/75 bg-bg-primary/78 px-4 py-2.5 text-[10px] text-text-disabled">
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default text-[9px]">↑↓</kbd> 选择</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default text-[9px]">Enter</kbd> 确认</span>
          <span><kbd className="px-1 py-0.5 rounded bg-bg-secondary border border-border-default text-[9px]">Esc</kbd> 关闭</span>
        </div>
      </div>
    </>
  );
}
