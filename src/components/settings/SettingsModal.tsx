import { useMemo, useState } from "react";
import {
  type LucideIcon,
  Settings,
  Globe,
  Send,
  Shield,
  Database,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  X,
  ChevronRight,
  RefreshCw,
  Download,
  CheckCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useSettingsStore, type AppSettings, type AccentColor } from "@/stores/settingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useUpdateStore } from "@/stores/updateStore";
import { BUILTIN_FONTS } from "@/hooks/useSettingsEffect";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SectionId = "general" | "request" | "proxy" | "data";

type SectionMeta = {
  id: SectionId;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  accentClassName: string;
};

const sections: SectionMeta[] = [
  {
    id: "general",
    labelKey: "settings.sections.general",
    descKey: "settings.sections.generalDesc",
    icon: Globe,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "request",
    labelKey: "settings.sections.request",
    descKey: "settings.sections.requestDesc",
    icon: Send,
    accentClassName: "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15",
  },
  {
    id: "proxy",
    labelKey: "settings.sections.proxy",
    descKey: "settings.sections.proxyDesc",
    icon: Shield,
    accentClassName: "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/15",
  },
  {
    id: "data",
    labelKey: "settings.sections.data",
    descKey: "settings.sections.dataDesc",
    icon: Database,
    accentClassName: "bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/15",
  },
];

const inputClassName =
  "wb-field";
const selectTriggerClassName =
  "";
