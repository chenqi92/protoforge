// 批量重命名工具 — 支持前缀/后缀/搜索替换/正则/序号

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw, CheckCircle2, AlertCircle, File, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { listDirectory, batchRename, type FileEntry, type BatchResult } from "@/services/toolboxService";

type RenameOp = "prefix" | "suffix" | "searchReplace" | "regexReplace" | "sequence";

export function BatchRenamerTool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.batchRenamer";

  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [operation, setOperation] = useState<RenameOp>("prefix");
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeDirs, setIncludeDirs] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  // 操作参数
  const [prefixText, setPrefixText] = useState("");
  const [suffixText, setSuffixText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [regexPattern, setRegexPattern] = useState("");
  const [regexReplacement, setRegexReplacement] = useState("");
  const [seqPrefix, setSeqPrefix] = useState("");
  const [seqStart, setSeqStart] = useState(1);
  const [seqPadding, setSeqPadding] = useState(3);
  const [seqKeepExt, setSeqKeepExt] = useState(true);

  const handleSelectDir = useCallback(async () => {
    const dir = await open({ directory: true });
    if (dir) {
      setDirectoryPath(dir as string);
      setResult(null);
      try {
        const entries = await listDirectory(dir as string);
        setFiles(entries);
      } catch (e) {
        setFiles([]);
      }
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!directoryPath) return;
    try {
      const entries = await listDirectory(directoryPath);
      setFiles(entries);
      setResult(null);
    } catch {
      setFiles([]);
    }
  }, [directoryPath]);

  // 过滤出参与重命名的文件
  const targetFiles = useMemo(() => {
    return files.filter((f) => {
      if (f.is_dir && !includeDirs) return false;
      if (!f.is_dir && !includeFiles) return false;
      return true;
    });
  }, [files, includeFiles, includeDirs]);

  // 计算预览
  const preview = useMemo(() => {
    return targetFiles.map((f, i) => {
      let newName = f.name;

      switch (operation) {
        case "prefix":
          if (prefixText) newName = prefixText + f.name;
          break;

        case "suffix": {
          if (!suffixText) break;
          const dotIdx = f.name.lastIndexOf(".");
          if (dotIdx > 0 && !f.is_dir) {
            newName = f.name.slice(0, dotIdx) + suffixText + f.name.slice(dotIdx);
          } else {
            newName = f.name + suffixText;
          }
          break;
        }

        case "searchReplace":
          if (searchText) {
            newName = f.name.split(searchText).join(replaceText);
          }
          break;

        case "regexReplace":
          if (regexPattern) {
            try {
              const re = new RegExp(regexPattern, "g");
              newName = f.name.replace(re, regexReplacement);
            } catch {
              // invalid regex, keep original
            }
          }
          break;

        case "sequence": {
          const num = String(seqStart + i).padStart(seqPadding, "0");
          if (seqKeepExt && !f.is_dir) {
            const dotIdx = f.name.lastIndexOf(".");
            const ext = dotIdx > 0 ? f.name.slice(dotIdx) : "";
            newName = seqPrefix + num + ext;
          } else {
            newName = seqPrefix + num;
          }
          break;
        }
      }

      return { original: f.name, renamed: newName, changed: newName !== f.name };
    });
  }, [targetFiles, operation, prefixText, suffixText, searchText, replaceText, regexPattern, regexReplacement, seqPrefix, seqStart, seqPadding, seqKeepExt]);

  const changedCount = preview.filter((p) => p.changed).length;

  const handleApply = useCallback(async () => {
    if (!directoryPath || changedCount === 0) return;
    if (!window.confirm(t(`${k}.applyConfirm`))) return;

    const renames: [string, string][] = preview
      .filter((p) => p.changed)
      .map((p) => [p.original, p.renamed]);

    setProcessing(true);
    setResult(null);
    try {
      const res = await batchRename(directoryPath, renames);
      setResult(res);
      // 刷新文件列表
      const entries = await listDirectory(directoryPath);
      setFiles(entries);
    } catch (e) {
      setResult({ success_count: 0, errors: [String(e)] });
    } finally {
      setProcessing(false);
    }
  }, [directoryPath, changedCount, preview, t, k]);

  const opOptions = [
    { value: "prefix" as RenameOp, label: t(`${k}.prefix`) },
    { value: "suffix" as RenameOp, label: t(`${k}.suffix`) },
    { value: "searchReplace" as RenameOp, label: t(`${k}.searchReplace`) },
    { value: "regexReplace" as RenameOp, label: t(`${k}.regexReplace`) },
    { value: "sequence" as RenameOp, label: t(`${k}.sequence`) },
  ];

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* 选择目录 */}
      <section>
        <div className="flex items-center gap-3">
          <button onClick={handleSelectDir} className="wb-ghost-btn gap-2 px-3 py-2">
            <FolderOpen className="h-4 w-4" />
            {t(`${k}.selectDir`)}
          </button>
          {directoryPath && (
            <>
              <span className="truncate pf-text-sm text-text-secondary">
                {directoryPath}
              </span>
              <button onClick={handleRefresh} className="wb-icon-btn" title={t(`${k}.refresh`)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <span className="pf-text-xs text-text-disabled">
                {t(`${k}.fileCount`, { count: files.length })}
              </span>
            </>
          )}
        </div>
      </section>

      {directoryPath && files.length > 0 && (
        <>
          {/* 过滤类型 */}
          <section className="flex items-center gap-4">
            <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includeFiles}
                onChange={() => setIncludeFiles(!includeFiles)}
                className="accent-orange-500"
              />
              <File className="h-3.5 w-3.5" />
              {t(`${k}.includeFiles`)}
            </label>
            <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includeDirs}
                onChange={() => setIncludeDirs(!includeDirs)}
                className="accent-orange-500"
              />
              <Folder className="h-3.5 w-3.5" />
              {t(`${k}.includeDirs`)}
            </label>
          </section>

          {/* 操作类型 */}
          <section>
            <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">{t(`${k}.operation`)}</h3>
            <SegmentedControl
              options={opOptions}
              value={operation}
              onChange={setOperation}
              size="sm"
            />
          </section>

          {/* 操作参数 */}
          <section className="flex flex-wrap gap-3">
            {operation === "prefix" && (
              <input
                type="text"
                value={prefixText}
                onChange={(e) => setPrefixText(e.target.value)}
                placeholder={t(`${k}.prefixPlaceholder`)}
                className="wb-input w-64"
              />
            )}
            {operation === "suffix" && (
              <input
                type="text"
                value={suffixText}
                onChange={(e) => setSuffixText(e.target.value)}
                placeholder={t(`${k}.suffixPlaceholder`)}
                className="wb-input w-64"
              />
            )}
            {operation === "searchReplace" && (
              <>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={t(`${k}.searchPlaceholder`)}
                  className="wb-input w-64"
                />
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder={t(`${k}.replacePlaceholder`)}
                  className="wb-input w-64"
                />
              </>
            )}
            {operation === "regexReplace" && (
              <>
                <input
                  type="text"
                  value={regexPattern}
                  onChange={(e) => setRegexPattern(e.target.value)}
                  placeholder={t(`${k}.regexPattern`)}
                  className="wb-input w-64 font-mono"
                />
                <input
                  type="text"
                  value={regexReplacement}
                  onChange={(e) => setRegexReplacement(e.target.value)}
                  placeholder={t(`${k}.regexReplacement`)}
                  className="wb-input w-64"
                />
              </>
            )}
            {operation === "sequence" && (
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={seqPrefix}
                  onChange={(e) => setSeqPrefix(e.target.value)}
                  placeholder={t(`${k}.seqPrefix`)}
                  className="wb-input w-40"
                />
                <label className="flex items-center gap-1.5 pf-text-sm text-text-secondary">
                  {t(`${k}.seqStart`)}
                  <input
                    type="number"
                    value={seqStart}
                    onChange={(e) => setSeqStart(Number(e.target.value) || 1)}
                    className="wb-input w-20"
                    min={0}
                  />
                </label>
                <label className="flex items-center gap-1.5 pf-text-sm text-text-secondary">
                  {t(`${k}.seqPadding`)}
                  <input
                    type="number"
                    value={seqPadding}
                    onChange={(e) => setSeqPadding(Number(e.target.value) || 1)}
                    className="wb-input w-20"
                    min={1}
                    max={10}
                  />
                </label>
                <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={seqKeepExt}
                    onChange={() => setSeqKeepExt(!seqKeepExt)}
                    className="accent-orange-500"
                  />
                  {t(`${k}.seqExtension`)}
                </label>
              </div>
            )}
          </section>

          {/* 预览表格 */}
          <section>
            <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">{t(`${k}.preview`)}</h3>
            <div className="max-h-[400px] overflow-auto rounded-lg border border-border-default/60">
              <table className="w-full">
                <thead className="sticky top-0 bg-bg-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left pf-text-xs font-medium text-text-tertiary">#</th>
                    <th className="px-3 py-2 text-left pf-text-xs font-medium text-text-tertiary">{t(`${k}.original`)}</th>
                    <th className="px-3 py-2 text-left pf-text-xs font-medium text-text-tertiary">{t(`${k}.renamed`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-t border-border-default/30",
                        row.changed && "bg-orange-500/5"
                      )}
                    >
                      <td className="px-3 py-1.5 pf-text-xs text-text-disabled">{i + 1}</td>
                      <td className="px-3 py-1.5 pf-text-sm text-text-secondary">
                        <span className="flex items-center gap-1.5">
                          {targetFiles[i]?.is_dir
                            ? <Folder className="h-3.5 w-3.5 text-amber-500" />
                            : <File className="h-3.5 w-3.5 text-text-disabled" />}
                          {row.original}
                        </span>
                      </td>
                      <td className={cn("px-3 py-1.5 pf-text-sm", row.changed ? "font-medium text-orange-600" : "text-text-disabled")}>
                        {row.renamed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 应用按钮 */}
          <section className="flex items-center gap-4">
            <button
              onClick={handleApply}
              disabled={changedCount === 0 || processing}
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2.5 pf-text-sm font-medium transition-colors",
                changedCount > 0 && !processing
                  ? "bg-orange-500 text-white hover:bg-orange-600"
                  : "cursor-not-allowed bg-bg-secondary text-text-disabled"
              )}
            >
              {t(`${k}.apply`)}
              {changedCount > 0 && ` (${changedCount})`}
            </button>

            {result && (
              <div className="flex items-center gap-3">
                {result.success_count > 0 && (
                  <span className="flex items-center gap-1.5 pf-text-sm text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("toolWorkbench.toolbox.screenshotResizer.successCount", { count: result.success_count })}
                  </span>
                )}
                {result.errors.length > 0 && (
                  <span className="flex items-center gap-1.5 pf-text-sm text-rose-600">
                    <AlertCircle className="h-4 w-4" />
                    {t("toolWorkbench.toolbox.screenshotResizer.errorCount", { count: result.errors.length })}
                  </span>
                )}
              </div>
            )}
          </section>

          {result && result.errors.length > 0 && (
            <section className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="space-y-1">
                {result.errors.map((err, i) => (
                  <div key={i} className="pf-text-xs text-rose-600">{err}</div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
