// 消息日志组件 — 多编码显示、过滤
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, ArrowDown, Search, Copy, Check, ArrowUpRight, ArrowDownLeft } from "lucide-react";
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
}: MessageLogProps) {
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-border-default/80 bg-bg-primary/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default/70 bg-bg-secondary/36 px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {typeof connected === "boolean" ? (
              <span className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full transition-colors",
                connected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]" : "bg-text-disabled"
              )} />
            ) : null}
            <span className="truncate text-[12px] font-semibold text-text-primary">
              {statusText || "消息日志"}
            </span>
            <span className="rounded-full bg-bg-primary/75 px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
              {filteredMessages.length}/{messages.length} 条
            </span>
          </div>

          {stats ? (
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
          <div className="flex items-center gap-1 rounded-[12px] border border-border-default/70 bg-bg-primary/70 p-1">
            {FORMAT_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setDisplayFormat(tab.value)}
                className={cn(
                  "rounded-[10px] px-2.5 py-1 text-[10px] font-semibold transition-all",
                  displayFormat === tab.value
                    ? "bg-bg-primary text-text-primary shadow-sm"
                    : "text-text-tertiary hover:bg-bg-hover/80 hover:text-text-secondary"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-disabled" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索消息"
              className="h-8 w-[120px] rounded-[12px] border border-border-default/75 bg-bg-primary/70 pl-7 pr-2 text-[11px] text-text-primary outline-none transition-all placeholder:text-text-disabled focus:border-accent focus:w-[176px]"
            />
          </div>

          {!autoScroll && messages.length > 0 ? (
            <button
              onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className="flex items-center gap-1 rounded-[12px] px-2.5 py-1.5 text-[11px] text-accent transition-colors hover:bg-accent-soft"
            >
              <ArrowDown className="h-3 w-3" /> 底部
            </button>
          ) : null}

          {messages.length > 0 ? (
            <button
              onClick={onClear}
              className="rounded-[12px] p-2 text-text-disabled transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-bg-primary/34">
        {filteredMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-disabled">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default/70 bg-bg-primary/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <Search className="h-6 w-6 opacity-35" />
            </div>
            <p className="text-[14px] font-semibold text-text-secondary">
              {filter ? "没有匹配的消息" : "消息将在这里实时滚动"}
            </p>
            <p className="mt-1 text-[12px] text-text-tertiary">
              {filter ? "试试缩短关键词或切换显示格式" : "连接成功后，发送与接收的数据会按时间顺序显示"}
            </p>
          </div>
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
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold text-blue-600">TX</span>
                    ) : m.direction === "received" ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-600">RX</span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-600">SYS</span>
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
                      {m.clientId ? <span>客户端: {m.clientId.slice(0, 8)}</span> : null}
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
