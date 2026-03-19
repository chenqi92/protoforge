/**
 * SettingsModal — 全局设置弹窗
 * 4 个分区：通用、请求、代理、数据
 */

import { useState } from 'react';
import {
  X, Settings, Globe, Send, Shield, Database,
  RotateCcw, Sun, Moon, Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore, type AppSettings } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SectionId = 'general' | 'request' | 'proxy' | 'data';

const sections: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: '通用', icon: <Globe className="w-4 h-4" /> },
  { id: 'request', label: '请求', icon: <Send className="w-4 h-4" /> },
  { id: 'proxy', label: '代理', icon: <Shield className="w-4 h-4" /> },
  { id: 'data', label: '数据', icon: <Database className="w-4 h-4" /> },
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionId>('general');
  const { settings, update, reset } = useSettingsStore();
  const { setTheme } = useThemeStore();

  if (!open) return null;

  const handleThemeChange = (theme: AppSettings['theme']) => {
    update('theme', theme);
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(isDark ? 'dark' : 'light');
    } else {
      setTheme(theme);
    }
  };

  const handleReset = () => {
    if (confirm('确定恢复所有设置为默认值？')) {
      reset();
      setTheme('light');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[760px] min-h-[480px] max-h-[80vh] bg-bg-primary rounded-2xl shadow-2xl border border-border-default flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-[180px] bg-bg-secondary/60 border-r border-border-default flex flex-col py-3 shrink-0">
          <div className="flex items-center gap-2 px-4 mb-4">
            <Settings className="w-4 h-4 text-text-secondary" />
            <span className="text-[13px] font-semibold text-text-primary">设置</span>
          </div>

          <div className="flex flex-col gap-0.5 px-2">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors',
                  section === s.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
                )}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <div className="px-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-[11px] font-medium text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复默认设置
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-default shrink-0">
            <h2 className="text-[14px] font-semibold text-text-primary">
              {sections.find((s) => s.id === section)?.label}
            </h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Settings content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {section === 'general' && <GeneralSection settings={settings} update={update} onThemeChange={handleThemeChange} />}
            {section === 'request' && <RequestSection settings={settings} update={update} />}
            {section === 'proxy' && <ProxySection settings={settings} update={update} />}
            {section === 'data' && <DataSection settings={settings} update={update} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Setting Row ── */
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-primary">{label}</div>
        {desc && <div className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ── Toggle Switch ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-bg-tertiary'
      )}
    >
      <div
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-4'
        )}
      />
    </button>
  );
}

/* ── Sections ── */

