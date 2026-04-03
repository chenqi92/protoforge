import { useState, useMemo } from "react";
import { useDeferredValue } from "react";
import { ChevronDown, ChevronUp, ArrowDownToLine, Trash2, Search, X, Waves, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { ResponseMetaPill } from "./HttpResponseParts";

export interface SseEvent {
  id: string | null;
  eventType: string;
  data: string;
  timestamp: string;
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

  const preview = event.data.replace(/\n/g, ' ').slice(0, 200);

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50",
          expanded && "bg-bg-hover/30"
        )}
      >
        <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-text-disabled" />

        <span className={cn(
          "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 pf-text-xxs font-bold leading-none",
          color.bg, color.text, color.border
        )}>
          {event.eventType}
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
          {preview}
        </span>

        <span className="shrink-0 font-mono pf-text-xxs text-text-disabled">
          {new Date(event.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' } as Intl.DateTimeFormatOptions)}
        </span>

        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-disabled" />
        }
      </button>

      {expanded && (
        <div className="mx-4 mb-2 mt-0.5 rounded-lg border border-border-default/60 bg-bg-secondary/20 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border-default/40 px-3 py-1.5 pf-text-xxs text-text-tertiary">
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
    <div className="flex items-center gap-2.5 px-4 py-2 pf-text-xs text-text-tertiary">
      <Info className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="flex-1">{message}</span>
      {timestamp && (
        <span className="shrink-0 font-mono pf-text-xxs text-text-disabled">
          {new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' } as Intl.DateTimeFormatOptions)}
        </span>
      )}
    </div>
  );
}

export function HttpSseResponsePanel({
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
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const MAX_VISIBLE_SSE_EVENTS = 400;

  const filteredEvents = useMemo(() => {
    if (!deferredSearchQuery) return events;
    const normalized = deferredSearchQuery.toLowerCase();
    return events.filter(e => {
      const haystack = `${e.eventType} ${e.data} ${e.id || ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [events, deferredSearchQuery]);

  const reversedEvents = useMemo(() => [...filteredEvents].reverse(), [filteredEvents]);
  const visibleEvents = useMemo(
    () => reversedEvents.slice(0, MAX_VISIBLE_SSE_EVENTS),
    [reversedEvents],
  );

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
        <div className="border-b border-red-200 bg-red-50/80 px-4 py-2 pf-text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div ref={listRef} className="selectable flex-1 overflow-auto bg-bg-secondary/8">
        {events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-disabled">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary/35">
              <Waves className="h-7 w-7 text-orange-500/40" />
            </div>
            <div className="pf-text-md font-semibold text-text-secondary">{t('sse.emptyTitle')}</div>
            <div className="mt-2 max-w-xl pf-text-sm leading-6 text-text-tertiary">{t('sse.emptyDesc')}</div>
          </div>
        ) : (
          <div className="divide-y divide-border-default/30">
            {status === 'disconnected' && (
              <SseSystemMessage message="Connection closed" timestamp={reversedEvents[0]?.timestamp} />
            )}

            {visibleEvents.map((event, index) => (
              <SseEventRow key={`${event.timestamp}-${events.length - 1 - index}`} event={event} />
            ))}
            {reversedEvents.length > MAX_VISIBLE_SSE_EVENTS && (
              <div className="px-4 py-2 text-center pf-text-xxs text-text-disabled">
                仅渲染最近 {MAX_VISIBLE_SSE_EVENTS} 条事件，共 {reversedEvents.length} 条
              </div>
            )}

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
