import { lazy, memo, Suspense, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Play, Loader2, Copy, Check, ChevronDown, X, Save, Flame, Cookie, CheckCircle2, XCircle, Terminal, Square, Braces } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { HttpMethod, ScriptResult, HttpRequestMode } from "@/types/http";
import { ensureAutoHeaders } from "@/types/http";
import type { CollectionItem } from "@/types/collections";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SaveRequestDialog } from "./SaveRequestDialog";
import { JsonEditorLite } from "@/components/common/JsonEditorLite";
import { ResponseViewer } from "@/components/ui/ResponseViewer";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher, type RequestKind } from "@/components/request/RequestProtocolSwitcher";
import { buildCollectionItemFromHttpConfig, getCollectionRequestSignatureFromConfig, getCollectionRequestSignatureFromItem } from "@/lib/collectionRequest";
import { persistScriptVariableUpdates } from "@/lib/requestVariables";
import { recordRequestStat } from "@/components/plugins/RequestStatsPanel";
import { buildRequestPayload, resolveHttpConfig, sendHttpRequest, sendRequestWithScripts } from "@/services/httpService";
import { parseQueryStringToParams, joinUrlWithParams } from "@/lib/urlQuerySync";
import { KVEditor, FormDataEditor } from "./KVEditor";
import { VariableInlineInput } from "./VariableInlineInput";
import { AuthPanel } from "./AuthPanel";
import { HttpSseResponsePanel, type SseEvent } from "./HttpSsePanel";
import { GraphQLBodyEditor, MonacoEditorSurface, EditorSurfaceFallback } from "./GraphQLBodyEditor";
import { ResponseMetaPill, HttpRequestErrorPanel, ResponseHeaderMetric } from "./HttpResponseParts";
import { ExportPluginDropdown } from "./ExportPluginDropdown";
import { BinaryPicker } from "./BinaryPicker";
import { AssertionBuilder, TestResultsPanel, generateAssertionCode, type Assertion } from "./AssertionBuilder";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
const LazyScriptEditor = lazy(() => import("./ScriptEditor").then((module) => ({ default: module.ScriptEditor })));

const methodTextColor: Record<string, string> = {
  GET: "text-emerald-600", POST: "text-amber-600", PUT: "text-blue-600",
  DELETE: "text-red-500", PATCH: "text-violet-600", HEAD: "text-cyan-600", OPTIONS: "text-gray-500",
};

const methodDotColor: Record<string, string> = {
  GET: "bg-emerald-500", POST: "bg-amber-500", PUT: "bg-blue-500",
  DELETE: "bg-red-500", PATCH: "bg-violet-500", HEAD: "bg-cyan-500", OPTIONS: "bg-gray-400",
};

