import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/updateStore";

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
  const initVersion = useUpdateStore((s) => s.initVersion);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const resetDismiss = useUpdateStore((s) => s.resetDismiss);

  // 初始化版本号
  useEffect(() => {
    initVersion();
  }, [initVersion]);

  const moduleLabel = t(`statusBar.${activeModule}`, { defaultValue: activeModule.toUpperCase() });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasUpdate = status === 'available' && latestVersion;
  const isChecking = status === 'checking';

  const handleVersionClick = () => {
    if (hasUpdate) {
      // 有更新时，取消 dismiss 让 UpdateChecker 弹窗显示
      resetDismiss();
    } else if (status !== 'checking' && status !== 'downloading') {
      checkForUpdate();
    }
  };

  return (
    <div className="flex h-[var(--statusbar-height)] shrink-0 items-center justify-between border-t border-border-default/70 bg-bg-primary/72 px-4 text-[var(--fs-xs)] text-text-tertiary backdrop-blur-sm select-none">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-border-default/60 bg-bg-secondary/85 px-2.5 py-1 font-medium">
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

        {/* 版本区域 */}
        <button
          onClick={handleVersionClick}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-all",
            hasUpdate
              ? "border border-accent/30 bg-accent/8 text-accent hover:bg-accent/14 cursor-pointer"
              : "text-text-disabled hover:text-text-secondary cursor-pointer",
          )}
          title={hasUpdate
            ? t('update.clickToUpdate', { version: latestVersion })
            : isChecking
              ? t('update.checking')
              : t('update.clickToCheck')
          }
        >
          {isChecking && (
            <RefreshCw className="h-3 w-3 animate-spin text-accent" />
          )}
          {hasUpdate && (
            <>
              <ArrowDownCircle className="h-3 w-3 text-accent animate-bounce" />
              <span className="text-[10px] font-semibold text-accent">
                v{latestVersion}
              </span>
              <span className="text-text-disabled">·</span>
            </>
          )}
          <span className={hasUpdate ? "text-text-tertiary" : ""}>
            {currentVersion ? `v${currentVersion}` : '—'}
          </span>
        </button>
      </div>
    </div>
  );
}
