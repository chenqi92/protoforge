// 单元格详情弹框 — 大区域展示单元格内容 + JSON 格式化

import { useState, useCallback, useMemo } from "react";
import { X, Braces, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/common/CodeEditor";
import type { SqlValue, ColumnInfo } from "@/types/dbclient";
import { copyTextToClipboard } from "@/lib/clipboard";

interface CellDetailDialogProps {
  value: SqlValue;
  column: ColumnInfo;
  rowIndex: number;
  onClose: () => void;
}

function valueToString(value: SqlValue): string {
  switch (value.type) {
    case "Null": return "";
    case "Bool": return String(value.value);
    case "Int": case "Float": return String(value.value);
    case "Text": return value.value;
    case "Json": return typeof value.value === "string" ? value.value : JSON.stringify(value.value, null, 2);
    case "Bytes": return value.value;
    case "Timestamp": return value.value;
    case "Array": return JSON.stringify(value.value, null, 2);
  }
}

function isJsonLike(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
         (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

export function CellDetailDialog({ value, column, rowIndex, onClose }: CellDetailDialogProps) {
  const { t } = useTranslation();
  const rawText = valueToString(value);
  const isNull = value.type === "Null";
  const isJson = value.type === "Json";
  const canFormatJson = isJson || isJsonLike(rawText);

  const [formatted, setFormatted] = useState(isJson);
  const [copied, setCopied] = useState(false);

  const displayText = useMemo(() => {
    if (isNull) return "NULL";
    if (formatted && canFormatJson) {
      try {
        const parsed = typeof value.value === "string" ? JSON.parse(rawText) : (value.type === "Json" ? value.value : JSON.parse(rawText));
        return JSON.stringify(parsed, null, 2);
      } catch {
        return rawText;
      }
    }
    return rawText;
  }, [isNull, formatted, canFormatJson, rawText, value]);

  const language = formatted && canFormatJson ? "json" : "plaintext";

  const handleCopy = useCallback(() => {
    copyTextToClipboard(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [displayText]);

  const handleFormatToggle = useCallback(() => {
    setFormatted((f) => !f);
  }, []);

  return (
    <div className="fixed inset-0 z-[var(--z-modal,50)] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-col w-[680px] max-w-[90vw] h-[520px] max-h-[80vh] bg-bg-surface border border-border-default rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default/50 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="pf-text-sm font-medium text-text-primary truncate">{column.name}</span>
            <span className="pf-text-xs text-text-quaternary font-mono">{column.dataType}</span>
            <span className="pf-text-xs text-text-quaternary">#{rowIndex + 1}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canFormatJson && (
              <button
                onClick={handleFormatToggle}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 pf-rounded-sm pf-text-xs transition-colors",
                  formatted
                    ? "bg-accent/15 text-accent"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
                )}
                title={t("dbClient.formatJson")}
              >
                <Braces size={12} />
                <span>JSON</span>
              </button>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 pf-rounded-sm pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
              title={t("dbClient.copyCell")}
            >
              {copied ? <Check size={12} className="text-emerald-500 dark:text-emerald-300" /> : <Copy size={12} />}
              <span>{copied ? t("dbClient.copied") : t("dbClient.copyCell")}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 pf-rounded-sm text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-h-0">
          {isNull ? (
            <div className="flex items-center justify-center h-full">
              <span className="italic text-text-quaternary pf-text-base">NULL</span>
            </div>
          ) : (
            <CodeEditor
              value={displayText}
              language={language}
              readOnly
            />
          )}
        </div>

        {/* 底部状态 */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-border-default/50 shrink-0">
          <span className="pf-text-xs text-text-quaternary">
            {isNull ? "NULL" : `${rawText.length} ${t("dbClient.characters")}`}
          </span>
          <span className="pf-text-xs text-text-quaternary">{value.type}</span>
        </div>
      </div>
    </div>
  );
}
