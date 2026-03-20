import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";

export function LoadTestWindow() {
  return (
    <ToolWindowShell tool="loadtest" title="HTTP 压力测试" module="loadtest" accentClassName="bg-rose-500">
      <div className="h-full overflow-hidden bg-transparent">
        <LoadTestWorkspace />
      </div>
    </ToolWindowShell>
  );
}
