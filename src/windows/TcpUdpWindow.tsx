import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";

export function TcpUdpWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="tcpudp" sessionId={sessionId} title="TCP / UDP 调试" module="tcpudp" accentClassName="bg-blue-500">
      <div className="h-full overflow-hidden bg-transparent">
        <TcpWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
