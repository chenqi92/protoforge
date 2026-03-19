import { useState, useCallback } from "react";
import { Play, Loader2, Copy, Check, ChevronDown, Braces } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { HttpMethod, KeyValue } from "@/types/http";
import { getMethodColor } from "@/types/http";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
const methodBg: Record<string, string> = {
  GET: "bg-emerald-500", POST: "bg-amber-500", PUT: "bg-blue-500",
  DELETE: "bg-red-500", PATCH: "bg-violet-500", HEAD: "bg-cyan-500", OPTIONS: "bg-gray-500",
};

export function HttpWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const setHttpResponse = useAppStore((s) => s.setHttpResponse);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body" | "auth">("params");
  const [resTab, setResTab] = useState<"pretty" | "raw" | "headers">("pretty");
  const [copied, setCopied] = useState(false);
  const [showMethods, setShowMethods] = useState(false);

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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Top Request Bar Area */}
      <div className="shrink-0 flex items-center h-11 px-3 border-b border-border-default bg-bg-primary gap-1">
        {/* Method Selector */}
        <div className="relative h-full shrink-0 flex items-center">
          <button
            onClick={() => setShowMethods(!showMethods)}
            className={cn(
              "flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[12px] font-bold text-white min-w-[72px] justify-between transition-colors",
              methodBg[config.method]
            )}
          >
            {config.method}
            <ChevronDown className="w-3 h-3 opacity-70" />
          </button>
          {showMethods && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMethods(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-bg-elevated border border-border-default rounded-md shadow-lg overflow-hidden min-w-[110px] py-0.5">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { updateHttpConfig(tabId, { method: m }); setShowMethods(false); }}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-[12px] font-bold hover:bg-bg-hover transition-colors",
                      config.method === m ? "bg-accent-soft text-accent" : getMethodColor(m)
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        
        {/* URL Input */}
        <input
          value={config.url}
          onChange={(e) => updateHttpConfig(tabId, { url: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入请求 URL，如 https://api.example.com/v1/users"
          className="flex-1 h-full px-3 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary"
        />
        
        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={loading || !config.url.trim()}
          className="h-[28px] px-3.5 rounded-md flex items-center justify-center gap-1.5 text-[12px] font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3 h-3 fill-white" />}
          {loading ? "发送中" : "发送"}
        </button>
      </div>

      {/* Main Split Area */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup orientation="vertical">
        
        {/* Request Panel */}
        <Panel minSize="15" defaultSize="50" className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center px-2 bg-bg-secondary/40 border-b border-border-default shrink-0 overflow-x-auto scrollbar-hide">
            {(["params", "headers", "body", "auth"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setReqTab(t)}
                className={cn(
                  "px-4 py-3 text-[13px] font-medium border-b-[2px] transition-colors whitespace-nowrap",
                  reqTab === t ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary"
                )}
              >
                {t === "params" ? `参数${params.filter(p=>p.key).length ? ` (${params.filter(p=>p.key).length})` : ""}` : 
                 t === "headers" ? `请求头${headers.filter(h=>h.key).length ? ` (${headers.filter(h=>h.key).length})` : ""}` : 
                 t === "body" ? "请求体" : "认证"}
              </button>
            ))}
          </div>
          
          <div className="flex-1 overflow-auto bg-transparent">
            {reqTab === "params" && <div className="p-2"><KVEditor items={params} onChange={(v) => updateHttpConfig(tabId, { queryParams: v })} kp="Query Param" vp="Value" /></div>}
            {reqTab === "headers" && <div className="p-2"><KVEditor items={headers} onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" /></div>}
            
            {reqTab === "body" && (
              <div className="p-4 flex flex-col h-full">
                <div className="flex items-center gap-2 mb-4 shrink-0 bg-bg-secondary p-1 rounded-lg w-fit">
                  {(["none", "json", "raw", "formUrlencoded"] as const).map((bt) => (
                    <button
                      key={bt}
                      onClick={() => updateHttpConfig(tabId, { bodyType: bt })}
                      className={cn(
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-all",
                        config.bodyType === bt ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {bt === "none" ? "None" : bt === "formUrlencoded" ? "Form URL-Encoded" : bt.toUpperCase()}
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
                    <textarea
                      value={config.rawBody}
                      onChange={(e) => updateHttpConfig(tabId, { rawBody: e.target.value })}
                      placeholder="Enter raw request body..."
                      className="w-full h-full p-3 font-mono text-[13px] bg-bg-input border border-border-default rounded-lg text-text-secondary resize-none outline-none focus:border-accent transition-colors"
                      style={{ userSelect: "text" }}
                      spellCheck={false}
                    />
                  )}
                  {config.bodyType === "formUrlencoded" && <div className="overflow-auto h-full -mx-2 px-2"><KVEditor items={formFields} onChange={(v) => updateHttpConfig(tabId, { formFields: v })} kp="Field Name" vp="Value" /></div>}
                </div>
              </div>
            )}
            
            {reqTab === "auth" && (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-4 bg-bg-secondary p-1 rounded-lg w-fit">
                  {(["none", "bearer", "basic"] as const).map((at) => (
                    <button
                      key={at}
                      onClick={() => updateHttpConfig(tabId, { authType: at })}
                      className={cn(
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-all",
                        config.authType === at ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {at === "none" ? "No Auth" : at === "bearer" ? "Bearer Token" : "Basic Auth"}
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
                </div>
              </div>
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
                      {t === "pretty" ? "JSON Format" : t === "raw" ? "Raw Array" : "响应头"}
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
              
              <div className="flex-1 overflow-auto bg-bg-input/50 p-4">
                {resTab === "headers" ? (
                  <div className="max-w-3xl border border-border-default rounded-lg overflow-hidden bg-bg-primary">
                    {Object.entries(response.headers).map(([k, v], i) => (
                      <div key={k} className={cn("flex gap-4 p-2 text-[13px] font-mono", i > 0 && "border-t border-border-default")}>
                        <span className="text-text-secondary font-medium w-1/3 break-words">{k}</span>
                        <span className="text-text-primary break-all w-2/3">{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre 
                    className="text-[13px] font-mono text-text-primary whitespace-pre-wrap break-all leading-[1.6]" 
                    style={{ userSelect: "text" }}
                  >{resTab === "pretty" ? tryFormat(response.body) : response.body}</pre>
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
    </div>
  );
}

function KVEditor({ items, onChange, kp, vp }: { items: KeyValue[]; onChange: (v: KeyValue[]) => void; kp: string; vp: string; }) {
  const safe = items || [];
  
  const update = (i: number, f: "key" | "value", v: string) => { 
    const n = [...safe]; 
    n[i] = { ...n[i], [f]: v }; 
    onChange(n); 
  };
  
  const toggle = (i: number) => { 
    const n = [...safe]; 
    n[i] = { ...n[i], enabled: !n[i].enabled }; 
    onChange(n); 
  };
  
  const remove = (i: number) => onChange(safe.filter((_, j) => j !== i));
  const add = () => onChange([...safe, { key: "", value: "", enabled: true }]);

  return (
    <div className="w-full flex flex-col pt-1">
      {safe.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-8 text-[11px] font-semibold text-text-disabled uppercase tracking-wider">
          <div className="flex-1">{kp}</div>
          <div className="flex-1">{vp}</div>
          <div className="w-8" />
        </div>
      )}
      
      <div className="space-y-2">
        {safe.map((item, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <div className="w-6 flex justify-center">
              <input 
                type="checkbox" 
                checked={item.enabled} 
                onChange={() => toggle(i)} 
                className="w-3.5 h-3.5 rounded accent-accent shrink-0 cursor-pointer" 
              />
            </div>
            <input 
              value={item.key} 
              onChange={(e) => update(i, "key", e.target.value)} 
              placeholder={kp} 
              className={cn("input-field flex-1 font-mono text-[13px] py-1.5", !item.enabled && "opacity-40")} 
            />
            <input 
              value={item.value} 
              onChange={(e) => update(i, "value", e.target.value)} 
              placeholder={vp} 
              className={cn("input-field flex-1 font-mono text-[13px] py-1.5", !item.enabled && "opacity-40")} 
            />
            <div className="w-8 flex justify-center">
              <button 
                onClick={() => remove(i)} 
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-lg"
              >×</button>
            </div>
          </div>
        ))}
      </div>
      
      <button 
        onClick={add} 
        className="mt-3 ml-8 text-[12px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors w-fit border border-dashed border-border-default hover:border-accent rounded-md px-3 py-1.5"
      >
        <span>+</span> 添加
      </button>
    </div>
  );
}

function tryFormat(body: string): string { 
  try { 
    return JSON.stringify(JSON.parse(body), null, 2); 
  } catch { 
    return body; 
  } 
}
