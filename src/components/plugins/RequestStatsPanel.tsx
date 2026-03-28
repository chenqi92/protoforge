/**
 * RequestStatsPanel — 请求统计面板 (sidebar-panel 插件)
 *
 * 在侧边栏中展示本次会话的 HTTP 请求统计：
 * 请求总数、成功/失败计数、平均响应时间、状态码分布
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Clock,
  CheckCircle2,
  XCircle,
  Activity,
  Zap,
  TrendingUp,
  Trash2,
} from 'lucide-react';


interface RequestStat {
  method: string;
  url: string;
  status: number;
  duration: number;
  timestamp: number;
  size: number;
}

interface StatsState {
  total: number;
  success: number;
  failed: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  totalSize: number;
  statusCodes: Record<number, number>;
  methodCounts: Record<string, number>;
  requests: RequestStat[];
}

const initialStats: StatsState = {
  total: 0,
  success: 0,
  failed: 0,
  avgDuration: 0,
  minDuration: Infinity,
  maxDuration: 0,
  totalSize: 0,
  statusCodes: {},
  methodCounts: {},
  requests: [],
};

// 全局统计数据存储（跨组件/卸载保持）
let globalStats: StatsState = { ...initialStats };
let listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/** 外部调用：记录一条请求结果 */
export function recordRequestStat(stat: RequestStat) {
  const s = globalStats;
  s.total += 1;
  if (stat.status >= 200 && stat.status < 400) {
    s.success += 1;
  } else {
    s.failed += 1;
  }
  s.requests.push(stat);
  s.avgDuration = s.requests.reduce((sum, r) => sum + r.duration, 0) / s.requests.length;
  s.minDuration = Math.min(s.minDuration, stat.duration);
  s.maxDuration = Math.max(s.maxDuration, stat.duration);
  s.totalSize += stat.size;
  s.statusCodes[stat.status] = (s.statusCodes[stat.status] || 0) + 1;
  s.methodCounts[stat.method] = (s.methodCounts[stat.method] || 0) + 1;
  notifyListeners();
}

export function clearRequestStats() {
  globalStats = { ...initialStats, statusCodes: {}, methodCounts: {}, requests: [] };
  notifyListeners();
}

function useRequestStats(): StatsState {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return globalStats;
}

// 状态码颜色
function statusColor(code: number) {
  if (code >= 200 && code < 300) return 'text-emerald-500';
  if (code >= 300 && code < 400) return 'text-blue-500';
  if (code >= 400 && code < 500) return 'text-amber-500';
  if (code >= 500) return 'text-red-500';
  return 'text-text-tertiary';
}

function methodColor(method: string) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-500/15 text-emerald-600',
    POST: 'bg-amber-500/15 text-amber-600',
    PUT: 'bg-blue-500/15 text-blue-600',
    DELETE: 'bg-red-500/15 text-red-600',
    PATCH: 'bg-violet-500/15 text-violet-600',
  };
  return colors[method] || 'bg-gray-500/10 text-text-tertiary';
}

