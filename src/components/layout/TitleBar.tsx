import { useEffect, useRef } from "react";
import {
  Sun,
  Moon,
  Monitor,
  Gauge,
  Radio,
  Puzzle,
  Settings,
  Network,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ToolWorkbench, WorkbenchView } from "@/stores/appStore";
import { Tooltip } from "@/components/common/Tooltip";
import { useWindowFrameGestures } from "@/hooks/useWindowFrameGestures";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  activeWorkbench: WorkbenchView;
  detachedTools: Partial<Record<ToolWorkbench, boolean>>;
  onSelectWorkbench: (workbench: WorkbenchView) => void;
  onPopoutWorkbench: (workbench: ToolWorkbench) => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
}

const workbenches: Array<{
  id: WorkbenchView;
  labelKey: string;
  icon: typeof FileText;
  accentClassName: string;
}> = [
  { id: "requests", labelKey: "titleBar.requests", icon: FileText, accentClassName: "text-emerald-600" },
  { id: "tcpudp", labelKey: "titleBar.tcpudp", icon: Network, accentClassName: "text-blue-600" },
  { id: "capture", labelKey: "titleBar.capture", icon: Radio, accentClassName: "text-cyan-600" },
  { id: "loadtest", labelKey: "titleBar.loadtest", icon: Gauge, accentClassName: "text-rose-600" },
];

export function TitleBar({
  activeWorkbench,
  detachedTools,
  onSelectWorkbench,
  onPopoutWorkbench,
  onOpenPlugins,
  onOpenSettings,
}: TitleBarProps) {
  const { t } = useTranslation();
  const { mode, resolved, toggle } = useThemeStore();
  const frameGestures = useWindowFrameGestures();
  const workbenchRailRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    tool: ToolWorkbench | null;
    startX: number;
    startY: number;
    popped: boolean;
  }>({
    tool: null,
    startX: 0,
    startY: 0,
    popped: false,
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.tool || dragState.popped || !workbenchRailRef.current) {
        return;
      }

      const movedX = Math.abs(event.clientX - dragState.startX);
      const movedY = Math.abs(event.clientY - dragState.startY);
      if (movedX < 18 && movedY < 18) {
        return;
      }

      const rect = workbenchRailRef.current.getBoundingClientRect();
      const detached =
        event.clientX < rect.left - 24
        || event.clientX > rect.right + 24
        || event.clientY < rect.top - 18
        || event.clientY > rect.bottom + 24;

      if (!detached) {
        return;
      }

      dragState.popped = true;
      onPopoutWorkbench(dragState.tool);
    };

    const clearDragState = () => {
      dragStateRef.current.tool = null;
      dragStateRef.current.popped = false;
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", clearDragState, true);
    window.addEventListener("blur", clearDragState);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", clearDragState, true);
      window.removeEventListener("blur", clearDragState);
    };
  }, [onPopoutWorkbench]);

  const handleToolMouseDown = (tool: ToolWorkbench, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      tool,
      startX: event.clientX,
      startY: event.clientY,
      popped: false,
    };
  };

  return (
    <div
      {...frameGestures}
      className="relative flex h-[var(--titlebar-height)] shrink-0 items-center gap-3 border-b border-border-default/70 bg-bg-primary/80 px-3 backdrop-blur-md select-none"
    >
      <div className="w-[70px] shrink-0" />

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <div
          ref={workbenchRailRef}
          className="flex items-center gap-1 rounded-[16px] border border-border-default/70 bg-bg-secondary/82 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] no-drag"
        >
          {workbenches.map((workbench) => {
            const Icon = workbench.icon;
            const isActive = activeWorkbench === workbench.id;
            const isToolWorkbench = workbench.id !== "requests";
            const isDetached = isToolWorkbench ? Boolean(detachedTools[workbench.id as ToolWorkbench]) : false;
            const label = t(workbench.labelKey);

            return (
              <button
                key={workbench.id}
                onClick={() => {
                  if (dragStateRef.current.popped && dragStateRef.current.tool === workbench.id) {
                    dragStateRef.current.tool = null;
                    dragStateRef.current.popped = false;
                    return;
                  }

                  onSelectWorkbench(workbench.id);
                }}
                onMouseDown={isToolWorkbench ? (event) => handleToolMouseDown(workbench.id as ToolWorkbench, event) : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-[12px] px-3 text-[12px] font-medium transition-all",
                  isActive
                    ? "bg-bg-primary text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
                  isDetached && !isActive && "text-text-secondary"
                )}
                title={
                  isToolWorkbench
                    ? (isDetached ? t('titleBar.focusDetached', { label }) : t('titleBar.dragToDetach', { label }))
                    : label
                }
              >
                <Icon className={cn("h-3.5 w-3.5", isActive ? workbench.accentClassName : "text-current")} />
                <span>{label}</span>
                {isToolWorkbench ? (
                  <ArrowUpRight className={cn(
                    "h-3 w-3 text-text-disabled transition-colors",
                    isActive && "text-text-tertiary",
                    isDetached && !isActive && "text-accent"
                  )} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 no-drag">
        <div className="flex items-center gap-1 rounded-[16px] border border-border-default/70 bg-bg-secondary/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <Tooltip content={t('titleBar.plugins')}>
            <button
              onClick={onOpenPlugins}
              className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-violet-500"
            >
              <Puzzle className="h-[15px] w-[15px]" />
            </button>
          </Tooltip>
          <Tooltip content={t('titleBar.settings')}>
            <button
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Settings className="h-[15px] w-[15px]" />
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 rounded-[16px] border border-border-default/70 bg-bg-secondary/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button
            onClick={() => {
              toggle();
              const nextModes = ["light", "dark", "system"] as const;
              const nextIndex = (nextModes.indexOf(mode) + 1) % nextModes.length;
              useSettingsStore.getState().update("theme", nextModes[nextIndex]);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={mode === "system" ? t('titleBar.themeSystem') : mode === "dark" ? t('titleBar.themeDark') : t('titleBar.themeLight')}
          >
            {mode === "system" ? (
              <Monitor className="h-4 w-4" />
            ) : resolved === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
