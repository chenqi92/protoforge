import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { MockServerWorkspace } from "@/components/mockserver/MockServerWorkspace";

export function MockServerWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="mockserver" sessionId={sessionId} title="模拟服务" module="mockserver" accentClassName="bg-green-500">
      <div className="h-full overflow-hidden bg-transparent">
        <MockServerWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
