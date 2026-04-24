// 连接表单对话框 — 精致 UI，数据库类型按钮组 + 分区表单

import { useState, useEffect, useCallback } from "react";
import {
  TestTube, Loader2, CheckCircle2, XCircle, Plug, FolderOpen,
  Database, Server, FileBox, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDbClientStoreApi } from "@/stores/dbClientStore";
import type {
  ConnectionConfig,
  SaveConnectionRequest,
  SavedConnection,
  DbType,
  InfluxVersion,
} from "@/types/dbclient";
import { DB_TYPE_LABELS, DB_TYPE_DEFAULTS } from "@/types/dbclient";

// 每种数据库类型的图标和颜色
const DB_META: Record<DbType, { icon: typeof Database; color: string; bg: string }> = {
  postgresql: { icon: Database, color: "text-blue-600 dark:text-blue-300", bg: "bg-blue-500/10 ring-blue-500/20" },
  mysql:      { icon: Server,   color: "text-orange-600 dark:text-orange-300", bg: "bg-orange-500/10 ring-orange-500/20" },
  sqlite:     { icon: FileBox,  color: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-500/10 ring-emerald-500/20" },
  influxdb:   { icon: Activity, color: "text-purple-600 dark:text-purple-300", bg: "bg-purple-500/10 ring-purple-500/20" },
};

interface ConnectionFormDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  editingConnection: SavedConnection | null;
}

