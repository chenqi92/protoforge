// 数据库连接侧栏 — 已保存连接列表 + 新建/编辑连接表单

import { memo, useEffect, useState, useCallback } from "react";
import {
  Plus, Trash2, Plug, Unplug, TestTube, Database, ChevronDown,
  Pencil, Circle, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  useDbClientStore,
  getDbClientStoreApi,
} from "@/stores/dbClientStore";
import type {
  ConnectionConfig,
  SaveConnectionRequest,
  SavedConnection,
  DbType,
  ServerInfo,
} from "@/types/dbclient";
import { DB_TYPE_LABELS, DB_TYPE_DEFAULTS } from "@/types/dbclient";

// ── 连接表单 ──

function ConnectionForm({
  sessionId,
  editingConnection,
  onClose,
}: {
  sessionId: string;
  editingConnection: SavedConnection | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const connected = useDbClientStore(sessionId, (s) => s.connected);

  const [name, setName] = useState(editingConnection?.name ?? "");
  const [dbType, setDbType] = useState<DbType>(editingConnection?.dbType ?? "postgresql");
  const [host, setHost] = useState(editingConnection?.host ?? "localhost");
  const [port, setPort] = useState(editingConnection?.port ?? 5432);
  const [database, setDatabase] = useState(editingConnection?.databaseName ?? "postgres");
  const [username, setUsername] = useState(editingConnection?.username ?? "postgres");
  const [password, setPassword] = useState("");
  const [sslEnabled, setSslEnabled] = useState(editingConnection?.sslEnabled ?? false);
  const [filePath, setFilePath] = useState(editingConnection?.filePath ?? "");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [org, setOrg] = useState(editingConnection?.org ?? "");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  // 切换数据库类型时更新默认值
  useEffect(() => {
    if (!editingConnection) {
      const defaults = DB_TYPE_DEFAULTS[dbType];
      setHost(defaults.host ?? "localhost");
      setPort(defaults.port ?? 5432);
      setUsername(defaults.username ?? "");
      setDatabase(defaults.database ?? "");
    }
  }, [dbType, editingConnection]);

  const buildConfig = (): ConnectionConfig => ({
    dbType,
    host,
    port: port ?? 5432,
    database,
    username,
    password,
    sslEnabled,
    filePath: dbType === "sqlite" ? filePath : null,
    org: dbType === "influxdb" ? org : null,
    token: dbType === "influxdb" ? token : null,
  });

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const store = getDbClientStoreApi(sessionId);
      const info = await store.getState().testConnection(buildConfig());
      setTestResult({ ok: true, msg: info.version });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    }
    setTesting(false);
  }, [sessionId, dbType, host, port, database, username, password, sslEnabled, filePath]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const store = getDbClientStoreApi(sessionId);
      const req: SaveConnectionRequest = {
        id: editingConnection?.id ?? null,
        name: name.trim(),
        dbType,
        host,
        port,
        databaseName: database,
        username,
        password,
        sslEnabled,
        filePath: dbType === "sqlite" ? filePath : null,
        org: null,
        token: null,
      };
      await store.getState().saveConnection(req);
      onClose();
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  }, [sessionId, editingConnection, name, dbType, host, port, database, username, password, sslEnabled, filePath, onClose]);

  const handleConnect = useCallback(async () => {
    const store = getDbClientStoreApi(sessionId);
    try {
      await store.getState().connect(buildConfig());
      onClose();
    } catch {
      // error is stored in state
    }
  }, [sessionId, dbType, host, port, database, username, password, sslEnabled, filePath, onClose]);

  const isSqlite = dbType === "sqlite";
  const isInfluxDb = dbType === "influxdb";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="pf-text-sm font-medium text-text-primary">
          {editingConnection ? t("dbClient.editConnection") : t("dbClient.newConnection")}
        </span>
        <button onClick={onClose} className="pf-text-xs text-text-tertiary hover:text-text-primary">&times;</button>
      </div>

      {/* 连接名称 */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("dbClient.connectionName")}
        className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
      />

      {/* 数据库类型 */}
      <div className="grid grid-cols-2 gap-1">
        {(Object.keys(DB_TYPE_LABELS) as DbType[]).map((dt) => (
          <button
            key={dt}
            onClick={() => setDbType(dt)}
            className={cn(
              "pf-rounded-sm px-2 py-1.5 pf-text-xs font-medium transition-colors truncate",
              dbType === dt
                ? "bg-accent-primary/15 text-accent-primary ring-1 ring-accent-primary/30"
                : "bg-bg-secondary text-text-tertiary hover:bg-bg-hover",
            )}
          >
            {DB_TYPE_LABELS[dt]}
          </button>
        ))}
      </div>

      {/* 连接参数 */}
      {isSqlite ? (
        <input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder={t("dbClient.dbFilePath")}
          className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t("dbClient.host")}
              className="flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              placeholder={t("dbClient.port")}
              className="w-20 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </div>
          <input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder={t("dbClient.database")}
            className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("dbClient.username")}
              className="flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("dbClient.password")}
              className="flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </div>
        </>
      )}

      {/* InfluxDB 专用字段 */}
      {isInfluxDb && (
        <>
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder={t("dbClient.organization")}
            className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("dbClient.apiToken")}
            className="w-full pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </>
      )}

      {/* 测试结果 */}
      {testResult && (
        <div className={cn(
          "flex items-center gap-1.5 pf-rounded-sm px-2.5 py-1.5 pf-text-xs",
          testResult.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500",
        )}>
          {testResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          <span className="truncate">{testResult.msg}</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center justify-center gap-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-50"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <TestTube size={12} />}
          {t("dbClient.test")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex items-center justify-center gap-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-50"
        >
          {t("dbClient.save")}
        </button>
        <button
          onClick={handleConnect}
          className="flex flex-1 items-center justify-center gap-1 pf-rounded-sm bg-accent-primary px-2.5 py-1.5 pf-text-xs font-medium text-white hover:bg-accent-primary/90"
        >
          <Plug size={12} />
          {t("dbClient.connect")}
        </button>
      </div>
    </div>
  );
}

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
  return (
    <div
      className={cn(
        "group flex items-center gap-2 pf-rounded-sm px-2.5 py-2 transition-colors cursor-pointer",
        isActive
          ? "bg-accent-primary/10 ring-1 ring-accent-primary/20"
          : "hover:bg-bg-hover",
      )}
      onDoubleClick={onConnect}
    >
      <Database size={14} className={cn(
        isActive ? "text-accent-primary" : "text-text-tertiary",
      )} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate pf-text-sm font-medium text-text-primary">
          {conn.name}
        </span>
        <span className="truncate pf-text-xs text-text-tertiary">
          {DB_TYPE_LABELS[conn.dbType]} · {conn.dbType === "sqlite" ? conn.filePath : `${conn.host}:${conn.port}`}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 text-text-tertiary hover:text-text-primary">
          <Pencil size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-text-tertiary hover:text-red-500">
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

  const [showForm, setShowForm] = useState(false);
  const [editingConn, setEditingConn] = useState<SavedConnection | null>(null);

  useEffect(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().loadSavedConnections();
  }, [sessionId]);

  const handleConnectSaved = useCallback((conn: SavedConnection) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().connect({
      dbType: conn.dbType,
      host: conn.host,
      port: conn.port ?? DB_TYPE_DEFAULTS[conn.dbType].port ?? 5432,
      database: conn.databaseName,
      username: conn.username,
      password: "", // 需要用户输入密码
      sslEnabled: conn.sslEnabled,
      filePath: conn.filePath,
      org: conn.org,
      token: null,
    });
  }, [sessionId]);

  const handleDisconnect = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().disconnect();
  }, [sessionId]);

  const handleDelete = useCallback((id: string) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().deleteSavedConnection(id);
  }, [sessionId]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default/50 px-3 py-2">
        <span className="pf-text-xs font-medium uppercase tracking-wider text-text-tertiary">
          {t("dbClient.connections")}
        </span>
        <button
          onClick={() => { setEditingConn(null); setShowForm(true); }}
          className="flex items-center gap-1 pf-rounded-sm px-1.5 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 连接状态 */}
      {connected && serverInfo && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-2 bg-emerald-500/5">
          <Circle size={8} className="fill-emerald-500 text-emerald-500" />
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
            className="p-1 text-text-tertiary hover:text-red-500"
            title={t("dbClient.disconnect")}
          >
            <Unplug size={13} />
          </button>
        </div>
      )}

      {connecting && (
        <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-2">
          <Loader2 size={13} className="animate-spin text-accent-primary" />
          <span className="pf-text-xs text-text-tertiary">{t("dbClient.connecting")}</span>
        </div>
      )}

      {connectionError && (
        <div className="border-b border-border-default/50 px-3 py-2 pf-text-xs text-red-500 bg-red-500/5">
          {connectionError}
        </div>
      )}

      {/* 连接表单 */}
      {showForm && (
        <div className="border-b border-border-default/50">
          <ConnectionForm
            sessionId={sessionId}
            editingConnection={editingConn}
            onClose={() => { setShowForm(false); setEditingConn(null); }}
          />
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
            onEdit={() => { setEditingConn(conn); setShowForm(true); }}
            onDelete={() => handleDelete(conn.id)}
          />
        ))}
        {savedConnections.length === 0 && !showForm && (
          <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <Database size={28} className="mb-2 opacity-30" />
            <span className="pf-text-xs">{t("dbClient.noConnections")}</span>
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 pf-text-xs text-accent-primary hover:underline"
            >
              {t("dbClient.createFirst")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
