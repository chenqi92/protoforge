// TCP Server 客户端列表组件 — 下拉选择器模式
import { useState, useRef, useEffect } from "react";
import { Users, ChevronDown, Radio } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部时关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 选中的客户端断开时自动切回广播
  useEffect(() => {
    if (selectedClientId && !clients.find((c) => c.id === selectedClientId)) {
      onSelectClient(null);
    }
  }, [clients, selectedClientId, onSelectClient]);

  if (clients.length === 0) return null;

  const selectedClient = selectedClientId ? clients.find((c) => c.id === selectedClientId) : null;
  const isBroadcast = !selectedClientId;

  return (
    <div ref={containerRef} className={cn("overflow-visible", !embedded && "wb-panel")}>
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
        <span className="wb-tool-chip">{isBroadcast ? t('tcp.clientList.broadcast') : t('tcp.clientList.unicast')}</span>
      </div>

      <div className="relative p-3">
        {/* 选择器触发按钮 */}
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-[10px] border px-3 py-2.5 text-left transition-all",
            isBroadcast
              ? "border-accent/30 bg-accent/5 hover:bg-accent/8"
              : "border-border-default bg-bg-secondary/50 hover:bg-bg-hover"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {isBroadcast ? (
              <>
                <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate text-[var(--fs-sm)] font-medium text-accent">
                  {t('tcp.clientList.broadcastAll')}
                </span>
                <span className="shrink-0 rounded-[7px] bg-accent/10 px-1.5 py-0.5 text-[var(--fs-3xs)] font-bold text-accent">
                  {clients.length}
                </span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate font-mono text-[var(--fs-sm)] text-text-primary">
                  {selectedClient?.remoteAddr ?? selectedClientId}
                </span>
              </>
            )}
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform", open && "rotate-180")} />
        </button>

        {/* 下拉面板 */}
        {open && (
          <div className="absolute left-3 right-3 top-full z-20 mt-1 overflow-hidden rounded-[12px] border border-border-default bg-bg-primary shadow-lg">
            <div className="max-h-[220px] overflow-y-auto py-1">
              {/* 全部广播选项 */}
              <button
                onClick={() => { onSelectClient(null); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                  isBroadcast ? "bg-accent/8 text-accent" : "hover:bg-bg-hover"
                )}
              >
                <Radio className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="flex-1 text-[var(--fs-sm)] font-medium">
                  {t('tcp.clientList.broadcastAll')}
                </span>
                <span className="rounded-[7px] bg-accent/10 px-1.5 py-0.5 text-[var(--fs-3xs)] font-bold text-accent">
                  {clients.length}
                </span>
              </button>

              {/* 分隔线 */}
              <div className="mx-3 my-1 border-t border-border-default/60" />

              {/* 客户端列表 */}
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onSelectClient(c.id); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                    selectedClientId === c.id ? "bg-accent/8" : "hover:bg-bg-hover"
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className={cn(
                    "flex-1 truncate font-mono text-[var(--fs-sm)]",
                    selectedClientId === c.id ? "text-accent font-medium" : "text-text-secondary"
                  )}>
                    {c.remoteAddr}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
