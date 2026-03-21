import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ChevronDown, X, Copy, Trash2, Edit3, ArrowRightFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { RequestProtocol } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useWindowFrameGestures } from "@/hooks/useWindowFrameGestures";

export interface Tab {
  id: string;
  label: string;
  protocol: RequestProtocol;
  method?: string;
  modified?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: (protocol?: RequestProtocol) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

const protocolLabels: Record<RequestProtocol, string> = {
  http: "HTTP",
  ws: "WebSocket",
  sse: "SSE",
  mqtt: "MQTT",
};

const protocolColors: Record<RequestProtocol, string> = {
  http: "bg-emerald-500/15 text-emerald-600",
  ws: "bg-amber-500/15 text-amber-600",
  sse: "bg-orange-500/15 text-orange-600",
  mqtt: "bg-purple-500/15 text-purple-600",
};

const protocolDotColors: Record<RequestProtocol, string> = {
  http: "bg-emerald-500",
  ws: "bg-amber-500",
  sse: "bg-orange-500",
  mqtt: "bg-purple-500",
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

const createOptions: Array<{ protocol: RequestProtocol; label: string }> = [
  { protocol: "http", label: "HTTP" },
  { protocol: "ws", label: "WebSocket" },
  { protocol: "sse", label: "SSE" },
  { protocol: "mqtt", label: "MQTT" },
];

function isRequestProtocol(value: string): value is RequestProtocol {
  return createOptions.some((option) => option.protocol === value);
}

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onReorder }: TabBarProps) {
  const { t } = useTranslation();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCount = useRef(tabs.length);
  const frameGestures = useWindowFrameGestures();
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const createMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });

  const storedDefaultProtocol = useSettingsStore((s) => s.settings.defaultNewProtocol);
  const defaultProtocol = isRequestProtocol(storedDefaultProtocol) ? storedDefaultProtocol : "http";

  useEffect(() => {
    if (tabs.length > prevTabCount.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
      });
    }
    prevTabCount.current = tabs.length;
  }, [tabs.length]);

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      onReorder?.(dragIndexRef.current, index);
    }

    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleCreateWithProtocol = (protocol: RequestProtocol) => {
    onNewTab(protocol);
    useSettingsStore.getState().update("defaultNewProtocol", protocol);
    setShowCreateMenu(false);
  };

  const toggleCreateMenu = () => {
    if (createMenuAnchorRef.current) {
      const rect = createMenuAnchorRef.current.getBoundingClientRect();
      setCreateMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 180) });
    }
    setShowCreateMenu((prev) => !prev);
  };

  return (
    <div
      {...frameGestures}
      ref={tabBarRef}
      className="flex h-[var(--tabbar-height)] shrink-0 items-center border-b border-border-default/65 bg-transparent px-1.5"
    >
      <div ref={scrollRef} className="flex flex-1 items-center gap-1 overflow-x-auto py-0.5 scrollbar-hide">
        <AnimatePresence mode="popLayout">
          {tabs.map((tab, index) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDragOver={dragOverIndex === index}
              onClick={() => onTabChange(tab.id)}
              onClose={() => onTabClose(tab.id)}
              totalTabs={tabs.length}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="mx-1.5 h-4 w-px bg-border-strong/70" />
      <div ref={createMenuAnchorRef} className="shrink-0 no-drag">
        <div className="flex items-center rounded-[11px] border border-border-default/70 bg-bg-secondary/55">
          <button
            onClick={() => handleCreateWithProtocol(defaultProtocol)}
            className="flex h-8 items-center gap-1.5 rounded-l-[11px] px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/75 hover:text-text-primary"
            title={`${t('tabBar.new')} ${protocolLabels[defaultProtocol]} (Ctrl+N)`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className={cn("rounded-[5px] px-1.5 py-[1px] text-[10px] font-bold leading-none", protocolColors[defaultProtocol])}>
              {protocolLabels[defaultProtocol]}
            </span>
          </button>
          <div className="h-4 w-px bg-border-default/70" />
          <button
            onClick={toggleCreateMenu}
            className={cn(
              "flex h-8 w-7 items-center justify-center rounded-r-[11px] text-text-tertiary transition-colors hover:bg-bg-hover/75 hover:text-text-primary",
              showCreateMenu && "bg-bg-hover/75 text-text-primary"
            )}
            title={t('tabBar.selectProtocol')}
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showCreateMenu && "rotate-180")} />
          </button>
        </div>
      </div>

      {showCreateMenu && (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowCreateMenu(false)} />
          <div
            className="fixed z-[221] w-[180px] overflow-hidden rounded-[12px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('tabBar.requestProtocol')}
            </div>
            {createOptions.map((option) => {
              const isDefault = option.protocol === defaultProtocol;
              return (
                <button
                  key={option.protocol}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCreateWithProtocol(option.protocol);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                    isDefault && "bg-bg-hover/40"
                  )}
                >
                  <span
                    className={cn(
                      "h-[6px] w-[6px] shrink-0 rounded-full transition-opacity",
                      protocolDotColors[option.protocol],
                      isDefault ? "opacity-100" : "opacity-30"
                    )}
                  />
                  <span className="text-[12px] font-medium text-text-primary">{option.label}</span>
                  {isDefault ? <span className="ml-auto text-[10px] text-text-disabled">{t('tabBar.default')}</span> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  isDragOver,
  onClick,
  onClose,
  totalTabs,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  tab: Tab;
  isActive: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onClose: () => void;
  totalTabs: number;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.label);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const renameTab = useAppStore((s) => s.renameTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const { showMenu, MenuComponent } = useContextMenu();

  const handleDoubleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
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

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose();
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    const items: ContextMenuEntry[] = [
      {
        id: "rename",
        label: t('contextMenu.rename'),
        icon: <Edit3 className="h-3.5 w-3.5" />,
        onClick: () => {
          setRenameValue(tab.label);
          setIsRenaming(true);
          setTimeout(() => renameInputRef.current?.select(), 0);
        },
      },
      {
        id: "duplicate",
        label: t('tabBar.duplicate'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: () => duplicateTab(tab.id),
      },
      { type: "divider" },
      { id: "close", label: t('tabBar.close'), shortcut: "Ctrl+W", onClick: onClose },
      { id: "close-others", label: t('tabBar.closeOthers'), onClick: () => closeOtherTabs(tab.id), disabled: totalTabs <= 1 },
      {
        id: "close-right",
        label: t('tabBar.closeRight'),
        icon: <ArrowRightFromLine className="h-3.5 w-3.5" />,
        onClick: () => closeTabsToRight(tab.id),
      },
      { type: "divider" },
      {
        id: "delete",
        label: t('contextMenu.delete'),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        danger: true,
        onClick: onClose,
      },
    ];
    showMenu(event, items);
  };

  const badgeColor = tab.protocol === "http" && tab.method
    ? methodBadgeColors[tab.method] || protocolColors[tab.protocol]
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
        onDragEnd={onDragEnd}
        className={cn(
          "group relative flex h-8 min-w-[112px] max-w-[228px] shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 no-drag",
          "cursor-pointer transition-all duration-[var(--transition-fast)]",
          isActive
            ? "z-10 bg-transparent font-medium text-text-primary"
            : "bg-transparent text-text-tertiary hover:text-text-secondary",
          isDragOver && "ring-2 ring-accent/50"
        )}
      >
        {isActive ? (
          <motion.div
            layoutId="tab-active-indicator"
            className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full bg-accent"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        ) : null}

        <span className={cn("shrink-0 rounded-[4px] px-1 py-0.5 text-[10px] font-bold leading-none", badgeColor)}>
          {tab.protocol === "http" && tab.method ? tab.method : protocolLabels[tab.protocol]}
        </span>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setRenameValue(tab.label);
                setIsRenaming(false);
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 border-b border-accent bg-transparent px-0.5 py-0 text-[12px] text-text-primary outline-none"
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] leading-none">{tab.label}</span>
        )}

        <button
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] transition-colors",
            isActive
              ? "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              : "text-text-disabled opacity-0 hover:text-text-primary group-hover:opacity-100"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </motion.div>
      {MenuComponent}
    </>
  );
}
