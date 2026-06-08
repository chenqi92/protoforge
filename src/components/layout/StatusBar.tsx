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
  Box,
  Sliders,
  Puzzle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/updateStore";
import { useCookieJarStore } from "@/stores/cookieJarStore";
import { useEnvStore } from "@/stores/envStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { AnimatePresence, motion } from "framer-motion";

interface StatusBarProps {
  connectionStatus?: "connected" | "disconnected";
  responseTime?: number;
  responseSize?: number;
  activeModule: string;
  /** Whether the activity-log dock is open (drives the toggle highlight). */
  activityLogOpen?: boolean;
  /** Toggles the activity-log dock (also wired to the rail's activity button). */
  onToggleActivityLog?: () => void;
  /** Opens the plugin market modal. */
  onOpenPlugins?: () => void;
}

export function StatusBar({
  connectionStatus,
  responseTime,
  responseSize,
  activeModule,
  activityLogOpen,
  onToggleActivityLog,
  onOpenPlugins,
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

  // Environment switcher
  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeEnvId);
  const setActiveEnv = useEnvStore((s) => s.setActive);
  const fetchEnvironments = useEnvStore((s) => s.fetchEnvironments);
  const activeEnv = environments.find((e) => e.id === activeEnvId);

  // Plugin counts
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const installedCount = installedPlugins.length;
  const updatableCount = installedPlugins.filter((p) => p.hasUpdate).length;

  const { showMenu, MenuComponent } = useContextMenu();

  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 初始化版本号 + 启动时静默检查更新
  useEffect(() => {
    initVersion();
    const timer = setTimeout(() => checkForUpdate(), 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 拉取环境列表（用于底栏环境切换器）
  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  const handleEnvMenu = (e: React.MouseEvent) => {
    const entries: ContextMenuEntry[] = [];
    if (environments.length === 0) {
      entries.push({ id: "no-env", label: t("sidebar.noEnv", { defaultValue: "暂无环境" }), disabled: true, onClick: () => {} });
    } else {
      for (const env of environments) {
        const isActive = env.id === activeEnvId;
        entries.push({
          id: env.id,
          label: env.name,
          icon: isActive ? <Check className="w-3.5 h-3.5" /> : <Box className="w-3.5 h-3.5" />,
          onClick: () => void setActiveEnv(isActive ? null : env.id),
        });
      }
    }
    entries.push({ type: "divider" });
    entries.push({
      id: "manage",
      label: t("sidebar.manageEnv", { defaultValue: "管理环境…" }),
      icon: <Sliders className="w-3.5 h-3.5" />,
      onClick: () => window.dispatchEvent(new CustomEvent("open-env-modal")),
    });
    showMenu(e, entries);
  };

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
          <CheckCircle className="h-3 w-3 text-success" />
          <span className="font-medium text-success">{t('update.readyToRestart')}</span>
        </>
      );
    }

    // 错误
    if (isError) {
      return (
        <>
          <AlertTriangle className="h-3 w-3 text-error" />
          <span className="text-error">{t('update.failed')}</span>
        </>
      );
    }

    // 有新版本
    if (hasUpdate) {
      return (
        <>
          <ArrowDownCircle className="h-3 w-3 animate-bounce text-accent" />
          <span className="text-text-tertiary">v{currentVersion}</span>
          <ArrowRight className="h-2.5 w-2.5 text-text-tertiary" />
          <span className="font-semibold text-accent">v{latestVersion}</span>
          <span className="text-[10px] font-semibold text-accent">{t('update.newAvailable')}</span>
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
      <div data-statusbar className="flex h-[var(--statusbar-height)] shrink-0 items-stretch border-t border-border-default bg-bg-primary px-1 text-[11.5px] text-text-secondary select-none">
        <div className="flex items-stretch">
          {/* Active-domain module label (accented cell) */}
          <div className="flex items-center gap-1.5 border-r border-border-subtle bg-accent-soft px-[9px] font-semibold text-accent">
            <Box className="h-3 w-3" />
            <span className="tracking-[-0.005em]">{moduleLabel}</span>
          </div>

          {/* Environment switcher */}
          <button
            onClick={handleEnvMenu}
            onContextMenu={handleEnvMenu}
            className="flex items-center gap-1.5 border-r border-border-subtle px-[9px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={t("sidebar.switchEnv", { defaultValue: "切换环境" })}
          >
            <Box className="h-3 w-3" />
            <span className={cn(activeEnv && "text-text-secondary font-medium")}>
              {activeEnv ? activeEnv.name : t("sidebar.noEnv", { defaultValue: "无环境" })}
            </span>
          </button>

          {/* Connection state — idle / connected via .pf-dot */}
          {connectionStatus && (
            <span
              className={cn(
                "flex items-center gap-1.5 border-r border-border-subtle px-[9px]",
                connectionStatus === "connected" ? "text-success" : "text-text-tertiary",
              )}
            >
              <span className={cn("pf-dot", connectionStatus === "connected" ? "s-live" : "s-idle")} />
              <span className="font-medium">
                {connectionStatus === "connected"
                  ? t("statusBar.connected", { defaultValue: "已连接" })
                  : t("statusBar.disconnected", { defaultValue: "未连接" })}
              </span>
            </span>
          )}

          {responseTime !== undefined && (
            <span className="group flex items-center gap-1.5 border-r border-border-subtle px-[9px]">
              <span className="text-text-tertiary">Time</span>
              <span className="font-mono tabular-nums text-text-secondary transition-colors group-hover:text-accent">{responseTime} ms</span>
            </span>
          )}
          {responseSize !== undefined && (
            <span className="group flex items-center gap-1.5 border-r border-border-subtle px-[9px]">
              <span className="text-text-tertiary">Size</span>
              <span className="font-mono tabular-nums text-text-secondary transition-colors group-hover:text-accent">{formatSize(responseSize)}</span>
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-stretch">
          {/* Cookie Jar */}
          <CookieJarButton />

          {/* Activity-log toggle */}
          {onToggleActivityLog && (
            <button
              onClick={onToggleActivityLog}
              className={cn(
                "flex items-center gap-1.5 border-l border-border-subtle px-[9px] transition-colors",
                activityLogOpen ? "bg-accent-soft font-semibold text-accent" : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
              )}
              title={t("rightSidebar.logs", { defaultValue: "活动日志" })}
            >
              <span className="pf-dot s-live" />
              <span>{t("rightSidebar.logs", { defaultValue: "活动日志" })}</span>
            </button>
          )}

          {/* Plugin count */}
          <button
            onClick={() => onOpenPlugins?.()}
            className="flex items-center gap-1.5 border-l border-border-subtle px-[9px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={t("titleBar.plugins", { defaultValue: "插件" })}
          >
            <Puzzle className="h-3 w-3" />
            <span>{installedCount}</span>
            {updatableCount > 0 && (
              <span className="font-bold text-accent">· {updatableCount}↑</span>
            )}
          </button>

          {/* 版本 & 更新区域 */}
          <button
            onClick={handleVersionClick}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 border-l border-border-subtle px-[9px] transition-colors",
              hasUpdate
                ? "bg-accent-soft font-semibold text-accent hover:bg-accent-muted"
                : isReady
                  ? "bg-success/[0.12] font-semibold text-success hover:bg-success/20"
                  : isError
                    ? "bg-error/[0.12] font-semibold text-error hover:bg-error/20"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
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

      {MenuComponent}

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
              className="fixed left-1/2 top-1/2 z-[201] w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border-strong bg-bg-elevated shadow-2xl"
            >
              {/* 顶部状态条 */}
              <div className={cn("h-1", isReady ? "bg-success" : isError ? "bg-error" : "bg-accent")} />

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
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                        <CheckCircle className="h-6 w-6 text-success" />
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
                        className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-success pf-text-sm font-semibold text-white shadow-sm transition-all hover:bg-success/85 active:scale-[0.97]"
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
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
                        <AlertTriangle className="h-6 w-6 text-error" />
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
                      <ArrowRight className="h-4 w-4 shrink-0 text-text-disabled" />
                      <div className="flex-1 text-center">
                        <div className="mb-1 pf-text-xxs uppercase tracking-wider text-accent/80">
                          {t('update.latestVersion')}
                        </div>
                        <div className="pf-text-base font-mono font-bold text-accent">
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
      className="flex items-center gap-1.5 border-l border-border-subtle px-[9px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
      title={t("cookieManager.title")}
    >
      <Cookie className="h-3 w-3" />
      <span>cookies</span>
      {cookieCount > 0 && (
        <span className="font-semibold text-warning">{cookieCount}</span>
      )}
    </button>
  );
}
