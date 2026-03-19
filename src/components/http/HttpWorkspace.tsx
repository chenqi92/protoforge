import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Play, Loader2, Copy, Check, ChevronDown, Braces, Upload, FileIcon, X, Save, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { HttpMethod, KeyValue, FormDataField } from "@/types/http";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SaveRequestDialog } from "./SaveRequestDialog";
import { ScriptEditor } from "./ScriptEditor";
import { ResponseViewer } from "@/components/ui/ResponseViewer";

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

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth" | "pre-script" | "post-script">("params");
  const [resTab, setResTab] = useState<"pretty" | "raw" | "headers">("pretty");
  const [copied, setCopied] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  if (!activeTab?.httpConfig) return null;
  const config = activeTab.httpConfig;
  const response = activeTab.httpResponse;
  const { loading, error } = activeTab;
  const tabId = activeTab.id;

  const handleSend = useCallback(async () => {
    if (!config.url.trim()) return;
    setLoading(tabId, true);
    setError(tabId, null);
    try {
      const { sendHttpRequest } = await import("@/services/httpService");
      const res = await sendHttpRequest(config);
      setHttpResponse(tabId, res);
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

  const params = config.queryParams || [];
  const headers = config.headers || [];
  const formFields = config.formFields || [];
  const formDataFields = config.formDataFields || [];

  const reqTabs = [
    { key: "params" as const, label: `参数${params.filter(p => p.key).length ? ` (${params.filter(p => p.key).length})` : ""}` },
    { key: "headers" as const, label: `请求头${headers.filter(h => h.key).length ? ` (${headers.filter(h => h.key).length})` : ""}` },
    { key: "body" as const, label: "请求体" },
    { key: "auth" as const, label: "认证" },
    { key: "pre-script" as const, label: "前置脚本" },
    { key: "post-script" as const, label: "后置脚本" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Top Request Bar Area */}
      <div className="shrink-0 flex items-center h-10 px-3 border-b border-border-default bg-bg-primary gap-2">
        {/* Method Selector */}
        <div className="relative h-full shrink-0 flex items-center">
          <button
            onClick={() => setShowMethods(!showMethods)}
            className={cn(
              "flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-bold transition-colors hover:bg-bg-hover",
              methodTextColor[config.method] || "text-text-primary"
            )}
          >
            {config.method}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>
          {showMethods && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMethods(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-bg-elevated border border-border-default rounded-lg shadow-lg overflow-hidden min-w-[130px] py-1">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { updateHttpConfig(tabId, { method: m }); setShowMethods(false); }}
                    className={cn(
                      "w-full px-3 py-1.5 flex items-center gap-2.5 text-[12px] font-bold hover:bg-bg-hover transition-colors",
                      config.method === m ? "bg-bg-hover" : ""
                    )}
                  >
                    <span className={cn("w-[6px] h-[6px] rounded-full shrink-0", methodDotColor[m])} />
                    <span className={methodTextColor[m] || "text-text-primary"}>{m}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="w-[1px] h-4 bg-border-default shrink-0" />
        
        {/* URL Input */}
        <input
          value={config.url}
          onChange={(e) => updateHttpConfig(tabId, { url: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入请求 URL，如 https://api.example.com/v1/users"
          data-url-input
          className="flex-1 h-full px-2 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary"
        />

        {/* Save Button */}
        <button
          onClick={() => setShowSaveDialog(true)}
          data-save-button
          className="h-7 px-2.5 rounded-md flex items-center justify-center gap-1 text-[12px] font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors shrink-0"
          title="保存请求 (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
        </button>
        
        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={loading || !config.url.trim()}
          data-send-button
          className="h-7 px-4 rounded-md flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-white" />}
          {loading ? "发送中" : "发送"}
        </button>

          {/* Load Test Button */}
          <button
            onClick={async () => {
              const { pushLoadTestConfig } = await import("@/lib/loadTestBridge");
              pushLoadTestConfig(config);
            }}
            disabled={!config.url.trim()}
            className="h-7 px-2.5 rounded-md flex items-center justify-center gap-1 text-[12px] font-medium text-text-tertiary hover:bg-rose-500/10 hover:text-rose-600 transition-colors shrink-0 disabled:opacity-40"
            title="发送到压测"
          >
            <Flame className="w-3.5 h-3.5" />
          </button>
        </div>

      {/* Main Split Area */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="vertical">
        
        {/* Request Panel */}
        <Panel minSize="15" defaultSize="50" className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center px-2 bg-bg-secondary/40 border-b border-border-default shrink-0 overflow-x-auto scrollbar-hide">
            {reqTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setReqTab(t.key)}
                className={cn(
                  "px-4 py-3 text-[13px] font-medium border-b-[2px] transition-colors whitespace-nowrap",
                  reqTab === t.key ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          
          <div className="flex-1 overflow-auto bg-transparent">
            {reqTab === "params" && <div className="px-2 py-1"><KVEditor items={params} onChange={(v) => updateHttpConfig(tabId, { queryParams: v })} kp="Query Param" vp="Value" /></div>}
            {reqTab === "headers" && <div className="px-2 py-1"><KVEditor items={headers} onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" showPresets /></div>}
            
            {reqTab === "body" && (
              <div className="p-4 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-4 shrink-0 bg-bg-secondary p-1 rounded-lg w-fit">
                  {(["none", "json", "raw", "formUrlencoded", "formData", "binary"] as const).map((bt) => (
                    <button
                      key={bt}
                      onClick={() => updateHttpConfig(tabId, { bodyType: bt })}
                      className={cn(
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-all",
                        config.bodyType === bt ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {bt === "none" ? "None" : bt === "formUrlencoded" ? "URL-Encoded" : bt === "formData" ? "Form-Data" : bt === "binary" ? "Binary" : bt.toUpperCase()}
                    </button>
                  ))}
                </div>
                
                <div className="flex-1 min-h-0 relative">
                  {config.bodyType === "none" && <div className="absolute inset-0 flex items-center justify-center text-text-disabled text-[13px]">无需请求体</div>}
                  {config.bodyType === "json" && (
                    <textarea
                      value={config.jsonBody}
                      onChange={(e) => updateHttpConfig(tabId, { jsonBody: e.target.value })}
                      placeholder={'{\n  "key": "value"\n}'}
                      className="w-full h-full p-3 font-mono text-[13px] bg-bg-input border border-border-default rounded-lg text-text-secondary resize-none outline-none focus:border-accent transition-colors"
                      style={{ userSelect: "text", tabSize: 2 }}
                      spellCheck={false}
                    />
                  )}
                  {config.bodyType === "raw" && (
                    <div className="flex flex-col h-full gap-2">
                      <select
                        value={config.rawContentType}
                        onChange={(e) => updateHttpConfig(tabId, { rawContentType: e.target.value })}
                        className="h-7 px-2 text-[12px] bg-bg-input border border-border-default rounded-md text-text-secondary outline-none w-fit"
                      >
                        <option value="text/plain">Text</option>
                        <option value="text/html">HTML</option>
                        <option value="application/xml">XML</option>
                        <option value="application/javascript">JavaScript</option>
                        <option value="text/css">CSS</option>
                      </select>
                      <textarea
                        value={config.rawBody}
                        onChange={(e) => updateHttpConfig(tabId, { rawBody: e.target.value })}
                        placeholder="Enter raw request body..."
                        className="w-full flex-1 p-3 font-mono text-[13px] bg-bg-input border border-border-default rounded-lg text-text-secondary resize-none outline-none focus:border-accent transition-colors"
                        style={{ userSelect: "text" }}
                        spellCheck={false}
                      />
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
                <div className="flex items-center gap-2 mb-4 bg-bg-secondary p-1 rounded-lg w-fit">
                  {(["none", "bearer", "basic", "apiKey"] as const).map((at) => (
                    <button
                      key={at}
                      onClick={() => updateHttpConfig(tabId, { authType: at })}
                      className={cn(
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-all",
                        config.authType === at ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {at === "none" ? "No Auth" : at === "bearer" ? "Bearer Token" : at === "basic" ? "Basic Auth" : "API Key"}
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
                        className="input-field w-full font-mono text-[13px]"
                      />
                    </div>
                  )}
                  {config.authType === "basic" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Username</label>
                        <input value={config.basicUsername} onChange={(e) => updateHttpConfig(tabId, { basicUsername: e.target.value })} className="input-field w-full text-[13px]" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Password</label>
                        <input value={config.basicPassword} onChange={(e) => updateHttpConfig(tabId, { basicPassword: e.target.value })} type="password" className="input-field w-full text-[13px]" />
                      </div>
                    </div>
                  )}
                  {config.authType === "apiKey" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">添加到</label>
                        <div className="flex items-center gap-2 bg-bg-secondary p-1 rounded-lg w-fit">
                          {(["header", "query"] as const).map((a) => (
                            <button key={a} onClick={() => updateHttpConfig(tabId, { apiKeyAddTo: a })} className={cn("px-3 py-1 text-[12px] font-medium rounded-md transition-all", config.apiKeyAddTo === a ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary")}>
                              {a === "header" ? "Header" : "Query Param"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Key</label>
                        <input value={config.apiKeyName} onChange={(e) => updateHttpConfig(tabId, { apiKeyName: e.target.value })} placeholder="X-API-Key" className="input-field w-full font-mono text-[13px]" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-text-secondary">Value</label>
                        <input value={config.apiKeyValue} onChange={(e) => updateHttpConfig(tabId, { apiKeyValue: e.target.value })} className="input-field w-full font-mono text-[13px]" />
                      </div>
                    </div>
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

        <PanelResizeHandle className="h-[1px] bg-border-default relative shrink-0 cursor-row-resize hover:bg-accent active:bg-accent transition-colors" />

        {/* Response Panel */}
        <Panel minSize="15" defaultSize="50" className="flex flex-col h-full overflow-hidden">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px] shrink-0 font-medium">
              请求失败: {error}
            </div>
          )}
          
          {response ? (
            <>
              <div className="flex items-center justify-between px-2 bg-bg-secondary/40 border-b border-border-default shrink-0">
                <div className="flex items-center overflow-x-auto scrollbar-hide">
                  {(["pretty", "raw", "headers"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setResTab(t)}
                      className={cn(
                        "px-4 py-3 text-[13px] font-medium border-b-[2px] transition-colors whitespace-nowrap",
                        resTab === t ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary"
                      )}
                    >
                      {t === "pretty" ? "JSON Format" : t === "raw" ? "Raw" : "响应头"}
                    </button>
                  ))}
                </div>
                
                <div className="flex items-center gap-4 text-[12px] px-3">
                  <span className={cn("font-bold px-2 py-0.5 rounded-md", response.status < 400 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400")}>
                    {response.status} {response.statusText}
                  </span>
                  <span className="text-text-secondary font-mono">{response.durationMs}ms</span>
                  <span className="text-text-secondary font-mono">{response.bodySize < 1024 ? `${response.bodySize} B` : `${(response.bodySize / 1024).toFixed(1)} KB`}</span>
                  
                  <div className="w-[1px] h-4 bg-border-strong mx-1" />
                  
                  <button
                    onClick={handleCopy}
                    className="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
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
                      {Object.entries(response.headers).map(([k, v], i) => (
                        <div key={k} className={cn("flex gap-4 p-2 text-[13px] font-mono", i > 0 && "border-t border-border-default")}>
                          <span className="text-text-secondary font-medium w-1/3 break-words">{k}</span>
                          <span className="text-text-primary break-all w-2/3">{v}</span>
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
              <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4 border border-border-default shadow-sm">
                <Braces className="w-8 h-8 opacity-20" />
              </div>
              <p className="text-[14px] font-medium text-text-secondary">准备就绪</p>
              <p className="text-[12px] mt-1">输入 URL 并点击发送以调试 API</p>
            </div>
          )}
        </Panel>
        
        </PanelGroup>
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

  const cellInput = "w-full h-[30px] px-2 bg-transparent text-[12px] font-mono text-text-primary outline-none placeholder:text-text-disabled";

  return (
    <div className="w-full">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[10px] font-semibold text-text-disabled uppercase tracking-wider">
            <th className="w-7 p-0" />
            <th className="text-left font-semibold px-2 pb-0.5">{kp}</th>
            <th className="text-left font-semibold px-2 pb-0.5">{vp}</th>
            <th className="text-left font-semibold px-2 pb-0.5">Description</th>
            <th className="w-6 p-0" />
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
                    className={cn("w-full h-[30px] px-2 bg-transparent text-[11px] text-text-tertiary outline-none placeholder:text-text-disabled", !item.enabled && "opacity-40")} />
                </td>
                <td className="w-6 text-center p-0 align-middle">
                  <button onClick={() => remove(i)} className="w-6 h-[30px] inline-flex items-center justify-center text-text-disabled hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-sm">×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-1.5">
        <button onClick={add} className="text-[11px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors border border-dashed border-border-default hover:border-accent rounded px-2.5 py-1">
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
        className="text-[11px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors border border-dashed border-border-default hover:border-accent rounded px-2.5 py-1">
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
          <tr className="text-[10px] font-semibold text-text-disabled uppercase tracking-wider">
            <th className="w-7 p-0" />
            <th className="w-16 text-left font-semibold px-2 pb-0.5">类型</th>
            <th className="text-left font-semibold px-2 pb-0.5">Key</th>
            <th className="text-left font-semibold px-2 pb-0.5">Value</th>
            <th className="w-6 p-0" />
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

