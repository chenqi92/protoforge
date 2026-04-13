// 批量重命名工具 — 支持前缀/后缀/搜索替换(含正则)/多种序号命名

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RefreshCw, CheckCircle2, AlertCircle, File, Folder, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { listDirectory, batchRename, type FileEntry, type BatchResult } from "@/services/toolboxService";
import { ToolboxToolPane } from "./ToolboxToolPane";

type RenameOp = "prefix" | "suffix" | "searchReplace" | "sequence";
type SeqType = "number" | "chinese" | "letter" | "letterUpper" | "roman";

// ── 序号生成器 ──

const CHINESE_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function toChineseNumber(n: number): string {
  if (n < 0) return n.toString();
  if (n <= 9) return CHINESE_DIGITS[n];
  if (n <= 99) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    let s = "";
    if (tens > 1) s += CHINESE_DIGITS[tens];
    s += "十";
    if (ones > 0) s += CHINESE_DIGITS[ones];
    return s;
  }
  // 100+: 简单拼接
  return String(n).split("").map((d) => CHINESE_DIGITS[Number(d)]).join("");
}

function toLetter(n: number, upper: boolean): string {
  // 1->a, 2->b, ... 26->z, 27->aa, 28->ab...
  let result = "";
  let num = n;
  while (num > 0) {
    num--;
    result = String.fromCharCode((upper ? 65 : 97) + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result || (upper ? "A" : "a");
}

function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n);
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let result = "";
  let num = n;
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}

