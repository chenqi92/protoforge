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
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    const system = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    document.documentElement.style.setProperty('--app-font-family', settings.fontFamily === 'mono' ? mono : system);
  }, [settings.fontFamily]);

  // ── 初始化时恢复保存的主题 ──
  useEffect(() => {
    setMode(settings.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // Only on mount
}
