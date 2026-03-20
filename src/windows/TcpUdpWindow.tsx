import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";

export function TcpUdpWindow() {
  return (
    <ToolWindowShell title="TCP / UDP 调试" module="tcpudp" accentClassName="bg-blue-500">
      <div className="h-full overflow-hidden bg-bg-primary/30">
        <TcpWorkspace />
      </div>
    </ToolWindowShell>
  );
}
