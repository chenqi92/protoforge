import { useState, useCallback } from "react";
import { Play, Loader2, Copy, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { HttpMethod, KeyValue } from "@/types/http";
import { getMethodColor, getStatusColor } from "@/types/http";

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
      setTimeout(() => setCopied(false), 1500);
    }
  }, [response]);

  const params = config.queryParams || [];
  const headers = config.headers || [];
  const formFields = config.formFields || [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* URL Bar */}
      <div className="shrink-0 px-4 py-3 bg-bg-secondary border-b border-border-subtle">
        <div className="flex items-center gap-0">
          <div className="relative">
            <button
              onClick={() => setShowMethods(!showMethods)}
              className={cn("flex items-center gap-1 h-[34px] px-3 rounded-l-[var(--radius-md)] text-[12px] font-bold text-white min-w-[82px] justify-between", methodBg[config.method])}
            >
              {config.method}
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>
            {showMethods && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMethods(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-bg-elevated border border-border-default rounded-[var(--radius-md)] shadow-md overflow-hidden min-w-[100px]">
                  {METHODS.map((m) => (
                    <button key={m} onClick={() => { updateHttpConfig(tabId, { method: m }); setShowMethods(false); }} className={cn("w-full px-3 py-1.5 text-left text-[12px] font-bold hover:bg-bg-hover transition-colors", config.method === m ? "bg-bg-active text-text-primary" : getMethodColor(m))}>
                      {m}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <input
            value={config.url}
            onChange={(e) => updateHttpConfig(tabId, { url: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="输入请求 URL ..."
            className="flex-1 h-[34px] px-3 bg-bg-input border-y border-border-default text-[13px] font-mono text-text-primary outline-none focus:border-border-focus transition-colors"
          />
          <button onClick={handleSend} disabled={loading || !config.url.trim()} className="h-[34px] px-5 rounded-r-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white gradient-accent disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.97] transition-all">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Send
          </button>
        </div>
      </div>

      {/* Request + Response vertical split */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Request */}
        <div className="h-[45%] min-h-[180px] flex flex-col border-b border-border-strong overflow-hidden">
          <div className="flex items-center px-4 bg-bg-secondary/50 border-b border-border-subtle shrink-0">
            {(["params", "headers", "body", "auth"] as const).map((t) => (
              <button key={t} onClick={() => setReqTab(t)} className={cn("px-4 py-2 text-[12px] font-medium border-b-2 transition-colors", reqTab === t ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary")}>
                {t === "params" ? `Params${params.filter(p=>p.key).length ? ` (${params.filter(p=>p.key).length})` : ""}` : t === "headers" ? `Headers${headers.filter(h=>h.key).length ? ` (${headers.filter(h=>h.key).length})` : ""}` : t === "body" ? "Body" : "Auth"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {reqTab === "params" && <KVEditor items={params} onChange={(v) => updateHttpConfig(tabId, { queryParams: v })} kp="参数名" vp="参数值" />}
            {reqTab === "headers" && <KVEditor items={headers} onChange={(v) => updateHttpConfig(tabId, { headers: v })} kp="Header" vp="Value" />}
            {reqTab === "body" && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  {(["none", "json", "raw", "formUrlencoded"] as const).map((bt) => (
                    <button key={bt} onClick={() => updateHttpConfig(tabId, { bodyType: bt })} className={cn("px-2.5 py-1 text-[11px] rounded-[var(--radius-xs)] border transition-colors", config.bodyType === bt ? "border-accent text-accent bg-accent-soft" : "border-border-default text-text-tertiary hover:text-text-secondary")}>
                      {bt === "formUrlencoded" ? "Form" : bt.toUpperCase()}
                    </button>
                  ))}
                </div>
                {config.bodyType === "json" && <textarea value={config.jsonBody} onChange={(e) => updateHttpConfig(tabId, { jsonBody: e.target.value })} placeholder={'{\n  "key": "value"\n}'} className="input-field w-full h-28 font-mono text-[12px] resize-y" style={{ userSelect: "text" }} />}
                {config.bodyType === "raw" && <textarea value={config.rawBody} onChange={(e) => updateHttpConfig(tabId, { rawBody: e.target.value })} placeholder="请求体..." className="input-field w-full h-28 font-mono text-[12px] resize-y" style={{ userSelect: "text" }} />}
                {config.bodyType === "formUrlencoded" && <KVEditor items={formFields} onChange={(v) => updateHttpConfig(tabId, { formFields: v })} kp="字段名" vp="字段值" />}
              </div>
            )}
            {reqTab === "auth" && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  {(["none", "bearer", "basic"] as const).map((at) => (
                    <button key={at} onClick={() => updateHttpConfig(tabId, { authType: at })} className={cn("px-2.5 py-1 text-[11px] rounded-[var(--radius-xs)] border transition-colors", config.authType === at ? "border-accent text-accent bg-accent-soft" : "border-border-default text-text-tertiary")}>
                      {at === "none" ? "无" : at === "bearer" ? "Bearer" : "Basic"}
                    </button>
                  ))}
                </div>
                {config.authType === "bearer" && <input value={config.bearerToken} onChange={(e) => updateHttpConfig(tabId, { bearerToken: e.target.value })} placeholder="Token" className="input-field w-full font-mono text-[12px]" />}
                {config.authType === "basic" && <div className="flex flex-col gap-2"><input value={config.basicUsername} onChange={(e) => updateHttpConfig(tabId, { basicUsername: e.target.value })} placeholder="用户名" className="input-field w-full text-[12px]" /><input value={config.basicPassword} onChange={(e) => updateHttpConfig(tabId, { basicPassword: e.target.value })} type="password" placeholder="密码" className="input-field w-full text-[12px]" /></div>}
              </div>
            )}
          </div>
        </div>

        {/* Response */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-[12px] shrink-0">⚠ {error}</div>}
          {response ? (
            <>
              <div className="flex items-center justify-between px-4 bg-bg-secondary/50 border-b border-border-subtle shrink-0">
                <div className="flex items-center gap-0">
                  {(["pretty", "raw", "headers"] as const).map((t) => (
                    <button key={t} onClick={() => setResTab(t)} className={cn("px-4 py-2 text-[12px] font-medium border-b-2 transition-colors", resTab === t ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary")}>
                      {t === "pretty" ? "Pretty" : t === "raw" ? "Raw" : "Headers"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className={cn("font-bold", getStatusColor(response.status))}>{response.status} {response.statusText}</span>
                  <span className="text-text-disabled">{response.durationMs}ms</span>
                  <span className="text-text-disabled">{response.bodySize < 1024 ? `${response.bodySize}B` : `${(response.bodySize / 1024).toFixed(1)}KB`}</span>
                  <button onClick={handleCopy} className="text-text-tertiary hover:text-text-secondary transition-colors">{copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {resTab === "headers" ? (
                  <div className="space-y-1">{Object.entries(response.headers).map(([k, v]) => (<div key={k} className="flex gap-2 text-[12px] font-mono"><span className="text-accent shrink-0 font-medium">{k}:</span><span className="text-text-secondary break-all">{v}</span></div>))}</div>
                ) : (
                  <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed" style={{ userSelect: "text" }}>{resTab === "pretty" ? tryFormat(response.body) : response.body}</pre>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-text-disabled"><div className="text-center"><div className="text-3xl mb-3 opacity-20">↑</div><p className="text-sm">发送请求查看响应</p></div></div>
          )}
        </div>
      </div>
    </div>
  );
}

function KVEditor({ items, onChange, kp, vp }: { items: KeyValue[]; onChange: (v: KeyValue[]) => void; kp: string; vp: string; }) {
  const safe = items || [];
  const update = (i: number, f: "key" | "value", v: string) => { const n = [...safe]; n[i] = { ...n[i], [f]: v }; onChange(n); };
  const toggle = (i: number) => { const n = [...safe]; n[i] = { ...n[i], enabled: !n[i].enabled }; onChange(n); };
  const remove = (i: number) => onChange(safe.filter((_, j) => j !== i));
  const add = () => onChange([...safe, { key: "", value: "", enabled: true }]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-text-disabled font-medium px-5"><span className="flex-1">{kp}</span><span className="flex-1">{vp}</span><span className="w-5" /></div>
      {safe.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <input type="checkbox" checked={item.enabled} onChange={() => toggle(i)} className="w-3.5 h-3.5 rounded accent-accent shrink-0" />
          <input value={item.key} onChange={(e) => update(i, "key", e.target.value)} placeholder={kp} className={cn("input-field flex-1 text-[12px] py-1.5 px-2", !item.enabled && "opacity-40")} />
          <input value={item.value} onChange={(e) => update(i, "value", e.target.value)} placeholder={vp} className={cn("input-field flex-1 text-[12px] py-1.5 px-2", !item.enabled && "opacity-40")} />
          <button onClick={() => remove(i)} className="w-5 h-5 flex items-center justify-center text-text-disabled hover:text-error opacity-0 group-hover:opacity-100 transition-opacity text-xs">×</button>
        </div>
      ))}
      <button onClick={add} className="text-[11px] text-accent hover:text-accent-hover transition-colors pl-5">+ 添加</button>
    </div>
  );
}

function tryFormat(body: string): string { try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; } }
