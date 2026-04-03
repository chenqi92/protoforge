// 连接配置栏组件 — TCP/UDP 通用
import { Network, Server, Radio, Plug, X, Square, Usb, Cpu } from "lucide-react";
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
  compact?: boolean;
}

const modeConfig: Record<SocketMode, { label: string; compactLabel: string; icon: React.ReactNode; badge: string; gradient: string }> = {
  "tcp-client": {
    label: "TCP",
    compactLabel: "TCP",
    icon: <Network className="w-3.5 h-3.5" />,
    badge: "bg-blue-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  "tcp-server": {
    label: "TCP Server",
    compactLabel: "Server",
    icon: <Server className="w-3.5 h-3.5" />,
    badge: "bg-indigo-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  "udp-client": {
    label: "UDP",
    compactLabel: "UDP",
    icon: <Radio className="w-3.5 h-3.5" />,
    badge: "bg-cyan-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  "udp-server": {
    label: "UDP Server",
    compactLabel: "Server",
    icon: <Square className="w-3.5 h-3.5" />,
    badge: "bg-teal-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  // serial / modbus use dedicated panel components, not ConnectionBar — stubs required for TS exhaustiveness
  "serial": {
    label: "Serial",
    compactLabel: "Serial",
    icon: <Usb className="w-3.5 h-3.5" />,
    badge: "bg-amber-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  "modbus": {
    label: "Modbus",
    compactLabel: "Modbus",
    icon: <Cpu className="w-3.5 h-3.5" />,
    badge: "bg-violet-500",
    gradient: "bg-accent hover:bg-accent-hover",
  },
  // modbus-slave uses ModbusSlavePanel directly, stub required for TS exhaustiveness
  "modbus-slave": {
    label: "Modbus Slave",
    compactLabel: "Slave",
    icon: <Cpu className="w-3.5 h-3.5" />,
    badge: "bg-violet-600",
    gradient: "bg-accent hover:bg-accent-hover",
  },
};

export function ConnectionBar({ mode, host, port, connected, connecting, onHostChange, onPortChange, onToggle, compact = false }: ConnectionBarProps) {
  const { t } = useTranslation();
  const cfg = modeConfig[mode];
  const isServer = mode === "tcp-server" || mode === "udp-server";
  const activeLabel = isServer ? (connected ? t('tcp.stopListening') : t('tcp.listen')) : (connected ? t('tcp.disconnect') : t('tcp.connect'));
  const connectingLabel = isServer ? t('tcp.starting') : t('tcp.connecting');

  if (compact) {
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 pf-rounded-md border border-border-default/60 bg-bg-secondary/35 p-1">
          <div className={cn("flex h-8 shrink-0 items-center justify-center gap-1.5 pf-rounded-sm px-2.5 pf-text-xs font-semibold text-white shadow-sm", cfg.badge)}>
            {cfg.icon}
            <span>{cfg.compactLabel}</span>
          </div>
          <button
            onClick={onToggle}
            disabled={connecting}
            className={cn(
              "wb-primary-btn ml-auto h-8 min-w-[78px] justify-center px-2.5 pf-text-xxs",
              connected
                ? "bg-error hover:bg-error/90 hover:shadow-md"
                : connecting
                  ? "bg-warning cursor-wait opacity-70"
                  : `${cfg.gradient} hover:shadow-md`
            )}
          >
            {connected ? <X className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
            {connecting ? connectingLabel : activeLabel}
          </button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
          <input
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            placeholder={isServer ? "0.0.0.0" : t('tcp.hostPlaceholder')}
            disabled={connected}
            className="wb-field w-full font-mono"
          />
          <input
            value={port}
            onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
            placeholder={t('tcp.portPlaceholder')}
            type="number"
            disabled={connected}
            className="wb-field w-full text-center font-mono"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[38px] items-center gap-2 pf-rounded-md border border-border-default/80 bg-bg-primary p-1 transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted">
      <div className={cn("flex h-7 shrink-0 items-center justify-center gap-1.5 pf-rounded-sm px-3 pf-text-xs font-semibold text-white shadow-sm", cfg.badge)}>
        {cfg.icon}
        {cfg.label}
      </div>

      <input
        value={host}
        onChange={(e) => onHostChange(e.target.value)}
        placeholder={isServer ? "0.0.0.0" : t('tcp.hostPlaceholder')}
        disabled={connected}
        className="h-7 min-w-0 flex-1 bg-transparent px-2 pf-text-sm font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
      />

      <div className="h-5 w-px shrink-0 bg-border-default/60" />

      <input
        value={port}
        onChange={(e) => onPortChange(parseInt(e.target.value) || 0)}
        placeholder={t('tcp.portPlaceholder')}
        type="number"
        disabled={connected}
        className="h-7 w-[86px] bg-transparent px-2 text-center pf-text-sm font-mono text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-60"
      />

      <button
        onClick={onToggle}
        disabled={connecting}
        className={cn(
          "wb-primary-btn min-w-[88px] px-3",
          connected
            ? "bg-error hover:bg-error/90 hover:shadow-md"
            : connecting
              ? "bg-warning cursor-wait opacity-70"
              : `${cfg.gradient} hover:shadow-md`
        )}
      >
        {connected ? <X className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
        {connecting ? connectingLabel : activeLabel}
      </button>
    </div>
  );
}
