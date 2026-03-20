/**
 * SettingsModal — 全局设置弹窗（shadcn/ui 重构版）
 * 使用 Dialog, Switch, Select 等 shadcn 组件
 */

import { useState } from 'react';
import {
  Settings, Globe, Send, Shield, Database,
  RotateCcw, Sun, Moon, Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore, type AppSettings } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';

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
  const { setMode } = useThemeStore();

  const handleThemeChange = (theme: AppSettings['theme']) => {
    update('theme', theme);
    setMode(theme);
  };

  const handleReset = () => {
    if (confirm('确定恢复所有设置为默认值？')) {
      reset();
      setMode('light');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent
        className="w-[760px] max-w-[90vw] min-h-[480px] max-h-[80vh] p-0 gap-0 sm:max-w-[760px] rounded-2xl overflow-hidden"
        showCloseButton={false}
      >
        <div className="flex h-full min-h-[480px]">
          {/* Sidebar */}
          <div className="w-[180px] bg-muted/40 border-r border-border flex flex-col py-3 shrink-0">
            <div className="flex items-center gap-2 px-4 mb-4">
              <Settings className="w-4 h-4 text-muted-foreground" />
              <DialogTitle className="text-[13px] font-semibold">设置</DialogTitle>
            </div>

            <div className="flex flex-col gap-0.5 px-2">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors',
                    section === s.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
                className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-[11px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                恢复默认设置
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <h2 className="text-[14px] font-semibold text-foreground">
                {sections.find((s) => s.id === section)?.label}
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={onClose}>
                <span className="sr-only">关闭</span>
                ×
              </Button>
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
      </DialogContent>
    </Dialog>
  );
}

/* ── Setting Row ── */
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {desc && <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
            <Button
              key={t.id}
              variant={settings.theme === t.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => onThemeChange(t.id)}
              className="gap-1.5"
            >
              {t.icon}
              {t.label}
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="界面字号" desc="调整编辑器和界面的字体大小">
        <Select
          value={String(settings.fontSize)}
          onValueChange={(v) => update('fontSize', Number(v) as AppSettings['fontSize'])}
        >
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12">12px</SelectItem>
            <SelectItem value="13">13px</SelectItem>
            <SelectItem value="14">14px</SelectItem>
            <SelectItem value="15">15px</SelectItem>
            <SelectItem value="16">16px</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="字体" desc="代码区域使用的字体系列">
        <Select
          value={settings.fontFamily}
          onValueChange={(v) => update('fontFamily', v as AppSettings['fontFamily'])}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mono">等宽字体</SelectItem>
            <SelectItem value="system">系统字体</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="界面语言" desc="切换应用界面语言 / Switch UI language">
        <Select
          value={settings.language}
          onValueChange={(v) => update('language', v as AppSettings['language'])}
        >
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
      <SettingRow label="默认超时时间" desc="HTTP 请求的默认超时（毫秒），可在单个请求中覆盖">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={settings.defaultTimeoutMs}
            onChange={(e) => update('defaultTimeoutMs', Math.max(1000, parseInt(e.target.value) || 1000))}
            min={1000}
            className="cfg-input w-24 text-[12px]"
          />
          <span className="text-[11px] text-muted-foreground">ms</span>
        </div>
      </SettingRow>

      <SettingRow label="自动跟随重定向" desc="发送请求时自动跟随 HTTP 3xx 重定向">
        <Switch checked={settings.followRedirects} onCheckedChange={(v) => update('followRedirects', v)} />
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
        <Switch checked={settings.sslVerify} onCheckedChange={(v) => update('sslVerify', v)} />
      </SettingRow>

      <SettingRow label="自动保存 Cookie" desc="发送请求后自动保存返回的 Cookie 用于后续请求">
        <Switch checked={settings.autoSaveCookies} onCheckedChange={(v) => update('autoSaveCookies', v)} />
      </SettingRow>
    </>
  );
}

function ProxySection({ settings, update }: SectionProps) {
  return (
    <>
      <SettingRow label="启用代理" desc="通过代理服务器发送 HTTP 请求">
        <Switch checked={settings.proxyEnabled} onCheckedChange={(v) => update('proxyEnabled', v)} />
      </SettingRow>

      {settings.proxyEnabled && (
        <>
          <SettingRow label="代理类型">
            <div className="flex gap-1">
              {(['http', 'socks5'] as const).map((t) => (
                <Button
                  key={t}
                  variant={settings.proxyType === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => update('proxyType', t)}
                >
                  {t.toUpperCase()}
                </Button>
              ))}
            </div>
          </SettingRow>

          <SettingRow label="主机地址">
            <input
              value={settings.proxyHost}
              onChange={(e) => update('proxyHost', e.target.value)}
              placeholder="127.0.0.1"
              className="cfg-input w-40 text-[12px] text-left"
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
            <Switch checked={settings.proxyAuth} onCheckedChange={(v) => update('proxyAuth', v)} />
          </SettingRow>

          {settings.proxyAuth && (
            <>
              <SettingRow label="用户名">
                <input
                  value={settings.proxyUsername}
                  onChange={(e) => update('proxyUsername', e.target.value)}
                  className="cfg-input w-40 text-[12px] text-left"
                />
              </SettingRow>
              <SettingRow label="密码">
                <input
                  type="password"
                  value={settings.proxyPassword}
                  onChange={(e) => update('proxyPassword', e.target.value)}
                  className="cfg-input w-40 text-[12px] text-left"
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
        <Select
          value={String(settings.maxHistoryCount)}
          onValueChange={(v) => { if (v) update('maxHistoryCount', parseInt(v)); }}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50 条</SelectItem>
            <SelectItem value="100">100 条</SelectItem>
            <SelectItem value="200">200 条</SelectItem>
            <SelectItem value="500">500 条</SelectItem>
            <SelectItem value="1000">1000 条</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="自动保存间隔" desc="定时自动保存当前请求（0 = 不自动保存）">
        <Select
          value={String(settings.autoSaveInterval)}
          onValueChange={(v) => { if (v) update('autoSaveInterval', parseInt(v)); }}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
