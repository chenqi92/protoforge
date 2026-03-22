// 底部统计栏组件
import { ArrowUp, ArrowDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionStats } from "@/types/tcp";

interface StatsBarProps {
  stats: ConnectionStats;
  connected: boolean;
  statusText: string;
  connectedAt?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function StatsBar({ stats, connected, statusText, connectedAt }: StatsBarProps) {
  return (
    <div className="h-7 flex items-center gap-4 px-4 bg-bg-secondary/60 border-t border-border-default text-[var(--fs-xs)] font-medium shrink-0 select-none">
      {/* Connection Status */}
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full transition-colors",
          connected ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-text-disabled"
        )} />
        <span className={cn("transition-colors", connected ? "text-emerald-600 dark:text-emerald-400" : "text-text-tertiary")}>
          {statusText}
        </span>
      </div>

      <div className="w-[1px] h-3 bg-border-default" />

      {/* Sent */}
      <div className="flex items-center gap-1 text-text-tertiary">
        <ArrowUp className="w-3 h-3 text-blue-500" />
        <span>{formatBytes(stats.sentBytes)}</span>
        <span className="opacity-50">({stats.sentCount})</span>
      </div>

      {/* Received */}
      <div className="flex items-center gap-1 text-text-tertiary">
        <ArrowDown className="w-3 h-3 text-emerald-500" />
        <span>{formatBytes(stats.receivedBytes)}</span>
        <span className="opacity-50">({stats.receivedCount})</span>
      </div>

      {/* Duration */}
      {connectedAt && (
        <>
          <div className="w-[1px] h-3 bg-border-default" />
          <div className="flex items-center gap-1 text-text-disabled">
            <Clock className="w-3 h-3" />
            <span>{connectedAt}</span>
          </div>
        </>
      )}
    </div>
  );
}
