// 查询历史面板 — 显示最近执行的 SQL 查询

import { memo, useEffect, useState, useCallback } from "react";
import { History, CheckCircle2, XCircle, Clock, Play, Copy, RefreshCw, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as dbService from "@/services/dbClientService";
import { getDbClientStoreApi } from "@/stores/dbClientStore";
import type { QueryHistoryEntry } from "@/types/dbclient";

export const QueryHistoryPanel = memo(function QueryHistoryPanel({
  sessionId,
  connectionId,
}: {
  sessionId: string;
  connectionId?: string | null;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await dbService.listQueryHistory(connectionId, 50);
      setEntries(list);
    } catch (e) {
      console.error("Load history failed:", e);
    }
    setLoading(false);
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReplay = (sql: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().setSqlText(sql);
    store.getState().executeQuery();
  };

  const handleCopyToEditor = (sql: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().setSqlText(sql);
  };

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-text-disabled">
        {loading ? (
          <>
            <Loader2 size={20} className="mb-3 animate-spin text-text-tertiary" />
            <span className="pf-text-xs text-text-tertiary">{t("dbClient.loading")}</span>
          </>
        ) : (
          <>
            <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
              <History className="h-8 w-8 opacity-20 text-accent" />
            </div>
            <p className="pf-text-base font-medium text-text-tertiary">{t("dbClient.noHistory")}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-1.5">
        <span className="pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          {t("dbClient.queryHistory")}
        </span>
        <button
          onClick={load}
          className="flex items-center justify-center p-1 pf-rounded-sm text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title={t("dbClient.refresh")}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="group border-b border-border-default/20 px-3 py-2 hover:bg-bg-hover/50 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1">
              {entry.status === "success" ? (
                <CheckCircle2 size={11} className="text-success shrink-0" />
              ) : (
                <XCircle size={11} className="text-error shrink-0" />
              )}
              <span className="pf-text-xs text-text-tertiary truncate">
                {entry.databaseName}
              </span>
              {entry.executionMs != null && (
                <span className="ml-auto flex items-center gap-0.5 pf-text-xs text-text-disabled tabular-nums shrink-0">
                  <Clock size={9} />
                  {entry.executionMs}ms
                </span>
              )}
              {entry.rowCount != null && (
                <span className="pf-text-xs text-text-disabled tabular-nums shrink-0">
                  {entry.rowCount}r
                </span>
              )}
            </div>

            <div className="pf-text-xs text-text-secondary font-mono leading-relaxed line-clamp-3 break-all">
              {entry.sqlText}
            </div>

            {entry.errorMessage && (
              <div className="mt-1 pf-text-xs text-error line-clamp-2">
                {entry.errorMessage}
              </div>
            )}

            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleCopyToEditor(entry.sqlText)}
                className="pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                title={t("dbClient.copyToEditor")}
              >
                <Copy size={11} />
              </button>
              <button
                onClick={() => handleReplay(entry.sqlText)}
                className="pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-accent hover:bg-accent-soft"
                title={t("dbClient.rerun")}
              >
                <Play size={11} />
              </button>
              <span className="ml-auto pf-text-xs text-text-disabled tabular-nums">
                {formatRelativeTime(entry.createdAt, t)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

function formatRelativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return t("dbClient.justNow");
    if (diff < 3_600_000) return t("dbClient.minutesAgo", { count: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t("dbClient.hoursAgo", { count: Math.floor(diff / 3_600_000) });
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
