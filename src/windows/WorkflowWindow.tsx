import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { WorkflowWorkspace } from "@/components/workflow/WorkflowWorkspace";

export function WorkflowWindow() {
  const { t } = useTranslation();
  const sessionId = new URLSearchParams(window.location.search).get("session") ?? "default";

  return (
    <ToolWindowShell tool="workflow" sessionId={sessionId} title={t('statusBar.workflow')} module="workflow" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <WorkflowWorkspace />
      </div>
    </ToolWindowShell>
  );
}
