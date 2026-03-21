interface StatusBarProps {
  connectionStatus?: "connected" | "disconnected";
  responseTime?: number;
  responseSize?: number;
  activeModule: string;
}

const moduleLabels: Record<string, string> = {
  requests: "请求工作台",
  collection: "合集设置",
  http: "HTTP",
  ws: "WebSocket",
  sse: "SSE",
  mqtt: "MQTT",
  tcpudp: "TCP/UDP",
  capture: "抓包",
  loadtest: "压测",
  ready: "READY",
};

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
    <div className="flex h-[var(--statusbar-height)] shrink-0 items-center justify-between border-t border-border-default/70 bg-bg-primary/72 px-4 text-[11px] text-text-tertiary backdrop-blur-sm select-none">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-border-default/60 bg-bg-secondary/85 px-2.5 py-1 font-medium">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
          <span className="text-text-secondary tracking-wider">{moduleLabels[activeModule] || activeModule.toUpperCase()}</span>
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
