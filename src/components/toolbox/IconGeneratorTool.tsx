// 图标生成器工具 — 将图片转换为各平台图标格式

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, FolderOutput, Sparkles, CheckCircle2, AlertCircle, Loader2, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateIcons, type BatchResult, type IconPlatforms } from "@/services/toolboxService";
import { ToolboxToolPane } from "./ToolboxToolPane";

interface PlatformDef {
  key: keyof IconPlatforms;
  labelKey: string;
  descKey: string;
  sizes: string;
}

const PLATFORMS: PlatformDef[] = [
  { key: "ios", labelKey: "toolWorkbench.toolbox.iconGenerator.ios", descKey: "toolWorkbench.toolbox.iconGenerator.iosDesc", sizes: "20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024" },
  { key: "macos", labelKey: "toolWorkbench.toolbox.iconGenerator.macos", descKey: "toolWorkbench.toolbox.iconGenerator.macosDesc", sizes: "16, 32, 64, 128, 256, 512, 1024" },
  { key: "windows", labelKey: "toolWorkbench.toolbox.iconGenerator.windows", descKey: "toolWorkbench.toolbox.iconGenerator.windowsDesc", sizes: "16, 32, 48, 256 (ICO)" },
  { key: "favicon", labelKey: "toolWorkbench.toolbox.iconGenerator.favicon", descKey: "toolWorkbench.toolbox.iconGenerator.faviconDesc", sizes: "16, 32, 48, 64, 128, 256 + favicon.ico" },
];

export function IconGeneratorTool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.iconGenerator";

  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [platforms, setPlatforms] = useState<IconPlatforms>({
    ios: true,
    macos: true,
    windows: true,
    favicon: true,
  });
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  const handleSelectSource = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (file) {
      const path = Array.isArray(file) ? file[0] : file;
      setSourceImage(path);
      setSourceName(path.split("/").pop() ?? path);
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

  const togglePlatform = useCallback((key: keyof IconPlatforms) => {
    setPlatforms((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!sourceImage || !outputDir) return;

    setProcessing(true);
    setResult(null);
    try {
      const res = await generateIcons(sourceImage, platforms, outputDir);
      setResult(res);
    } catch (e) {
      setResult({ success_count: 0, errors: [String(e)] });
    } finally {
      setProcessing(false);
    }
  }, [sourceImage, platforms, outputDir]);

  const anyPlatform = platforms.ios || platforms.macos || platforms.windows || platforms.favicon;
  const canGenerate = !!sourceImage && !!outputDir && anyPlatform && !processing;

  // 计算选中平台数
  const selectedPlatformNames = PLATFORMS
    .filter((p) => platforms[p.key])
    .map((p) => t(p.labelKey));

  return (
    <ToolboxToolPane>
      {/* 选择源图片 — 原型 dropzone 风格 */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.selectSource`)}</h3>
        {sourceImage ? (
          <button
            type="button"
            onClick={handleSelectSource}
            className="flex w-full items-center gap-3 rounded-[10px] border border-border-default bg-bg-secondary/40 px-3 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-default bg-bg-secondary">
              <img
                src={convertFileSrc(sourceImage)}
                alt="source"
                className="h-full w-full object-contain"
              />
            </div>
            <span className="min-w-0 truncate pf-text-sm text-text-secondary">
              {t(`${k}.sourceSelected`, { name: sourceName })}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSelectSource}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-border-strong bg-bg-secondary/40 px-6 py-7 text-center transition-colors hover:border-accent/60 hover:bg-accent-soft"
          >
            <ImagePlus className="h-6 w-6 text-text-tertiary" />
            <span className="pf-text-sm text-text-tertiary">{t(`${k}.selectSource`)}</span>
          </button>
        )}
      </section>

      {/* 目标平台 — accent-soft 选择块 + check（对齐原型 size-chip 风格） */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.platforms`)}</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PLATFORMS.map((platform) => {
            const checked = platforms[platform.key];
            return (
              <label
                key={platform.key}
                onClick={() => togglePlatform(platform.key)}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                  checked
                    ? "border-accent/50 bg-accent-soft"
                    : "border-border-default bg-bg-secondary hover:border-border-strong"
                )}
              >
                {checked
                  ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />}
                <div className="min-w-0 flex-1">
                  <div className="pf-text-sm font-medium text-text-primary">{t(platform.labelKey)}</div>
                  <div className="pf-text-xs text-text-tertiary">{t(platform.descKey)}</div>
                  <div className="mt-0.5 pf-text-xxs font-mono text-text-disabled">{platform.sizes}</div>
                </div>
              </label>
            );
          })}
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

      {/* 生成按钮 */}
      <section className="flex items-center gap-4">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="wb-primary-btn bg-accent hover:bg-accent-hover px-5"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {processing ? t(`${k}.generating`) : t(`${k}.generate`)}
        </button>

        {result && (
          <div className="flex items-center gap-3">
            {result.success_count > 0 && (
              <span className="pf-status-chip text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t("toolWorkbench.toolbox.screenshotResizer.successCount", { count: result.success_count })}
              </span>
            )}
            {result.errors.length > 0 && (
              <span className="pf-status-chip text-error">
                <AlertCircle className="h-4 w-4" />
                {t("toolWorkbench.toolbox.screenshotResizer.errorCount", { count: result.errors.length })}
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
            <span>{t(`${k}.generating`)} {selectedPlatformNames.join(", ")}</span>
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
