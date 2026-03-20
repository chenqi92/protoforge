import { useState, useCallback, useEffect } from "react";
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
import { useAppStore, type WorkspaceProtocol } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { isToolWindowOpen, openToolWindow, type ToolWindowType } from "@/lib/windowManager";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UpdateChecker } from "@/components/settings/UpdateChecker";
import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { subscribeDockToolRequests } from "@/lib/toolDocking";

function App() {
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // Mount global keyboard shortcuts
  useKeyboardShortcuts();
  useSettingsEffect();
  useLanguageSync();


  // Listen for Ctrl+K command palette toggle
  useEffect(() => {
    const handler = () => setCmdPaletteOpen(v => !v);
    window.addEventListener('toggle-command-palette', handler);
    return () => window.removeEventListener('toggle-command-palette', handler);
  }, []);

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = useAppStore((s) => s.getActiveTab());
  const addTab = useAppStore((s) => s.addTab);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  useEffect(() => {
    return subscribeDockToolRequests((tool) => {
      openToolTab(tool);
    });
  }, [openToolTab]);

  const displayTabs: Tab[] = tabs.map((t) => ({
    id: t.id,
    label: t.customLabel?.trim()
      || (t.protocol === "http" && t.httpConfig?.name?.trim() && t.httpConfig.name !== "Untitled Request" ? t.httpConfig.name.trim() : "")
      || (t.protocol === "http" ? t.httpConfig?.url?.trim() : "")
      || t.label,
    protocol: t.protocol,
    method: t.protocol === "http" ? t.httpConfig?.method : undefined,
    detachableTool: t.protocol === "tcpudp" || t.protocol === "loadtest" || t.protocol === "capture"
      ? t.protocol
      : undefined,
    modified: false,
  }));

  const handleNewTab = useCallback((protocol?: WorkspaceProtocol) => {
    addTab(protocol || "http");
  }, [addTab]);

  const handleOpenTool = useCallback(async (tool: string) => {
    if (tool === "plugins") {
      setPluginModalOpen(true);
      return;
    }
    if (tool === "settings") {
      setSettingsOpen(true);
      return;
    }
    const toolWindows: string[] = ["capture", "loadtest", "tcpudp"];
    if (toolWindows.includes(tool)) {
      const toolType = tool as ToolWindowType;
      if (await isToolWindowOpen(toolType)) {
        await openToolWindow(toolType);
        return;
      }
      openToolTab(toolType);
    }
  }, [openToolTab]);

  const handleDetachToolTab = useCallback(async (id: string, tool: ToolWindowType) => {
    await openToolWindow(tool);
    closeTab(id);
  }, [closeTab]);

  const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    // Collapsed when size equals the icon rail width (48px)
    setSidebarCollapsed(size.inPixels <= 50);
    // Persist sidebar width
    if (size.asPercentage > 5) {
      useSettingsStore.getState().update('sidebarWidth', Math.round(size.asPercentage));
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
      case 'http': addTab('http'); break;
      case 'ws': addTab('ws'); break;
      case 'sse': addTab('sse'); break;
      case 'mqtt': addTab('mqtt'); break;
      case 'tcpudp': handleOpenTool('tcpudp'); break;
      case 'loadtest': handleOpenTool('loadtest'); break;
      case 'capture': handleOpenTool('capture'); break;
      case 'plugins': handleOpenTool('plugins'); break;
    }
  }, [addTab, handleOpenTool]);

  const renderWorkspace = () => {
    if (!activeTab) return <WelcomePage onAction={handleWelcomeAction} />;

    switch (activeTab.protocol) {
      case "http": return <HttpWorkspace />;
      case "ws": return <WsWorkspace />;
      case "collection": return <CollectionSettingsPanel collectionId={activeTab.collectionId!} />;
      case "sse": return <SseWorkspace />;
      case "mqtt": return <MqttWorkspace />;
      case "tcpudp": return <TcpWorkspace />;
      case "loadtest": return <LoadTestWorkspace />;
      case "capture": return <CaptureWorkspace />;
      default: return <WelcomePage onAction={handleWelcomeAction} />;
    }
  };

  return (
    <>
      <WindowScaffold
        header={<TitleBar onOpenTool={handleOpenTool} />}
        footer={(
          <StatusBar
            activeModule={activeTab?.protocol || "ready"}
            responseTime={activeTab?.httpResponse?.durationMs}
            responseSize={activeTab?.httpResponse?.bodySize}
          />
        )}
        bodyClassName="p-0"
      >
        <div className="h-full">
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
                onDetachTab={handleDetachToolTab}
                onReorder={reorderTabs}
              />

              <div className="flex-1 overflow-hidden">
                {renderWorkspace()}
              </div>
            </Panel>
          </PanelGroup>
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
