// 底部紧凑发送栏 — 内联式设计
// 参考 Packet Sender / Postman WebSocket 的底部发送栏交互
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Send, Timer, Plus, Trash2, ChevronDown,
  CornerDownLeft, X, Settings2, History,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
  onSaveQuickCommand: (command: { id?: string; name: string; data: string; format: DataFormat }) => void;
  onDeleteQuickCommand: (id: string) => void;
  onLoadQuickCommand: (cmd: QuickCommand) => void;
  sendLabel?: string;
  sendTargetLabel?: string;
  sendTargetHint?: string;
  timerEnabled: boolean;
  timerInterval: number;
  onTimerToggle: () => void;
  onTimerIntervalChange: (v: number) => void;
  appendNewline: boolean;
  onAppendNewlineChange: (v: boolean) => void;
  embedded?: boolean;
}

const FORMAT_OPTIONS: { value: DataFormat; label: string }[] = [
  { value: "ascii", label: "ASCII" },
  { value: "hex", label: "HEX" },
  { value: "base64", label: "Base64" },
];

export function SendPanel({
  message, setMessage, sendFormat, setSendFormat,
  connected, onSend,
  sendHistory, onClearHistory, onLoadHistory,
  quickCommands, onSaveQuickCommand, onDeleteQuickCommand, onLoadQuickCommand,
  sendLabel = "Send",
  sendTargetLabel,
  sendTargetHint,
  timerEnabled, timerInterval, onTimerToggle, onTimerIntervalChange,
  appendNewline, onAppendNewlineChange,
}: SendPanelProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showQuickCmds, setShowQuickCmds] = useState(true);
  const [showCommandEditor, setShowCommandEditor] = useState(false);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [commandName, setCommandName] = useState("");
  const [commandData, setCommandData] = useState("");
  const [commandFormat, setCommandFormat] = useState<DataFormat>("ascii");
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 20;
    const maxLines = 6;
    const maxHeight = lineHeight * maxLines + 16; // padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [message, autoResize]);

  // Click outside to close popovers
  useEffect(() => {
    if (!showOptions && !showHistory) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showOptions && optionsRef.current && !optionsRef.current.contains(target) && !optionsBtnRef.current?.contains(target)) {
        setShowOptions(false);
      }
      if (showHistory && historyRef.current && !historyRef.current.contains(target) && !historyBtnRef.current?.contains(target)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showOptions, showHistory]);

  const openNewQuickCommand = () => {
    setEditingCommandId(null);
    setCommandName(`${t("tcp.system.command")}${quickCommands.length + 1}`);
    setCommandData(message);
    setCommandFormat(sendFormat);
    setShowCommandEditor(true);
  };

  const openEditQuickCommand = useCallback((cmd: QuickCommand) => {
    setEditingCommandId(cmd.id);
    setCommandName(cmd.name);
    setCommandData(cmd.data);
    setCommandFormat(cmd.format);
    setShowCommandEditor(true);
  }, []);

  const closeQuickCommandEditor = () => {
    setShowCommandEditor(false);
    setEditingCommandId(null);
    setCommandName("");
    setCommandData("");
    setCommandFormat(sendFormat);
  };

  const handleSaveQuickCommand = () => {
    const nextName = commandName.trim();
    const nextData = commandData.trim();
    if (!nextName || !nextData) return;
    onSaveQuickCommand({
      id: editingCommandId ?? undefined,
      name: nextName,
      data: commandData,
      format: commandFormat,
    });
    closeQuickCommandEditor();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const byteCount = message.length > 0
    ? sendFormat === "hex"
      ? message.replace(/[\s,]/g, "").replace(/0[xX]/g, "").length / 2
      : new TextEncoder().encode(message).length
    : 0;

  return (
    <div className="wb-send-bar-wrap shrink-0">
      {/* == Quick Commands Row (collapsible) == */}
      {quickCommands.length > 0 && showQuickCmds && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-default/50">
          <span className="text-[var(--fs-3xs)] font-semibold uppercase tracking-wider text-text-disabled shrink-0">
            {t('tcp.sendPanel.quickCommands')}
          </span>
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            {quickCommands.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => onLoadQuickCommand(cmd)}
                onContextMenu={(e) => { e.preventDefault(); openEditQuickCommand(cmd); }}
                className="group inline-flex items-center gap-1 shrink-0 rounded-[8px] border border-border-default/70 bg-bg-secondary/50 px-2 py-1 text-[var(--fs-xxs)] font-medium text-text-secondary transition-all hover:border-accent/40 hover:bg-accent/5 hover:text-text-primary"
                title={`${cmd.name} (${cmd.format.toUpperCase()}) - ${t('tcp.sendPanel.rightClickEdit')}`}
              >
                <CornerDownLeft className="h-2.5 w-2.5 shrink-0 text-text-disabled group-hover:text-accent" />
                <span className="truncate max-w-[80px]">{cmd.name}</span>
              </button>
            ))}
          </div>
          <button
            onClick={openNewQuickCommand}
            className="rounded-[8px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent shrink-0"
            title={t("tcp.sendPanel.addCommand")}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={() => setShowQuickCmds(false)}
            className="rounded-[8px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary shrink-0"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* == Main Send Row == */}
      <div className="flex items-end gap-2 px-3 py-2">
        {/* Format selector */}
        <div className="wb-tool-segment shrink-0 self-end">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSendFormat(opt.value)}
              className={cn("!h-7 !px-2 !text-[var(--fs-xxs)]", sendFormat === opt.value && "is-active")}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Textarea input */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sendFormat === "hex"
                ? t('tcp.sendPanel.hexPlaceholder')
                : sendFormat === "base64"
                  ? t('tcp.sendPanel.base64Placeholder')
                  : t('tcp.sendPanel.textPlaceholder')
            }
            disabled={!connected}
            rows={1}
            className={cn(
              "wb-send-bar-input w-full resize-none rounded-[10px] border border-border-default bg-bg-input/85 px-3 py-1.5 text-[var(--fs-sm)] font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled",
              "focus:border-accent focus:ring-2 focus:ring-accent/20",
              "disabled:cursor-not-allowed disabled:opacity-45"
            )}
            style={{ minHeight: "36px", maxHeight: "136px" }}
          />
          {byteCount > 0 && (
            <span className="absolute bottom-1.5 right-2.5 text-[var(--fs-3xs)] text-text-disabled pointer-events-none">
              {Math.floor(byteCount)} {t('tcp.sendPanel.bytes')}
            </span>
          )}
        </div>

        {/* Action buttons group */}
        <div className="flex items-center gap-1 shrink-0 self-end">
          {/* Quick commands toggle (if hidden) */}
          {quickCommands.length > 0 && !showQuickCmds && (
            <button
              onClick={() => setShowQuickCmds(true)}
              className="wb-icon-btn !w-7 !h-7"
              title={t('tcp.sendPanel.quickCommands')}
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </button>
          )}

          {/* History button */}
          {sendHistory.length > 0 && (
            <div className="relative">
              <button
                ref={historyBtnRef}
                onClick={() => { setShowHistory(!showHistory); setShowOptions(false); }}
                className={cn("wb-icon-btn !w-7 !h-7", showHistory && "bg-bg-hover text-accent")}
                title={t('tcp.sendPanel.sendHistory')}
              >
                <History className="h-3.5 w-3.5" />
              </button>
              {showHistory && (
                <div
                  ref={historyRef}
                  className="absolute bottom-full right-0 mb-2 w-[320px] rounded-[12px] border border-border-default bg-bg-primary shadow-lg overflow-hidden z-30"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border-default/60">
                    <span className="text-[var(--fs-xxs)] font-semibold text-text-secondary">
                      {t('tcp.sendPanel.sendHistory')} ({sendHistory.length})
                    </span>
                    <button
                      onClick={() => { onClearHistory(); setShowHistory(false); }}
                      className="rounded-[8px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto py-1">
                    {sendHistory.slice(0, 20).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { onLoadHistory(item); setShowHistory(false); }}
                        className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
                      >
                        <span className="w-8 shrink-0 text-[var(--fs-3xs)] font-bold uppercase text-text-disabled">{item.format}</span>
                        <span className="flex-1 truncate font-mono text-[var(--fs-xs)] text-text-secondary">{item.data}</span>
                        <span className="shrink-0 text-[var(--fs-3xs)] text-text-disabled opacity-0 group-hover:opacity-100">
                          {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Options button (timer, newline, etc.) */}
          <div className="relative">
            <button
              ref={optionsBtnRef}
              onClick={() => { setShowOptions(!showOptions); setShowHistory(false); }}
              className={cn(
                "wb-icon-btn !w-7 !h-7",
                showOptions && "bg-bg-hover text-accent",
                (timerEnabled || appendNewline) && "text-accent"
              )}
              title={t('tcp.sendPanel.sendOptions') || 'Options'}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            {showOptions && (
              <div
                ref={optionsRef}
                className="absolute bottom-full right-0 mb-2 w-[240px] rounded-[12px] border border-border-default bg-bg-primary shadow-lg overflow-hidden z-30"
              >
                <div className="p-3 space-y-3">
                  {/* Send target info */}
                  {sendTargetLabel && (
                    <div className="rounded-[8px] border border-border-default/60 bg-bg-secondary/30 px-2.5 py-2">
                      <div className="text-[var(--fs-3xs)] font-semibold uppercase tracking-wider text-text-disabled">
                        {t("tcp.sendPanel.currentTarget")}
                      </div>
                      <div className="mt-0.5 text-[var(--fs-xs)] font-medium text-text-primary truncate">{sendTargetLabel}</div>
                      {sendTargetHint && (
                        <div className="mt-0.5 text-[var(--fs-3xs)] text-text-disabled">{sendTargetHint}</div>
                      )}
                    </div>
                  )}

                  {/* Append newline */}
                  <label className="group flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={appendNewline}
                      onChange={(e) => onAppendNewlineChange(e.target.checked)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
                    />
                    <span className="text-[var(--fs-xs)] text-text-secondary transition-colors group-hover:text-text-primary">
                      {t('tcp.sendPanel.appendNewline')}
                    </span>
                  </label>

                  {/* Timer */}
                  <div className="space-y-2">
                    <label className="group flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={timerEnabled}
                        onChange={onTimerToggle}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
                      />
                      <span className="text-[var(--fs-xs)] text-text-secondary transition-colors group-hover:text-text-primary">
                        {t('tcp.sendPanel.timedSend')}
                      </span>
                    </label>
                    {timerEnabled && (
                      <div className="flex items-center gap-1.5 pl-5">
                        <input
                          type="number"
                          value={timerInterval}
                          onChange={(e) => onTimerIntervalChange(Math.max(100, parseInt(e.target.value) || 1000))}
                          className="h-7 w-[76px] rounded-[9px] border border-border-default bg-bg-input px-2 text-center text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent"
                          min={100}
                          step={100}
                        />
                        <span className="text-[var(--fs-xxs)] text-text-disabled">ms</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={onSend}
            disabled={!connected || !message.trim()}
            className={cn(
              "wb-primary-btn !h-[36px] min-w-[72px] px-3 bg-accent",
              "hover:bg-accent-hover disabled:cursor-not-allowed disabled:hover:bg-accent"
            )}
          >
            <Send className="h-3.5 w-3.5" />
            {sendLabel}
            {timerEnabled && <Timer className="ml-0.5 h-3 w-3 opacity-60" />}
          </button>
        </div>
      </div>

      {/* == Quick Command Editor Modal == */}
      {showCommandEditor ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={closeQuickCommandEditor}>
          <div
            className="w-[420px] rounded-[14px] border border-border-default bg-bg-primary shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default/60">
              <div className="flex items-center gap-2">
                <CornerDownLeft className="w-4 h-4 text-accent" />
                <span className="text-[var(--fs-sm)] font-semibold text-text-primary">
                  {editingCommandId ? t("tcp.sendPanel.editCommand") : t("tcp.sendPanel.addCommand")}
                </span>
              </div>
              <button onClick={closeQuickCommandEditor} className="p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="mb-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t("tcp.sendPanel.commandName")}
                </div>
                <input
                  value={commandName}
                  onChange={(e) => setCommandName(e.target.value)}
                  className="wb-field w-full"
                  placeholder={t("tcp.sendPanel.commandName")}
                  autoFocus
                />
              </div>

              <div>
                <div className="mb-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t("tcp.sendPanel.sendFormat")}
                </div>
                <div className="wb-tool-segment">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setCommandFormat(opt.value)}
                      className={cn("flex-1", commandFormat === opt.value && "is-active")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t("tcp.sendPanel.commandContent")}
                </div>
                <textarea
                  value={commandData}
                  onChange={(e) => setCommandData(e.target.value)}
                  className="min-h-[120px] w-full resize-none rounded-[12px] border border-border-default bg-bg-input/85 p-3 text-[var(--fs-sm)] font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder={t("tcp.sendPanel.placeholder")}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default/60">
              {editingCommandId && (
                <button
                  onClick={() => {
                    onDeleteQuickCommand(editingCommandId);
                    closeQuickCommandEditor();
                  }}
                  className="wb-ghost-btn px-3 text-red-500 hover:bg-red-500/8 mr-auto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("contextMenu.delete")}
                </button>
              )}
              <button onClick={closeQuickCommandEditor} className="wb-ghost-btn px-3">
                {t("tcp.sendPanel.cancelCommand")}
              </button>
              <button
                onClick={handleSaveQuickCommand}
                disabled={!commandName.trim() || !commandData.trim()}
                className="wb-primary-btn bg-accent hover:bg-accent-hover disabled:hover:bg-accent"
              >
                {t("tcp.sendPanel.saveCommand")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