type SectionProps = {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

function GeneralSection({ settings, update, onThemeChange }: SectionProps & { onThemeChange: (t: AppSettings['theme']) => void }) {
  const themes: { id: AppSettings['theme']; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: '浅色', icon: <Sun className="w-3.5 h-3.5" /> },
    { id: 'dark', label: '深色', icon: <Moon className="w-3.5 h-3.5" /> },
    { id: 'system', label: '跟随系统', icon: <Monitor className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      <SettingRow label="外观主题" desc="控制应用的配色方案">
        <div className="flex gap-1">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border',
                settings.theme === t.id
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-bg-secondary border-border-default text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="界面字号" desc="调整编辑器和界面的字体大小">
        <select
          value={settings.fontSize}
          onChange={(e) => update('fontSize', Number(e.target.value) as AppSettings['fontSize'])}
          className="cfg-select text-[12px]"
        >
          <option value={12}>12px</option>
          <option value={13}>13px</option>
          <option value={14}>14px</option>
          <option value={15}>15px</option>
          <option value={16}>16px</option>
        </select>
      </SettingRow>

      <SettingRow label="字体" desc="代码区域使用的字体系列">
        <select
          value={settings.fontFamily}
          onChange={(e) => update('fontFamily', e.target.value as AppSettings['fontFamily'])}
          className="cfg-select text-[12px]"
        >
          <option value="mono">等宽字体</option>
          <option value="system">系统字体</option>
        </select>
      </SettingRow>
    </>
  );
}

function RequestSection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow label="默认超时时间" desc="HTTP 请求的默认超时（毫秒），可在单个请求中覆盖">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={settings.defaultTimeoutMs}
            onChange={(e) => update('defaultTimeoutMs', Math.max(1000, parseInt(e.target.value) || 1000))}
            min={1000}
            className="cfg-input w-24 text-[12px]"
          />
          <span className="text-[11px] text-text-disabled">ms</span>
        </div>
      </SettingRow>

      <SettingRow label="自动跟随重定向" desc="发送请求时自动跟随 HTTP 3xx 重定向">
        <Toggle checked={settings.followRedirects} onChange={(v) => update('followRedirects', v)} />
      </SettingRow>

      {settings.followRedirects && (
        <SettingRow label="最大重定向次数" desc="防止无限重定向，超过此次数将报错">
          <input
            type="number"
            value={settings.maxRedirects}
            onChange={(e) => update('maxRedirects', Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            max={20}
            className="cfg-input w-16 text-[12px]"
          />
        </SettingRow>
      )}

      <SettingRow label="SSL 证书验证" desc="关闭后可访问自签名证书的 HTTPS 接口（不建议在生产环境关闭）">
        <Toggle checked={settings.sslVerify} onChange={(v) => update('sslVerify', v)} />
      </SettingRow>

      <SettingRow label="自动保存 Cookie" desc="发送请求后自动保存返回的 Cookie 用于后续请求">
        <Toggle checked={settings.autoSaveCookies} onChange={(v) => update('autoSaveCookies', v)} />
      </SettingRow>
    </>
  );
}

function ProxySection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow label="启用代理" desc="通过代理服务器发送 HTTP 请求">
        <Toggle checked={settings.proxyEnabled} onChange={(v) => update('proxyEnabled', v)} />
      </SettingRow>

      {settings.proxyEnabled && (
        <>
          <SettingRow label="代理类型">
            <div className="flex gap-1">
              {(['http', 'socks5'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update('proxyType', t)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                    settings.proxyType === t
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'bg-bg-secondary border-border-default text-text-tertiary hover:bg-bg-hover'
                  )}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow label="主机地址">
            <input
              value={settings.proxyHost}
              onChange={(e) => update('proxyHost', e.target.value)}
              placeholder="127.0.0.1"
              className="cfg-input w-40 text-[12px]"
            />
          </SettingRow>

          <SettingRow label="端口">
            <input
              type="number"
              value={settings.proxyPort}
              onChange={(e) => update('proxyPort', parseInt(e.target.value) || 8080)}
              min={1}
              max={65535}
              className="cfg-input w-24 text-[12px]"
            />
          </SettingRow>

          <SettingRow label="代理认证" desc="如果代理需要用户名和密码">
            <Toggle checked={settings.proxyAuth} onChange={(v) => update('proxyAuth', v)} />
          </SettingRow>

          {settings.proxyAuth && (
            <>
              <SettingRow label="用户名">
                <input
                  value={settings.proxyUsername}
                  onChange={(e) => update('proxyUsername', e.target.value)}
                  className="cfg-input w-40 text-[12px]"
                />
              </SettingRow>
              <SettingRow label="密码">
                <input
                  type="password"
                  value={settings.proxyPassword}
                  onChange={(e) => update('proxyPassword', e.target.value)}
                  className="cfg-input w-40 text-[12px]"
                />
              </SettingRow>
            </>
          )}
        </>
      )}
    </>
  );
}

function DataSection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow label="最大历史记录" desc="保留的请求历史条数（超出后自动清理最早的记录）">
        <select
          value={settings.maxHistoryCount}
          onChange={(e) => update('maxHistoryCount', parseInt(e.target.value))}
          className="cfg-select text-[12px]"
        >
          <option value={50}>50 条</option>
          <option value={100}>100 条</option>
          <option value={200}>200 条</option>
          <option value={500}>500 条</option>
          <option value={1000}>1000 条</option>
        </select>
      </SettingRow>

      <SettingRow label="自动保存间隔" desc="定时自动保存当前请求（0 = 不自动保存）">
        <select
          value={settings.autoSaveInterval}
          onChange={(e) => update('autoSaveInterval', parseInt(e.target.value))}
          className="cfg-select text-[12px]"
        >
          <option value={0}>不自动保存</option>
          <option value={30}>每 30 秒</option>
          <option value={60}>每 1 分钟</option>
          <option value={300}>每 5 分钟</option>
        </select>
      </SettingRow>
    </>
  );
}
