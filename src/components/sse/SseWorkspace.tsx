// ProtoForge SSE Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, ArrowDown, Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, type RequestProtocol } from '@/stores/appStore';
import type { KeyValue } from '@/types/http';
import { RequestWorkbenchHeader } from '@/components/request/RequestWorkbenchHeader';
import { RequestProtocolSwitcher } from '@/components/request/RequestProtocolSwitcher';

interface SseEvent {
  id: string | null;
  eventType: string;
  data: string;
  timestamp: string;
}

export function SseWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const tabId = activeTab?.id || '';

  const [url, setUrl] = useState('');
  const [headers] = useState<KeyValue[]>([{ key: '', value: '', enabled: true }]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
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

  // 自动滚动
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

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

  const handleProtocolChange = useCallback(async (protocol: RequestProtocol) => {
    if (!activeTab || protocol === activeTab.protocol) return;
    try {
      if (isConnected) {
        await invoke('sse_disconnect', { connId });
      }
    } catch {}
    setTabProtocol(activeTab.id, protocol);
  }, [activeTab, connId, isConnected, setTabProtocol]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* URL Bar */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab?.protocol || "sse"} onChange={handleProtocolChange} />
        )}
        main={(
          <div className="flex min-w-0 flex-1 items-center">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isConnected && handleConnect()}
              placeholder="输入 SSE 端点 URL，如 https://api.example.com/events"
              disabled={isConnected}
              className="wb-request-input disabled:opacity-50"
            />
          </div>
        )}
        actions={
          isConnected ? (
            <button onClick={handleDisconnect} className="wb-primary-btn min-w-[88px] bg-red-500 hover:bg-red-600">
              <Square className="w-3 h-3 fill-white" /> 断开
            </button>
          ) : (
            <button onClick={handleConnect} disabled={!url.trim()} className="wb-primary-btn min-w-[88px] bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-40">
              <Play className="w-3 h-3 fill-white" /> 连接
            </button>
          )
        }
      />

      {/* Events List */}
      <div className="flex-1 px-3 pb-3 pt-1.5">
        <div className="wb-panel flex h-full flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className={cn("wb-status-chip",
                status === 'connected' ? "text-emerald-600" :
                status === 'connecting' ? "text-amber-600" :
                status === 'error' ? "text-red-500" :
                "text-text-tertiary"
              )}>
                <span className={cn("w-2 h-2 rounded-full",
                  status === 'connected' ? "bg-emerald-500 animate-pulse" :
                  status === 'connecting' ? "bg-amber-500 animate-pulse" :
                  status === 'error' ? "bg-red-500" :
                  "bg-gray-400"
                )} />
                {status === 'idle' ? '未连接' : status === 'connecting' ? '连接中...' : status === 'connected' ? '已连接' : status === 'disconnected' ? '已断开' : '错误'}
              </span>
              {errorMsg ? <span className="truncate text-[12px] text-red-500">{errorMsg}</span> : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <span className="text-[10px] text-text-disabled">{events.length} 条事件</span>
              <button onClick={() => setAutoScroll(!autoScroll)} className={cn("wb-ghost-btn px-2.5 text-[11px]", autoScroll && "text-accent")}>
                <ArrowDown className="w-3 h-3" /> 自动滚动
              </button>
              <button onClick={() => setEvents([])} className="wb-icon-btn hover:text-red-500 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div ref={listRef} className="flex-1 space-y-2 overflow-auto bg-bg-secondary/12 p-3.5">
            {events.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <Waves className="mb-3 h-9 w-9 opacity-20 text-orange-500" />
                <p className="text-[13px] font-medium">等待事件...</p>
                <p className="mt-1 text-[11px]">连接 SSE 端点后将实时显示事件流</p>
              </div>
            ) : (
              events.map((evt, i) => (
                <div key={i} className="rounded-[14px] border border-border-default/75 bg-bg-primary/82 p-2.5 transition-colors hover:border-border-strong">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono text-text-disabled">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    <span className="rounded-[10px] bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">{evt.eventType}</span>
                    {evt.id && <span className="text-[10px] text-text-disabled">id: {evt.id}</span>}
                  </div>
                  <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all">{evt.data}</pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