const selectContentClassName =
  "p-1";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionId>("general");
  const { settings, update, reset } = useSettingsStore();
  const { setMode } = useThemeStore();
  const { t } = useTranslation();

  const currentSection = useMemo(
    () => sections.find((item) => item.id === section) ?? sections[0],
    [section]
  );

  const CurrentSectionIcon = currentSection.icon;

  const handleThemeChange = (theme: AppSettings["theme"]) => {
    update("theme", theme);
    setMode(theme);
  };

  const handleReset = async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm(t('settings.resetConfirm'));
    if (yes) {
      reset();
      setMode("light");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        className="flex h-[min(86vh,720px)] w-[920px] max-w-[94vw] min-h-[560px] max-h-[86vh] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border border-white/65 bg-bg-primary p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] sm:max-w-[920px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>

        <div className="flex h-full min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border-default/80 px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-xl)] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_12px_28px_rgba(37,99,235,0.24)]">
                <Settings className="h-5 w-5 text-white" />
              </div>

              <div className="min-w-0">
                <p className="text-[var(--fs-xl)] font-semibold tracking-tight text-text-primary">{t('settings.title')}</p>
                <p className="mt-1 text-[var(--fs-sm)] leading-5 text-text-secondary">
                  {t('settings.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t('settings.close')}</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border-default/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="shrink-0 px-4 pb-3 pt-4">
                <p className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  {t('settings.categoryNav')}
                </p>
                <p className="mt-2 text-[var(--fs-xs)] leading-5 text-text-tertiary">
                  {t('settings.categoryNavDesc')}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <div className="space-y-1.5">
                {sections.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === section;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setSection(item.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-[var(--radius-xl)] px-3.5 py-3 text-left transition-all",
                        isActive
                          ? "bg-bg-primary/86 shadow-xs ring-1 ring-border-default"
                          : "text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] transition-colors",
                          isActive ? item.accentClassName : "bg-bg-secondary/80 text-text-disabled"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[var(--fs-base)] font-semibold text-text-primary">{t(item.labelKey)}</div>
                        <div className="mt-1 text-[var(--fs-xs)] leading-5 text-text-tertiary">{t(item.descKey)}</div>
                      </div>

                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 transition-all",
                          isActive ? "translate-x-0 text-text-disabled opacity-100" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                        )}
                      />
                    </button>
                  );
                })}
                </div>
              </div>

              <div className="shrink-0 border-t border-border-default/60 px-3 py-3">
                <button
                  onClick={handleReset}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-xl)] border border-border-default/80 bg-bg-primary/72 px-3.5 py-3 text-[var(--fs-sm)] font-medium text-text-secondary transition-colors hover:bg-red-500/8 hover:text-red-500"
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('settings.resetDefaults')}
                </button>
              </div>
            </aside>

            <section className="flex min-w-0 min-h-0 flex-col bg-bg-primary/36">
              <div className="flex-1 overflow-y-auto p-5">
                <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border-default/80 bg-bg-primary/88 shadow-panel">
                  <div className="flex items-center gap-3 border-b border-border-default/60 px-6 py-4">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
                        currentSection.accentClassName
                      )}
                    >
                      <CurrentSectionIcon className="h-4 w-4" />
                    </div>
                  <div className="min-w-0">
                      <p className="text-[var(--fs-md)] font-semibold tracking-tight text-text-primary">
                        {t(currentSection.labelKey)}
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-border-default/60">
                    {section === "general" && (
                      <GeneralSection
                        settings={settings}
                        update={update}
                        onThemeChange={handleThemeChange}
                      />
                    )}
                    {section === "request" && (
                      <RequestSection settings={settings} update={update} />
                    )}
                    {section === "proxy" && (
                      <ProxySection settings={settings} update={update} />
                    )}
                    {section === "data" && (
                      <DataSection settings={settings} update={update} />
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="text-[var(--fs-base)] font-semibold text-text-primary">{label}</div>
        {desc ? (
          <p className="mt-1.5 max-w-[520px] text-[var(--fs-xs)] leading-5 text-text-tertiary">
            {desc}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-start lg:justify-end">{children}</div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: LucideIcon }>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-[var(--radius-lg)] border border-border-default/80 bg-bg-secondary/60 p-1">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[var(--fs-sm)] font-medium transition-all",
              isActive
                ? "bg-bg-primary text-text-primary shadow-xs"
                : "text-text-tertiary hover:bg-bg-hover/80 hover:text-text-primary"
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const ACCENT_COLORS: { value: AccentColor; color: string; label: string }[] = [
  { value: 'indigo', color: '#5b6af0', label: 'Indigo' },
  { value: 'cyan', color: '#06b6d4', label: 'Cyan' },
  { value: 'emerald', color: '#10b981', label: 'Emerald' },
  { value: 'violet', color: '#7c3aed', label: 'Violet' },
];

function AccentColorPicker({ value, onChange }: { value: AccentColor; onChange: (v: AccentColor) => void }) {
  return (
    <div className="flex items-center gap-2">
      {ACCENT_COLORS.map((item) => (
        <button
          key={item.value}
          type="button"
          title={item.label}
          onClick={() => onChange(item.value)}
          className={cn(
            "relative h-7 w-7 rounded-full transition-all",
            value === item.value
              ? "ring-2 ring-offset-2 ring-offset-bg-primary"
              : "hover:scale-110"
          )}
          style={{
            backgroundColor: item.color,
            '--tw-ring-color': value === item.value ? item.color : undefined,
          } as React.CSSProperties}
        >
          {value === item.value && (
            <svg className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

type SectionProps = {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

function GeneralSection({
  settings,
  update,
  onThemeChange,
}: SectionProps & { onThemeChange: (theme: AppSettings["theme"]) => void }) {
  const { t } = useTranslation();
  const fontSizeLabel = `${settings.fontSize}px`;

  // 合并内置字体 + 插件字体
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const allFonts = useMemo(() => {
    const fonts: { id: string; name: string; source: 'builtin' | 'plugin' }[] =
      BUILTIN_FONTS.map((f) => ({ id: f.id, name: f.name, source: 'builtin' as const }));

    for (const plugin of installedPlugins) {
      if (plugin.contributes?.fonts) {
        for (const font of plugin.contributes.fonts) {
          fonts.push({ id: font.fontId, name: font.name, source: 'plugin' });
        }
      }
    }
    return fonts;
  }, [installedPlugins]);

  const currentFontLabel = allFonts.find((f) => f.id === settings.fontFamily)?.name
    ?? (settings.fontFamily === 'system' ? t('settings.general.fontSystem') : settings.fontFamily);

  const languageLabelMap: Record<AppSettings["language"], string> = {
    "zh-CN": t('settings.general.langZh'),
    en: t('settings.general.langEn'),
  };

  return (
    <>
      <SettingRow label={t('settings.general.theme')} desc={t('settings.general.themeDesc')}>
        <SegmentedControl
          value={settings.theme}
          onChange={onThemeChange}
          options={[
            { value: "light", label: t('settings.general.themeLight'), icon: Sun },
            { value: "dark", label: t('settings.general.themeDark'), icon: Moon },
            { value: "system", label: t('settings.general.themeSystem'), icon: Monitor },
          ]}
        />
      </SettingRow>

      <SettingRow label={t('settings.general.accentColor')} desc={t('settings.general.accentColorDesc')}>
        <AccentColorPicker value={settings.accentColor} onChange={(v) => update("accentColor", v)} />
      </SettingRow>

      <SettingRow label={t('settings.general.fontSize')} desc={t('settings.general.fontSizeDesc')}>
        <Select
          value={String(settings.fontSize)}
          onValueChange={(value) => update("fontSize", Number(value) as AppSettings["fontSize"])}
        >
          <SelectTrigger size="default" className={cn(selectTriggerClassName, "w-32")}>
            <SelectValue>{fontSizeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="12">12px</SelectItem>
            <SelectItem value="13">13px</SelectItem>
            <SelectItem value="14">14px</SelectItem>
            <SelectItem value="15">15px</SelectItem>
            <SelectItem value="16">16px</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label={t('settings.general.fontFamily')} desc={t('settings.general.fontFamilyDesc')}>
        <Select
          value={settings.fontFamily || ""}
          onValueChange={(value) => update("fontFamily", value || "")}
        >
          <SelectTrigger size="default" className={cn(selectTriggerClassName, "w-48")}>
            <SelectValue>{currentFontLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            {allFonts.map((font) => (
              <SelectItem key={font.id} value={font.id}>
                <span className="flex items-center gap-2">
                  <span>{font.name}</span>
                  {font.source === 'plugin' && (
                    <span className="rounded-full bg-accent/10 px-1.5 py-0 text-[10px] font-medium text-accent">
                      {t('settings.general.fontPlugin')}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label={t('settings.general.language')} desc={t('settings.general.languageDesc')}>
        <Select
          value={settings.language}
          onValueChange={(value) => update("language", value as AppSettings["language"])}
        >
          <SelectTrigger size="default" className={cn(selectTriggerClassName, "w-32")}>
            <SelectValue>{languageLabelMap[settings.language]}</SelectValue>
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="zh-CN">{t('settings.general.langZh')}</SelectItem>
            <SelectItem value="en">{t('settings.general.langEn')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <UpdateSettingRow />
    </>
  );
}

function UpdateSettingRow() {
  const { t } = useTranslation();
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const status = useUpdateStore((s) => s.status);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const restartApp = useUpdateStore((s) => s.restartApp);

  const isChecking = status === 'checking';
  const hasUpdate = status === 'available' && latestVersion;
  const isDownloading = status === 'downloading';
  const isReady = status === 'ready';
  const isUpToDate = status === 'up-to-date';

  return (
    <SettingRow
      label={t('settings.general.checkUpdate')}
      desc={t('settings.general.checkUpdateDesc', { version: currentVersion || '—' })}
    >
      <div className="flex items-center gap-2">
        {hasUpdate && (
          <span className="text-[var(--fs-xs)] font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded">
            v{latestVersion}
          </span>
        )}
        {isUpToDate && (
          <span className="flex items-center gap-1 text-[var(--fs-xs)] text-emerald-600">
            <CheckCircle className="h-3.5 w-3.5" />
            {t('update.upToDate')}
          </span>
        )}

        {isReady ? (
          <button
            onClick={restartApp}
            className="h-8 px-4 text-[var(--fs-sm)] font-semibold text-white bg-success hover:bg-success/90 rounded-lg transition-colors"
          >
            {t('update.restart')}
          </button>
        ) : hasUpdate ? (
          <button
            onClick={installUpdate}
            disabled={isDownloading}
            className="flex items-center gap-1.5 h-8 px-4 text-[var(--fs-sm)] font-semibold text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors disabled:opacity-60"
          >
            <Download className={cn("h-3.5 w-3.5", isDownloading && "animate-bounce")} />
            {isDownloading ? t('update.downloading') : t('update.install')}
          </button>
        ) : (
          <button
            onClick={checkForUpdate}
            disabled={isChecking}
            className="flex items-center gap-1.5 h-8 px-4 text-[var(--fs-sm)] font-medium text-text-secondary border border-border-default/80 bg-bg-primary/72 hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isChecking && "animate-spin")} />
            {isChecking ? t('update.checking') : t('settings.general.checkUpdateBtn')}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

function RequestSection({ settings, update }: SectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingRow
        label={t('settings.request.timeout')}
        desc={t('settings.request.timeoutDesc')}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={settings.defaultTimeoutMs}
            onChange={(e) =>
              update("defaultTimeoutMs", Math.max(1000, parseInt(e.target.value, 10) || 1000))
            }
            min={1000}
            className={cn(inputClassName, "w-28 text-center font-mono")}
          />
          <span className="text-[var(--fs-xs)] text-text-tertiary">{t('common.ms')}</span>
        </div>
      </SettingRow>

      <SettingRow label={t('settings.request.followRedirects')} desc={t('settings.request.followRedirectsDesc')}>
        <Switch
          checked={settings.followRedirects}
          onCheckedChange={(checked) => update("followRedirects", checked)}
        />
      </SettingRow>

      {settings.followRedirects ? (
        <SettingRow label={t('settings.request.maxRedirects')} desc={t('settings.request.maxRedirectsDesc')}>
          <input
            type="number"
            value={settings.maxRedirects}
            onChange={(e) =>
              update("maxRedirects", Math.max(1, parseInt(e.target.value, 10) || 1))
            }
            min={1}
            max={20}
            className={cn(inputClassName, "w-20 text-center font-mono")}
          />
        </SettingRow>
      ) : null}

      <SettingRow
        label={t('settings.request.sslVerify')}
        desc={t('settings.request.sslVerifyDesc')}
      >
        <Switch
          checked={settings.sslVerify}
          onCheckedChange={(checked) => update("sslVerify", checked)}
        />
      </SettingRow>

      <SettingRow label={t('settings.request.autoSaveCookies')} desc={t('settings.request.autoSaveCookiesDesc')}>
        <Switch
          checked={settings.autoSaveCookies}
          onCheckedChange={(checked) => update("autoSaveCookies", checked)}
        />
      </SettingRow>
    </>
  );
}

function ProxySection({ settings, update }: SectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingRow label={t('settings.proxy.enable')} desc={t('settings.proxy.enableDesc')}>
        <Switch
          checked={settings.proxyEnabled}
          onCheckedChange={(checked) => update("proxyEnabled", checked)}
        />
      </SettingRow>

      {settings.proxyEnabled ? (
        <>
          <SettingRow label={t('settings.proxy.type')} desc={t('settings.proxy.typeDesc')}>
            <SegmentedControl
              value={settings.proxyType}
              onChange={(value) => update("proxyType", value)}
              options={[
                { value: "http", label: "HTTP" },
                { value: "socks5", label: "SOCKS5" },
              ]}
            />
          </SettingRow>

          <SettingRow label={t('settings.proxy.host')} desc={t('settings.proxy.hostDesc')}>
            <input
              value={settings.proxyHost}
              onChange={(e) => update("proxyHost", e.target.value)}
              placeholder="127.0.0.1"
              className={cn(inputClassName, "w-44 text-left")}
            />
          </SettingRow>

          <SettingRow label={t('settings.proxy.port')} desc={t('settings.proxy.portDesc')}>
            <input
              type="number"
              value={settings.proxyPort}
              onChange={(e) => update("proxyPort", parseInt(e.target.value, 10) || 8080)}
              min={1}
              max={65535}
              className={cn(inputClassName, "w-24 text-center font-mono")}
            />
          </SettingRow>

          <SettingRow label={t('settings.proxy.auth')} desc={t('settings.proxy.authDesc')}>
            <Switch
              checked={settings.proxyAuth}
              onCheckedChange={(checked) => update("proxyAuth", checked)}
            />
          </SettingRow>

          {settings.proxyAuth ? (
            <>
              <SettingRow label={t('settings.proxy.username')}>
                <input
                  value={settings.proxyUsername}
                  onChange={(e) => update("proxyUsername", e.target.value)}
                  className={cn(inputClassName, "w-44 text-left")}
                />
              </SettingRow>

              <SettingRow label={t('settings.proxy.password')}>
                <input
                  type="password"
                  value={settings.proxyPassword}
                  onChange={(e) => update("proxyPassword", e.target.value)}
                  className={cn(inputClassName, "w-44 text-left")}
                />
              </SettingRow>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function DataSection({ settings, update }: SectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <SettingRow
        label={t('settings.data.maxHistory')}
        desc={t('settings.data.maxHistoryDesc')}
      >
        <Select
          value={String(settings.maxHistoryCount)}
          onValueChange={(value) => {
            if (value) update("maxHistoryCount", parseInt(value, 10));
          }}
        >
          <SelectTrigger size="default" className={cn(selectTriggerClassName, "w-36")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="50">{t('settings.data.historyCount', { count: 50 })}</SelectItem>
            <SelectItem value="100">{t('settings.data.historyCount', { count: 100 })}</SelectItem>
            <SelectItem value="200">{t('settings.data.historyCount', { count: 200 })}</SelectItem>
            <SelectItem value="500">{t('settings.data.historyCount', { count: 500 })}</SelectItem>
            <SelectItem value="1000">{t('settings.data.historyCount', { count: 1000 })}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label={t('settings.data.autoSaveInterval')}
        desc={t('settings.data.autoSaveIntervalDesc')}
      >
        <Select
          value={String(settings.autoSaveInterval)}
          onValueChange={(value) => {
            if (value) update("autoSaveInterval", parseInt(value, 10));
          }}
        >
          <SelectTrigger size="default" className={cn(selectTriggerClassName, "w-36")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="0">{t('settings.data.noAutoSave')}</SelectItem>
            <SelectItem value="30">{t('settings.data.every30s')}</SelectItem>
            <SelectItem value="60">{t('settings.data.every1m')}</SelectItem>
            <SelectItem value="300">{t('settings.data.every5m')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </>
  );
}
