import { cn } from "@/lib/utils";

interface StatusBarProps {
  connectionStatus?: "connected" | "disconnected";
  responseTime?: number;
  responseSize?: number;
  activeModule: string;
}

export function StatusBar({
  responseTime,
  responseSize,
  activeModule,
}: StatusBarProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-[var(--statusbar-height)] flex items-center justify-between px-3 bg-bg-secondary border-t border-border-subtle text-[11px] text-text-disabled select-none shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-text-tertiary">{activeModule.toUpperCase()}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {responseTime !== undefined && (
          <span>{responseTime} ms</span>
        )}
        {responseSize !== undefined && (
          <span>{formatSize(responseSize)}</span>
        )}
        <span>v0.1.0</span>
      </div>
    </div>
  );
}
