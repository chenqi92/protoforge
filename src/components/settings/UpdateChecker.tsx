// 软件自动更新组件
// 使用 Tauri updater API 检测和安装应用更新（右下角浮动通知）

import { useEffect } from 'react';
import { Download, X, RefreshCw, CheckCircle, AlertTriangle, Sparkles, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useUpdateStore } from '@/stores/updateStore';
import { AnimatePresence, motion } from 'framer-motion';

export function UpdateChecker() {
  const { t } = useTranslation();
  const currentVersion = useUpdateStore((s) => s.currentVersion);
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

  // 5 秒后自动关闭 "已是最新" 和 "checking"
  useEffect(() => {
    if (status === 'up-to-date' || status === 'checking') {
      const autoClose = setTimeout(() => dismiss(), status === 'checking' ? 15000 : 4000);
      return () => clearTimeout(autoClose);
    }
  }, [status, dismiss]);

  const shouldShow = !dismissed && status !== 'idle';

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            "fixed bottom-12 right-4 z-[100] w-[320px] rounded-2xl border overflow-hidden",
            "bg-bg-elevated/95 border-border-default/80 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl",
          )}
        >
          {/* ── 正在检查 ── */}
          {status === 'checking' && (
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-accent animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('update.checking')}</p>
                <p className="text-[var(--fs-xs)] text-text-tertiary mt-0.5">{t('update.checkingDesc')}</p>
              </div>
            </div>
          )}

          {/* ── 已是最新版本 ── */}
          {status === 'up-to-date' && (
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('update.upToDate')}</p>
                <p className="text-[var(--fs-xs)] text-text-tertiary mt-0.5">v{currentVersion}</p>
              </div>
              <button onClick={dismiss} className="text-text-disabled hover:text-text-primary p-1 rounded-lg transition-colors hover:bg-bg-hover">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── 有新版本 ── */}
          {status === 'available' && updateInfo && (
            <div className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4.5 h-4.5 text-violet-500" />
                  </div>
                  <div>
                    <p className="text-[var(--fs-sm)] font-bold text-text-primary">{t('update.available')}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[var(--fs-xs)] text-text-disabled">v{currentVersion}</span>
                      <span className="text-[var(--fs-xs)] text-text-disabled">→</span>
                      <span className="text-[var(--fs-xs)] font-bold text-violet-500">v{updateInfo.version}</span>
                    </div>
                  </div>
                </div>
                <button onClick={dismiss} className="text-text-disabled hover:text-text-primary p-1 rounded-lg transition-colors hover:bg-bg-hover">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Release notes */}
              {updateInfo.body && (
                <p className="text-[var(--fs-xs)] text-text-secondary leading-relaxed line-clamp-3 pl-[46px]">
                  {updateInfo.body.replace(/^#+\s.*$/gm, '').trim().slice(0, 150)}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 pl-[46px]">
                <button
                  onClick={installUpdate}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-xl text-[var(--fs-sm)] font-semibold bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm hover:from-violet-600 hover:to-purple-600 transition-all active:scale-[0.97]"
                >
                  {updateInfo.isFallback ? (
                    <><ExternalLink className="w-3.5 h-3.5" /> {t('update.install')}</>
                  ) : (
                    <><Download className="w-3.5 h-3.5" /> {t('update.install')}</>
                  )}
                </button>
                <button
                  onClick={dismiss}
                  className="h-8 px-3 rounded-xl text-[var(--fs-sm)] text-text-tertiary hover:bg-bg-hover transition-colors"
                >
                  {t('update.later')}
                </button>
              </div>
            </div>
          )}

          {/* ── 下载中 ── */}
          {status === 'downloading' && (
            <div className="p-4 space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4 text-accent animate-bounce" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('update.downloading')}</p>
                  <p className="text-[var(--fs-xs)] text-text-tertiary mt-0.5">{progress}%</p>
                </div>
              </div>
              <div className="h-1.5 bg-bg-input rounded-full overflow-hidden ml-[44px]">
                <motion.div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {/* ── 下载完成 ── */}
          {status === 'ready' && (
            <div className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('update.ready')}</p>
              </div>
              <button
                onClick={restartApp}
                className="h-8 px-4 rounded-xl text-[var(--fs-sm)] font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.97]"
              >
                {t('update.restart')}
              </button>
            </div>
          )}

          {/* ── 错误 ── */}
          {status === 'error' && error && (
            <div className="p-4 space-y-2.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--fs-sm)] font-semibold text-text-primary">{t('update.failed')}</p>
                  <p className="text-[var(--fs-xs)] text-red-500/80 mt-0.5 line-clamp-2">{error}</p>
                </div>
                <button onClick={dismiss} className="text-text-disabled hover:text-text-primary p-1 rounded-lg transition-colors hover:bg-bg-hover">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 ml-[44px]">
                <button onClick={checkForUpdate} className="h-7 px-3 text-[var(--fs-xs)] font-medium text-accent hover:bg-accent/10 rounded-lg transition-colors">
                  {t('update.retry')}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
