// 消息日志组件 — 多编码显示、过滤
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, ArrowDown, Search, Copy, Check, ArrowUpRight, ArrowDownLeft, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { convertFormat } from "@/services/tcpService";
import type { ConnectionStats, TcpMessage, DataFormat } from "@/types/tcp";

interface MessageLogProps {
  messages: TcpMessage[];
  onClear: () => void;
  displayFormat: DataFormat;
  setDisplayFormat: (v: DataFormat) => void;
  connected?: boolean;
  statusText?: string;
  stats?: ConnectionStats;
  embedded?: boolean;
}

const FORMAT_TABS: { value: DataFormat; label: string }[] = [
  { value: "ascii", label: "ASCII" },
  { value: "hex", label: "HEX" },
  { value: "base64", label: "Base64" },
];

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      + "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch { return ts; }
}

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function MessageLog({
  messages,
  onClear,
  displayFormat,
  setDisplayFormat,
  connected,
  statusText,
  stats,
  embedded = false,
}: MessageLogProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
  }, []);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredMessages = filter
    ? messages.filter((m) => m.data.toLowerCase().includes(filter.toLowerCase()))
    : messages;
  const hasTraffic = Boolean(
    stats && (
      stats.sentBytes > 0 ||
      stats.receivedBytes > 0 ||
      stats.sentCount > 0 ||
      stats.receivedCount > 0
    )
  );
  const isFiltering = Boolean(filter.trim());
  const emptyTitle = connected ? t('tcp.messageLog.emptyConnectedTitle') : statusText || t('tcp.messageLog.emptyDisconnectedTitle');
  const emptyDesc = connected
    ? t('tcp.messageLog.emptyConnectedDesc')
    : t('tcp.messageLog.emptyDisconnectedDesc');

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", !embedded && "wb-panel")}>
      <div className={cn("shrink-0", embedded ? "wb-pane-header" : "wb-panel-header")}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {typeof connected === "boolean" ? (
              <span className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full transition-colors",
                connected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]" : "bg-text-disabled"
              )} />
            ) : null}
            <span className="truncate text-[12px] font-semibold text-text-primary">
              {statusText || t('tcp.messageLog.title')}
            </span>
            <span className="rounded-[8px] bg-bg-primary/75 px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
              {filteredMessages.length}/{messages.length}
            </span>
          </div>

          {stats && hasTraffic ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-text-tertiary">
              <span className="inline-flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3 text-blue-500" />
                {formatSize(stats.sentBytes)} ({stats.sentCount})
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowDownLeft className="h-3 w-3 text-emerald-500" />
                {formatSize(stats.receivedBytes)} ({stats.receivedCount})
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="wb-tool-segment">
            {FORMAT_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setDisplayFormat(tab.value)}
                className={cn(displayFormat === tab.value && "is-active")}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="wb-search w-[132px] transition-[width] focus-within:w-[188px]">
            <Search className="h-3.5 w-3.5 text-text-disabled" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('tcp.messageLog.search')}
            />
          </div>

          {!autoScroll && messages.length > 0 ? (
            <button
              onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className="flex items-center gap-1 rounded-[12px] px-2.5 py-1.5 text-[11px] text-accent transition-colors hover:bg-accent-soft"
            >
              <ArrowDown className="h-3 w-3" /> {t('tcp.messageLog.scrollToBottom')}
            </button>
          ) : null}

          {messages.length > 0 ? (
            <button
              onClick={onClear}
              className="wb-icon-btn hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-bg-primary/34">
        {filteredMessages.length === 0 ? (
          isFiltering ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-disabled">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default/70 bg-bg-primary/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Search className="h-6 w-6 opacity-35" />
              </div>
              <p className="text-[14px] font-semibold text-text-secondary">{t('tcp.messageLog.noMatch')}</p>
              <p className="mt-1 text-[12px] text-text-tertiary">{t('tcp.messageLog.noMatchHint')}</p>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-border-default/60 px-5 py-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-text-secondary">{emptyTitle}</p>
                    <p className="mt-1 max-w-2xl text-[12px] leading-6 text-text-tertiary">{emptyDesc}</p>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="rounded-[9px] border border-border-default/70 bg-bg-primary/78 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                      {displayFormat.toUpperCase()}
                    </span>
                    {typeof connected === "boolean" ? (
                      <span
                        className={cn(
                          "rounded-[9px] border px-2.5 py-1 text-[10px] font-semibold",
                          connected
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                            : "border-border-default/70 bg-bg-secondary/78 text-text-tertiary"
                        )}
                      >
                        {connected ? t('tcp.system.connected') : t('tcp.system.waitingConnection')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center px-6 py-6">
                <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.85fr)] xl:items-center">
                  <div className="text-center xl:text-left">
                    <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full border border-border-default/70 bg-bg-primary/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:mx-0">
                      <PlugZap className="h-8 w-8 text-text-disabled" />
                    </div>
                    <p className="text-[18px] font-semibold text-text-secondary">{emptyTitle}</p>
                    <p className="mx-auto mt-2 max-w-2xl text-[12px] leading-6 text-text-tertiary xl:mx-0">
                      {emptyDesc}
                    </p>

                    <div className="mt-4 flex flex-wrap justify-center gap-2 xl:justify-start">
                      <span className="rounded-[10px] border border-border-default/70 bg-bg-primary/78 px-3 py-1.5 text-[11px] text-text-secondary">
                        {displayFormat.toUpperCase()}
                      </span>
                      {stats && hasTraffic ? (
                        <>
                          <span className="rounded-[10px] border border-border-default/70 bg-bg-primary/78 px-3 py-1.5 text-[11px] text-text-secondary">
                            {formatSize(stats.sentBytes)} / {stats.sentCount} TX
                          </span>
                          <span className="rounded-[10px] border border-border-default/70 bg-bg-primary/78 px-3 py-1.5 text-[11px] text-text-secondary">
                            {formatSize(stats.receivedBytes)} / {stats.receivedCount} RX
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 text-left">
                    <div className="rounded-[12px] border border-border-default/70 bg-bg-primary/72 px-4 py-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                        <PlugZap className="h-3.5 w-3.5 text-blue-500" />
                        {connected ? t('tcp.messageLog.step1Connected') : t('tcp.messageLog.step1Disconnected')}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-5 text-text-tertiary">
                        {connected
                          ? t('tcp.messageLog.step1ConnectedDesc')
                          : t('tcp.messageLog.step1DisconnectedDesc')}
                      </div>
                    </div>

                    <div className="rounded-[12px] border border-border-default/70 bg-bg-primary/72 px-4 py-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                        <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
                        {connected ? t('tcp.messageLog.step2Connected') : t('tcp.messageLog.step2Disconnected')}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-5 text-text-tertiary">
                        {connected
                          ? t('tcp.messageLog.step2ConnectedDesc')
                          : t('tcp.messageLog.step2DisconnectedDesc')}
                      </div>
                    </div>

                    <div className="rounded-[12px] border border-border-default/70 bg-bg-primary/72 px-4 py-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                        <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
                        {connected ? t('tcp.messageLog.step3Connected') : t('tcp.messageLog.step3Disconnected')}
                      </div>
                      <div className="mt-1.5 text-[11px] leading-5 text-text-tertiary">
                        {connected
                          ? t('tcp.messageLog.step3ConnectedDesc')
                          : t('tcp.messageLog.step3DisconnectedDesc')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="divide-y divide-border-default/55">
            {filteredMessages.map((m) => {
              const displayData = m.direction === "system"
                ? m.data
                : convertFormat(m.data, m.rawHex, "ascii", displayFormat);

              return (
                <div
                  key={m.id}
                  className={cn(
                    "group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/42",
                    m.direction === "system" && "bg-amber-500/[0.04]"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {m.direction === "sent" ? (
                      <span className="rounded-[8px] bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold text-blue-600">TX</span>
                    ) : m.direction === "received" ? (
                      <span className="rounded-[8px] bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-600">RX</span>
                    ) : (
                      <span className="rounded-[8px] bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600">SYS</span>
                    )}
                  </div>

                  <span className="mt-0.5 w-[84px] shrink-0 select-none font-mono text-[10px] text-text-disabled">
                    {formatTime(m.timestamp)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <pre className={cn(
                      "whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed select-text",
                      m.direction === "sent" ? "text-blue-700 dark:text-blue-300" :
                      m.direction === "system" ? "text-amber-700 dark:text-amber-300" :
                      "text-text-primary"
                    )}>
                      {displayData}
                    </pre>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-disabled">
                      {m.size > 0 ? <span>{formatSize(m.size)}</span> : null}
                      {m.remoteAddr ? <span>{m.direction === "received" ? "← " : "→ "}{m.remoteAddr}</span> : null}
                      {m.clientId ? <span>{t('tcp.messageLog.client')}: {m.clientId.slice(0, 8)}</span> : null}
                    </div>
                  </div>

                  <button
                    onClick={() => handleCopy(displayData, m.id)}
                    className="shrink-0 rounded-[10px] p-1.5 text-text-disabled opacity-0 transition-all hover:bg-bg-hover hover:text-accent group-hover:opacity-100"
                  >
                    {copiedId === m.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}
