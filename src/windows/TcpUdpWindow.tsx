import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";

export function TcpUdpWindow() {
  return (
    <ToolWindowShell tool="tcpudp" title="TCP / UDP 调试" module="tcpudp" accentClassName="bg-blue-500">
      <div className="h-full overflow-hidden bg-transparent">
        <TcpWorkspace />
      </div>
    </ToolWindowShell>
  );
}
