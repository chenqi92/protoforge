import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Check, FileOutput, ClipboardCopy, Wand2 } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { usePluginStore } from "@/stores/pluginStore";
import * as pluginService from "@/services/pluginService";
import type { ExportFormatContribution, GeneratorContribution } from "@/types/plugin";
import { cn } from "@/lib/utils";
import { resolveHttpConfig, buildRequestPayload } from "@/services/httpService";

export function ExportPluginDropdown({ config }: { config: import("@/types/http").HttpRequestConfig }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ content: string; filename: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const exportPlugins = useMemo(() => installedPlugins.filter(p => p.pluginType === 'export-format'), [installedPlugins]);

  const formats = useMemo(() => {
    const items: { pluginId: string; pluginName: string; format: ExportFormatContribution }[] = [];
    for (const p of exportPlugins) {
      for (const fmt of (p.contributes?.exportFormats || [])) {
        items.push({ pluginId: p.id, pluginName: p.name, format: fmt });
      }
    }
    return items;
  }, [exportPlugins]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
      setResult(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (formats.length === 0) return null;

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen(!open);
    setResult(null);
  };

  const handleExport = async (pluginId: string) => {
    setLoading(true);
    try {
      const resolved = resolveHttpConfig(config);
      const payload = buildRequestPayload(resolved);
      const requestJson = JSON.stringify(payload);
      const res = await pluginService.runExport(pluginId, requestJson);
      if (res.error) {
        console.warn('[ProtoForge] export plugin error:', res.error);
      } else {
        setResult({ content: res.content, filename: res.filename });
      }
    } catch (e) {
      console.warn('[ProtoForge] export plugin failed:', e);
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.content);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="wb-icon-btn hover:text-indigo-600 dark:text-indigo-300"
        title={t('http.export', '导出')}
        disabled={!config.url.trim()}
      >
        <FileOutput className="w-3.5 h-3.5" />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[var(--z-toast)] min-w-[320px] max-w-[480px] pf-rounded-md border border-border-default bg-bg-primary shadow-xl shadow-black/8 overflow-hidden"
          style={{ top: pos.top, right: pos.right }}
        >
          {!result ? (
            <div className="p-1.5">
              <div className="px-3 py-2 pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-disabled">
                {t('http.exportAs', '导出为')}
              </div>
              {formats.map((item) => (
                <button
                  key={`${item.pluginId}:${item.format.formatId}`}
                  onClick={() => handleExport(item.pluginId)}
                  disabled={loading}
                  className="w-full flex items-center gap-2 pf-rounded-sm px-3 py-2 text-left pf-text-sm text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <FileOutput className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                  <span className="font-medium">{item.format.name}</span>
                  <span className="pf-text-xxs text-text-disabled ml-auto">.{item.format.fileExtension}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60">
                <span className="pf-text-sm font-semibold text-text-primary">{result.filename}</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md pf-text-xs text-accent hover:bg-accent-soft transition-colors"
                >
                  {copying ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
                  {copying ? t('sidebar.copied', '已复制') : t('response.copy', '复制')}
                </button>
              </div>
              <pre className="selectable p-3 max-h-[280px] overflow-auto font-mono pf-text-xs text-text-primary leading-5 whitespace-pre-wrap break-all bg-bg-secondary/30">
                {result.content}
              </pre>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export function InlineMockButton({ onInsert, label: showLabel }: { onInsert: (data: string) => void; label?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const installedPlugins2 = usePluginStore((s) => s.installedPlugins);
  const generators = useMemo(() => {
    const items: { pluginId: string; generator: GeneratorContribution }[] = [];
    for (const p of installedPlugins2.filter(p => p.pluginType === 'data-generator')) {
      for (const gen of (p.contributes?.generators || [])) {
        items.push({ pluginId: p.id, generator: gen });
      }
    }
    return items;
  }, [installedPlugins2]);

  if (generators.length === 0) return null;

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 260) });
    }
    setOpen(true);
  };

  const handleGenerate = async (pluginId: string, generatorId: string) => {
    setLoading(true);
    try {
      const result = await pluginService.runGenerator(pluginId, generatorId, '{}');
      if (!result.error && result.data) {
        onInsert(result.data);
        setOpen(false);
      }
    } catch (e) {
      console.warn('[ProtoForge] generator failed:', e);
    }
    setLoading(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={cn(
          "shrink-0 pf-rounded-sm text-text-disabled transition-colors hover:bg-bg-hover hover:text-purple-500 dark:text-purple-300",
          showLabel ? "flex items-center gap-1 px-2 py-1 pf-text-xs" : "p-1"
        )}
        title={t('http.mockGenerator', '数据生成')}
        type="button"
      >
        <Wand2 className="w-3 h-3" />
        {showLabel && <span className="font-medium">{t('http.mockGenerator', '数据生成')}</span>}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
          <div
            className="absolute min-w-[180px] pf-rounded-md border border-border-default bg-bg-primary shadow-lg shadow-black/8 overflow-hidden"
            style={pos ? { top: pos.top, left: pos.left } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1">
              {generators.map((item) => (
                <button
                  key={`${item.pluginId}:${item.generator.generatorId}`}
                  onClick={() => handleGenerate(item.pluginId, item.generator.generatorId)}
                  disabled={loading}
                  className="w-full flex items-center gap-1.5 pf-rounded-sm px-2.5 py-1.5 text-left pf-text-xs text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <Wand2 className="w-3 h-3 text-purple-500 dark:text-purple-300/60 shrink-0" />
                  <span className="font-medium truncate">{item.generator.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
