import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownCircle,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Download,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/updateStore";
import { AnimatePresence, motion } from "framer-motion";

interface StatusBarProps {
  connectionStatus?: "connected" | "disconnected";
  responseTime?: number;
  responseSize?: number;
  activeModule: string;
}

export function StatusBar({
  responseTime,
  responseSize,
  activeModule,
}: StatusBarProps) {
  const { t } = useTranslation();

  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const progress = useUpdateStore((s) => s.progress);
  const initVersion = useUpdateStore((s) => s.initVersion);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const restartApp = useUpdateStore((s) => s.restartApp);

  const [showConfirm, setShowConfirm] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // 初始化版本号 + 启动时静默检查更新
  useEffect(() => {
    initVersion();
    const timer = setTimeout(() => checkForUpdate(), 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击对话框外部关闭
  useEffect(() => {
    if (!showConfirm) return;
    const handleClick = (e: MouseEvent) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target as Node)) {
        setShowConfirm(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showConfirm]);

  const moduleLabel = t(`statusBar.${activeModule}`, { defaultValue: activeModule.toUpperCase() });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasUpdate = status === 'available' && latestVersion;
  const isChecking = status === 'checking';
  const isDownloading = status === 'downloading';
  const isReady = status === 'ready';
  const isError = status === 'error';

  const handleVersionClick = () => {
    if (hasUpdate) {
      setShowConfirm(true);
    } else if (isReady) {
      restartApp();
    } else if (isError) {
      checkForUpdate();
    } else if (!isChecking && !isDownloading) {
      checkForUpdate();
    }
  };

  const handleConfirmUpdate = () => {
    setShowConfirm(false);
    installUpdate();
  };

  // 渲染底栏版本区域内容
  const renderVersionContent = () => {
    // 正在检查
    if (isChecking) {
      return (
        <>
          <RefreshCw className="h-3 w-3 animate-spin text-accent" />
          <span className="text-text-tertiary">{t('update.checking')}</span>
        </>
      );
    }

    // 下载中
    if (isDownloading) {
      return (
        <>
          <Download className="h-3 w-3 text-accent animate-bounce" />
          <span className="text-accent font-medium">{progress}%</span>
          <div className="w-16 h-1.5 bg-bg-input rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </>
      );
    }

    // 更新就绪
    if (isReady) {
      return (
        <>
          <CheckCircle className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-500 font-medium">{t('update.readyToRestart')}</span>
        </>
      );
    }

    // 错误
    if (isError) {
      return (
        <>
          <AlertTriangle className="h-3 w-3 text-red-400" />
          <span className="text-red-400">{t('update.failed')}</span>
        </>
      );
    }

    // 有新版本
    if (hasUpdate) {
      return (
        <>
          <ArrowDownCircle className="h-3 w-3 text-violet-500 animate-bounce" />
          <span className="text-text-disabled">v{currentVersion}</span>
          <ArrowRight className="h-2.5 w-2.5 text-text-disabled" />
          <span className="text-violet-500 font-semibold">v{latestVersion}</span>
          <span className="text-[10px] text-violet-500/80">{t('update.newAvailable')}</span>
        </>
      );
    }

    // 默认：当前版本
    return (
      <span className={hasUpdate ? "text-text-tertiary" : ""}>
        {currentVersion ? `v${currentVersion}` : '—'}
      </span>
    );
  };

  return (
    <>
      <div className="flex h-[var(--statusbar-height)] shrink-0 items-center justify-between border-t border-border-default/50 bg-bg-secondary px-4 text-[var(--fs-xs)] text-text-tertiary select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-text-secondary">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
            <span className="text-text-secondary tracking-wider">{moduleLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono">
          {responseTime !== undefined && (
            <span className="flex items-center gap-1 group">
              <span className="text-text-disabled">Time</span>
              <span className="text-text-secondary group-hover:text-accent transition-colors">{responseTime} ms</span>
            </span>
          )}
          {responseSize !== undefined && (
            <span className="flex items-center gap-1 group">
              <span className="text-text-disabled">Size</span>
              <span className="text-text-secondary group-hover:text-accent transition-colors">{formatSize(responseSize)}</span>
            </span>
          )}

          {/* 版本 & 更新区域 */}
          <button
            onClick={handleVersionClick}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 transition-all",
              hasUpdate
                ? "border border-violet-500/30 bg-violet-500/8 text-violet-500 hover:bg-violet-500/14 cursor-pointer"
                : isReady
                  ? "border border-emerald-500/30 bg-emerald-500/8 hover:bg-emerald-500/14 cursor-pointer"
                  : isError
                    ? "border border-red-400/30 bg-red-400/8 hover:bg-red-400/14 cursor-pointer"
                    : "text-text-disabled hover:text-text-secondary cursor-pointer",
            )}
            title={hasUpdate
              ? t('update.clickToUpdate', { version: latestVersion })
              : isChecking
                ? t('update.checking')
                : isReady
                  ? t('update.readyToRestart')
                  : t('update.clickToCheck')
            }
          >
            {renderVersionContent()}
          </button>
        </div>
      </div>

      {/* 更新确认对话框 */}
      <AnimatePresence>
        {showConfirm && updateInfo && (
          <>
            {/* 遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px]"
              onClick={() => setShowConfirm(false)}
            />
            {/* 对话框 */}
            <motion.div
              ref={confirmRef}
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="fixed left-1/2 top-1/2 z-[201] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-default/80 bg-bg-elevated shadow-[0_24px_64px_rgba(0,0,0,0.2)] backdrop-blur-xl overflow-hidden"
            >
              {/* 顶部渐变条 */}
              <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />

              <div className="p-6 space-y-5">
                {/* 标题 */}
                <div className="space-y-1">
                  <h3 className="text-[var(--fs-lg)] font-bold text-text-primary">
                    {t('update.confirmTitle')}
                  </h3>
                  <p className="text-[var(--fs-sm)] text-text-tertiary">
                    {t('update.confirmDesc', { version: updateInfo.version })}
                  </p>
                </div>

                {/* 版本对比 */}
                <div className="flex items-center gap-3 rounded-xl border border-border-default/60 bg-bg-secondary/60 px-4 py-3">
                  <div className="flex-1 text-center">
                    <div className="text-[var(--fs-xxs)] text-text-disabled uppercase tracking-wider mb-1">
                      {t('update.currentVersion')}
                    </div>
                    <div className="text-[var(--fs-base)] font-mono font-semibold text-text-secondary">
                      v{currentVersion}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-text-disabled shrink-0" />
                  <div className="flex-1 text-center">
                    <div className="text-[var(--fs-xxs)] text-violet-500/80 uppercase tracking-wider mb-1">
                      {t('update.latestVersion')}
                    </div>
                    <div className="text-[var(--fs-base)] font-mono font-bold text-violet-500">
                      v{updateInfo.version}
                    </div>
                  </div>
                </div>

                {/* Release Notes */}
                {updateInfo.body && (
                  <div className="rounded-xl border border-border-default/40 bg-bg-primary/60 p-3 max-h-[120px] overflow-y-auto">
                    <p className="text-[var(--fs-xs)] text-text-secondary leading-relaxed whitespace-pre-wrap">
                      {updateInfo.body.replace(/^#+\s.*$/gm, '').trim().slice(0, 400)}
                    </p>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="flex-1 h-9 rounded-xl text-[var(--fs-sm)] font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover border border-border-default/60 transition-colors"
                  >
                    {t('update.later')}
                  </button>
                  <button
                    onClick={handleConfirmUpdate}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[var(--fs-sm)] font-semibold bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm hover:from-violet-600 hover:to-purple-600 transition-all active:scale-[0.97]"
                  >
                    {updateInfo.isFallback ? (
                      <><ExternalLink className="w-3.5 h-3.5" /> {t('update.goDownload')}</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" /> {t('update.downloadAndInstall')}</>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
