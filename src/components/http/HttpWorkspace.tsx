import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Play, Loader2, Copy, Check, ChevronDown, ChevronRight, Upload, FileIcon, X, Save, Search, Flame, Cookie, CheckCircle2, XCircle, Terminal, Eye, EyeOff, Square, Waves, ArrowDownToLine, Trash2, Info, ChevronUp, Braces } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useEnvStore } from "@/stores/envStore";
import { useHistoryStore } from "@/stores/historyStore";
import type { HttpMethod, KeyValue, FormDataField, ScriptResult, HttpRequestMode } from "@/types/http";
import type { OAuth2Config } from "@/types/http";
import type { CollectionItem } from "@/types/collections";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SaveRequestDialog } from "./SaveRequestDialog";
import { ScriptEditor } from "./ScriptEditor";
import { CodeEditor } from "@/components/common/CodeEditor";
import { ResponseViewer } from "@/components/ui/ResponseViewer";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher, type RequestKind } from "@/components/request/RequestProtocolSwitcher";
import { buildCollectionItemFromHttpConfig, getCollectionRequestSignatureFromConfig, getCollectionRequestSignatureFromItem } from "@/lib/collectionRequest";
import { extractVariableKeys, getVariablePreview, upsertCollectionVariable } from "@/lib/requestVariables";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

const methodTextColor: Record<string, string> = {
  GET: "text-emerald-600", POST: "text-amber-600", PUT: "text-blue-600",
  DELETE: "text-red-500", PATCH: "text-violet-600", HEAD: "text-cyan-600", OPTIONS: "text-gray-500",
};

const methodDotColor: Record<string, string> = {
  GET: "bg-emerald-500", POST: "bg-amber-500", PUT: "bg-blue-500",
  DELETE: "bg-red-500", PATCH: "bg-violet-500", HEAD: "bg-cyan-500", OPTIONS: "bg-gray-400",
};

interface SseEvent {
  id: string | null;
  eventType: string;
  data: string;
  timestamp: string;
}

