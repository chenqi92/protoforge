import { ChevronDown, FileText, Radio, Waves, Zap } from "lucide-react";
import { useState } from "react";
import type { RequestProtocol } from "@/stores/appStore";
import { cn } from "@/lib/utils";

const options: Array<{
  protocol: RequestProtocol;
  label: string;
  icon: typeof FileText;
  activeClass: string;
  iconBgClass: string;
  description: string;
}> = [
  { protocol: "http", label: "HTTP", icon: FileText, activeClass: "text-emerald-600", iconBgClass: "bg-emerald-500/12", description: "API Request" },
  { protocol: "ws", label: "WebSocket", icon: Zap, activeClass: "text-amber-600", iconBgClass: "bg-amber-500/12", description: "Live Connection" },
  { protocol: "sse", label: "SSE", icon: Waves, activeClass: "text-orange-600", iconBgClass: "bg-orange-500/12", description: "Event Stream" },
  { protocol: "mqtt", label: "MQTT", icon: Radio, activeClass: "text-violet-600", iconBgClass: "bg-violet-500/12", description: "Message Broker" },
];

interface RequestProtocolSwitcherProps {
  activeProtocol: RequestProtocol;
  onChange: (protocol: RequestProtocol) => void;
}

export function RequestProtocolSwitcher({
  activeProtocol,
  onChange,
}: RequestProtocolSwitcherProps) {
  const [open, setOpen] = useState(false);
  const activeOption = options.find((option) => option.protocol === activeProtocol) ?? options[0];
  const ActiveIcon = activeOption.icon;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn("wb-protocol-dropdown", activeOption.activeClass)}
        aria-expanded={open}
        title={`Protocol: ${activeOption.label}`}
      >
        <span className={cn("wb-protocol-dropdown-icon", activeOption.iconBgClass)}>
          <ActiveIcon className="h-3.5 w-3.5" />
        </span>
        <span className="wb-protocol-dropdown-label">{activeOption.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-text-disabled transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wb-protocol-menu absolute left-0 top-full z-50 mt-2 min-w-[180px]">
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
              Switch Protocol
            </div>
            {options.map((option) => {
              const Icon = option.icon;
              const active = option.protocol === activeProtocol;

              return (
                <button
                  key={option.protocol}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange(option.protocol);
                  }}
                  className={cn(
                    "wb-protocol-menu-item",
                    active && "bg-bg-hover/65"
                  )}
                >
                  <span className={cn("wb-protocol-menu-icon", option.iconBgClass, option.activeClass)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className={cn("block text-[12px] font-medium", active ? "text-text-primary" : "text-text-secondary")}>
                      {option.label}
                    </span>
                    <span className="block text-[10px] text-text-disabled">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
