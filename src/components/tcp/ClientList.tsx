// TCP Server 客户端列表组件
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TcpServerClient } from "@/types/tcp";

interface ClientListProps {
  clients: TcpServerClient[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  embedded?: boolean;
}

export function ClientList({ clients, selectedClientId, onSelectClient, embedded = false }: ClientListProps) {
  const { t } = useTranslation();
  if (clients.length === 0) return null;

  return (
    <div className={cn("overflow-hidden", !embedded && "wb-panel")}>
      <div className={cn(embedded ? "wb-pane-header" : "wb-panel-header")}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent/8 text-accent">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('tcp.clientList.title')}</div>
            <div className="text-[var(--fs-xs)] text-text-tertiary">{t('tcp.clientList.connections', { count: clients.length })}</div>
          </div>
        </div>
        <span className="wb-tool-chip">{selectedClientId ? t('tcp.clientList.unicast') : t('tcp.clientList.broadcast')}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 p-3">
        <button
          onClick={() => onSelectClient(null)}
          className={cn(
            "inline-flex items-center gap-1 rounded-[10px] border px-2.5 py-1.5 text-[var(--fs-xxs)] font-medium transition-all",
            selectedClientId === null
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border-default bg-bg-secondary/70 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
          )}
        >
          {t('tcp.clientList.broadcastAll')}
        </button>
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelectClient(c.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[10px] border px-2.5 py-1.5 text-[var(--fs-xxs)] font-mono transition-all",
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
