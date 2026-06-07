/**
 * ActivityLogDock — collapsible, resizable bottom dock (Forge prototype ActivityLog).
 *
 * Lives inside the workarea (App.tsx activity-log slot). Reads the unified
 * activityLogStore (entries + filterRegex). Open/closed state is owned by App
 * (toggled from the rail's activity button and the status bar); the dock owns
 * its own height via a top drag handle.
 */

import { useMemo, useRef, useState, useCallback } from "react";
import { Activity, Search, Trash2, X, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useActivityLogStore, type ActivityLogEntry, type LogSource } from "@/stores/activityLogStore";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type SourceFilter = "all" | "http" | "ws" | "err";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 460;

/** Heuristic error detection — the log store has no explicit level field. */
const ERROR_RE = /error|fail|✗|exception|拒绝|失败|错误|超时|timeout|refused|reset/i;

const sourceTone: Record<LogSource, string> = {
  http: "text-method-get",
  tcp: "text-info",
  udp: "text-method-patch",
  ws: "text-method-post",
  mqtt: "text-info",
  serial: "text-warning",
  modbus: "text-method-patch",
  system: "text-text-tertiary",
};

export function ActivityLogDock({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const entries = useActivityLogStore((s) => s.entries);
  const filterRegex = useActivityLogStore((s) => s.filterRegex);
  const setFilterRegex = useActivityLogStore((s) => s.setFilterRegex);
  const clearAll = useActivityLogStore((s) => s.clearAll);

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [regexError, setRegexError] = useState(false);

  // Self-managed height + drag-resize (top handle).
  const [height, setHeight] = useState(240);
  const heightStartRef = useRef(240);

  const handleFilterChange = useCallback((value: string) => {
    setFilterRegex(value);
    if (value) {
      try {
        new RegExp(value, "i");
        setRegexError(false);
      } catch {
        setRegexError(true);
      }
    } else {
      setRegexError(false);
    }
  }, [setFilterRegex]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    heightStartRef.current = height;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      // Dragging up (negative delta) grows the dock.
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, heightStartRef.current - (ev.clientY - startY)));
      setHeight(next);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }, [height]);

  const filtered = useMemo(() => {
    let list = entries;

    // Source segment filter.
    if (sourceFilter === "http") list = list.filter((e) => e.source === "http");
    else if (sourceFilter === "ws") list = list.filter((e) => e.source === "ws" || e.source === "mqtt");
    else if (sourceFilter === "err") list = list.filter((e) => ERROR_RE.test(e.summary) || e.source === "system");

    // Regex filter (matches summary / source / rawData).
    if (filterRegex) {
      try {
        const re = new RegExp(filterRegex, "i");
        list = list.filter((e) => re.test(e.summary) || re.test(e.source) || (e.rawData ? re.test(e.rawData) : false));
      } catch {
        /* invalid regex → ignore filter */
      }
    }
    return list;
  }, [entries, sourceFilter, filterRegex]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  };

  const handleParse = (entry: ActivityLogEntry) => {
    if (!entry.rawData) return;
    window.dispatchEvent(new CustomEvent("parse-protocol", { detail: { data: entry.rawData } }));
  };

  return (
    <div
      data-activity-log-dock
      className="relative flex shrink-0 flex-col border-t border-border-default bg-bg-primary"
      style={{ height }}
    >
      {/* Top drag handle */}
      <div
        onPointerDown={startResize}
        className="absolute -top-[3px] left-0 right-0 z-10 h-[7px] cursor-row-resize hover:bg-accent/30"
        title={t('activityLog.dragToResize', '拖动调整高度')}
      />

      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-default px-3 py-1.5">
        <Activity className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="pf-text-sm font-semibold text-text-primary">
          {t('activityLog.title', '活动日志')}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Regex filter */}
          <div className="relative group">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled group-focus-within:text-accent transition-colors" />
            <input
              value={filterRegex}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder={t('activityLog.filterPlaceholder', '正则过滤 /regex/')}
              className={cn(
                "h-[24px] w-[180px] pf-rounded-sm border bg-bg-app pl-7 pr-2 font-mono pf-text-xs text-text-primary outline-none transition-all placeholder:text-text-tertiary",
                regexError ? "border-error focus:border-error" : "border-border-default focus:border-accent",
              )}
            />
          </div>

          {/* Source segment */}
          <SegmentedControl<SourceFilter>
            size="sm"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "all", label: t('activityLog.filterAll', '全部') },
              { value: "http", label: "HTTP" },
              { value: "ws", label: "WS" },
              { value: "err", label: "Err" },
            ]}
          />

          <button
            onClick={clearAll}
            disabled={entries.length === 0}
            className="flex h-[24px] w-[24px] items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error disabled:opacity-40"
            title={t('activityLog.clear', '清空')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="flex h-[24px] w-[24px] items-center justify-center pf-rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={t('activityLog.close', '关闭')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-4 text-center">
            <div className="flex h-[46px] w-[46px] items-center justify-center pf-rounded-lg border border-border-subtle bg-bg-secondary text-text-tertiary shadow-sm">
              <Activity className="h-5 w-5" />
            </div>
            <span className="pf-text-sm font-medium text-text-secondary">
              {entries.length === 0 ? t('activityLog.empty', '暂无记录') : t('activityLog.noMatches', '无匹配记录')}
            </span>
            <span className="pf-text-xs text-text-disabled">
              {entries.length === 0
                ? t('activityLog.emptyHint', '网络与协议活动会实时记录在这里')
                : t('activityLog.noMatchesHint', '调整过滤条件或正则表达式')}
            </span>
          </div>
        ) : (
          filtered.map((entry) => {
            const isErr = ERROR_RE.test(entry.summary);
            return (
              <div
                key={entry.id}
                className="group grid items-center gap-2.5 border-b border-border-subtle px-2.5 py-[3px] font-mono text-[11.5px] text-text-secondary hover:bg-bg-hover"
                style={{ gridTemplateColumns: "70px 64px 1fr 30px" }}
              >
                <span className="text-text-tertiary tabular-nums">{formatTime(entry.timestamp)}</span>
                <span className={cn("font-bold uppercase", isErr ? "text-error" : sourceTone[entry.source])}>
                  {entry.source}
                </span>
                <span className={cn("truncate", isErr ? "text-error" : "text-text-primary")} title={entry.summary}>
                  {entry.summary}
                </span>
                <button
                  onClick={() => handleParse(entry)}
                  disabled={!entry.rawData}
                  className="flex h-5 w-5 items-center justify-center justify-self-end pf-rounded-sm text-text-disabled opacity-0 transition-all hover:bg-bg-hover hover:text-accent group-hover:opacity-100 disabled:opacity-0"
                  title={t('activityLog.sendToParser', '发送到协议解析器')}
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
