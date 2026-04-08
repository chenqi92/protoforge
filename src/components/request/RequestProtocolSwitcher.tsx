import { Braces, ChevronDown, FileText, Radio, Zap, Network } from "lucide-react";
import { useState } from "react";
import type { RequestProtocol } from "@/stores/appStore";
import type { HttpRequestMode } from "@/types/http";
import { cn } from "@/lib/utils";

const options: Array<{
  kind: RequestKind;
  label: string;
  icon: typeof FileText;
  activeClass: string;
  iconBgClass: string;
  description: string;
}> = [
  { kind: "http", label: "HTTP", icon: FileText, activeClass: "text-emerald-600", iconBgClass: "bg-emerald-500/12", description: "REST Request" },
  { kind: "graphql", label: "GraphQL", icon: Braces, activeClass: "text-fuchsia-600", iconBgClass: "bg-fuchsia-500/12", description: "Schema Query" },
  { kind: "ws", label: "WebSocket", icon: Zap, activeClass: "text-amber-600", iconBgClass: "bg-amber-500/12", description: "Live Connection" },
  { kind: "mqtt", label: "MQTT", icon: Radio, activeClass: "text-violet-600", iconBgClass: "bg-violet-500/12", description: "Message Broker" },
  { kind: "grpc", label: "gRPC", icon: Network, activeClass: "text-cyan-600", iconBgClass: "bg-cyan-500/12", description: "RPC Framework" },
];

export type RequestKind = RequestProtocol | Extract<HttpRequestMode, "graphql">;

interface RequestProtocolSwitcherProps {
  activeProtocol: RequestProtocol;
  activeHttpMode?: HttpRequestMode;
  onChange: (kind: RequestKind) => void;
}

export function RequestProtocolSwitcher({
  activeProtocol,
  activeHttpMode,
  onChange,
}: RequestProtocolSwitcherProps) {
  const [open, setOpen] = useState(false);
  const activeKind: RequestKind = activeProtocol === "http" && activeHttpMode === "graphql"
    ? "graphql"
    : activeProtocol;
  const activeOption = options.find((option) => option.kind === activeKind) ?? options[0];
  const ActiveIcon = activeOption.icon;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn("wb-protocol-dropdown", activeOption.activeClass)}
        aria-expanded={open}
        title={`Request Type: ${activeOption.label}`}
      >
        <span className={cn("wb-protocol-dropdown-icon", activeOption.iconBgClass)}>
          <ActiveIcon className="h-3.5 w-3.5" />
        </span>
        <ChevronDown className={cn("h-3 w-3 text-text-disabled transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wb-protocol-menu absolute left-0 top-full z-50 mt-2 min-w-[180px]">
            {options.map((option) => {
              const Icon = option.icon;
              const active = option.kind === activeKind;

              return (
                <button
                  key={option.kind}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange(option.kind);
                  }}
                  className={cn(
                    "wb-protocol-menu-item",
                    active && "bg-bg-hover/65"
                  )}
                >
                  <span className={cn("wb-protocol-menu-icon", option.iconBgClass, option.activeClass)}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className={cn("block pf-text-xs font-medium", active ? "text-text-primary" : "text-text-secondary")}>
                      {option.label}
                    </span>
                    <span className="block pf-text-3xs text-text-disabled">{option.description}</span>
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
