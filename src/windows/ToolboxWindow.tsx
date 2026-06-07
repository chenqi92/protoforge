import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { ToolboxWorkspace } from "@/components/toolbox/ToolboxWorkspace";

export function ToolboxWindow() {
  const { t } = useTranslation();
  const sessionId = new URLSearchParams(window.location.search).get("session") ?? "default";

  return (
    <ToolWindowShell tool="toolbox" sessionId={sessionId} title={t('statusBar.toolbox')} module="toolbox" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <ToolboxWorkspace />
      </div>
    </ToolWindowShell>
  );
}
