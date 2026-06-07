// 图片 URL 转 Base64 工具 — 输入图片链接，读取并输出 Base64 字符串

import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Link as LinkIcon,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { ToolboxToolPane } from "./ToolboxToolPane";

interface ConversionResult {
  base64: string;
  dataUrl: string;
  mimeType: string;
  byteSize: number;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageUrlToBase64Tool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.imageUrlToBase64";

  const [url, setUrl] = useState("");
  const [includePrefix, setIncludePrefix] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [copied, setCopied] = useState(false);

  const trimmedUrl = url.trim();
  const canConvert = trimmedUrl.length > 0 && !loading;

  const handleConvert = useCallback(async () => {
    if (!trimmedUrl) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const response = await fetch(trimmedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const mimeType = blob.type || "application/octet-stream";
      const base64 = await blobToBase64(blob);
      setResult({
        base64,
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
        byteSize: blob.size,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [trimmedUrl]);

  const output = useMemo(() => {
    if (!result) return "";
    return includePrefix ? result.dataUrl : result.base64;
  }, [result, includePrefix]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [output]);

  return (
    <ToolboxToolPane>
      {/* URL 输入 */}
      <section>
        <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.imageUrl`)}</h3>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border-default bg-bg-input px-2.5 py-2 transition-colors focus-within:border-border-focus">
            <LinkIcon className="h-4 w-4 shrink-0 text-text-disabled" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConvert) handleConvert();
              }}
              placeholder={t(`${k}.urlPlaceholder`)}
              className="flex-1 bg-transparent pf-text-sm font-mono text-text-primary outline-none placeholder:text-text-disabled"
            />
          </div>
          <button
            onClick={handleConvert}
            disabled={!canConvert}
            className="wb-primary-btn bg-accent hover:bg-accent-hover px-4"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? t(`${k}.converting`) : t(`${k}.convert`)}
          </button>
        </div>
      </section>

      {/* 选项 */}
      <section>
        <label className="flex cursor-pointer items-center gap-2 pf-text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={includePrefix}
            onChange={(e) => setIncludePrefix(e.target.checked)}
            className="accent-accent"
          />
          {t(`${k}.includePrefix`)}
        </label>
      </section>

      {/* 错误提示 */}
      {error && (
        <section className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
          <div className="pf-text-xs font-mono text-error">{error}</div>
        </section>
      )}

      {/* 转换结果 */}
      {result && (
        <>
          <section className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <div className="flex-1 pf-text-sm text-text-secondary">
              {t(`${k}.success`, {
                mime: result.mimeType,
                size: formatBytes(result.byteSize),
              })}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.output`)}</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-md border border-border-default bg-bg-secondary px-2.5 py-1 pf-text-xs text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-success" />
                    {t(`${k}.copied`)}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    {t(`${k}.copy`)}
                  </>
                )}
              </button>
            </div>
            <textarea
              readOnly
              value={output}
              className="h-48 w-full resize-y rounded-md border border-border-default bg-bg-inset p-2.5 font-mono pf-text-xs text-text-primary outline-none"
              spellCheck={false}
            />
          </section>

          <section>
            <h3 className="mb-2 pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">{t(`${k}.preview`)}</h3>
            <div className="flex items-center justify-center rounded-lg border border-border-default bg-bg-secondary p-3">
              <img
                src={result.dataUrl}
                alt="preview"
                className="max-h-64 max-w-full object-contain"
              />
            </div>
          </section>
        </>
      )}
    </ToolboxToolPane>
  );
}
