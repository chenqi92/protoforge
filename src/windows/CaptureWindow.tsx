import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";

export function CaptureWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="capture" sessionId={sessionId} title="网络抓包" module="capture" accentClassName="bg-orange-500">
      <div className="h-full overflow-hidden bg-transparent">
        <CaptureWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
