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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore, type AppSettings } from "@/stores/settingsStore";
import { useThemeStore } from "@/stores/themeStore";
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
  label: string;
  desc: string;
  icon: LucideIcon;
  accentClassName: string;
};

const sections: SectionMeta[] = [
  {
    id: "general",
    label: "通用",
    desc: "主题、语言和界面偏好",
    icon: Globe,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "request",
    label: "请求",
    desc: "请求默认值和安全行为",
    icon: Send,
    accentClassName: "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15",
  },
  {
    id: "proxy",
    label: "代理",
    desc: "代理连接和认证信息",
    icon: Shield,
    accentClassName: "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/15",
  },
  {
    id: "data",
    label: "数据",
    desc: "历史、保存与本地数据策略",
    icon: Database,
    accentClassName: "bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/15",
  },
];

const inputClassName =
  "h-9 rounded-[12px] border border-border-default/80 bg-bg-secondary/60 px-3 text-[12px] text-text-primary outline-none transition-all focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]";
const selectTriggerClassName =
  "h-9 rounded-[12px] border-border-default/80 bg-bg-secondary/60 text-[12px] shadow-none";
const selectContentClassName =
  "rounded-[16px] border-border-default/80 bg-bg-primary/96 shadow-[0_20px_60px_rgba(15,23,42,0.14)]";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionId>("general");
  const { settings, update, reset } = useSettingsStore();
  const { setMode } = useThemeStore();

  const currentSection = useMemo(
    () => sections.find((item) => item.id === section) ?? sections[0],
    [section]
  );

  const CurrentSectionIcon = currentSection.icon;

  const handleThemeChange = (theme: AppSettings["theme"]) => {
    update("theme", theme);
    setMode(theme);
  };

  const handleReset = () => {
    if (confirm("确定恢复所有设置为默认值？")) {
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
        className="w-[920px] max-w-[94vw] min-h-[560px] max-h-[86vh] gap-0 overflow-hidden rounded-[28px] border border-white/65 bg-bg-primary/96 p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl sm:max-w-[920px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">设置</DialogTitle>

        <div className="flex h-full min-h-[560px] flex-col">
          <div className="flex shrink-0 items-start justify-between border-b border-border-default/75 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_12px_28px_rgba(37,99,235,0.24)]">
                <Settings className="h-5 w-5 text-white" />
              </div>

              <div className="min-w-0">
                <p className="text-[16px] font-semibold tracking-tight text-text-primary">偏好设置</p>
                <p className="mt-1 text-[12px] leading-6 text-text-secondary">
                  管理主题、请求行为、代理连接和本地数据策略。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border-default/75 bg-bg-secondary/60 px-3 py-1 text-[11px] font-medium text-text-secondary">
                当前分类: {currentSection.label}
              </span>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-[14px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border-default/75 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] p-5 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="px-1 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  分类导航
                </p>
                <p className="mt-2 text-[11px] leading-5 text-text-tertiary">
                  选择要调整的工作台区域，右侧会显示对应设置项。
                </p>
              </div>

              <div className="space-y-1.5">
                {sections.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === section;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setSection(item.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-left transition-all",
                        isActive
                          ? "bg-bg-primary/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-border-default"
                          : "text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] transition-colors",
                          isActive ? item.accentClassName : "bg-bg-secondary/80 text-text-disabled"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-text-primary">{item.label}</div>
                        <div className="mt-1 text-[11px] leading-5 text-text-tertiary">{item.desc}</div>
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

              <div className="mt-auto pt-5">
                <button
                  onClick={handleReset}
                  className="flex w-full items-center gap-2 rounded-[16px] border border-border-default/75 bg-bg-primary/72 px-3.5 py-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-red-500/8 hover:text-red-500"
                >
                  <RotateCcw className="h-4 w-4" />
                  恢复默认设置
                </button>
              </div>
            </aside>

            <section className="flex min-w-0 flex-col bg-bg-primary/36">
              <div className="flex-1 overflow-y-auto p-6">
                <div className="overflow-hidden rounded-[24px] border border-border-default/75 bg-bg-primary/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="border-b border-border-default/70 px-6 py-5">
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px]",
                          currentSection.accentClassName
                        )}
                      >
                        <CurrentSectionIcon className="h-4.5 w-4.5" />
                      </div>

                      <div className="min-w-0">
                        <p className="text-[17px] font-semibold tracking-tight text-text-primary">
                          {currentSection.label}
                        </p>
                        <p className="mt-1 text-[12px] leading-6 text-text-secondary">
                          {currentSection.desc}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-border-default/70">
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
        <div className="text-[13px] font-semibold text-text-primary">{label}</div>
        {desc ? (
          <p className="mt-1.5 max-w-[520px] text-[11px] leading-5 text-text-tertiary">
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
    <div className="flex items-center gap-1 rounded-[14px] border border-border-default/75 bg-bg-secondary/60 p-1">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[11px] px-3 text-[12px] font-medium transition-all",
              isActive
                ? "bg-bg-primary text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_2px_rgba(15,23,42,0.06)]"
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

type SectionProps = {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

function GeneralSection({
  settings,
  update,
  onThemeChange,
}: SectionProps & { onThemeChange: (theme: AppSettings["theme"]) => void }) {
  return (
    <>
      <SettingRow label="外观主题" desc="控制应用配色方案以及日夜模式行为。">
        <SegmentedControl
          value={settings.theme}
          onChange={onThemeChange}
          options={[
            { value: "light", label: "浅色", icon: Sun },
            { value: "dark", label: "深色", icon: Moon },
            { value: "system", label: "跟随系统", icon: Monitor },
          ]}
        />
      </SettingRow>

      <SettingRow label="界面字号" desc="调整编辑器和界面的默认字体大小。">
        <Select
          value={String(settings.fontSize)}
          onValueChange={(value) => update("fontSize", Number(value) as AppSettings["fontSize"])}
        >
          <SelectTrigger size="sm" className={cn(selectTriggerClassName, "w-32")}>
            <SelectValue />
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

      <SettingRow label="字体" desc="代码区域默认使用的字体族。">
        <Select
          value={settings.fontFamily}
          onValueChange={(value) => update("fontFamily", value as AppSettings["fontFamily"])}
        >
          <SelectTrigger size="sm" className={cn(selectTriggerClassName, "w-36")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="mono">等宽字体</SelectItem>
            <SelectItem value="system">系统字体</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="界面语言" desc="切换应用界面语言。">
        <Select
          value={settings.language}
          onValueChange={(value) => update("language", value as AppSettings["language"])}
        >
          <SelectTrigger size="sm" className={cn(selectTriggerClassName, "w-32")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="zh-CN">中文</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </>
  );
}

function RequestSection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow
        label="默认超时时间"
        desc="HTTP 请求的默认超时，仍可在单个请求中覆盖。"
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
          <span className="text-[11px] text-text-tertiary">ms</span>
        </div>
      </SettingRow>

      <SettingRow label="自动跟随重定向" desc="发送请求时自动跟随 HTTP 3xx 重定向。">
        <Switch
          checked={settings.followRedirects}
          onCheckedChange={(checked) => update("followRedirects", checked)}
        />
      </SettingRow>

      {settings.followRedirects ? (
        <SettingRow label="最大重定向次数" desc="防止无限重定向，超过此次数后会报错。">
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
        label="SSL 证书验证"
        desc="关闭后可访问自签名 HTTPS 接口，不建议在生产环境关闭。"
      >
        <Switch
          checked={settings.sslVerify}
          onCheckedChange={(checked) => update("sslVerify", checked)}
        />
      </SettingRow>

      <SettingRow label="自动保存 Cookie" desc="自动保存响应中的 Cookie 并供后续请求复用。">
        <Switch
          checked={settings.autoSaveCookies}
          onCheckedChange={(checked) => update("autoSaveCookies", checked)}
        />
      </SettingRow>
    </>
  );
}

function ProxySection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow label="启用代理" desc="通过代理服务器发送 HTTP 请求。">
        <Switch
          checked={settings.proxyEnabled}
          onCheckedChange={(checked) => update("proxyEnabled", checked)}
        />
      </SettingRow>

      {settings.proxyEnabled ? (
        <>
          <SettingRow label="代理类型" desc="选择当前请求链路使用的代理协议。">
            <SegmentedControl
              value={settings.proxyType}
              onChange={(value) => update("proxyType", value)}
              options={[
                { value: "http", label: "HTTP" },
                { value: "socks5", label: "SOCKS5" },
              ]}
            />
          </SettingRow>

          <SettingRow label="主机地址" desc="代理服务监听地址，例如 127.0.0.1。">
            <input
              value={settings.proxyHost}
              onChange={(e) => update("proxyHost", e.target.value)}
              placeholder="127.0.0.1"
              className={cn(inputClassName, "w-44 text-left")}
            />
          </SettingRow>

          <SettingRow label="端口" desc="代理服务使用的端口号。">
            <input
              type="number"
              value={settings.proxyPort}
              onChange={(e) => update("proxyPort", parseInt(e.target.value, 10) || 8080)}
              min={1}
              max={65535}
              className={cn(inputClassName, "w-24 text-center font-mono")}
            />
          </SettingRow>

          <SettingRow label="代理认证" desc="如果代理需要用户名和密码，请启用此项。">
            <Switch
              checked={settings.proxyAuth}
              onCheckedChange={(checked) => update("proxyAuth", checked)}
            />
          </SettingRow>

          {settings.proxyAuth ? (
            <>
              <SettingRow label="用户名">
                <input
                  value={settings.proxyUsername}
                  onChange={(e) => update("proxyUsername", e.target.value)}
                  className={cn(inputClassName, "w-44 text-left")}
                />
              </SettingRow>

              <SettingRow label="密码">
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
  return (
    <>
      <SettingRow
        label="最大历史记录"
        desc="超过数量后，系统会自动清理最早的历史请求。"
      >
        <Select
          value={String(settings.maxHistoryCount)}
          onValueChange={(value) => {
            if (value) update("maxHistoryCount", parseInt(value, 10));
          }}
        >
          <SelectTrigger size="sm" className={cn(selectTriggerClassName, "w-36")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="50">50 条</SelectItem>
            <SelectItem value="100">100 条</SelectItem>
            <SelectItem value="200">200 条</SelectItem>
            <SelectItem value="500">500 条</SelectItem>
            <SelectItem value="1000">1000 条</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="自动保存间隔"
        desc="定时保存当前请求内容，0 表示关闭自动保存。"
      >
        <Select
          value={String(settings.autoSaveInterval)}
          onValueChange={(value) => {
            if (value) update("autoSaveInterval", parseInt(value, 10));
          }}
        >
          <SelectTrigger size="sm" className={cn(selectTriggerClassName, "w-36")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClassName}>
            <SelectItem value="0">不自动保存</SelectItem>
            <SelectItem value="30">每 30 秒</SelectItem>
            <SelectItem value="60">每 1 分钟</SelectItem>
            <SelectItem value="300">每 5 分钟</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </>
  );
}
