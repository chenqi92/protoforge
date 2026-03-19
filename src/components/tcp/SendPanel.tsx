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
  // 定时发送
  timerEnabled: boolean;
  timerInterval: number;
  onTimerToggle: () => void;
  onTimerIntervalChange: (v: number) => void;
  // 追加选项
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
    <div className="flex flex-col gap-2">
      {/* ── 发送编码选择 ── */}
      <div>
        <div className="flex items-center gap-1 px-1 pb-1.5">
          <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">发送格式</span>
        </div>
        <div className="flex items-center gap-0.5 bg-bg-secondary/80 p-0.5 rounded-lg">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSendFormat(opt.value)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium rounded-md transition-all",
                sendFormat === opt.value
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 选项 ── */}
      <div className="flex items-center gap-3 px-1">
        <label className="flex items-center gap-1.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={appendNewline}
            onChange={(e) => onAppendNewlineChange(e.target.checked)}
            className="w-3 h-3 rounded border-border-default text-accent focus:ring-accent/30 cursor-pointer"
          />
          <span className="text-[11px] text-text-tertiary group-hover:text-text-secondary transition-colors">
            追加换行
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={timerEnabled}
            onChange={onTimerToggle}
            className="w-3 h-3 rounded border-border-default text-accent focus:ring-accent/30 cursor-pointer"
          />
          <span className="text-[11px] text-text-tertiary group-hover:text-text-secondary transition-colors">
            定时发送
          </span>
        </label>
        {timerEnabled && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={timerInterval}
              onChange={(e) => onTimerIntervalChange(Math.max(100, parseInt(e.target.value) || 1000))}
              className="w-16 h-5 px-1.5 text-[11px] font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent text-center"
              min={100}
              step={100}
            />
            <span className="text-[10px] text-text-disabled">ms</span>
          </div>
        )}
      </div>

      {/* ── 发送输入区 ── */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            sendFormat === "hex"
              ? "输入十六进制数据 (48 65 6C 6C 6F 或 0x48,0x65)..."
              : sendFormat === "base64"
                ? "输入 Base64 编码数据..."
                : "输入发送内容... (Enter 发送, Shift+Enter 换行)"
          }
          disabled={!connected}
          className={cn(
            "w-full min-h-[72px] max-h-[160px] p-3 text-[12px] font-mono bg-bg-input border border-border-default rounded-lg",
            "focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all outline-none resize-y",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "placeholder:text-text-disabled"
          )}
        />
        {/* Char count hint */}
        {message.length > 0 && (
          <div className="absolute bottom-2 right-2 text-[9px] text-text-disabled">
            {sendFormat === "hex"
              ? `${message.replace(/[\s,]/g, "").replace(/0[xX]/g, "").length / 2} 字节`
              : `${new TextEncoder().encode(message).length} 字节`
            }
          </div>
        )}
      </div>

      {/* ── 发送按钮行 ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSend}
          disabled={!connected || !message.trim()}
          className={cn(
            "flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold text-white transition-all",
            "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-blue-500 disabled:hover:to-indigo-600",
            "active:scale-[0.97] shadow-sm hover:shadow-md"
          )}
        >
          <Send className="w-3.5 h-3.5" />
          {sendLabel}
          {timerEnabled && <Timer className="w-3 h-3 ml-0.5 opacity-60" />}
        </button>
      </div>

      {/* ── 快捷指令 ── */}
      {quickCommands.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">快捷指令</span>
            <button
              onClick={onAddQuickCommand}
              className="text-text-disabled hover:text-accent transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {quickCommands.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => onLoadQuickCommand(cmd)}
                className="group relative inline-flex items-center gap-1 px-2 py-1 bg-bg-secondary border border-border-default rounded-md text-[10px] font-medium text-text-secondary hover:bg-bg-hover hover:border-accent/30 transition-all"
              >
                <CornerDownLeft className="w-2.5 h-2.5 text-text-disabled" />
                {cmd.name}
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteQuickCommand(cmd.id); }}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white items-center justify-center text-[8px] hidden group-hover:flex"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 发送历史 ── */}
      {sendHistory.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-1 pb-1">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              发送历史 ({sendHistory.length})
              <ChevronDown className={cn("w-3 h-3 transition-transform", showHistory && "rotate-180")} />
            </button>
            <button
              onClick={onClearHistory}
              className="text-text-disabled hover:text-red-500 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {showHistory && (
            <div className="max-h-[120px] overflow-y-auto space-y-0.5">
              {sendHistory.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onLoadHistory(item)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-bg-hover transition-colors group"
                >
                  <span className="text-[9px] font-bold text-text-disabled w-8 shrink-0 uppercase">{item.format}</span>
                  <span className="text-[11px] font-mono text-text-secondary truncate flex-1">{item.data}</span>
                  <span className="text-[9px] text-text-disabled shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
