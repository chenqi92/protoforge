import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceProtocol } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { Copy, Trash2, Edit3, ArrowRightFromLine, ExternalLink } from "lucide-react";
import type { ToolWindowType } from "@/lib/windowManager";

export interface Tab {
  id: string;
  label: string;
  protocol: WorkspaceProtocol;
  method?: string;
  detachableTool?: ToolWindowType;
  modified?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: (protocol?: Exclude<WorkspaceProtocol, "collection">) => void;
  onDetachTab?: (id: string, tool: ToolWindowType) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

const protocolLabels: Record<WorkspaceProtocol, string> = {
  http: "HTTP", ws: "WebSocket", sse: "SSE", mqtt: "MQTT", collection: "合集",
  tcpudp: "TCP/UDP", loadtest: "压测", capture: "抓包",
};

const protocolColors: Record<WorkspaceProtocol, string> = {
  http: "bg-emerald-500/15 text-emerald-600",
  ws: "bg-amber-500/15 text-amber-600",
  sse: "bg-orange-500/15 text-orange-600",
  mqtt: "bg-purple-500/15 text-purple-600",
  collection: "bg-sky-500/15 text-sky-600",
  tcpudp: "bg-blue-500/15 text-blue-600",
  loadtest: "bg-rose-500/15 text-rose-600",
  capture: "bg-cyan-500/15 text-cyan-600",
};

const methodBadgeColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-600",
  POST: "bg-amber-500/15 text-amber-600",
  PUT: "bg-blue-500/15 text-blue-600",
  DELETE: "bg-red-500/15 text-red-600",
  PATCH: "bg-violet-500/15 text-violet-600",
  HEAD: "bg-cyan-500/15 text-cyan-600",
  OPTIONS: "bg-gray-500/15 text-gray-600",
};

