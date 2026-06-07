// TCP Server 客户端列表组件 — 使用 DropdownMenu（Portal 渲染，不被 overflow 裁剪）
import { Users, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TcpServerClient } from "@/types/tcp";
import { useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ClientListProps {
  clients: TcpServerClient[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  embedded?: boolean;
  compact?: boolean;
}

export function ClientList({ clients, selectedClientId, onSelectClient, embedded = false, compact = false }: ClientListProps) {
  const { t } = useTranslation();

  // 选中的客户端断开时自动切回广播
  useEffect(() => {
    if (selectedClientId && !clients.find((c) => c.id === selectedClientId)) {
      onSelectClient(null);
    }
  }, [clients, selectedClientId, onSelectClient]);

  const selectedClient = selectedClientId ? clients.find((c) => c.id === selectedClientId) : null;
  const isBroadcast = !selectedClientId;

  if (clients.length === 0) {
    return (
      <div className={cn("overflow-visible", !embedded && "wb-panel")}>
        <div className={cn(embedded ? "wb-pane-header" : "wb-panel-header", compact && "px-3 py-2")}>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center justify-center pf-rounded-md bg-bg-secondary text-text-tertiary", compact ? "h-7 w-7" : "h-8 w-8")}>
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className={cn("font-semibold text-text-primary", compact ? "pf-text-xs" : "pf-text-sm")}>{t('tcp.clientList.title')}</div>
              {!compact ? (
                <div className="pf-text-xs text-text-tertiary">{t('tcp.clientList.connections', { count: 0 })}</div>
              ) : null}
            </div>
          </div>
          <span className="pf-pill">
            <span className="pf-dot s-conn" />
            {t('tcp.clientList.waiting', '等待接入')}
          </span>
        </div>
        <div className={cn("flex flex-col items-center justify-center gap-2 text-center text-text-disabled", compact ? "px-4 py-5" : "px-6 py-7")}>
          <div className={cn("flex items-center justify-center pf-rounded-lg border border-border-default bg-bg-secondary shadow-sm", compact ? "h-10 w-10" : "h-12 w-12")}>
            <Radio className="h-5 w-5 opacity-30" />
          </div>
          <p className="pf-text-sm font-medium text-text-secondary">{t('tcp.clientList.emptyTitle', '暂无客户端接入')}</p>
          {!compact ? (
            <p className="pf-text-xs leading-5 text-text-tertiary">{t('tcp.clientList.emptyDesc', '客户端连接后将在此列出，可单独定向发送或广播。')}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("overflow-visible", !embedded && "wb-panel")}>
      <div className={cn(embedded ? "wb-pane-header" : "wb-panel-header", compact && "px-3 py-2")}>
        <div className="flex items-center gap-2">
          <div className={cn("flex items-center justify-center pf-rounded-md bg-accent/8 text-accent", compact ? "h-7 w-7" : "h-8 w-8")}>
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className={cn("font-semibold text-text-primary", compact ? "pf-text-xs" : "pf-text-sm")}>{t('tcp.clientList.title')}</div>
            {!compact ? (
              <div className="pf-text-xs text-text-tertiary">{t('tcp.clientList.connections', { count: clients.length })}</div>
            ) : null}
          </div>
        </div>
        <span className="wb-tool-chip">{isBroadcast ? t('tcp.clientList.broadcast') : t('tcp.clientList.unicast')}</span>
      </div>

      <div className={cn("relative", compact ? "p-2.5" : "p-3")}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex w-full items-center justify-between gap-2 pf-rounded-md border px-3 text-left transition-all cursor-pointer",
              compact ? "py-2" : "py-2.5",
              isBroadcast
                ? "border-accent/30 bg-accent/5 hover:bg-accent/8"
                : "border-border-default bg-bg-secondary/50 hover:bg-bg-hover"
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {isBroadcast ? (
                <>
                  <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className={cn("truncate font-medium text-accent", compact ? "pf-text-xs" : "pf-text-sm")}>
                    {t('tcp.clientList.broadcastAll')}
                  </span>
                  <span className="shrink-0 pf-rounded-sm bg-accent/10 px-1.5 py-0.5 pf-text-3xs font-bold text-accent">
                    {clients.length}
                  </span>
                </>
              ) : (
                <>
                  <span className="pf-dot s-ok shrink-0" />
                  <span className={cn("truncate font-mono text-text-primary", compact ? "pf-text-xs" : "pf-text-sm")}>
                    {selectedClient?.remoteAddr ?? selectedClientId}
                  </span>
                </>
              )}
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
            {/* 全部广播选项 */}
            <DropdownMenuItem
              onClick={() => onSelectClient(null)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5",
                isBroadcast && "bg-accent/8 text-accent"
              )}
            >
              <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="flex-1 pf-text-sm font-medium">
                {t('tcp.clientList.broadcastAll')}
              </span>
              <span className="pf-rounded-sm bg-accent/10 px-1.5 py-0.5 pf-text-3xs font-bold text-accent">
                {clients.length}
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* 客户端列表 */}
            {clients.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onSelectClient(c.id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2",
                  selectedClientId === c.id && "bg-accent/8"
                )}
              >
                <span className="pf-dot s-ok shrink-0" />
                <span className={cn(
                  "flex-1 truncate font-mono pf-text-sm",
                  selectedClientId === c.id ? "text-accent font-medium" : "text-text-secondary"
                )}>
                  {c.remoteAddr}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
