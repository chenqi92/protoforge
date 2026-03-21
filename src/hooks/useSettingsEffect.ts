/**
 * useSettingsEffect — 监听 settingsStore 变化并应用到 DOM
 * 负责：字号、字体、主题初始化
 */

import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

export function useSettingsEffect() {
  const { settings } = useSettingsStore();
  const { setMode } = useThemeStore();

  // ── 字号 ──
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`);
    document.documentElement.style.fontSize = `${settings.fontSize}px`;
  }, [settings.fontSize]);

  // ── 字体 ──
  useEffect(() => {
    const fontMap: Record<string, { family: string; url?: string }> = {
      'inter': {
        family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      },
      'system': {
        family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      },
      'noto-sans-sc': {
        family: "'Noto Sans SC', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        url: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap",
      },
      'lxgw-wenkai': {
        family: "'LXGW WenKai', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        url: "https://fonts.googleapis.com/css2?family=LXGW+WenKai:wght@300;400;700&display=swap",
      },
      'source-han-sans': {
        family: "'Source Han Sans SC', 'Noto Sans SC', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        url: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap",
      },
    };

    const entry = fontMap[settings.fontFamily] ?? fontMap['inter'];

    // Dynamically load Google Font if needed
    if (entry.url) {
      const existingLink = document.querySelector(`link[data-font="${settings.fontFamily}"]`);
      if (!existingLink) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = entry.url;
        link.dataset.font = settings.fontFamily;
        link.onerror = () => {
          // Google Fonts unreachable (offline / GFW), silently remove the broken link
          link.remove();
        };
        document.head.appendChild(link);
      }
    }

    document.documentElement.style.setProperty('--font-sans', entry.family);
  }, [settings.fontFamily]);

  // ── 初始化时恢复保存的主题 ──
  useEffect(() => {
    setMode(settings.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // Only on mount
}
