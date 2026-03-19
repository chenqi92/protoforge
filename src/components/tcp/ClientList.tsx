// TCP Server 客户端列表组件
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TcpServerClient } from "@/types/tcp";

interface ClientListProps {
  clients: TcpServerClient[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
}

export function ClientList({ clients, selectedClientId, onSelectClient }: ClientListProps) {
  if (clients.length === 0) return null;

  return (
    <div className="px-1 pb-2">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Users className="w-3 h-3 text-text-disabled" />
        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
          已连接客户端 ({clients.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1 px-1">
        {/* All (broadcast) */}
        <button
          onClick={() => onSelectClient(null)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all border",
            selectedClientId === null
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-bg-secondary border-border-default text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
          )}
        >
          全部广播
        </button>
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelectClient(c.id)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono transition-all border",
              selectedClientId === c.id
                ? "bg-accent/10 border-accent/30 text-accent"
                : "bg-bg-secondary border-border-default text-text-secondary hover:bg-bg-hover"
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            {c.remoteAddr}
          </button>
        ))}
      </div>
    </div>
  );
}
