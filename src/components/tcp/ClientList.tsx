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
    <div className="rounded-[18px] border border-border-default/80 bg-bg-primary/78 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2 pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[12px] bg-accent/8 text-accent">
          <Users className="h-4 w-4" />
        </div>
        <div>
          <div className="text-[12px] font-semibold text-text-primary">客户端</div>
          <div className="text-[11px] text-text-tertiary">{clients.length} 个连接</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onSelectClient(null)}
          className={cn(
            "inline-flex items-center gap-1 rounded-[12px] border px-2.5 py-1.5 text-[10px] font-medium transition-all",
            selectedClientId === null
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border-default bg-bg-secondary/70 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
          )}
        >
          全部广播
        </button>
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelectClient(c.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[12px] border px-2.5 py-1.5 text-[10px] font-mono transition-all",
              selectedClientId === c.id
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default bg-bg-secondary/70 text-text-secondary hover:bg-bg-hover"
            )}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            {c.remoteAddr}
          </button>
        ))}
      </div>
    </div>
  );
}
