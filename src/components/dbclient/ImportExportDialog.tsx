// 导出/导入 — 完全独立的两个对话框

import { memo, useState, useEffect } from "react";
import {
  Download, Upload, Loader2, CheckCircle2, AlertCircle, FolderOpen,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as dbService from "@/services/dbClientService";
import { useDbClientStore } from "@/stores/dbClientStore";
import type { ConnectionConfig, ExportOptions, ImportOptions } from "@/types/dbclient";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  connectionConfig: ConnectionConfig | null;
  selectedDatabase: string | null;
  defaultTables?: string[];
}

type ExportFormat = "sql" | "insert" | "csv" | "tsv" | "markdown";
const FMT_LIST: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "sql", label: "SQL Dump", ext: "sql" },
  { value: "insert", label: "INSERT Statements", ext: "sql" },
  { value: "csv", label: "CSV", ext: "csv" },
  { value: "tsv", label: "TSV", ext: "tsv" },
  { value: "markdown", label: "Markdown Table", ext: "md" },
];

function mkTs() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }

// ── 入口：根据 props 渲染导出或导入对话框 ──
// 由外部控制显示哪个，这里只是转发
export const ImportExportDialog = memo(function ImportExportDialog(props: Props) {
  if (!props.open || !props.connectionConfig) return null;
  // 默认显示导出对话框
  return <ExportDialog {...props} />;
});

// 单独导出导入对话框组件（供外部直接使用）
export { ExportDialog, ImportDialog };

// ═══════════════════════════════════════════
// 导出对话框
// ═══════════════════════════════════════════

