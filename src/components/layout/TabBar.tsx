import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Database,
  Edit3,
  Gauge,
  GitCompareArrows,
  Globe,
  List,
  type LucideIcon,
  Network,
  PanelLeft,
  Plus,
  Radio,
  Server,
  Trash2,
  Video,
  Waves,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { RequestProtocol, UnifiedTab } from "@/stores/appStore";
import { useAppStore } from "@/stores/appStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
// Lazy — keeps Monaco editor (4MB+) out of the initial bundle; loads only when user opens diff modal
const RequestDiffModal = lazy(() => import("@/components/request/RequestDiffModal").then((m) => ({ default: m.RequestDiffModal })));

const KIND_ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  wifi: Wifi,
  radio: Radio,
  network: Network,
  server: Server,
  database: Database,
  video: Video,
  gauge: Gauge,
  waves: Waves,
  wrench: Wrench,
  zap: Zap,
};

/** Maps an http method to the .pf-mtag modifier class. */
function methodClass(method?: string): string {
  if (!method) return "m-get";
  return `m-${method.toLowerCase()}`;
}

interface TabBarProps {
  tabs: UnifiedTab[];
  activeTabId: string | null;
  /** Select any unified context (request or tool session). */
  onSelect: (tab: UnifiedTab) => void;
  /** Close any unified context. */
  onClose: (tab: UnifiedTab) => void;
  /** Pop a context out to a real OS window (tool contexts only). */
  onPopout: (tab: UnifiedTab) => void;
  onNewTab: (protocol?: RequestProtocol) => void;
  /** Reorder the underlying request tabs (tool sessions are not reorderable). */
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Sidebar toggle (⌘B). */
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  /** Split-view toggle (⌘\). */
  onToggleSplit: () => void;
  splitActive: boolean;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onPopout,
  onNewTab,
  onReorder,
  onToggleSidebar,
  sidebarCollapsed,
  onToggleSplit,
  splitActive,
}: TabBarProps) {
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
    tabElement.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
  }, []);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
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
    return () => window.clearTimeout(timer);
  }, [activeTabId, ensureTabVisible, updateScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => updateScrollState();
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
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

  // Maps a UNIFIED-strip index to the index within the request-tabs-only array
  // (which is what onReorder→reorderTabs operates on). Request tabs are contiguous
  // at the front of the unified strip, so the request-tab index is the count of
  // request tabs before it. Returns -1 when the tab at that index isn't a request.
  const toRequestIndex = (unifiedIndex: number): number => {
    if (tabs[unifiedIndex]?.kind !== "request") return -1;
    let requestIndex = 0;
    for (let i = 0; i < unifiedIndex; i++) {
      if (tabs[i].kind === "request") requestIndex++;
    }
    return requestIndex;
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };
  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverIndex(index);
  };
  const handleDrop = (index: number) => {
    const from = dragIndexRef.current;
    // Only reorder when BOTH the dragged and target tabs are request tabs;
    // tool sessions are not reorderable and would splice garbage into the array.
    if (
      from !== null &&
      from !== index &&
      onReorder &&
      tabs[from]?.kind === "request" &&
      tabs[index]?.kind === "request"
    ) {
      const fromReq = toRequestIndex(from);
      const toReq = toRequestIndex(index);
      if (fromReq >= 0 && toReq >= 0) onReorder(fromReq, toReq);
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
      className="no-drag flex h-[var(--tabbar-height)] shrink-0 items-stretch border-b border-border-default bg-bg-primary pl-1"
    >
      {/* Sidebar toggle (⌘B) */}
      <button
        onClick={onToggleSidebar}
        className={cn(
          "flex w-7 shrink-0 items-center justify-center self-center pf-rounded-sm transition-colors",
          sidebarCollapsed
            ? "bg-accent-soft text-accent"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        )}
        title={`${t('sidebar.collections')} (⌘B)`}
        aria-pressed={!sidebarCollapsed}
      >
        <PanelLeft className="h-3.5 w-3.5" />
      </button>

      <div ref={scrollRef} className="flex flex-1 items-stretch overflow-x-auto scrollbar-hide">
        <AnimatePresence mode="sync">
          {tabs.map((tab, index) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isDragOver={dragOverIndex === index}
              draggable={tab.kind === "request"}
              totalTabs={tabs.length}
              onClick={() => onSelect(tab)}
              onClose={() => onClose(tab)}
              onPopout={() => onPopout(tab)}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              registerRef={registerTabRef}
              onCompare={tab.kind === "request" && tab.protocol === "http" && tab.tabId ? () => setDiffTabId(tab.tabId!) : undefined}
            />
          ))}
        </AnimatePresence>
      </div>

      {hasOverflow ? (
        <div className="flex shrink-0 items-center gap-0.5 self-center px-1 no-drag">
          <button onClick={() => scrollTabsBy("left")} disabled={!canScrollLeft} className="flex h-7 w-7 items-center justify-center pf-rounded-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40" title={t('tabBar.scrollLeft')}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => scrollTabsBy("right")} disabled={!canScrollRight} className="flex h-7 w-7 items-center justify-center pf-rounded-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40" title={t('tabBar.scrollRight')}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div ref={tabMenuAnchorRef}>
            <button
              onClick={toggleTabMenu}
              className={cn(
                "flex h-7 w-7 items-center justify-center pf-rounded-sm transition-colors",
                showTabMenu ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
              )}
              title={t('tabBar.allTabs')}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Trailing actions — left-bordered group (Forge .tabbar-actions) */}
      <div className="ml-auto flex shrink-0 items-center gap-px self-stretch border-l border-border-default px-1.5 no-drag">
        <button
          onClick={() => onNewTab("http")}
          className="flex h-7 w-7 items-center justify-center self-center pf-rounded-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          title={`${t('tabBar.new')} (⌘N)`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onToggleSplit}
          className={cn(
            "flex h-7 w-7 items-center justify-center self-center pf-rounded-sm transition-colors",
            splitActive ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
          )}
          title={`${splitActive ? t('tabBar.closeRight') : t('tabBar.new')} (⌘\\)`}
          aria-pressed={splitActive}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showTabMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowTabMenu(false)} />
          <div
            className="fixed z-[221] w-[240px] overflow-hidden rounded-[9px] border border-border-strong bg-bg-elevated p-1 shadow-lg"
            style={{ top: tabMenuPos.top, left: tabMenuPos.left }}
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-text-tertiary">
              {t('tabBar.allTabs')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const Icon = KIND_ICONS[tab.icon] ?? Globe;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      onSelect(tab);
                      setShowTabMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] text-left transition-colors",
                      isActive ? "bg-accent-soft text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    )}
                  >
                    <span className={cn("pf-dot", `s-${tab.state}`)} />
                    {tab.kind === "request" && tab.protocol === "http" ? (
                      <span className={cn("pf-mtag", methodClass(tab.method))}>{tab.method ?? "GET"}</span>
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    )}
                    <span className="min-w-0 flex-1 truncate pf-text-xs font-medium">{tab.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {diffTabId && (
        <Suspense fallback={null}>
          <RequestDiffModal open onClose={() => setDiffTabId(null)} sourceTabId={diffTabId} />
        </Suspense>
      )}
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  isDragOver,
  draggable,
  totalTabs,
  onClick,
  onClose,
  onPopout,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  registerRef,
  onCompare,
}: {
  tab: UnifiedTab;
  isActive: boolean;
  isDragOver: boolean;
  draggable: boolean;
  totalTabs: number;
  onClick: () => void;
  onClose: () => void;
  onPopout: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  registerRef: (tabId: string, node: HTMLDivElement | null) => void;
  onCompare?: () => void;
}) {
  const { t } = useTranslation();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.title);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const renameTab = useAppStore((s) => s.renameTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const { showMenu, MenuComponent } = useContextMenu();

  const isRequest = tab.kind === "request";
  const canRename = isRequest && !!tab.tabId;
  const Icon = KIND_ICONS[tab.icon] ?? Globe;

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (!canRename) return;
    event.preventDefault();
    event.stopPropagation();
    setRenameValue(tab.title);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.title && tab.tabId) {
      renameTab(tab.tabId, trimmed);
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
    const items: ContextMenuEntry[] = [];

    if (canRename) {
      items.push(
        {
          id: "rename",
          label: t('contextMenu.rename'),
          icon: <Edit3 className="h-3.5 w-3.5" />,
          onClick: () => {
            setRenameValue(tab.title);
            setIsRenaming(true);
            setTimeout(() => renameInputRef.current?.select(), 0);
          },
        },
        {
          id: "duplicate",
          label: t('tabBar.duplicate'),
          icon: <Copy className="h-3.5 w-3.5" />,
          onClick: () => tab.tabId && duplicateTab(tab.tabId),
        },
      );
      if (tab.protocol === "http" && onCompare) {
        items.push({
          id: "compare",
          label: t('diff.compareWith'),
          icon: <GitCompareArrows className="h-3.5 w-3.5" />,
          onClick: onCompare,
        });
      }
    }

    if (tab.kind === "tool") {
      items.push({
        id: "popout",
        label: t('toolWorkbench.popoutWindow'),
        icon: <ArrowUpRight className="h-3.5 w-3.5" />,
        onClick: onPopout,
      });
    }

    if (items.length > 0) items.push({ type: "divider" });

    items.push({ id: "close", label: t('tabBar.close'), shortcut: "Ctrl+W", onClick: onClose });

    if (canRename && tab.tabId) {
      items.push(
        { id: "close-others", label: t('tabBar.closeOthers'), onClick: () => closeOtherTabs(tab.tabId!), disabled: totalTabs <= 1 },
        { id: "close-right", label: t('tabBar.closeRight'), onClick: () => closeTabsToRight(tab.tabId!) },
        { type: "divider" },
        { id: "delete", label: t('contextMenu.delete'), icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onClick: onClose },
      );
    }

    showMenu(event, items);
  };

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
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cn(
          "group relative flex h-full min-w-[130px] max-w-[210px] shrink-0 items-center gap-[7px] border-r border-border-default pl-[11px] pr-[9px] no-drag",
          "cursor-pointer transition-colors duration-[var(--transition-fast)]",
          isActive
            ? "z-10 bg-bg-app font-medium text-text-primary"
            : "bg-transparent text-text-secondary hover:bg-bg-hover",
          isDragOver && "shadow-[inset_2px_0_0_var(--color-accent)]"
        )}
      >
        {/* active top accent line (Forge .tab.on::after) */}
        {isActive ? (
          <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />
        ) : null}

        <span className={cn("pf-dot shrink-0", `s-${tab.state}`)} />

        {isRequest && tab.protocol === "http" ? (
          <span className={cn("pf-mtag shrink-0", methodClass(tab.method), !isActive && "opacity-70")}>
            {tab.method ?? "GET"}
          </span>
        ) : (
          <Icon className={cn("h-3.5 w-3.5 shrink-0 text-text-tertiary", !isActive && "opacity-70")} />
        )}

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
                setRenameValue(tab.title);
                setIsRenaming(false);
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 border-b border-accent bg-transparent px-0.5 py-0 pf-text-xs text-text-primary outline-none"
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate pf-text-xs leading-none">{tab.title}</span>
        )}

        {tab.kind === "tool" ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onPopout();
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-text-tertiary opacity-0 transition-colors hover:bg-bg-active hover:text-text-primary group-hover:opacity-100"
            title={t('toolWorkbench.popoutWindow')}
          >
            <ArrowUpRight className="h-[11px] w-[11px]" />
          </button>
        ) : null}

        <button
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-bg-active hover:text-text-primary",
            isActive ? "text-text-tertiary" : "text-text-tertiary/50 group-hover:text-text-tertiary"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </motion.div>
      {MenuComponent}
    </>
  );
}
