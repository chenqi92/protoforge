import { useState, useMemo, useEffect } from "react";
import { DiffEditor, useMonaco } from "@monaco-editor/react";
import { GitCompareArrows, FileText, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/stores/appStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { HttpRequestConfig, HttpResponse, KeyValue } from "@/types/http";

type DiffMode = "request" | "response";
type TargetSource = { type: "tab"; tabId: string } | { type: "history"; entryId: string };

interface RequestDiffModalProps {
  open: boolean;
  onClose: () => void;
  sourceTabId: string;
}

// ── Serialization helpers ──

function serializeHeaders(headers: KeyValue[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    if (h.enabled && h.key.trim()) result[h.key.trim()] = h.value;
  }
  return result;
}

function serializeConfig(config: HttpRequestConfig): string {
  const obj: Record<string, unknown> = {
    method: config.method,
    url: config.url,
    headers: serializeHeaders(config.headers),
    queryParams: serializeHeaders(config.queryParams),
    auth: config.authType !== "none" ? { type: config.authType } : undefined,
    timeout: config.timeoutMs,
  };

  if (config.requestMode === "graphql") {
    obj.body = { type: "graphql", query: config.graphqlQuery, variables: config.graphqlVariables };
  } else if (config.bodyType === "json") {
    try { obj.body = { type: "json", data: JSON.parse(config.jsonBody) }; }
    catch { obj.body = { type: "json", raw: config.jsonBody }; }
  } else if (config.bodyType === "raw") {
    obj.body = { type: "raw", contentType: config.rawContentType, data: config.rawBody };
  } else if (config.bodyType !== "none") {
    obj.body = { type: config.bodyType };
  }

  if (config.preScript?.trim()) obj.preScript = config.preScript;
  if (config.postScript?.trim()) obj.postScript = config.postScript;

  return JSON.stringify(obj, null, 2);
}

function serializeResponse(resp: HttpResponse | null | undefined): string {
  if (!resp) return "// No response";

  const obj: Record<string, unknown> = {
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers),
    bodySize: resp.bodySize,
    contentType: resp.contentType,
    duration: `${resp.durationMs}ms`,
    timing: resp.timing,
    cookies: resp.cookies.length > 0 ? resp.cookies : undefined,
  };

  // Try to parse body as JSON for pretty display
  let bodySection: unknown;
  if (resp.contentType?.includes("json")) {
    try { bodySection = JSON.parse(resp.body); }
    catch { bodySection = resp.body; }
  } else {
    bodySection = resp.body.length > 10000 ? `${resp.body.slice(0, 10000)}... (truncated)` : resp.body;
  }

  return JSON.stringify(obj, null, 2) + "\n\n// ── Body ──\n" +
    (typeof bodySection === "string" ? bodySection : JSON.stringify(bodySection, null, 2));
}

// ── Target selector ──

function TargetSelector({
  sourceTabId,
  onSelect,
  selected,
}: {
  sourceTabId: string;
  onSelect: (target: TargetSource) => void;
  selected: TargetSource | null;
}) {
  const { t } = useTranslation();
  const tabs = useAppStore((s) => s.tabs);
  const historyEntries = useHistoryStore((s) => s.entries);

  const otherTabs = tabs.filter((tab) => tab.id !== sourceTabId && tab.protocol === "http" && tab.httpConfig);

  return (
    <div className="flex flex-col h-full min-w-0 border-r border-border-default/60">
      <div className="px-3 py-2 pf-text-xxs text-text-disabled uppercase tracking-wider border-b border-border-default/30 font-semibold">
        {t('diff.compareTarget')}
      </div>

      {/* Open tabs */}
      {otherTabs.length > 0 && (
        <>
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled flex items-center gap-1">
            <FileText className="h-3 w-3" /> {t('diff.openTabs')}
          </div>
          {otherTabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover/50 transition-colors pf-text-xs",
                selected?.type === "tab" && selected.tabId === tab.id && "bg-accent/10 text-accent",
              )}
              onClick={() => onSelect({ type: "tab", tabId: tab.id })}
            >
              <span className="pf-text-xxs font-bold text-method-get w-8 shrink-0">
                {tab.httpConfig?.method?.slice(0, 3) || "GET"}
              </span>
              <span className="truncate text-text-secondary">{tab.customLabel || tab.label}</span>
            </button>
          ))}
        </>
      )}

      {/* History */}
      {historyEntries.length > 0 && (
        <>
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled flex items-center gap-1 mt-1">
            <Clock className="h-3 w-3" /> {t('diff.history')}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {historyEntries.slice(0, 30).map((entry) => (
              <button
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover/50 transition-colors pf-text-xs w-full",
                  selected?.type === "history" && selected.entryId === entry.id && "bg-accent/10 text-accent",
                )}
                onClick={() => onSelect({ type: "history", entryId: entry.id })}
              >
                <span className="pf-text-xxs font-bold w-8 shrink-0">{entry.method.slice(0, 3)}</span>
                <span className="truncate text-text-secondary flex-1">{entry.url}</span>
                <span className="pf-text-xxs text-text-disabled shrink-0">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {otherTabs.length === 0 && historyEntries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-text-disabled pf-text-xs px-4 text-center">
          {t('diff.noTargets')}
        </div>
      )}
    </div>
  );
}

// ── Main modal ──

