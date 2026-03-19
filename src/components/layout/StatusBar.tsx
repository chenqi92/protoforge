

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
    <div className="h-[var(--statusbar-height)] flex items-center justify-between px-4 bg-transparent text-[11px] text-text-tertiary select-none shrink-0 border-t border-border-default md:border-transparent">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 font-medium px-2 py-0.5 rounded-full bg-border-subtle/50">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
          <span className="text-text-secondary tracking-wider">{activeModule.toUpperCase()}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 font-mono">
        {responseTime !== undefined && (
          <span className="flex items-center gap-1 group">
            <span className="text-text-disabled">Time</span>
            <span className="text-text-secondary group-hover:text-accent transition-colors">{responseTime} ms</span>
          </span>
        )}
        {responseSize !== undefined && (
          <span className="flex items-center gap-1 group">
            <span className="text-text-disabled">Size</span>
            <span className="text-text-secondary group-hover:text-accent transition-colors">{formatSize(responseSize)}</span>
          </span>
        )}
        <span className="text-text-disabled">v0.1.0</span>
      </div>
    </div>
  );
}
