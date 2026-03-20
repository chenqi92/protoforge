import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";

export function CaptureWindow() {
  return (
    <ToolWindowShell tool="capture" title="网络抓包" module="capture" accentClassName="bg-orange-500">
      <div className="h-full overflow-hidden bg-transparent">
        <CaptureWorkspace />
      </div>
    </ToolWindowShell>
  );
}
