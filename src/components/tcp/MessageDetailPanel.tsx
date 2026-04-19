import { useMemo, useState } from "react";
import { Check, Copy, FileCode2, FileText, Binary } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { convertFormat, estimateRawHex } from "@/services/tcpService";
import type { DataFormat, TcpMessage } from "@/types/tcp";
import { ProtocolParserPanel } from "@/components/plugins/ProtocolParserPanel";

type DetailTab = "payload" | "hex" | "protocol";

interface MessageDetailPanelProps {
  message: TcpMessage | null;
  displayFormat: DataFormat;
  compact?: boolean;
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return ts;
  }
}

function normalizeHexBlocks(rawHex: string): string {
  return rawHex
    .split(" ")
    .reduce<string[]>((rows, chunk, index) => {
      const rowIndex = Math.floor(index / 16);
      if (!rows[rowIndex]) rows[rowIndex] = "";
      rows[rowIndex] += `${rows[rowIndex] ? " " : ""}${chunk}`;
      return rows;
    }, [])
    .join("\n");
}

const TAB_ITEMS: { key: DetailTab; icon: typeof FileText; labelKey: string; fallback: string }[] = [
  { key: "payload", icon: FileText, labelKey: "tcp.messageDetail.payload", fallback: "原始报文" },
  { key: "hex", icon: Binary, labelKey: "tcp.messageDetail.rawHex", fallback: "HEX" },
  { key: "protocol", icon: FileCode2, labelKey: "tcp.messageDetail.protocolParse", fallback: "协议解析" },
];

export function MessageDetailPanel({ message, displayFormat, compact: _compact = false }: MessageDetailPanelProps) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<"payload" | "raw" | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("payload");

  const messageDirectionLabel = message
    ? (message.direction === "sent"
      ? t("tcp.messageLog.sent", "发送")
      : message.direction === "received"
        ? t("tcp.messageLog.received", "接收")
        : t("tcp.messageLog.system", "系统"))
    : "";

  const derived = useMemo(() => {
    if (!message) {
      return { rendered: "", rawHex: "" };
    }
    const rendered = message.direction === "system"
      ? message.data
      : convertFormat(message.data, message.rawHex, displayFormat);
    const fallbackFormat: DataFormat = message.encoding === "hex"
      ? "hex"
      : message.encoding === "base64"
        ? "base64"
        : message.encoding === "gbk"
          ? "gbk"
          : "text";
    const rawHex = message.rawHex || estimateRawHex(message.data, fallbackFormat);
    return { rendered, rawHex };
  }, [displayFormat, message]);

  const copyValue = async (value: string, key: "payload" | "raw") => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  if (!message) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="wb-pane-header shrink-0">
          <span className="pf-text-sm font-semibold text-text-primary">
            {t("tcp.messageDetail.title", "消息详情")}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-text-disabled">
          <div>
            <div className="pf-text-md font-semibold text-text-secondary">
              {t("tcp.messageDetail.emptyTitle", "选中一条消息查看详情")}
            </div>
            <p className="mt-2 pf-text-sm leading-6 text-text-tertiary">
              {t("tcp.messageDetail.emptyDesc", "这里会展示完整载荷、原始十六进制、时间戳以及来源地址，便于逐帧分析协议数据。")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="wb-pane-header shrink-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              "pf-rounded-sm px-2 py-0.5 pf-text-3xs font-bold uppercase",
              message.direction === "sent"
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
                : message.direction === "received"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-300"
            )}>
              {messageDirectionLabel}
            </span>
            <span className="truncate pf-text-sm font-semibold text-text-primary">
              {t("tcp.messageDetail.title", "消息详情")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 pf-text-xs text-text-tertiary">
            <span>{formatTime(message.timestamp)}</span>
            {message.size > 0 ? <span>{message.size} B</span> : null}
            {message.remoteAddr ? <span>{message.remoteAddr}</span> : null}
            {message.clientId ? <span>{t("tcp.messageLog.client", "客户端")}: {message.clientId.slice(0, 8)}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {activeTab === "payload" && (
            <button
              onClick={() => void copyValue(derived.rendered, "payload")}
              className="wb-icon-btn !h-7 !w-7"
              title={t("tcp.messageDetail.copyPayload", "复制当前内容")}
            >
              {copiedKey === "payload" ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          {activeTab === "hex" && (
            <button
              onClick={() => void copyValue(derived.rawHex, "raw")}
              className="wb-icon-btn !h-7 !w-7"
              title={t("tcp.messageDetail.copyRawHex", "复制原始 HEX")}
            >
              {copiedKey === "raw" ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          {message.direction !== "system" && activeTab !== "protocol" && (
            <button
              onClick={() => setActiveTab("protocol")}
              className="wb-icon-btn !h-7 !w-7"
              title={t("parser.parse", "解析")}
            >
              <FileCode2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border-default/60 px-3">
        {TAB_ITEMS.map(({ key, icon: Icon, labelKey, fallback }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 pf-text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === key
                ? "border-accent text-accent"
                : "border-transparent text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey, fallback)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "payload" && (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-3 font-mono pf-text-sm leading-6 text-text-primary">
            {derived.rendered || " "}
          </pre>
        )}

        {activeTab === "hex" && (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-3 font-mono pf-text-xs leading-6 text-text-secondary">
            {normalizeHexBlocks(derived.rawHex) || " "}
          </pre>
        )}

        {activeTab === "protocol" && (
          <ProtocolParserPanel
            key={message.id}
            initialData={message.data}
            compact
          />
        )}
      </div>
    </div>
  );
}
