import { Sun, Moon, Monitor, Gauge, Radio, Puzzle, Settings, Network } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAppStore } from "@/stores/appStore";
import { Tooltip } from "@/components/common/Tooltip";
import { cn } from "@/lib/utils";
import logoSvg from "@/assets/logo.svg";

interface TitleBarProps {
  onOpenTool?: (tool: string) => void;
}

const tools = [
  { id: "tcpudp", icon: Network, label: "TCP/UDP", color: "hover:text-blue-400" },
  { id: "loadtest", icon: Gauge, label: "压测", color: "hover:text-rose-400" },
  { id: "capture", icon: Radio, label: "抓包", color: "hover:text-cyan-400" },
  { id: "plugins", icon: Puzzle, label: "插件", color: "hover:text-violet-400" },
  { id: "settings", icon: Settings, label: "设置", color: "hover:text-text-primary" },
];

export function TitleBar({ onOpenTool }: TitleBarProps) {
  const { mode, resolved, toggle } = useThemeStore();
  const activeProtocol = useAppStore((s) => s.getActiveTab()?.protocol ?? null);

  return (
    <div className="relative flex h-[var(--titlebar-height)] shrink-0 items-center justify-between border-b border-border-default/70 bg-bg-primary/80 px-3 backdrop-blur-md drag-region select-none">
      {/* macOS 交通灯按钮占位区域 */}
      <div className="w-[70px] shrink-0" />

      <button
        onClick={() => useAppStore.getState().setActiveTab(null)}
        className="flex items-center gap-3 rounded-[16px] px-2 py-1.5 no-drag transition-colors hover:bg-bg-hover/70"
        title="返回主页"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]">
          <img src={logoSvg} alt="ProtoForge" className="h-5 w-5 rounded-[6px]" />
        </div>
        <div className="flex flex-col items-start leading-none">
          <span className="text-[13px] font-semibold text-text-primary">ProtoForge</span>
          <span className="text-[11px] text-text-tertiary">API Studio</span>
        </div>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-2 no-drag">
        <div className="flex items-center gap-1 rounded-[16px] border border-border-default/70 bg-bg-secondary/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {tools.map((t) => {
            const Icon = t.icon;
            return (
              <Tooltip key={t.id} content={t.label}>
                <button
                  onClick={() => onOpenTool?.(t.id)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary",
                    activeProtocol === t.id && "bg-bg-hover text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                    t.color
                  )}
                >
                  <Icon className="w-[15px] h-[15px]" />
                </button>
              </Tooltip>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-[16px] border border-border-default/70 bg-bg-secondary/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button
            onClick={() => {
              toggle();
              const nextModes = ["light", "dark", "system"] as const;
              const nextIdx = (nextModes.indexOf(mode) + 1) % nextModes.length;
              useSettingsStore.getState().update("theme", nextModes[nextIdx]);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={mode === "system" ? "跟随系统" : mode === "dark" ? "深色模式" : "浅色模式"}
          >
            {mode === "system" ? (
              <Monitor className="w-4 h-4" />
            ) : resolved === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