function ExportDialog({ open: isOpen, onClose, sessionId, connectionConfig, selectedDatabase, defaultTables }: Props) {
  const schemaObjects = useDbClientStore(sessionId, (s) => s.schemaObjects);
  const allTables = schemaObjects?.tables ?? [];

  const [fmt, setFmt] = useState<ExportFormat>("sql");
  const [path, setPath] = useState("");
  const [dataOnly, setDataOnly] = useState(false);
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [toolPath, setToolPath] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setResult(null); setRunning(false);
      // 如果没有指定默认表（从数据库级别导出），则选中所有表
      const tables = defaultTables && defaultTables.length > 0
        ? defaultTables
        : allTables.map(t => t.name);
      setSel(new Set(tables));
      setPath(`${defaultTables?.[0] ?? selectedDatabase ?? "dump"}_${mkTs()}.sql`);
    }
  }, [isOpen, defaultTables, selectedDatabase]);

  useEffect(() => {
    if (!path) return;
    const ext = FMT_LIST.find(f => f.value === fmt)?.ext ?? "sql";
    setPath(p => p.replace(/\.[^.]+$/, `.${ext}`));
  }, [fmt]);

  if (!connectionConfig) return null;

  const toggle = (n: string) => setSel(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const toggleAll = () => setSel(p => p.size === allTables.length ? new Set() : new Set(allTables.map(t => t.name)));

  const pickPath = async () => {
    const ext = FMT_LIST.find(f => f.value === fmt)?.ext ?? "sql";
    const p = await save({ defaultPath: path, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (p) setPath(p);
  };

  const doExport = async () => {
    if (!path) return;
    setRunning(true); setResult(null);
    try {
      const opts: ExportOptions = { format: fmt, outputPath: path, database: selectedDatabase ?? connectionConfig.database, schema: null, tables: Array.from(sel), dataOnly, schemaOnly, toolPath: toolPath || null };
      const res = await dbService.exportDatabase(sessionId, connectionConfig, opts);
      setResult({ ok: true, msg: `导出完成：${fmtB(res.sizeBytes)}，耗时 ${res.durationMs}ms` });
    } catch (e) { setResult({ ok: false, msg: String(e) }); }
    setRunning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="!w-[660px] !max-w-[96vw] !gap-0 !p-0 !rounded-xl sm:!max-w-[660px]" showCloseButton>
        <DialogTitle className="sr-only">导出</DialogTitle>
        <div className="flex rounded-xl overflow-hidden max-h-[70vh]">
          {/* 左：表列表 */}
          <div className="w-[220px] shrink-0 border-r border-border-default bg-bg-secondary/30 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default/50 shrink-0">
              <span className="text-xs font-semibold text-text-primary">导出表</span>
              <span className="text-[10px] text-text-quaternary">{sel.size}/{allTables.length}</span>
            </div>
            <div className="px-3 py-1 border-b border-border-default/30 shrink-0">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                <input type="checkbox" checked={sel.size === allTables.length}
                  ref={el => { if (el) el.indeterminate = sel.size > 0 && sel.size < allTables.length; }}
                  onChange={toggleAll} className="h-3.5 w-3.5 rounded" />
                全选 / 全不选
              </label>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {allTables.map(tbl => (
                <label key={tbl.name} className={cn(
                  "flex items-center gap-2 px-3 py-0.5 text-xs cursor-pointer select-none",
                  sel.has(tbl.name) ? "bg-accent/8 text-text-primary" : "text-text-secondary hover:bg-bg-hover",
                )}>
                  <input type="checkbox" checked={sel.has(tbl.name)} onChange={() => toggle(tbl.name)} className="h-3.5 w-3.5 rounded shrink-0" />
                  <span className="truncate flex-1">{tbl.name}</span>
                  {tbl.rowCountEstimate != null && tbl.rowCountEstimate > 0 && (
                    <span className="text-[10px] text-text-quaternary tabular-nums shrink-0">
                      {tbl.rowCountEstimate > 999 ? `${(tbl.rowCountEstimate / 1000).toFixed(1)}K` : tbl.rowCountEstimate}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* 右：选项 — 流式布局，内容决定弹框高度 */}
          <div className="flex-1 min-w-0">
            <div className="p-4 pb-3 space-y-3">
              <Fld label="导出格式">
                <select value={fmt} onChange={e => setFmt(e.target.value as ExportFormat)}
                  className="w-full rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none">
                  {FMT_LIST.map(f => <option key={f.value} value={f.value}>{f.label} (.{f.ext})</option>)}
                </select>
              </Fld>

              <Fld label="输出文件">
                <div className="flex gap-2">
                  <input value={path} onChange={e => setPath(e.target.value)}
                    className="flex-1 rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-xs text-text-primary font-mono focus:border-accent focus:outline-none min-w-0" />
                  <button onClick={pickPath} className="rounded-md border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover shrink-0"><FolderOpen size={13} /></button>
                </div>
              </Fld>

              {fmt === "sql" && (
                <>
                  <div className="flex gap-5">
                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                      <input type="checkbox" checked={dataOnly} onChange={e => { setDataOnly(e.target.checked); if (e.target.checked) setSchemaOnly(false); }} className="h-3.5 w-3.5 rounded" />
                      仅数据
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                      <input type="checkbox" checked={schemaOnly} onChange={e => { setSchemaOnly(e.target.checked); if (e.target.checked) setDataOnly(false); }} className="h-3.5 w-3.5 rounded" />
                      仅结构
                    </label>
                  </div>
                  <div>
                    <button onClick={() => setShowAdv(!showAdv)} className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary">
                      {showAdv ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 高级选项
                    </button>
                    {showAdv && (
                      <div className="mt-2 ml-4 border-l-2 border-border-default/30 pl-3 space-y-1">
                        <label className="block text-[11px] text-text-tertiary">工具路径（留空自动检测）</label>
                        <div className="flex gap-2">
                          <input value={toolPath} onChange={e => setToolPath(e.target.value)} placeholder="自动检测"
                            className="flex-1 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1 text-xs text-text-primary font-mono focus:border-accent focus:outline-none min-w-0" />
                          <button onClick={async () => { const p = await openDialog({ multiple: false }); if (p) setToolPath(p as string); }}
                            className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-text-tertiary hover:bg-bg-hover shrink-0"><FolderOpen size={12} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {result && (
                <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs",
                  result.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500")}>
                  {result.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
                  <span className="break-all">{result.msg}</span>
                </div>
              )}

              <button onClick={doExport} disabled={running || !path}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 开始导出
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// 导入对话框
// ═══════════════════════════════════════════

function ImportDialog({ open: isOpen, onClose, sessionId, connectionConfig, selectedDatabase }: Props) {
  const [importPath, setImportPath] = useState("");
  const [toolPath, setToolPath] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { if (isOpen) { setResult(null); setRunning(false); } }, [isOpen]);

  if (!connectionConfig) return null;
  const ok = connectionConfig.dbType === "postgresql" || connectionConfig.dbType === "mysql";

  const pickFile = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: "SQL / Dump", extensions: ["sql", "dump", "backup", "gz", "csv"] }] });
    if (p) setImportPath(p as string);
  };

  const doImport = async () => {
    if (!importPath) return;
    setRunning(true); setResult(null);
    try {
      const opts: ImportOptions = { filePath: importPath, database: selectedDatabase ?? connectionConfig.database, schema: null, toolPath: toolPath || null };
      const res = await dbService.importDatabase(sessionId, connectionConfig, opts);
      setResult({ ok: true, msg: `导入完成，耗时 ${res.durationMs}ms${res.warnings.length ? ` (${res.warnings.length} 个警告)` : ""}` });
    } catch (e) { setResult({ ok: false, msg: String(e) }); }
    setRunning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="!w-[400px] !max-w-[96vw] !gap-0 !p-0 !rounded-xl sm:!max-w-[400px]" showCloseButton>
        <DialogTitle className="sr-only">导入</DialogTitle>
        <div className="p-4 space-y-3">
          {!ok ? (
            <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">当前数据库类型不支持导入</div>
          ) : (
            <>
              <Fld label="导入文件">
                <div className="flex gap-2">
                  <input value={importPath} onChange={e => setImportPath(e.target.value)} placeholder="/path/to/dump.sql"
                    className="flex-1 rounded-md border border-border-default bg-bg-secondary px-3 py-1.5 text-xs text-text-primary font-mono focus:border-accent focus:outline-none min-w-0" />
                  <button onClick={pickFile} className="rounded-md border border-border-default bg-bg-secondary px-2 py-1.5 text-text-tertiary hover:bg-bg-hover shrink-0"><FolderOpen size={13} /></button>
                </div>
              </Fld>

              <div>
                <button onClick={() => setShowAdv(!showAdv)} className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary">
                  {showAdv ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 高级选项
                </button>
                {showAdv && (
                  <div className="mt-2 ml-4 border-l-2 border-border-default/30 pl-3">
                    <label className="block text-[11px] text-text-tertiary mb-1">工具路径</label>
                    <input value={toolPath} onChange={e => setToolPath(e.target.value)} placeholder="自动检测"
                      className="w-full rounded-md border border-border-default bg-bg-secondary px-2.5 py-1 text-xs text-text-primary font-mono focus:border-accent focus:outline-none" />
                  </div>
                )}
              </div>

              {result && (
                <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs",
                  result.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500")}>
                  {result.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
                  <span className="break-all">{result.msg}</span>
                </div>
              )}

              <button onClick={doImport} disabled={running || !importPath}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 开始导入
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>{children}</div>;
}

function fmtB(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; }
