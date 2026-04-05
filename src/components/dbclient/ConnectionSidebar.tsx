// 数据库连接侧栏 — 已保存连接列表 + 连接状态
// 新建/编辑表单已移至 ConnectionFormDialog 模态框

import { memo, useEffect, useState, useCallback } from "react";
import {
  Plus, Trash2, Plug, Unplug, Database,
  Pencil, Circle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  useDbClientStore,
  getDbClientStoreApi,
} from "@/stores/dbClientStore";
import type { SavedConnection, DbType } from "@/types/dbclient";
import { DB_TYPE_LABELS, DB_TYPE_DEFAULTS } from "@/types/dbclient";
import { ConnectionFormDialog } from "./ConnectionFormDialog";

// ── 已保存连接列表项 ──

function ConnectionItem({
  conn,
  isActive,
  onConnect,
  onEdit,
  onDelete,
}: {
  conn: SavedConnection;
  isActive: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group flex items-center gap-2 pf-rounded-sm px-2.5 py-2 transition-colors cursor-pointer",
        isActive
          ? "bg-accent/10 ring-1 ring-accent/20"
          : "hover:bg-bg-hover",
      )}
      onDoubleClick={onConnect}
    >
      <Database size={14} className={cn(
        isActive ? "text-accent" : "text-text-tertiary",
      )} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate pf-text-sm font-medium text-text-primary">
          {conn.name}
        </span>
        <span className="truncate pf-text-xs text-text-tertiary">
          {DB_TYPE_LABELS[conn.dbType]}
          {conn.influxVersion ? ` ${conn.influxVersion}` : ""}
          {" · "}
          {conn.dbType === "sqlite"
            ? (conn.filePath?.split("/").pop() ?? conn.filePath)
            : `${conn.host}:${conn.port}`}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 text-text-tertiary hover:text-text-primary" title={t("dbClient.editConnection")}>
          <Pencil size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-text-tertiary hover:text-red-500" title={t("dbClient.delete")}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── 主组件 ──

export const ConnectionSidebar = memo(function ConnectionSidebar({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const savedConnections = useDbClientStore(sessionId, (s) => s.savedConnections);
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const serverInfo = useDbClientStore(sessionId, (s) => s.serverInfo);
  const connectionError = useDbClientStore(sessionId, (s) => s.connectionError);
  const connecting = useDbClientStore(sessionId, (s) => s.connecting);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<SavedConnection | null>(null);

  useEffect(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().loadSavedConnections();
  }, [sessionId]);

  // 双击已保存连接 → 打开编辑弹框（需要用户输入密码后连接）
  const handleConnectSaved = useCallback((conn: SavedConnection) => {
    setEditingConn(conn);
    setDialogOpen(true);
  }, []);

  const handleDisconnect = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().disconnect();
  }, [sessionId]);

  const handleDelete = useCallback((id: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().deleteSavedConnection(id);
  }, [sessionId]);

  const handleNew = () => {
    setEditingConn(null);
    setDialogOpen(true);
  };

  const handleEdit = (conn: SavedConnection) => {
    setEditingConn(conn);
    setDialogOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default/50 px-3 py-2">
        <span className="pf-text-xs font-medium uppercase tracking-wider text-text-tertiary">
          {t("dbClient.connections")}
        </span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title={t("dbClient.newConnection")}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 连接状态 */}
      {connected && serverInfo && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-2 bg-emerald-500/5">
          <Circle size={8} className="fill-emerald-500 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="truncate pf-text-xs font-medium text-emerald-600">
              {serverInfo.serverType}
            </div>
            <div className="truncate pf-text-xs text-text-tertiary">
              {serverInfo.database}
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="p-1 text-text-tertiary hover:text-red-500 shrink-0"
            title={t("dbClient.disconnect")}
          >
            <Unplug size={13} />
          </button>
        </div>
      )}

      {connecting && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-2">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span className="pf-text-xs text-text-tertiary">{t("dbClient.connecting")}</span>
        </div>
      )}

      {connectionError && !connecting && (
        <div className="border-b border-border-default/50 px-3 py-2 pf-text-xs text-red-500 bg-red-500/5 break-words">
          {connectionError}
        </div>
      )}

      {/* 已保存连接列表 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {savedConnections.map((conn) => (
          <ConnectionItem
            key={conn.id}
            conn={conn}
            isActive={false}
            onConnect={() => handleConnectSaved(conn)}
            onEdit={() => handleEdit(conn)}
            onDelete={() => handleDelete(conn.id)}
          />
        ))}
        {savedConnections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <Database size={28} className="mb-2 opacity-30" />
            <span className="pf-text-xs">{t("dbClient.noConnections")}</span>
            <button
              onClick={handleNew}
              className="mt-2 pf-text-xs text-accent hover:underline"
            >
              {t("dbClient.createFirst")}
            </button>
          </div>
        )}
      </div>

      {/* 连接表单对话框 */}
      <ConnectionFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingConn(null); }}
        sessionId={sessionId}
        editingConnection={editingConn}
      />
    </div>
  );
});
