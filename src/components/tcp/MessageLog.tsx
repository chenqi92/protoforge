// 消息日志组件 — 多编码显示、过滤
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, ArrowDown, Search, Copy, Check, ArrowUpRight, ArrowDownLeft, PlugZap } from "lucide-react";
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
  const hasTraffic = Boolean(
    stats && (
      stats.sentBytes > 0 ||
      stats.receivedBytes > 0 ||
      stats.sentCount > 0 ||
      stats.receivedCount > 0
    )
  );
  const isFiltering = Boolean(filter.trim());

  return (
    <div className="wb-panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="wb-panel-header shrink-0">
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
              placeholder="搜索消息"
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
              <p className="text-[14px] font-semibold text-text-secondary">没有匹配的消息</p>
              <p className="mt-1 text-[12px] text-text-tertiary">试试缩短关键词，或切换到其他显示格式后再过滤。</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 py-8">
              <div className="w-full max-w-3xl text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-border-default/70 bg-bg-primary/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <PlugZap className="h-7 w-7 text-text-disabled" />
                </div>
                <p className="text-[15px] font-semibold text-text-secondary">
                  {connected ? "已建立连接，等待首条消息" : statusText || "等待建立连接"}
                </p>
                <p className="mx-auto mt-2 max-w-xl text-[12px] leading-6 text-text-tertiary">
                  {connected
                    ? "连接已经准备就绪。发送数据后，这里会按时间顺序显示收发报文、字节统计和来源信息。"
                    : "先确认地址与端口配置，然后点击右上角连接。连接建立后，这里会成为当前会话的实时消息日志。"}
                </p>

                <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
                  <div className="wb-subpanel p-4">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                      <PlugZap className="h-3.5 w-3.5 text-blue-500" />
                      {connected ? "连接已就绪" : "确认连接参数"}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                      {connected
                        ? "当前链路已经可用，可以直接测试发送 ASCII、HEX 或 Base64 数据。"
                        : "检查主机、端口和模式是否正确，避免连到错误的目标服务或监听端口。"}
                    </div>
                  </div>

                  <div className="wb-subpanel p-4">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                      <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
                      {connected ? "发送测试报文" : "建立连接或绑定"}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                      {connected
                        ? "左侧发送面板支持定时发送、历史记录和快捷指令，适合先发一条握手或心跳消息。"
                        : "点击连接后，客户端会发起会话；服务端或 UDP 模式则会先开始监听并等待数据进入。"}
                    </div>
                  </div>

                  <div className="wb-subpanel p-4">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                      <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
                      {connected ? "观察实时日志" : "开始查看收发"}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
                      {connected
                        ? "收到的数据会按时间顺序排列；右上角可以搜索消息、切换显示格式并清空日志。"
                        : "连接建立后，这里会实时显示发送与接收的数据、大小统计以及来源地址。"}
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
