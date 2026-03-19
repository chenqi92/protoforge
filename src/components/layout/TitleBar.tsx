import { Minus, Square, X, Sun, Moon, Monitor, Gauge, Radio, Puzzle, Settings, Network } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
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

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };
  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().toggleMaximize();
  };
  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  return (
    <div className="h-[var(--titlebar-height)] flex items-center justify-between bg-transparent drag-region select-none shrink-0">
      {/* Left: brand */}
      <div className="flex items-center gap-2.5 pl-5 no-drag">
        <img src={logoSvg} alt="ProtoForge" className="w-5 h-5 rounded-[4px]" />
        <span className="text-[13px] font-bold text-text-primary tracking-wide">ProtoForge</span>
      </div>

      {/* Center: spacer for drag */}
      <div className="flex-1" />

      {/* Right: tools + theme + window controls */}
      <div className="flex items-center no-drag">
        {/* Tool buttons */}
        <div className="flex items-center border-r border-border-default mr-2 pr-2 h-5">
          {tools.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onOpenTool?.(t.id)}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)]",
                  "text-text-tertiary transition-colors mx-0.5 hover:bg-bg-hover",
                  t.color
                )}
                title={t.label}
              >
                <Icon className="w-[14px] h-[14px]" />
              </button>
            );
          })}
        </div>

        {/* Theme toggle: cycles light → dark → system */}
        <button
          onClick={() => {
            toggle();
            // Sync to settingsStore based on next mode
            const nextModes = ['light', 'dark', 'system'] as const;
            const nextIdx = (nextModes.indexOf(mode) + 1) % nextModes.length;
            useSettingsStore.getState().update('theme', nextModes[nextIdx]);
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors mr-2"
          title={mode === 'system' ? '跟随系统' : mode === 'dark' ? '深色模式' : '浅色模式'}
        >
          {mode === 'system' ? <Monitor className="w-4 h-4" /> : resolved === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Window controls */}
        <div className="flex items-center">
          <button onClick={handleMinimize} className="w-11 h-[var(--titlebar-height)] flex items-center justify-center text-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <Minus className="w-4 h-4" />
          </button>
          <button onClick={handleMaximize} className="w-11 h-[var(--titlebar-height)] flex items-center justify-center text-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <Square className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleClose} className="w-11 h-[var(--titlebar-height)] flex items-center justify-center text-text-tertiary hover:bg-red-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
