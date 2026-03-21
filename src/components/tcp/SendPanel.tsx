// 发送面板组件 — 编码选择、定时发送、发送控制
import { useState, useRef } from "react";
import { Send, Timer, Plus, Trash2, ChevronDown, RotateCcw, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataFormat, SendHistoryItem, QuickCommand } from "@/types/tcp";

interface SendPanelProps {
  message: string;
  setMessage: (v: string) => void;
  sendFormat: DataFormat;
  setSendFormat: (v: DataFormat) => void;
  connected: boolean;
  onSend: () => void;
  sendHistory: SendHistoryItem[];
  onClearHistory: () => void;
  onLoadHistory: (item: SendHistoryItem) => void;
  quickCommands: QuickCommand[];
  onAddQuickCommand: () => void;
  onDeleteQuickCommand: (id: string) => void;
  onLoadQuickCommand: (cmd: QuickCommand) => void;
  sendLabel?: string;
  timerEnabled: boolean;
  timerInterval: number;
  onTimerToggle: () => void;
  onTimerIntervalChange: (v: number) => void;
  appendNewline: boolean;
  onAppendNewlineChange: (v: boolean) => void;
}

const FORMAT_OPTIONS: { value: DataFormat; label: string; desc: string }[] = [
  { value: "ascii", label: "ASCII", desc: "文本" },
  { value: "hex", label: "HEX", desc: "十六进制" },
  { value: "base64", label: "Base64", desc: "编码" },
];

export function SendPanel({
  message, setMessage, sendFormat, setSendFormat,
  connected, onSend,
  sendHistory, onClearHistory, onLoadHistory,
  quickCommands, onAddQuickCommand, onDeleteQuickCommand, onLoadQuickCommand,
  sendLabel = "发送",
  timerEnabled, timerInterval, onTimerToggle, onTimerIntervalChange,
  appendNewline, onAppendNewlineChange,
}: SendPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="wb-panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="wb-panel-header shrink-0">
        <div>
          <div className="text-[12px] font-semibold text-text-primary">发送面板</div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">
            {connected ? "准备发送数据" : "连接后可发送数据"}
          </div>
        </div>
        <span className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-semibold",
          connected ? "bg-emerald-500/10 text-emerald-600" : "bg-bg-secondary text-text-tertiary"
        )}>
          {connected ? "在线" : "离线"}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-center gap-1 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">发送格式</span>
          </div>
          <div className="wb-tool-segment">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSendFormat(opt.value)}
                className={cn("flex-1", sendFormat === opt.value && "is-active")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="wb-subpanel flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
          <label className="flex items-center gap-1.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={appendNewline}
              onChange={(e) => onAppendNewlineChange(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
            />
            <span className="text-[11px] text-text-tertiary transition-colors group-hover:text-text-secondary">
              追加换行
            </span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={timerEnabled}
              onChange={onTimerToggle}
              className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
            />
            <span className="text-[11px] text-text-tertiary transition-colors group-hover:text-text-secondary">
              定时发送
            </span>
          </label>

          {timerEnabled ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={timerInterval}
                onChange={(e) => onTimerIntervalChange(Math.max(100, parseInt(e.target.value) || 1000))}
                className="h-7 w-[76px] rounded-[10px] border border-border-default bg-bg-input px-2 text-center text-[11px] font-mono text-text-primary outline-none focus:border-accent"
                min={100}
                step={100}
              />
              <span className="text-[10px] text-text-disabled">ms</span>
            </div>
          ) : null}
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sendFormat === "hex"
                ? "输入十六进制数据，如 48 65 6C 6C 6F"
                : sendFormat === "base64"
                  ? "输入 Base64 编码数据"
                  : "输入发送内容，Enter 发送，Shift+Enter 换行"
            }
            disabled={!connected}
            className={cn(
              "min-h-[120px] max-h-[180px] w-full resize-y rounded-[16px] border border-border-default bg-bg-input/85 p-3 text-[12px] font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled",
              "focus:border-accent focus:ring-2 focus:ring-accent/20",
              "disabled:cursor-not-allowed disabled:opacity-45"
            )}
          />
          {message.length > 0 ? (
            <div className="absolute bottom-2 right-3 text-[9px] text-text-disabled">
              {sendFormat === "hex"
                ? `${message.replace(/[\s,]/g, "").replace(/0[xX]/g, "").length / 2} 字节`
                : `${new TextEncoder().encode(message).length} 字节`
              }
            </div>
          ) : null}
        </div>

        <button
          onClick={onSend}
          disabled={!connected || !message.trim()}
          className={cn(
            "wb-primary-btn flex h-8 w-full items-center justify-center gap-1.5 rounded-[11px] text-[12px] font-semibold text-white transition-all",
            "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700",
            "shadow-sm hover:shadow-md active:scale-[0.98]",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:from-blue-500 disabled:hover:to-indigo-600"
          )}
        >
          <Send className="h-3.5 w-3.5" />
          {sendLabel}
          {timerEnabled ? <Timer className="ml-0.5 h-3 w-3 opacity-60" /> : null}
        </button>

        {quickCommands.length > 0 ? (
          <div className="border-t border-border-default/70 pt-3">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">快捷指令</span>
              <button
                onClick={onAddQuickCommand}
                className="rounded-[10px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickCommands.map((cmd) => (
                <div key={cmd.id} className="group relative">
                  <button
                    onClick={() => onLoadQuickCommand(cmd)}
                    className="inline-flex items-center gap-1 rounded-[12px] border border-border-default bg-bg-secondary/70 px-2.5 py-1.5 text-[10px] font-medium text-text-secondary transition-all hover:border-accent/30 hover:bg-bg-hover"
                  >
                    <CornerDownLeft className="h-2.5 w-2.5 text-text-disabled" />
                    {cmd.name}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteQuickCommand(cmd.id); }}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {sendHistory.length > 0 ? (
          <div className="border-t border-border-default/70 pt-3">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary transition-colors hover:text-text-secondary"
              >
                <RotateCcw className="h-3 w-3" />
                发送历史 ({sendHistory.length})
                <ChevronDown className={cn("h-3 w-3 transition-transform", showHistory && "rotate-180")} />
              </button>
              <button
                onClick={onClearHistory}
                className="rounded-[10px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {showHistory ? (
              <div className="max-h-[140px] space-y-1 overflow-y-auto">
                {sendHistory.slice(0, 20).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onLoadHistory(item)}
                    className="group flex w-full items-center gap-2 rounded-[12px] px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
                  >
                    <span className="w-8 shrink-0 text-[9px] font-bold uppercase text-text-disabled">{item.format}</span>
                    <span className="flex-1 truncate font-mono text-[11px] text-text-secondary">{item.data}</span>
                    <span className="shrink-0 text-[9px] text-text-disabled opacity-0 transition-opacity group-hover:opacity-100">
                      {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