export function RequestDiffModal({ open, onClose, sourceTabId }: RequestDiffModalProps) {
  const { t } = useTranslation();
  const monaco = useMonaco();
  const theme = useThemeStore((s) => s.resolved);
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));

  const [diffMode, setDiffMode] = useState<DiffMode>("request");
  const [target, setTarget] = useState<TargetSource | null>(null);
  const [targetConfig, setTargetConfig] = useState<HttpRequestConfig | null>(null);
  const [targetResponse, setTargetResponse] = useState<HttpResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const sourceTab = useAppStore((s) => s.tabs.find((tab) => tab.id === sourceTabId));
  const tabs = useAppStore((s) => s.tabs);
  const getEntryDetail = useHistoryStore((s) => s.getEntryDetail);

  // Define themes
  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme("protoforge-dark", {
        base: "vs-dark", inherit: true, rules: [],
        colors: { "editor.background": "#0f172a", "editor.lineHighlightBackground": "#1e293b" },
      });
      monaco.editor.defineTheme("protoforge-light", {
        base: "vs", inherit: true, rules: [],
        colors: { "editor.background": "#ffffff", "editor.lineHighlightBackground": "#f1f5f9" },
      });
    }
  }, [monaco]);

  const editorTheme = theme === "dark" ? "protoforge-dark" : "protoforge-light";

  // Load target data when selection changes
  useEffect(() => {
    if (!target) {
      setTargetConfig(null);
      setTargetResponse(null);
      return;
    }

    if (target.type === "tab") {
      const tab = tabs.find((t) => t.id === target.tabId);
      setTargetConfig(tab?.httpConfig ?? null);
      setTargetResponse(tab?.httpResponse ?? null);
    } else {
      setLoadingHistory(true);
      getEntryDetail(target.entryId).then((entry) => {
        if (entry?.requestConfig) {
          try {
            setTargetConfig(JSON.parse(entry.requestConfig));
          } catch {
            setTargetConfig(null);
          }
        }
        // History entries don't store full response, only summary
        setTargetResponse(null);
        setLoadingHistory(false);
      });
    }
  }, [target, tabs, getEntryDetail]);

  const sourceConfig = sourceTab?.httpConfig;
  const sourceResponse = sourceTab?.httpResponse;

  const originalText = useMemo(() => {
    if (!sourceConfig) return "";
    return diffMode === "request" ? serializeConfig(sourceConfig) : serializeResponse(sourceResponse);
  }, [sourceConfig, sourceResponse, diffMode]);

  const modifiedText = useMemo(() => {
    if (!targetConfig && !targetResponse) return "";
    return diffMode === "request"
      ? targetConfig ? serializeConfig(targetConfig) : ""
      : serializeResponse(targetResponse);
  }, [targetConfig, targetResponse, diffMode]);

  const sourceLabel = sourceTab?.customLabel || sourceTab?.label || "Source";
  const targetLabel = target?.type === "tab"
    ? tabs.find((t) => t.id === target.tabId)?.customLabel || tabs.find((t) => t.id === target.tabId)?.label || "Target"
    : "History";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent
        className="flex h-[min(88vh,780px)] w-[1100px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-border-default bg-bg-primary shadow-2xl p-0"
        showCloseButton
      >
        <DialogTitle className="sr-only">{t('diff.title')}</DialogTitle>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default/60 shrink-0">
          <GitCompareArrows className="h-4 w-4 text-accent shrink-0" />
          <span className="pf-text-sm font-semibold text-text-primary">{t('diff.title')}</span>

          {/* Mode tabs */}
          <div className="wb-segmented ml-auto">
            <button
              className={cn("wb-segment", diffMode === "request" && "wb-segment-active")}
              onClick={() => setDiffMode("request")}
            >
              {t('diff.request')}
            </button>
            <button
              className={cn("wb-segment", diffMode === "response" && "wb-segment-active")}
              onClick={() => setDiffMode("response")}
            >
              {t('diff.response')}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Target selector sidebar */}
          <div className="w-[240px] shrink-0">
            <TargetSelector sourceTabId={sourceTabId} onSelect={setTarget} selected={target} />
          </div>

          {/* Diff editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!target ? (
              <div className="flex-1 flex items-center justify-center text-text-disabled pf-text-sm">
                {t('diff.selectTarget')}
              </div>
            ) : loadingHistory ? (
              <div className="flex-1 flex items-center justify-center text-text-tertiary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                {/* Labels */}
                <div className="flex border-b border-border-default/30 pf-text-xxs text-text-disabled shrink-0">
                  <div className="flex-1 px-3 py-1.5 border-r border-border-default/30 truncate">
                    {sourceLabel}
                  </div>
                  <div className="flex-1 px-3 py-1.5 truncate">
                    {targetLabel}
                  </div>
                </div>

                {/* Monaco DiffEditor */}
                <div className="flex-1 min-h-0">
                  <DiffEditor
                    height="100%"
                    language="json"
                    theme={editorTheme}
                    original={originalText}
                    modified={modifiedText}
                    options={{
                      readOnly: true,
                      originalEditable: false,
                      minimap: { enabled: false },
                      fontSize: editorFontSize,
                      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace",
                      wordWrap: "on",
                      scrollBeyondLastLine: false,
                      renderSideBySide: true,
                      renderLineHighlight: "all",
                      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                      padding: { top: 8, bottom: 8 },
                    }}
                    loading={
                      <div className="flex w-full h-full items-center justify-center text-text-tertiary">
                        <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
