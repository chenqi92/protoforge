import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { DbClientWorkspace } from "@/components/dbclient/DbClientWorkspace";

export function DbClientWindow() {
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="dbclient" sessionId={sessionId} title="数据库客户端" module="dbclient" accentClassName="bg-amber-500">
      <div className="h-full overflow-hidden bg-transparent">
        <DbClientWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
