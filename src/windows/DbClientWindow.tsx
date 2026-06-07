import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { DbClientWorkspace } from "@/components/dbclient/DbClientWorkspace";

export function DbClientWindow() {
  const { t } = useTranslation();
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="dbclient" sessionId={sessionId} title={t('statusBar.dbclient')} module="dbclient" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <DbClientWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
