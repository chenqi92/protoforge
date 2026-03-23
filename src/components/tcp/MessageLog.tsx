import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Trash2, ArrowDown, Search, Copy, Check, ArrowUpRight, ArrowDownLeft, PlugZap, FileCode2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { convertFormat } from "@/services/tcpService";
import { usePluginStore } from "@/stores/pluginStore";
import { ProtocolParserPanel } from "@/components/plugins/ProtocolParserPanel";
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
  const [parserTarget, setParserTarget] = useState<TcpMessage | null>(null);
  const hasParserPlugin = usePluginStore((s) => s.installedPlugins.some((p) => p.pluginType === 'protocol-parser'));

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
            <span className="truncate text-[var(--fs-sm)] font-semibold text-text-primary">
              {statusText || t('tcp.messageLog.title')}
            </span>
            <span className="rounded-[8px] bg-bg-primary/75 px-2 py-0.5 text-[var(--fs-xxs)] font-medium text-text-tertiary">
              {filteredMessages.length}/{messages.length}
            </span>
          </div>

          {stats && hasTraffic ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[var(--fs-xs)] text-text-tertiary">
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
              className="flex items-center gap-1 rounded-[12px] px-2.5 py-1.5 text-[var(--fs-xs)] text-accent transition-colors hover:bg-accent-soft"
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
              <p className="text-[var(--fs-md)] font-semibold text-text-secondary">{t('tcp.messageLog.noMatch')}</p>
              <p className="mt-1 text-[var(--fs-sm)] text-text-tertiary">{t('tcp.messageLog.noMatchHint')}</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 py-8">
              <div className="max-w-xl text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border-default/70 bg-bg-primary/82">
                  <PlugZap className="h-5 w-5 text-text-disabled" />
                </div>
                <p className="text-[var(--fs-lg)] font-semibold text-text-secondary">{emptyTitle}</p>
                <p className="mt-2 text-[var(--fs-sm)] leading-6 text-text-tertiary">{emptyDesc}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="rounded-[9px] border border-border-default/70 bg-bg-primary/78 px-2.5 py-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                    {displayFormat.toUpperCase()}
                  </span>
                  {typeof connected === "boolean" ? (
                    <span
                      className={cn(
                        "rounded-[9px] border px-2.5 py-1 text-[var(--fs-xxs)] font-semibold",
                        connected
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                          : "border-border-default/70 bg-bg-secondary/78 text-text-tertiary"
                      )}
                    >
                      {connected ? t('tcp.system.connected') : t('tcp.system.waitingConnection')}
                    </span>
                  ) : null}
                  {stats && hasTraffic ? (
                    <>
                      <span className="rounded-[9px] border border-border-default/70 bg-bg-primary/78 px-2.5 py-1 text-[var(--fs-xxs)] text-text-secondary">
                        {formatSize(stats.sentBytes)} / {stats.sentCount} TX
                      </span>
                      <span className="rounded-[9px] border border-border-default/70 bg-bg-primary/78 px-2.5 py-1 text-[var(--fs-xxs)] text-text-secondary">
                        {formatSize(stats.receivedBytes)} / {stats.receivedCount} RX
                      </span>
                    </>
                  ) : null}
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
              const compactData = displayData.replace(/\s+/g, " ").trim();
              const preview = compactData || displayData;

              return (
                <div
                  key={m.id}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-bg-hover/42",
                    m.direction === "system" && "bg-amber-500/[0.04]"
                  )}
                  title={displayData}
                >
                  <div className="shrink-0">
                    {m.direction === "sent" ? (
                      <span className="rounded-[8px] bg-blue-500/10 px-2 py-0.5 text-[var(--fs-3xs)] font-bold text-blue-600">TX</span>
                    ) : m.direction === "received" ? (
                      <span className="rounded-[8px] bg-emerald-500/10 px-2 py-0.5 text-[var(--fs-3xs)] font-bold text-emerald-600">RX</span>
                    ) : (
                      <span className="rounded-[8px] bg-amber-500/10 px-2 py-0.5 text-[var(--fs-3xs)] font-bold text-amber-600">SYS</span>
                    )}
                  </div>

                  <span className="w-[84px] shrink-0 select-none font-mono text-[var(--fs-xxs)] text-text-disabled">
                    {formatTime(m.timestamp)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className={cn(
                      "truncate font-mono text-[var(--fs-sm)] leading-5 select-text",
                      m.direction === "sent" ? "text-blue-700 dark:text-blue-300" :
                      m.direction === "system" ? "text-amber-700 dark:text-amber-300" :
                      "text-text-primary"
                    )}>
                      {preview}
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-2 text-[var(--fs-xxs)] text-text-disabled lg:flex">
                    {m.remoteAddr ? (
                      <span className="truncate rounded-[8px] bg-bg-secondary/72 px-2 py-0.5">
                        {m.direction === "received" ? "← " : "→ "}{m.remoteAddr}
                      </span>
                    ) : null}
                    {m.clientId ? (
                      <span className="truncate rounded-[8px] bg-bg-secondary/72 px-2 py-0.5">
                        {t('tcp.messageLog.client')}: {m.clientId.slice(0, 8)}
                      </span>
                    ) : null}
                    {m.size > 0 ? <span className="w-[56px] text-right">{formatSize(m.size)}</span> : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.size > 0 ? <span className="text-[var(--fs-xxs)] text-text-disabled lg:hidden">{formatSize(m.size)}</span> : null}
                    <button
                      onClick={() => handleCopy(displayData, m.id)}
                      className="rounded-[10px] p-1.5 text-text-disabled opacity-0 transition-all hover:bg-bg-hover hover:text-accent group-hover:opacity-100"
                    >
                      {copiedId === m.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    {hasParserPlugin && m.direction === 'received' && (
                      <button
                        onClick={() => setParserTarget(m)}
                        className="rounded-[10px] p-1.5 text-text-disabled opacity-0 transition-all hover:bg-bg-hover hover:text-blue-500 group-hover:opacity-100"
                        title={t('parser.parse', '解析')}
                      >
                        <FileCode2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* 协议解析弹窗 */}
      {parserTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setParserTarget(null)}>
          <div
            className="w-[560px] max-h-[80vh] rounded-[14px] border border-border-default bg-bg-primary shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default/60 shrink-0">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-accent" />
                <span className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('parser.parseMessage', '解析报文')}</span>
              </div>
              <button onClick={() => setParserTarget(null)} className="p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ProtocolParserPanel initialData={parserTarget.data} className="flex-1 min-h-0" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
