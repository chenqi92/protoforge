// 导入导出对话框 — 支持多种导出格式、表选择、工具路径

import { memo, useState, useEffect } from "react";
import {
  Download, Upload, Loader2, CheckCircle2, AlertCircle, FolderOpen,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as dbService from "@/services/dbClientService";
import { useDbClientStore } from "@/stores/dbClientStore";
import type { ConnectionConfig, ExportOptions, ImportOptions } from "@/types/dbclient";

interface ImportExportDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  connectionConfig: ConnectionConfig | null;
  selectedDatabase: string | null;
  defaultTables?: string[];  // 右键表时预填
}

type Mode = "export" | "import";

// 导出格式
type ExportFormat = "sql" | "insert" | "csv";
const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "sql", label: "SQL Dump (mysqldump/pg_dump)", ext: "sql" },
  { value: "insert", label: "INSERT Statements", ext: "sql" },
  { value: "csv", label: "CSV", ext: "csv" },
];

function genFilename(base: string, ext: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${base}_${ts}.${ext}`;
}

export const ImportExportDialog = memo(function ImportExportDialog({
  open: isOpen, onClose, sessionId, connectionConfig, selectedDatabase, defaultTables,
}: ImportExportDialogProps) {
  const { t } = useTranslation();
  const schemaObjects = useDbClientStore(sessionId, (s) => s.schemaObjects);

  const [mode, setMode] = useState<Mode>("export");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("sql");
  const [outputPath, setOutputPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [dataOnly, setDataOnly] = useState(false);
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [toolPath, setToolPath] = useState("");
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // 初始化默认值
  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setRunning(false);
      if (defaultTables?.length) {
        setSelectedTables(new Set(defaultTables));
        const base = defaultTables.length === 1 ? defaultTables[0] : (selectedDatabase ?? "dump");
        setOutputPath(genFilename(base, EXPORT_FORMATS.find(f => f.value === exportFormat)?.ext ?? "sql"));
      } else {
        setSelectedTables(new Set());
        setOutputPath(genFilename(selectedDatabase ?? "dump", EXPORT_FORMATS.find(f => f.value === exportFormat)?.ext ?? "sql"));
      }
    }
  }, [isOpen, defaultTables, selectedDatabase, exportFormat]);

  if (!connectionConfig) return null;

  const supportsExport = connectionConfig.dbType !== "influxdb";
  const supportsImport = connectionConfig.dbType === "postgresql" || connectionConfig.dbType === "mysql";

  const toolName = connectionConfig.dbType === "postgresql" ? "pg_dump" : connectionConfig.dbType === "mysql" ? "mysqldump" : connectionConfig.dbType === "sqlite" ? "sqlite3" : "";
  const allTables = schemaObjects?.tables ?? [];

  const handlePickExportPath = async () => {
    const ext = EXPORT_FORMATS.find(f => f.value === exportFormat)?.ext ?? "sql";
    const path = await save({
      title: t("dbClient.exportSelectPath"),
      defaultPath: outputPath || genFilename(selectedDatabase ?? "dump", ext),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: t("dbClient.allFiles"), extensions: ["*"] }],
    });
    if (path) setOutputPath(path);
  };

  const handlePickImportFile = async () => {
    const path = await openDialog({
      title: t("dbClient.importSelectFile"), multiple: false,
      filters: [{ name: "SQL / Dump", extensions: ["sql", "dump", "backup", "gz", "csv"] }, { name: t("dbClient.allFiles"), extensions: ["*"] }],
    });
    if (path) setImportPath(path as string);
  };

  const handlePickToolPath = async () => {
    const path = await openDialog({ title: t("dbClient.selectToolPath"), multiple: false });
    if (path) setToolPath(path as string);
  };

  const toggleTable = (name: string) => setSelectedTables(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleAllTables = () => setSelectedTables(prev => prev.size === allTables.length ? new Set() : new Set(allTables.map(t => t.name)));

  const handleExport = async () => {
    if (!outputPath) return;
    setRunning(true); setResult(null);
    try {
      const options: ExportOptions = {
        format: exportFormat, outputPath,
        database: selectedDatabase ?? connectionConfig.database,
        schema: null, tables: Array.from(selectedTables), dataOnly, schemaOnly,
        toolPath: toolPath || null,
      };
      const res = await dbService.exportDatabase(sessionId, connectionConfig, options);
      setResult({ ok: true, msg: t("dbClient.exportSuccess", { size: fmtBytes(res.sizeBytes), time: res.durationMs }) });
    } catch (e) { setResult({ ok: false, msg: String(e) }); }
    setRunning(false);
  };

  const handleImport = async () => {
    if (!importPath) return;
    setRunning(true); setResult(null);
    try {
      const options: ImportOptions = { filePath: importPath, database: selectedDatabase ?? connectionConfig.database, schema: null, toolPath: toolPath || null };
      const res = await dbService.importDatabase(sessionId, connectionConfig, options);
      const w = res.warnings.length > 0 ? ` (${res.warnings.length} ${t("dbClient.warnings")})` : "";
      setResult({ ok: true, msg: t("dbClient.importSuccess", { time: res.durationMs }) + w });
    } catch (e) { setResult({ ok: false, msg: String(e) }); }
    setRunning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="w-[520px] max-w-[96vw] gap-0 overflow-hidden rounded-xl border border-border-default/60 bg-bg-primary p-0 shadow-[0_32px_90px_rgba(15,23,42,0.18)] sm:max-w-[520px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">{t("dbClient.importExport")}</DialogTitle>

        {/* 头部 */}
        <div className="border-b border-border-default/50 px-5 py-3">
          <h2 className="text-sm font-semibold text-text-primary">{t("dbClient.importExport")}</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            {selectedDatabase ?? connectionConfig.database}
            {defaultTables?.length ? ` · ${defaultTables.join(", ")}` : ""}
          </p>
        </div>

        {/* 模式切换 */}
        <div className="flex border-b border-border-default/50">
          <button onClick={() => { setMode("export"); setResult(null); }}
            className={cn("flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
              mode === "export" ? "border-b-2 border-accent text-accent" : "text-text-tertiary hover:text-text-primary")}>
            <Download size={14} />{t("dbClient.export")}
          </button>
          <button onClick={() => { setMode("import"); setResult(null); }}
            className={cn("flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors",
              mode === "import" ? "border-b-2 border-accent text-accent" : "text-text-tertiary hover:text-text-primary")}>
            <Upload size={14} />{t("dbClient.import")}
          </button>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {!supportsExport && mode === "export" && (
            <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">{t("dbClient.exportNotSupported")}</div>
          )}
          {!supportsImport && mode === "import" && (
            <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">{t("dbClient.importNotSupported")}</div>
          )}

          {mode === "export" && supportsExport && (
            <>
              {/* 导出格式 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{t("dbClient.exportFormat")}</label>
                <div className="flex gap-2 flex-wrap">
                  {EXPORT_FORMATS.map(f => (
                    <button key={f.value} onClick={() => setExportFormat(f.value)}
                      className={cn("rounded-md px-3 py-1.5 text-xs border transition-colors",
                        f.value === exportFormat ? "border-accent bg-accent/10 text-accent font-medium" : "border-border-default text-text-secondary hover:bg-bg-hover")}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 输出文件 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">{t("dbClient.outputFile")}</label>
                <div className="flex gap-2">
                  <input value={outputPath} onChange={e => setOutputPath(e.target.value)} placeholder={genFilename("dump", "sql")}
                    className="flex-1 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" />
                  <button onClick={handlePickExportPath} className="rounded-md border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover"><FolderOpen size={14} /></button>
                </div>
              </div>

              {/* SQL Dump 选项 */}
              {exportFormat === "sql" && (
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input type="checkbox" checked={dataOnly} onChange={e => { setDataOnly(e.target.checked); if (e.target.checked) setSchemaOnly(false); }} className="h-3 w-3 rounded" />
                    {t("dbClient.dataOnly")}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input type="checkbox" checked={schemaOnly} onChange={e => { setSchemaOnly(e.target.checked); if (e.target.checked) setDataOnly(false); }} className="h-3 w-3 rounded" />
                    {t("dbClient.schemaOnly")}
                  </label>
                </div>
              )}

              {/* 表选择 */}
              {!defaultTables?.length && allTables.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    {t("dbClient.exportTables")}
                    <span className="text-text-tertiary font-normal ml-1">({selectedTables.size === 0 ? t("dbClient.exportAllTables") : `${selectedTables.size}/${allTables.length}`})</span>
                  </label>
                  <div className="border border-border-default rounded-md max-h-[100px] overflow-y-auto bg-bg-secondary">
                    <div className="sticky top-0 bg-bg-secondary border-b border-border-default/30 px-2 py-1">
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                        <input type="checkbox" checked={selectedTables.size === allTables.length}
                          ref={el => { if (el) el.indeterminate = selectedTables.size > 0 && selectedTables.size < allTables.length; }}
                          onChange={toggleAllTables} className="h-3 w-3 rounded" />
                        {t("dbClient.selectAll")}
                      </label>
                    </div>
                    {allTables.map(tbl => (
                      <label key={tbl.name} className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-text-primary hover:bg-bg-hover cursor-pointer">
                        <input type="checkbox" checked={selectedTables.has(tbl.name)} onChange={() => toggleTable(tbl.name)} className="h-3 w-3 rounded" />
                        {tbl.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 高级选项 */}
              {exportFormat === "sql" && (
                <div>
                  <button onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary">
                    {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {t("dbClient.advancedOptions")}
                  </button>
                  {showAdvanced && (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-text-tertiary">{t("dbClient.toolPath")} ({toolName})</label>
                      <div className="flex gap-2">
                        <input value={toolPath} onChange={e => setToolPath(e.target.value)} placeholder={t("dbClient.toolPathPlaceholder")}
                          className="flex-1 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary font-mono focus:border-accent focus:outline-none" />
                        <button onClick={handlePickToolPath} className="rounded-md border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover"><FolderOpen size={14} /></button>
                      </div>
                      <p className="mt-1 text-xs text-text-quaternary">{t("dbClient.toolPathHint")}</p>
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleExport} disabled={running || !outputPath}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {t("dbClient.startExport")}
              </button>
            </>
          )}

          {mode === "import" && supportsImport && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">{t("dbClient.importFile")}</label>
                <div className="flex gap-2">
                  <input value={importPath} onChange={e => setImportPath(e.target.value)} placeholder="/path/to/dump.sql"
                    className="flex-1 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" />
                  <button onClick={handlePickImportFile} className="rounded-md border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover"><FolderOpen size={14} /></button>
                </div>
              </div>
              <button onClick={handleImport} disabled={running || !importPath}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {t("dbClient.startImport")}
              </button>
            </>
          )}

          {result && (
            <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs",
              result.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500")}>
              {result.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
              <span className="break-all">{result.msg}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