function generateSeqLabel(index: number, type: SeqType, padding: number): string {
  switch (type) {
    case "number":
      return String(index).padStart(padding, "0");
    case "chinese":
      return toChineseNumber(index);
    case "letter":
      return toLetter(index, false);
    case "letterUpper":
      return toLetter(index, true);
    case "roman":
      return toRoman(index);
  }
}

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
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 操作参数
  const [prefixText, setPrefixText] = useState("");
  const [suffixText, setSuffixText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [seqPrefix, setSeqPrefix] = useState("");
  const [seqStart, setSeqStart] = useState(1);
  const [seqPadding, setSeqPadding] = useState(3);
  const [seqKeepExt, setSeqKeepExt] = useState(true);
  const [seqType, setSeqType] = useState<SeqType>("number");

  const hasDir = !!directoryPath;

  const handleSelectDir = useCallback(async () => {
    const dir = await open({ directory: true });
    if (dir) {
      setDirectoryPath(dir as string);
      setResult(null);
      try {
        const entries = await listDirectory(dir as string);
        setFiles(entries);
      } catch {
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
            if (useRegex) {
              try {
                const re = new RegExp(searchText, "g");
                newName = f.name.replace(re, replaceText);
              } catch {
                // invalid regex
              }
            } else {
              newName = f.name.split(searchText).join(replaceText);
            }
          }
          break;

        case "sequence": {
          const seq = generateSeqLabel(seqStart + i, seqType, seqPadding);
          if (seqKeepExt && !f.is_dir) {
            const dotIdx = f.name.lastIndexOf(".");
            const ext = dotIdx > 0 ? f.name.slice(dotIdx) : "";
            newName = seqPrefix + seq + ext;
          } else {
            newName = seqPrefix + seq;
          }
          break;
        }
      }

      return { original: f.name, renamed: newName, changed: newName !== f.name, isDir: f.is_dir };
    });
  }, [targetFiles, operation, prefixText, suffixText, searchText, replaceText, useRegex, seqPrefix, seqStart, seqPadding, seqKeepExt, seqType]);

  const changedItems = preview.filter((p) => p.changed);
  const changedCount = changedItems.length;

  const handleRequestApply = useCallback(() => {
    if (changedCount === 0) return;
    setConfirmOpen(true);
  }, [changedCount]);

  const handleConfirmApply = useCallback(async () => {
    setConfirmOpen(false);
    if (!directoryPath || changedCount === 0) return;

    const renames: [string, string][] = changedItems.map((p) => [p.original, p.renamed]);

    setProcessing(true);
    setResult(null);
    try {
      const res = await batchRename(directoryPath, renames);
      setResult(res);
      const entries = await listDirectory(directoryPath);
      setFiles(entries);
    } catch (e) {
      setResult({ success_count: 0, errors: [String(e)] });
    } finally {
      setProcessing(false);
    }
  }, [directoryPath, changedCount, changedItems]);

  const opOptions = [
    { value: "prefix" as RenameOp, label: t(`${k}.prefix`) },
    { value: "suffix" as RenameOp, label: t(`${k}.suffix`) },
    { value: "searchReplace" as RenameOp, label: t(`${k}.searchReplace`) },
    { value: "sequence" as RenameOp, label: t(`${k}.sequence`) },
  ];

  const seqTypeOptions = [
    { value: "number" as SeqType, label: t(`${k}.seqTypeNumber`) },
    { value: "chinese" as SeqType, label: t(`${k}.seqTypeChinese`) },
    { value: "letter" as SeqType, label: t(`${k}.seqTypeLetter`) },
    { value: "letterUpper" as SeqType, label: t(`${k}.seqTypeLetterUpper`) },
    { value: "roman" as SeqType, label: t(`${k}.seqTypeRoman`) },
  ];

  return (
    <ToolboxToolPane>
      {/* 目录选择 */}
      <section className="flex items-center gap-3">
        <button onClick={handleSelectDir} className="wb-ghost-btn gap-2 px-3 py-2">
          <FolderOpen className="h-4 w-4" />
          {t(`${k}.selectDir`)}
        </button>
        {hasDir && (
          <>
            <span className="min-w-0 truncate pf-text-sm text-text-secondary">{directoryPath}</span>
            <button onClick={handleRefresh} className="wb-icon-btn shrink-0" title={t(`${k}.refresh`)}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <span className="shrink-0 pf-text-xs text-text-disabled">
              {t(`${k}.fileCount`, { count: files.length })}
            </span>
          </>
        )}
      </section>

      {/* 过滤 + 操作类型 — 始终显示 */}
      <section className="flex items-center gap-4">
        <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
          <input type="checkbox" checked={includeFiles} onChange={() => setIncludeFiles(!includeFiles)} className="accent-orange-500" />
          <File className="h-3.5 w-3.5" />
          {t(`${k}.includeFiles`)}
        </label>
        <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
          <input type="checkbox" checked={includeDirs} onChange={() => setIncludeDirs(!includeDirs)} className="accent-orange-500" />
          <Folder className="h-3.5 w-3.5" />
          {t(`${k}.includeDirs`)}
        </label>
      </section>

      <section>
        <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">{t(`${k}.operation`)}</h3>
        <SegmentedControl options={opOptions} value={operation} onChange={setOperation} size="sm" />
      </section>

      {/* 操作参数 — 始终显示 */}
      <section>
        {operation === "prefix" && (
          <input
            type="text"
            value={prefixText}
            onChange={(e) => setPrefixText(e.target.value)}
            placeholder={t(`${k}.prefixPlaceholder`)}
            className="wb-field w-80"
          />
        )}

        {operation === "suffix" && (
          <input
            type="text"
            value={suffixText}
            onChange={(e) => setSuffixText(e.target.value)}
            placeholder={t(`${k}.suffixPlaceholder`)}
            className="wb-field w-80"
          />
        )}

        {operation === "searchReplace" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t(`${k}.searchPlaceholder`)}
                className={cn("wb-field w-72", useRegex && "font-mono")}
              />
              <ArrowRight className="h-4 w-4 shrink-0 text-text-disabled" />
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={t(`${k}.replacePlaceholder`)}
                className="wb-field w-72"
              />
            </div>
            <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
              <input type="checkbox" checked={useRegex} onChange={() => setUseRegex(!useRegex)} className="accent-orange-500" />
              <span>{t(`${k}.useRegex`)}</span>
              <span className="pf-text-xs text-text-disabled">— {t(`${k}.regexHint`)}</span>
            </label>
          </div>
        )}

        {operation === "sequence" && (
          <div className="flex flex-col gap-3">
            {/* 序号类型选择 */}
            <div>
              <div className="mb-1.5 pf-text-xs font-medium text-text-tertiary">{t(`${k}.seqType`)}</div>
              <SegmentedControl options={seqTypeOptions} value={seqType} onChange={setSeqType} size="sm" />
            </div>
            {/* 参数行 */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
                <span className="shrink-0">{t(`${k}.seqPrefix`)}</span>
                <input
                  type="text"
                  value={seqPrefix}
                  onChange={(e) => setSeqPrefix(e.target.value)}
                  className="wb-field w-32"
                  placeholder="img_"
                />
              </label>
              <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
                <span className="shrink-0">{t(`${k}.seqStart`)}</span>
                <input
                  type="number"
                  value={seqStart}
                  onChange={(e) => setSeqStart(Number(e.target.value) || 1)}
                  className="wb-field w-16 text-center"
                  min={0}
                />
              </label>
              {seqType === "number" && (
                <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
                  <span className="shrink-0">{t(`${k}.seqPadding`)}</span>
                  <input
                    type="number"
                    value={seqPadding}
                    onChange={(e) => setSeqPadding(Number(e.target.value) || 1)}
                    className="wb-field w-16 text-center"
                    min={1}
                    max={10}
                  />
                </label>
              )}
              <label className="flex items-center gap-2 pf-text-sm text-text-secondary">
                <input type="checkbox" checked={seqKeepExt} onChange={() => setSeqKeepExt(!seqKeepExt)} className="accent-orange-500" />
                {t(`${k}.seqExtension`)}
              </label>
            </div>
          </div>
        )}
      </section>

      {/* 无目录提示 */}
      {!hasDir && (
        <section className="rounded-lg border border-dashed border-border-default/60 bg-bg-secondary/50 px-6 py-10 text-center">
          <FolderOpen className="mx-auto mb-2 h-8 w-8 text-text-disabled" />
          <p className="pf-text-sm text-text-tertiary">{t(`${k}.selectDirHint`)}</p>
        </section>
      )}

      {/* 预览表格 */}
      {hasDir && (
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="pf-text-sm font-semibold text-text-primary">
              {t(`${k}.preview`)}
              {changedCount > 0 && (
                <span className="ml-2 font-normal text-orange-500">({changedCount})</span>
              )}
            </h3>
            {changedCount === 0 && preview.length > 0 && (
              <span className="pf-text-xs text-text-disabled">{t(`${k}.noChanges`)}</span>
            )}
          </div>

          {changedCount > 0 ? (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border-default/60">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-bg-secondary">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center pf-text-xs font-medium text-text-tertiary">#</th>
                    <th className="px-3 py-2 text-left pf-text-xs font-medium text-text-tertiary">{t(`${k}.original`)}</th>
                    <th className="w-8 px-1 py-2" />
                    <th className="px-3 py-2 text-left pf-text-xs font-medium text-text-tertiary">{t(`${k}.renamed`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {changedItems.map((row, i) => (
                    <tr key={i} className="border-t border-border-default/20 transition-colors hover:bg-bg-hover/50">
                      <td className="px-3 py-1.5 text-center pf-text-xs text-text-disabled">{i + 1}</td>
                      <td className="px-3 py-1.5 pf-text-sm text-text-secondary">
                        <span className="inline-flex items-center gap-1.5">
                          {row.isDir
                            ? <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            : <File className="h-3.5 w-3.5 shrink-0 text-text-disabled" />}
                          <span className="truncate">{row.original}</span>
                        </span>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <ArrowRight className="mx-auto h-3 w-3 text-text-disabled" />
                      </td>
                      <td className="px-3 py-1.5 pf-text-sm font-medium text-orange-600 truncate">{row.renamed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : preview.length > 0 ? (
            <div className="rounded-lg border border-border-default/40 bg-bg-secondary/40 px-6 py-6 text-center pf-text-sm text-text-disabled">
              {t(`${k}.noChanges`)}
            </div>
          ) : null}
        </section>
      )}

      {/* 操作栏 */}
      {hasDir && (
        <section className="flex items-center gap-4">
          <button
            onClick={handleRequestApply}
            disabled={changedCount === 0 || processing}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 pf-text-sm font-medium transition-colors",
              changedCount > 0 && !processing
                ? "bg-orange-500 text-white hover:bg-orange-600"
                : "cursor-not-allowed bg-bg-secondary text-text-disabled"
            )}
          >
            {processing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(`${k}.apply`)}
            {changedCount > 0 && !processing && ` (${changedCount})`}
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
      )}

      {/* 进度条 */}
      {processing && (
        <section className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
          <div className="mb-2 flex items-center gap-2 pf-text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
            <span>{t(`${k}.apply`)}... {changedCount} {t(`${k}.includeFiles`).toLowerCase()}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-orange-500/20">
            <div className="h-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-orange-500" style={{ width: "40%" }} />
          </div>
        </section>
      )}

      {/* 错误详情 */}
      {result && result.errors.length > 0 && (
        <section className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <div className="space-y-1">
            {result.errors.map((err, i) => (
              <div key={i} className="pf-text-xs text-rose-600">{err}</div>
            ))}
          </div>
        </section>
      )}

      {/* 确认弹窗 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border-default bg-bg-primary p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 pf-text-base font-semibold text-text-primary">{t(`${k}.apply`)}</h3>
            <p className="mb-1 pf-text-sm text-text-secondary">{t(`${k}.applyConfirm`)}</p>
            <p className="mb-5 pf-text-sm text-orange-600">{changedCount} {t(`${k}.includeFiles`).toLowerCase()}</p>

            {changedItems.length > 0 && (
              <div className="mb-5 max-h-40 overflow-auto rounded-lg border border-border-default/40 bg-bg-secondary">
                {changedItems.slice(0, 5).map((row, i) => (
                  <div key={i} className="flex items-center gap-2 border-b border-border-default/20 px-3 py-1.5 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate pf-text-xs text-text-secondary">{row.original}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-text-disabled" />
                    <span className="min-w-0 flex-1 truncate pf-text-xs font-medium text-orange-600">{row.renamed}</span>
                  </div>
                ))}
                {changedItems.length > 5 && (
                  <div className="px-3 py-1.5 text-center pf-text-xs text-text-disabled">... +{changedItems.length - 5}</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmOpen(false)} className="rounded-lg border border-border-default px-4 py-2 pf-text-sm text-text-secondary transition-colors hover:bg-bg-hover">
                Cancel
              </button>
              <button onClick={handleConfirmApply} className="rounded-lg bg-orange-500 px-4 py-2 pf-text-sm font-medium text-white transition-colors hover:bg-orange-600">
                {t(`${k}.apply`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolboxToolPane>
  );
}
