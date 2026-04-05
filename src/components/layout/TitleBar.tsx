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
  Home,
  MonitorPlay,
  Server,
  Database,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { WorkbenchView } from "@/stores/appStore";
import { Tooltip } from "@/components/common/Tooltip";
import { useWindowFrameGestures } from "@/hooks/useWindowFrameGestures";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  activeWorkbench: WorkbenchView;
  onSelectWorkbench: (workbench: WorkbenchView) => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
}

const workbenches: Array<{
  id: WorkbenchView;
  labelKey: string;
  icon: typeof FileText;
  accentClassName: string;
}> = [
  { id: "home", labelKey: "titleBar.home", icon: Home, accentClassName: "text-slate-600" },
  { id: "requests", labelKey: "titleBar.requests", icon: FileText, accentClassName: "text-emerald-600" },
  { id: "tcpudp", labelKey: "titleBar.tcpudp", icon: Network, accentClassName: "text-blue-600" },
  { id: "capture", labelKey: "titleBar.capture", icon: Radio, accentClassName: "text-cyan-600" },
  { id: "loadtest", labelKey: "titleBar.loadtest", icon: Gauge, accentClassName: "text-rose-600" },
  { id: "videostream", labelKey: "titleBar.videostream", icon: MonitorPlay, accentClassName: "text-purple-600" },
  { id: "mockserver", labelKey: "titleBar.mockserver", icon: Server, accentClassName: "text-green-600" },
  { id: "dbclient", labelKey: "titleBar.dbclient", icon: Database, accentClassName: "text-amber-600" },
];

export function TitleBar({
  activeWorkbench,
  onSelectWorkbench,
  onOpenPlugins,
  onOpenSettings,
}: TitleBarProps) {
  const { t } = useTranslation();
  const { mode, resolved, toggle } = useThemeStore();
  const frameGestures = useWindowFrameGestures();

  return (
    <div
      {...frameGestures}
      className="relative flex h-[var(--titlebar-height)] shrink-0 items-center gap-3 border-b border-border-default/50 bg-bg-primary/85 px-3 backdrop-blur-xl shadow-xs select-none"
    >
      <div className="w-[70px] shrink-0" />

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <div
          className="flex items-center gap-0.5 pf-rounded-md border border-border-default/60 bg-bg-secondary/80 p-[3px] no-drag"
        >
          {workbenches.map((workbench) => {
            const Icon = workbench.icon;
            const isActive = activeWorkbench === workbench.id;
            const label = t(workbench.labelKey);

            return (
              <button
                key={workbench.id}
                onClick={() => onSelectWorkbench(workbench.id)}
                className={cn(
                  "flex h-8 items-center gap-2 pf-rounded-sm px-3 pf-text-sm font-medium transition-all",
                  isActive
                    ? "bg-bg-primary text-text-primary shadow-sm ring-1 ring-border-default/50"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
                )}
                title={label}
              >
                <Icon className={cn("h-3.5 w-3.5", isActive ? workbench.accentClassName : "text-current")} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 no-drag">
        <div className="flex items-center gap-1 pf-rounded-md border border-border-default/60 bg-bg-secondary/80 p-[3px]">
          <Tooltip content={t('titleBar.plugins')}>
            <button
              onClick={onOpenPlugins}
              className="flex h-8 w-8 items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-violet-500"
            >
              <Puzzle className="h-[15px] w-[15px]" />
            </button>
          </Tooltip>
          <Tooltip content={t('titleBar.settings')}>
            <button
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Settings className="h-[15px] w-[15px]" />
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 pf-rounded-md border border-border-default/60 bg-bg-secondary/80 p-[3px]">
          <button
            onClick={() => {
              toggle();
              const nextModes = ["light", "dark", "system"] as const;
              const nextIndex = (nextModes.indexOf(mode) + 1) % nextModes.length;
              useSettingsStore.getState().update("theme", nextModes[nextIndex]);
            }}
            className="flex h-8 w-8 items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
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
