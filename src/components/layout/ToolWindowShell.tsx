import type { ReactNode } from "react";
import logoSvg from "@/assets/logo.svg";
import { StatusBar } from "@/components/layout/StatusBar";
import { WindowControls } from "@/components/layout/WindowControls";
import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { useSettingsEffect } from "@/hooks/useSettingsEffect";
import { useRoundedCorners } from "@/hooks/useWindowMaximized";
import { cn } from "@/lib/utils";

interface ToolWindowShellProps {
  title: string;
  module: string;
  accentClassName: string;
  children: ReactNode;
  badgeLabel?: string;
  stageClassName?: string;
}

export function ToolWindowShell({
  title,
  module,
  accentClassName,
  children,
  badgeLabel = "独立工具",
  stageClassName,
}: ToolWindowShellProps) {
  useRoundedCorners(18);
  useSettingsEffect();

  return (
    <WindowScaffold
      header={(
        <div className="relative flex h-[var(--titlebar-height)] shrink-0 items-center justify-between gap-3 border-b border-border-default/70 bg-bg-primary/80 px-3 backdrop-blur-md drag-region select-none">
          <div className="flex min-w-0 items-center gap-3 pl-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]">
              <img src={logoSvg} alt="ProtoForge" className="h-5 w-5 rounded-[6px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                  ProtoForge
                </span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.8)] dark:shadow-[0_0_0_4px_rgba(18,18,20,0.9)]",
                    accentClassName
                  )}
                />
              </div>
              <div className="truncate text-[13px] font-semibold text-text-primary">{title}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 no-drag">
            <span className="rounded-full border border-border-default/70 bg-bg-secondary/80 px-2.5 py-1 text-[11px] text-text-tertiary">
              {badgeLabel}
            </span>
            <div className="rounded-[16px] border border-border-default/70 bg-bg-secondary/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <WindowControls compact />
            </div>
          </div>
        </div>
      )}
      footer={<StatusBar activeModule={module} />}
      stageClassName={stageClassName}
    >
      {children}
    </WindowScaffold>
  );
}
