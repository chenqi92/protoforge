import { useMemo, useState } from "react";
import {
  type LucideIcon,
  Settings,
  Sliders,
  Globe,
  Send,
  Shield,
  Command,
  Database,
  Info,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  X,
  Search,
  RefreshCw,
  Download,
  CheckCircle,
  Zap,
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

type SectionId = "appearance" | "general" | "request" | "proxy" | "shortcuts" | "data" | "about";

type SectionMeta = {
  id: SectionId;
  label: string; // zh / en inline fallback when no i18n key
  labelKey?: string;
  icon: LucideIcon;
};

// Forge accent classes for the active section icon (replaces hardcoded palette)
const sections: SectionMeta[] = [
  { id: "appearance", label: "外观", labelKey: "settings.sections.appearance", icon: Sliders },
  { id: "general", label: "通用", labelKey: "settings.sections.general", icon: Globe },
  { id: "request", label: "请求", labelKey: "settings.sections.request", icon: Send },
  { id: "proxy", label: "代理", labelKey: "settings.sections.proxy", icon: Shield },
  { id: "shortcuts", label: "快捷键", labelKey: "settings.sections.shortcuts", icon: Command },
  { id: "data", label: "数据与存储", labelKey: "settings.sections.data", icon: Database },
  { id: "about", label: "关于", labelKey: "settings.sections.about", icon: Info },
];

const inputClassName =
  "wb-field";
const selectTriggerClassName =
  "";
const selectContentClassName =
  "p-1";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionId>("appearance");
  const [query, setQuery] = useState("");
  const { settings, update, reset } = useSettingsStore();
  const { setMode } = useThemeStore();
  const { t } = useTranslation();

  // section label resolver: prefer i18n key, fall back to the inline zh label
  const sectionLabel = (item: SectionMeta) => (item.labelKey ? t(item.labelKey) : item.label);

  const visibleSections = useMemo(() => {
    if (!query.trim()) return sections;
    const q = query.toLowerCase();
    return sections.filter((item) => sectionLabel(item).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t]);

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
        className="flex h-[min(86vh,720px)] w-[920px] max-w-[94vw] min-h-[560px] max-h-[86vh] flex-col gap-0 overflow-hidden rounded-[14px] border border-border-strong bg-bg-elevated p-0 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.12),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-white/[0.08] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_16px_48px_rgba(0,0,0,0.6)] sm:max-w-[920px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>

        <div className="flex h-full min-h-0 flex-1 flex-col">
          {/* Header — title + settings search box */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center pf-rounded-md bg-accent shrink-0">
                <Settings className="h-4 w-4 text-white" />
              </div>
              <p className="text-[15px] font-semibold tracking-tight text-text-primary truncate">{t('settings.title')}</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 h-8 px-2.5 pf-rounded-md bg-bg-secondary border border-border-default text-text-tertiary focus-within:border-accent/50 transition-colors">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('settings.searchPlaceholder', { defaultValue: '搜索设置…' })}
                  className="w-32 bg-transparent pf-text-xs text-text-primary placeholder:text-text-disabled outline-none"
                />
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center pf-rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t('settings.close')}</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[188px_minmax(0,1fr)]">
            {/* Nav — dense tree-row list */}
            <aside className="flex min-h-0 flex-col border-r border-border-default bg-bg-secondary/40">
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <div className="space-y-0.5">
                  {visibleSections.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === section;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "relative flex w-full items-center gap-2.5 h-8 pf-rounded-md px-2.5 text-left transition-colors",
                          isActive
                            ? "bg-accent-soft text-text-primary before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
                            : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-accent" : "text-text-tertiary")} />
                        <span className="pf-text-sm font-medium truncate">{sectionLabel(item)}</span>
                      </button>
                    );
                  })}
                  {visibleSections.length === 0 && (
                    <div className="px-2.5 py-6 text-center pf-text-xs text-text-disabled">
                      {t('settings.noMatch', { defaultValue: '无匹配项' })}
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-border-default/60 p-2">
                <button
                  onClick={handleReset}
                  className="flex w-full items-center justify-center gap-2 h-8 pf-rounded-md border border-border-default bg-bg-primary/60 pf-text-xs font-medium text-text-secondary transition-colors hover:bg-error/10 hover:text-error hover:border-error/30"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('settings.resetDefaults')}
                </button>
              </div>
            </aside>

            {/* Section content */}
            <section className="flex min-w-0 min-h-0 flex-col bg-bg-primary/40">
              <div className="flex shrink-0 items-center gap-2.5 border-b border-border-default/60 px-5 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center pf-rounded-md bg-accent-soft text-accent">
                  <CurrentSectionIcon className="h-3.5 w-3.5" />
                </div>
                <p className="pf-text-sm font-semibold tracking-tight text-text-primary">
                  {sectionLabel(currentSection)}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="divide-y divide-border-subtle">
                  {section === "appearance" && (
                    <AppearanceSection
                      settings={settings}
                      update={update}
                      onThemeChange={handleThemeChange}
                    />
                  )}
                  {section === "general" && (
                    <GeneralSection settings={settings} update={update} />
                  )}
                  {section === "request" && (
                    <RequestSection settings={settings} update={update} />
                  )}
                  {section === "proxy" && (
                    <ProxySection settings={settings} update={update} />
                  )}
                  {section === "shortcuts" && <ShortcutsSection />}
                  {section === "data" && (
                    <DataSection settings={settings} update={update} />
                  )}
                  {section === "about" && <AboutSection />}
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
    <div className="grid gap-4 px-5 py-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="pf-text-sm text-text-primary">{label}</div>
        {desc ? (
          <p className="mt-0.5 max-w-[520px] pf-text-xs leading-[1.4] text-text-tertiary">
            {desc}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-start lg:justify-end">{children}</div>
    </div>
  );
}

// Section group header (.sechead) — 11px uppercase tracked label dividing a section
function SettingGroup({ title }: { title: string }) {
  return (
    <div className="px-5 pt-4 pb-1">
      <div className="pf-text-xxs font-bold uppercase tracking-[0.06em] text-text-tertiary">{title}</div>
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
    <div className="flex items-center gap-0.5 pf-rounded-md border border-border-default bg-bg-secondary/60 p-0.5">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 pf-rounded-sm px-2.5 pf-text-xs font-medium transition-colors",
              isActive
                ? "bg-bg-primary text-text-primary shadow-xs"
                : "text-text-tertiary hover:text-text-primary"
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

// Accent swatches preview the four accent palettes. The per-swatch color is
// driven by a scoped --accent-swatch var (see AccentSwatchStyle) that mirrors
// the same per-accent tokens index.css defines on :root[data-accent="…"], so
// the component itself carries no literal palette colors.
const ACCENT_COLORS: { value: AccentColor; label: string }[] = [
  { value: 'indigo', label: 'Orange' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'violet', label: 'Violet' },
];

// FOUNDATION GAP: index.css exposes accent palettes only under
// :root[data-accent="…"], so the swatch previews cannot read each accent from a
// token directly. This scoped block bridges that until index.css adds
// --color-accent-{indigo|cyan|emerald|violet} (or a non-root [data-accent]
// selector), at which point this can be deleted.
const AccentSwatchStyle = () => (
  <style>{`
    [data-accent-swatch="indigo"]{--accent-swatch:#ff6b35}
    [data-accent-swatch="cyan"]{--accent-swatch:#56d4dd}
    [data-accent-swatch="emerald"]{--accent-swatch:#3fb950}
    [data-accent-swatch="violet"]{--accent-swatch:#a371f7}
  `}</style>
);

function AccentColorPicker({ value, onChange }: { value: AccentColor; onChange: (v: AccentColor) => void }) {
  return (
    <div className="flex items-center gap-2">
      <AccentSwatchStyle />
      {ACCENT_COLORS.map((item) => {
        const isActive = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            title={item.label}
            data-accent-swatch={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative h-6 w-6 pf-rounded-md bg-[var(--accent-swatch)] transition-transform",
              isActive
                ? "ring-2 ring-[color:var(--accent-swatch)] ring-offset-2 ring-offset-bg-primary"
                : "hover:scale-110"
            )}
          >
            {isActive && (
              <svg className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

type SectionProps = {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

function AppearanceSection({
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

  return (
    <>
      <SettingGroup title={t('settings.appearance.themeGroup', { defaultValue: '主题' })} />
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

      <SettingGroup title={t('settings.appearance.typographyGroup', { defaultValue: '排版' })} />
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
                    <span className="pf-pill acc h-[15px] px-1.5 text-[9px]">
                      {t('settings.general.fontPlugin')}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
    </>
  );
}

function GeneralSection({ settings, update }: SectionProps) {
  const { t } = useTranslation();
  const languageLabelMap: Record<AppSettings["language"], string> = {
    "zh-CN": t('settings.general.langZh'),
    en: t('settings.general.langEn'),
  };

  return (
    <>
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
          <span className="pf-pill acc">
            v{latestVersion}
          </span>
        )}
        {isUpToDate && (
          <span className="pf-pill ok">
            <CheckCircle className="h-3 w-3" />
            {t('update.upToDate')}
          </span>
        )}

        {isReady ? (
          <button
            onClick={restartApp}
            className="h-8 px-4 pf-text-sm font-semibold text-white bg-success hover:bg-success/90 pf-rounded-md transition-colors"
          >
            {t('update.restart')}
          </button>
        ) : hasUpdate ? (
          <button
            onClick={installUpdate}
            disabled={isDownloading}
            className="flex items-center gap-1.5 h-8 px-4 pf-text-sm font-semibold text-white bg-accent hover:bg-accent-hover pf-rounded-md transition-colors disabled:opacity-60"
          >
            <Download className={cn("h-3.5 w-3.5", isDownloading && "animate-bounce")} />
            {isDownloading ? t('update.downloading') : t('update.install')}
          </button>
        ) : (
          <button
            onClick={checkForUpdate}
            disabled={isChecking}
            className="flex items-center gap-1.5 h-8 px-4 pf-text-sm font-medium text-text-secondary border border-border-default bg-bg-primary/60 hover:bg-bg-hover pf-rounded-md transition-colors disabled:opacity-60"
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
          <span className="pf-text-xs text-text-tertiary">{t('common.ms')}</span>
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
          checked={settings.proxyEnabled === true}
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

function ShortcutsSection() {
  const { t } = useTranslation();
  const shortcuts: [string, string][] = [
    ['⌘ K', t('shortcuts.commandPalette', { defaultValue: '命令面板' })],
    ['⌘ \\', t('shortcuts.splitView', { defaultValue: '分屏' })],
    ['⌘ B', t('shortcuts.toggleSidebar', { defaultValue: '切换侧栏' })],
    ['⌘ ,', t('shortcuts.openSettings', { defaultValue: '打开设置' })],
    ['⌘ ↵', t('shortcuts.sendRequest', { defaultValue: '发送请求' })],
    ['⌘ N', t('shortcuts.newTab', { defaultValue: '新建标签' })],
    ['⌘ W', t('shortcuts.closeTab', { defaultValue: '关闭标签' })],
    ['⌘ 1–9', t('shortcuts.switchTab', { defaultValue: '切换标签' })],
    ['Esc', t('shortcuts.dismiss', { defaultValue: '关闭弹层' })],
  ];

  return (
    <div className="px-5 py-4">
      <p className="pf-text-xs text-text-tertiary mb-3">
        {t('shortcuts.hint', { defaultValue: '键盘快捷键' })}
      </p>
      <div className="divide-y divide-border-default/50">
        {shortcuts.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-2">
            <span className="pf-text-sm text-text-secondary">{label}</span>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  const currentVersion = useUpdateStore((s) => s.currentVersion);

  return (
    <div className="flex flex-col items-center gap-4 px-5 py-8">
      <div className="flex h-16 w-16 items-center justify-center pf-rounded-xl bg-gradient-to-br from-accent to-accent-hover shadow-[0_6px_20px_var(--color-accent-muted)]">
        <Zap className="h-8 w-8 text-white" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="pf-text-lg font-bold text-text-primary">ProtoForge</span>
        <span className="pf-text-xs font-mono text-text-tertiary">v{currentVersion || '—'}</span>
      </div>

      <div className="w-full max-w-[360px] overflow-hidden pf-rounded-lg border border-border-default bg-bg-secondary/40">
        <div className="px-4 py-2.5 border-b border-border-default/60">
          <div className="pf-text-3xs font-bold uppercase tracking-[0.06em] text-text-disabled">
            {t('settings.about.updateGroup', { defaultValue: '更新' })}
          </div>
        </div>
        <UpdateSettingRow />
      </div>

      <span className="pf-text-3xs text-text-disabled">© 2026 ProtoForge · MIT License</span>
    </div>
  );
}
