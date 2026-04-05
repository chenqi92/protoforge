// Schema 浏览器 — 数据库/表/视图/函数 树形浏览

import { memo, useCallback, useState } from "react";
import {
  Database, Table2, Eye, FunctionSquare, ChevronRight, ChevronDown,
  Columns3, Loader2, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import type { TableMeta, FunctionMeta } from "@/types/dbclient";

export const SchemaBrowser = memo(function SchemaBrowser({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const databases = useDbClientStore(sessionId, (s) => s.databases);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);
  const schemaObjects = useDbClientStore(sessionId, (s) => s.schemaObjects);
  const schemaLoading = useDbClientStore(sessionId, (s) => s.schemaLoading);
  const selectedTable = useDbClientStore(sessionId, (s) => s.selectedTable);

  const handleSelectDatabase = useCallback((db: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().selectDatabase(db);
  }, [sessionId]);

  const handleOpenTable = useCallback((schema: string, table: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().openTable(schema, table);
  }, [sessionId]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-text-tertiary pf-text-xs">
        {t("dbClient.connectFirst")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 数据库选择器 */}
      <div className="border-b border-border-default/50 px-2 py-1.5">
        <select
          value={selectedDatabase ?? ""}
          onChange={(e) => handleSelectDatabase(e.target.value)}
          className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-1 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
        >
          {databases.map((db) => (
            <option key={db.name} value={db.name}>
              {db.name}
              {db.sizeBytes != null ? ` (${formatBytes(db.sizeBytes)})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Schema 树 */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {schemaLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-text-tertiary" />
          </div>
        ) : schemaObjects ? (
          <div className="space-y-0.5">
            {/* Tables */}
            {schemaObjects.tables.length > 0 && (
              <TreeSection
                icon={<Table2 size={13} className="text-blue-500" />}
                label={t("dbClient.tables")}
                count={schemaObjects.tables.length}
              >
                {schemaObjects.tables.map((tbl) => (
                  <TableItem
                    key={`${tbl.schema}.${tbl.name}`}
                    table={tbl}
                    isSelected={selectedTable?.schema === tbl.schema && selectedTable?.name === tbl.name}
                    onClick={() => handleOpenTable(tbl.schema, tbl.name)}
                  />
                ))}
              </TreeSection>
            )}

            {/* Views */}
            {schemaObjects.views.length > 0 && (
              <TreeSection
                icon={<Eye size={13} className="text-purple-500" />}
                label={t("dbClient.views")}
                count={schemaObjects.views.length}
              >
                {schemaObjects.views.map((v) => (
                  <TableItem
                    key={`${v.schema}.${v.name}`}
                    table={v}
                    isSelected={false}
                    onClick={() => handleOpenTable(v.schema, v.name)}
                  />
                ))}
              </TreeSection>
            )}

            {/* Functions */}
            {schemaObjects.functions.length > 0 && (
              <TreeSection
                icon={<FunctionSquare size={13} className="text-amber-500" />}
                label={t("dbClient.functions")}
                count={schemaObjects.functions.length}
              >
                {schemaObjects.functions.map((fn) => (
                  <div
                    key={`${fn.schema}.${fn.name}`}
                    className="flex items-center gap-1.5 px-6 py-1 pf-text-xs text-text-secondary hover:bg-bg-hover pf-rounded-sm cursor-default"
                  >
                    <span className="truncate">{fn.name}</span>
                    {fn.returnType && (
                      <span className="shrink-0 text-text-tertiary">→ {fn.returnType}</span>
                    )}
                  </div>
                ))}
              </TreeSection>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

// ── 折叠组 ──

function TreeSection({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-1 py-1 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover pf-rounded-sm"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-text-tertiary">{count}</span>
      </button>
      {expanded && children}
    </div>
  );
}



// ── 表条目 ──

function TableItem({
  table,
  isSelected,
  onClick,
}: {
  table: TableMeta;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 px-6 py-1 pf-text-xs transition-colors pf-rounded-sm",
        isSelected
          ? "bg-accent-primary/10 text-accent-primary"
          : "text-text-secondary hover:bg-bg-hover",
      )}
    >
      <Table2 size={11} className="shrink-0 opacity-50" />
      <span className="truncate">{table.name}</span>
      {table.rowCountEstimate != null && table.rowCountEstimate > 0 && (
        <span className="ml-auto shrink-0 text-text-tertiary">
          ~{formatNumber(table.rowCountEstimate)}
        </span>
      )}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
