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
import { PluginModal } from "@/components/plugins/PluginModal";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CollectionSettingsPanel } from "@/components/collections/CollectionSettingsPanel";
import { useAppStore, type ProtocolType } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { openToolWindow, type ToolWindowType } from "@/lib/windowManager";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UpdateChecker } from "@/components/settings/UpdateChecker";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";

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
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  const displayTabs: Tab[] = tabs.map((t) => ({
    id: t.id,
    label: t.httpConfig?.name || t.httpConfig?.url || t.label,
    protocol: t.protocol,
    method: t.protocol === "http" ? t.httpConfig?.method : undefined,
    modified: false,
  }));

  const handleNewTab = useCallback((protocol?: ProtocolType) => {
    addTab(protocol || "http");
  }, [addTab]);

  const handleProtocolChange = useCallback((id: string, protocol: ProtocolType) => {
    setTabProtocol(id, protocol);
  }, [setTabProtocol]);

  const handleOpenTool = useCallback((tool: string) => {
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
      openToolWindow(tool as ToolWindowType);
    }
  }, []);

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
      default: return <WelcomePage onAction={handleWelcomeAction} />;
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
      <TitleBar onOpenTool={handleOpenTool} />

      <div className="flex-1 overflow-hidden">
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
            className="flex flex-col h-full shrink-0 relative"
          >
            <Sidebar
              panelCollapsed={sidebarCollapsed}
              onTogglePanel={handleSidebarToggle}
            />
          </Panel>
          <PanelResizeHandle className="w-[1px] bg-border-default relative shrink-0 cursor-col-resize hover:bg-accent active:bg-accent transition-colors" />

          <Panel className="flex flex-col overflow-hidden bg-bg-primary">
            <TabBar
              tabs={displayTabs}
              activeTabId={activeTabId}
              onTabChange={setActiveTab}
              onTabClose={closeTab}
              onNewTab={handleNewTab}
              onProtocolChange={handleProtocolChange}
              onReorder={reorderTabs}
            />

            <div className="flex-1 overflow-hidden">
              {renderWorkspace()}
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar
        activeModule={activeTab?.protocol || "ready"}
        responseTime={activeTab?.httpResponse?.durationMs}
        responseSize={activeTab?.httpResponse?.bodySize}
      />

      <PluginModal open={pluginModalOpen} onClose={() => setPluginModalOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <UpdateChecker />
    </div>
  );
}

export default App;
