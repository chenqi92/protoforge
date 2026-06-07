import {
  Map,
  Monitor,
  Moon,
  Puzzle,
  Search,
  Settings,
  Sun,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Tooltip } from "@/components/common/Tooltip";
import { useWindowFrameGestures } from "@/hooks/useWindowFrameGestures";

interface TitleBarProps {
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({ onOpenPlugins, onOpenSettings }: TitleBarProps) {
  const { t, i18n } = useTranslation();
  const { mode, resolved, toggle } = useThemeStore();
  const frameGestures = useWindowFrameGestures();
  const zh = i18n.language?.startsWith("zh") ?? true;

  const toggleLanguage = () => {
    // settingsStore is the source of truth; useLanguageSync drives i18n from it.
    useSettingsStore.getState().update("language", zh ? "en" : "zh-CN");
  };

  const cycleTheme = () => {
    toggle();
    const nextModes = ["light", "dark", "system"] as const;
    const nextIndex = (nextModes.indexOf(mode) + 1) % nextModes.length;
    useSettingsStore.getState().update("theme", nextModes[nextIndex]);
  };

  return (
    <div
      {...frameGestures}
      data-titlebar
      className="relative flex h-[var(--titlebar-height)] shrink-0 items-center gap-2.5 border-b border-border-default bg-bg-primary pl-3 pr-2.5 select-none"
    >
      {/* macOS traffic-light spacer */}
      <div className="w-[70px] shrink-0" />

      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2 no-drag">
        <div
          className="flex h-[22px] w-[22px] items-center justify-center rounded-md shadow-[0_2px_8px_var(--color-accent-muted)]"
          style={{
            backgroundImage:
              "linear-gradient(150deg, var(--color-accent), #c2410c)",
          }}
        >
          <Zap className="h-[13px] w-[13px] text-white" />
        </div>
        <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-text-primary">
          Proto<b className="font-bold text-accent">Forge</b>
        </span>
      </div>

      {/* ⌘K command pill — left-aligned right after the brand (Forge .tb-cmd) */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("toggle-command-palette"))}
        className="no-drag flex h-6 min-w-[320px] max-w-[460px] items-center gap-2 rounded-[7px] border border-border-default bg-bg-app pl-[9px] pr-2 pf-text-xs text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
      >
        <Search className="h-[13px] w-[13px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {t('app.titleBar.searchPlaceholder', '搜索请求 / 命令 / 集合…')}
        </span>
        <span className="shrink-0 rounded-[4px] border border-border-default border-b-2 bg-bg-tertiary px-[5px] py-px font-mono text-[10.5px] leading-[1.3] text-text-secondary">
          ⌘K
        </span>
      </button>

      {/* spacer pushes actions to the right */}
      <div className="min-w-0 flex-1" />

      {/* Right actions — flat icon row (Forge .tb-actions) */}
      <div className="flex shrink-0 items-center gap-0.5 no-drag">
        <Tooltip content={t('app.titleBar.designRationale', '设计说明 / 站点图')}>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("open-design-system"))}
            aria-label={t('app.titleBar.designRationale', '设计说明 / 站点图')}
            className="flex h-7 w-7 items-center justify-center pf-rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <Map className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={t('titleBar.plugins')}>
          <button
            type="button"
            onClick={onOpenPlugins}
            aria-label={t('titleBar.plugins')}
            className="flex h-7 w-7 items-center justify-center pf-rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <Puzzle className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={zh ? "English" : t('app.titleBar.switchToZh', '中文')}>
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex h-7 w-7 items-center justify-center pf-rounded-md pf-text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            {zh ? "EN" : t('app.titleBar.langIndicatorZh', '中')}
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={cycleTheme}
          className="flex h-7 w-7 items-center justify-center pf-rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          title={mode === "system" ? t('titleBar.themeSystem') : mode === "dark" ? t('titleBar.themeDark') : t('titleBar.themeLight')}
        >
          {mode === "system" ? (
            <Monitor className="h-4 w-4" />
          ) : resolved === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
        <Tooltip content={t('titleBar.settings')}>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t('titleBar.settings')}
            className="flex h-7 w-7 items-center justify-center pf-rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <Settings className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
