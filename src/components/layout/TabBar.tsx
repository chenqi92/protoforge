import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ChevronLeft, ChevronRight, X, Copy, Trash2, Edit3, ArrowRightFromLine, List, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { RequestProtocol } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import type { HttpRequestMode } from "@/types/http";
// Lazy — keeps Monaco editor (4MB+) out of the initial bundle; loads only when user opens diff modal
const RequestDiffModal = lazy(() => import("@/components/request/RequestDiffModal").then((m) => ({ default: m.RequestDiffModal })));

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
  grpc: "gRPC",
};

const protocolColors: Record<RequestProtocol, string> = {
  http: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ws: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  mqtt: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  grpc: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
};

const modeBadgeColors: Record<HttpRequestMode, string> = {
  rest: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  graphql: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  sse: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

const modeLabels: Record<HttpRequestMode, string> = {
  rest: "HTTP",
  graphql: "GraphQL",
  sse: "SSE",
};

const methodBadgeColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  POST: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PUT: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-300",
  PATCH: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  HEAD: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  OPTIONS: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
};

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onReorder }: TabBarProps) {
  const { t } = useTranslation();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTabCount = useRef(tabs.length);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const tabMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0 });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const createProtocol: RequestProtocol = "http";
  const [diffTabId, setDiffTabId] = useState<string | null>(null);

  const registerTabRef = useCallback((tabId: string, node: HTMLDivElement | null) => {
    if (node) {
      tabRefs.current.set(tabId, node);
      return;
    }

    tabRefs.current.delete(tabId);
  }, []);

  const ensureTabVisible = useCallback((tabId: string, behavior: ScrollBehavior = "smooth") => {
    const tabElement = tabRefs.current.get(tabId);
    if (!tabElement) return;

    tabElement.scrollIntoView({
      behavior,
      block: "nearest",
      inline: "nearest",
    });
  }, []);

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
    if (!activeTabId) return;

    requestAnimationFrame(() => {
      ensureTabVisible(activeTabId);
      updateScrollState();
    });

    const timer = window.setTimeout(() => {
      ensureTabVisible(activeTabId, "auto");
      updateScrollState();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTabId, ensureTabVisible, updateScrollState]);

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
      data-contextmenu-zone="tabbar"
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
              registerRef={registerTabRef}
              onCompare={tab.protocol === "http" ? () => setDiffTabId(tab.id) : undefined}
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
            className="fixed z-[221] w-[240px] overflow-hidden pf-rounded-md border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08),0_2px_4px_-2px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl"
            style={{ top: tabMenuPos.top, left: tabMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-disabled">
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
                      "flex w-full items-center gap-2 pf-rounded-md px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                      isActive && "bg-bg-hover/45"
                    )}
                  >
                    <span
                      className={cn(
                        "pf-rounded-xs px-1.5 py-[1px] pf-text-xxs font-bold leading-none",
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
                    <span className="min-w-0 flex-1 truncate pf-text-sm font-medium text-text-primary">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {diffTabId && (
        <Suspense fallback={null}>
          <RequestDiffModal
            open
            onClose={() => setDiffTabId(null)}
            sourceTabId={diffTabId}
          />
        </Suspense>
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
  registerRef,
  onCompare,
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
  registerRef: (tabId: string, node: HTMLDivElement | null) => void;
  onCompare?: () => void;
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
      ...(tab.protocol === "http" && onCompare ? [{
        id: "compare",
        label: t('diff.compareWith'),
        icon: <GitCompareArrows className="h-3.5 w-3.5" />,
        onClick: onCompare,
      } as ContextMenuEntry] : []),
      { type: "divider" as const },
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
        ref={(node) => registerRef(tab.id, node)}
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
          "group relative flex h-8 min-w-[112px] max-w-[228px] shrink-0 items-center gap-1.5 pf-rounded-sm px-2 no-drag",
          "cursor-pointer transition-all duration-[var(--transition-fast)]",
          isActive
            ? "z-10 bg-bg-primary font-medium text-text-primary shadow-xs border border-border-default/50"
            : "bg-transparent text-text-tertiary hover:bg-bg-hover/60 hover:text-text-secondary",
          isDragOver && "ring-2 ring-accent"
        )}
      >
        <span className={cn(
          "shrink-0 pf-rounded-xs px-1.5 py-[3px] pf-text-xxs font-bold leading-none",
          badgeColor,
          !isActive && "opacity-60"
        )}>
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
            className="min-w-0 flex-1 border-b border-accent bg-transparent px-0.5 py-0 pf-text-sm text-text-primary outline-none"
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate pf-text-sm leading-none">{tab.label}</span>
        )}

        <button
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center pf-rounded-xs transition-colors",
            isActive
              ? "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              : "text-text-disabled/40 hover:text-text-primary hover:bg-bg-hover group-hover:text-text-disabled"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </motion.div>
      {MenuComponent}
    </>
  );
}
