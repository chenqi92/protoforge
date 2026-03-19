// 消息日志组件 — 多编码显示、过滤
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, ArrowDown, Search, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertFormat } from "@/services/tcpService";
import type { TcpMessage, DataFormat } from "@/types/tcp";

interface MessageLogProps {
  messages: TcpMessage[];
  onClear: () => void;
  displayFormat: DataFormat;
  setDisplayFormat: (v: DataFormat) => void;
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
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export function MessageLog({ messages, onClear, displayFormat, setDisplayFormat }: MessageLogProps) {
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
    <div className="flex-1 flex flex-col bg-bg-primary rounded-xl border border-border-default shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary/40 border-b border-border-default shrink-0">
        <div className="flex items-center gap-2">
          {/* Display format tabs */}
          <div className="flex items-center gap-0 bg-bg-tertiary/60 p-0.5 rounded-md">
            {FORMAT_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setDisplayFormat(tab.value)}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold rounded transition-all",
                  displayFormat === tab.value
                    ? "bg-bg-primary text-text-primary shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-text-disabled">{messages.length} 条</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤..."
              className="h-5 w-24 pl-5 pr-1.5 text-[10px] bg-bg-input border border-border-default rounded outline-none focus:border-accent focus:w-36 transition-all text-text-primary"
            />
          </div>
          {!autoScroll && messages.length > 0 && (
            <button
              onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-soft rounded transition-colors"
            >
              <ArrowDown className="w-3 h-3" /> 底部
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={onClear}
              className="flex items-center p-1 text-text-disabled hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-bg-input/20">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-disabled py-12">
            <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3 border border-border-default">
              <Search className="w-5 h-5 opacity-30" />
            </div>
            <p className="text-[13px] font-medium text-text-tertiary">
              {filter ? "没有匹配的消息" : "暂无消息"}
            </p>
            <p className="text-[11px] mt-0.5 text-text-disabled">
              {filter ? "尝试调整过滤条件" : "连接后的收发数据将显示在这里"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-default/50">
            {filteredMessages.map((m) => {
              const displayData = m.direction === "system"
                ? m.data
                : convertFormat(m.data, m.rawHex, "ascii", displayFormat);

              return (
                <div
                  key={m.id}
                  className={cn(
                    "group flex items-start gap-2 px-3 py-1.5 hover:bg-bg-hover/50 transition-colors",
                    m.direction === "system" && "bg-amber-50/50 dark:bg-amber-500/5"
                  )}
                >
                  {/* Direction indicator */}
                  <div className="shrink-0 mt-0.5">
                    {m.direction === "sent" ? (
                      <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 px-1 py-0.5 rounded">TX</span>
                    ) : m.direction === "received" ? (
                      <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1 py-0.5 rounded">RX</span>
                    ) : (
                      <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded">SYS</span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[10px] text-text-disabled font-mono w-20 shrink-0 mt-0.5 select-none">
                    {formatTime(m.timestamp)}
                  </span>

                  {/* Data */}
                  <div className="flex-1 min-w-0">
                    <pre className={cn(
                      "text-[12px] font-mono whitespace-pre-wrap break-all select-text leading-relaxed",
                      m.direction === "sent" ? "text-blue-700 dark:text-blue-300" :
                      m.direction === "system" ? "text-amber-700 dark:text-amber-300" :
                      "text-text-primary"
                    )}>
                      {displayData}
                    </pre>
                    {/* Meta info */}
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.size > 0 && <span className="text-[9px] text-text-disabled">{formatSize(m.size)}</span>}
                      {m.remoteAddr && <span className="text-[9px] text-text-disabled">{m.direction === "received" ? "← " : "→ "}{m.remoteAddr}</span>}
                      {m.clientId && <span className="text-[9px] text-text-disabled">客户端:{m.clientId.slice(0, 8)}</span>}
                    </div>
                  </div>

                  {/* Copy button */}
                  <button
                    onClick={() => handleCopy(displayData, m.id)}
                    className="shrink-0 p-1 text-text-disabled opacity-0 group-hover:opacity-100 hover:text-accent transition-all"
                  >
                    {copiedId === m.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
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
