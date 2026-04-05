// 导入导出对话框 — 使用项目统一 Dialog 组件

import { memo, useState, useCallback } from "react";
import {
  Download, Upload, Loader2, CheckCircle2, AlertCircle, FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as dbService from "@/services/dbClientService";
import type {
  ConnectionConfig,
  ExportOptions,
  ImportOptions,
} from "@/types/dbclient";

interface ImportExportDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  connectionConfig: ConnectionConfig | null;
  selectedDatabase: string | null;
}

type Mode = "export" | "import";

export const ImportExportDialog = memo(function ImportExportDialog({
  open: isOpen,
  onClose,
  sessionId,
  connectionConfig,
  selectedDatabase,
}: ImportExportDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("export");
  const [outputPath, setOutputPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [dataOnly, setDataOnly] = useState(false);
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!connectionConfig) return null;

  const supportsExport = connectionConfig.dbType !== "influxdb";

  const handlePickExportPath = async () => {
    const path = await save({
      title: t("dbClient.exportSelectPath"),
      defaultPath: `${selectedDatabase ?? "dump"}.sql`,
      filters: [
        { name: "SQL", extensions: ["sql"] },
        { name: t("dbClient.allFiles"), extensions: ["*"] },
      ],
    });
    if (path) setOutputPath(path);
  };

  const handlePickImportFile = async () => {
    const path = await open({
      title: t("dbClient.importSelectFile"),
      multiple: false,
      filters: [
        { name: "SQL / Dump", extensions: ["sql", "dump", "backup", "gz"] },
        { name: t("dbClient.allFiles"), extensions: ["*"] },
      ],
    });
    if (path) setImportPath(path as string);
  };

  const handleExport = async () => {
    if (!outputPath) return;
    setRunning(true);
    setResult(null);
    try {
      const options: ExportOptions = {
        format: "sql", outputPath,
        database: selectedDatabase ?? connectionConfig.database,
        schema: null, tables: [], dataOnly, schemaOnly, toolPath: null,
      };
      const res = await dbService.exportDatabase(sessionId, connectionConfig, options);
      setResult({ ok: true, msg: t("dbClient.exportSuccess", { size: formatBytes(res.sizeBytes), time: res.durationMs }) });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
    setRunning(false);
  };

  const handleImport = async () => {
    if (!importPath) return;
    setRunning(true);
    setResult(null);
    try {
      const options: ImportOptions = {
        filePath: importPath,
        database: selectedDatabase ?? connectionConfig.database,
        schema: null, toolPath: null,
      };
      const res = await dbService.importDatabase(sessionId, connectionConfig, options);
      const warnings = res.warnings.length > 0 ? ` (${res.warnings.length} ${t("dbClient.warnings")})` : "";
      setResult({ ok: true, msg: t("dbClient.importSuccess", { time: res.durationMs }) + warnings });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
    setRunning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="w-[480px] max-w-[96vw] gap-0 overflow-hidden pf-rounded-xl border border-border-default/60 bg-bg-primary p-0 shadow-[0_32px_90px_rgba(15,23,42,0.18)] sm:max-w-[480px]"
        showCloseButton
      >
        <DialogTitle className="sr-only">{t("dbClient.importExport")}</DialogTitle>

        {/* 头部 */}
        <div className="border-b border-border-default/50 px-5 py-4">
          <h2 className="pf-text-sm font-semibold text-text-primary">{t("dbClient.importExport")}</h2>
        </div>

        {/* 模式切换 */}
        <div className="flex border-b border-border-default/50">
          <button
            onClick={() => { setMode("export"); setResult(null); }}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 py-2.5 pf-text-sm font-medium transition-colors",
              mode === "export" ? "border-b-2 border-accent-primary text-accent-primary" : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <Download size={14} />
            {t("dbClient.export")}
          </button>
          <button
            onClick={() => { setMode("import"); setResult(null); }}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 py-2.5 pf-text-sm font-medium transition-colors",
              mode === "import" ? "border-b-2 border-accent-primary text-accent-primary" : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <Upload size={14} />
            {t("dbClient.import")}
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {!supportsExport && mode === "export" && (
            <div className="pf-rounded-sm bg-amber-500/10 px-3 py-2 pf-text-xs text-amber-600">
              {t("dbClient.exportNotSupported")}
            </div>
          )}

          {mode === "export" && supportsExport && (
            <>
              <div>
                <label className="mb-1.5 block pf-text-xs font-medium text-text-secondary">{t("dbClient.outputFile")}</label>
                <div className="flex gap-2">
                  <input value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="/path/to/dump.sql" className="flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
                  <button onClick={handlePickExportPath} className="pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover">
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 pf-text-xs text-text-secondary">
                  <input type="checkbox" checked={dataOnly} onChange={(e) => { setDataOnly(e.target.checked); if (e.target.checked) setSchemaOnly(false); }} className="h-3 w-3 rounded" />
                  {t("dbClient.dataOnly")}
                </label>
                <label className="flex items-center gap-1.5 pf-text-xs text-text-secondary">
                  <input type="checkbox" checked={schemaOnly} onChange={(e) => { setSchemaOnly(e.target.checked); if (e.target.checked) setDataOnly(false); }} className="h-3 w-3 rounded" />
                  {t("dbClient.schemaOnly")}
                </label>
              </div>
              <button onClick={handleExport} disabled={running || !outputPath} className="flex w-full items-center justify-center gap-2 pf-rounded-sm bg-accent-primary px-4 py-2 pf-text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {t("dbClient.startExport")}
              </button>
            </>
          )}

          {mode === "import" && (
            <>
              <div>
                <label className="mb-1.5 block pf-text-xs font-medium text-text-secondary">{t("dbClient.importFile")}</label>
                <div className="flex gap-2">
                  <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="/path/to/dump.sql" className="flex-1 pf-rounded-sm border border-border-default bg-bg-secondary px-2.5 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
                  <button onClick={handlePickImportFile} className="pf-rounded-sm border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover">
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>
              <button onClick={handleImport} disabled={running || !importPath} className="flex w-full items-center justify-center gap-2 pf-rounded-sm bg-accent-primary px-4 py-2 pf-text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {t("dbClient.startImport")}
              </button>
            </>
          )}

          {result && (
            <div className={cn(
              "flex items-start gap-2 pf-rounded-sm px-3 py-2 pf-text-xs",
              result.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500",
            )}>
              {result.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
              <span className="break-all">{result.msg}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
