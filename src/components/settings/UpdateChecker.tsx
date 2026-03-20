// 软件自动更新组件
// 使用 Tauri updater API 检测和安装应用更新

import { useState, useCallback, useEffect } from 'react';
import { Download, X, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UpdateInfo {
  version: string;
  date: string;
  body: string;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

export function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // 启动时自动检查一次
  useEffect(() => {
    const timer = setTimeout(() => checkForUpdate(), 3000);
    return () => clearTimeout(timer);
  }, []);

  const checkForUpdate = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        setUpdateInfo({
          version: update.version,
          date: update.date || '',
          body: update.body || '',
        });
        setStatus('available');
      } else {
        setStatus('up-to-date');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Plugin not configured is not a real error
      if (msg.includes('not configured') || msg.includes('No such plugin')) {
        setStatus('idle');
        return;
      }
      setError(msg);
      setStatus('error');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    setStatus('downloading');
    setProgress(0);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = (event.data as { contentLength?: number })?.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += (event.data as { chunkLength: number }).chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          setStatus('ready');
        }
      });

      setStatus('ready');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  const restartApp = useCallback(async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      // fallback
    }
  }, []);

  if (dismissed || status === 'idle') return null;

  return (
    <div className={cn(
      "fixed bottom-16 right-4 z-[100] w-[340px] rounded-xl border shadow-2xl overflow-hidden",
      "bg-bg-elevated border-border-default animate-in slide-in-from-bottom-4 duration-300"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-secondary/30">
        <div className="flex items-center gap-2">
          {status === 'checking' && <RefreshCw className="w-4 h-4 text-accent animate-spin" />}
          {status === 'available' && <Download className="w-4 h-4 text-accent" />}
          {status === 'downloading' && <Download className="w-4 h-4 text-accent animate-bounce" />}
          {status === 'ready' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
          {status === 'up-to-date' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
          {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-500" />}
          <span className="text-[13px] font-semibold text-text-primary">
            {status === 'checking' && '检查更新中...'}
            {status === 'available' && '发现新版本'}
            {status === 'downloading' && '下载更新中...'}
            {status === 'ready' && '更新已就绪'}
            {status === 'up-to-date' && '已是最新版'}
            {status === 'error' && '更新失败'}
          </span>
        </div>
        <button onClick={() => setDismissed(true)} className="text-text-disabled hover:text-text-primary p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        {status === 'available' && updateInfo && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">v{updateInfo.version}</span>
            </div>
            {updateInfo.body && (
              <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-4">{updateInfo.body}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={installUpdate} className="flex-1 h-8 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent/90 transition-colors">
                立即更新
              </button>
              <button onClick={() => setDismissed(true)} className="h-8 px-4 text-[12px] text-text-tertiary hover:bg-bg-hover rounded-lg transition-colors">
                稍后
              </button>
            </div>
          </>
        )}

        {status === 'downloading' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-text-tertiary">下载进度</span>
              <span className="text-[11px] text-text-secondary font-medium">{progress}%</span>
            </div>
            <div className="h-2 bg-bg-input rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'ready' && (
          <div className="flex items-center gap-2">
            <button onClick={restartApp} className="flex-1 h-8 bg-emerald-500 text-white text-[12px] font-semibold rounded-lg hover:bg-emerald-600 transition-colors">
              重启应用
            </button>
          </div>
        )}

        {status === 'error' && error && (
          <div className="space-y-2">
            <p className="text-[11px] text-red-500">{error}</p>
            <button onClick={checkForUpdate} className="h-7 px-3 text-[11px] text-accent hover:bg-accent/10 rounded-md transition-colors">
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
