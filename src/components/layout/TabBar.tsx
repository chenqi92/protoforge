import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ChevronLeft, ChevronRight, X, Copy, Trash2, Edit3, ArrowRightFromLine, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { RequestProtocol } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import type { HttpRequestMode } from "@/types/http";

export interface Tab {
  id: string;
  label: string;
  protocol: RequestProtocol;
  method?: string;
  requestMode?: HttpRequestMode;
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
  mqtt: "MQTT",
};

const protocolColors: Record<RequestProtocol, string> = {
  http: "bg-emerald-500/15 text-emerald-600",
  ws: "bg-amber-500/15 text-amber-600",
  mqtt: "bg-purple-500/15 text-purple-600",
};

const modeBadgeColors: Record<HttpRequestMode, string> = {
  rest: "bg-emerald-500/15 text-emerald-600",
  graphql: "bg-fuchsia-500/15 text-fuchsia-600",
  sse: "bg-orange-500/15 text-orange-600",
};

const modeLabels: Record<HttpRequestMode, string> = {
  rest: "HTTP",
  graphql: "GraphQL",
  sse: "SSE",
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

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onReorder }: TabBarProps) {
  const { t } = useTranslation();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCount = useRef(tabs.length);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const tabMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0 });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const createProtocol: RequestProtocol = "http";

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const nextCanScrollLeft = el.scrollLeft > 4;
    const nextCanScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setCanScrollLeft(nextCanScrollLeft);
    setCanScrollRight(nextCanScrollRight);
  }, []);

  useEffect(() => {
    if (tabs.length > prevTabCount.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
        updateScrollState();
      });
    }
    prevTabCount.current = tabs.length;
  }, [tabs.length, updateScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => updateScrollState();
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      if (el.scrollWidth <= el.clientWidth) {
        return;
      }

      event.preventDefault();
      el.scrollBy({ left: event.deltaY, behavior: "auto" });
    };

    updateScrollState();
    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: false });

    const observer = new ResizeObserver(() => updateScrollState());
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [tabs.length, updateScrollState]);

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

  const scrollTabsBy = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -220 : 220, behavior: "smooth" });
  };

  const toggleTabMenu = () => {
    if (tabMenuAnchorRef.current) {
      const rect = tabMenuAnchorRef.current.getBoundingClientRect();
      setTabMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 240) });
    }
    setShowTabMenu((prev) => !prev);
  };

  const hasOverflow = canScrollLeft || canScrollRight;

  return (
    <div
      ref={tabBarRef}
      className="no-drag flex h-[var(--tabbar-height)] shrink-0 items-center border-b border-border-default/50 bg-bg-secondary/30 px-2"
    >
      <div ref={scrollRef} className="flex flex-1 items-center gap-1 overflow-x-auto py-0.5 scrollbar-hide">
        <AnimatePresence mode="sync">
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

      {hasOverflow ? (
        <div className="mr-1 flex shrink-0 items-center gap-1 no-drag">
          <button
            onClick={() => scrollTabsBy("left")}
            disabled={!canScrollLeft}
            className="wb-icon-btn"
            title={t('tabBar.scrollLeft')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => scrollTabsBy("right")}
            disabled={!canScrollRight}
            className="wb-icon-btn"
            title={t('tabBar.scrollRight')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div ref={tabMenuAnchorRef}>
            <button
              onClick={toggleTabMenu}
              className={cn("wb-icon-btn", showTabMenu && "bg-bg-hover text-text-primary")}
              title={t('tabBar.allTabs')}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-1.5 h-4 w-px bg-border-strong/70" />
      <button
        onClick={() => onNewTab(createProtocol)}
        className="wb-ghost-btn shrink-0 px-3 no-drag"
        title={`${t('tabBar.new')} ${protocolLabels[createProtocol]} (Ctrl+N)`}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('tabBar.new')}
      </button>

      {showTabMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowTabMenu(false)} />
          <div
            className="fixed z-[221] w-[240px] overflow-hidden rounded-[12px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            style={{ top: tabMenuPos.top, left: tabMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('tabBar.allTabs')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {tabs.map((tab) => {
                const badgeLabel = tab.protocol === "http"
                  ? tab.requestMode && tab.requestMode !== "rest"
                    ? modeLabels[tab.requestMode]
                    : tab.method || protocolLabels[tab.protocol]
                  : protocolLabels[tab.protocol];
                const isActive = tab.id === activeTabId;

                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      onTabChange(tab.id);
                      setShowTabMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                      isActive && "bg-bg-hover/45"
                    )}
                  >
                    <span
                      className={cn(
                        "rounded-[5px] px-1.5 py-[1px] text-[var(--fs-xxs)] font-bold leading-none",
                        tab.protocol === "http"
                          ? tab.requestMode && tab.requestMode !== "rest"
                            ? modeBadgeColors[tab.requestMode]
                            : tab.method
                              ? methodBadgeColors[tab.method] || protocolColors[tab.protocol]
                              : protocolColors[tab.protocol]
                          : protocolColors[tab.protocol]
                      )}
                    >
                      {badgeLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--fs-sm)] font-medium text-text-primary">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
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

  const badgeColor = tab.protocol === "http"
    ? tab.requestMode && tab.requestMode !== "rest"
      ? modeBadgeColors[tab.requestMode]
      : tab.method
        ? methodBadgeColors[tab.method] || protocolColors[tab.protocol]
        : protocolColors[tab.protocol]
    : protocolColors[tab.protocol];

  return (
    <>
      <motion.div
        layoutId={tab.id}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.1 } }}
        transition={{ layout: { type: "spring", stiffness: 500, damping: 40 }, opacity: { duration: 0.12 }, scale: { duration: 0.12 } }}
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
          "group relative flex h-8 min-w-[112px] max-w-[228px] shrink-0 items-center gap-1.5 rounded-[9px] px-2 no-drag",
          "cursor-pointer transition-all duration-[var(--transition-fast)]",
          isActive
            ? "z-10 bg-bg-primary font-medium text-text-primary shadow-xs border border-border-default/50"
            : "bg-transparent text-text-tertiary hover:bg-bg-hover/60 hover:text-text-secondary",
          isDragOver && "ring-2 ring-accent/50"
        )}
      >
        <span className={cn("shrink-0 rounded-[4px] px-1.5 py-[3px] text-[var(--fs-xxs)] font-bold leading-none", badgeColor)}>
          {tab.protocol === "http"
            ? tab.requestMode && tab.requestMode !== "rest"
              ? modeLabels[tab.requestMode]
              : tab.method || protocolLabels[tab.protocol]
            : protocolLabels[tab.protocol]}
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
            className="min-w-0 flex-1 border-b border-accent bg-transparent px-0.5 py-0 text-[var(--fs-sm)] text-text-primary outline-none"
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--fs-sm)] leading-none">{tab.label}</span>
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
