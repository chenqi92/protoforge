// 软件自动更新组件
// 使用 Tauri updater API 检测和安装应用更新（右下角浮动弹窗）

import { useEffect } from 'react';
import { Download, X, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useUpdateStore } from '@/stores/updateStore';

export function UpdateChecker() {
  const { t } = useTranslation();
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const error = useUpdateStore((s) => s.error);
  const progress = useUpdateStore((s) => s.progress);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const restartApp = useUpdateStore((s) => s.restartApp);
  const dismiss = useUpdateStore((s) => s.dismiss);

  // 启动时自动检查一次
  useEffect(() => {
    const timer = setTimeout(() => checkForUpdate(), 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (dismissed || status === 'idle') return null;

  const statusText: Record<string, string> = {
    checking: t('update.checking'),
    available: t('update.available'),
    downloading: t('update.downloading'),
    ready: t('update.ready'),
    'up-to-date': t('update.upToDate'),
    error: t('update.failed'),
  };

  const statusIcon: Record<string, React.ReactNode> = {
    checking: <RefreshCw className="w-4 h-4 text-accent animate-spin" />,
    available: <Download className="w-4 h-4 text-accent" />,
    downloading: <Download className="w-4 h-4 text-accent animate-bounce" />,
    ready: <CheckCircle className="w-4 h-4 text-emerald-500" />,
    'up-to-date': <CheckCircle className="w-4 h-4 text-emerald-500" />,
    error: <AlertTriangle className="w-4 h-4 text-red-500" />,
  };

  return (
    <div className={cn(
      "fixed bottom-16 right-4 z-[100] w-[340px] rounded-xl border shadow-2xl overflow-hidden",
      "bg-bg-elevated border-border-default animate-in slide-in-from-bottom-4 duration-300"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-secondary/30">
        <div className="flex items-center gap-2">
          {statusIcon[status]}
          <span className="text-[var(--fs-base)] font-semibold text-text-primary">{statusText[status]}</span>
        </div>
        <button onClick={dismiss} className="text-text-disabled hover:text-text-primary p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        {status === 'available' && updateInfo && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[var(--fs-sm)] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">v{updateInfo.version}</span>
            </div>
            {updateInfo.body && (
              <p className="text-[var(--fs-xs)] text-text-secondary leading-relaxed line-clamp-4">{updateInfo.body}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={installUpdate} className="flex-1 h-8 bg-accent text-white text-[var(--fs-sm)] font-semibold rounded-lg hover:bg-accent/90 transition-colors">
                {t('update.install')}
              </button>
              <button onClick={dismiss} className="h-8 px-4 text-[var(--fs-sm)] text-text-tertiary hover:bg-bg-hover rounded-lg transition-colors">
                {t('update.later')}
              </button>
            </div>
          </>
        )}

        {status === 'downloading' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[var(--fs-xs)] text-text-tertiary">{t('update.progress')}</span>
              <span className="text-[var(--fs-xs)] text-text-secondary font-medium">{progress}%</span>
            </div>
            <div className="h-2 bg-bg-input rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'ready' && (
          <div className="flex items-center gap-2">
            <button onClick={restartApp} className="flex-1 h-8 bg-emerald-500 text-white text-[var(--fs-sm)] font-semibold rounded-lg hover:bg-emerald-600 transition-colors">
              {t('update.restart')}
            </button>
          </div>
        )}

        {status === 'error' && error && (
          <div className="space-y-2">
            <p className="text-[var(--fs-xs)] text-red-500">{error}</p>
            <button onClick={checkForUpdate} className="h-7 px-3 text-[var(--fs-xs)] text-accent hover:bg-accent/10 rounded-md transition-colors">
              {t('update.retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
