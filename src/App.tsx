import { useState, useCallback } from "react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar, type Tab } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { WelcomePage } from "@/components/WelcomePage";
import { HttpWorkspace } from "@/components/http/HttpWorkspace";
import { WsWorkspace } from "@/components/ws/WsWorkspace";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { useAppStore, type ProtocolType } from "@/stores/appStore";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";

function App() {
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Mount global keyboard shortcuts
  useKeyboardShortcuts();

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = useAppStore((s) => s.getActiveTab());
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);

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
    console.log("Open tool:", tool);
  }, []);

  const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    // Collapsed when size equals the icon rail width (48px)
    setSidebarCollapsed(size.inPixels <= 50);
  }, []);

  const handleSidebarToggle = useCallback(() => {
    const ref = sidebarPanelRef.current;
    if (ref) {
      ref.isCollapsed() ? ref.expand() : ref.collapse();
    }
  }, [sidebarPanelRef]);

  const renderWorkspace = () => {
    if (!activeTab) return <WelcomePage />;

    switch (activeTab.protocol) {
      case "http": return <HttpWorkspace />;
      case "ws": return <WsWorkspace />;
      case "tcp":
      case "udp": return <TcpWorkspace />;
      case "sse":
      case "mqtt":
        return (
          <div className="h-full flex items-center justify-center text-text-disabled">
            <div className="text-center">
              <p className="text-sm font-medium mb-1">{activeTab.protocol.toUpperCase()}</p>
              <p className="text-[11px]">🚧 开发中</p>
            </div>
          </div>
        );
      default: return <WelcomePage />;
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
      <TitleBar onOpenTool={handleOpenTool} />

      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="horizontal">
          <Panel
            id="sidebar"
            defaultSize="22"
            minSize="14"
            maxSize="50"
            collapsible
            collapsedSize="48px"
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
    </div>
  );
}

export default App;
