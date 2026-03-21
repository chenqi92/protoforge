import { useState, useCallback, useEffect } from "react";
import { ArrowUpRight, Gauge, Network, Radio } from "lucide-react";
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
import { SseWorkspace } from "@/components/sse/SseWorkspace";
import { MqttWorkspace } from "@/components/mqtt/MqttWorkspace";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";
import { PluginModal } from "@/components/plugins/PluginModal";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CollectionSettingsPanel } from "@/components/collections/CollectionSettingsPanel";
import { useAppStore, type RequestProtocol, type ToolWorkbench, type WorkbenchView } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isToolWindowOpen, openToolWindow } from "@/lib/windowManager";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UpdateChecker } from "@/components/settings/UpdateChecker";
import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { subscribeDockToolRequests } from "@/lib/toolDocking";

const toolWorkbenchMeta: Record<ToolWorkbench, { title: string; description: string; icon: typeof Network }> = {
  tcpudp: {
    title: "TCP/UDP 工作台",
    description: "Socket 调试、报文收发和连接状态都在这里完成。",
    icon: Network,
  },
  capture: {
    title: "网络抓包工作台",
    description: "代理监听、流量筛选和请求详情保持在同一套上下文里。",
    icon: Radio,
  },
  loadtest: {
    title: "压测工作台",
    description: "并发配置、运行监控和结果分析不再挤进请求 tab。",
    icon: Gauge,
  },
};

function ToolWorkbenchPanel({
  tool,
  onPopout,
  children,
}: {
  tool: ToolWorkbench;
  onPopout: (tool: ToolWorkbench) => void;
  children: React.ReactNode;
}) {
  const meta = toolWorkbenchMeta[tool];
  const Icon = meta.icon;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-default/65 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-border-default/75 bg-bg-primary/80 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">{meta.title}</div>
            <div className="text-[12px] text-text-tertiary">{meta.description}</div>
            <div className="mt-1 text-[11px] text-text-disabled">可点击右侧按钮，或直接拖动顶部工作台切换项弹出窗口。</div>
          </div>
        </div>

        <button
          onClick={() => onPopout(tool)}
          className="flex h-9 items-center gap-2 rounded-[12px] border border-border-default/75 bg-bg-primary/78 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          title="弹出为独立窗口"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          弹出窗口
        </button>
      </div>

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
  const addTab = useAppStore((s) => s.addTab);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveWorkbench = useAppStore((s) => s.setActiveWorkbench);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const closeCollectionPanel = useAppStore((s) => s.closeCollectionPanel);

  useEffect(() => {
    return subscribeDockToolRequests((tool) => {
      openToolTab(tool);
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
    modified: false,
  }));

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

    if (await isToolWindowOpen(workbench)) {
      await openToolWindow(workbench);
      return;
    }

    openToolTab(workbench);
  }, [activeCollectionId, activeTabId, closeCollectionPanel, openToolTab, setActiveWorkbench]);

  const handlePopoutWorkbench = useCallback(async (tool: ToolWorkbench) => {
    await openToolWindow(tool);
    setActiveWorkbench("requests");
  }, [setActiveWorkbench]);

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
      case "ws":
      case "sse":
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
  }, [addTab, handleSelectWorkbench]);

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
      case "sse":
        return <SseWorkspace />;
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
        <ToolWorkbenchPanel tool="tcpudp" onPopout={handlePopoutWorkbench}>
          <TcpWorkspace />
        </ToolWorkbenchPanel>
      );
    }

    if (activeWorkbench === "capture") {
      return (
        <ToolWorkbenchPanel tool="capture" onPopout={handlePopoutWorkbench}>
          <CaptureWorkspace />
        </ToolWorkbenchPanel>
      );
    }

    return (
      <ToolWorkbenchPanel tool="loadtest" onPopout={handlePopoutWorkbench}>
        <LoadTestWorkspace />
      </ToolWorkbenchPanel>
    );
  };

  const activeModule =
    activeWorkbench === "requests"
      ? activeCollectionId
        ? "collection"
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
            onPopoutWorkbench={(workbench) => {
              void handlePopoutWorkbench(workbench);
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
