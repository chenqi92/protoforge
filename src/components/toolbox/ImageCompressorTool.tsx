// 图片压缩工具 — 重新编码 PNG/JPEG 以减小文件体积

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ImagePlus,
  FolderOutput,
  Play,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ArrowDownToLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  compressImages,
  type CompressFormat,
  type CompressResult,
  type PngCompressionLevel,
} from "@/services/toolboxService";
import { ToolboxToolPane } from "./ToolboxToolPane";

const FORMAT_OPTIONS: { id: CompressFormat; labelKey: string }[] = [
  { id: "keep", labelKey: "toolWorkbench.toolbox.imageCompressor.formatKeep" },
  { id: "jpeg", labelKey: "toolWorkbench.toolbox.imageCompressor.formatJpeg" },
  { id: "png", labelKey: "toolWorkbench.toolbox.imageCompressor.formatPng" },
];

const PNG_LEVELS: { id: PngCompressionLevel; labelKey: string }[] = [
  { id: "fast", labelKey: "toolWorkbench.toolbox.imageCompressor.pngFast" },
  { id: "default", labelKey: "toolWorkbench.toolbox.imageCompressor.pngDefault" },
  { id: "best", labelKey: "toolWorkbench.toolbox.imageCompressor.pngBest" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageCompressorTool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.imageCompressor";

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [format, setFormat] = useState<CompressFormat>("keep");
  const [jpegQuality, setJpegQuality] = useState(80);
  const [pngCompression, setPngCompression] = useState<PngCompressionLevel>("best");
  const [suffix, setSuffix] = useState("_compressed");
  const [overwrite, setOverwrite] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);

  const handleSelectImages = useCallback(async () => {
    const files = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (files) {
      const paths = Array.isArray(files) ? files : [files];
      setSelectedImages(paths);
      setResult(null);
    }
  }, []);

  const handleSelectOutput = useCallback(async () => {
    const dir = await open({ directory: true });
    if (dir) {
      setOutputDir(dir as string);
      setResult(null);
    }
  }, []);

  const handleProcess = useCallback(async () => {
    if (!selectedImages.length || !outputDir) return;

    setProcessing(true);
    setResult(null);
    try {
      const res = await compressImages(selectedImages, outputDir, {
        format,
        jpegQuality,
        pngCompression,
        suffix,
        overwrite,
      });
      setResult(res);
    } catch (e) {
      setResult({
        successCount: 0,
        errors: [String(e)],
        items: [],
        totalOriginal: 0,
        totalCompressed: 0,
      });
    } finally {
      setProcessing(false);
    }
  }, [selectedImages, outputDir, format, jpegQuality, pngCompression, suffix, overwrite]);

  const canProcess = selectedImages.length > 0 && !!outputDir && !processing;

  // 当源全是 PNG 且 format=keep 时不需要 JPEG 质量；反之亦然
  const showJpegQuality =
    format === "jpeg" ||
    (format === "keep" && selectedImages.some((p) => /\.(jpe?g)$/i.test(p)));
  const showPngLevel =
    format === "png" ||
    (format === "keep" && selectedImages.some((p) => !/\.(jpe?g)$/i.test(p)));

  const savedRatio = useMemo(() => {
    if (!result || result.totalOriginal === 0) return null;
    const saved = result.totalOriginal - result.totalCompressed;
    const ratio = (saved / result.totalOriginal) * 100;
    return { saved, ratio };
  }, [result]);

  return (
    <ToolboxToolPane>
      {/* 选择图片 — 原型 dropzone 风格 */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.selectImages`)}</h3>
          {selectedImages.length > 0 && (
            <button
              onClick={() => {
                setSelectedImages([]);
                setResult(null);
              }}
              className="pf-text-xs text-text-tertiary hover:text-text-primary"
            >
              {t(`${k}.clearAll`)}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleSelectImages}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-border-strong bg-bg-secondary/40 px-6 py-7 text-center transition-colors hover:border-accent/60 hover:bg-accent-soft"
        >
          <ImagePlus className="h-6 w-6 text-text-tertiary" />
          <span className="pf-text-sm text-text-tertiary">
            {selectedImages.length > 0
              ? t(`${k}.selectedCount`, { count: selectedImages.length })
              : t(`${k}.selectImages`)}
          </span>
        </button>
        {selectedImages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedImages.map((path) => {
              const name = path.split(/[\\/]/).pop() ?? path;
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 pf-text-xs font-mono text-text-secondary"
                >
                  {name}
                  <button
                    onClick={() => setSelectedImages((prev) => prev.filter((p) => p !== path))}
                    className="text-text-disabled hover:text-text-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* 输出格式 */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.outputFormat`)}</h3>
        <div className="flex flex-wrap gap-2">
          {FORMAT_OPTIONS.map((opt) => {
            const checked = format === opt.id;
            return (
              <label
                key={opt.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 pf-text-sm transition-colors",
                  checked
                    ? "border-accent/50 bg-accent-soft text-text-primary"
                    : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong"
                )}
              >
                <input
                  type="radio"
                  name="compress-format"
                  checked={checked}
                  onChange={() => setFormat(opt.id)}
                  className="accent-accent"
                />
                <span>{t(opt.labelKey)}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* JPEG 质量 */}
      {showJpegQuality && (
        <section>
          <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.jpegQuality`)}</h3>
          <div className="flex max-w-md items-center gap-3">
            <input
              type="range"
              min={1}
              max={100}
              value={jpegQuality}
              onChange={(e) => setJpegQuality(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <div className="flex min-w-[48px] items-baseline justify-center gap-0.5 rounded-md bg-accent-soft px-2 py-1 ring-1 ring-accent/30">
              <span className="font-mono text-sm font-bold leading-none text-accent">
                {jpegQuality}
              </span>
            </div>
          </div>
          <div className="mt-1 flex max-w-md justify-between pf-text-xs text-text-disabled">
            <span>{t(`${k}.qualityLow`)}</span>
            <span>{t(`${k}.qualityHigh`)}</span>
          </div>
        </section>
      )}

      {/* PNG 压缩级别 */}
      {showPngLevel && (
        <section>
          <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.pngCompression`)}</h3>
          <div className="flex flex-wrap gap-2">
            {PNG_LEVELS.map((opt) => {
              const checked = pngCompression === opt.id;
              return (
                <label
                  key={opt.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 pf-text-sm transition-colors",
                    checked
                      ? "border-accent/50 bg-accent-soft text-text-primary"
                      : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong"
                  )}
                >
                  <input
                    type="radio"
                    name="png-level"
                    checked={checked}
                    onChange={() => setPngCompression(opt.id)}
                    className="accent-accent"
                  />
                  <span>{t(opt.labelKey)}</span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {/* 文件名后缀 + 覆盖 */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.outputName`)}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="pf-text-sm text-text-secondary">{t(`${k}.suffix`)}</span>
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="_compressed"
              className="wb-field w-40"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 pf-text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="accent-accent"
            />
            {t(`${k}.overwrite`)}
          </label>
        </div>
      </section>

      {/* 输出目录 */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.outputDir`)}</h3>
        <div className="flex items-center gap-3">
          <button onClick={handleSelectOutput} className="wb-ghost-btn gap-2 px-3 py-2">
            <FolderOutput className="h-4 w-4" />
            {t(`${k}.selectOutputDir`)}
          </button>
          {outputDir && (
            <span className="truncate pf-text-sm text-text-secondary">{outputDir}</span>
          )}
        </div>
      </section>

      {/* 操作按钮 */}
      <section className="flex items-center gap-4">
        <button
          onClick={handleProcess}
          disabled={!canProcess}
          className="wb-primary-btn bg-accent hover:bg-accent-hover px-5"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {processing ? t(`${k}.processing`) : t(`${k}.process`)}
        </button>

        {result && (
          <div className="flex items-center gap-3">
            {result.successCount > 0 && (
              <span className="pf-status-chip text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t(`${k}.successCount`, { count: result.successCount })}
              </span>
            )}
            {result.errors.length > 0 && (
              <span className="pf-status-chip text-error">
                <AlertCircle className="h-4 w-4" />
                {t(`${k}.errorCount`, { count: result.errors.length })}
              </span>
            )}
          </div>
        )}
      </section>

      {/* 进度条 */}
      {processing && (
        <section className="rounded-lg border border-accent/30 bg-accent-soft p-4">
          <div className="mb-2 flex items-center gap-2 pf-text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span>
              {t(`${k}.processing`)} {selectedImages.length}{" "}
              {t(`${k}.selectImages`).toLowerCase()}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent/20">
            <div
              className="h-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-accent"
              style={{ width: "40%" }}
            />
          </div>
        </section>
      )}

      {/* 总体节省 */}
      {result && savedRatio && result.successCount > 0 && (
        <section className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-success">
              <ArrowDownToLine className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="pf-text-sm font-medium text-text-primary">
                {t(`${k}.savedTotal`, {
                  saved: formatBytes(savedRatio.saved),
                  ratio: savedRatio.ratio.toFixed(1),
                })}
              </div>
              <div className="pf-text-xs text-text-tertiary">
                {formatBytes(result.totalOriginal)} → {formatBytes(result.totalCompressed)}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 单文件结果 */}
      {result && result.items.length > 0 && (
        <section>
          <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.results`)}</h3>
          <div className="overflow-hidden rounded-lg border border-border-default">
            <table className="w-full pf-text-xs">
              <thead className="bg-bg-tertiary text-text-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t(`${k}.colFile`)}</th>
                  <th className="px-3 py-2 text-right font-medium">{t(`${k}.colOriginal`)}</th>
                  <th className="px-3 py-2 text-right font-medium">{t(`${k}.colCompressed`)}</th>
                  <th className="px-3 py-2 text-right font-medium">{t(`${k}.colSaved`)}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item, i) => {
                  const name = item.output.split(/[\\/]/).pop() ?? item.output;
                  const saved = item.originalSize - item.compressedSize;
                  const ratio =
                    item.originalSize > 0 ? (saved / item.originalSize) * 100 : 0;
                  return (
                    <tr key={i} className="border-t border-border-subtle">
                      <td className="truncate px-3 py-1.5 font-mono text-text-secondary">{name}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-tertiary">
                        {formatBytes(item.originalSize)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-secondary">
                        {formatBytes(item.compressedSize)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right font-mono",
                          ratio > 0 ? "text-success" : "text-error"
                        )}
                      >
                        {ratio > 0 ? "-" : "+"}
                        {Math.abs(ratio).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 错误详情 */}
      {result && result.errors.length > 0 && (
        <section className="rounded-lg border border-error/30 bg-error/5 p-3">
          <div className="space-y-1">
            {result.errors.map((err, i) => (
              <div key={i} className="pf-text-xs font-mono text-error">
                {err}
              </div>
            ))}
          </div>
        </section>
      )}
    </ToolboxToolPane>
  );
}
