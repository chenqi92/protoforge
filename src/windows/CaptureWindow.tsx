import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";

export function CaptureWindow() {
  const { t } = useTranslation();
  const [sessionId] = useState(() => new URLSearchParams(window.location.search).get("session") ?? crypto.randomUUID());

  return (
    <ToolWindowShell tool="capture" sessionId={sessionId} title={t('capture.emptyTitle')} module="capture" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <CaptureWorkspace sessionId={sessionId} />
      </div>
    </ToolWindowShell>
  );
}
