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
import { CollectionSettingsPanel } from "@/components/collections/CollectionSettingsPanel";
import { useAppStore, type RequestProtocol, type ToolSession, type ToolWorkbench, type WorkbenchView } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { closeWindowByLabel, listOpenToolWindowSessions, openToolWindow } from "@/lib/windowManager";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UpdateChecker } from "@/components/settings/UpdateChecker";
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
  const activeDetached = activeSessionId ? detachedSessionIds.includes(activeSessionId) : false;
  const sessionScrollRef = useRef<HTMLDivElement>(null);
  const sessionMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [sessionMenuPos, setSessionMenuPos] = useState({ top: 0, left: 0 });

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
  }, [sessions.length, updateSessionScrollState]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-default/65 bg-bg-primary/38 px-3">
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <div className="flex h-7 items-center gap-2 rounded-[10px] border border-border-default/70 bg-bg-primary/85 px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.accentClassName)} />
            <div className="text-[12px] font-semibold text-text-primary">{t(meta.shortTitleKey)}</div>
          </div>
        </div>

        <div ref={sessionScrollRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-hide">
          {sessions.map((session, index) => {
            const isActive = session.id === activeSessionId;
            const isDetached = detachedSessionIds.includes(session.id);
            const label = session.customLabel?.trim() || `${t(meta.shortTitleKey)} ${index + 1}`;

            return (
              <div
                key={session.id}
                className={cn(
                  "group flex h-8 shrink-0 items-center gap-1 rounded-[9px] px-2 text-[12px] transition-colors",
                  isActive
                    ? "bg-accent/10 text-text-primary"
                    : "bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                )}
              >
                <button
                  onClick={() => onSelectSession(tool, session.id)}
                  className="flex min-w-0 items-center gap-1.5 rounded-[8px] px-1 py-1"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isActive ? meta.accentDotClassName : isDetached ? "bg-accent" : "bg-border-strong"
                    )}
                  />
                  <span className="truncate">{label}</span>
                  {isDetached ? <ArrowUpRight className="h-3 w-3 text-text-disabled" /> : null}
                </button>
                {sessions.length > 1 ? (
                  <button
                    onClick={() => onCloseSession(tool, session.id)}
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
            onClick={() => activeSessionId && onPopout(tool, activeSessionId)}
            disabled={!activeSessionId}
            className="wb-ghost-btn px-2.5"
            title={activeDetached ? t('toolWorkbench.focusWindow') : t('toolWorkbench.popoutWindow')}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {activeDetached ? t('toolWorkbench.focusWindow') : t('toolWorkbench.popoutWindow')}
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
            <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('toolWorkbench.allInstances')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {sessions.map((session, index) => {
                const label = session.customLabel?.trim() || `${t(meta.shortTitleKey)} ${index + 1}`;
                const isActive = session.id === activeSessionId;
                const isDetached = detachedSessionIds.includes(session.id);

                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      onSelectSession(tool, session.id);
                      setShowSessionMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                      isActive && "bg-bg-hover/45"
                    )}
                  >
                    <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", isActive ? meta.accentDotClassName : isDetached ? "bg-accent" : "bg-border-strong")} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">{label}</span>
                    {isDetached ? <ArrowUpRight className="h-3 w-3 text-text-disabled" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function App() {
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [detachedToolSessions, setDetachedToolSessions] = useState<Record<ToolWorkbench, string[]>>({
    tcpudp: [],
    capture: [],
    loadtest: [],
  });

  useKeyboardShortcuts();
  useSettingsEffect();
  useLanguageSync();

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
    if (workbench === "requests") {
      setActiveWorkbench("requests");
      if (activeCollectionId && !activeTabId) {
        closeCollectionPanel();
      }
      return;
    }

    openToolTab(workbench);
  }, [activeCollectionId, activeTabId, closeCollectionPanel, openToolTab, setActiveWorkbench]);

  const handlePopoutWorkbench = useCallback(async (tool: ToolWorkbench, sessionId: string) => {
    const detachedSessionId = await openToolWindow(tool, sessionId);
    setDetachedToolSessions((prev) => ({
      ...prev,
      [tool]: prev[tool].includes(detachedSessionId) ? prev[tool] : [...prev[tool], detachedSessionId],
    }));
  }, []);

  const handleOpenPlugins = useCallback(() => {
    setPluginModalOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setSidebarCollapsed(size.inPixels <= 50);
    if (size.asPercentage > 5) {
      useSettingsStore.getState().update("sidebarWidth", Math.round(size.asPercentage));
    }
  }, []);

  const handleSidebarToggle = useCallback(() => {
    const ref = sidebarPanelRef.current;
    if (ref) {
      ref.isCollapsed() ? ref.expand() : ref.collapse();
    }
  }, [sidebarPanelRef]);

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

  const renderRequestWorkspace = () => {
    if (activeCollectionId) {
      return <CollectionSettingsPanel collectionId={activeCollectionId} />;
    }

    if (!activeTab) {
      return <WelcomePage onAction={handleWelcomeAction} />;
    }

    switch (activeTab.protocol) {
      case "http":
        return <HttpWorkspace />;
      case "ws":
        return <WsWorkspace />;
      case "mqtt":
        return <MqttWorkspace />;
      default:
        return <WelcomePage onAction={handleWelcomeAction} />;
    }
  };

  const renderContent = () => {
    if (activeWorkbench === "requests") {
      return (
        <PanelGroup orientation="horizontal">
          <Panel
            id="sidebar"
            defaultSize={String(useSettingsStore.getState().settings.sidebarWidth || 22)}
            minSize="14"
            maxSize="50"
            collapsible
            collapsedSize="44px"
            panelRef={sidebarPanelRef}
            onResize={handleSidebarResize}
            className="relative flex h-full shrink-0 flex-col"
          >
            <Sidebar
              panelCollapsed={sidebarCollapsed}
              onTogglePanel={handleSidebarToggle}
            />
          </Panel>
          <PanelResizeHandle className="relative w-[1px] shrink-0 cursor-col-resize bg-border-default/70 transition-colors hover:bg-accent active:bg-accent" />

          <Panel className="flex flex-col overflow-hidden bg-transparent">
            <TabBar
              tabs={displayTabs}
              activeTabId={activeTabId}
              onTabChange={setActiveTab}
              onTabClose={closeTab}
              onNewTab={handleNewTab}
              onReorder={reorderTabs}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {renderRequestWorkspace()}
            </div>
          </Panel>
        </PanelGroup>
      );
    }

    if (activeWorkbench === "tcpudp") {
      return (
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
      );
    }

    if (activeWorkbench === "capture") {
      return (
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
      );
    }

    return (
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

  const detachedToolFlags: Record<ToolWorkbench, boolean> = {
    tcpudp: detachedToolSessions.tcpudp.length > 0,
    capture: detachedToolSessions.capture.length > 0,
    loadtest: detachedToolSessions.loadtest.length > 0,
  };

  return (
    <>
      <WindowScaffold
        header={(
          <TitleBar
            activeWorkbench={activeWorkbench}
            detachedTools={detachedToolFlags}
            onSelectWorkbench={(workbench) => {
              void handleSelectWorkbench(workbench);
            }}
            onPopoutWorkbench={(workbench) => {
              const sessionId = activeToolSessionIds[workbench] ?? openToolTab(workbench);
              void handlePopoutWorkbench(workbench, sessionId);
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
      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <UpdateChecker />
    </>
  );
}

export default App;
