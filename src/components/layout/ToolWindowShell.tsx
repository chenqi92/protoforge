import type { ReactNode } from "react";
import { ArrowLeftToLine } from "lucide-react";
import { StatusBar } from "@/components/layout/StatusBar";
import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { useSettingsEffect } from "@/hooks/useSettingsEffect";
import { useWindowFrameGestures } from "@/hooks/useWindowFrameGestures";
import { cn } from "@/lib/utils";
import { requestDockTool } from "@/lib/toolDocking";
import { focusMainWindow, type ToolWindowType } from "@/lib/windowManager";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface ToolWindowShellProps {
  tool: ToolWindowType;
  title: string;
  module: string;
  accentClassName: string;
  children: ReactNode;
  badgeLabel?: string;
}

export function ToolWindowShell({
  tool,
  title,
  module,
  accentClassName,
  children,
  badgeLabel,
}: ToolWindowShellProps) {
  useSettingsEffect();
  const frameGestures = useWindowFrameGestures();

  return (
    <WindowScaffold
      header={(
        <div
          {...frameGestures}
          className="relative flex h-[var(--titlebar-height)] shrink-0 items-center justify-between gap-3 border-b border-border-default/70 bg-bg-primary/80 px-3 backdrop-blur-md select-none"
        >
          {/* macOS 交通灯按钮占位区域 */}
          <div className="w-[70px] shrink-0" />

          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.8)] dark:shadow-[0_0_0_4px_rgba(18,18,20,0.9)]",
                accentClassName
              )}
            />
            <div className="truncate text-[13px] font-semibold text-text-primary">{title}</div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 no-drag">
            <button
              onClick={async () => {
                requestDockTool(tool);
                await focusMainWindow();
                setTimeout(() => {
                  void getCurrentWebviewWindow().close();
                }, 80);
              }}
              className="flex h-8 items-center gap-1 rounded-[12px] border border-border-default/70 bg-bg-secondary/80 px-2.5 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="合并回主窗口"
            >
              <ArrowLeftToLine className="h-3.5 w-3.5" />
              合并回主窗口
            </button>
            {badgeLabel ? (
              <span className="rounded-full border border-border-default/70 bg-bg-secondary/80 px-2.5 py-1 text-[11px] text-text-tertiary">
                {badgeLabel}
              </span>
            ) : null}
          </div>
        </div>
      )}
      footer={<StatusBar activeModule={module} />}
      bodyClassName="p-0"
    >
      {children}
    </WindowScaffold>
  );
}
