// 连接配置栏组件 — TCP/UDP 通用
import { Network, Server, Radio, Plug, X, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SocketMode } from "@/types/tcp";

interface ConnectionBarProps {
  mode: SocketMode;
  host: string;
  port: number;
  connected: boolean;
  connecting: boolean;
  onHostChange: (v: string) => void;
  onPortChange: (v: number) => void;
  onToggle: () => void;
}

const modeConfig: Record<SocketMode, { label: string; icon: React.ReactNode; color: string; gradient: string }> = {
  "tcp-client": {
    label: "TCP",
    icon: <Network className="w-3.5 h-3.5" />,
    color: "bg-blue-500",
    gradient: "from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700",
  },
  "tcp-server": {
    label: "TCP 服务端",
    icon: <Server className="w-3.5 h-3.5" />,
    color: "bg-indigo-500",
    gradient: "from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700",
  },
  "udp-client": {
    label: "UDP",
    icon: <Radio className="w-3.5 h-3.5" />,
    color: "bg-cyan-500",
    gradient: "from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600",
  },
  "udp-server": {
    label: "UDP 服务端",
    icon: <Square className="w-3.5 h-3.5" />,
    color: "bg-teal-500",
    gradient: "from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700",
  },
};

export function ConnectionBar({ mode, host, port, connected, connecting, onHostChange, onPortChange, onToggle }: ConnectionBarProps) {
  const cfg = modeConfig[mode];
  const isServer = mode === "tcp-server" || mode === "udp-server";
  const activeLabel = isServer ? (connected ? "停止" : "启动") : (connected ? "断开" : "连接");
  const connectingLabel = isServer ? "启动中..." : "连接中...";

  return (
    <div className="flex items-center h-10 rounded-lg bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-0.5">
      {/* Protocol Badge */}
      <div className={cn("flex items-center justify-center gap-1.5 h-full px-3.5 rounded-md text-[12px] font-bold text-white shrink-0 shadow-sm", cfg.color)}>
        {cfg.icon}
        {cfg.label}
      </div>

      {/* Host Input */}
      <input
        value={host}
        onChange={(e) => onHostChange(e.target.value)}
        placeholder={isServer ? "绑定地址 (0.0.0.0)" : "主机地址"}
        disabled={connected}
        className="flex-1 h-full px-3 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-tertiary border-r border-border-default disabled:opacity-60 min-w-0"
      />

      {/* Port Input */}
      <input
        value={port}
        onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
        placeholder="端口"
        type="number"
        disabled={connected}
        className="w-20 h-full px-3 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-tertiary text-center disabled:opacity-60"
      />

      {/* Connect/Disconnect Button */}
      <button
        onClick={onToggle}
        disabled={connecting}
        className={cn(
          "h-full px-4 rounded-md flex items-center gap-1.5 text-[12px] font-semibold text-white ml-0.5 shrink-0 transition-all active:scale-[0.97]",
          connected
            ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
            : connecting
              ? `${cfg.color} cursor-wait opacity-70`
              : `bg-gradient-to-r ${cfg.gradient} hover:shadow-md`
        )}
      >
        {connected ? <X className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
        {connecting ? connectingLabel : activeLabel}
      </button>
    </div>
  );
}