export function ConnectionFormDialog({
  open: isOpen,
  onClose,
  sessionId,
  editingConnection,
}: ConnectionFormDialogProps) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [dbType, setDbType] = useState<DbType>("postgresql");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [database, setDatabase] = useState("postgres");
  const [username, setUsername] = useState("postgres");
  const [password, setPassword] = useState("");
  const [sslEnabled, setSslEnabled] = useState(false);
  const [filePath, setFilePath] = useState("");
  const [influxVersion, setInfluxVersion] = useState<InfluxVersion>("2.x");
  const [org, setOrg] = useState("");
  const [token, setToken] = useState("");
  const [retentionPolicy, setRetentionPolicy] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingConnection) {
      setName(editingConnection.name);
      setDbType(editingConnection.dbType);
      setHost(editingConnection.host);
      setPort(editingConnection.port ?? DB_TYPE_DEFAULTS[editingConnection.dbType].port ?? 5432);
      setDatabase(editingConnection.databaseName);
      setUsername(editingConnection.username);
      setPassword("");
      setSslEnabled(editingConnection.sslEnabled);
      setFilePath(editingConnection.filePath ?? "");
      setOrg(editingConnection.org ?? "");
      setInfluxVersion((editingConnection.influxVersion as InfluxVersion) ?? "2.x");
      setToken("");
      setRetentionPolicy("");
    } else {
      setName(""); setDbType("postgresql"); setHost("localhost"); setPort(5432);
      setDatabase("postgres"); setUsername("postgres"); setPassword("");
      setSslEnabled(false); setFilePath(""); setInfluxVersion("2.x");
      setOrg(""); setToken(""); setRetentionPolicy("");
    }
    setTestResult(null);
  }, [isOpen, editingConnection]);

  useEffect(() => {
    if (editingConnection) return;
    const defaults = DB_TYPE_DEFAULTS[dbType];
    setHost(defaults.host ?? "localhost"); setPort(defaults.port ?? 5432);
    setUsername(defaults.username ?? ""); setDatabase(defaults.database ?? "");
    setTestResult(null);
  }, [dbType, editingConnection]);

  const buildConfig = (): ConnectionConfig => ({
    dbType, host, port: port ?? 5432,
    database: dbType === "influxdb" && influxVersion !== "1.x" ? "" : database,
    username, password, sslEnabled,
    filePath: dbType === "sqlite" ? filePath : null,
    org: dbType === "influxdb" ? org : null,
    token: dbType === "influxdb" ? token : null,
    influxVersion: dbType === "influxdb" ? influxVersion : null,
    retentionPolicy: dbType === "influxdb" && influxVersion === "1.x" ? retentionPolicy : null,
  });

  const buildSaveReq = (): SaveConnectionRequest => ({
    id: editingConnection?.id ?? null, name: name.trim(), dbType, host, port,
    databaseName: dbType === "influxdb" && influxVersion !== "1.x" ? org : database,
    username, password, sslEnabled,
    filePath: dbType === "sqlite" ? filePath : null,
    org: dbType === "influxdb" ? org : null,
    token: dbType === "influxdb" ? token : null,
    influxVersion: dbType === "influxdb" ? influxVersion : null,
    retentionPolicy: dbType === "influxdb" && influxVersion === "1.x" ? retentionPolicy : null,
  });

  const handleTest = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const info = await getDbClientStoreApi(sessionId).getState().testConnection(buildConfig());
      setTestResult({ ok: true, msg: info.version });
    } catch (e) { setTestResult({ ok: false, msg: String(e) }); }
    setTesting(false);
  }, [sessionId, dbType, host, port, database, username, password, sslEnabled, filePath, org, token, influxVersion]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return; setSaving(true);
    try {
      await getDbClientStoreApi(sessionId).getState().saveConnection(buildSaveReq());
      toast.success(t("dbClient.saveSuccess", { defaultValue: "连接已保存" }));
      onClose();
    } catch (e) {
      toast.error((t("dbClient.saveFailed", { defaultValue: "保存失败" }) as string) + ": " + String(e));
    }
    setSaving(false);
  }, [sessionId, editingConnection, name, dbType, host, port, database, username, password, sslEnabled, filePath, org, token, influxVersion, retentionPolicy, onClose]);

  const handleSaveAndConnect = useCallback(async () => {
    if (!name.trim()) return; setSaving(true);
    try {
      const store = getDbClientStoreApi(sessionId).getState();
      await store.saveConnection(buildSaveReq());
      await store.connect(buildConfig());
      onClose();
    } catch (e) {
      toast.error((t("dbClient.connectFailed", { defaultValue: "连接失败" }) as string) + ": " + String(e));
    }
    setSaving(false);
  }, [sessionId, editingConnection, name, dbType, host, port, database, username, password, sslEnabled, filePath, org, token, influxVersion, retentionPolicy, onClose]);

  const handlePickFile = useCallback(async () => {
    const path = await open({
      title: t("dbClient.selectDbFile"), multiple: false,
      filters: [
        { name: "SQLite", extensions: ["db", "sqlite", "sqlite3", "s3db"] },
        { name: t("dbClient.allFiles"), extensions: ["*"] },
      ],
    });
    if (path) {
      setFilePath(path as string);
      if (!name.trim()) setName((path as string).split("/").pop()?.split("\\").pop() ?? "");
    }
  }, [name, t]);

  const isSqlite = dbType === "sqlite";
  const isInflux = dbType === "influxdb";
  const isInfluxV1 = isInflux && influxVersion === "1.x";
  const isInfluxV2V3 = isInflux && !isInfluxV1;
  const isServer = dbType === "postgresql" || dbType === "mysql";
  const meta = DB_META[dbType];
  const Icon = meta.icon;

  const inputCls = "w-full pf-rounded-md border border-border-default/80 bg-bg-secondary/60 px-3 py-2 pf-text-sm text-text-primary placeholder:text-text-quaternary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors";
  const selectCls = cn(inputCls, "appearance-none cursor-pointer");
  const labelCls = "mb-1 block pf-text-xs font-medium text-text-tertiary uppercase tracking-wider";

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="w-[540px] max-w-[96vw] max-h-[88vh] gap-0 overflow-hidden pf-rounded-xl border border-border-default/40 bg-bg-primary p-0 shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08),0_2px_4px_-2px_rgba(0,0,0,0.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.5)] sm:max-w-[540px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">
          {editingConnection ? t("dbClient.editConnection") : t("dbClient.newConnection")}
        </DialogTitle>

        {/* ── 头部 ── */}
        <div className="flex items-center gap-4 border-b border-border-default/50 px-6 py-5">
          <div className={cn("flex h-10 w-10 items-center justify-center pf-rounded-xl ring-1 shrink-0", meta.bg)}>
            <Icon size={20} className={meta.color} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="pf-text-base font-semibold text-text-primary">
              {editingConnection ? t("dbClient.editConnection") : t("dbClient.newConnection")}
            </h2>
            <p className="pf-text-xs text-text-tertiary mt-0.5">{DB_TYPE_LABELS[dbType]}</p>
          </div>
        </div>

        {/* ── 表单 ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* 数据库类型选择 — 按钮组 */}
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(DB_TYPE_LABELS) as DbType[]).map((dt) => {
              const m = DB_META[dt];
              const DtIcon = m.icon;
              const active = dbType === dt;
              return (
                <button
                  key={dt}
                  onClick={() => setDbType(dt)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 pf-rounded-lg px-2 py-2.5 transition-all",
                    active
                      ? cn("ring-1 shadow-sm", m.bg)
                      : "bg-bg-secondary/40 text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
                  )}
                >
                  <DtIcon size={18} className={active ? m.color : "opacity-50"} />
                  <span className={cn("pf-text-xs font-medium", active ? m.color : "")}>
                    {DB_TYPE_LABELS[dt]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 连接名称 */}
          <div>
            <label className={labelCls}>{t("dbClient.connectionName")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dbClient.connectionNamePlaceholder")} className={inputCls} />
          </div>

          {/* InfluxDB 版本 */}
          {isInflux && (
            <div>
              <label className={labelCls}>{t("dbClient.influxVersion")}</label>
              <select value={influxVersion} onChange={(e) => setInfluxVersion(e.target.value as InfluxVersion)} className={selectCls}>
                <option value="1.x">InfluxDB 1.x</option>
                <option value="2.x">InfluxDB 2.x (OSS)</option>
                <option value="3.x">InfluxDB 3.x (Cloud)</option>
              </select>
            </div>
          )}

          {/* ── SQLite: 文件选择 ── */}
          {isSqlite && (
            <div>
              <label className={labelCls}>{t("dbClient.dbFilePath")}</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input value={filePath} readOnly placeholder={t("dbClient.selectDbFile")} className={cn(inputCls, "pr-10 cursor-pointer")} onClick={handlePickFile} />
                  <FolderOpen size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                </div>
              </div>
              {filePath && <p className="mt-1.5 pf-text-xs text-text-quaternary truncate">{filePath}</p>}
            </div>
          )}

          {/* ── 服务器连接 (PG / MySQL / InfluxDB) ── */}
          {!isSqlite && (
            <>
              {/* 分区标题 */}
              <div className="flex items-center gap-2 pt-1">
                <span className="pf-text-xxs font-semibold uppercase tracking-[0.15em] text-text-disabled">{t("dbClient.serverConfig")}</span>
                <div className="flex-1 h-px bg-border-default/40" />
              </div>

              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div>
                  <label className={labelCls}>{t("dbClient.host")}</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("dbClient.port")}</label>
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
            </>
          )}

          {/* PG/MySQL: 数据库 + 认证 */}
          {isServer && (
            <>
              <div>
                <label className={labelCls}>{t("dbClient.database")}</label>
                <input value={database} onChange={(e) => setDatabase(e.target.value)} className={inputCls} />
              </div>

              <div className="flex items-center gap-2">
                <span className="pf-text-xxs font-semibold uppercase tracking-[0.15em] text-text-disabled">{t("dbClient.authentication")}</span>
                <div className="flex-1 h-px bg-border-default/40" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("dbClient.username")}</label>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("dbClient.password")}</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
                </div>
              </div>
            </>
          )}

          {/* InfluxDB v1 */}
          {isInfluxV1 && (
            <>
              <div>
                <label className={labelCls}>{t("dbClient.database")}</label>
                <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="mydb" className={inputCls} />
              </div>
              <div className="flex items-center gap-2">
                <span className="pf-text-xxs font-semibold uppercase tracking-[0.15em] text-text-disabled">{t("dbClient.authentication")}</span>
                <div className="flex-1 h-px bg-border-default/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("dbClient.username")}</label>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("dbClient.password")}</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("dbClient.retentionPolicy")}</label>
                <input value={retentionPolicy} onChange={(e) => setRetentionPolicy(e.target.value)} placeholder="autogen" className={inputCls} />
              </div>
            </>
          )}

          {/* InfluxDB v2/v3 */}
          {isInfluxV2V3 && (
            <>
              <div className="flex items-center gap-2">
                <span className="pf-text-xxs font-semibold uppercase tracking-[0.15em] text-text-disabled">{t("dbClient.authentication")}</span>
                <div className="flex-1 h-px bg-border-default/40" />
              </div>
              <div>
                <label className={labelCls}>{t("dbClient.organization")}</label>
                <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="my-org" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("dbClient.apiToken")}</label>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token ..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("dbClient.bucket")}</label>
                <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="my-bucket" className={inputCls} />
              </div>
            </>
          )}

          {/* 测试结果 */}
          {testResult && (
            <div className={cn(
              "flex items-center gap-2.5 pf-rounded-lg px-4 py-3",
              testResult.ok ? "bg-emerald-500/8 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/15" : "bg-red-500/8 text-red-500 dark:text-red-300 ring-1 ring-red-500/15",
            )}>
              {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span className="pf-text-sm truncate flex-1">{testResult.msg}</span>
            </div>
          )}
        </div>

        {/* ── 底部 ── */}
        <div className="flex items-center justify-between border-t border-border-default/50 bg-bg-secondary/30 px-6 py-4">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 pf-rounded-lg border border-border-default/80 bg-bg-primary px-4 py-2 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
            {t("dbClient.testConnection")}
          </button>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="pf-rounded-lg border border-border-default/80 bg-bg-primary px-5 py-2 pf-text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-50 transition-colors"
            >
              {t("dbClient.save")}
            </button>
            <button
              onClick={handleSaveAndConnect}
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 pf-rounded-lg bg-primary px-5 py-2 pf-text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plug size={14} />
              {t("dbClient.saveAndConnect")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
