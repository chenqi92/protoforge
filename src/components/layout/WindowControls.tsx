import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface WindowControlsProps {
  compact?: boolean;
  className?: string;
}

async function getCurrentAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function WindowControls({ compact = false, className }: WindowControlsProps) {
  const buttonSize = compact ? "h-8 w-8 rounded-[12px]" : "h-9 w-9 rounded-[14px]";

  return (
    <div className={cn("flex items-center gap-1 no-drag", className)}>
      <button
        type="button"
        onClick={() => void getCurrentAppWindow().then((currentWindow) => currentWindow.minimize())}
        className={cn(
          "flex items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary",
          buttonSize
        )}
        title="最小化"
        aria-label="最小化窗口"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void getCurrentAppWindow().then((currentWindow) => currentWindow.toggleMaximize())}
        className={cn(
          "flex items-center justify-center text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary",
          buttonSize
        )}
        title="最大化"
        aria-label="最大化窗口"
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void getCurrentAppWindow().then((currentWindow) => currentWindow.close())}
        className={cn(
          "flex items-center justify-center text-text-tertiary transition-colors hover:bg-red-500 hover:text-white",
          buttonSize
        )}
        title="关闭"
        aria-label="关闭窗口"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
