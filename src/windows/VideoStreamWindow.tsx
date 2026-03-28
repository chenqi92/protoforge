import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { VideoStreamWorkspace } from "@/components/videostream/VideoStreamWorkspace";

export function VideoStreamWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());
  return (
    <ToolWindowShell tool="videostream" sessionId={sessionId} title="视频流调试" module="videostream" accentClassName="bg-purple-500">
      <div className="h-full overflow-hidden bg-transparent">
        <VideoStreamWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
