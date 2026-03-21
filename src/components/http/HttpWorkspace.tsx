import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Play, Loader2, Copy, Check, ChevronDown, Braces, Upload, FileIcon, X, Save, Flame, Cookie, CheckCircle2, XCircle, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore, type RequestProtocol } from "@/stores/appStore";
import { useHistoryStore } from "@/stores/historyStore";
import type { HttpMethod, KeyValue, FormDataField, ScriptResult } from "@/types/http";
import type { OAuth2Config } from "@/types/http";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SaveRequestDialog } from "./SaveRequestDialog";
import { ScriptEditor } from "./ScriptEditor";
import { CodeEditor } from "@/components/common/CodeEditor";
import { ResponseViewer } from "@/components/ui/ResponseViewer";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher } from "@/components/request/RequestProtocolSwitcher";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

const methodTextColor: Record<string, string> = {
  GET: "text-emerald-600", POST: "text-amber-600", PUT: "text-blue-600",
  DELETE: "text-red-500", PATCH: "text-violet-600", HEAD: "text-cyan-600", OPTIONS: "text-gray-500",
};

const methodDotColor: Record<string, string> = {
  GET: "bg-emerald-500", POST: "bg-amber-500", PUT: "bg-blue-500",
  DELETE: "bg-red-500", PATCH: "bg-violet-500", HEAD: "bg-cyan-500", OPTIONS: "bg-gray-400",
};

