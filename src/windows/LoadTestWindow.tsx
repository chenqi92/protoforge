import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";

export function LoadTestWindow() {
  const { t } = useTranslation();
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="loadtest" sessionId={sessionId} title={t('loadtest.emptyTitle')} module="loadtest" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <LoadTestWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