export function HttpWorkspace({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const updateTab = useAppStore((s) => s.updateTab);
  const setHttpResponse = useAppStore((s) => s.setHttpResponse);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const saveRequestToCollection = useCollectionStore((s) => s.saveRequest);

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth" | "pre-script" | "post-script">("params");
  const [resTab, setResTab] = useState<"body" | "headers" | "cookies" | "timing">("body");
  const [copied, setCopied] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [scriptResults, setScriptResults] = useState<{ pre: ScriptResult | null; post: ScriptResult | null }>({ pre: null, post: null });
  const [urlFocused, setUrlFocused] = useState(false);
  const [urlHighlight, setUrlHighlight] = useState(-1);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [sseStatus, setSseStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [sseError, setSseError] = useState('');
  const toggleSecret = (field: string) => setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlRectRef = useRef<DOMRect | null>(null);
  const sseListRef = useRef<HTMLDivElement>(null);

  // URL history autocomplete
  const historyEntries = useHistoryStore((s) => s.entries);
  useEffect(() => { useHistoryStore.getState().fetchHistory(200); }, []);
  const urlSuggestions = useMemo(() => {
    const url = activeTab?.httpConfig?.url || '';
    if (!url.trim() || !urlFocused) return [];
    const seen = new Set<string>();
    return historyEntries
      .map((e) => e.url)
      .filter((u) => {
        if (!u || seen.has(u) || u === url) return false;
        seen.add(u);
        return u.toLowerCase().includes(url.toLowerCase());
      })
      .slice(0, 8);
  }, [historyEntries, activeTab?.httpConfig?.url, urlFocused]);

  if (!activeTab?.httpConfig) return null;
  const config = activeTab.httpConfig;
  const response = activeTab.httpResponse;
  const { loading, error } = activeTab;
  const sseConnId = `sse-${tabId}`;
  const isSseMode = config.requestMode === "sse";
  const isGraphqlMode = config.requestMode === "graphql";
  const isSseConnected = sseStatus === "connected" || sseStatus === "connecting";
  const currentRequestSignature = useMemo(
    () => getCollectionRequestSignatureFromConfig(config),
    [config]
  );
  const isLinkedCollectionRequest = Boolean(activeTab.linkedCollectionItemId && activeTab.linkedCollectionId);
  const isSavedRequestPristine = isLinkedCollectionRequest && activeTab.savedRequestSignature === currentRequestSignature;
  const responseHeaderEntries = useMemo(
    () => response?.headers ?? [],
    [response]
  );
  const responseHeaderMap = useMemo(
    () => new Map(responseHeaderEntries.map(([key, value]) => [key.toLowerCase(), value])),
    [responseHeaderEntries]
  );
  const responseSizeLabel = useMemo(() => {
    if (!response) return "0 B";
    return response.bodySize < 1024 ? `${response.bodySize} B` : `${(response.bodySize / 1024).toFixed(1)} KB`;
  }, [response]);
  const responseCookies = useMemo(() => response?.cookies ?? [], [response]);
  const secureCookieCount = useMemo(
    () => responseCookies.filter((cookie) => cookie.secure).length,
    [responseCookies]
  );
  const httpOnlyCookieCount = useMemo(
    () => responseCookies.filter((cookie) => cookie.httpOnly).length,
    [responseCookies]
  );
  const timingCards = useMemo(() => {
    if (!response) return [];
    return [
      { label: t('http.connectTime'), value: response.timing.connectMs, color: "bg-sky-500" },
      { label: t('http.ttfb'), value: response.timing.ttfbMs, color: "bg-emerald-500" },
      { label: t('http.download'), value: response.timing.downloadMs, color: "bg-amber-500" },
      { label: t('http.totalTime'), value: response.timing.totalMs, color: "bg-violet-500" },
    ];
  }, [response, t]);

  useEffect(() => {
    const unlistenEvent = listen<SseEvent>(`sse-event-${sseConnId}`, (event) => {
      setSseEvents((prev) => [...prev, event.payload]);
    });
    const unlistenStatus = listen<string>(`sse-status-${sseConnId}`, (event) => {
      const nextStatus = event.payload;
      if (nextStatus === "connecting") {
        setSseStatus("connecting");
        return;
      }
      if (nextStatus === "connected") {
        setSseStatus("connected");
        setSseError("");
        return;
      }
      if (nextStatus === "disconnected") {
        setSseStatus("disconnected");
        return;
      }
      if (nextStatus.startsWith("error:")) {
        setSseStatus("error");
        setSseError(nextStatus.slice(6));
      }
    });

    return () => {
      unlistenEvent.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
      void invoke("sse_disconnect", { connId: sseConnId }).catch(() => {});
    };
  }, [sseConnId]);


  useEffect(() => {
    const allowedTabs = isSseMode ? ["params", "headers", "auth"] : ["params", "headers", "body", "auth", "pre-script", "post-script"];
    if (!allowedTabs.includes(reqTab)) {
      setReqTab(isGraphqlMode ? "body" : "params");
    }
  }, [isGraphqlMode, isSseMode, reqTab]);

  useEffect(() => {
    if (!isSseMode && isSseConnected) {
      void invoke("sse_disconnect", { connId: sseConnId }).catch(() => {});
      setSseStatus("disconnected");
    }
  }, [isSseConnected, isSseMode, sseConnId]);

  const resolveSseRequest = useCallback(async () => {
    const { resolveHttpConfig, buildRequestPayload } = await import("@/services/httpService");
    const resolved = resolveHttpConfig(config);
    const payload = buildRequestPayload(resolved);
    const targetUrl = new URL(payload.url);

    for (const [key, value] of Object.entries(payload.queryParams)) {
      targetUrl.searchParams.append(key, value);
    }

    const headers: Record<string, string> = { ...payload.headers };
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "accept")) {
      headers.Accept = "text/event-stream";
    }

    if (payload.auth) {
      switch (payload.auth.type) {
        case "bearer":
          headers.Authorization = `Bearer ${payload.auth.token}`;
          break;
        case "basic":
          headers.Authorization = `Basic ${btoa(`${payload.auth.username}:${payload.auth.password}`)}`;
          break;
        case "apiKey":
          if (payload.auth.addTo === "query") {
            targetUrl.searchParams.set(payload.auth.key, payload.auth.value);
          } else if (payload.auth.key) {
            headers[payload.auth.key] = payload.auth.value;
          }
          break;
      }
    }

    return { url: targetUrl.toString(), headers };
  }, [config]);

  const handleSseConnect = useCallback(async () => {
    if (!config.url.trim()) return;
    setError(tabId, null);
    setHttpResponse(tabId, null);
    setSseEvents([]);
    setSseError("");
    setSseStatus("connecting");
    try {
      const request = await resolveSseRequest();
      await invoke("sse_connect", { connId: sseConnId, request });
    } catch (err: any) {
      setSseStatus("error");
      setSseError(err?.message || String(err));
    }
  }, [config.url, resolveSseRequest, setError, setHttpResponse, sseConnId, tabId]);

  const handleSseDisconnect = useCallback(async () => {
    try {
      await invoke("sse_disconnect", { connId: sseConnId });
    } catch {}
  }, [sseConnId]);

  const handleModeChange = useCallback(async (mode: HttpRequestMode) => {
    if (mode === config.requestMode) return;

    if (config.requestMode === "sse" && isSseConnected) {
      try {
        await invoke("sse_disconnect", { connId: sseConnId });
      } catch {}
    }

    const currentName = config.name.trim();
    const usingGeneratedName = !currentName || ["Untitled Request", "GraphQL Request", "SSE Stream"].includes(currentName);

    updateHttpConfig(tabId, {
      requestMode: mode,
      name: usingGeneratedName
        ? mode === "graphql"
          ? "GraphQL Request"
          : mode === "sse"
            ? "SSE Stream"
            : "Untitled Request"
        : config.name,
      method: mode === "graphql" ? (config.method === "GET" || config.method === "HEAD" ? "POST" : config.method) : mode === "sse" ? "GET" : config.method,
    });
    setReqTab(mode === "graphql" ? "body" : "params");
    setResTab("body");
  }, [config, isSseConnected, sseConnId, tabId, updateHttpConfig]);

  const handleSend = useCallback(async () => {
    if (isSseMode) {
      if (isSseConnected) {
        await handleSseDisconnect();
      } else {
        await handleSseConnect();
      }
      return;
    }
    if (!config.url.trim()) return;
    setLoading(tabId, true);
    setError(tabId, null);
    setScriptResults({ pre: null, post: null });
    let finalResponse: import("@/types/http").HttpResponse | null = null;
    try {
      const hasScripts = (config.preScript?.trim() || config.postScript?.trim());
      if (hasScripts) {
        const { sendRequestWithScripts } = await import("@/services/httpService");
        const result = await sendRequestWithScripts(config);
        finalResponse = result.response;
        setHttpResponse(tabId, result.response);
        setScriptResults({ pre: result.preScriptResult, post: result.postScriptResult });
      } else {
        const { sendHttpRequest } = await import("@/services/httpService");
        const res = await sendHttpRequest(config);
        finalResponse = res;
        setHttpResponse(tabId, res);
      }

      // 自动检测 SSE 事件流：当响应 Content-Type 为 text/event-stream 时自动切换
      if (finalResponse?.isEventStream) {
        updateHttpConfig(tabId, { requestMode: 'sse' });
        setHttpResponse(tabId, null);
        // 延迟一帧让模式切换生效后启动 SSE 连接
        setTimeout(() => void handleSseConnect(), 0);
      }
    } catch (err: any) {
      setError(tabId, err.message || String(err));
    } finally {
      setLoading(tabId, false);
      // 记录到历史
      useHistoryStore.getState().addEntry({
        id: crypto.randomUUID(),
        method: config.method,
        url: config.url,
        status: finalResponse?.status ?? null,
        durationMs: finalResponse?.durationMs ?? null,
        bodySize: finalResponse?.bodySize ?? null,
        requestConfig: JSON.stringify(config),
        responseSummary: null,
        createdAt: new Date().toISOString(),
      });
    }
  }, [tabId, config, setLoading, setHttpResponse, setError, handleSseConnect, handleSseDisconnect, isSseConnected, isSseMode, updateHttpConfig]);

  const handleCopy = useCallback(() => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [response]);

  const handleRequestKindChange = useCallback((kind: RequestKind) => {
    const activeKind: RequestKind = activeTab.protocol === "http" && config.requestMode === "graphql"
      ? "graphql"
      : activeTab.protocol;

    if (kind === activeKind) return;

    const switchKind = async () => {
      if (isSseConnected) {
        try {
          await invoke("sse_disconnect", { connId: sseConnId });
        } catch {}
      }

      setShowMethods(false);

      if (kind === "ws" || kind === "mqtt") {
        setTabProtocol(tabId, kind);
        return;
      }

      if (activeTab.protocol !== "http") {
        setTabProtocol(tabId, "http");
      }

      await handleModeChange(kind === "http" ? "rest" : kind);
    };

    void switchKind();
  }, [activeTab.protocol, config.requestMode, handleModeChange, isSseConnected, setTabProtocol, sseConnId, tabId]);

  const params = Array.isArray(config.queryParams) ? config.queryParams : [];
  const headers = Array.isArray(config.headers) ? config.headers : [];
  const formFields = Array.isArray(config.formFields) ? config.formFields : [];
  const formDataFields = Array.isArray(config.formDataFields) ? config.formDataFields : [];

  const syncSavedCollectionBinding = useCallback((item: CollectionItem) => {
    updateHttpConfig(tabId, { name: item.name });
    updateTab(tabId, {
      label: item.name || activeTab.label,
      customLabel: item.name || activeTab.customLabel || activeTab.label,
      linkedCollectionItemId: item.id,
      linkedCollectionId: item.collectionId,
      linkedCollectionParentId: item.parentId,
      linkedCollectionSortOrder: item.sortOrder,
      linkedCollectionCreatedAt: item.createdAt,
      savedRequestSignature: getCollectionRequestSignatureFromItem(item),
    });
  }, [activeTab.customLabel, activeTab.label, tabId, updateHttpConfig, updateTab]);

  const handleSaveRequest = useCallback(async () => {
    if (!isLinkedCollectionRequest) {
      setShowSaveDialog(true);
      return;
    }

    if (isSavedRequestPristine || savingRequest) {
      return;
    }

    setSavingRequest(true);
    try {
      const now = new Date().toISOString();
      const item = buildCollectionItemFromHttpConfig({
        config,
        itemId: activeTab.linkedCollectionItemId!,
        collectionId: activeTab.linkedCollectionId!,
        parentId: activeTab.linkedCollectionParentId ?? null,
        sortOrder: activeTab.linkedCollectionSortOrder ?? 0,
        createdAt: activeTab.linkedCollectionCreatedAt ?? now,
        updatedAt: now,
      });
      const saved = await saveRequestToCollection(item);
      syncSavedCollectionBinding(saved);
    } catch (err: any) {
      setError(tabId, err?.message || String(err));
    } finally {
      setSavingRequest(false);
    }
  }, [
    activeTab.linkedCollectionCreatedAt,
    activeTab.linkedCollectionId,
    activeTab.linkedCollectionItemId,
    activeTab.linkedCollectionParentId,
    activeTab.linkedCollectionSortOrder,
    config,
    isLinkedCollectionRequest,
    isSavedRequestPristine,
    saveRequestToCollection,
    savingRequest,
    setError,
    syncSavedCollectionBinding,
    tabId,
  ]);

  const reqTabs = [
    { key: "params" as const, label: `${t('http.params')}${params.filter(p => p.key).length ? ` (${params.filter(p => p.key).length})` : ""}` },
    { key: "headers" as const, label: `${t('http.headers')}${headers.filter(h => h.key).length ? ` (${headers.filter(h => h.key).length})` : ""}` },
    ...(!isSseMode ? [{ key: "body" as const, label: isGraphqlMode ? t('http.graphql.modeLabel') : t('http.body') }] : []),
    { key: "auth" as const, label: t('http.auth') },
    ...(!isSseMode ? [
      { key: "pre-script" as const, label: t('http.preScript') },
      { key: "post-script" as const, label: t('http.postScript') },
    ] : []),
  ];

  const requestLayoutMode = reqTab === "params" || reqTab === "headers"
    ? "compact"
    : reqTab === "body" && !isGraphqlMode && (config.bodyType === "formUrlencoded" || config.bodyType === "formData")
      ? "table-body"
      : isGraphqlMode
        ? "graphql"
        : "default";

  const requestDefaultSize = requestLayoutMode === "compact" ? 28 : requestLayoutMode === "table-body" ? 44 : requestLayoutMode === "graphql" ? 55 : 42;
  const responseDefaultSize = requestLayoutMode === "compact" ? 72 : requestLayoutMode === "table-body" ? 56 : requestLayoutMode === "graphql" ? 45 : 58;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Top Request Bar Area */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher
            activeProtocol={activeTab.protocol}
            activeHttpMode={config.requestMode}
            onChange={handleRequestKindChange}
          />
        )}
        main={(
          <div className="relative flex min-w-0 flex-1 items-center gap-2">
            <div className="relative shrink-0">
              <button
                onClick={() => setShowMethods(!showMethods)}
                className={cn(
                  "wb-request-method border-0 bg-gradient-to-r shadow-sm",
                  config.method === "GET" && "from-emerald-500 to-teal-500",
                  config.method === "POST" && "from-amber-500 to-orange-500",
                  config.method === "PUT" && "from-blue-500 to-cyan-500",
                  config.method === "DELETE" && "from-red-500 to-rose-500",
                  config.method === "PATCH" && "from-violet-500 to-fuchsia-500",
                  config.method === "HEAD" && "from-cyan-500 to-sky-500",
                  config.method === "OPTIONS" && "from-slate-500 to-slate-600"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                {config.method}
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>
              {showMethods && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMethods(false)} />
                  <div className="absolute left-0 top-full z-50 mt-2 min-w-[140px] overflow-hidden rounded-[14px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                    {METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => { updateHttpConfig(tabId, { method: m }); setShowMethods(false); }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[var(--fs-sm)] font-semibold transition-colors hover:bg-bg-hover",
                          config.method === m && "bg-bg-hover"
                        )}
                      >
                        <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", methodDotColor[m])} />
                        <span className={methodTextColor[m] || "text-text-primary"}>{m}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative min-w-0 flex-1">
              <VariableInlineInput
                inputRef={urlInputRef}
                value={config.url}
                onChange={(e) => { updateHttpConfig(tabId, { url: e.target.value }); setUrlHighlight(-1); }}
                onKeyDown={(e) => {
                  if (urlSuggestions.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setUrlHighlight(h => (h + 1) % urlSuggestions.length); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setUrlHighlight(h => (h <= 0 ? urlSuggestions.length - 1 : h - 1)); return; }
                    if (e.key === 'Enter' && urlHighlight >= 0) { e.preventDefault(); updateHttpConfig(tabId, { url: urlSuggestions[urlHighlight] }); setUrlFocused(false); return; }
                    if (e.key === 'Escape') { setUrlFocused(false); return; }
                  }
                  if (e.key === 'Enter') handleSend();
                }}
                onFocus={() => { setUrlFocused(true); if (urlInputRef.current) urlRectRef.current = urlInputRef.current.getBoundingClientRect(); }}
                onBlur={() => setTimeout(() => setUrlFocused(false), 150)}
                placeholder={t('http.urlPlaceholder')}
                data-url-input
                collectionId={activeTab.linkedCollectionId}
                className="wb-request-input"
                overlayClassName="wb-request-input"
              />
            </div>
            {urlSuggestions.length > 0 && urlFocused && urlRectRef.current && createPortal(
              <div className="fixed z-[9999] max-h-[220px] overflow-y-auto rounded-[16px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_20px_48px_rgba(15,23,42,0.14)]"
                style={{ top: (urlRectRef.current.bottom + 2), left: urlRectRef.current.left, width: urlRectRef.current.width }}>
                {urlSuggestions.map((u, i) => (
                  <button key={u} onMouseDown={(e) => { e.preventDefault(); updateHttpConfig(tabId, { url: u }); setUrlFocused(false); }}
                    className={cn("w-full rounded-[12px] px-3 py-2 text-left text-[var(--fs-sm)] font-mono truncate transition-colors",
                      i === urlHighlight ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-bg-hover")}>
                    {u}
                  </button>
                ))}
              </div>, document.body
            )}
          </div>
        )}
        actions={(
          <>
            <div className="wb-request-toolgroup">
              <button
                onClick={() => void handleSaveRequest()}
                data-save-button
                className="wb-icon-btn"
                title={t('http.saveRequest')}
                disabled={savingRequest || isSavedRequestPristine}
              >
                {savingRequest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={async () => {
                  const { pushLoadTestConfig } = await import("@/lib/loadTestBridge");
                  pushLoadTestConfig(config);
                }}
                disabled={!config.url.trim() || isSseMode}
                className="wb-icon-btn hover:text-rose-600"
                title={t('http.sendToLoadtest')}
              >
                <Flame className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={(isSseMode ? sseStatus === "connecting" : loading) || !config.url.trim()}
              data-send-button
              className={cn(
                "wb-primary-btn min-w-[88px] bg-accent",
                isSseMode
                  ? sseStatus === "connected"
                    ? "bg-red-500 hover:bg-red-600"
                    : sseStatus === "connecting"
                      ? "animate-pulse opacity-90 shadow-[0_0_12px_rgba(59,130,246,0.45)] cursor-wait"
                      : "hover:bg-accent-hover"
                  : loading
                    ? "animate-pulse opacity-90 shadow-[0_0_12px_rgba(59,130,246,0.45)] cursor-wait"
                    : "hover:bg-accent-hover"
              )}
            >
              {isSseMode ? (
                sseStatus === "connected" ? <Square className="w-3 h-3 fill-white" /> : sseStatus === "connecting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-white" />
              ) : loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3 h-3 fill-white" />
              )}
              {isSseMode ? (sseStatus === "connected" ? t('sse.disconnect') : sseStatus === "connecting" ? t('sse.connecting') : t('sse.connect')) : loading ? t('http.sending') : t('http.send')}
            </button>
          </>
        )}
      />

      {/* Main Split Area */}
      <div className="flex-1 overflow-hidden pb-3 pt-1.5">
        <div className="http-workbench-shell">
          <PanelGroup orientation="vertical" key={`request-layout-${requestLayoutMode}`}>
        
          {/* Request Panel */}
          <Panel minSize="12" defaultSize={requestDefaultSize} className="http-workbench-section">
            <div className="wb-tabs shrink-0 scrollbar-hide">
              {reqTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setReqTab(t.key)}
                  className={cn(
                    "wb-tab",
                    reqTab === t.key && "wb-tab-active text-text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          
            <div className="http-workbench-body">
              {reqTab === "params" && <div className="px-3 py-0"><KVEditor items={params} onChange={(v) => updateHttpConfig(tabId, { queryParams: v })} kp="Query Param" vp="Value" collectionId={activeTab.linkedCollectionId} /></div>}
              {reqTab === "headers" && <div className="px-3 py-0"><KVEditor items={headers} onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" showPresets showAutoToggle collectionId={activeTab.linkedCollectionId} /></div>}
            
              {reqTab === "body" && (
                <div className="p-4 flex flex-col h-full">
                  {!isGraphqlMode && (
                    <div className="wb-segmented mb-4 w-fit shrink-0">
                      {(["none", "json", "raw", "graphql", "formUrlencoded", "formData", "binary"] as const).map((bt) => (
                        <button
                          key={bt}
                          onClick={() => updateHttpConfig(tabId, { bodyType: bt })}
                          className={cn(
                            "wb-segment",
                            config.bodyType === bt && "wb-segment-active"
                          )}
                        >
                          {bt === "none" ? "None" : bt === "formUrlencoded" ? "URL-Encoded" : bt === "formData" ? "Form-Data" : bt === "binary" ? "Binary" : bt === "graphql" ? "GraphQL" : bt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                
                  <div className="flex-1 min-h-0 relative">
                    {isGraphqlMode ? (
                      <GraphQLBodyEditor
                        query={config.graphqlQuery || ""}
                        variables={config.graphqlVariables || ""}
                        onQueryChange={(v) => updateHttpConfig(tabId, { graphqlQuery: v })}
                        onVariablesChange={(v) => updateHttpConfig(tabId, { graphqlVariables: v })}
                      />
                    ) : config.bodyType === "none" ? <div className="absolute inset-0 flex items-center justify-center text-text-disabled text-[var(--fs-base)]">{t('http.noBody')}</div> : null}
                    {!isGraphqlMode && config.bodyType === "json" && (
                      <div className="w-full h-full border border-border-default/75 rounded-[14px] overflow-hidden bg-bg-input/88 focus-within:border-accent transition-colors">
                        <CodeEditor
                          value={config.jsonBody || ''}
                          onChange={(v) => updateHttpConfig(tabId, { jsonBody: v })}
                          language="json"
                        />
                      </div>
                    )}
                    {!isGraphqlMode && config.bodyType === "graphql" && (
                      <GraphQLBodyEditor
                        query={config.graphqlQuery || ""}
                        variables={config.graphqlVariables || ""}
                        onQueryChange={(v) => updateHttpConfig(tabId, { graphqlQuery: v })}
                        onVariablesChange={(v) => updateHttpConfig(tabId, { graphqlVariables: v })}
                      />
                    )}
                    {!isGraphqlMode && config.bodyType === "raw" && (
                      <div className="flex flex-col h-full gap-2">
                        <select
                          value={config.rawContentType}
                          onChange={(e) => updateHttpConfig(tabId, { rawContentType: e.target.value })}
                          className="wb-field-sm wb-native-select w-fit min-w-[120px] text-text-secondary"
                        >
                          <option value="text/plain">Text</option>
                          <option value="text/html">HTML</option>
                          <option value="application/xml">XML</option>
                          <option value="application/javascript">JavaScript</option>
                          <option value="text/css">CSS</option>
                        </select>
                        <div className="w-full flex-1 border border-border-default/75 rounded-[14px] overflow-hidden bg-bg-input/88 focus-within:border-accent transition-colors">
                          <CodeEditor
                            value={config.rawBody || ''}
                            onChange={(v) => updateHttpConfig(tabId, { rawBody: v })}
                            language={config.rawContentType === 'application/javascript' ? 'javascript' : config.rawContentType === 'text/css' ? 'css' : config.rawContentType === 'text/html' ? 'html' : config.rawContentType === 'application/xml' ? 'xml' : 'plaintext'}
                          />
                        </div>
                      </div>
                    )}
                    {!isGraphqlMode && config.bodyType === "formUrlencoded" && <div className="overflow-auto h-full"><KVEditor items={formFields} onChange={(v) => updateHttpConfig(tabId, { formFields: v })} kp="Field Name" vp="Value" collectionId={activeTab.linkedCollectionId} /></div>}
                    {!isGraphqlMode && config.bodyType === "formData" && <div className="overflow-auto h-full"><FormDataEditor fields={formDataFields} onChange={(v) => updateHttpConfig(tabId, { formDataFields: v })} /></div>}
                    {!isGraphqlMode && config.bodyType === "binary" && <BinaryPicker filePath={config.binaryFilePath} fileName={config.binaryFileName} onChange={(path, name) => updateHttpConfig(tabId, { binaryFilePath: path, binaryFileName: name })} />}
                  </div>
                </div>
              )}
            
              {reqTab === "auth" && (
                <div className="p-4">
                  <div className="wb-segmented mb-4 w-fit flex-wrap">
                    {(["none", "bearer", "basic", "apiKey", "oauth2"] as const).map((at) => (
                      <button
                        key={at}
                        onClick={() => updateHttpConfig(tabId, { authType: at })}
                        className={cn(
                          "wb-segment",
                          config.authType === at && "wb-segment-active"
                        )}
                      >
                        {at === "none" ? "No Auth" : at === "bearer" ? "Bearer Token" : at === "basic" ? "Basic Auth" : at === "apiKey" ? "API Key" : "OAuth 2.0"}
                      </button>
                    ))}
                  </div>
                  
                  <div className="max-w-md">
                    {config.authType === "none" && <p className="text-[var(--fs-base)] text-text-disabled mt-6">{t('http.noAuth')}</p>}
                    {config.authType === "bearer" && (
                      <div className="space-y-2">
                        <label className="text-[var(--fs-sm)] font-medium text-text-secondary">{t('http.bearerTokenLabel')}</label>
                        <div className="relative">
                          <input
                            value={config.bearerToken}
                            onChange={(e) => updateHttpConfig(tabId, { bearerToken: e.target.value })}
                            type={showSecrets['bearer'] ? 'text' : 'password'}
                            placeholder="ey..."
                            className="wb-field w-full font-mono text-[var(--fs-base)] pr-9"
                          />
                          <button type="button" onClick={() => toggleSecret('bearer')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                            {showSecrets['bearer'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {config.authType === "basic" && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Username</label>
                          <input value={config.basicUsername} onChange={(e) => updateHttpConfig(tabId, { basicUsername: e.target.value })} className="wb-field w-full text-[var(--fs-base)]" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Password</label>
                          <div className="relative">
                            <input value={config.basicPassword} onChange={(e) => updateHttpConfig(tabId, { basicPassword: e.target.value })} type={showSecrets['basicPwd'] ? 'text' : 'password'} className="wb-field w-full text-[var(--fs-base)] pr-9" />
                            <button type="button" onClick={() => toggleSecret('basicPwd')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                              {showSecrets['basicPwd'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {config.authType === "apiKey" && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">{t('http.addTo')}</label>
                          <div className="wb-segmented w-fit">
                            {(["header", "query"] as const).map((a) => (
                              <button key={a} onClick={() => updateHttpConfig(tabId, { apiKeyAddTo: a })} className={cn("wb-segment", config.apiKeyAddTo === a && "wb-segment-active")}>
                                {a === "header" ? "Header" : "Query Param"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Key</label>
                          <input value={config.apiKeyName} onChange={(e) => updateHttpConfig(tabId, { apiKeyName: e.target.value })} placeholder="X-API-Key" className="wb-field w-full font-mono text-[var(--fs-base)]" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Value</label>
                          <div className="relative">
                            <input value={config.apiKeyValue} onChange={(e) => updateHttpConfig(tabId, { apiKeyValue: e.target.value })} type={showSecrets['apiKey'] ? 'text' : 'password'} className="wb-field w-full font-mono text-[var(--fs-base)] pr-9" />
                            <button type="button" onClick={() => toggleSecret('apiKey')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                              {showSecrets['apiKey'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {config.authType === "oauth2" && (
                      <OAuth2Panel config={config.oauth2Config} onChange={(updates) => updateHttpConfig(tabId, { oauth2Config: { ...config.oauth2Config, ...updates } })} />
                    )}
                  </div>
                </div>
              )}
            
              {reqTab === "pre-script" && (
                <ScriptEditor
                  type="pre"
                  value={config.preScript}
                  onChange={(v) => updateHttpConfig(tabId, { preScript: v })}
                />
              )}
            
              {reqTab === "post-script" && (
                <ScriptEditor
                  type="post"
                  value={config.postScript}
                  onChange={(v) => updateHttpConfig(tabId, { postScript: v })}
                />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="http-workbench-divider" />

          {/* Response Panel */}
          <Panel minSize="18" defaultSize={responseDefaultSize} className="http-workbench-section">
            {isSseMode ? (
              <HttpSseResponsePanel
                status={sseStatus}
                error={sseError}
                events={sseEvents}
                onClear={() => setSseEvents([])}
                listRef={sseListRef}
              />
            ) : error ? (
              <HttpRequestErrorPanel
                error={error}
                onDismiss={() => setError(tabId, null)}
              />
            ) : response ? (
              <>
                {/* Script results notification */}
                {(scriptResults.pre || scriptResults.post) && (
                  <div className="px-3 py-1.5 bg-bg-secondary/60 border-b border-border-default flex items-center gap-3 text-[var(--fs-xs)] flex-wrap shrink-0">
                    {scriptResults.pre && (
                      <span className={cn("flex items-center gap-1 font-medium", scriptResults.pre.success ? "text-emerald-600" : "text-red-500")}>
                        {scriptResults.pre.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {t('http.preScript')}{scriptResults.pre.success ? t('http.preScriptPass') : t('http.preScriptFail')}
                      </span>
                    )}
                    {scriptResults.post && (
                      <span className={cn("flex items-center gap-1 font-medium", scriptResults.post.success ? "text-emerald-600" : "text-red-500")}>
                        {scriptResults.post.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {t('http.postScript')}{scriptResults.post.success ? t('http.preScriptPass') : t('http.preScriptFail')}
                      </span>
                    )}
                    {scriptResults.post?.testResults && scriptResults.post.testResults.length > 0 && (
                      <span className="text-text-tertiary">
                        {t('http.tests')}: {scriptResults.post.testResults.filter(tr => tr.passed).length}/{scriptResults.post.testResults.length} {t('http.preScriptPass')}
                      </span>
                    )}
                    {(scriptResults.pre?.logs?.length || scriptResults.post?.logs?.length) ? (
                      <span className="text-text-disabled flex items-center gap-1"><Terminal className="w-3 h-3" />{(scriptResults.pre?.logs?.length || 0) + (scriptResults.post?.logs?.length || 0)} {t('http.logs')}</span>
                    ) : null}
                  </div>
                )}
                <div className="http-response-head shrink-0">
                  <div className="http-response-tabs scrollbar-hide">
                    {(["body", "headers", "cookies", "timing"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setResTab(tab)}
                        className={cn(
                          "http-response-tab",
                          resTab === tab && "is-active"
                        )}
                      >
                        {tab === "body" ? t('http.responseBody') : tab === "headers" ? t('http.responseHeaders') : tab === "cookies" ? `Cookies${response.cookies?.length ? ` (${response.cookies.length})` : ""}` : t('http.timing')}
                      </button>
                    ))}
                  </div>
                  
                  <div className="http-response-meta">
                    <span className={cn("http-response-status", getHttpStatusTone(response.status))}>
                      <span className={cn("http-response-status-dot", getHttpStatusDotTone(response.status))} />
                      {response.status} {response.statusText}
                    </span>

                    <ResponseMetaPill label="Time" value={`${response.durationMs} ms`} />
                    <ResponseMetaPill label="Size" value={responseSizeLabel} />

                    <button
                      onClick={handleCopy}
                      className="wb-icon-btn"
                      title={t('http.copyResponse')}
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-hidden">
                  {resTab === "headers" ? (
                    <div className="selectable h-full overflow-auto p-3">
                      <div className="flex min-h-full flex-col gap-2.5">
                        <div className="response-summary-row">
                          <ResponseHeaderMetric
                            label={t('http.responseHeaders')}
                            value={`${responseHeaderEntries.length}`}
                            hint="Items"
                          />
                          <ResponseHeaderMetric
                            label="Content-Type"
                            value={responseHeaderMap.get("content-type") || response.contentType || "—"}
                          />
                          <ResponseHeaderMetric
                            label="Content-Length"
                            value={responseHeaderMap.get("content-length") || `${response.bodySize} B`}
                          />
                          <ResponseHeaderMetric
                            label="Allow"
                            value={responseHeaderMap.get("allow") || "—"}
                          />
                        </div>

                        <div className="response-table-frame">
                          <table className="response-table">
                            <colgroup>
                              <col style={{ width: '31%' }} />
                              <col style={{ width: '69%' }} />
                            </colgroup>
                            <thead>
                              <tr>
                                <th>Header</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {responseHeaderEntries.map(([key, value], index) => (
                                <tr key={`${key}-${index}`}>
                                  <td className="response-table-key">{key}</td>
                                  <td className="response-table-value">{value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : resTab === "cookies" ? (
                    <div className="selectable h-full overflow-auto p-3">
                      {responseCookies.length ? (
                        <div className="flex min-h-full flex-col gap-2.5">
                          <div className="response-summary-row response-summary-row-cookies">
                            <ResponseHeaderMetric label="Cookies" value={`${responseCookies.length}`} hint="Items" />
                            <ResponseHeaderMetric label="Secure" value={`${secureCookieCount}`} hint="Flagged" />
                            <ResponseHeaderMetric label="HttpOnly" value={`${httpOnlyCookieCount}`} hint="Flagged" />
                          </div>

                          <div className="response-table-frame w-full">
                            <div className="overflow-x-auto">
                              <table className="response-table response-cookie-table min-w-full">
                                <thead>
                                  <tr>
                                    <th className="w-[16%] min-w-[120px]">Name</th>
                                    <th className="w-[30%] min-w-[220px]">Value</th>
                                    <th className="w-[18%] min-w-[160px]">Domain</th>
                                    <th className="w-[14%] min-w-[120px]">Path</th>
                                    <th className="w-[22%] min-w-[180px]">Flags</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {responseCookies.map((cookie, index) => (
                                    <tr key={index}>
                                      <td className="response-table-key">{cookie.name}</td>
                                      <td className="response-table-value">{cookie.value}</td>
                                      <td className="response-table-cell">{cookie.domain || "-"}</td>
                                      <td className="response-table-cell">{cookie.path || "-"}</td>
                                      <td className="response-table-flags">
                                        {[cookie.httpOnly && "HttpOnly", cookie.secure && "Secure", cookie.sameSite].filter(Boolean).join(", ") || "-"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-text-disabled text-[var(--fs-base)]"><Cookie className="w-4 h-4 mr-2 opacity-40" />{t('http.noCookies')}</div>
                      )}
                    </div>
                  ) : resTab === "timing" ? (
                    <div className="selectable p-4 overflow-auto h-full">
                      <div className="flex min-h-full flex-col gap-3">
                        <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.88fr)_minmax(0,1.12fr)]">
                          <div className="rounded-[16px] border border-border-default bg-bg-primary/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t('http.totalTime')}</div>
                            <div className="mt-3 text-[var(--fs-6xl)] font-semibold tracking-tight text-text-primary">{response.durationMs} ms</div>
                            <div className="mt-2 text-[var(--fs-sm)] leading-5 text-text-tertiary">
                              请求往返耗时，包含连接建立、首字节等待与下载阶段。
                            </div>
                          </div>

                          <div className="rounded-[16px] border border-border-default bg-bg-primary/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t('http.timing')}</div>
                              <div className="text-[var(--fs-xs)] font-mono text-text-tertiary">{response.durationMs} ms</div>
                            </div>
                            <div className="mt-4 h-3 overflow-hidden rounded-full bg-bg-secondary">
                              {timingCards.slice(0, 3).map(({ label, value, color }) => {
                                const width = value && response.timing.totalMs ? Math.max(6, (value / response.timing.totalMs) * 100) : 0;
                                if (!width) return null;
                                return <div key={label} className={cn("h-full transition-all", color)} style={{ width: `${width}%` }} />;
                              })}
                            </div>
                            <div className="mt-4 grid gap-2 md:grid-cols-3">
                              {timingCards.slice(0, 3).map(({ label, value, color }) => (
                                <div key={label} className="rounded-[12px] border border-border-default/75 bg-bg-secondary/24 px-3 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
                                    <span className="text-[var(--fs-xs)] font-medium text-text-secondary">{label}</span>
                                  </div>
                                  <div className="mt-1 font-mono text-[var(--fs-base)] font-semibold text-text-primary">{value ?? "—"} ms</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {timingCards.map(({ label, value, color }) => (
                            <div key={label} className="rounded-[16px] border border-border-default bg-bg-primary/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[var(--fs-sm)] font-medium text-text-secondary">{label}</span>
                                <span className="font-mono text-[var(--fs-base)] font-semibold text-text-primary">{value ?? "—"} ms</span>
                              </div>
                              <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-secondary">
                                <div
                                  className={cn("h-full rounded-full transition-all", color)}
                                  style={{ width: `${value && response.timing.totalMs ? Math.max(6, (value / response.timing.totalMs) * 100) : 0}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ResponseViewer body={response.body} contentType={response.contentType} responseHeaders={response.headers} isBinary={response.isBinary} />
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary shadow-sm">
                  <Braces className="h-7 w-7 opacity-20" />
                </div>
                <p className="text-[var(--fs-base)] font-medium text-text-secondary">{t('http.ready')}</p>
                <p className="mt-1 text-[var(--fs-xs)]">{t('http.readyDesc')}</p>
              </div>
            )}
          </Panel>
          
          </PanelGroup>
        </div>
      </div>

      {/* Save Request Dialog */}
      <SaveRequestDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        config={config}
        onSaved={syncSavedCollectionBinding}
      />
    </div>
  );
}

function ResponseMetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="http-response-meta-pill">
      <span className="http-response-meta-label">{label}</span>
      <span className="http-response-meta-value font-mono">{value}</span>
    </span>
  );
}

function HttpRequestErrorPanel({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="http-response-head shrink-0">
        <div className="http-response-tabs scrollbar-hide">
          <span className="http-response-tab is-active">{t('http.errorResult')}</span>
        </div>

        <div className="http-response-meta">
          <span className="http-response-status border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
            <span className="http-response-status-dot bg-red-500" />
            {t('http.requestFailed')}
          </span>
          <button type="button" onClick={onDismiss} className="wb-icon-btn" title={t('common.delete')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-bg-primary px-6 py-6">
        <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-red-200/80 bg-red-50 text-red-500 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
            <XCircle className="h-8 w-8" />
          </div>
          <p className="text-[var(--fs-3xl)] font-semibold text-text-primary">{t('http.requestFailed')}</p>
          <p className="mt-2 max-w-[520px] text-[var(--fs-sm)] leading-6 text-text-secondary">
            {t('http.requestFailedDesc')}
          </p>

          <div className="mt-5 w-full overflow-hidden rounded-[16px] border border-border-default/80 bg-bg-secondary/30 text-left">
            <div className="border-b border-border-default/80 px-4 py-2 text-[var(--fs-xs)] font-semibold uppercase tracking-[0.08em] text-text-disabled">
              {t('http.errorDetails')}
            </div>
            <pre className="selectable overflow-auto px-4 py-4 text-[var(--fs-sm)] leading-6 text-text-secondary whitespace-pre-wrap break-all">
              {error}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SSE 事件类型颜色映射 ─────────────────────────────────────
const SSE_EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  message: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
  data:    { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
  status:  { bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400", border: "border-slate-500/20" },
  heartbeat: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/20" },
  metric:  { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/20" },
  error:   { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/20" },
};
const SSE_DEFAULT_COLOR = { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" };

function getSseEventColor(eventType: string) {
  return SSE_EVENT_COLORS[eventType.toLowerCase()] || SSE_DEFAULT_COLOR;
}

function tryFormatJson(data: string): { isJson: boolean; formatted: string } {
  try {
    const parsed = JSON.parse(data);
    return { isJson: true, formatted: JSON.stringify(parsed, null, 2) };
  } catch {
    return { isJson: false, formatted: data };
  }
}

function SseEventRow({ event }: { event: SseEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = getSseEventColor(event.eventType);
  const { isJson, formatted } = useMemo(() => tryFormatJson(event.data), [event.data]);

  // 单行截断的内容预览
  const preview = event.data.replace(/\n/g, ' ').slice(0, 200);

  return (
    <div className="group">
      {/* 主行 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50",
          expanded && "bg-bg-hover/30"
        )}
      >
        {/* 方向箭头 */}
        <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-text-disabled" />

        {/* 事件类型标签 */}
        <span className={cn(
          "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[var(--fs-xxs)] font-bold leading-none",
          color.bg, color.text, color.border
        )}>
          {event.eventType}
        </span>

        {/* 内容摘要 */}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
          {preview}
        </span>

        {/* 时间戳 */}
        <span className="shrink-0 font-mono text-[var(--fs-xxs)] text-text-disabled">
          {new Date(event.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' } as Intl.DateTimeFormatOptions)}
        </span>

        {/* 展开/收起 */}
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
        }
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="mx-4 mb-2 mt-0.5 rounded-lg border border-border-default/60 bg-bg-secondary/20 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border-default/40 px-3 py-1.5 text-[var(--fs-xxs)] text-text-tertiary">
            <span className="font-semibold">{isJson ? 'JSON' : 'TEXT'}</span>
            {event.id && <span className="ml-auto">Event ID: {event.id}</span>}
          </div>
          <pre className={cn(
            "selectable overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-[1.6] text-text-primary max-h-[320px]",
          )}>
            {formatted}
          </pre>
        </div>
      )}
    </div>
  );
}

function SseSystemMessage({ message, timestamp }: { message: string; timestamp?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 text-[var(--fs-xs)] text-text-tertiary">
      <Info className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="flex-1">{message}</span>
      {timestamp && (
        <span className="shrink-0 font-mono text-[var(--fs-xxs)] text-text-disabled">
          {new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' } as Intl.DateTimeFormatOptions)}
        </span>
      )}
    </div>
  );
}

function HttpSseResponsePanel({
  status,
  error,
  events,
  onClear,
  listRef,
}: {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  error: string;
  events: SseEvent[];
  onClear: () => void;
  listRef: { current: HTMLDivElement | null };
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEvents = useMemo(() => {
    if (!searchQuery) return events;
    const normalized = searchQuery.toLowerCase();
    return events.filter(e => {
      const haystack = `${e.eventType} ${e.data} ${e.id || ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [events, searchQuery]);

  // 倒序显示：最新事件在最上方
  const reversedEvents = useMemo(() => [...filteredEvents].reverse(), [filteredEvents]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="http-response-head shrink-0">
        <div className="http-response-tabs scrollbar-hide">
          <span className="http-response-tab is-active">{t('sse.events')}</span>
        </div>

        <div className="http-response-meta">
          <div className="wb-search w-[200px] max-w-full">
            <Search className="w-3.5 h-3.5 text-text-disabled" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('ws.searchMessages')} className="min-w-0 flex-1" />
            {searchQuery && <button type="button" onClick={() => setSearchQuery("")} className="text-text-disabled hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>}
          </div>

          <span className={cn("http-response-status",
            status === 'connected'
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
              : status === 'connecting'
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                : status === 'error'
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
                  : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-300"
          )}>
            <span className={cn("http-response-status-dot",
              status === 'connected' ? "bg-emerald-500" : status === 'connecting' ? "bg-amber-500" : status === 'error' ? "bg-red-500" : "bg-slate-400"
            )} />
            {status === 'idle' ? t('sse.idle') : status === 'connecting' ? t('sse.connecting') : status === 'connected' ? t('sse.connected') : status === 'disconnected' ? t('sse.disconnected') : t('sse.error')}
          </span>
          <ResponseMetaPill label={t('sse.events')} value={`${events.length}`} />
          <button type="button" onClick={onClear} className="wb-icon-btn" title={t('common.delete')}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50/80 px-4 py-2 text-[var(--fs-sm)] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div ref={listRef} className="selectable flex-1 overflow-auto bg-bg-secondary/8">
        {events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-disabled">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary/35">
              <Waves className="h-7 w-7 text-orange-500/40" />
            </div>
            <div className="text-[var(--fs-md)] font-semibold text-text-secondary">{t('sse.emptyTitle')}</div>
            <div className="mt-2 max-w-xl text-[var(--fs-sm)] leading-6 text-text-tertiary">{t('sse.emptyDesc')}</div>
          </div>
        ) : (
          <div className="divide-y divide-border-default/30">
            {/* 顶部：连接状态系统消息 */}
            {status === 'disconnected' && (
              <SseSystemMessage message="Connection closed" timestamp={reversedEvents[0]?.timestamp} />
            )}

            {/* 事件列表（倒序：最新在上） */}
            {reversedEvents.map((event, index) => (
              <SseEventRow key={`${event.timestamp}-${events.length - 1 - index}`} event={event} />
            ))}

            {/* 底部：Connected 提示 */}
            {events.length > 0 && (
              <SseSystemMessage
                message={`Connected to ${events[0]?.data ? 'server' : 'event stream'}`}
                timestamp={events[0]?.timestamp}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getHttpStatusTone(status: number) {
  if (status < 200) return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300";
  if (status < 300) return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300";
  if (status < 400) return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300";
  if (status < 500) return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300";
  return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300";
}

function getHttpStatusDotTone(status: number) {
  if (status < 200) return "bg-sky-500";
  if (status < 300) return "bg-emerald-500";
  if (status < 400) return "bg-amber-500";
  if (status < 500) return "bg-orange-500";
  return "bg-red-500";
}

function ResponseHeaderMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="response-summary-card">
      <div className="response-summary-label">{label}</div>
      <div className="response-summary-value">{value}</div>
      {hint ? <div className="response-summary-hint">{hint}</div> : null}
    </div>
  );
}

function GraphQLBodyEditor({
  query,
  variables,
  onQueryChange,
  onVariablesChange,
}: {
  query: string;
  variables: string;
  onQueryChange: (value: string) => void;
  onVariablesChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const trimmedVariables = variables.trim();
  const hasVariables = trimmedVariables.length > 0 && trimmedVariables !== "{}";
  const variableState = useMemo(() => {
    if (!trimmedVariables) {
      return { valid: true, label: t('http.graphql.variablesOptional'), detail: t('http.graphql.variablesOptionalDetail') };
    }

    try {
      const parsed = JSON.parse(variables);
      const count = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).length
        : 0;
      return {
        valid: true,
        label: count > 0 ? t('http.graphql.variablesCount', { count }) : t('http.graphql.variablesValid'),
        detail: count > 0 ? t('http.graphql.variablesValidDetail') : t('http.graphql.variablesValidEmpty'),
      };
    } catch {
      return {
        valid: false,
        label: t('http.graphql.variablesInvalid'),
        detail: t('http.graphql.variablesInvalidDetail'),
      };
    }
  }, [trimmedVariables, variables]);

  const handleInsertTemplate = useCallback(() => {
    if (!query.trim()) {
      onQueryChange(
        [
          "query ExampleQuery($id: ID!) {",
          "  user(id: $id) {",
          "    id",
          "    name",
          "    email",
          "  }",
          "}",
        ].join("\n")
      );
    }

    if (!trimmedVariables) {
      onVariablesChange('{\n  "id": "123"\n}');
    }
  }, [onQueryChange, onVariablesChange, query, trimmedVariables]);

  const handleFormatVariables = useCallback(() => {
    if (!trimmedVariables) {
      onVariablesChange("{\n  \n}");
      return;
    }

    try {
      const parsed = JSON.parse(variables);
      onVariablesChange(JSON.stringify(parsed, null, 2));
    } catch {
      // Keep current text when invalid; header already highlights the issue.
    }
  }, [onVariablesChange, trimmedVariables, variables]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div>
              <div className="text-[var(--fs-sm)] font-semibold text-text-primary">Query</div>
              <div className="mt-1 text-[var(--fs-xs)] text-text-tertiary">{t('http.graphql.queryDesc')}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="wb-tool-chip">GraphQL</span>
              <button onClick={handleInsertTemplate} className="wb-ghost-btn">
                {t('http.graphql.insertTemplate')}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default/70 bg-bg-input/88">
            <CodeEditor
              value={query}
              onChange={onQueryChange}
              language="graphql"
            />
          </div>
        </div>

        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[var(--fs-sm)] font-semibold text-text-primary">Variables</span>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[var(--fs-xxs)] font-semibold",
                  variableState.valid
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-red-500/10 text-red-500"
                )}>
                  {variableState.valid ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {variableState.label}
                </span>
              </div>
              <div className="mt-1 text-[var(--fs-xs)] text-text-tertiary">{variableState.detail}</div>
            </div>
            <div className="flex items-center gap-2">
              {hasVariables ? <span className="wb-tool-chip">JSON</span> : null}
              <button onClick={handleFormatVariables} className="wb-ghost-btn">
                {t('http.graphql.formatVariables')}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default/70 bg-bg-input/88">
            <CodeEditor
              value={variables}
              onChange={onVariablesChange}
              language="json"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Header Dictionary: key → possible values ── */
const HEADER_DICT: Record<string, string[]> = {
  "Content-Type": [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
    "text/html",
    "application/xml",
    "application/octet-stream",
    "application/javascript",
    "text/css",
    "image/png",
    "image/jpeg",
  ],
  "Accept": [
    "application/json",
    "*/*",
    "text/html",
    "application/xml",
    "text/plain",
    "image/*",
  ],
  "Authorization": ["Bearer ", "Basic "],
  "Cache-Control": ["no-cache", "no-store", "max-age=0", "max-age=3600", "public", "private"],
  "Accept-Encoding": ["gzip, deflate, br", "gzip, deflate", "identity"],
  "Accept-Language": ["zh-CN,zh;q=0.9,en;q=0.8", "en-US,en;q=0.9", "*"],
  "User-Agent": ["ProtoForge/1.0", "Mozilla/5.0"],
  "X-Requested-With": ["XMLHttpRequest"],
  "Origin": [""],
  "Referer": [""],
  "Cookie": [""],
  "If-None-Match": [""],
  "If-Modified-Since": [""],
  "X-Forwarded-For": [""],
  "X-Real-IP": [""],
  "X-CSRF-Token": [""],
  "X-API-Key": [""],
  "Connection": ["keep-alive", "close"],
  "Transfer-Encoding": ["chunked"],
  "Content-Length": [""],
  "Content-Disposition": ["attachment; filename=\"\"", "inline"],
  "Access-Control-Allow-Origin": ["*"],
  "Access-Control-Allow-Methods": ["GET, POST, PUT, DELETE, OPTIONS"],
  "Access-Control-Allow-Headers": ["Content-Type, Authorization"],
  "Pragma": ["no-cache"],
  "Expires": ["0"],
  "Range": ["bytes=0-"],
  "Host": [""],
  "DNT": ["1"],
};

const ALL_HEADER_KEYS = Object.keys(HEADER_DICT);

const createEmptyKeyValue = (): KeyValue => ({ key: "", value: "", description: "", enabled: true });
const isEmptyKeyValueRow = (item: KeyValue) => !item.key.trim() && !item.value.trim() && !(item.description || "").trim();

function normalizeKeyValueRows(items: KeyValue[]) {
  const autoRows = items.filter((item) => item.isAuto);
  const customRows = items.filter((item) => !item.isAuto);
  const normalizedCustomRows = [...customRows];

  while (
    normalizedCustomRows.length > 1 &&
    isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 1]) &&
    isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 2])
  ) {
    normalizedCustomRows.pop();
  }

  if (normalizedCustomRows.length === 0 || !isEmptyKeyValueRow(normalizedCustomRows[normalizedCustomRows.length - 1])) {
    normalizedCustomRows.push(createEmptyKeyValue());
  }

  return [...autoRows, ...normalizedCustomRows];
}

const createEmptyFormDataField = (): FormDataField => ({ key: "", value: "", fieldType: "text", enabled: true });
const isEmptyFormDataRow = (field: FormDataField) => !field.key.trim() && !field.value.trim() && !field.fileName && !(field.description || "").trim();

function normalizeFormDataRows(fields: FormDataField[]) {
  const normalizedFields = [...fields];

  while (
    normalizedFields.length > 1 &&
    isEmptyFormDataRow(normalizedFields[normalizedFields.length - 1]) &&
    isEmptyFormDataRow(normalizedFields[normalizedFields.length - 2])
  ) {
    normalizedFields.pop();
  }

  if (normalizedFields.length === 0 || !isEmptyFormDataRow(normalizedFields[normalizedFields.length - 1])) {
    normalizedFields.push(createEmptyFormDataField());
  }

  return normalizedFields;
}

/* ── KV Editor (table-based, for params, headers, form-urlencoded) ── */
export function KVEditor({ items, onChange, kp, vp, showPresets, showAutoToggle, collectionId }: {
  items: KeyValue[];
  onChange: (v: KeyValue[]) => void;
  kp: string;
  vp: string;
  showPresets?: boolean;
  showAutoToggle?: boolean;
  collectionId?: string | null;
}) {
  const { t } = useTranslation();
  const [showAuto, setShowAuto] = useState(false);
  const [activeKeySuggest, setActiveKeySuggest] = useState<number | null>(null);
  const [activeValueSuggest, setActiveValueSuggest] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const frameRef = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => normalizeKeyValueRows(items || []), [items]);
  const customRowCount = safe.filter((item) => !item.isAuto).length;
  const previousCustomRowCountRef = useRef(customRowCount);

  const autoCount = safe.filter(h => h.isAuto).length;
  const hasAuto = showAutoToggle && autoCount > 0;

  const update = (i: number, f: "key" | "value" | "description", v: string) => {
    const n = [...safe]; n[i] = { ...n[i], [f]: v }; onChange(normalizeKeyValueRows(n));
  };
  const toggle = (i: number) => {
    const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(normalizeKeyValueRows(n));
  };
  const remove = (i: number) => onChange(normalizeKeyValueRows(safe.filter((_, j) => j !== i)));

  const selectKeySuggestion = (i: number, key: string) => {
    const n = [...safe]; n[i] = { ...n[i], key };
    const vals = HEADER_DICT[key];
    if (vals && vals.length > 0 && !n[i].value) n[i].value = vals[0];
    onChange(normalizeKeyValueRows(n)); setActiveKeySuggest(null); setHighlightIdx(-1);
    if (vals && vals.length > 1) setActiveValueSuggest(i);
  };
  const selectValueSuggestion = (i: number, value: string) => {
    update(i, "value", value); setActiveValueSuggest(null); setHighlightIdx(-1);
  };
  const getKeySuggestions = (input: string): string[] => {
    if (!showPresets) return [];
    if (!input) return ALL_HEADER_KEYS.slice(0, 12);
    return ALL_HEADER_KEYS.filter(k => k.toLowerCase().includes(input.toLowerCase())).slice(0, 10);
  };
  const getValueSuggestions = (key: string): string[] => (!showPresets ? [] : HEADER_DICT[key] || []);
  const handleKeyDown = (e: React.KeyboardEvent, sugs: string[], onSel: (v: string) => void, onCls: () => void) => {
    if (!sugs.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx(p => (p + 1) % sugs.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx(p => (p <= 0 ? sugs.length - 1 : p - 1)); }
    else if (e.key === "Enter" && highlightIdx >= 0 && highlightIdx < sugs.length) { e.preventDefault(); onSel(sugs[highlightIdx]); }
    else if (e.key === "Escape") { e.preventDefault(); onCls(); setHighlightIdx(-1); }
  };

  const cellInput = "editor-table-input";

  // 可见行的全选/取消逻辑仅对可见行生效
  const visibleItems = safe.filter(item => !item.isAuto || showAuto);
  const selectableVisibleItems = visibleItems.filter(item => item.key.trim().length > 0);
  const allVisibleEnabled = selectableVisibleItems.length > 0 && selectableVisibleItems.every(item => item.enabled);

  useEffect(() => {
    if (customRowCount > previousCustomRowCountRef.current) {
      requestAnimationFrame(() => {
        frameRef.current?.scrollTo({ top: frameRef.current.scrollHeight, behavior: "smooth" });
      });
    }
    previousCustomRowCountRef.current = customRowCount;
  }, [customRowCount]);

  const renderRow = (item: KeyValue, i: number) => {
    const isSelectable = item.key.trim().length > 0;
    const keySugs = activeKeySuggest === i ? getKeySuggestions(item.key) : [];
    const valSugs = activeValueSuggest === i ? getValueSuggestions(item.key) : [];
    return (
      <tr key={i} className={cn("group", item.isAuto && "bg-bg-secondary/18")}>
        <td className="editor-table-check relative">
          {isSelectable ? (
            <input type="checkbox" checked={item.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto" />
          ) : (
            <span className="editor-table-empty-check block mx-auto" aria-hidden="true" />
          )}
        </td>
        <td>
          <TableCellInput value={item.key} onChange={v => update(i, "key", v)}
            onFocus={() => { if (showPresets) { setActiveKeySuggest(i); setActiveValueSuggest(null); setHighlightIdx(-1); } }}
            onBlur={() => setTimeout(() => { setActiveKeySuggest(null); setHighlightIdx(-1); }, 150)}
            onKeyDown={e => handleKeyDown(e, keySugs, k => selectKeySuggestion(i, k), () => setActiveKeySuggest(null))}
            placeholder={kp} disabled={!item.enabled} suggestions={keySugs} highlightIdx={highlightIdx}
            onSelectSuggestion={k => selectKeySuggestion(i, k)} className={cellInput} collectionId={collectionId} />
        </td>
        <td>
          <TableCellInput value={item.value} onChange={v => update(i, "value", v)}
            onFocus={() => { if (showPresets && HEADER_DICT[item.key]) { setActiveValueSuggest(i); setActiveKeySuggest(null); setHighlightIdx(-1); } }}
            onBlur={() => setTimeout(() => { setActiveValueSuggest(null); setHighlightIdx(-1); }, 150)}
            onKeyDown={e => handleKeyDown(e, valSugs, v => selectValueSuggestion(i, v), () => setActiveValueSuggest(null))}
            placeholder={vp} disabled={!item.enabled} suggestions={valSugs} highlightIdx={highlightIdx}
            onSelectSuggestion={v => selectValueSuggestion(i, v)} className={cellInput} collectionId={collectionId} />
        </td>
        <td>
          <input value={item.description || ""} onChange={e => update(i, "description", e.target.value)} placeholder="Description"
            className={cn("editor-table-input editor-table-description", !item.enabled && "editor-table-muted")} />
        </td>
        <td className="editor-table-actions">
          {isSelectable ? (
            <button onClick={() => remove(i)} className="editor-table-delete">
              <Trash2 className="h-3 w-3" />
              <span>{t('contextMenu.delete')}</span>
            </button>
          ) : (
            <span className="editor-table-empty-action" aria-hidden="true" />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="editor-table-shell">
      <div ref={frameRef} className="editor-table-frame">
        {hasAuto && (
          <div className="editor-table-banner">
            <button type="button" className="editor-table-banner-toggle" onClick={() => setShowAuto(!showAuto)}>
              {showAuto ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-medium">{autoCount} auto headers</span>
              <span className="text-text-disabled">{showAuto ? '点击隐藏' : '点击展示默认请求头'}</span>
            </button>
          </div>
        )}

        <table className="editor-table">
          <colgroup>
            <col style={{ width: '32px' }} />
            <col style={{ width: '33%' }} />
            <col style={{ width: '39%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '72px' }} />
          </colgroup>
        <thead>
          <tr>
            <th className="editor-table-check relative">
              <input
                type="checkbox"
                checked={allVisibleEnabled}
                onChange={() => {
                  onChange(safe.map(item => {
                    if (item.isAuto && !showAuto) return item;
                    if (!item.key.trim()) return item;
                    return { ...item, enabled: !allVisibleEnabled };
                  }));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto"
                title={allVisibleEnabled ? t('import.deselectAll') : t('import.selectAll')}
                disabled={selectableVisibleItems.length === 0}
              />
            </th>
            <th>{kp}</th>
            <th>{vp}</th>
            <th>Description</th>
            <th className="editor-table-actions" />
          </tr>
        </thead>
        <tbody>
          {hasAuto && showAuto && safe.map((item, i) => {
            if (!item.isAuto) return null;
            return renderRow(item, i);
          })}
          {safe.map((item, i) => {
            if (item.isAuto) return null;
            return renderRow(item, i);
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── TableCellInput: borderless input with portal suggestion dropdown ── */
function TableCellInput({ value, onChange, onFocus, onBlur, onKeyDown, placeholder, disabled, suggestions, highlightIdx, onSelectSuggestion, className: cls, collectionId }: {
  value: string; onChange: (v: string) => void; onFocus: () => void; onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void; placeholder: string; disabled: boolean;
  suggestions?: string[]; highlightIdx?: number; onSelectSuggestion?: (v: string) => void; className?: string;
  collectionId?: string | null;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hasSugs = suggestions && suggestions.length > 0;
  useEffect(() => { if (hasSugs && ref.current) setRect(ref.current.getBoundingClientRect()); }, [hasSugs, value]);

  return (
    <>
      <VariableInlineInput
        inputRef={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        collectionId={collectionId}
        className={cn(cls, disabled && "editor-table-muted")}
        overlayClassName={cn(cls, disabled && "editor-table-muted")}
        compactPopover
      />
      {hasSugs && rect && onSelectSuggestion && createPortal(
        <div className="fixed bg-bg-elevated border border-border-default rounded-lg shadow-xl max-h-[220px] overflow-y-auto py-0.5"
          style={{ top: rect.bottom + 2, left: rect.left, width: rect.width, zIndex: 9999 }}>
          {suggestions!.map((s, si) => (
            <button key={si} onMouseDown={e => { e.preventDefault(); onSelectSuggestion!(s); }}
              className={cn("w-full px-3 py-1.5 text-left text-[var(--fs-sm)] font-mono transition-colors",
                si === (highlightIdx ?? -1) ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-bg-hover",
                value === s && si !== (highlightIdx ?? -1) && "text-accent font-semibold")}>
              {s || <span className="text-text-disabled italic">{t('http.emptyValue')}</span>}
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

interface VariableSegment {
  kind: "text" | "token";
  text: string;
  key?: string;
}

function splitVariableSegments(value: string): VariableSegment[] {
  if (!value) return [];

  const segments: VariableSegment[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(/(\{\{\s*([\w.$-]+)\s*\}\})/g)) {
    const full = match[1];
    const key = match[2]?.trim();
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ kind: "text", text: value.slice(lastIndex, index) });
    }

    if (full && key) {
      segments.push({ kind: "token", text: full, key });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < value.length) {
    segments.push({ kind: "text", text: value.slice(lastIndex) });
  }

  return segments;
}

function VariableInlineInput({
  inputRef,
  value,
  collectionId,
  className,
  overlayClassName,
  compactPopover,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  collectionId?: string | null;
  overlayClassName?: string;
  compactPopover?: boolean;
}) {
  const { t } = useTranslation();
  const collections = useCollectionStore((state) => state.collections);
  const activeEnvId = useEnvStore((state) => state.activeEnvId);
  const envVars = useEnvStore((state) => state.variables);
  const globalVars = useEnvStore((state) => state.globalVariables);
  const variableKeys = useMemo(() => extractVariableKeys(String(value ?? '')), [value]);
  const segments = useMemo(() => splitVariableSegments(String(value ?? '')), [value]);
  const previews = useMemo(
    () => new Map(variableKeys.map((key) => [key, getVariablePreview(key, collectionId)])),
    [collectionId, collections, envVars, globalVars, activeEnvId, variableKeys]
  );
  const internalRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hasVariables = variableKeys.length > 0;

  const cancelClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    if (open && internalRef.current) {
      setRect(internalRef.current.getBoundingClientRect());
    }
  }, [open, value]);

  useEffect(() => () => cancelClose(), []);

  if (!hasVariables) {
    return <input ref={inputRef} value={value} className={className} {...props} />;
  }

  const attachRef = (node: HTMLInputElement | null) => {
    internalRef.current = node;
    if (inputRef) {
      inputRef.current = node;
    }
  };

  return (
    <>
      <div className="variable-inline-shell">
        <div className={cn("variable-inline-overlay", overlayClassName)} aria-hidden="true">
          <div className="variable-inline-track" style={{ transform: `translateX(-${scrollLeft}px)` }}>
            {segments.map((segment, index) => {
              if (segment.kind === "token" && segment.key) {
                const preview = previews.get(segment.key);
                return (
                  <span
                    key={`${segment.key}-${index}`}
                    className="variable-inline-token"
                    data-source={preview?.source ?? "missing"}
                    onMouseEnter={(event) => {
                      cancelClose();
                      setActiveKey(segment.key!);
                      setRect(event.currentTarget.getBoundingClientRect());
                      setOpen(true);
                    }}
                    onMouseLeave={scheduleClose}
                  >
                    {segment.text}
                  </span>
                );
              }

              return (
                <span key={`text-${index}`} className="variable-inline-text">
                  {segment.text || (index === 0 ? t('http.urlPlaceholder') : "")}
                </span>
              );
            })}
          </div>
        </div>

        <input
          {...props}
          ref={attachRef}
          value={value}
          className={cn(className, "variable-inline-input")}
          onScroll={(event) => {
            setScrollLeft(event.currentTarget.scrollLeft);
            props.onScroll?.(event);
          }}
        />
      </div>

      {open && rect && activeKey && previews.get(activeKey) && createPortal(
        <VariableHoverPopover
          rect={rect}
          preview={previews.get(activeKey)!}
          collectionId={collectionId}
          compact={compactPopover}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />,
        document.body
      )}
    </>
  );
}

function VariableHoverPopover({
  rect,
  preview,
  collectionId,
  compact,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: DOMRect;
  preview: ReturnType<typeof getVariablePreview>;
  collectionId?: string | null;
  compact?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(preview.source === "missing" ? "" : preview.rawValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setDraft(preview.source === "missing" ? "" : preview.rawValue);
    setSaved(false);
  }, [preview.key, preview.rawValue, preview.source]);

  const sourceLabelMap: Record<string, string> = {
    collection: t('http.variableSourceCollection'),
    environment: t('http.variableSourceEnvironment'),
    global: t('http.variableSourceGlobal'),
    dynamic: t('http.variableSourceDynamic'),
    missing: t('http.variableSourceMissing'),
  };

  const isSecretHidden = preview.isSecret && !revealed;
  const displayValue = preview.source === "missing"
    ? t('http.variableMissing')
    : isSecretHidden
      ? "••••••••"
      : preview.value;
  const canSaveToCollection = Boolean(collectionId) && preview.source !== "dynamic";

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "fixed z-[10000] rounded-[16px] border border-border-default/85 bg-bg-primary/98 shadow-[0_18px_46px_rgba(15,23,42,0.14)] backdrop-blur-xl",
        compact ? "w-[296px]" : "w-[340px]"
      )}
      style={{ top: rect.bottom + 10, left: Math.min(window.innerWidth - (compact ? 308 : 352), Math.max(12, rect.left - 8)) }}
    >
      <div className="border-b border-border-subtle/80 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
              {t('http.variablePreview')}
            </div>
            <div className="mt-1 font-mono text-[var(--fs-sm)] font-semibold text-text-primary">
              {`{{${preview.key}}}`}
            </div>
          </div>
          <div className="inline-flex shrink-0 rounded-full bg-bg-hover px-2 py-0.5 text-[var(--fs-xxs)] font-medium text-text-secondary">
            {sourceLabelMap[preview.source]}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--fs-xxs)] font-medium text-text-tertiary">
              {t('http.variableResolvedValue')}
            </span>
            {preview.isSecret && preview.source !== "missing" && (
              <button
                type="button"
                onClick={() => setRevealed((current) => !current)}
                className="text-text-disabled transition-colors hover:text-text-secondary"
              >
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <div className="rounded-[12px] border border-border-subtle/75 bg-bg-secondary/55 px-3 py-2 font-mono text-[var(--fs-sm)] leading-6 text-text-primary">
            {displayValue}
          </div>
        </div>

        {canSaveToCollection ? (
          <div className="space-y-1.5">
            <div className="text-[var(--fs-xxs)] font-medium text-text-tertiary">
              {t('http.variableSaveToCollection')}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('http.variableEditPlaceholder')}
                className="wb-field h-9 w-full px-3 text-[var(--fs-sm)] font-mono"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!collectionId) return;
                  setSaving(true);
                  try {
                    await upsertCollectionVariable(collectionId, preview.key, draft);
                    setSaved(true);
                    window.setTimeout(() => setSaved(false), 1200);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-accent px-3 text-[var(--fs-xs)] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {saved ? t('http.variableSaved') : t('http.variableSave')}
              </button>
            </div>
          </div>
        ) : !collectionId ? (
          <div className="rounded-[12px] bg-bg-secondary/45 px-3 py-2 text-[var(--fs-xs)] text-text-tertiary">
            {t('http.variableNoCollection')}
          </div>
        ) : preview.source === "dynamic" ? (
          <div className="rounded-[12px] bg-bg-secondary/45 px-3 py-2 text-[var(--fs-xs)] text-text-tertiary">
            {t('http.variableDynamicReadonly')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── FormData Editor (table-based, text + file fields) ── */
function FormDataEditor({ fields, onChange }: { fields: FormDataField[]; onChange: (v: FormDataField[]) => void }) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => normalizeFormDataRows(fields || []), [fields]);
  const selectableFields = safe.filter((field) => field.key.trim().length > 0);
  const previousFieldCountRef = useRef(safe.length);
  const update = (i: number, u: Partial<FormDataField>) => { const n = [...safe]; n[i] = { ...n[i], ...u }; onChange(normalizeFormDataRows(n)); };
  const toggle = (i: number) => { const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(normalizeFormDataRows(n)); };
  const remove = (i: number) => onChange(normalizeFormDataRows(safe.filter((_, j) => j !== i)));

  /** Get effective file paths/names (compat with legacy comma-separated data) */
  const getFilePaths = (field: FormDataField): string[] => {
    if (field.filePaths && field.filePaths.length > 0) return field.filePaths;
    if (field.value) return field.value.split(',').map(p => p.trim()).filter(Boolean);
    return [];
  };
  const getFileNames = (field: FormDataField): string[] => {
    if (field.fileNames && field.fileNames.length > 0) return field.fileNames;
    if (field.fileName) return field.fileName.split(',').map(n => n.trim()).filter(Boolean);
    // fallback: extract names from paths
    return getFilePaths(field).map(p => p.split(/[\\/]/).pop() || 'file');
  };

  const handleFilePick = async (i: number) => {
    const { pickFiles } = await import("@/services/httpService");
    const r = await pickFiles();
    if (!r) return;
    const field = safe[i];
    const existingPaths = getFilePaths(field);
    const existingNames = getFileNames(field);
    // Append new files to existing list
    const newPaths = [...existingPaths, ...r.paths];
    const newNames = [...existingNames, ...r.names];
    update(i, {
      filePaths: newPaths,
      fileNames: newNames,
      value: newPaths.join(','),
      fileName: newNames.join(', '),
    });
  };

  const handleRemoveFile = (fieldIdx: number, fileIdx: number) => {
    const field = safe[fieldIdx];
    const paths = [...getFilePaths(field)];
    const names = [...getFileNames(field)];
    paths.splice(fileIdx, 1);
    names.splice(fileIdx, 1);
    update(fieldIdx, {
      filePaths: paths,
      fileNames: names,
      value: paths.join(','),
      fileName: names.join(', '),
    });
  };

  useEffect(() => {
    if (safe.length > previousFieldCountRef.current) {
      requestAnimationFrame(() => {
        frameRef.current?.scrollTo({ top: frameRef.current.scrollHeight, behavior: "smooth" });
      });
    }
    previousFieldCountRef.current = safe.length;
  }, [safe.length]);

  return (
    <div className="editor-table-shell">
      <div ref={frameRef} className="editor-table-frame">
      <table className="editor-table table-fixed">
        <colgroup>
          <col style={{ width: '32px' }} />
          <col style={{ width: '80px' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '72px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="editor-table-check relative">
              <input
                type="checkbox"
                checked={selectableFields.length > 0 && selectableFields.every(f => f.enabled)}
                onChange={() => {
                  const allEnabled = selectableFields.length > 0 && selectableFields.every(f => f.enabled);
                  onChange(safe.map(f => f.key.trim() ? { ...f, enabled: !allEnabled } : f));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto"
                title={(selectableFields.length > 0 && selectableFields.every(f => f.enabled)) ? t('import.deselectAll') : t('import.selectAll')}
                disabled={selectableFields.length === 0}
              />
            </th>
            <th>{t('http.type')}</th>
            <th>Key</th>
            <th>Value</th>
            <th>Description</th>
            <th className="editor-table-actions" />
          </tr>
        </thead>
        <tbody>
          {safe.map((field, i) => (
            <tr key={i} className="group">
              <td className="editor-table-check relative">
                {field.key.trim() ? (
                  <input type="checkbox" checked={field.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer m-0 align-middle block mx-auto" />
                ) : (
                  <span className="editor-table-empty-check block mx-auto" aria-hidden="true" />
                )}
              </td>
              <td>
                <select value={field.fieldType}
                  onChange={e => update(i, { fieldType: e.target.value as 'text' | 'file', value: '', fileName: undefined, filePaths: [], fileNames: [] })}
                  className={cn("editor-table-select text-[var(--fs-xs)] text-text-secondary", !field.enabled && "editor-table-muted")}>
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td>
                <input value={field.key} onChange={e => update(i, { key: e.target.value })} placeholder="Key"
                  className={cn("editor-table-input", !field.enabled && "editor-table-muted")} />
              </td>
              <td>
                {field.fieldType === "text" ? (
                  <input value={field.value} onChange={e => update(i, { value: e.target.value })} placeholder="Value"
                    className={cn("editor-table-input", !field.enabled && "editor-table-muted")} />
                ) : (
                  <div className={cn("flex items-start w-full min-h-[34px]", !field.enabled && "editor-table-muted")}>
                    <button onClick={() => handleFilePick(i)}
                      className="shrink-0 h-[34px] px-2 flex items-center gap-1 bg-transparent text-[var(--fs-xs)] cursor-pointer hover:bg-bg-hover transition-colors rounded"
                      title={getFilePaths(field).length > 0 ? "添加更多文件" : t('http.selectFile')}>
                      <Upload className="w-3 h-3 text-text-disabled shrink-0" />
                      <span className="text-text-tertiary whitespace-nowrap">{getFilePaths(field).length > 0 ? "+" : t('http.selectFile')}</span>
                    </button>
                    {getFilePaths(field).length > 0 && (
                      <div className="flex-1 min-w-0 max-h-[68px] overflow-y-auto flex flex-wrap gap-1 py-1 px-1">
                        {getFileNames(field).map((name, fi) => (
                          <span
                            key={fi}
                            title={getFilePaths(field)[fi] || name}
                            className="inline-flex items-center gap-0.5 max-w-[160px] px-1.5 py-0.5 rounded bg-bg-hover text-[var(--fs-xxs)] text-text-secondary border border-border-subtle cursor-default group/chip"
                          >
                            <span className="truncate">{name}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRemoveFile(i, fi); }}
                              className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-red-500/15 hover:text-red-500 text-text-disabled transition-colors"
                              title={`移除 ${name}`}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td>
                <input value={field.description || ''} onChange={e => update(i, { description: e.target.value })} placeholder="Description"
                  className={cn("editor-table-input editor-table-description", !field.enabled && "editor-table-muted")} />
              </td>
              <td className="editor-table-actions">
                {field.key.trim() ? (
                  <button onClick={() => remove(i)} className="editor-table-delete">
                    <Trash2 className="h-3 w-3" />
                    <span>{t('contextMenu.delete')}</span>
                  </button>
                ) : (
                  <span className="editor-table-empty-action" aria-hidden="true" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}



/* ── OAuth 2.0 Panel ── */
function OAuth2Panel({ config, onChange }: { config: OAuth2Config; onChange: (updates: Partial<OAuth2Config>) => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ tokenType?: string; expiresIn?: number; scope?: string } | null>(null);

  const canFetchToken = config.accessTokenUrl && config.clientId && (
    config.grantType === "client_credentials" ||
    (config.grantType === "password" && config.username) ||
    (config.grantType === "authorization_code" && config.authUrl && config.redirectUri)
  );

  const exchangeCodeForToken = async (code: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{
      accessToken: string;
      tokenType?: string;
      expiresIn?: number;
      refreshToken?: string;
      scope?: string;
    }>("fetch_oauth2_token", {
      req: {
        grantType: config.grantType,
        accessTokenUrl: config.accessTokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: config.scope || null,
        username: config.username || null,
        password: config.password || null,
        code,
        redirectUri: config.redirectUri || null,
      },
    });
  };

  const handleFetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
      if (config.grantType === "authorization_code") {
        // Step 1: Open OAuth window to get authorization code
        setAuthorizing(true);
        const { openOAuthWindow } = await import("@/lib/oauthWindow");
        let oauthResult;
        try {
          oauthResult = await openOAuthWindow({
            authUrl: config.authUrl,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            scope: config.scope,
          });
        } finally {
          setAuthorizing(false);
        }

        // Step 2: Exchange code for token
        const result = await exchangeCodeForToken(oauthResult.code);
        onChange({ accessToken: result.accessToken });
        setTokenMeta({
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope,
        });
      } else {
        // client_credentials or password: direct token request
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{
          accessToken: string;
          tokenType?: string;
          expiresIn?: number;
          refreshToken?: string;
          scope?: string;
        }>("fetch_oauth2_token", {
          req: {
            grantType: config.grantType,
            accessTokenUrl: config.accessTokenUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            scope: config.scope || null,
            username: config.username || null,
            password: config.password || null,
            code: null,
            redirectUri: null,
          },
        });
        onChange({ accessToken: result.accessToken });
        setTokenMeta({
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setAuthorizing(false);
    }
  };

  const buttonLabel = authorizing
    ? t('http.oauth2.authorizing')
    : loading
      ? t('http.oauth2.fetchingToken')
      : config.grantType === "authorization_code"
        ? t('http.oauth2.authorize')
        : t('http.oauth2.fetchToken');

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-[var(--fs-sm)] font-medium text-text-secondary">{t('http.authType')}</label>
        <div className="wb-segmented w-fit">
          {(["client_credentials", "authorization_code", "password"] as const).map((gt) => (
            <button
              key={gt}
              onClick={() => { onChange({ grantType: gt }); setError(null); setTokenMeta(null); }}
              className={cn("wb-segment", config.grantType === gt && "wb-segment-active")}
            >
              {gt === "client_credentials" ? "Client Credentials" : gt === "authorization_code" ? "Authorization Code" : "Password"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Access Token URL</label>
        <input value={config.accessTokenUrl} onChange={(e) => onChange({ accessTokenUrl: e.target.value })} placeholder="https://auth.example.com/oauth/token" className="wb-field w-full font-mono text-[var(--fs-base)]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Client ID</label>
          <input value={config.clientId} onChange={(e) => onChange({ clientId: e.target.value })} className="wb-field w-full font-mono text-[var(--fs-base)]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Client Secret</label>
          <input value={config.clientSecret} onChange={(e) => onChange({ clientSecret: e.target.value })} type="password" className="wb-field w-full font-mono text-[var(--fs-base)]" />
        </div>
      </div>
      {config.grantType === "authorization_code" && (
        <>
          <div className="space-y-1.5">
            <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Auth URL</label>
            <input value={config.authUrl} onChange={(e) => onChange({ authUrl: e.target.value })} placeholder="https://auth.example.com/authorize" className="wb-field w-full font-mono text-[var(--fs-base)]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Redirect URI</label>
            <input value={config.redirectUri} onChange={(e) => onChange({ redirectUri: e.target.value })} className="wb-field w-full font-mono text-[var(--fs-base)]" />
          </div>
        </>
      )}
      {config.grantType === "password" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Username</label>
            <input value={config.username} onChange={(e) => onChange({ username: e.target.value })} className="wb-field w-full text-[var(--fs-base)]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Password</label>
            <input value={config.password} onChange={(e) => onChange({ password: e.target.value })} type="password" className="wb-field w-full text-[var(--fs-base)]" />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Scope</label>
        <input value={config.scope} onChange={(e) => onChange({ scope: e.target.value })} placeholder="read write" className="wb-field w-full font-mono text-[var(--fs-base)]" />
      </div>

      {/* Get Token + Access Token */}
      <div className="pt-2 border-t border-border-default">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleFetchToken}
            disabled={loading || !canFetchToken}
            className={cn(
              "px-4 py-2 text-[var(--fs-sm)] font-semibold rounded-lg transition-all flex items-center gap-2",
              loading
                ? "bg-amber-400 text-white cursor-wait"
                : canFetchToken
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm"
                  : "bg-bg-tertiary text-text-disabled cursor-not-allowed"
            )}
          >
            {(loading || authorizing) && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" />
              </svg>
            )}
            {buttonLabel}
          </button>
          {tokenMeta && (
            <div className="flex items-center gap-2 text-[var(--fs-xs)] text-text-tertiary">
              {tokenMeta.tokenType && <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded text-[var(--fs-xxs)] font-medium">{tokenMeta.tokenType}</span>}
              {tokenMeta.expiresIn && <span>{t('http.tokenExpiry', { time: tokenMeta.expiresIn })}</span>}
              {tokenMeta.scope && <span>scope: {tokenMeta.scope}</span>}
            </div>
          )}
        </div>
        {authorizing && (
          <div className="mb-3 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-[var(--fs-sm)] text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('http.oauth2.authorizingHint')}
          </div>
        )}
        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[var(--fs-sm)] text-red-600 dark:text-red-400 break-all">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">Access Token</label>
          <input value={config.accessToken} onChange={(e) => onChange({ accessToken: e.target.value })} placeholder={t('http.oauth2.accessTokenPlaceholder')} className="wb-field w-full font-mono text-[var(--fs-sm)]" />
        </div>
      </div>
    </div>
  );
}

/* ── Binary File Picker ── */
function BinaryPicker({ filePath, fileName, onChange }: { filePath: string; fileName: string; onChange: (path: string, name: string) => void }) {
  const { t } = useTranslation();
  const handlePick = async () => {
    const { pickFile } = await import("@/services/httpService");
    const result = await pickFile();
    if (result) {
      onChange(result.path, result.name);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {filePath ? (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-border-default bg-bg-secondary/50">
          <FileIcon className="w-8 h-8 text-accent/60" />
          <div className="min-w-0">
            <p className="text-[var(--fs-base)] font-medium text-text-primary truncate max-w-xs">{fileName}</p>
            <p className="text-[var(--fs-xs)] text-text-disabled font-mono truncate max-w-xs">{filePath}</p>
          </div>
          <button onClick={() => onChange('', '')} className="p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-red-500 transition-colors" title={t('http.removeFile')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={handlePick}
          className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-border-default hover:border-accent text-text-disabled hover:text-accent transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8" />
          <span className="text-[var(--fs-base)] font-medium">{t('http.selectFile')}</span>
          <span className="text-[var(--fs-xs)]">{t('http.binaryDesc')}</span>
        </button>
      )}
    </div>
  );
}
