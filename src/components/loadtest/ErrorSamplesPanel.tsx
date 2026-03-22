import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { RequestRecord } from "@/types/loadtest";

interface ErrorSamplesPanelProps {
  samples: RequestRecord[];
}

export function ErrorSamplesPanel({ samples }: ErrorSamplesPanelProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [samples.length]);

  if (samples.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-text-disabled text-[var(--fs-sm)]">
        {t("loadtest.noErrors", "暂无错误样本")}
      </div>
    );
  }

  const statusColor = (s: number) => {
    if (s === 0) return "text-gray-500 bg-gray-500/10";
    if (s < 400) return "text-amber-600 bg-amber-500/10";
    return "text-red-600 bg-red-500/10";
  };

  return (
    <div ref={listRef} className="max-h-[260px] overflow-y-auto -mx-4 -mt-4 -mb-4 rounded-b-[10px]">
      <table className="w-full text-[var(--fs-xs)] table-fixed">
        <colgroup>
          <col className="w-[60px]" />
          <col className="w-[52px]" />
          <col className="w-[44px]" />
          <col className="w-[52px]" />
          <col className="w-[44px]" />
          <col />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr className="text-text-tertiary bg-bg-primary shadow-[0_1px_0_0_var(--border-default)]">
            <th className="px-3 py-1.5 text-left font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">{t("loadtest.time", "时间")}</th>
            <th className="px-2 py-1.5 text-center font-medium">{t("loadtest.statusShort", "状态")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("loadtest.latencyCol", "延迟")}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t("loadtest.sizeCol", "大小")}</th>
            <th className="px-3 py-1.5 text-left font-medium">{t("loadtest.errorMsg", "错误信息")}</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((r, i) => (
            <tr
              key={`${r.seq}-${i}`}
              className="border-b border-border-default/20 last:border-b-0 hover:bg-red-500/3 transition-colors"
            >
              <td className="px-3 py-1 text-text-disabled tabular-nums truncate">{r.seq}</td>
              <td className="px-2 py-1 text-text-secondary tabular-nums">{(r.elapsedMs / 1000).toFixed(1)}s</td>
              <td className="px-2 py-1 text-center">
                <span className={cn("inline-block rounded px-1 py-px text-[10px] font-semibold tabular-nums", statusColor(r.status))}>
                  {r.status === 0 ? "ERR" : r.status}
                </span>
              </td>
              <td className="px-2 py-1 text-right text-text-secondary tabular-nums">{r.latencyMs}ms</td>
              <td className="px-2 py-1 text-right text-text-disabled tabular-nums">{formatB(r.bytes)}</td>
              <td className="px-3 py-1 text-red-500/80 truncate">
                <span className="text-[11px]" title={r.errorMsg || ""}>{r.errorMsg || "-"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatB(b: number): string {
  if (b === 0) return "-";
  if (b >= 1024) return `${(b / 1024).toFixed(1)}K`;
  return `${b}B`;
}
