import { useState, useCallback, useEffect, useRef } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Gauge, List, Network, Plus, Radio, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsEffect } from "@/hooks/useSettingsEffect";
import { useLanguageSync } from "@/hooks/useLanguageSync";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar, type Tab } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { WelcomePage, type WelcomeAction } from "@/components/WelcomePage";
import { HttpWorkspace } from "@/components/http/HttpWorkspace";
import { WsWorkspace } from "@/components/ws/WsWorkspace";
import { MqttWorkspace } from "@/components/mqtt/MqttWorkspace";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";
import { PluginModal } from "@/components/plugins/PluginModal";
import { SettingsModal } from "@/components/settings/SettingsModal";
import EnvironmentVariablesModal from "@/components/modals/EnvironmentVariablesModal";
import { CollectionSettingsPanel } from "@/components/collections/CollectionSettingsPanel";
import { useAppStore, type RequestProtocol, type ToolSession, type ToolWorkbench, type WorkbenchView } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePluginStore } from "@/stores/pluginStore";
import { closeWindowByLabel, listOpenToolWindowSessions, openToolWindow } from "@/lib/windowManager";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UpdateChecker } from "@/components/settings/UpdateChecker";
import { CryptoContextMenu } from "@/components/plugins/CryptoContextMenu";

import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { subscribeDockToolRequests } from "@/lib/toolDocking";
import { cn } from "@/lib/utils";
import type { HttpRequestMode } from "@/types/http";

const toolWorkbenchMeta: Record<ToolWorkbench, {
  titleKey: string;
  shortTitleKey: string;
  descKey: string;
  icon: typeof Network;
  accentClassName: string;
  accentBorderClassName: string;
  accentDotClassName: string;
}> = {
  tcpudp: {
    titleKey: "toolWorkbench.tcpudp.title",
    shortTitleKey: "toolWorkbench.tcpudp.shortTitle",
    descKey: "toolWorkbench.tcpudp.description",
    icon: Network,
    accentClassName: "text-blue-600",
    accentBorderClassName: "border-blue-500",
    accentDotClassName: "bg-blue-500",
  },
  capture: {
    titleKey: "toolWorkbench.capture.title",
    shortTitleKey: "toolWorkbench.capture.shortTitle",
    descKey: "toolWorkbench.capture.description",
    icon: Radio,
    accentClassName: "text-cyan-600",
    accentBorderClassName: "border-cyan-500",
    accentDotClassName: "bg-cyan-500",
  },
  loadtest: {
    titleKey: "toolWorkbench.loadtest.title",
    shortTitleKey: "toolWorkbench.loadtest.shortTitle",
    descKey: "toolWorkbench.loadtest.description",
    icon: Gauge,
    accentClassName: "text-rose-600",
    accentBorderClassName: "border-rose-500",
    accentDotClassName: "bg-rose-500",
  },
};

