// ProtoForge SSE Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, Radio, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import type { KeyValue } from '@/types/http';

interface SseEvent {
  id: string | null;
  eventType: string;
  data: string;
  timestamp: string;
}

export function SseWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* URL Bar */}
      <div className="shrink-0 flex items-center h-10 px-3 border-b border-border-default gap-2">
        <Radio className="w-4 h-4 text-accent shrink-0" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isConnected && handleConnect()}
          placeholder="输入 SSE 端点 URL，如 https://api.example.com/events"
          disabled={isConnected}
          className="flex-1 h-full px-2 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
        />
        {isConnected ? (
          <button onClick={handleDisconnect} className="h-7 px-4 rounded-md flex items-center gap-1.5 text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors shrink-0">
            <Square className="w-3 h-3 fill-white" /> 断开
          </button>
        ) : (
          <button onClick={handleConnect} disabled={!url.trim()} className="h-7 px-4 rounded-md flex items-center gap-1.5 text-[12px] font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-40 transition-colors shrink-0">
            <Play className="w-3 h-3 fill-white" /> 连接
          </button>
        )}
      </div>

      {/* Status Bar */}
      <div className="shrink-0 flex items-center h-8 px-3 bg-bg-secondary/40 border-b border-border-default gap-3 text-[11px]">
        <span className={cn("flex items-center gap-1.5 font-medium",
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
        {errorMsg && <span className="text-red-500 truncate flex-1">{errorMsg}</span>}
        <span className="text-text-disabled ml-auto">{events.length} 条事件</span>
        <button onClick={() => setAutoScroll(!autoScroll)} className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]", autoScroll ? "text-accent bg-accent/10" : "text-text-disabled hover:text-text-secondary")}>
          <ArrowDown className="w-3 h-3" /> 自动滚动
        </button>
        <button onClick={() => setEvents([])} className="text-text-disabled hover:text-red-500 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Events List */}
      <div ref={listRef} className="flex-1 overflow-auto p-3 space-y-1">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-disabled">
            <Radio className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-[13px] font-medium">等待事件...</p>
            <p className="text-[11px] mt-1">连接 SSE 端点后将实时显示事件流</p>
          </div>
        ) : (
          events.map((evt, i) => (
            <div key={i} className="p-2 rounded-md bg-bg-secondary/60 border border-border-default hover:border-border-strong transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-text-disabled">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">{evt.eventType}</span>
                {evt.id && <span className="text-[10px] text-text-disabled">id: {evt.id}</span>}
              </div>
              <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all">{evt.data}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