export function HttpWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const setHttpResponse = useAppStore((s) => s.setHttpResponse);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth" | "pre-script" | "post-script">("params");
  const [resTab, setResTab] = useState<"pretty" | "raw" | "headers" | "cookies" | "timing">("pretty");
  const [copied, setCopied] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scriptResults, setScriptResults] = useState<{ pre: ScriptResult | null; post: ScriptResult | null }>({ pre: null, post: null });
  const [urlFocused, setUrlFocused] = useState(false);
  const [urlHighlight, setUrlHighlight] = useState(-1);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlRectRef = useRef<DOMRect | null>(null);

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
  const tabId = activeTab.id;

  const handleSend = useCallback(async () => {
    if (!config.url.trim()) return;
    setLoading(tabId, true);
    setError(tabId, null);
    setScriptResults({ pre: null, post: null });
    try {
      const hasScripts = (config.preScript?.trim() || config.postScript?.trim());
      if (hasScripts) {
        const { sendRequestWithScripts } = await import("@/services/httpService");
        const result = await sendRequestWithScripts(config);
        setHttpResponse(tabId, result.response);
        setScriptResults({ pre: result.preScriptResult, post: result.postScriptResult });
      } else {
        const { sendHttpRequest } = await import("@/services/httpService");
        const res = await sendHttpRequest(config);
        setHttpResponse(tabId, res);
      }
    } catch (err: any) {
      setError(tabId, err.message || String(err));
    } finally {
      setLoading(tabId, false);
    }
  }, [tabId, config, setLoading, setHttpResponse, setError]);

  const handleCopy = useCallback(() => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [response]);

  const handleProtocolChange = useCallback((protocol: RequestProtocol) => {
    if (protocol === activeTab.protocol) return;
    setShowMethods(false);
    setTabProtocol(tabId, protocol);
  }, [activeTab.protocol, setTabProtocol, tabId]);

  const params = Array.isArray(config.queryParams) ? config.queryParams : [];
  const headers = Array.isArray(config.headers) ? config.headers : [];
  const formFields = Array.isArray(config.formFields) ? config.formFields : [];
  const formDataFields = Array.isArray(config.formDataFields) ? config.formDataFields : [];

  const reqTabs = [
    { key: "params" as const, label: `参数${params.filter(p => p.key).length ? ` (${params.filter(p => p.key).length})` : ""}` },
    { key: "headers" as const, label: `请求头${headers.filter(h => h.key).length ? ` (${headers.filter(h => h.key).length})` : ""}` },
    { key: "body" as const, label: "请求体" },
    { key: "auth" as const, label: "认证" },
    { key: "pre-script" as const, label: "前置脚本" },
    { key: "post-script" as const, label: "后置脚本" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Top Request Bar Area */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab.protocol} onChange={handleProtocolChange} />
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
                          "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-bg-hover",
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
            <input
              ref={urlInputRef}
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
              placeholder="输入请求 URL，如 https://api.example.com/v1/users"
              data-url-input
              className="wb-request-input"
            />
            {urlSuggestions.length > 0 && urlFocused && urlRectRef.current && createPortal(
              <div className="fixed z-[9999] max-h-[220px] overflow-y-auto rounded-[16px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_20px_48px_rgba(15,23,42,0.14)]"
                style={{ top: (urlRectRef.current.bottom + 2), left: urlRectRef.current.left, width: urlRectRef.current.width }}>
                {urlSuggestions.map((u, i) => (
                  <button key={u} onMouseDown={(e) => { e.preventDefault(); updateHttpConfig(tabId, { url: u }); setUrlFocused(false); }}
                    className={cn("w-full rounded-[12px] px-3 py-2 text-left text-[12px] font-mono truncate transition-colors",
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
                onClick={() => setShowSaveDialog(true)}
                data-save-button
                className="wb-icon-btn"
                title="保存请求 (Ctrl+S)"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={async () => {
                  const { pushLoadTestConfig } = await import("@/lib/loadTestBridge");
                  pushLoadTestConfig(config);
                }}
                disabled={!config.url.trim()}
                className="wb-icon-btn hover:text-rose-600"
                title="发送到压测"
              >
                <Flame className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={loading || !config.url.trim()}
              data-send-button
              className={cn(
                "wb-primary-btn min-w-[88px] bg-accent",
                loading ? "animate-pulse opacity-90 shadow-[0_0_12px_rgba(59,130,246,0.45)] cursor-wait" : "hover:bg-accent-hover"
              )}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-white" />}
              {loading ? "发送中" : "发送"}
            </button>
          </>
        )}
      />

      {/* Main Split Area */}
      <div className="flex-1 overflow-hidden px-3 pb-3 pt-1.5">
        <div className="http-workbench-shell">
          <PanelGroup orientation="vertical">
        
          {/* Request Panel */}
          <Panel minSize="15" defaultSize="50" className="http-workbench-section">
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
              {reqTab === "params" && <div className="px-1.5 py-1"><KVEditor items={params} onChange={(v) => updateHttpConfig(tabId, { queryParams: v })} kp="Query Param" vp="Value" /></div>}
              {reqTab === "headers" && <div className="px-1.5 py-1"><KVEditor items={headers} onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" showPresets /></div>}
            
              {reqTab === "body" && (
                <div className="p-4 flex flex-col h-full">
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
                
                  <div className="flex-1 min-h-0 relative">
                    {config.bodyType === "none" && <div className="absolute inset-0 flex items-center justify-center text-text-disabled text-[13px]">无需请求体</div>}
                    {config.bodyType === "json" && (
                      <div className="w-full h-full border border-border-default/75 rounded-[14px] overflow-hidden bg-bg-input/88 focus-within:border-accent transition-colors">
                        <CodeEditor
                          value={config.jsonBody || ''}
                          onChange={(v) => updateHttpConfig(tabId, { jsonBody: v })}
                          language="json"
                        />
                      </div>
                    )}
                    {config.bodyType === "graphql" && (
                      <GraphQLBodyEditor
                        query={config.graphqlQuery || ""}
                        variables={config.graphqlVariables || ""}
                        onQueryChange={(v) => updateHttpConfig(tabId, { graphqlQuery: v })}
                        onVariablesChange={(v) => updateHttpConfig(tabId, { graphqlVariables: v })}
                      />
                    )}
                    {config.bodyType === "raw" && (
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
                    {config.bodyType === "formUrlencoded" && <div className="overflow-auto h-full -mx-1 px-1"><KVEditor items={formFields} onChange={(v) => updateHttpConfig(tabId, { formFields: v })} kp="Field Name" vp="Value" /></div>}
                    {config.bodyType === "formData" && <div className="overflow-auto h-full -mx-2 px-2"><FormDataEditor fields={formDataFields} onChange={(v) => updateHttpConfig(tabId, { formDataFields: v })} /></div>}
                    {config.bodyType === "binary" && <BinaryPicker filePath={config.binaryFilePath} fileName={config.binaryFileName} onChange={(path, name) => updateHttpConfig(tabId, { binaryFilePath: path, binaryFileName: name })} />}
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
                    {config.authType === "none" && <p className="text-[13px] text-text-disabled mt-6">该请求不携带任何认证信息。</p>}
                    {config.authType === "bearer" && (
                      <div className="space-y-2">
                        <label className="text-[12px] font-medium text-text-secondary">Token (无需携带 &apos;Bearer &apos; 前缀)</label>
                        <input
                          value={config.bearerToken}
                          onChange={(e) => updateHttpConfig(tabId, { bearerToken: e.target.value })}
                          placeholder="ey..."
                          className="wb-field w-full font-mono text-[13px]"
                        />
                      </div>
                    )}
                    {config.authType === "basic" && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-text-secondary">Username</label>
                          <input value={config.basicUsername} onChange={(e) => updateHttpConfig(tabId, { basicUsername: e.target.value })} className="wb-field w-full text-[13px]" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-text-secondary">Password</label>
                          <input value={config.basicPassword} onChange={(e) => updateHttpConfig(tabId, { basicPassword: e.target.value })} type="password" className="wb-field w-full text-[13px]" />
                        </div>
                      </div>
                    )}
                    {config.authType === "apiKey" && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-text-secondary">添加到</label>
                          <div className="wb-segmented w-fit">
                            {(["header", "query"] as const).map((a) => (
                              <button key={a} onClick={() => updateHttpConfig(tabId, { apiKeyAddTo: a })} className={cn("wb-segment", config.apiKeyAddTo === a && "wb-segment-active")}>
                                {a === "header" ? "Header" : "Query Param"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-text-secondary">Key</label>
                          <input value={config.apiKeyName} onChange={(e) => updateHttpConfig(tabId, { apiKeyName: e.target.value })} placeholder="X-API-Key" className="wb-field w-full font-mono text-[13px]" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-medium text-text-secondary">Value</label>
                          <input value={config.apiKeyValue} onChange={(e) => updateHttpConfig(tabId, { apiKeyValue: e.target.value })} className="wb-field w-full font-mono text-[13px]" />
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
          <Panel minSize="15" defaultSize="50" className="http-workbench-section">
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px] shrink-0 font-medium">
                请求失败: {error}
              </div>
            )}
          
            {response ? (
              <>
                {/* Script results notification */}
                {(scriptResults.pre || scriptResults.post) && (
                  <div className="px-3 py-1.5 bg-bg-secondary/60 border-b border-border-default flex items-center gap-3 text-[11px] flex-wrap shrink-0">
                    {scriptResults.pre && (
                      <span className={cn("flex items-center gap-1 font-medium", scriptResults.pre.success ? "text-emerald-600" : "text-red-500")}>
                        {scriptResults.pre.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        前置脚本{scriptResults.pre.success ? "通过" : "失败"}
                      </span>
                    )}
                    {scriptResults.post && (
                      <span className={cn("flex items-center gap-1 font-medium", scriptResults.post.success ? "text-emerald-600" : "text-red-500")}>
                        {scriptResults.post.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        后置脚本{scriptResults.post.success ? "通过" : "失败"}
                      </span>
                    )}
                    {scriptResults.post?.testResults && scriptResults.post.testResults.length > 0 && (
                      <span className="text-text-tertiary">
                        测试: {scriptResults.post.testResults.filter(t => t.passed).length}/{scriptResults.post.testResults.length} 通过
                      </span>
                    )}
                    {(scriptResults.pre?.logs?.length || scriptResults.post?.logs?.length) ? (
                      <span className="text-text-disabled flex items-center gap-1"><Terminal className="w-3 h-3" />{(scriptResults.pre?.logs?.length || 0) + (scriptResults.post?.logs?.length || 0)} 条日志</span>
                    ) : null}
                  </div>
                )}
                <div className="http-response-head shrink-0">
                  <div className="http-response-tabs scrollbar-hide">
                    {(["pretty", "raw", "headers", "cookies", "timing"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setResTab(t)}
                        className={cn(
                          "wb-tab",
                          resTab === t && "wb-tab-active text-text-primary"
                        )}
                      >
                        {t === "pretty" ? "JSON Format" : t === "raw" ? "Raw" : t === "headers" ? "响应头" : t === "cookies" ? `Cookies${response.cookies?.length ? ` (${response.cookies.length})` : ""}` : "时序"}
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={cn("wb-status-chip font-semibold", response.status < 400 ? "text-emerald-600" : "text-red-500")}>
                      {response.status} {response.statusText}
                    </span>
                    <span className="text-text-secondary font-mono">{response.durationMs}ms</span>
                    <span className="text-text-secondary font-mono">{response.bodySize < 1024 ? `${response.bodySize} B` : `${(response.bodySize / 1024).toFixed(1)} KB`}</span>
                    
                    <div className="w-[1px] h-4 bg-border-strong mx-1" />
                    
                    <button
                      onClick={handleCopy}
                      className="wb-icon-btn"
                      title="复制响应内容"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-hidden">
                  {resTab === "headers" ? (
                    <div className="p-4 overflow-auto h-full">
                      <div className="max-w-3xl border border-border-default rounded-lg overflow-hidden bg-bg-primary">
                        {(Array.isArray(response.headers) ? response.headers : Object.entries(response.headers)).map(([k, v]: [string, string], i: number) => (
                          <div key={`${k}-${i}`} className={cn("flex gap-4 p-2 text-[13px] font-mono", i > 0 && "border-t border-border-default")}>
                            <span className="text-text-secondary font-medium w-1/3 break-words">{k}</span>
                            <span className="text-text-primary break-all w-2/3">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : resTab === "cookies" ? (
                    <div className="p-4 overflow-auto h-full">
                      {response.cookies?.length ? (
                        <div className="max-w-4xl border border-border-default rounded-lg overflow-hidden bg-bg-primary">
                          <table className="w-full text-[12px] font-mono">
                            <thead><tr className="bg-bg-secondary text-text-disabled text-[10px] font-semibold uppercase">
                              <th className="text-left px-3 py-2">Name</th>
                              <th className="text-left px-3 py-2">Value</th>
                              <th className="text-left px-3 py-2">Domain</th>
                              <th className="text-left px-3 py-2">Path</th>
                              <th className="text-left px-3 py-2">Flags</th>
                            </tr></thead>
                            <tbody>
                              {response.cookies.map((c, i) => (
                                <tr key={i} className={cn(i > 0 && "border-t border-border-default")}>
                                  <td className="px-3 py-2 text-text-primary font-semibold">{c.name}</td>
                                  <td className="px-3 py-2 text-text-secondary break-all max-w-[200px] truncate">{c.value}</td>
                                  <td className="px-3 py-2 text-text-tertiary">{c.domain || "-"}</td>
                                  <td className="px-3 py-2 text-text-tertiary">{c.path || "-"}</td>
                                  <td className="px-3 py-2 text-text-tertiary">
                                    {[c.httpOnly && "HttpOnly", c.secure && "Secure", c.sameSite].filter(Boolean).join(", ") || "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-text-disabled text-[13px]"><Cookie className="w-4 h-4 mr-2 opacity-40" />无 Cookie 数据</div>
                      )}
                    </div>
                  ) : resTab === "timing" ? (
                    <div className="p-6 overflow-auto h-full">
                      <div className="max-w-lg space-y-4">
                        {[
                          { label: "连接建立", value: response.timing.connectMs, color: "bg-blue-500" },
                          { label: "首字节到达 (TTFB)", value: response.timing.ttfbMs, color: "bg-emerald-500" },
                          { label: "内容下载", value: response.timing.downloadMs, color: "bg-amber-500" },
                          { label: "总耗时", value: response.timing.totalMs, color: "bg-violet-500" },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[12px] text-text-secondary">{label}</span>
                              <span className="text-[12px] font-mono font-bold text-text-primary">{value ?? "—"} ms</span>
                            </div>
                            <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value && response.timing.totalMs ? Math.max(5, (value / response.timing.totalMs) * 100) : 0}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : resTab === "pretty" ? (
                    <ResponseViewer body={response.body} contentType={response.contentType} />
                  ) : (
                    <ResponseViewer body={response.body} contentType={response.contentType} modes={['raw']} compact />
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary shadow-sm">
                  <Braces className="h-7 w-7 opacity-20" />
                </div>
                <p className="text-[13px] font-medium text-text-secondary">准备就绪</p>
                <p className="mt-1 text-[11px]">输入 URL 并点击发送以调试 API</p>
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
      />
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
  const trimmedVariables = variables.trim();
  const hasVariables = trimmedVariables.length > 0 && trimmedVariables !== "{}";
  const variableState = useMemo(() => {
    if (!trimmedVariables) {
      return { valid: true, label: "变量可选", detail: "不传变量时会自动只发送 query。" };
    }

    try {
      const parsed = JSON.parse(variables);
      const count = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).length
        : 0;
      return {
        valid: true,
        label: count > 0 ? `${count} 个变量` : "JSON 有效",
        detail: count > 0 ? "这些字段会与 query 一起封装为 GraphQL 负载。" : "当前变量对象为空。",
      };
    } catch {
      return {
        valid: false,
        label: "JSON 无效",
        detail: "变量区域需要是合法的 JSON 对象，发送时才会被正确解析。",
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
      <div className="wb-subpanel flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-text-primary">
            <div className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-violet-500/10 text-violet-600">
              <Braces className="h-4 w-4" />
            </div>
            GraphQL 请求体
          </div>
          <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
            Query 会作为主体发送，Variables 会自动与 Query 组合成标准 GraphQL JSON 负载。
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="wb-tool-chip">POST JSON Payload</span>
          <button onClick={handleInsertTemplate} className="wb-ghost-btn">
            示例模板
          </button>
          <button onClick={handleFormatVariables} className="wb-ghost-btn">
            格式化变量
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div>
              <div className="text-[12px] font-semibold text-text-primary">Query</div>
              <div className="mt-1 text-[11px] text-text-tertiary">填写查询或 mutation 主体，建议在这里组织字段结构。</div>
            </div>
            <span className="wb-tool-chip">GraphQL</span>
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
                <span className="text-[12px] font-semibold text-text-primary">Variables</span>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  variableState.valid
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-red-500/10 text-red-500"
                )}>
                  {variableState.valid ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {variableState.label}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-text-tertiary">{variableState.detail}</div>
            </div>
            {hasVariables ? <span className="wb-tool-chip">JSON</span> : null}
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

/* ── Header Presets (quick-add) ── */
const HEADER_PRESETS: { key: string; value: string; desc: string }[] = [
  { key: "Content-Type", value: "application/json", desc: "JSON" },
  { key: "Content-Type", value: "application/x-www-form-urlencoded", desc: "表单" },
  { key: "Accept", value: "application/json", desc: "JSON 响应" },
  { key: "Authorization", value: "Bearer ", desc: "Token" },
  { key: "Cache-Control", value: "no-cache", desc: "禁缓存" },
  { key: "User-Agent", value: "ProtoForge/1.0", desc: "UA" },
  { key: "Accept-Language", value: "zh-CN,zh;q=0.9,en;q=0.8", desc: "中文" },
  { key: "Accept-Encoding", value: "gzip, deflate, br", desc: "压缩" },
  { key: "Connection", value: "keep-alive", desc: "长连接" },
  { key: "X-Requested-With", value: "XMLHttpRequest", desc: "AJAX" },
];

/* ── KV Editor (table-based, for params, headers, form-urlencoded) ── */
function KVEditor({ items, onChange, kp, vp, showPresets }: {
  items: KeyValue[];
  onChange: (v: KeyValue[]) => void;
  kp: string;
  vp: string;
  showPresets?: boolean;
}) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [activeKeySuggest, setActiveKeySuggest] = useState<number | null>(null);
  const [activeValueSuggest, setActiveValueSuggest] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const safe = items || [];

  const update = (i: number, f: "key" | "value" | "description", v: string) => {
    const n = [...safe]; n[i] = { ...n[i], [f]: v }; onChange(n);
  };
  const toggle = (i: number) => {
    const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(n);
  };
  const remove = (i: number) => onChange(safe.filter((_, j) => j !== i));
  const add = () => onChange([...safe, { key: "", value: "", description: "", enabled: true }]);
  const addPreset = (preset: typeof HEADER_PRESETS[0]) => {
    onChange([...safe, { key: preset.key, value: preset.value, description: preset.desc, enabled: true }]);
    setPresetOpen(false);
  };

  const selectKeySuggestion = (i: number, key: string) => {
    const n = [...safe]; n[i] = { ...n[i], key };
    const vals = HEADER_DICT[key];
    if (vals && vals.length > 0 && !n[i].value) n[i].value = vals[0];
    onChange(n); setActiveKeySuggest(null); setHighlightIdx(-1);
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

  const cellInput = "h-7 w-full bg-transparent px-2 text-[12px] font-mono text-text-primary outline-none placeholder:text-text-disabled";

  return (
    <div className="w-full">
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-7 border border-border-default bg-bg-tertiary text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            <th className="w-7 border-r border-border-default">
              <input
                type="checkbox"
                checked={safe.length > 0 && safe.every(item => item.enabled)}
                onChange={() => {
                  const allEnabled = safe.every(item => item.enabled);
                  onChange(safe.map(item => ({ ...item, enabled: !allEnabled })));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer"
                title={safe.every(item => item.enabled) ? "取消全选" : "全选"}
              />
            </th>
            <th className="text-left font-semibold px-2">{kp}</th>
            <th className="text-left font-semibold px-2 border-l border-border-default">{vp}</th>
            <th className="text-left font-semibold px-2 border-l border-border-default">Description</th>
            <th className="w-6 border-l border-border-default" />
          </tr>
        </thead>
        <tbody>
          {safe.map((item, i) => {
            const keySugs = activeKeySuggest === i ? getKeySuggestions(item.key) : [];
            const valSugs = activeValueSuggest === i ? getValueSuggestions(item.key) : [];
            return (
              <tr key={i} className={cn("group border border-border-default", i > 0 && "border-t-0")}>
                <td className="w-7 text-center border-r border-border-default align-middle">
                  <input type="checkbox" checked={item.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer" />
                </td>
                <td className="border-r border-border-default p-0">
                  <TableCellInput value={item.key} onChange={v => update(i, "key", v)}
                    onFocus={() => { if (showPresets) { setActiveKeySuggest(i); setActiveValueSuggest(null); setHighlightIdx(-1); } }}
                    onBlur={() => setTimeout(() => { setActiveKeySuggest(null); setHighlightIdx(-1); }, 150)}
                    onKeyDown={e => handleKeyDown(e, keySugs, k => selectKeySuggestion(i, k), () => setActiveKeySuggest(null))}
                    placeholder={kp} disabled={!item.enabled} suggestions={keySugs} highlightIdx={highlightIdx}
                    onSelectSuggestion={k => selectKeySuggestion(i, k)} className={cellInput} />
                </td>
                <td className="border-r border-border-default p-0">
                  <TableCellInput value={item.value} onChange={v => update(i, "value", v)}
                    onFocus={() => { if (showPresets && HEADER_DICT[item.key]) { setActiveValueSuggest(i); setActiveKeySuggest(null); setHighlightIdx(-1); } }}
                    onBlur={() => setTimeout(() => { setActiveValueSuggest(null); setHighlightIdx(-1); }, 150)}
                    onKeyDown={e => handleKeyDown(e, valSugs, v => selectValueSuggestion(i, v), () => setActiveValueSuggest(null))}
                    placeholder={vp} disabled={!item.enabled} suggestions={valSugs} highlightIdx={highlightIdx}
                    onSelectSuggestion={v => selectValueSuggestion(i, v)} className={cellInput} />
                </td>
                <td className="border-r border-border-default p-0">
                  <input value={item.description || ""} onChange={e => update(i, "description", e.target.value)} placeholder="Description"
                    className={cn("h-7 w-full bg-transparent px-2 text-[11px] text-text-tertiary outline-none placeholder:text-text-disabled", !item.enabled && "opacity-40")} />
                </td>
                <td className="w-6 text-center p-0 align-middle">
                  <button onClick={() => remove(i)} className="inline-flex h-7 w-6 items-center justify-center text-sm text-text-disabled opacity-0 transition-all hover:text-red-500 group-hover:opacity-100">×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-1.5">
        <button onClick={add} className="flex items-center gap-1 rounded-[10px] border border-dashed border-border-default px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-accent hover:text-accent">
          <span>+</span> 添加
        </button>
        {showPresets && <PresetDropdown presets={HEADER_PRESETS} isOpen={presetOpen} onToggle={() => setPresetOpen(!presetOpen)} onClose={() => setPresetOpen(false)} onSelect={addPreset} />}
      </div>
    </div>
  );
}

/* ── TableCellInput: borderless input with portal suggestion dropdown ── */
function TableCellInput({ value, onChange, onFocus, onBlur, onKeyDown, placeholder, disabled, suggestions, highlightIdx, onSelectSuggestion, className: cls }: {
  value: string; onChange: (v: string) => void; onFocus: () => void; onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void; placeholder: string; disabled: boolean;
  suggestions?: string[]; highlightIdx?: number; onSelectSuggestion?: (v: string) => void; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hasSugs = suggestions && suggestions.length > 0;
  useEffect(() => { if (hasSugs && ref.current) setRect(ref.current.getBoundingClientRect()); }, [hasSugs, value]);

  return (
    <>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}
        placeholder={placeholder} className={cn(cls, disabled && "opacity-40")} />
      {hasSugs && rect && onSelectSuggestion && createPortal(
        <div className="fixed bg-bg-elevated border border-border-default rounded-lg shadow-xl max-h-[220px] overflow-y-auto py-0.5"
          style={{ top: rect.bottom + 2, left: rect.left, width: rect.width, zIndex: 9999 }}>
          {suggestions!.map((s, si) => (
            <button key={si} onMouseDown={e => { e.preventDefault(); onSelectSuggestion!(s); }}
              className={cn("w-full px-3 py-1.5 text-left text-[12px] font-mono transition-colors",
                si === (highlightIdx ?? -1) ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-bg-hover",
                value === s && si !== (highlightIdx ?? -1) && "text-accent font-semibold")}>
              {s || <span className="text-text-disabled italic">(空值)</span>}
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

/* ── PresetDropdown: portal-based preset menu ── */
function PresetDropdown({ presets, isOpen, onToggle, onClose, onSelect }: {
  presets: typeof HEADER_PRESETS; isOpen: boolean; onToggle: () => void; onClose: () => void;
  onSelect: (p: typeof HEADER_PRESETS[0]) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => { if (isOpen && btnRef.current) setRect(btnRef.current.getBoundingClientRect()); }, [isOpen]);

  return (
    <div className="relative">
      <button ref={btnRef} onClick={onToggle}
        className="flex items-center gap-1 rounded-[10px] border border-dashed border-border-default px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:border-accent hover:text-accent">
        <ChevronDown className="w-3 h-3" /> 预设
      </button>
      {isOpen && rect && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
          <div className="fixed bg-bg-elevated border border-border-default rounded-lg shadow-xl overflow-hidden min-w-[340px] max-h-[300px] overflow-y-auto py-1"
            style={{ top: rect.bottom + 4, left: rect.left, zIndex: 9999 }}>
            {presets.map((p, i) => (
              <button key={i} onClick={() => onSelect(p)}
                className="w-full px-3 py-1.5 flex items-center gap-3 text-left hover:bg-bg-hover transition-colors">
                <span className="text-[11px] font-mono font-semibold text-accent w-28 shrink-0 truncate">{p.key}</span>
                <span className="text-[11px] font-mono text-text-secondary flex-1 truncate">{p.value || "(空)"}</span>
                <span className="text-[10px] text-text-disabled shrink-0">{p.desc}</span>
              </button>
            ))}
          </div>
        </>, document.body
      )}
    </div>
  );
}

/* ── FormData Editor (table-based, text + file fields) ── */
function FormDataEditor({ fields, onChange }: { fields: FormDataField[]; onChange: (v: FormDataField[]) => void }) {
  const safe = fields || [];
  const update = (i: number, u: Partial<FormDataField>) => { const n = [...safe]; n[i] = { ...n[i], ...u }; onChange(n); };
  const toggle = (i: number) => { const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(n); };
  const remove = (i: number) => onChange(safe.filter((_, j) => j !== i));
  const add = () => onChange([...safe, { key: "", value: "", fieldType: "text", enabled: true }]);
  const handleFilePick = async (i: number) => {
    const { pickFile } = await import("@/services/httpService");
    const r = await pickFile();
    if (r) update(i, { value: r.path, fileName: r.name });
  };

  return (
    <div className="w-full">
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-[28px] bg-bg-tertiary text-[10px] font-semibold text-text-tertiary uppercase tracking-wider border border-border-default">
            <th className="w-7 border-r border-border-default">
              <input
                type="checkbox"
                checked={safe.length > 0 && safe.every(f => f.enabled)}
                onChange={() => {
                  const allEnabled = safe.every(f => f.enabled);
                  onChange(safe.map(f => ({ ...f, enabled: !allEnabled })));
                }}
                className="w-3 h-3 rounded accent-accent cursor-pointer"
                title={safe.every(f => f.enabled) ? "取消全选" : "全选"}
              />
            </th>
            <th className="w-16 text-left font-semibold px-2">类型</th>
            <th className="text-left font-semibold px-2 border-l border-border-default">Key</th>
            <th className="text-left font-semibold px-2 border-l border-border-default">Value</th>
            <th className="w-6 border-l border-border-default" />
          </tr>
        </thead>
        <tbody>
          {safe.map((field, i) => (
            <tr key={i} className={cn("group border border-border-default", i > 0 && "border-t-0")}>
              <td className="w-7 text-center border-r border-border-default align-middle">
                <input type="checkbox" checked={field.enabled} onChange={() => toggle(i)} className="w-3 h-3 rounded accent-accent cursor-pointer" />
              </td>
              <td className="w-16 border-r border-border-default p-0 align-middle">
                <select value={field.fieldType}
                  onChange={e => update(i, { fieldType: e.target.value as 'text' | 'file', value: '', fileName: undefined })}
                  className={cn("w-full h-[30px] px-1.5 bg-transparent text-[11px] text-text-secondary outline-none cursor-pointer", !field.enabled && "opacity-40")}>
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td className="border-r border-border-default p-0">
                <input value={field.key} onChange={e => update(i, { key: e.target.value })} placeholder="Key"
                  className={cn("w-full h-[30px] px-2 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-disabled", !field.enabled && "opacity-40")} />
              </td>
              <td className="border-r border-border-default p-0">
                {field.fieldType === "text" ? (
                  <input value={field.value} onChange={e => update(i, { value: e.target.value })} placeholder="Value"
                    className={cn("w-full h-[30px] px-2 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-disabled", !field.enabled && "opacity-40")} />
                ) : (
                  <button onClick={() => handleFilePick(i)}
                    className={cn("w-full h-[30px] px-2 flex items-center gap-1.5 bg-transparent text-[11px] text-left cursor-pointer hover:bg-bg-hover transition-colors", !field.enabled && "opacity-40")}>
                    <Upload className="w-3 h-3 text-text-disabled shrink-0" />
                    <span className="truncate text-text-secondary">{field.fileName || field.value || "选择文件..."}</span>
                  </button>
                )}
              </td>
              <td className="w-6 text-center p-0 align-middle">
                <button onClick={() => remove(i)} className="w-6 h-[30px] inline-flex items-center justify-center text-text-disabled hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-sm">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add} className="mt-1.5 text-[11px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors border border-dashed border-border-default hover:border-accent rounded px-2.5 py-1">
        <span>+</span> 添加字段
      </button>
    </div>
  );
}



/* ── OAuth 2.0 Panel ── */
function OAuth2Panel({ config, onChange }: { config: OAuth2Config; onChange: (updates: Partial<OAuth2Config>) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ tokenType?: string; expiresIn?: number; scope?: string } | null>(null);

  const canFetchToken = config.accessTokenUrl && config.clientId && (
    config.grantType === "client_credentials" ||
    (config.grantType === "password" && config.username) ||
    config.grantType === "authorization_code"
  );

  const handleFetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
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
          redirectUri: config.redirectUri || null,
        },
      });
      onChange({ accessToken: result.accessToken });
      setTokenMeta({
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        scope: result.scope,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-text-secondary">授权类型</label>
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
        <label className="text-[12px] font-medium text-text-secondary">Access Token URL</label>
        <input value={config.accessTokenUrl} onChange={(e) => onChange({ accessTokenUrl: e.target.value })} placeholder="https://auth.example.com/oauth/token" className="wb-field w-full font-mono text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Client ID</label>
          <input value={config.clientId} onChange={(e) => onChange({ clientId: e.target.value })} className="wb-field w-full font-mono text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Client Secret</label>
          <input value={config.clientSecret} onChange={(e) => onChange({ clientSecret: e.target.value })} type="password" className="wb-field w-full font-mono text-[13px]" />
        </div>
      </div>
      {config.grantType === "authorization_code" && (
        <>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Auth URL</label>
            <input value={config.authUrl} onChange={(e) => onChange({ authUrl: e.target.value })} placeholder="https://auth.example.com/authorize" className="wb-field w-full font-mono text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Redirect URI</label>
            <input value={config.redirectUri} onChange={(e) => onChange({ redirectUri: e.target.value })} className="wb-field w-full font-mono text-[13px]" />
          </div>
        </>
      )}
      {config.grantType === "password" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Username</label>
            <input value={config.username} onChange={(e) => onChange({ username: e.target.value })} className="wb-field w-full text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Password</label>
            <input value={config.password} onChange={(e) => onChange({ password: e.target.value })} type="password" className="wb-field w-full text-[13px]" />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-text-secondary">Scope</label>
        <input value={config.scope} onChange={(e) => onChange({ scope: e.target.value })} placeholder="read write" className="wb-field w-full font-mono text-[13px]" />
      </div>

      {/* Get Token + Access Token */}
      <div className="pt-2 border-t border-border-default">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleFetchToken}
            disabled={loading || !canFetchToken}
            className={cn(
              "px-4 py-2 text-[12px] font-semibold rounded-lg transition-all",
              loading
                ? "bg-amber-400 text-white cursor-wait"
                : canFetchToken
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm"
                  : "bg-bg-tertiary text-text-disabled cursor-not-allowed"
            )}
          >
            {loading ? "获取中..." : "获取 Token"}
          </button>
          {tokenMeta && (
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              {tokenMeta.tokenType && <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded text-[10px] font-medium">{tokenMeta.tokenType}</span>}
              {tokenMeta.expiresIn && <span>有效期 {tokenMeta.expiresIn}s</span>}
              {tokenMeta.scope && <span>scope: {tokenMeta.scope}</span>}
            </div>
          )}
        </div>
        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[12px] text-red-600 dark:text-red-400 break-all">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-secondary">Access Token</label>
          <input value={config.accessToken} onChange={(e) => onChange({ accessToken: e.target.value })} placeholder="点击「获取 Token」自动填入，或手动粘贴" className="wb-field w-full font-mono text-[12px]" />
        </div>
      </div>
    </div>
  );
}

/* ── Binary File Picker ── */
function BinaryPicker({ filePath, fileName, onChange }: { filePath: string; fileName: string; onChange: (path: string, name: string) => void }) {
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
            <p className="text-[13px] font-medium text-text-primary truncate max-w-xs">{fileName}</p>
            <p className="text-[11px] text-text-disabled font-mono truncate max-w-xs">{filePath}</p>
          </div>
          <button onClick={() => onChange('', '')} className="p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-red-500 transition-colors" title="移除文件">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={handlePick}
          className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-border-default hover:border-accent text-text-disabled hover:text-accent transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8" />
          <span className="text-[13px] font-medium">选择文件</span>
          <span className="text-[11px]">文件将以 binary 形式发送</span>
        </button>
      )}
    </div>
  );
}
