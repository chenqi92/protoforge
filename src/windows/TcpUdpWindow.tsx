import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { DEFAULT_TCP_TOOL_MODE } from "@/types/toolSession";
import type { SocketMode } from "@/types/tcp";

export function TcpUdpWindow() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [sessionId] = useState(() => params.get("session") ?? crypto.randomUUID());
  const [initialMode] = useState<SocketMode>(() => {
    const nextMode = params.get("tcpMode");
    const validModes: SocketMode[] = ["tcp-client", "tcp-server", "udp-client", "udp-server", "serial", "modbus", "modbus-slave"];
    return validModes.includes(nextMode as SocketMode) ? (nextMode as SocketMode) : DEFAULT_TCP_TOOL_MODE;
  });

  return (
    <ToolWindowShell tool="tcpudp" sessionId={sessionId} title="TCP / UDP 调试" module="tcpudp" accentClassName="bg-blue-500">
      <div className="h-full overflow-hidden bg-transparent">
        <TcpWorkspace sessionId={sessionId} initialMode={initialMode} />
      </div>
    </ToolWindowShell>
  );
}