function mergeScriptScopeUpdates(
  ...updates: Array<Record<string, string> | null | undefined>
): Record<string, string> {
  return updates.reduce<Record<string, string>>((acc, item) => {
    if (!item) return acc;
    return { ...acc, ...item };
  }, {});
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

export const HttpWorkspace = memo(function HttpWorkspace({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const updateTab = useAppStore((s) => s.updateTab);
  const setHttpResponse = useAppStore((s) => s.setHttpResponse);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const saveRequestToCollection = useCollectionStore((s) => s.saveRequest);

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth" | "pre-script" | "post-script" | "tests">("params");
  const [resTab, setResTab] = useState<"body" | "headers" | "cookies" | "timing" | "tests">("body");
  const [copied, setCopied] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);
  const [scriptResults, setScriptResults] = useState<{ pre: ScriptResult | null; post: ScriptResult | null }>({ pre: null, post: null });
  const [urlFocused, setUrlFocused] = useState(false);
  const [urlHighlight, setUrlHighlight] = useState(-1);
  const [sseStatus, setSseStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [sseError, setSseError] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlRectRef = useRef<DOMRect | null>(null);
  const sseListRef = useRef<HTMLDivElement>(null);
  const syncingFromRef = useRef<'url' | 'params' | null>(null);
  const initializedTabsRef = useRef<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  // 初次加载 tab 时：双向同步 URL ↔ queryParams
  useEffect(() => {
    const httpConfig = activeTab?.httpConfig;
    if (!httpConfig || !tabId) return;
    if (initializedTabsRef.current.has(tabId)) return;
    initializedTabsRef.current.add(tabId);

    const url = httpConfig.url || '';
    const qIndex = url.indexOf('?');
    const hasUrlQuery = qIndex >= 0 && url.slice(qIndex + 1).length > 0;
    const enabledParams = (httpConfig.queryParams || []).filter(p => p.key.trim() && p.enabled);
    const hasRealParams = enabledParams.length > 0;
    const parsedUrlParams = hasUrlQuery ? parseQueryStringToParams(url.slice(qIndex + 1)) : [];

    if (hasUrlQuery && !hasRealParams) {
      if (parsedUrlParams.length > 0) {
        const nextParams = [...parsedUrlParams, { key: '', value: '', enabled: true }];
        updateHttpConfig(tabId, {
          queryParams: nextParams,
          url: joinUrlWithParams(url, parsedUrlParams),
        });
      }
    } else if (hasRealParams) {
      const normalizedUrl = joinUrlWithParams(url, enabledParams);
      if (normalizedUrl !== url) {
        updateHttpConfig(tabId, { url: normalizedUrl });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // URL history autocomplete
  const historyEntries = useHistoryStore((s) => s.entries);
  useEffect(() => { useHistoryStore.getState().fetchHistory(); }, []);
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
  const graphqlHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    for (const kv of config.headers) {
      if (kv.enabled && kv.key.trim()) h[kv.key.trim()] = kv.value;
    }
    return h;
  }, [config.headers]);
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
      setSseEvents((prev) => {
        const next = [...prev, event.payload];
        return next.length > 5000 ? next.slice(-5000) : next;
      });
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
    const allowedTabs = isSseMode ? ["params", "headers", "auth"] : ["params", "headers", "body", "auth", "tests", "pre-script", "post-script"];
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
    const currentRequestId = ++requestIdRef.current;
    setLoading(tabId, true);
    setError(tabId, null);
    setScriptResults({ pre: null, post: null });
    let finalResponse: import("@/types/http").HttpResponse | null = null;
    try {
      // Inject visual assertions into postScript
      const assertionCode = generateAssertionCode(parsedAssertions);
      const configWithAssertions = assertionCode
        ? { ...config, postScript: (config.postScript || '') + '\n' + assertionCode }
        : config;

      const hasScripts = (configWithAssertions.preScript?.trim() || configWithAssertions.postScript?.trim());
      if (hasScripts) {
        const result = await sendRequestWithScripts(configWithAssertions);
        if (requestIdRef.current !== currentRequestId) return;
        await persistScriptVariableUpdates(activeTab.linkedCollectionId, activeTab.linkedCollectionItemId, {
          envUpdates: mergeScriptScopeUpdates(
            result.preScriptResult?.envUpdates,
            result.postScriptResult?.envUpdates
          ),
          folderUpdates: mergeScriptScopeUpdates(
            result.preScriptResult?.folderUpdates,
            result.postScriptResult?.folderUpdates
          ),
          collectionUpdates: mergeScriptScopeUpdates(
            result.preScriptResult?.collectionUpdates,
            result.postScriptResult?.collectionUpdates
          ),
          globalUpdates: mergeScriptScopeUpdates(
            result.preScriptResult?.globalUpdates,
            result.postScriptResult?.globalUpdates
          ),
        });
        finalResponse = result.response;
        setHttpResponse(tabId, result.response);
        setScriptResults({ pre: result.preScriptResult, post: result.postScriptResult });
      } else {
        const res = await sendHttpRequest(configWithAssertions);
        if (requestIdRef.current !== currentRequestId) return;
        finalResponse = res;
        setHttpResponse(tabId, res);
      }

      if (finalResponse?.isEventStream) {
        updateHttpConfig(tabId, { requestMode: 'sse' });
        setHttpResponse(tabId, null);
        setTimeout(() => void handleSseConnect(), 0);
      }
    } catch (err: any) {
      if (requestIdRef.current !== currentRequestId) return;
      setError(tabId, err.message || String(err));
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setLoading(tabId, false);
      }
      if (finalResponse) {
        const resolvedConfig = resolveHttpConfig(config);
        useHistoryStore.getState().addEntry({
          id: crypto.randomUUID(),
          method: resolvedConfig.method,
          url: resolvedConfig.url,
          status: finalResponse.status,
          durationMs: finalResponse.durationMs ?? null,
          bodySize: finalResponse.bodySize ?? null,
          requestConfig: JSON.stringify(resolvedConfig),
          responseSummary: null,
          createdAt: new Date().toISOString(),
        });
        recordRequestStat({
          method: resolvedConfig.method,
          url: resolvedConfig.url,
          status: finalResponse.status,
          duration: finalResponse.durationMs,
          timestamp: Date.now(),
          size: finalResponse.bodySize,
        });
        const { useActivityLogStore: logStore } = await import("@/stores/activityLogStore");
        logStore.getState().addEntry({
          source: 'http',
          direction: 'sent',
          summary: `${resolvedConfig.method} ${resolvedConfig.url} - ${finalResponse.status} (${finalResponse.durationMs}ms)`,
        });
      }
    }
  }, [activeTab.linkedCollectionId, tabId, config, setLoading, setHttpResponse, setError, handleSseConnect, handleSseDisconnect, isSseConnected, isSseMode, updateHttpConfig]);

  const handleCancel = useCallback(() => {
    requestIdRef.current++;
    setLoading(tabId, false);
    setError(tabId, null);
  }, [tabId, setLoading, setError]);

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

      if (kind === "ws" || kind === "mqtt" || kind === "grpc") {
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
  const headers = useMemo(() => ensureAutoHeaders(Array.isArray(config.headers) ? config.headers : []), [config.headers]);
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
      const linkedItems = useCollectionStore.getState().items[activeTab.linkedCollectionId!] || [];
      const existingItem = linkedItems.find(i => i.id === activeTab.linkedCollectionItemId);
      const item = buildCollectionItemFromHttpConfig({
        config,
        itemId: activeTab.linkedCollectionItemId!,
        collectionId: activeTab.linkedCollectionId!,
        parentId: activeTab.linkedCollectionParentId ?? null,
        sortOrder: activeTab.linkedCollectionSortOrder ?? 0,
        createdAt: activeTab.linkedCollectionCreatedAt ?? now,
        updatedAt: now,
        responseExample: existingItem?.responseExample || '',
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

  // ── Auto-save timer ──
  const autoSaveInterval = useSettingsStore((s) => s.settings.autoSaveInterval);
  const handleSaveRef = useRef(handleSaveRequest);
  handleSaveRef.current = handleSaveRequest;

  useEffect(() => {
    if (autoSaveInterval <= 0 || !isLinkedCollectionRequest || isSavedRequestPristine) return;

    const timer = setInterval(() => {
      handleSaveRef.current();
    }, autoSaveInterval * 1000);

    return () => clearInterval(timer);
  }, [autoSaveInterval, isLinkedCollectionRequest, isSavedRequestPristine]);

  const hasAuthContent = config.authType !== "none";
  const hasBodyContent = config.bodyType !== "none";
  const parsedAssertions: Assertion[] = useMemo(() => {
    try { return JSON.parse(config.assertions || '[]'); } catch { return []; }
  }, [config.assertions]);

  const reqTabs = [
    { key: "params" as const, label: `${t('http.params')}${params.filter(p => p.key).length ? ` (${params.filter(p => p.key).length})` : ""}` },
    { key: "headers" as const, label: `${t('http.headers')}${headers.filter(h => h.key).length ? ` (${headers.filter(h => h.key).length})` : ""}` },
    ...(!isSseMode ? [{ key: "body" as const, label: isGraphqlMode ? t('http.graphql.modeLabel') : t('http.body'), hasContent: hasBodyContent }] : []),
    { key: "auth" as const, label: t('http.auth'), hasContent: hasAuthContent },
    ...(!isSseMode ? [
      { key: "tests" as const, label: `${t('assertion.testResults')}${parsedAssertions.length ? ` (${parsedAssertions.length})` : ''}`, hasContent: parsedAssertions.length > 0 },
      { key: "pre-script" as const, label: t('http.preScript'), hasContent: !!config.preScript?.trim() },
      { key: "post-script" as const, label: t('http.postScript'), hasContent: !!config.postScript?.trim() },
    ] : []),
  ];

  const requestLayoutMode = reqTab === "params" || reqTab === "headers"
    ? "compact"
    : reqTab === "body" && !isGraphqlMode && (config.bodyType === "formUrlencoded" || config.bodyType === "formData")
      ? "table-body"
      : isGraphqlMode
        ? "graphql"
        : "default";

  const requestDefaultSize = requestLayoutMode === "compact" ? 40 : requestLayoutMode === "table-body" ? 58 : requestLayoutMode === "graphql" ? 60 : 58;
  const responseDefaultSize = requestLayoutMode === "compact" ? 60 : requestLayoutMode === "table-body" ? 42 : requestLayoutMode === "graphql" ? 40 : 42;

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
                  "wb-request-method border-0 shadow-sm",
                  config.method === "GET" && "bg-emerald-500",
                  config.method === "POST" && "bg-amber-500",
                  config.method === "PUT" && "bg-blue-500",
                  config.method === "DELETE" && "bg-red-500",
                  config.method === "PATCH" && "bg-violet-500",
                  config.method === "HEAD" && "bg-cyan-500",
                  config.method === "OPTIONS" && "bg-slate-500"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                {config.method}
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>
              {showMethods && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMethods(false)} />
                  <div className="absolute left-0 top-full z-50 mt-2 min-w-[140px] overflow-hidden pf-rounded-lg border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                    {METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => { updateHttpConfig(tabId, { method: m }); setShowMethods(false); }}
                        className={cn(
                          "flex w-full items-center gap-2.5 pf-rounded-md px-3 py-2 pf-text-sm font-semibold transition-colors hover:bg-bg-hover",
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
                onChange={(e) => {
                  const newUrl = e.target.value;
                  setUrlHighlight(-1);
                  if (syncingFromRef.current === 'params') {
                    updateHttpConfig(tabId, { url: newUrl });
                    return;
                  }
                  syncingFromRef.current = 'url';
                  try {
                    const qIndex = newUrl.indexOf('?');
                    if (qIndex >= 0) {
                      const newParams = parseQueryStringToParams(newUrl.slice(qIndex + 1));
                      newParams.push({ key: '', value: '', enabled: true });
                      updateHttpConfig(tabId, { url: newUrl, queryParams: newParams });
                    } else {
                      updateHttpConfig(tabId, { url: newUrl, queryParams: [{ key: '', value: '', enabled: true }] });
                    }
                  } finally {
                    syncingFromRef.current = null;
                  }
                }}
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
                itemId={activeTab.linkedCollectionItemId}
                className="wb-request-input"
                overlayClassName="wb-request-input"
              />
            </div>
            {urlSuggestions.length > 0 && urlFocused && urlRectRef.current && createPortal(
              <div className="fixed z-[var(--z-toast)] max-h-[220px] overflow-y-auto pf-rounded-xl border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_20px_48px_rgba(15,23,42,0.14)]"
                style={{ top: (urlRectRef.current.bottom + 2), left: urlRectRef.current.left, width: urlRectRef.current.width }}>
                {urlSuggestions.map((u, i) => (
                  <button key={u} onMouseDown={(e) => { e.preventDefault(); updateHttpConfig(tabId, { url: u }); setUrlFocused(false); }}
                    className={cn("w-full pf-rounded-md px-3 py-2 text-left pf-text-sm font-mono truncate transition-colors",
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
              <ExportPluginDropdown config={config} />

            </div>
            {!isSseMode && loading ? (
              <button
                onClick={handleCancel}
                data-cancel-button
                className="wb-primary-btn min-w-[88px] bg-error hover:bg-error/90 active:scale-[0.97] transition-all"
              >
                <X className="w-3.5 h-3.5" />
                {t('http.cancel', '取消')}
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(isSseMode ? sseStatus === "connecting" : false) || !config.url.trim()}
                data-send-button
                className={cn(
                  "wb-primary-btn min-w-[88px] bg-accent",
                  isSseMode
                    ? sseStatus === "connected"
                      ? "bg-error hover:bg-error/90"
                      : sseStatus === "connecting"
                        ? "animate-pulse opacity-90 shadow-[0_0_12px_rgba(59,130,246,0.45)] cursor-wait"
                        : "hover:bg-accent-hover"
                    : "hover:bg-accent-hover"
                )}
              >
                {isSseMode ? (
                  sseStatus === "connected" ? <Square className="w-3 h-3 fill-white" /> : sseStatus === "connecting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-white" />
                ) : (
                  <Play className="w-3 h-3 fill-white" />
                )}
                {isSseMode ? (sseStatus === "connected" ? t('sse.disconnect') : sseStatus === "connecting" ? t('sse.connecting') : t('sse.connect')) : t('http.send')}
              </button>
            )}
          </>
        )}
      />

      {/* Main Split Area */}
      <div className="flex-1 min-h-0 overflow-hidden pb-3 pt-1.5">
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
                    "wb-tab flex items-center gap-1.5",
                    reqTab === t.key && "wb-tab-active text-text-primary"
                  )}
                >
                  {t.label}
                  {(t as any).hasContent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/90 shadow-[0_0_6px_rgba(16,185,129,0.4)] shrink-0" />}
                </button>
              ))}
            </div>

            <div className="http-workbench-body">
              {reqTab === "params" && <div className="px-3 py-0 flex-1 min-h-0 flex flex-col"><KVEditor items={params} showMockGenerator onChange={(v) => {
                if (syncingFromRef.current === 'url') {
                  updateHttpConfig(tabId, { queryParams: v });
                  return;
                }
                syncingFromRef.current = 'params';
                try {
                  updateHttpConfig(tabId, { queryParams: v, url: joinUrlWithParams(config.url, v) });
                } finally {
                  syncingFromRef.current = null;
                }
              }} kp="Query Param" vp="Value" collectionId={activeTab.linkedCollectionId} itemId={activeTab.linkedCollectionItemId} /></div>}
              {reqTab === "headers" && <div className="px-3 py-0 flex-1 min-h-0 flex flex-col"><KVEditor items={headers} showMockGenerator onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" showPresets showAutoToggle collectionId={activeTab.linkedCollectionId} itemId={activeTab.linkedCollectionItemId} /></div>}

              {reqTab === "body" && (
                <div className="p-4 flex flex-col flex-1 min-h-0">
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
                          {bt === "none" ? "none" : bt === "formUrlencoded" ? "x-www-form-urlencoded" : bt === "formData" ? "form-data" : bt === "binary" ? "binary" : bt === "graphql" ? "GraphQL" : bt === "raw" ? "raw" : "JSON"}
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
                        endpointUrl={config.url || undefined}
                        requestHeaders={graphqlHeaders}
                      />
                    ) : config.bodyType === "none" ? <div className="absolute inset-0 flex items-center justify-center text-text-disabled pf-text-base">{t('http.noBody')}</div> : null}
                    {!isGraphqlMode && config.bodyType === "json" && (
                      <div className="w-full h-full border border-border-default/80 pf-rounded-lg overflow-hidden bg-bg-input/88 focus-within:border-accent transition-colors">
                        <JsonEditorLite
                          value={config.jsonBody || ''}
                          onChange={(v) => updateHttpConfig(tabId, { jsonBody: v })}
                          className="h-full bg-transparent"
                        />
                      </div>
                    )}
                    {!isGraphqlMode && config.bodyType === "graphql" && (
                      <GraphQLBodyEditor
                        query={config.graphqlQuery || ""}
                        variables={config.graphqlVariables || ""}
                        onQueryChange={(v) => updateHttpConfig(tabId, { graphqlQuery: v })}
                        onVariablesChange={(v) => updateHttpConfig(tabId, { graphqlVariables: v })}
                        endpointUrl={config.url || undefined}
                        requestHeaders={graphqlHeaders}
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
                        <div className="w-full flex-1 border border-border-default/80 pf-rounded-lg overflow-hidden bg-bg-input/88 focus-within:border-accent transition-colors">
                          <MonacoEditorSurface
                            value={config.rawBody || ''}
                            onChange={(v) => updateHttpConfig(tabId, { rawBody: v })}
                            language={config.rawContentType === 'application/javascript' ? 'javascript' : config.rawContentType === 'text/css' ? 'css' : config.rawContentType === 'text/html' ? 'html' : config.rawContentType === 'application/xml' ? 'xml' : 'plaintext'}
                          />
                        </div>
                      </div>
                    )}
                    {!isGraphqlMode && config.bodyType === "formUrlencoded" && <div className="flex-1 min-h-0 flex flex-col"><KVEditor items={formFields} showMockGenerator onChange={(v) => updateHttpConfig(tabId, { formFields: v })} kp="Field Name" vp="Value" collectionId={activeTab.linkedCollectionId} itemId={activeTab.linkedCollectionItemId} /></div>}
                    {!isGraphqlMode && config.bodyType === "formData" && <div className="flex-1 min-h-0 flex flex-col"><FormDataEditor fields={formDataFields} onChange={(v) => updateHttpConfig(tabId, { formDataFields: v })} /></div>}
                    {!isGraphqlMode && config.bodyType === "binary" && <BinaryPicker filePath={config.binaryFilePath} fileName={config.binaryFileName} onChange={(path, name) => updateHttpConfig(tabId, { binaryFilePath: path, binaryFileName: name })} />}
                  </div>
                </div>
              )}

              {reqTab === "auth" && (
                <AuthPanel
                  config={config}
                  tabId={tabId}
                  updateHttpConfig={updateHttpConfig}
                />
              )}

              {reqTab === "tests" && (
                <AssertionBuilder
                  assertions={parsedAssertions}
                  onChange={(a) => updateHttpConfig(tabId, { assertions: JSON.stringify(a) })}
                  testResults={scriptResults.post?.testResults}
                  response={response}
                />
              )}

            {reqTab === "pre-script" && (
                <Suspense fallback={<EditorSurfaceFallback label="加载前置脚本编辑器..." />}>
                  <LazyScriptEditor
                    type="pre"
                    value={config.preScript}
                    onChange={(v) => updateHttpConfig(tabId, { preScript: v })}
                  />
                </Suspense>
              )}

              {reqTab === "post-script" && (
                <div className="flex h-full min-h-0">
                  <div className="flex-1 min-w-0">
                    <Suspense fallback={<EditorSurfaceFallback label="加载后置脚本编辑器..." />}>
                      <LazyScriptEditor
                        type="post"
                        value={config.postScript}
                        onChange={(v) => updateHttpConfig(tabId, { postScript: v })}
                      />
                    </Suspense>
                  </div>
                  <div className="w-[320px] shrink-0 border-l border-border-default/60">
                    <AssertionBuilder
                      assertions={parsedAssertions}
                      onChange={(a) => updateHttpConfig(tabId, { assertions: JSON.stringify(a) })}
                      testResults={scriptResults.post?.testResults}
                      compact
                    />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="http-workbench-divider" />

          {/* Response Panel */}
          <Panel minSize="18" defaultSize={responseDefaultSize} className="http-workbench-section relative">
            {/* Loading Overlay */}
            {loading && !isSseMode && (
              <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-bg-primary/50 backdrop-blur-[2px] transition-all duration-300">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/20 bg-accent/10 shadow-[0_0_15px_rgba(var(--accent),0.15)] mb-4">
                  <Loader2 className="w-7 h-7 animate-spin text-accent" />
                </div>
                <p className="pf-text-sm font-medium text-text-primary animate-pulse">{t('http.sending', '请求发送中...')}</p>
              </div>
            )}

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
                  <div className="px-3 py-1.5 bg-bg-secondary/60 border-b border-border-default flex items-center gap-3 pf-text-xs flex-wrap shrink-0">
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
                    {(["body", "headers", "cookies", "timing", ...(scriptResults.post?.testResults?.length ? ["tests" as const] : [])] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setResTab(tab)}
                        className={cn(
                          "http-response-tab",
                          resTab === tab && "is-active"
                        )}
                      >
                        {tab === "body" ? t('http.responseBody')
                          : tab === "headers" ? t('http.responseHeaders')
                          : tab === "cookies" ? `Cookies${response.cookies?.length ? ` (${response.cookies.length})` : ""}`
                          : tab === "tests" ? `${t('assertion.testResults')} (${scriptResults.post?.testResults?.filter(tr => tr.passed).length}/${scriptResults.post?.testResults?.length})`
                          : t('http.timing')}
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
                        <div className="flex items-center justify-center h-full text-text-disabled pf-text-base"><Cookie className="w-4 h-4 mr-2 opacity-40" />{t('http.noCookies')}</div>
                      )}
                    </div>
                  ) : resTab === "timing" ? (
                    <div className="selectable p-4 overflow-auto h-full">
                      <div className="flex min-h-full flex-col gap-3">
                        {/* 上方：总耗时 + 请求概要 */}
                        <div className="grid gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
                          <div className="pf-rounded-xl border border-border-default bg-bg-primary/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t('http.totalTime')}</div>
                            <div className="mt-3 pf-text-6xl font-semibold tracking-tight text-text-primary">{Number(response.durationMs).toFixed(2)} ms</div>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <div>
                                <div className="pf-text-xxs text-text-disabled">{t('http.statusCode', { defaultValue: '状态码' })}</div>
                                <div className="mt-0.5 font-mono pf-text-sm font-semibold text-text-primary">{response.status} {response.statusText}</div>
                              </div>
                              <div>
                                <div className="pf-text-xxs text-text-disabled">{t('http.responseSize', { defaultValue: '响应大小' })}</div>
                                <div className="mt-0.5 font-mono pf-text-sm font-semibold text-text-primary">{responseSizeLabel}</div>
                              </div>
                              <div>
                                <div className="pf-text-xxs text-text-disabled">{t('http.method', { defaultValue: '方法' })}</div>
                                <div className="mt-0.5 font-mono pf-text-sm font-semibold text-text-primary">{config.method}</div>
                              </div>
                            </div>
                          </div>

                          {/* 瀑布流时间线 */}
                          <div className="pf-rounded-xl border border-border-default bg-bg-primary/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div className="pf-text-xxs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{t('http.waterfall', { defaultValue: '请求瀑布流' })}</div>
                              <div className="pf-text-xs font-mono text-text-tertiary">{Number(response.durationMs).toFixed(2)} ms</div>
                            </div>
                            <div className="space-y-3">
                              {timingCards.slice(0, 3).map(({ label, value, color }) => {
                                const total = response.timing.totalMs || 1;
                                const widthPct = value ? Math.max(4, (value / total) * 100) : 0;
                                const offsetPct = label === t('http.connectTime')
                                  ? 0
                                  : label === t('http.ttfb')
                                    ? ((response.timing.connectMs || 0) / total) * 100
                                    : ((response.timing.connectMs || 0) + (response.timing.ttfbMs || 0)) / total * 100;
                                return (
                                  <div key={label} className="flex items-center gap-3">
                                    <div className="w-[100px] shrink-0 text-right">
                                      <span className="pf-text-xs font-medium text-text-secondary">{label}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="h-6 rounded-lg bg-bg-secondary/60 relative overflow-hidden">
                                        <div
                                          className={cn("h-full rounded-lg transition-all flex items-center justify-end px-2", color)}
                                          style={{ width: `${widthPct}%`, marginLeft: `${offsetPct}%` }}
                                        >
                                          {widthPct > 15 && (
                                            <span className="text-[10px] font-mono text-white font-semibold whitespace-nowrap">
                                              {value != null ? `${Number(value).toFixed(2)} ms` : '—'}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="w-[72px] shrink-0 text-right">
                                      <span className="font-mono pf-text-xs font-semibold text-text-primary">
                                        {value != null ? `${Number(value).toFixed(2)}` : '—'} ms
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                              {/* 总耗时行 */}
                              <div className="flex items-center gap-3 border-t border-border-default/50 pt-3">
                                <div className="w-[100px] shrink-0 text-right">
                                  <span className="pf-text-xs font-semibold text-text-primary">{t('http.totalTime')}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="h-6 rounded-lg bg-bg-secondary/60 relative overflow-hidden">
                                    <div className="h-full rounded-lg bg-violet-500 w-full flex items-center justify-end px-2">
                                      <span className="text-[10px] font-mono text-white font-semibold whitespace-nowrap">
                                        {Number(response.durationMs).toFixed(2)} ms
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="w-[72px] shrink-0 text-right">
                                  <span className="font-mono pf-text-xs font-bold text-text-primary">
                                    {Number(response.durationMs).toFixed(2)} ms
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 各阶段说明卡片 */}
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="pf-rounded-lg border border-border-default/80 bg-bg-secondary/20 px-4 py-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                              <span className="pf-text-sm font-semibold text-text-primary">{t('http.connectTime')}</span>
                            </div>
                            <p className="pf-text-xs text-text-tertiary leading-relaxed">
                              {t('http.connectTimeDesc', { defaultValue: 'TCP 连接建立耗时，包括 DNS 解析和 TLS 握手。' })}
                            </p>
                          </div>
                          <div className="pf-rounded-lg border border-border-default/80 bg-bg-secondary/20 px-4 py-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                              <span className="pf-text-sm font-semibold text-text-primary">{t('http.ttfb')}</span>
                            </div>
                            <p className="pf-text-xs text-text-tertiary leading-relaxed">
                              {t('http.ttfbDesc', { defaultValue: '从请求发出到接收到第一个字节的等待时间，反映服务器处理速度。' })}
                            </p>
                          </div>
                          <div className="pf-rounded-lg border border-border-default/80 bg-bg-secondary/20 px-4 py-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                              <span className="pf-text-sm font-semibold text-text-primary">{t('http.download')}</span>
                            </div>
                            <p className="pf-text-xs text-text-tertiary leading-relaxed">
                              {t('http.downloadDesc', { defaultValue: '响应体下载耗时，受带宽和响应体大小影响。' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : resTab === "tests" ? (
                    <TestResultsPanel testResults={scriptResults.post?.testResults} />
                  ) : (
                    <ResponseViewer body={response.body} contentType={response.contentType} responseHeaders={response.headers} isBinary={response.isBinary} />
                  )}
                </div>
              </>
            ) : (() => {
              const linkedItem = (activeTab.linkedCollectionItemId && activeTab.linkedCollectionId)
                ? (useCollectionStore.getState().items[activeTab.linkedCollectionId] || [])
                    .find(i => i.id === activeTab.linkedCollectionItemId)
                : null;
              const respExample = linkedItem?.responseExample || '';

              return respExample ? (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default/50 shrink-0">
                    <Braces className="h-4 w-4 text-accent opacity-70" />
                    <span className="pf-text-sm font-medium text-text-secondary">{t('http.responseExample', { defaultValue: '响应示例' })}</span>
                    <span className="pf-text-xs text-text-tertiary ml-auto">{t('http.fromSwagger', { defaultValue: '来自 Swagger 文档' })}</span>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="pf-text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-bg-secondary/40 rounded-lg p-4 border border-border-default/30">{respExample}</pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary shadow-sm">
                    <Braces className="h-7 w-7 opacity-20" />
                  </div>
                  <p className="pf-text-base font-medium text-text-secondary">{t('http.ready')}</p>
                  <p className="mt-1 pf-text-xs">{t('http.readyDesc')}</p>
                </div>
              );
            })()}
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
});

HttpWorkspace.displayName = "HttpWorkspace";
