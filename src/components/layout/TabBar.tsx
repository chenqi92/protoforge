import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProtocolType } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { Copy, Trash2, Edit3, ArrowRightFromLine } from "lucide-react";

export interface Tab {
  id: string;
  label: string;
  protocol: ProtocolType;
  method?: string;
  modified?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: (protocol?: ProtocolType) => void;
  onProtocolChange: (id: string, protocol: ProtocolType) => void;
}

const protocolLabels: Record<ProtocolType, string> = {
  http: "HTTP", ws: "WebSocket", sse: "SSE", mqtt: "MQTT", collection: "合集",
};

const protocolColors: Record<ProtocolType, string> = {
  http: "bg-emerald-500/15 text-emerald-600",
  ws: "bg-amber-500/15 text-amber-600",
  sse: "bg-orange-500/15 text-orange-600",
  mqtt: "bg-purple-500/15 text-purple-600",
  collection: "bg-sky-500/15 text-sky-600",
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

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onProtocolChange }: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCount = useRef(tabs.length);

  useEffect(() => {
    if (tabs.length > prevTabCount.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
      });
    }
    prevTabCount.current = tabs.length;
  }, [tabs.length]);

  return (
    <div className="h-[var(--tabbar-height)] flex items-center bg-bg-secondary/50 border-b border-border-default shrink-0 px-2">
      <div ref={scrollRef} className="flex-1 flex items-center overflow-x-auto scrollbar-hide py-1.5 gap-1">
        <AnimatePresence mode="popLayout">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onClick={() => onTabChange(tab.id)}
              onClose={() => onTabClose(tab.id)}
              onProtocolChange={(p) => onProtocolChange(tab.id, p)}
              totalTabs={tabs.length}
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="w-[1px] h-4 bg-border-strong mx-2" />
      <button
        onClick={() => onNewTab("http")}
        className="w-8 h-8 flex items-center justify-center shrink-0 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
        title="新建请求 (Ctrl+N)"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}


function TabItem({ tab, isActive, onClick, onClose, onProtocolChange, totalTabs }: {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onProtocolChange: (p: ProtocolType) => void;
  totalTabs: number;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.label);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });

  const renameTab = useAppStore((s) => s.renameTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const duplicateTab = useAppStore((s) => s.duplicateTab);

  const { showMenu, MenuComponent } = useContextMenu();

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      setPickerPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowPicker(!showPicker);
  };

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
        className={cn(
          "group relative flex items-center gap-2 px-3 h-[34px] rounded-t-lg rounded-b-none",
          "cursor-pointer transition-all duration-[var(--transition-fast)] border-t-[2.5px] border-x border-b",
          "min-w-[130px] max-w-[240px] shrink-0",
          isActive
            ? "bg-bg-primary border-t-accent border-x-border-default border-b-transparent text-text-primary shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-10"
            : "bg-transparent border-transparent border-b-border-default text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
        )}
      >
        {/* Protocol badge */}
        <div className="relative">
          <button
            ref={badgeRef}
            onClick={openPicker}
            className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded-[4px] leading-none shrink-0",
              badgeColor
            )}
          >
            {tab.protocol === "http" && tab.method ? tab.method : protocolLabels[tab.protocol]}
            <ChevronDown className="w-2.5 h-2.5 inline-block ml-0.5 opacity-50" />
          </button>

          {showPicker && (
            <>
              <div className="fixed inset-0 z-[200]" onClick={(e) => { e.stopPropagation(); setShowPicker(false); }} />
              <div
                className="fixed z-[201] bg-bg-elevated border border-border-default rounded-md shadow-lg overflow-hidden min-w-[120px] py-0.5"
                style={{ top: pickerPos.top, left: pickerPos.left }}
              >
                {(Object.keys(protocolLabels) as ProtocolType[]).map((p) => (
                  <button
                    key={p}
                    onClick={(e) => { e.stopPropagation(); onProtocolChange(p); setShowPicker(false); }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-[12px] font-medium hover:bg-bg-hover transition-colors",
                      tab.protocol === p ? "bg-accent-soft text-accent" : "text-text-secondary"
                    )}
                  >
                    {protocolLabels[p]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Label or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-[12px] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0"
            autoFocus
          />
        ) : (
          <span className="text-[12px] truncate flex-1 min-w-0">{tab.label}</span>
        )}

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
