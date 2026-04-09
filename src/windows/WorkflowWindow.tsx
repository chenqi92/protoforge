import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { WorkflowWorkspace } from "@/components/workflow/WorkflowWorkspace";

export function WorkflowWindow() {
  const sessionId = new URLSearchParams(window.location.search).get("session") ?? "default";

  return (
    <ToolWindowShell tool="workflow" sessionId={sessionId} title="工作流编排" module="workflow" accentClassName="bg-indigo-500">
      <div className="h-full overflow-hidden bg-transparent">
        <WorkflowWorkspace />
      </div>
    </ToolWindowShell>
  );
}