const createMenuSections: Array<{
  id: string;
  label: string;
  options: Array<{ protocol: Exclude<WorkspaceProtocol, "collection">; label: string; desc: string }>;
}> = [
  {
    id: "protocols",
    label: "请求协议",
    options: [
      { protocol: "http", label: "HTTP 请求", desc: "REST / GraphQL / 表单提交" },
      { protocol: "ws", label: "WebSocket", desc: "实时连接与消息调试" },
      { protocol: "sse", label: "SSE", desc: "事件流与服务推送" },
      { protocol: "mqtt", label: "MQTT", desc: "Broker / 订阅 / 发布" },
    ],
  },
  {
    id: "tools",
    label: "工具工作台",
    options: [
      { protocol: "tcpudp", label: "TCP / UDP", desc: "Socket 测试与二进制调试" },
      { protocol: "loadtest", label: "压力测试", desc: "并发压测与实时指标观测" },
      { protocol: "capture", label: "网络抓包", desc: "HTTP 代理与请求响应录制" },
    ],
  },
];

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onDetachTab, onReorder }: TabBarProps) {
  const tabBarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCount = useRef(tabs.length);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const createMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (tabs.length > prevTabCount.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
      });
    }
    prevTabCount.current = tabs.length;
  }, [tabs.length]);

  const handleDragStart = (idx: number) => { dragIndexRef.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIndex(idx); };
  const handleDrop = (idx: number) => {
    if (dragIndexRef.current !== null && dragIndexRef.current !== idx) {
      onReorder?.(dragIndexRef.current, idx);
    }
    dragIndexRef.current = null; setDragOverIndex(null);
  };
  const handleDragEnd = (event: React.DragEvent, tab: Tab) => {
    dragIndexRef.current = null;
    setDragOverIndex(null);

    if (!tab.detachableTool || !onDetachTab || !tabBarRef.current) return;

    const rect = tabBarRef.current.getBoundingClientRect();
    const detached =
      event.clientY < rect.top - 36
      || event.clientY > rect.bottom + 36
      || event.clientX < rect.left - 36
      || event.clientX > rect.right + 36;

    if (detached) {
      onDetachTab(tab.id, tab.detachableTool);
    }
  };

  const toggleCreateMenu = () => {
    if (createMenuAnchorRef.current) {
      const rect = createMenuAnchorRef.current.getBoundingClientRect();
      setCreateMenuPos({ top: rect.bottom + 8, left: Math.max(12, rect.right - 240) });
    }
    setShowCreateMenu((prev) => !prev);
  };

  return (
    <div ref={tabBarRef} className="h-[var(--tabbar-height)] flex items-center border-b border-border-default/65 bg-transparent shrink-0 px-2.5">
      <div ref={scrollRef} className="flex-1 flex items-center overflow-x-auto scrollbar-hide py-1.5 gap-1">
        <AnimatePresence mode="popLayout">
          {tabs.map((tab, idx) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDragOver={dragOverIndex === idx}
              onClick={() => onTabChange(tab.id)}
              onClose={() => onTabClose(tab.id)}
              onDetach={() => tab.detachableTool ? onDetachTab?.(tab.id, tab.detachableTool) : undefined}
              totalTabs={tabs.length}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={(e) => handleDragEnd(e, tab)}
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="w-[1px] h-4 bg-border-strong/70 mx-2" />
      <div ref={createMenuAnchorRef} className="shrink-0">
        <div className="flex items-center rounded-[14px] border border-border-default/75 bg-bg-primary/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
          <button
            onClick={() => onNewTab("http")}
            className="flex h-8 items-center gap-1.5 rounded-l-[14px] px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/75 hover:text-text-primary"
            title="新建 HTTP 请求 (Ctrl+N)"
          >
            <Plus className="w-3.5 h-3.5" />
            新建
          </button>
          <div className="h-4 w-px bg-border-default/70" />
          <button
            onClick={toggleCreateMenu}
            className="flex h-8 w-8 items-center justify-center rounded-r-[14px] text-text-tertiary transition-colors hover:bg-bg-hover/75 hover:text-text-primary"
            title="选择协议类型"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showCreateMenu && (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowCreateMenu(false)} />
          <div
            className="fixed z-[221] min-w-[240px] overflow-hidden rounded-[18px] border border-border-default/80 bg-bg-primary/96 p-1.5 shadow-[0_24px_64px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            {createMenuSections.map((section, sectionIndex) => (
              <div key={section.id}>
                {sectionIndex > 0 ? <div className="mx-2 my-1.5 h-px bg-border-default/70" /> : null}
                <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-disabled">
                  {section.label}
                </div>
                {section.options.map((option) => (
                  <button
                    key={option.protocol}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewTab(option.protocol);
                      setShowCreateMenu(false);
                    }}
                    className="flex w-full items-start gap-2 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-bg-hover/70"
                  >
                    <span className={cn(
                      "mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      protocolColors[option.protocol]
                    )}>
                      {protocolLabels[option.protocol]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-text-primary">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-text-tertiary">{option.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


function TabItem({ tab, isActive, isDragOver, onClick, onClose, onDetach, totalTabs, onDragStart, onDragOver, onDrop, onDragEnd }: {
  tab: Tab;
  isActive: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onClose: () => void;
  onDetach?: () => void;
  totalTabs: number;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.label);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const renameTab = useAppStore((s) => s.renameTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const duplicateTab = useAppStore((s) => s.duplicateTab);

  const { showMenu, MenuComponent } = useContextMenu();

  // Double-click to rename
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRenameValue(tab.label);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.label) {
      renameTab(tab.id, trimmed);
    }
    setIsRenaming(false);
  };

  // Middle-click to close
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose();
    }
  };

  // Right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    const items: ContextMenuEntry[] = [
      { id: "rename", label: "重命名", icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => { setRenameValue(tab.label); setIsRenaming(true); setTimeout(() => renameInputRef.current?.select(), 0); } },
      { id: "duplicate", label: "复制标签页", icon: <Copy className="w-3.5 h-3.5" />, onClick: () => duplicateTab(tab.id) },
      ...(tab.detachableTool && onDetach ? [{ id: "detach", label: "弹出为独立窗口", icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: onDetach }] : []),
      { type: "divider" },
      { id: "close", label: "关闭", shortcut: "Ctrl+W", onClick: onClose },
      { id: "close-others", label: "关闭其他", onClick: () => closeOtherTabs(tab.id), disabled: totalTabs <= 1 },
      { id: "close-right", label: "关闭右侧", icon: <ArrowRightFromLine className="w-3.5 h-3.5" />, onClick: () => closeTabsToRight(tab.id) },
      { type: "divider" },
      { id: "delete", label: "删除", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: onClose },
    ];
    showMenu(e, items);
  };

  const badgeColor = tab.protocol === "http" && tab.method
    ? (methodBadgeColors[tab.method] || protocolColors[tab.protocol])
    : protocolColors[tab.protocol];

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        onClick={onClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEndCapture={onDragEnd}
        className={cn(
          "group relative flex items-center gap-2 px-3 h-[32px] rounded-[14px]",
          "cursor-pointer transition-all duration-[var(--transition-fast)] border",
          "min-w-[110px] max-w-[220px] shrink-0",
          isActive
            ? "bg-bg-primary/85 border-border-default/80 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] z-10 font-medium"
            : "bg-transparent border-transparent text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/60",
          isDragOver && "ring-2 ring-accent/50"
        )}
      >
        {/* Active indicator line */}
        {isActive && (
          <motion.div
            layoutId="tab-active-indicator"
            className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}

        {/* Protocol badge */}
        <span
          className={cn(
            "shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold leading-none",
            badgeColor
          )}
        >
          {tab.protocol === "http" && tab.method ? tab.method : protocolLabels[tab.protocol]}
        </span>

        {/* Label or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commitRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRenameValue(tab.label);
                setIsRenaming(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-[12px] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0"
            autoFocus
          />
        ) : (
          <span className="text-[12px] truncate flex-1 min-w-0">{tab.label}</span>
        )}

        {tab.detachableTool && onDetach ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDetach();
            }}
            className={cn(
              "h-5 w-5 shrink-0 rounded-sm transition-colors",
              "flex items-center justify-center text-text-disabled hover:bg-bg-hover hover:text-text-primary",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            title="弹出为独立窗口，也可以直接将标签拖出"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}

        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className={cn(
            "w-5 h-5 flex items-center justify-center rounded-sm shrink-0 transition-colors",
            isActive
              ? "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              : "opacity-0 group-hover:opacity-100 text-text-disabled hover:text-text-primary hover:bg-bg-hover"
          )}
        >
          <X className="w-3 h-3" />
        </button>
      </motion.div>
      {MenuComponent}
    </>
  );
}
