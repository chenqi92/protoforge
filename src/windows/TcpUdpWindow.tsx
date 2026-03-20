// TCP/UDP 独立窗口壳组件
// 包含自己的 TitleBar（窗口控件）和 TcpWorkspace

import { Minus, Square, X } from "lucide-react";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { useThemeStore } from "@/stores/themeStore";
import { useEffect } from "react";
import { useRoundedCorners } from "@/hooks/useWindowMaximized";

export function TcpUdpWindow() {
  const theme = useThemeStore((s) => s.resolved);
  useRoundedCorners();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
    <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
      <div className="h-[var(--titlebar-height)] flex items-center justify-between bg-transparent drag-region select-none shrink-0">
        <div className="flex items-center gap-2 pl-4 no-drag">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500/80" />
          <span className="text-[12px] font-semibold text-text-primary tracking-wide">TCP / UDP</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center no-drag">
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

      <div className="flex-1 overflow-hidden">
        <TcpWorkspace />
      </div>
    </div>
  );
}
