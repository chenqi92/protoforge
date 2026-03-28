import { useMemo, useState } from "react";
import { Check, Copy, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { convertFormat, estimateRawHex } from "@/services/tcpService";
import type { DataFormat, TcpMessage } from "@/types/tcp";

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

export function MessageDetailPanel({ message, displayFormat, compact = false }: MessageDetailPanelProps) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<"payload" | "raw" | null>(null);
  const messageDirectionLabel = message
    ? (message.direction === "sent"
      ? t("tcp.messageLog.sent", "发送")
      : message.direction === "received"
        ? t("tcp.messageLog.received", "接收")
        : t("tcp.messageLog.system", "系统"))
    : "";

  const derived = useMemo(() => {
    if (!message) {
      return {
        rendered: "",
        rawHex: "",
      };
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
          <span className="text-[var(--fs-sm)] font-semibold text-text-primary">
            {t("tcp.messageDetail.title", "消息详情")}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-text-disabled">
          <div>
            <div className="text-[var(--fs-md)] font-semibold text-text-secondary">
              {t("tcp.messageDetail.emptyTitle", "选中一条消息查看详情")}
            </div>
            <p className="mt-2 text-[var(--fs-sm)] leading-6 text-text-tertiary">
              {t("tcp.messageDetail.emptyDesc", "这里会展示完整载荷、原始十六进制、时间戳以及来源地址，便于逐帧分析协议数据。")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="wb-pane-header shrink-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              "rounded-[var(--radius-sm)] px-2 py-0.5 text-[var(--fs-3xs)] font-bold uppercase",
              message.direction === "sent"
                ? "bg-blue-500/10 text-blue-600"
                : message.direction === "received"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-600"
            )}>
              {messageDirectionLabel}
            </span>
            <span className="truncate text-[var(--fs-sm)] font-semibold text-text-primary">
              {t("tcp.messageDetail.title", "消息详情")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[var(--fs-xs)] text-text-tertiary">
            <span>{formatTime(message.timestamp)}</span>
            {message.size > 0 ? <span>{message.size} B</span> : null}
            {message.remoteAddr ? <span>{message.remoteAddr}</span> : null}
            {message.clientId ? <span>{t("tcp.messageLog.client", "客户端")}: {message.clientId.slice(0, 8)}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void copyValue(derived.rendered, "payload")}
            className="wb-icon-btn !h-7 !w-7"
            title={t("tcp.messageDetail.copyPayload", "复制当前内容")}
          >
            {copiedKey === "payload" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {message.direction !== "system" ? (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("parse-protocol", { detail: { data: message.data } }))}
              className="wb-icon-btn !h-7 !w-7"
              title={t("parser.parse", "解析")}
            >
              <FileCode2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn(
        "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3",
        !compact && "xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]"
      )}>
        <section className="wb-subpanel flex min-h-[220px] flex-col overflow-hidden">
          <div className="wb-pane-header shrink-0">
            <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
              {t("tcp.messageDetail.payload", "解码内容")}
            </span>
            <span className="rounded-[var(--radius-sm)] bg-bg-primary/70 px-2 py-0.5 text-[var(--fs-3xs)] font-semibold uppercase tracking-wide text-text-tertiary">
              {displayFormat === "auto" ? t("tcp.messageLog.auto", "Auto") : displayFormat.toUpperCase()}
            </span>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-bg-primary/50 p-3 font-mono text-[var(--fs-sm)] leading-6 text-text-primary">
            {derived.rendered || " "}
          </pre>
        </section>

        <section className="wb-subpanel flex min-h-[220px] flex-col overflow-hidden">
          <div className="wb-pane-header shrink-0">
            <span className="text-[var(--fs-xs)] font-semibold text-text-secondary">
              {t("tcp.messageDetail.rawHex", "原始 HEX")}
            </span>
            <button
              onClick={() => void copyValue(derived.rawHex, "raw")}
              className="wb-icon-btn !h-7 !w-7"
              title={t("tcp.messageDetail.copyRawHex", "复制原始 HEX")}
            >
              {copiedKey === "raw" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-bg-primary/50 p-3 font-mono text-[var(--fs-xs)] leading-6 text-text-secondary">
            {normalizeHexBlocks(derived.rawHex) || " "}
          </pre>
        </section>
      </div>
    </div>
  );
}
