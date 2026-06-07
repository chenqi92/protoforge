// ProtoForge SSE Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, Waves, ArrowDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import type { KeyValue } from '@/types/http';
import { RequestWorkbenchHeader } from '@/components/request/RequestWorkbenchHeader';
import { RequestProtocolSwitcher, type RequestKind } from '@/components/request/RequestProtocolSwitcher';

interface SseEvent {
  id: string | null;
  eventType: string;
  data: string;
  timestamp: string;
}

export function SseWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const tabId = activeTab?.id || '';
  const { t } = useTranslation();

  const [url, setUrl] = useState('');
  const [headers] = useState<KeyValue[]>([{ key: '', value: '', enabled: true }]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const connId = `sse-${tabId}`;

  // 监听事件
  useEffect(() => {
    const unlisten1 = listen<SseEvent>(`sse-event-${connId}`, (e) => {
      setEvents((prev) => [...prev, e.payload]);
    });
    const unlisten2 = listen<string>(`sse-status-${connId}`, (e) => {
      const s = e.payload;
      if (s === 'connecting') setStatus('connecting');
      else if (s === 'connected') { setStatus('connected'); setErrorMsg(''); }
      else if (s === 'disconnected') setStatus('disconnected');
      else if (s.startsWith('error:')) { setStatus('error'); setErrorMsg(s.slice(6)); }
    });

    return () => { unlisten1.then(f => f()); unlisten2.then(f => f()); };
  }, [connId]);


  const handleConnect = useCallback(async () => {
    if (!url.trim()) return;
    setEvents([]);
    setErrorMsg('');
    const hdrs: Record<string, string> = {};
    for (const h of headers) {
      if (h.enabled && h.key.trim()) hdrs[h.key.trim()] = h.value;
    }
    try {
      await invoke('sse_connect', { connId, request: { url, headers: hdrs } });
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      setStatus('error');
    }
  }, [url, headers, connId]);

  const handleDisconnect = useCallback(async () => {
    try { await invoke('sse_disconnect', { connId }); } catch {}
  }, [connId]);

  const isConnected = status === 'connected' || status === 'connecting';

  const handleRequestKindChange = useCallback(async (kind: RequestKind) => {
    if (!activeTab) return;
    try {
      if (isConnected) {
        await invoke('sse_disconnect', { connId });
      }
    } catch {}

    if (kind === "ws" || kind === "mqtt") {
      setTabProtocol(activeTab.id, kind);
      return;
    }

    setTabProtocol(activeTab.id, "http");
    updateHttpConfig(activeTab.id, {
      requestMode: kind === "http" ? "rest" : "graphql",
      name: kind === "graphql" ? "GraphQL Request" : "Untitled Request",
      method: kind === "graphql" ? "POST" : "GET",
    });
  }, [activeTab, connId, isConnected, setTabProtocol, updateHttpConfig]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* URL Bar */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab?.protocol || "http"} activeHttpMode="sse" onChange={handleRequestKindChange} />
        )}
        main={(
          <div className="flex min-w-0 flex-1 items-center">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isConnected && handleConnect()}
              placeholder={t('sse.urlPlaceholder')}
              disabled={isConnected}
              className="wb-request-input disabled:opacity-50"
            />
          </div>
        )}
        actions={
          isConnected ? (
            <button onClick={handleDisconnect} className={cn("wb-primary-btn min-w-[88px]", status === 'connecting' ? "bg-warning hover:bg-warning/90" : "bg-error hover:bg-error/90")}>
              {status === 'connecting' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3 fill-white" />}
              {status === 'connecting' ? t('sse.connecting') : t('sse.disconnect')}
            </button>
          ) : (
            <button onClick={handleConnect} disabled={!url.trim()} className="wb-primary-btn min-w-[88px] bg-accent hover:bg-accent-hover disabled:opacity-50">
              <Play className="w-3 h-3 fill-white" /> {t('sse.connect')}
            </button>
          )
        }
      />

      {/* Events List */}
      <div className="flex-1 px-3 pb-3 pt-1.5">
        <div className="wb-panel flex h-full flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className={cn("pf-status-chip",
                status === 'connected' ? "text-accent" :
                status === 'connecting' ? "text-warning" :
                status === 'error' ? "text-error" :
                "text-text-tertiary"
              )}>
                <span className={cn("pf-dot",
                  status === 'connected' ? "s-live" :
                  status === 'connecting' ? "s-conn" :
                  status === 'error' ? "s-err" :
                  "s-idle"
                )} />
                {status === 'idle' ? t('sse.idle') : status === 'connecting' ? t('sse.connecting') : status === 'connected' ? t('sse.connected') : status === 'disconnected' ? t('sse.disconnected') : t('sse.error')}
              </span>
              {errorMsg ? <span className="truncate pf-text-sm text-error">{errorMsg}</span> : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <span className="pf-pill"><span className="pf-text-3xs uppercase tracking-wide opacity-70">evt</span><span className="tabular-nums">{events.length}</span></span>
              <button onClick={() => setEvents([])} className="wb-icon-btn hover:bg-error/10 hover:text-error transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div ref={listRef} className="flex-1 overflow-auto bg-bg-secondary/10">
            {events.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-text-disabled">
                <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
                  <Waves className="h-8 w-8 opacity-20 text-accent" />
                </div>
                <p className="pf-text-base font-medium">{t('sse.emptyTitle')}</p>
                <p className="mt-1 pf-text-xs">{t('sse.emptyDesc')}</p>
              </div>
            ) : (
              <div className="divide-y divide-border-default/40">
                {events.map((evt, i) => (
                  <div key={i} className="px-4 py-1.5 transition-colors hover:bg-bg-hover/40">
                    <div className="mb-0.5 flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5 shrink-0 text-method-get" />
                      <span className="shrink-0 font-mono tabular-nums pf-text-xxs text-text-tertiary">{new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                      <span className="pf-pill acc shrink-0 pf-text-3xs uppercase">{evt.eventType}</span>
                      {evt.id && <span className="shrink-0 pf-text-3xs font-mono text-text-disabled">id: {evt.id}</span>}
                    </div>
                    <pre className="whitespace-pre-wrap break-all pl-6 pf-text-xs font-mono leading-[1.6] text-text-secondary">{evt.data}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
