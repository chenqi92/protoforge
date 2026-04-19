// 底部统计栏组件 — 含实时连接时长
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionStats } from "@/types/tcp";

interface StatsBarProps {
  stats: ConnectionStats;
  connected: boolean;
  statusText: string;
  /** ISO 时间戳，连接建立时间 */
  connectedSince?: string;
  /** 自动重连是否开启 */
  autoReconnect?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function StatsBar({ stats, connected, statusText, connectedSince, autoReconnect }: StatsBarProps) {
  const [duration, setDuration] = useState("");

  useEffect(() => {
    if (!connectedSince) { setDuration(""); return; }
    const update = () => {
      const ms = Date.now() - new Date(connectedSince).getTime();
      setDuration(formatDuration(Math.max(0, ms)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [connectedSince]);

  return (
    <div className="h-7 flex items-center gap-4 px-4 bg-bg-secondary/50 border-t border-border-default/50 pf-text-xs font-medium shrink-0 select-none">
      {/* Connection Status */}
      <div className="flex items-center gap-1.5">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full transition-colors",
          connected ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-text-disabled"
        )} />
        <span className={cn("transition-colors", connected ? "text-emerald-600 dark:text-emerald-400" : "text-text-tertiary")}>
          {statusText}
        </span>
        {autoReconnect && !connected && (
          <span className="flex items-center gap-0.5 text-amber-500 dark:text-amber-300">
            <RefreshCw className="w-2.5 h-2.5" />
            <span className="pf-text-xxs">自动重连</span>
          </span>
        )}
      </div>

      <div className="w-[1px] h-3 bg-border-default" />

      {/* Sent */}
      <div className="flex items-center gap-1 text-text-tertiary">
        <ArrowUp className="w-3 h-3 text-blue-500 dark:text-blue-300" />
        <span>{formatBytes(stats.sentBytes)}</span>
        <span className="opacity-50">({stats.sentCount})</span>
      </div>

      {/* Received */}
      <div className="flex items-center gap-1 text-text-tertiary">
        <ArrowDown className="w-3 h-3 text-emerald-500 dark:text-emerald-300" />
        <span>{formatBytes(stats.receivedBytes)}</span>
        <span className="opacity-50">({stats.receivedCount})</span>
      </div>

      {/* Live Duration */}
      {duration && (
        <>
          <div className="w-[1px] h-3 bg-border-default" />
          <div className="flex items-center gap-1 text-text-disabled">
            <Clock className="w-3 h-3" />
            <span className="tabular-nums">{duration}</span>
          </div>
        </>
      )}
    </div>
  );
}
