// 应用截图缩放工具 — 将图片转换为 App Store 要求的尺寸

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, FolderOutput, Play, CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { resizeScreenshots, type BatchResult } from "@/services/toolboxService";

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

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 选择图片 */}
      <section>
        <h3 className="mb-3 pf-text-sm font-semibold text-text-primary">{t(`${k}.selectImages`)}</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSelectImages}
            className="wb-ghost-btn gap-2 px-3 py-2"
          >
            <ImagePlus className="h-4 w-4" />
            {t(`${k}.selectImages`)}
          </button>
          {selectedImages.length > 0 && (
            <>
              <span className="pf-text-sm text-text-secondary">
                {t(`${k}.selectedCount`, { count: selectedImages.length })}
              </span>
              <button
                onClick={() => { setSelectedImages([]); setResult(null); }}
                className="pf-text-xs text-text-tertiary hover:text-text-primary"
              >
                {t(`${k}.clearAll`)}
              </button>
            </>
          )}
        </div>
        {selectedImages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedImages.map((path) => {
              const name = path.split("/").pop() ?? path;
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 rounded-md bg-bg-secondary px-2 py-1 pf-text-xs text-text-secondary"
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

      {/* 目标尺寸 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="pf-text-sm font-semibold text-text-primary">{t(`${k}.targetSizes`)}</h3>
          <div className="flex gap-2">
            <button onClick={selectAll} className="pf-text-xs text-accent hover:underline">
              {t(`${k}.selectAll`)}
            </button>
            <button onClick={deselectAll} className="pf-text-xs text-text-tertiary hover:underline">
              {t(`${k}.deselectAll`)}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(DEVICE_GROUPS).map(([device, presets]) => (
            <div key={device}>
              <div className="mb-2 pf-text-xs font-medium uppercase tracking-wider text-text-disabled">
                {device}
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const checked = selectedSizes.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 pf-text-sm transition-colors",
                        checked
                          ? "border-orange-500/50 bg-orange-500/10 text-text-primary"
                          : "border-border-default/60 bg-bg-secondary text-text-secondary hover:border-border-strong"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSize(p.id)}
                        className="accent-orange-500"
                      />
                      <span>{p.label}</span>
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
        <h3 className="mb-3 pf-text-sm font-semibold text-text-primary">{t(`${k}.outputDir`)}</h3>
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
          className={cn(
            "flex items-center gap-2 rounded-lg px-5 py-2.5 pf-text-sm font-medium transition-colors",
            canProcess
              ? "bg-orange-500 text-white hover:bg-orange-600"
              : "cursor-not-allowed bg-bg-secondary text-text-disabled"
          )}
        >
          <Play className="h-4 w-4" />
          {processing ? t(`${k}.processing`) : t(`${k}.process`)}
        </button>

        {result && (
          <div className="flex items-center gap-3">
            {result.success_count > 0 && (
              <span className="flex items-center gap-1.5 pf-text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                {t(`${k}.successCount`, { count: result.success_count })}
              </span>
            )}
            {result.errors.length > 0 && (
              <span className="flex items-center gap-1.5 pf-text-sm text-rose-600">
                <AlertCircle className="h-4 w-4" />
                {t(`${k}.errorCount`, { count: result.errors.length })}
              </span>
            )}
          </div>
        )}
      </section>

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
    </div>
  );
}
