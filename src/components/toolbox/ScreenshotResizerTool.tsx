// 应用截图缩放工具 — 将图片转换为 App Store 要求的尺寸

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, FolderOutput, Play, CheckCircle2, AlertCircle, X, Loader2, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { resizeScreenshots, type BatchResult } from "@/services/toolboxService";
import { ToolboxToolPane } from "./ToolboxToolPane";

interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  device: string;
  orientation: "portrait" | "landscape";
}

const SIZE_PRESETS: SizePreset[] = [
  // iPhone 6.5"
  { id: "iphone65-p", label: "1242 × 2688", width: 1242, height: 2688, device: 'iPhone 6.5"', orientation: "portrait" },
  { id: "iphone65-l", label: "2688 × 1242", width: 2688, height: 1242, device: 'iPhone 6.5"', orientation: "landscape" },
  // iPhone 6.7"
  { id: "iphone67-p", label: "1290 × 2796", width: 1290, height: 2796, device: 'iPhone 6.7"', orientation: "portrait" },
  { id: "iphone67-l", label: "2796 × 1290", width: 2796, height: 1290, device: 'iPhone 6.7"', orientation: "landscape" },
  // iPad 12.9"
  { id: "ipad129-p1", label: "2048 × 2732", width: 2048, height: 2732, device: 'iPad 12.9"', orientation: "portrait" },
  { id: "ipad129-l1", label: "2732 × 2048", width: 2732, height: 2048, device: 'iPad 12.9"', orientation: "landscape" },
  // iPad 13"
  { id: "ipad13-p", label: "2064 × 2752", width: 2064, height: 2752, device: 'iPad 13"', orientation: "portrait" },
  { id: "ipad13-l", label: "2752 × 2064", width: 2752, height: 2064, device: 'iPad 13"', orientation: "landscape" },
];

// 按设备分组
const DEVICE_GROUPS = SIZE_PRESETS.reduce<Record<string, SizePreset[]>>((acc, p) => {
  (acc[p.device] ??= []).push(p);
  return acc;
}, {});

export function ScreenshotResizerTool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.screenshotResizer";

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

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

  const toggleSize = useCallback((id: string) => {
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSizes(new Set(SIZE_PRESETS.map((p) => p.id)));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedSizes(new Set());
  }, []);

  const handleProcess = useCallback(async () => {
    if (!selectedImages.length || !selectedSizes.size || !outputDir) return;

    const sizes: [number, number][] = SIZE_PRESETS
      .filter((p) => selectedSizes.has(p.id))
      .map((p) => [p.width, p.height]);

    setProcessing(true);
    setResult(null);
    try {
      const res = await resizeScreenshots(selectedImages, sizes, outputDir);
      setResult(res);
    } catch (e) {
      setResult({ success_count: 0, errors: [String(e)] });
    } finally {
      setProcessing(false);
    }
  }, [selectedImages, selectedSizes, outputDir]);

  const canProcess = selectedImages.length > 0 && selectedSizes.size > 0 && !!outputDir && !processing;
  const totalTasks = selectedImages.length * selectedSizes.size;

  return (
    <ToolboxToolPane>
      {/* 选择图片 — 原型 dropzone 风格 */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.selectImages`)}</h3>
          {selectedImages.length > 0 && (
            <button
              onClick={() => { setSelectedImages([]); setResult(null); }}
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
              const name = path.split("/").pop() ?? path;
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 pf-text-xs font-mono text-text-secondary"
                >
                  {name}
                  <button
                    onClick={() => setSelectedImages((prev) => prev.filter((p) => p !== path))}
                    aria-label={t('toolbox.removeImage', '移除图片')}
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

      {/* 目标尺寸 */}
      <section>
        <div className="mb-3 flex items-center gap-4">
          <h3 className="pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.targetSizes`)}</h3>
          <div className="flex items-center gap-2">
            <button onClick={selectAll} className="pf-text-xs text-accent hover:underline">
              {t(`${k}.selectAll`)}
            </button>
            <span className="text-text-disabled">·</span>
            <button onClick={deselectAll} className="pf-text-xs text-text-tertiary hover:underline">
              {t(`${k}.deselectAll`)}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(DEVICE_GROUPS).map(([device, presets]) => (
            <div key={device}>
              <div className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">
                {device}
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const checked = selectedSizes.has(p.id);
                  return (
                    <label
                      key={p.id}
                      onClick={() => toggleSize(p.id)}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 pf-text-sm transition-colors",
                        checked
                          ? "border-accent/50 bg-accent-soft text-text-primary"
                          : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong"
                      )}
                    >
                      {checked
                        ? <Check className="h-3 w-3 shrink-0 text-accent" />
                        : <Circle className="h-3 w-3 shrink-0 text-text-tertiary" />}
                      <span className="font-mono">{p.label}</span>
                      <span className="pf-text-xs text-text-disabled">
                        {p.orientation === "portrait" ? t(`${k}.portrait`) : t(`${k}.landscape`)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
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
            {result.success_count > 0 && (
              <span className="pf-status-chip text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t(`${k}.successCount`, { count: result.success_count })}
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
              {t(`${k}.processing`)} {selectedImages.length} {t(`${k}.selectImages`).toLowerCase()} × {selectedSizes.size} {t(`${k}.targetSizes`).toLowerCase()}
              {totalTasks > 0 && <span className="text-text-disabled"> ({totalTasks} {t(`${k}.selectImages`).toLowerCase()})</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-accent/20">
            <div className="h-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-accent" style={{ width: "40%" }} />
          </div>
        </section>
      )}

      {/* 错误详情 */}
      {result && result.errors.length > 0 && (
        <section className="rounded-lg border border-error/30 bg-error/5 p-3">
          <div className="space-y-1">
            {result.errors.map((err, i) => (
              <div key={i} className="pf-text-xs font-mono text-error">{err}</div>
            ))}
          </div>
        </section>
      )}
    </ToolboxToolPane>
  );
}
