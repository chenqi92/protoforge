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
  Cookie,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/updateStore";
import { useCookieJarStore } from "@/stores/cookieJarStore";
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

  const error = useUpdateStore((s) => s.error);

  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 初始化版本号 + 启动时静默检查更新
  useEffect(() => {
    initVersion();
    const timer = setTimeout(() => checkForUpdate(), 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击对话框外部关闭
  useEffect(() => {
    if (!showUpdateDialog) return;
    const handleClick = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setShowUpdateDialog(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUpdateDialog]);

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
    if (hasUpdate || isDownloading || isReady || isError) {
      setShowUpdateDialog(true);
    } else if (!isChecking) {
      checkForUpdate();
    }
  };

  const handleConfirmUpdate = () => {
    // 不关闭弹框，让进度在弹框内展示
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
              className="h-full bg-accent rounded-full"
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
      <div data-statusbar className="flex h-[var(--statusbar-height)] shrink-0 items-center justify-between border-t border-border-subtle bg-bg-secondary px-4 pf-text-xs text-text-tertiary select-none dark:bg-[#0f1011] dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-[510] text-text-secondary">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-text-secondary tracking-[-0.005em]">{moduleLabel}</span>
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

          {/* Cookie Jar */}
          <CookieJarButton />

          {/* 版本 & 更新区域 */}
          <button
            onClick={handleVersionClick}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 transition-all",
              hasUpdate
                ? "border border-accent/30 bg-accent-soft text-accent hover:bg-accent-muted cursor-pointer"
                : isReady
                  ? "border border-success/30 bg-success/8 text-success hover:bg-success/14 cursor-pointer"
                  : isError
                    ? "border border-error/30 bg-error/8 text-error hover:bg-error/14 cursor-pointer"
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

      {/* 更新对话框 — 支持确认 / 下载进度 / 就绪 / 错误 等多状态 */}
      <AnimatePresence>
        {showUpdateDialog && (
          <>
            {/* 遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px]"
              onClick={() => setShowUpdateDialog(false)}
            />
            {/* 对话框 */}
            <motion.div
              ref={dialogRef}
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="fixed left-1/2 top-1/2 z-[201] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-default/80 bg-bg-elevated shadow-[0_24px_64px_rgba(0,0,0,0.2)] backdrop-blur-xl overflow-hidden"
            >
              {/* 顶部状态条 */}
              <div className={cn("h-1", isReady ? "bg-emerald-500" : isError ? "bg-red-500" : "bg-accent")} />

              <div className="p-6 space-y-5">

                {/* ── 下载中状态 ── */}
                {isDownloading && (
                  <>
                    <div className="space-y-1">
                      <h3 className="pf-text-lg font-bold text-text-primary">
                        {t('update.downloadingTitle')}
                      </h3>
                      <p className="pf-text-sm text-text-tertiary">
                        {t('update.downloadingDesc', { version: updateInfo?.version })}
                      </p>
                    </div>

                    {/* 进度条 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between pf-text-sm">
                        <span className="text-text-tertiary">{t('update.progress')}</span>
                        <span className="font-mono font-semibold text-accent">{progress}%</span>
                      </div>
                      <div className="w-full h-2.5 bg-bg-input rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-accent rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3, ease: 'easeOut' }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => setShowUpdateDialog(false)}
                        className="flex-1 h-9 rounded-xl pf-text-sm font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover border border-border-default/60 transition-colors"
                      >
                        {t('update.backgroundDownload')}
                      </button>
                    </div>
                  </>
                )}

                {/* ── 更新就绪状态 ── */}
                {isReady && (
                  <>
                    <div className="flex flex-col items-center text-center gap-3 py-2">
                      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10">
                        <CheckCircle className="h-6 w-6 text-emerald-500" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="pf-text-lg font-bold text-text-primary">
                          {t('update.readyTitle')}
                        </h3>
                        <p className="pf-text-sm text-text-tertiary">
                          {t('update.readyDesc', { version: updateInfo?.version })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => setShowUpdateDialog(false)}
                        className="flex-1 h-9 rounded-xl pf-text-sm font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover border border-border-default/60 transition-colors"
                      >
                        {t('update.later')}
                      </button>
                      <button
                        onClick={restartApp}
                        className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl pf-text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm transition-all active:scale-[0.97]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('update.restart')}
                      </button>
                    </div>
                  </>
                )}

                {/* ── 错误状态 ── */}
                {isError && (
                  <>
                    <div className="flex flex-col items-center text-center gap-3 py-2">
                      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10">
                        <AlertTriangle className="h-6 w-6 text-red-400" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="pf-text-lg font-bold text-text-primary">
                          {t('update.errorTitle')}
                        </h3>
                        <p className="pf-text-sm text-text-tertiary">
                          {t('update.errorDesc', { error: error || t('update.failed') })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => setShowUpdateDialog(false)}
                        className="flex-1 h-9 rounded-xl pf-text-sm font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover border border-border-default/60 transition-colors"
                      >
                        {t('update.close')}
                      </button>
                      <button
                        onClick={() => checkForUpdate()}
                        className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl pf-text-sm font-semibold bg-accent hover:bg-accent-hover text-white shadow-sm transition-all active:scale-[0.97]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('update.retry')}
                      </button>
                    </div>
                  </>
                )}

                {/* ── 有新版本 — 确认更新 ── */}
                {hasUpdate && updateInfo && (
                  <>
                    <div className="space-y-1">
                      <h3 className="pf-text-lg font-bold text-text-primary">
                        {t('update.confirmTitle')}
                      </h3>
                      <p className="pf-text-sm text-text-tertiary">
                        {t('update.confirmDesc', { version: updateInfo.version })}
                      </p>
                    </div>

                    {/* 版本对比 */}
                    <div className="flex items-center gap-3 rounded-xl border border-border-default/60 bg-bg-secondary/60 px-4 py-3">
                      <div className="flex-1 text-center">
                        <div className="pf-text-xxs text-text-disabled uppercase tracking-wider mb-1">
                          {t('update.currentVersion')}
                        </div>
                        <div className="pf-text-base font-mono font-semibold text-text-secondary">
                          v{currentVersion}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-text-disabled shrink-0" />
                      <div className="flex-1 text-center">
                        <div className="pf-text-xxs text-violet-500/80 uppercase tracking-wider mb-1">
                          {t('update.latestVersion')}
                        </div>
                        <div className="pf-text-base font-mono font-bold text-violet-500">
                          v{updateInfo.version}
                        </div>
                      </div>
                    </div>

                    {/* Release Notes */}
                    {updateInfo.body && (
                      <div className="rounded-xl border border-border-default/40 bg-bg-primary/60 p-3 max-h-[120px] overflow-y-auto">
                        <p className="pf-text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                          {updateInfo.body.replace(/^#+\s.*$/gm, '').trim().slice(0, 400)}
                        </p>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => setShowUpdateDialog(false)}
                        className="flex-1 h-9 rounded-xl pf-text-sm font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover border border-border-default/60 transition-colors"
                      >
                        {t('update.later')}
                      </button>
                      <button
                        onClick={handleConfirmUpdate}
                        className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl pf-text-sm font-semibold bg-accent hover:bg-accent-hover text-white shadow-sm transition-all active:scale-[0.97]"
                      >
                        {updateInfo.isFallback ? (
                          <><ExternalLink className="w-3.5 h-3.5" /> {t('update.goDownload')}</>
                        ) : (
                          <><Download className="w-3.5 h-3.5" /> {t('update.downloadAndInstall')}</>
                        )}
                      </button>
                    </div>
                  </>
                )}

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function CookieJarButton() {
  const { t } = useTranslation();
  const cookieCount = useCookieJarStore((s) => s.cookies.length);

  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("open-cookie-manager"))}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-text-disabled transition-all hover:text-text-secondary"
      title={t("cookieManager.title")}
    >
      <Cookie className="h-3 w-3" />
      {cookieCount > 0 && (
        <span className="font-semibold text-amber-500">{cookieCount}</span>
      )}
    </button>
  );
}
