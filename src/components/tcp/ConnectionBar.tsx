// 连接配置栏组件 — TCP/UDP 通用
import { Network, Server, Radio, Plug, X, Square, Usb, Cpu, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
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

const modeConfig: Record<SocketMode, { label: string; icon: React.ReactNode; badge: string; gradient: string }> = {
  "tcp-client": {
    label: "TCP",
    icon: <Network className="w-3.5 h-3.5" />,
    badge: "bg-blue-500",
    gradient: "from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700",
  },
  "tcp-server": {
    label: "TCP Server",
    icon: <Server className="w-3.5 h-3.5" />,
    badge: "bg-indigo-500",
    gradient: "from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700",
  },
  "udp-client": {
    label: "UDP",
    icon: <Radio className="w-3.5 h-3.5" />,
    badge: "bg-cyan-500",
    gradient: "from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600",
  },
  "udp-server": {
    label: "UDP Server",
    icon: <Square className="w-3.5 h-3.5" />,
    badge: "bg-teal-500",
    gradient: "from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700",
  },
  // serial / modbus use dedicated panel components, not ConnectionBar — stubs required for TS exhaustiveness
  "serial": {
    label: "Serial",
    icon: <Usb className="w-3.5 h-3.5" />,
    badge: "bg-amber-500",
    gradient: "from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600",
  },
  "modbus": {
    label: "Modbus",
    icon: <Cpu className="w-3.5 h-3.5" />,
    badge: "bg-violet-500",
    gradient: "from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700",
  },
  // toolbox uses ToolboxPanel directly, stub required for TS exhaustiveness
  "toolbox": {
    label: "Toolbox",
    icon: <Wrench className="w-3.5 h-3.5" />,
    badge: "bg-slate-500",
    gradient: "from-slate-500 to-zinc-600 hover:from-slate-600 hover:to-zinc-700",
  },
};

export function ConnectionBar({ mode, host, port, connected, connecting, onHostChange, onPortChange, onToggle }: ConnectionBarProps) {
  const { t } = useTranslation();
  const cfg = modeConfig[mode];
  const isServer = mode === "tcp-server" || mode === "udp-server";
  const activeLabel = isServer ? (connected ? t('tcp.stopListening') : t('tcp.listen')) : (connected ? t('tcp.disconnect') : t('tcp.connect'));
  const connectingLabel = isServer ? t('tcp.starting') : t('tcp.connecting');

  return (
    <div className="flex min-h-[38px] items-center gap-2 rounded-[var(--radius-md)] border border-border-default/75 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
      <div className={cn("flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[var(--fs-xs)] font-semibold text-white shadow-sm", cfg.badge)}>
        {cfg.icon}
        {cfg.label}
      </div>

      <input
        value={host}
        onChange={(e) => onHostChange(e.target.value)}
        placeholder={isServer ? "0.0.0.0" : t('tcp.hostPlaceholder')}
        disabled={connected}
        className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
      />

      <div className="h-5 w-px shrink-0 bg-border-default/70" />

      <input
        value={port}
        onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
        placeholder={t('tcp.portPlaceholder')}
        type="number"
        disabled={connected}
        className="h-7 w-[86px] bg-transparent px-2 text-center text-[var(--fs-sm)] font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
      />

      <button
        onClick={onToggle}
        disabled={connecting}
        className={cn(
          "wb-primary-btn min-w-[88px] px-3",
          connected
            ? "bg-red-500 hover:bg-red-600 hover:shadow-md"
            : connecting
              ? `${cfg.badge} cursor-wait opacity-70`
              : `bg-gradient-to-r ${cfg.gradient} hover:shadow-md`
        )}
      >
        {connected ? <X className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
        {connecting ? connectingLabel : activeLabel}
      </button>
    </div>
  );
}
