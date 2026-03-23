// 发送面板组件 — 编码选择、定时发送、发送控制
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Send, Timer, Plus, Trash2, ChevronDown, RotateCcw, CornerDownLeft, Pencil, X } from "lucide-react";
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
  embedded = false,
}: SendPanelProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCommandEditor, setShowCommandEditor] = useState(false);
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [commandName, setCommandName] = useState("");
  const [commandData, setCommandData] = useState("");
  const [commandFormat, setCommandFormat] = useState<DataFormat>("ascii");

  const openNewQuickCommand = () => {
    setEditingCommandId(null);
    setCommandName(`${t("tcp.system.command")}${quickCommands.length + 1}`);
    setCommandData(message);
    setCommandFormat(sendFormat);
    setShowCommandEditor(true);
  };

  const openEditQuickCommand = (cmd: QuickCommand) => {
    setEditingCommandId(cmd.id);
    setCommandName(cmd.name);
    setCommandData(cmd.data);
    setCommandFormat(cmd.format);
    setShowCommandEditor(true);
  };

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

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", !embedded && "wb-panel")}>
      <div className={cn("shrink-0", embedded ? "wb-pane-header" : "wb-panel-header")}>
        <div className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('tcp.sendPanel.title')}</div>
        <span className={cn(
          "rounded-[8px] px-2.5 py-1 text-[var(--fs-xxs)] font-semibold",
          connected ? "bg-emerald-500/10 text-emerald-600" : "bg-bg-secondary text-text-tertiary"
        )}>
          {connected ? t('tcp.sendPanel.online') : t('tcp.sendPanel.offline')}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="flex min-h-full flex-col gap-3">
          <div>
            <div className="mb-1.5 flex items-center gap-1 px-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">{t('tcp.sendPanel.sendFormat')}</span>
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-border-default/65 bg-bg-secondary/26 px-3 py-2.5">
            <label className="group flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={appendNewline}
                onChange={(e) => onAppendNewlineChange(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
              />
              <span className="text-[var(--fs-xs)] text-text-tertiary transition-colors group-hover:text-text-secondary">
                {t('tcp.sendPanel.appendNewline')}
              </span>
            </label>

            <label className="group flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={timerEnabled}
                onChange={onTimerToggle}
                className="h-3.5 w-3.5 cursor-pointer rounded border-border-default text-accent focus:ring-accent/30"
              />
              <span className="text-[var(--fs-xs)] text-text-tertiary transition-colors group-hover:text-text-secondary">
                {t('tcp.sendPanel.timedSend')}
              </span>
            </label>

            {timerEnabled ? (
              <div className="flex items-center gap-1.5">
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
            ) : null}
          </div>

          {sendTargetLabel ? (
            <div className="rounded-[10px] border border-border-default/65 bg-bg-secondary/26 px-3 py-2.5">
              <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">
                {t("tcp.sendPanel.currentTarget")}
              </div>
              <div className="mt-1 text-[var(--fs-sm)] font-medium text-text-primary">{sendTargetLabel}</div>
              {sendTargetHint ? (
                <div className="mt-1 text-[var(--fs-xs)] text-text-tertiary">{sendTargetHint}</div>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-h-[188px] flex-1 flex-col">
            <div className="relative flex min-h-[188px] flex-1">
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
                className={cn(
                  "h-full min-h-[188px] w-full flex-1 resize-none rounded-[12px] border border-border-default bg-bg-input/85 p-3 text-[var(--fs-sm)] font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled",
                  "focus:border-accent focus:ring-2 focus:ring-accent/20",
                  "disabled:cursor-not-allowed disabled:opacity-45"
                )}
              />
              {message.length > 0 ? (
                <div className="absolute bottom-2 right-3 text-[var(--fs-3xs)] text-text-disabled">
                  {sendFormat === "hex"
                    ? `${message.replace(/[\s,]/g, "").replace(/0[xX]/g, "").length / 2} ${t('tcp.sendPanel.bytes')}`
                    : `${new TextEncoder().encode(message).length} ${t('tcp.sendPanel.bytes')}`
                  }
                </div>
              ) : null}
            </div>

            <button
              onClick={onSend}
              disabled={!connected || !message.trim()}
              className={cn(
                "wb-primary-btn mt-3 flex h-8 w-full items-center justify-center gap-1.5 bg-accent",
                "hover:bg-accent-hover disabled:cursor-not-allowed disabled:hover:bg-accent"
              )}
            >
              <Send className="h-3.5 w-3.5" />
              {sendLabel}
              {timerEnabled ? <Timer className="ml-0.5 h-3 w-3 opacity-60" /> : null}
            </button>
          </div>

          <div className="border-t border-border-default/70 pt-3">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <div>
                <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary">{t('tcp.sendPanel.quickCommands')}</div>
                <div className="mt-0.5 text-[var(--fs-xxs)] text-text-disabled">{t("tcp.sendPanel.newCommandHint")}</div>
              </div>
              <button
                onClick={openNewQuickCommand}
                className="rounded-[10px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
                title={t("tcp.sendPanel.addCommand")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

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

            {quickCommands.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {quickCommands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center gap-1.5 rounded-[10px] border border-border-default bg-bg-secondary/70 px-1.5 py-1">
                    <button
                      onClick={() => onLoadQuickCommand(cmd)}
                      className="inline-flex min-w-0 items-center gap-1 rounded-[8px] px-1.5 py-1 text-[var(--fs-xxs)] font-medium text-text-secondary transition-all hover:bg-bg-hover hover:text-text-primary"
                    >
                      <CornerDownLeft className="h-2.5 w-2.5 shrink-0 text-text-disabled" />
                      <span className="truncate">{cmd.name}</span>
                    </button>
                    <button
                      onClick={() => openEditQuickCommand(cmd)}
                      className="flex h-6 w-6 items-center justify-center rounded-[8px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
                      title={t("tcp.sendPanel.editCommand")}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => onDeleteQuickCommand(cmd.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-[8px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-red-500"
                      title={t("contextMenu.delete")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={openNewQuickCommand}
                className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-border-default px-3 py-3 text-[var(--fs-xs)] font-medium text-text-tertiary transition-colors hover:border-accent hover:bg-bg-hover/60 hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("tcp.sendPanel.quickCommandEmpty")}
              </button>
            )}
          </div>

          {sendHistory.length > 0 ? (
            <div className="border-t border-border-default/70 pt-3">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wider text-text-tertiary transition-colors hover:text-text-secondary"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('tcp.sendPanel.sendHistory')} ({sendHistory.length})
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
                      className="group flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
                    >
                      <span className="w-8 shrink-0 text-[var(--fs-3xs)] font-bold uppercase text-text-disabled">{item.format}</span>
                      <span className="flex-1 truncate font-mono text-[var(--fs-xs)] text-text-secondary">{item.data}</span>
                      <span className="shrink-0 text-[var(--fs-3xs)] text-text-disabled opacity-0 transition-opacity group-hover:opacity-100">
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
