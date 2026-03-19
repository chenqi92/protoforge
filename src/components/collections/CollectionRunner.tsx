// ProtoForge Collection Runner Component

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, CheckCircle, XCircle, Clock, BarChart3, ArrowLeft, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunItemResult {
  itemId: string;
  name: string;
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  success: boolean;
  error: string | null;
}

interface RunCollectionResult {
  total: number;
  passed: number;
  failed: number;
  totalMs: number;
  results: RunItemResult[];
}

interface CollectionItem {
  id: string;
  name: string;
  itemType: string;
  method: string | null;
  url: string | null;
}

interface CollectionRunnerProps {
  collectionId: string;
  collectionName: string;
  onClose: () => void;
}

export function CollectionRunner({ collectionId, collectionName, onClose }: CollectionRunnerProps) {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [delayMs, setDelayMs] = useState(0);
  const [iterations, setIterations] = useState(1);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunItemResult[]>([]);
  const [summary, setSummary] = useState<RunCollectionResult | null>(null);
  const [progress, setProgress] = useState({ index: 0, total: 0 });
  const listRef = useRef<HTMLDivElement>(null);

  // 加载集合项
  useEffect(() => {
    (async () => {
      try {
        const allItems = await invoke<CollectionItem[]>('list_collection_items', { collectionId });
        const requests = allItems.filter(i => i.itemType === 'request');
        setItems(requests);
        setSelectedIds(requests.map(i => i.id));
      } catch {}
    })();
  }, [collectionId]);

  // 监听进度
  useEffect(() => {
    const unlisten = listen<{ iteration: number; index: number; total: number; result: RunItemResult }>('collection-runner-progress', (e) => {
      setResults(prev => [...prev, e.payload.result]);
      setProgress({ index: e.payload.index + 1, total: e.payload.total });
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [results]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setSummary(null);
    setProgress({ index: 0, total: items.length });
    try {
      const result = await invoke<RunCollectionResult>('run_collection', {
        config: { collectionId, itemIds: selectedIds, delayMs, iterations },
      });
      setSummary(result);
    } catch (err: any) {
      setSummary({ total: 0, passed: 0, failed: 0, totalMs: 0, results: [] });
    } finally {
      setRunning(false);
    }
  }, [collectionId, selectedIds, delayMs, iterations, items.length]);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    setSelectedIds(prev => prev.length === items.length ? [] : items.map(i => i.id));
  };

  const methodColor = (m: string) => {
    const map: Record<string, string> = { GET: 'text-emerald-600', POST: 'text-amber-600', PUT: 'text-blue-600', DELETE: 'text-red-600', PATCH: 'text-violet-600' };
    return map[m?.toUpperCase()] || 'text-text-secondary';
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="shrink-0 flex items-center h-10 px-3 bg-bg-secondary/40 border-b border-border-default gap-2">
        <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary"><ArrowLeft className="w-4 h-4" /></button>
        <BarChart3 className="w-4 h-4 text-accent shrink-0" />
        <span className="text-[13px] font-semibold text-text-primary truncate">Runner: {collectionName}</span>
        <div className="flex-1" />
        {running ? (
          <div className="flex items-center gap-2 text-[11px] text-accent">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            {progress.index}/{progress.total}
          </div>
        ) : (
          <button onClick={handleRun} disabled={selectedIds.length === 0} className="h-7 px-4 rounded-md text-[12px] font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-40 flex items-center gap-1">
            <Play className="w-3 h-3 fill-white" /> 运行
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Config */}
        <div className="w-64 shrink-0 border-r border-border-default flex flex-col overflow-hidden">
          {/* Request selection */}
          <div className="p-3 border-b border-border-default">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-bold text-text-disabled uppercase tracking-wider">请求</h3>
              <button onClick={toggleAll} className="text-[10px] text-accent hover:underline">
                {selectedIds.length === items.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="space-y-0.5 max-h-48 overflow-auto">
              {items.map(item => (
                <label key={item.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-hover cursor-pointer">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleItem(item.id)} className="accent-accent" />
                  <span className={cn("text-[10px] font-bold w-10 shrink-0", methodColor(item.method || ''))}>{item.method || '?'}</span>
                  <span className="text-[11px] text-text-secondary truncate">{item.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Config */}
          <div className="p-3 space-y-3">
            <h3 className="text-[11px] font-bold text-text-disabled uppercase tracking-wider flex items-center gap-1"><Settings2 className="w-3 h-3" /> 配置</h3>
            <div>
              <label className="text-[11px] text-text-tertiary">迭代次数</label>
              <input type="number" min={1} max={100} value={iterations} onChange={(e) => setIterations(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full h-7 px-2 mt-1 text-[12px] bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-[11px] text-text-tertiary">请求间延迟 (ms)</label>
              <input type="number" min={0} max={10000} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full h-7 px-2 mt-1 text-[12px] bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent" />
            </div>
          </div>

          {/* Summary */}
          {summary && (
            <div className="mt-auto p-3 border-t border-border-default bg-bg-secondary/30">
              <h3 className="text-[11px] font-bold text-text-disabled uppercase tracking-wider mb-2">结果</h3>
              <div className="grid grid-cols-2 gap-2 text-[20px] font-bold">
                <div className="text-center">
                  <p className="text-emerald-600">{summary.passed}</p>
                  <p className="text-[9px] text-text-disabled font-normal">通过</p>
                </div>
                <div className="text-center">
                  <p className="text-red-500">{summary.failed}</p>
                  <p className="text-[9px] text-text-disabled font-normal">失败</p>
                </div>
              </div>
              <div className="flex items-center justify-center mt-2 gap-1 text-[11px] text-text-tertiary">
                <Clock className="w-3 h-3" /> 总耗时 {summary.totalMs}ms
              </div>
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div ref={listRef} className="flex-1 overflow-auto p-3 space-y-1">
          {results.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-disabled">
              <BarChart3 className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-[13px] font-medium">点击"运行"开始批量执行</p>
              <p className="text-[11px] mt-1">选择要运行的请求，设置迭代次数和延迟</p>
            </div>
          ) : (
            results.map((r, i) => (
              <div key={i} className={cn("flex items-center gap-3 px-3 py-2 rounded-md border transition-colors",
                r.success ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"
              )}>
                {r.success ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <span className={cn("text-[10px] font-bold w-10 shrink-0", methodColor(r.method))}>{r.method}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-text-primary truncate">{r.name}</p>
                  <p className="text-[10px] text-text-disabled truncate">{r.url}</p>
                </div>
                {r.status && (
                  <span className={cn("text-[11px] font-mono font-bold px-1.5 py-0.5 rounded",
                    r.status < 300 ? "text-emerald-600 bg-emerald-500/10" :
                    r.status < 400 ? "text-amber-600 bg-amber-500/10" :
                    "text-red-500 bg-red-500/10"
                  )}>{r.status}</span>
                )}
                <span className="text-[10px] text-text-disabled shrink-0">{r.durationMs}ms</span>
                {r.error && <span className="text-[10px] text-red-500 max-w-[120px] truncate" title={r.error}>{r.error}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
