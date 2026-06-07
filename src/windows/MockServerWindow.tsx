import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { MockServerWorkspace } from "@/components/mockserver/MockServerWorkspace";

export function MockServerWindow() {
  const { t } = useTranslation();
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="mockserver" sessionId={sessionId} title={t('statusBar.mockserver')} module="mockserver" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <MockServerWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
