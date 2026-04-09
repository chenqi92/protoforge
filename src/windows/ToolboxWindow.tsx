import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { ToolboxWorkspace } from "@/components/toolbox/ToolboxWorkspace";

export function ToolboxWindow() {
  const sessionId = new URLSearchParams(window.location.search).get("session") ?? "default";

  return (
    <ToolWindowShell tool="toolbox" sessionId={sessionId} title="工具箱" module="toolbox" accentClassName="bg-orange-500">
      <div className="h-full overflow-hidden bg-transparent">
        <ToolboxWorkspace />
      </div>
    </ToolWindowShell>
  );
}
