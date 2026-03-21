import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";

export function LoadTestWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="loadtest" sessionId={sessionId} title="HTTP 压力测试" module="loadtest" accentClassName="bg-rose-500">
      <div className="h-full overflow-hidden bg-transparent">
        <LoadTestWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
