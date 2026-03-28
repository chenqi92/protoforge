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
import { measurePayloadSize } from "@/services/tcpService";
import type { DataFormat, SendHistoryItem, QuickCommand, LineEnding } from "@/types/tcp";

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
  lineEnding: LineEnding;
  onLineEndingChange: (v: LineEnding) => void;
  embedded?: boolean;
  layout?: "bottom" | "sidebar";
  compact?: boolean;
}

const SEND_FORMAT_OPTIONS: { value: DataFormat; labelKey: string; fallback: string }[] = [
  { value: "text", labelKey: "tcp.sendPanel.formatText", fallback: "Text (UTF-8)" },
  { value: "hex", labelKey: "tcp.sendPanel.formatHex", fallback: "HEX / Binary" },
  { value: "base64", labelKey: "tcp.sendPanel.formatBase64", fallback: "Base64" },
  { value: "gbk", labelKey: "tcp.sendPanel.formatGbk", fallback: "GBK" },
  { value: "json", labelKey: "tcp.sendPanel.formatJson", fallback: "JSON" },
];

const LINE_ENDING_OPTIONS: { value: LineEnding; label: string }[] = [
  { value: "none", label: "无" },
  { value: "lf", label: "LF" },
  { value: "cr", label: "CR" },
  { value: "crlf", label: "CRLF" },
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
  lineEnding, onLineEndingChange,
  layout = "bottom",
  compact = false,
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
  const [commandFormat, setCommandFormat] = useState<DataFormat>("text");
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const formatLabel = useCallback((format: DataFormat) => {
    const option = SEND_FORMAT_OPTIONS.find((item) => item.value === format);
    return option ? t(option.labelKey, option.fallback) : format.toUpperCase();
  }, [t]);

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

  const byteCount = measurePayloadSize(message, sendFormat);
  const placeholder = sendFormat === "hex"
    ? t('tcp.sendPanel.hexPlaceholder')
    : sendFormat === "base64"
      ? t('tcp.sendPanel.base64Placeholder')
      : sendFormat === "gbk"
        ? t('tcp.sendPanel.gbkPlaceholder', '输入 GBK 文本内容，发送时会按 GBK 编码')
        : sendFormat === "json"
          ? t('tcp.sendPanel.jsonPlaceholder', '输入 JSON 内容，发送时保持原样')
          : t('tcp.sendPanel.textPlaceholder');

  if (layout === "sidebar") {
    return (
      <div className="wb-subpanel relative overflow-visible">
        <div className={cn("wb-pane-header", compact && "px-3 py-2")}>
          <div className="min-w-0">
            <div className={cn("font-semibold text-text-primary", compact ? "text-[var(--fs-xxs)]" : "text-[var(--fs-xs)]")}>
              {t("tcp.sendPanel.title", "发送面板")}
            </div>
            {(!compact || sendTargetLabel || sendTargetHint) ? (
              <div className="mt-0.5 truncate text-[var(--fs-xxs)] text-text-tertiary">
                {sendTargetLabel || sendTargetHint || t("tcp.sendPanel.titleHint", "在左侧完成消息输入、格式配置和发送。")}
              </div>
            ) : null}
          </div>
          {sendHistory.length > 0 ? (
            <div className="relative">
              <button
                ref={historyBtnRef}
                onClick={() => setShowHistory((v) => !v)}
                className={cn("wb-icon-btn !h-7 !w-7", showHistory && "bg-bg-hover text-accent")}
                title={t('tcp.sendPanel.sendHistory')}
              >
                <History className="h-3.5 w-3.5" />
              </button>
              {showHistory && (
                <div
                  ref={historyRef}
                  className="absolute right-0 top-full z-30 mt-2 w-[320px] overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-bg-primary shadow-lg"
                >
                  <div className="flex items-center justify-between border-b border-border-default/60 px-3 py-2">
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
                        <span className="shrink-0 rounded-[7px] bg-bg-primary px-1.5 py-0.5 text-[var(--fs-3xs)] font-bold uppercase text-text-disabled">
                          {formatLabel(item.format)}
                        </span>
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
          ) : null}
        </div>

        <div className={cn(compact ? "space-y-2.5 p-2.5" : "space-y-3 p-3")}>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t("tcp.sendPanel.sendFormat")}
              </span>
              <select
                value={sendFormat}
                onChange={(e) => setSendFormat(e.target.value as DataFormat)}
                className="wb-field wb-native-select w-full"
              >
                {SEND_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey, option.fallback)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('tcp.sendPanel.lineEnding', '行结尾')}
              </span>
              <select
                value={lineEnding}
                onChange={(e) => onLineEndingChange(e.target.value as LineEnding)}
                className="wb-field wb-native-select w-full"
              >
                {LINE_ENDING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sendTargetLabel ? (
            <div className={cn("rounded-[10px] border border-border-default/60 bg-bg-secondary/35", compact ? "px-2.5 py-1.5" : "px-3 py-2")}>
              <div className="text-[var(--fs-3xs)] font-semibold uppercase tracking-[0.08em] text-text-disabled">
                {t("tcp.sendPanel.currentTarget")}
              </div>
              <div className="mt-1 truncate text-[var(--fs-xs)] font-medium text-text-primary">
                {sendTargetLabel}
              </div>
              {sendTargetHint ? (
                <div className="mt-1 text-[var(--fs-3xs)] text-text-tertiary">{sendTargetHint}</div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t('tcp.sendPanel.quickCommands')}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={openNewQuickCommand}
                  className="rounded-[8px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
                  title={t("tcp.sendPanel.addCommand")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {quickCommands.length > 0 ? (
                  <button
                    onClick={() => setShowQuickCmds((v) => !v)}
                    className="rounded-[8px] p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-secondary"
                    title={showQuickCmds ? t("common.collapse", "收起") : t("common.expand", "展开")}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showQuickCmds && "-rotate-90")} />
                  </button>
                ) : null}
              </div>
            </div>

            {quickCommands.length === 0 ? (
              <button
                onClick={openNewQuickCommand}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-border-default/70 bg-bg-secondary/20 px-3 py-2 text-[var(--fs-xs)] text-text-tertiary transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("tcp.sendPanel.addCommand")}
              </button>
            ) : showQuickCmds ? (
              <div className="flex flex-wrap gap-1.5">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => onLoadQuickCommand(cmd)}
                    onContextMenu={(e) => { e.preventDefault(); openEditQuickCommand(cmd); }}
                    className="group inline-flex items-center gap-1 rounded-[8px] border border-border-default/60 bg-bg-secondary/35 px-2 py-1 text-[var(--fs-xxs)] font-medium text-text-secondary transition-all hover:border-accent/35 hover:bg-accent-soft hover:text-text-primary"
                    title={`${cmd.name} (${formatLabel(cmd.format)}) - ${t('tcp.sendPanel.rightClickEdit')}`}
                  >
                    <CornerDownLeft className="h-2.5 w-2.5 shrink-0 text-text-disabled group-hover:text-accent" />
                    <span className="max-w-[120px] truncate">{cmd.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                {t("tcp.sendPanel.commandContent", "消息内容")}
              </span>
              <span className="text-[var(--fs-3xs)] text-text-disabled">
                {Math.floor(byteCount)} {t('tcp.sendPanel.bytes')}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={!connected}
              rows={compact ? 4 : 5}
              className={cn(
                "wb-send-bar-input w-full resize-y rounded-[12px] border border-border-default bg-bg-input px-3 py-2 font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled",
                compact ? "min-h-[112px] text-[var(--fs-xs)]" : "min-h-[132px] text-[var(--fs-sm)]",
                "focus:border-accent focus:ring-2 focus:ring-accent-muted",
                "disabled:cursor-not-allowed disabled:opacity-45"
              )}
            />
          </div>

          <div className={cn("space-y-2 rounded-[10px] border border-border-default/60 bg-bg-secondary/20", compact ? "px-2.5 py-2" : "px-3 py-2.5")}>
            <label className="flex items-center gap-2 text-[var(--fs-xs)] text-text-secondary">
              <input
                type="checkbox"
                checked={timerEnabled}
                onChange={onTimerToggle}
                className="h-3.5 w-3.5 rounded border-border-default text-accent focus:ring-accent/30"
              />
              <span>{t('tcp.sendPanel.timedSend')}</span>
              {timerEnabled ? <Timer className="h-3.5 w-3.5 text-accent" /> : null}
            </label>
            {timerEnabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={timerInterval}
                  onChange={(e) => onTimerIntervalChange(Math.max(100, parseInt(e.target.value) || 1000))}
                  className="wb-field w-[110px]"
                  min={100}
                  step={100}
                />
                <span className="text-[var(--fs-xxs)] text-text-disabled">ms</span>
              </div>
            ) : (
              <div className="text-[var(--fs-3xs)] text-text-disabled">
                {t("tcp.sendPanel.timerHint", "需要定时发送时再开启，避免误触循环发包。")}
              </div>
            )}
          </div>

          <button
            onClick={onSend}
            disabled={!connected || !message.trim()}
            className={cn(
              "wb-primary-btn w-full justify-center bg-accent",
              compact ? "h-9" : "h-10",
              "hover:bg-accent-hover disabled:cursor-not-allowed disabled:hover:bg-accent"
            )}
          >
            <Send className="h-3.5 w-3.5" />
            {sendLabel}
            {timerEnabled ? <Timer className="ml-0.5 h-3 w-3 opacity-60" /> : null}
          </button>
        </div>

        {showCommandEditor ? createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={closeQuickCommandEditor}>
            <div
              className="w-[420px] overflow-hidden rounded-[14px] border border-border-default bg-bg-primary shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border-default/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <CornerDownLeft className="h-4 w-4 text-accent" />
                  <span className="text-[var(--fs-sm)] font-semibold text-text-primary">
                    {editingCommandId ? t("tcp.sendPanel.editCommand") : t("tcp.sendPanel.addCommand")}
                  </span>
                </div>
                <button onClick={closeQuickCommandEditor} className="rounded-md p-1 text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 p-4">
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
                  <select
                    value={commandFormat}
                    onChange={(e) => setCommandFormat(e.target.value as DataFormat)}
                    className="wb-field wb-native-select w-full"
                  >
                    {SEND_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey, option.fallback)}
                      </option>
                    ))}
                  </select>
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

              <div className="flex items-center justify-end gap-2 border-t border-border-default/60 px-4 py-3">
                {editingCommandId ? (
                  <button
                    onClick={() => {
                      onDeleteQuickCommand(editingCommandId);
                      closeQuickCommandEditor();
                    }}
                    className="wb-ghost-btn mr-auto px-3 text-red-500 hover:bg-red-500/8"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("contextMenu.delete")}
                  </button>
                ) : null}
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
                className="group inline-flex items-center gap-1 shrink-0 rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 py-1 text-[var(--fs-xxs)] font-medium text-text-secondary transition-all hover:border-accent/40 hover:bg-accent-soft hover:text-text-primary"
                title={`${cmd.name} (${formatLabel(cmd.format)}) - ${t('tcp.sendPanel.rightClickEdit')}`}
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
        <label className="flex h-[36px] shrink-0 items-center gap-2 rounded-[10px] border border-border-default bg-bg-primary px-3 text-[var(--fs-xs)] text-text-tertiary">
          <span className="font-semibold uppercase tracking-wide">
            {t("tcp.sendPanel.sendFormat")}
          </span>
          <select
            value={sendFormat}
            onChange={(e) => setSendFormat(e.target.value as DataFormat)}
            className="wb-native-select min-w-[132px] border-0 bg-transparent py-0 pl-0 pr-6 text-[var(--fs-xs)] font-semibold text-text-primary outline-none"
          >
            {SEND_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey, option.fallback)}
              </option>
            ))}
          </select>
        </label>

        {/* Textarea input */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!connected}
            rows={1}
            className={cn(
              "wb-send-bar-input w-full resize-none rounded-[var(--radius-sm)] border border-border-default bg-bg-input px-3 py-1.5 text-[var(--fs-sm)] font-mono text-text-primary outline-none transition-all placeholder:text-text-disabled",
              "focus:border-accent focus:ring-2 focus:ring-accent-muted",
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
                  className="absolute bottom-full right-0 mb-2 w-[320px] rounded-[var(--radius-md)] border border-border-default bg-bg-primary shadow-lg overflow-hidden z-30"
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
                        <span className="shrink-0 rounded-[7px] bg-bg-primary px-1.5 py-0.5 text-[var(--fs-3xs)] font-bold uppercase text-text-disabled">
                          {formatLabel(item.format)}
                        </span>
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
                (timerEnabled || lineEnding !== 'none') && "text-accent"
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

                  {/* Line ending */}
                  <div className="space-y-1.5">
                    <div className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
                      {t('tcp.sendPanel.lineEnding', '行结尾')}
                    </div>
                    <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
                      {(['none', 'lf', 'cr', 'crlf'] as LineEnding[]).map((le) => (
                        <button
                          key={le}
                          onClick={() => onLineEndingChange(le)}
                          className={cn(
                            "h-full flex-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-colors border-r border-border-default/40 last:border-r-0",
                            lineEnding === le
                              ? "bg-accent text-white"
                              : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
                          )}
                        >
                          {le === 'none' ? t('tcp.sendPanel.lineEndingNone', '无') : le.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

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
                <select
                  value={commandFormat}
                  onChange={(e) => setCommandFormat(e.target.value as DataFormat)}
                  className="wb-field wb-native-select w-full"
                >
                  {SEND_FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey, option.fallback)}
                    </option>
                  ))}
                </select>
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