function ToolWorkbenchPanel({
  tool,
  sessions,
  activeSessionId,
  detachedSessionIds,
  onAddSession,
  onSelectSession,
  onCloseSession,
  onPopout,
  children,
}: {
  tool: ToolWorkbench;
  sessions: ToolSession[];
  activeSessionId: string | null;
  detachedSessionIds: string[];
  onAddSession: (tool: ToolWorkbench) => void;
  onSelectSession: (tool: ToolWorkbench, sessionId: string) => void;
  onCloseSession: (tool: ToolWorkbench, sessionId: string) => void;
  onPopout: (tool: ToolWorkbench, sessionId: string) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const meta = toolWorkbenchMeta[tool];
  const Icon = meta.icon;

  // Filter out detached sessions from visible tab list
  const visibleSessions = sessions.filter((s) => !detachedSessionIds.includes(s.id));
  const activeVisible = activeSessionId && !detachedSessionIds.includes(activeSessionId);

  const sessionScrollRef = useRef<HTMLDivElement>(null);
  const sessionBarRef = useRef<HTMLDivElement>(null);
  const sessionMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [sessionMenuPos, setSessionMenuPos] = useState({ top: 0, left: 0 });

  // Drag-to-popout state for session tabs
  const dragStateRef = useRef<{
    sessionId: string | null;
    startX: number;
    startY: number;
    popped: boolean;
  }>({
    sessionId: null,
    startX: 0,
    startY: 0,
    popped: false,
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds.sessionId || ds.popped || !sessionBarRef.current) return;

      const movedX = Math.abs(event.clientX - ds.startX);
      const movedY = Math.abs(event.clientY - ds.startY);
      if (movedX < 18 && movedY < 18) return;

      const rect = sessionBarRef.current.getBoundingClientRect();
      const outside =
        event.clientX < rect.left - 24 ||
        event.clientX > rect.right + 24 ||
        event.clientY < rect.top - 18 ||
        event.clientY > rect.bottom + 24;

      if (!outside) return;

      ds.popped = true;
      onPopout(tool, ds.sessionId);
    };

    const clearDrag = () => {
      dragStateRef.current.sessionId = null;
      dragStateRef.current.popped = false;
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", clearDrag, true);
    window.addEventListener("blur", clearDrag);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", clearDrag, true);
      window.removeEventListener("blur", clearDrag);
    };
  }, [onPopout, tool]);

  const handleSessionTabMouseDown = (sessionId: string, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    dragStateRef.current = {
      sessionId,
      startX: event.clientX,
      startY: event.clientY,
      popped: false,
    };
  };

  const updateSessionScrollState = useCallback(() => {
    const el = sessionScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = sessionScrollRef.current;
    if (!el) return;

    const handleScroll = () => updateSessionScrollState();
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

    updateSessionScrollState();
    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: false });
    const observer = new ResizeObserver(() => updateSessionScrollState());
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [visibleSessions.length, updateSessionScrollState]);

  const hasOverflow = canScrollLeft || canScrollRight;
  const scrollSessionsBy = (direction: "left" | "right") => {
    const el = sessionScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -220 : 220, behavior: "smooth" });
  };

  const toggleSessionMenu = () => {
    if (sessionMenuAnchorRef.current) {
      const rect = sessionMenuAnchorRef.current.getBoundingClientRect();
      setSessionMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 220) });
    }
    setShowSessionMenu((prev) => !prev);
  };

  // Use a stable label counter that counts only within all sessions (not just visible)
  const sessionLabelMap = new Map<string, string>();
  sessions.forEach((session, index) => {
    sessionLabelMap.set(session.id, session.customLabel?.trim() || `${t(meta.shortTitleKey)} ${index + 1}`);
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div ref={sessionBarRef} className="flex h-11 shrink-0 items-center gap-3 border-b border-border-default/65 bg-bg-primary/38 px-3">
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <div className="flex h-7 items-center gap-2 rounded-[10px] border border-border-default/70 bg-bg-primary/85 px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.accentClassName)} />
            <div className="text-[var(--fs-sm)] font-semibold text-text-primary">{t(meta.shortTitleKey)}</div>
          </div>
        </div>

        <div ref={sessionScrollRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-hide">
          {visibleSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const label = sessionLabelMap.get(session.id) ?? session.id;

            return (
              <div
                key={session.id}
                onMouseDown={(e) => handleSessionTabMouseDown(session.id, e)}
                onClick={() => {
                  const ds = dragStateRef.current;
                  if (ds.popped && ds.sessionId === session.id) {
                    ds.sessionId = null;
                    ds.popped = false;
                    return;
                  }
                  onSelectSession(tool, session.id);
                }}
                className={cn(
                  "group flex h-8 shrink-0 cursor-grab items-center gap-1 rounded-[9px] px-2 text-[var(--fs-sm)] transition-colors",
                  isActive
                    ? "bg-accent/10 text-text-primary"
                    : "bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                )}
                title={t('toolWorkbench.dragToDetachSession')}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isActive ? meta.accentDotClassName : "bg-border-strong"
                  )}
                />
                <span className="truncate">{label}</span>
                {visibleSessions.length > 1 ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseSession(tool, session.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex h-4.5 w-4.5 items-center justify-center rounded-[6px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary"
                    title={t('tabBar.closeTab')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasOverflow ? (
            <>
              <button
                onClick={() => scrollSessionsBy("left")}
                disabled={!canScrollLeft}
                className="wb-icon-btn"
                title={t('tabBar.scrollLeft')}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => scrollSessionsBy("right")}
                disabled={!canScrollRight}
                className="wb-icon-btn"
                title={t('tabBar.scrollRight')}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <div ref={sessionMenuAnchorRef}>
                <button
                  onClick={toggleSessionMenu}
                  className={cn("wb-icon-btn", showSessionMenu && "bg-bg-hover text-text-primary")}
                  title={t('toolWorkbench.allInstances')}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : null}

          <button
            onClick={() => onAddSession(tool)}
            className="wb-ghost-btn px-2.5"
            title={t('toolWorkbench.newInstance')}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('toolWorkbench.newInstance')}
          </button>

          <button
            onClick={() => activeSessionId && activeVisible && onPopout(tool, activeSessionId)}
            disabled={!activeSessionId || !activeVisible}
            className="wb-ghost-btn px-2.5"
            title={t('toolWorkbench.popoutWindow')}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {t('toolWorkbench.popoutWindow')}
          </button>
        </div>
      </div>

      {showSessionMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowSessionMenu(false)} />
          <div
            className="fixed z-[221] w-[220px] overflow-hidden rounded-[12px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            style={{ top: sessionMenuPos.top, left: sessionMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('toolWorkbench.allInstances')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {sessions.map((session) => {
                const label = sessionLabelMap.get(session.id) ?? session.id;
                const isActive = session.id === activeSessionId;
                const isDetached = detachedSessionIds.includes(session.id);

                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      if (isDetached) {
                        // Focus the detached window instead
                        onPopout(tool, session.id);
                      } else {
                        onSelectSession(tool, session.id);
                      }
                      setShowSessionMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                      isActive && !isDetached && "bg-bg-hover/45"
                    )}
                  >
                    <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", isActive && !isDetached ? meta.accentDotClassName : isDetached ? "bg-accent" : "bg-border-strong")} />
                    <span className="min-w-0 flex-1 truncate text-[var(--fs-sm)] font-medium text-text-primary">{label}</span>
                    {isDetached ? <ArrowUpRight className="h-3 w-3 text-text-disabled" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {visibleSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
            <ArrowUpRight className="h-8 w-8 text-text-disabled" />
            <div className="text-[var(--fs-sm)]">{t('toolWorkbench.allSessionsDetached')}</div>
            <button
              onClick={() => onAddSession(tool)}
              className="wb-ghost-btn mt-1 px-3"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('toolWorkbench.newInstance')}
            </button>
          </div>
        ) : children}
      </div>
    </div>
  );
}

function App() {
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarDefaultSize = `${Math.max(useSettingsStore.getState().settings.sidebarWidth, 14)}%`;
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [detachedToolSessions, setDetachedToolSessions] = useState<Record<ToolWorkbench, string[]>>({
    tcpudp: [],
    capture: [],
    loadtest: [],
  });

  useKeyboardShortcuts();
  useSettingsEffect();
  useLanguageSync();

  // 启动时自动加载已安装的插件（确保渲染器 tab 等扩展点立即可用）
  const fetchInstalledPlugins = usePluginStore((s) => s.fetchInstalledPlugins);
  useEffect(() => {
    fetchInstalledPlugins();
  }, [fetchInstalledPlugins]);

  useEffect(() => {
    const handler = () => setCmdPaletteOpen((value) => !value);
    window.addEventListener("toggle-command-palette", handler);
    return () => window.removeEventListener("toggle-command-palette", handler);
  }, []);

  useEffect(() => {
    const openPlugins = () => setPluginModalOpen(true);
    const openSettings = () => setSettingsOpen(true);

    window.addEventListener("open-plugin-modal", openPlugins);
    window.addEventListener("open-settings-modal", openSettings);

    return () => {
      window.removeEventListener("open-plugin-modal", openPlugins);
      window.removeEventListener("open-settings-modal", openSettings);
    };
  }, []);

  // 监听 macOS 菜单「检查更新」事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('check-for-updates', () => {
          import('@/stores/updateStore').then(({ useUpdateStore: store }) => {
            store.getState().checkForUpdate();
          });
        });
      } catch {
        // 非 Tauri 环境忽略
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = useAppStore((s) => s.getActiveTab());
  const activeWorkbench = useAppStore((s) => s.activeWorkbench);
  const activeCollectionId = useAppStore((s) => s.activeCollectionId);
  const toolSessions = useAppStore((s) => s.toolSessions);
  const activeToolSessionIds = useAppStore((s) => s.activeToolSessionIds);
  const addTab = useAppStore((s) => s.addTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const addToolSession = useAppStore((s) => s.addToolSession);
  const setActiveToolSession = useAppStore((s) => s.setActiveToolSession);
  const closeToolSession = useAppStore((s) => s.closeToolSession);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveWorkbench = useAppStore((s) => s.setActiveWorkbench);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const closeCollectionPanel = useAppStore((s) => s.closeCollectionPanel);

  const refreshDetachedTools = useCallback(async () => {
    const toolKeys: ToolWorkbench[] = ["tcpudp", "capture", "loadtest"];
    const states = await Promise.all(
      toolKeys.map(async (tool) => [tool, await listOpenToolWindowSessions(tool)] as const)
    );

    setDetachedToolSessions({
      tcpudp: states.find(([tool]) => tool === "tcpudp")?.[1] ?? [],
      capture: states.find(([tool]) => tool === "capture")?.[1] ?? [],
      loadtest: states.find(([tool]) => tool === "loadtest")?.[1] ?? [],
    });
  }, []);

  useEffect(() => {
    void refreshDetachedTools();

    const handleFocus = () => {
      void refreshDetachedTools();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshDetachedTools();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshDetachedTools]);

  useEffect(() => {
    return subscribeDockToolRequests(({ tool, sessionId, sourceLabel }) => {
      openToolTab(tool, sessionId);
      setDetachedToolSessions((prev) => ({
        ...prev,
        [tool]: prev[tool].filter((item) => item !== sessionId),
      }));
      if (sourceLabel) {
        void closeWindowByLabel(sourceLabel);
      }
    });
  }, [openToolTab]);

  // 接口调试视图下，关闭所有 tab 后自动新建一个空 HTTP 请求
  useEffect(() => {
    if (activeWorkbench === "requests" && tabs.length === 0 && !activeCollectionId) {
      addTab("http");
    }
  }, [activeWorkbench, tabs.length, activeCollectionId, addTab]);

  const displayTabs: Tab[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.customLabel?.trim()
      || (tab.protocol === "http" && tab.httpConfig?.name?.trim() && tab.httpConfig.name !== "Untitled Request" ? tab.httpConfig.name.trim() : "")
      || (tab.protocol === "http" ? tab.httpConfig?.url?.trim() : "")
      || tab.label,
    protocol: tab.protocol,
    method: tab.protocol === "http" ? tab.httpConfig?.method : undefined,
    requestMode: tab.protocol === "http" ? tab.httpConfig?.requestMode : undefined,
    modified: false,
  }));

  const createHttpModeTab = useCallback((mode: HttpRequestMode) => {
    const tabId = addTab("http");
    updateHttpConfig(tabId, {
      requestMode: mode,
      name: mode === "graphql" ? "GraphQL Request" : mode === "sse" ? "SSE Stream" : "Untitled Request",
      method: mode === "graphql" ? "POST" : "GET",
    });
    return tabId;
  }, [addTab, updateHttpConfig]);

  const handleNewTab = useCallback((protocol?: RequestProtocol) => {
    addTab(protocol || "http");
  }, [addTab]);

  const handleSelectWorkbench = useCallback(async (workbench: WorkbenchView) => {
    if (workbench === "home") {
      setActiveWorkbench("home");
      return;
    }
    if (workbench === "requests") {
      setActiveWorkbench("requests");
      if (activeCollectionId && !activeTabId) {
        closeCollectionPanel();
      }
      // 如果接口调试视图没有任何 tab，自动创建一个空请求
      if (tabs.length === 0 && !activeCollectionId) {
        addTab("http");
      }
      return;
    }

    openToolTab(workbench);
  }, [activeCollectionId, activeTabId, closeCollectionPanel, openToolTab, setActiveWorkbench, tabs, addTab]);

  const handlePopoutWorkbench = useCallback(async (tool: ToolWorkbench, sessionId: string) => {
    const detachedSessionId = await openToolWindow(tool, sessionId);
    setDetachedToolSessions((prev) => {
      const nextDetached = prev[tool].includes(detachedSessionId) ? prev[tool] : [...prev[tool], detachedSessionId];

      // Auto-switch to next visible session if the popped-out one was active
      const currentActiveId = useAppStore.getState().activeToolSessionIds[tool];
      if (currentActiveId === detachedSessionId) {
        const sessions = useAppStore.getState().toolSessions[tool];
        const nextVisible = sessions.find((s) => !nextDetached.includes(s.id));
        if (nextVisible) {
          useAppStore.getState().setActiveToolSession(tool, nextVisible.id);
        }
      }

      return {
        ...prev,
        [tool]: nextDetached,
      };
    });
  }, []);

  const handleOpenPlugins = useCallback(() => {
    setPluginModalOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setSidebarCollapsed(size.inPixels <= 52);
    if (size.asPercentage > 5) {
      useSettingsStore.getState().update("sidebarWidth", Math.round(size.asPercentage));
    }
  }, []);

  const handleSidebarToggle = useCallback(() => {
    const ref = sidebarPanelRef.current;
    if (!ref) return;
    if (sidebarCollapsed) {
      // 展开：先退出 collapsed 状态，再 resize 到已保存的宽度
      ref.expand();
      const width = useSettingsStore.getState().settings.sidebarWidth;
      // 必须传字符串，数字会被解释为像素而非百分比
      ref.resize(`${Math.max(width, 14)}%`);
    } else {
      ref.collapse();
    }
  }, [sidebarPanelRef, sidebarCollapsed]);

  const handleWelcomeAction = useCallback((action: WelcomeAction) => {
    switch (action) {
      case "http":
        addTab(action);
        break;
      case "graphql":
        createHttpModeTab("graphql");
        break;
      case "sse":
        createHttpModeTab("sse");
        break;
      case "ws":
      case "mqtt":
        addTab(action);
        break;
      case "tcpudp":
      case "loadtest":
      case "capture":
        void handleSelectWorkbench(action);
        break;
      case "plugins":
        setPluginModalOpen(true);
        break;
    }
  }, [addTab, createHttpModeTab, handleSelectWorkbench]);



  const renderContent = () => {
    return (
      <div className="h-full">
        {/* Home 视图 — 全屏渲染 WelcomePage，无侧边栏 */}
        <div className={cn("h-full", activeWorkbench === "home" ? "block" : "hidden")}>
          <WelcomePage onAction={handleWelcomeAction} />
        </div>

        <div className={cn("h-full", activeWorkbench === "requests" ? "block" : "hidden")}>
          <PanelGroup orientation="horizontal">
            <Panel
              id="sidebar"
              defaultSize={sidebarDefaultSize}
              minSize="14%"
              maxSize="50%"
              collapsible
              collapsedSize="48px"
              panelRef={sidebarPanelRef}
              onResize={handleSidebarResize}
              className="relative flex h-full shrink-0 flex-col"
            >
              <Sidebar
                panelCollapsed={sidebarCollapsed}
                onTogglePanel={handleSidebarToggle}
                onOpenEnvModal={() => setEnvModalOpen(true)}
              />
            </Panel>
            <PanelResizeHandle className="relative w-[1px] shrink-0 cursor-col-resize bg-border-default/60 transition-colors hover:bg-text-disabled" />

            <Panel className="flex flex-col overflow-hidden bg-transparent">
              <TabBar
                tabs={displayTabs}
                activeTabId={activeTabId}
                onTabChange={setActiveTab}
                onTabClose={closeTab}
                onNewTab={handleNewTab}
                onReorder={reorderTabs}
              />

              <div className="min-h-0 flex-1 overflow-hidden relative">
                <div className={cn("absolute inset-0 z-10 bg-bg-primary", activeCollectionId ? "block" : "hidden")}>
                  {activeCollectionId && <CollectionSettingsPanel collectionId={activeCollectionId} />}
                </div>

                {tabs.map((tab) => {
                  const isActive = !activeCollectionId && activeTabId === tab.id;
                  return (
                    <div key={tab.id} className={cn("absolute inset-0 bg-bg-primary", isActive ? "block" : "hidden")}>
                      {tab.protocol === "http" && <HttpWorkspace tabId={tab.id} />}
                      {tab.protocol === "ws" && <WsWorkspace />}
                      {tab.protocol === "mqtt" && <MqttWorkspace tabId={tab.id} />}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </PanelGroup>
        </div>

        <div className={cn("h-full", activeWorkbench === "tcpudp" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="tcpudp"
            sessions={toolSessions.tcpudp}
            activeSessionId={activeToolSessionIds.tcpudp}
            detachedSessionIds={detachedToolSessions.tcpudp}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.tcpudp.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.tcpudp ? "block" : "hidden")}
              >
                <TcpWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full", activeWorkbench === "capture" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="capture"
            sessions={toolSessions.capture}
            activeSessionId={activeToolSessionIds.capture}
            detachedSessionIds={detachedToolSessions.capture}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.capture.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.capture ? "block" : "hidden")}
              >
                <CaptureWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full", activeWorkbench === "loadtest" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="loadtest"
            sessions={toolSessions.loadtest}
            activeSessionId={activeToolSessionIds.loadtest}
            detachedSessionIds={detachedToolSessions.loadtest}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.loadtest.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.loadtest ? "block" : "hidden")}
              >
                <LoadTestWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>
      </div>
    );
  };

  const activeModule =
    activeWorkbench === "requests"
      ? activeCollectionId
        ? "collection"
        : activeTab?.protocol === "http" && activeTab.httpConfig?.requestMode && activeTab.httpConfig.requestMode !== "rest"
          ? activeTab.httpConfig.requestMode
          : activeTab?.protocol || "requests"
      : activeWorkbench;

  return (
    <>
      <WindowScaffold
        header={(
          <TitleBar
            activeWorkbench={activeWorkbench}
            onSelectWorkbench={(workbench) => {
              void handleSelectWorkbench(workbench);
            }}
            onOpenPlugins={handleOpenPlugins}
            onOpenSettings={handleOpenSettings}
          />
        )}
        footer={(
          <StatusBar
            activeModule={activeModule}
            responseTime={activeWorkbench === "requests" ? activeTab?.httpResponse?.durationMs : undefined}
            responseSize={activeWorkbench === "requests" ? activeTab?.httpResponse?.bodySize : undefined}
          />
        )}
        bodyClassName="p-0"
      >
        <div className="h-full">
          {renderContent()}
        </div>
      </WindowScaffold>

      <PluginModal open={pluginModalOpen} onClose={() => setPluginModalOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EnvironmentVariablesModal open={envModalOpen} onClose={() => setEnvModalOpen(false)} />
      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <UpdateChecker />
      <CryptoContextMenu />

    </>
  );
}

export default App;