export function RequestStatsPanel() {
  const stats = useRequestStats();
  const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : '0.0';

  const handleClear = useCallback(() => {
    clearRequestStats();
  }, []);

  return (
    <div className="py-1 px-1">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[length:var(--fs-sidebar)] font-semibold text-text-primary flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-accent" />
          请求统计
        </span>
        {stats.total > 0 && (
          <button
            onClick={handleClear}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[length:var(--fs-sidebar-sm)] text-text-tertiary hover:text-red-500 hover:bg-bg-hover transition-colors"
            title="清空统计"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Empty state */}
      {stats.total === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-border-subtle bg-bg-hover shadow-sm">
            <Activity className="w-6 h-6 text-text-tertiary" />
          </div>
          <p className="text-[length:var(--fs-sidebar)] font-medium text-text-secondary">暂无请求数据</p>
          <p className="text-[length:var(--fs-sidebar-sm)] mt-1 text-text-disabled">发送 HTTP 请求后，统计数据会自动展示在这里</p>
        </div>
      )}

      {stats.total > 0 && (
        <div className="space-y-2.5">
          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-1.5">
            <StatCard
              icon={<Zap className="w-3.5 h-3.5" />}
              label="总请求"
              value={stats.total.toString()}
              accent="text-accent"
            />
            <StatCard
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label="成功率"
              value={`${successRate}%`}
              accent={parseFloat(successRate) >= 90 ? 'text-emerald-500' : parseFloat(successRate) >= 50 ? 'text-amber-500' : 'text-red-500'}
            />
            <StatCard
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              label="成功"
              value={stats.success.toString()}
              accent="text-emerald-500"
            />
            <StatCard
              icon={<XCircle className="w-3.5 h-3.5" />}
              label="失败"
              value={stats.failed.toString()}
              accent="text-red-500"
            />
          </div>

          {/* Latency Section */}
          <div className="rounded-lg border border-border-default/60 bg-bg-secondary/30 p-2">
            <p className="text-[var(--fs-3xs)] text-text-disabled mb-1.5 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" />
              响应时间
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-[var(--fs-3xs)] text-text-disabled">平均</p>
                <p className="text-[length:var(--fs-sidebar-sm)] font-semibold text-text-primary tabular-nums">
                  {stats.avgDuration.toFixed(0)}ms
                </p>
              </div>
              <div>
                <p className="text-[var(--fs-3xs)] text-text-disabled">最快</p>
                <p className="text-[length:var(--fs-sidebar-sm)] font-semibold text-emerald-500 tabular-nums">
                  {stats.minDuration === Infinity ? '-' : `${stats.minDuration.toFixed(0)}ms`}
                </p>
              </div>
              <div>
                <p className="text-[var(--fs-3xs)] text-text-disabled">最慢</p>
                <p className="text-[length:var(--fs-sidebar-sm)] font-semibold text-amber-500 tabular-nums">
                  {stats.maxDuration === 0 ? '-' : `${stats.maxDuration.toFixed(0)}ms`}
                </p>
              </div>
            </div>
          </div>

          {/* Status Code Distribution */}
          {Object.keys(stats.statusCodes).length > 0 && (
            <div className="rounded-lg border border-border-default/60 bg-bg-secondary/30 p-2">
              <p className="text-[var(--fs-3xs)] text-text-disabled mb-1.5 uppercase tracking-wider">状态码分布</p>
              <div className="space-y-1">
                {Object.entries(stats.statusCodes)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([code, count]) => {
                    const pct = ((count / stats.total) * 100).toFixed(0);
                    return (
                      <div key={code} className="flex items-center gap-2">
                        <span className={cn('text-[length:var(--fs-sidebar-sm)] font-semibold tabular-nums w-8', statusColor(Number(code)))}>{code}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-bg-secondary overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', Number(code) < 400 ? 'bg-emerald-500/60' : 'bg-red-500/60')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[var(--fs-3xs)] text-text-disabled tabular-nums w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Method Distribution */}
          {Object.keys(stats.methodCounts).length > 0 && (
            <div className="rounded-lg border border-border-default/60 bg-bg-secondary/30 p-2">
              <p className="text-[var(--fs-3xs)] text-text-disabled mb-1.5 uppercase tracking-wider">方法分布</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(stats.methodCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([method, count]) => (
                    <span
                      key={method}
                      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[var(--fs-3xs)] font-semibold', methodColor(method))}
                    >
                      {method}
                      <span className="opacity-60 tabular-nums">{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border-default/60 bg-bg-secondary/30 p-2 flex flex-col">
      <div className={cn('flex items-center gap-1 text-[var(--fs-3xs)] mb-0.5', accent)}>
        {icon}
        <span className="text-text-disabled">{label}</span>
      </div>
      <span className={cn('text-[length:var(--fs-sidebar)] font-bold tabular-nums', accent)}>{value}</span>
    </div>
  );
}
