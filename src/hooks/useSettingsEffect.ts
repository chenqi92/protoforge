/**
 * useSettingsEffect — 监听 settingsStore 变化并应用到 DOM
 * 负责：字号、字体（内置 + 插件）、主题初始化
 */

import { useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { usePluginStore } from '@/stores/pluginStore';
import type { FontContribution } from '@/types/plugin';

/** 内置字体定义（已通过 @fontsource 本地捆绑） */
export interface BuiltinFont {
  id: string;
  name: string;
  family: string;
  category: 'sans-serif' | 'monospace' | 'serif';
  builtin: true;
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'inter',
    name: 'Inter',
    family: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    category: 'sans-serif',
    builtin: true,
  },
  {
    id: 'system',
    name: 'System',
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    category: 'sans-serif',
    builtin: true,
  },
  {
    id: 'noto-sans-sc',
    name: 'Noto Sans SC',
    family: "'Noto Sans SC Variable', 'Noto Sans SC', 'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif",
    category: 'sans-serif',
    builtin: true,
  },
  {
    id: 'roboto',
    name: 'Roboto Flex',
    family: "'Roboto Flex Variable', 'Roboto Flex', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    category: 'sans-serif',
    builtin: true,
  },
  {
    id: 'outfit',
    name: 'Outfit',
    family: "'Outfit Variable', 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    category: 'sans-serif',
    builtin: true,
  },
];

/** 插件字体 + 所属插件ID */
interface PluginFontEntry {
  pluginId: string;
  font: FontContribution;
}

/** 从插件列表中收集所有字体贡献 */
function collectPluginFonts(plugins: { id: string; contributes?: { fonts?: FontContribution[] } }[]): PluginFontEntry[] {
  const entries: PluginFontEntry[] = [];
  for (const plugin of plugins) {
    if (plugin.contributes?.fonts) {
      for (const font of plugin.contributes.fonts) {
        entries.push({ pluginId: plugin.id, font });
      }
    }
  }
  return entries;
}

/** 注入插件字体的 @font-face 样式 */
async function injectPluginFontFaces(entries: PluginFontEntry[]) {
  // 清理旧的插件字体样式
  document.querySelectorAll('style[data-plugin-font]').forEach((el) => el.remove());

  if (entries.length === 0) return;

  // 获取 appDataDir 用于构建字体文件绝对路径
  let appDataPath: string;
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    appDataPath = await appDataDir();
  } catch {
    console.warn('Failed to get appDataDir, plugin fonts will not load');
    return;
  }

  // convertFileSrc: 将本地文件路径转为 tauri asset 协议 URL
  let convertFn: (path: string) => string;
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    convertFn = convertFileSrc;
  } catch {
    // 回退：直接用文件路径
    convertFn = (p: string) => `file://${p}`;
  }

  for (const { pluginId, font } of entries) {
    if (!font.files?.length) continue;

    const faces = font.files.map((file) => {
      const format = file.format || (file.path.endsWith('.woff2') ? 'woff2' : file.path.endsWith('.ttf') ? 'truetype' : 'woff2');
      // 构建绝对路径并转为 Tauri asset URL
      const absolutePath = `${appDataPath}plugins/${pluginId}/${file.path}`;
      const src = convertFn(absolutePath);
      return `@font-face {
  font-family: '${font.name}';
  src: url('${src}') format('${format}');
  font-weight: ${file.weight || '100 900'};
  font-style: ${file.style || 'normal'};
  font-display: swap;
}`;
    }).join('\n');

    const style = document.createElement('style');
    style.dataset.pluginFont = font.fontId;
    style.textContent = faces;
    document.head.appendChild(style);
  }
}

export function useSettingsEffect() {
  const { settings } = useSettingsStore();
  const { setMode } = useThemeStore();
  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  // 收集插件字体
  const pluginFonts = useMemo(() => collectPluginFonts(installedPlugins), [installedPlugins]);

  // 注入插件字体 @font-face
  useEffect(() => {
    injectPluginFontFaces(pluginFonts);
  }, [pluginFonts]);

  // ── 字号 ──
  useEffect(() => {
    document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`);
  }, [settings.fontSize]);

  // ── 字体 ──
  useEffect(() => {
    // 先查内置字体
    const builtin = BUILTIN_FONTS.find((f) => f.id === settings.fontFamily);
    if (builtin) {
      document.documentElement.style.setProperty('--font-sans', builtin.family);
      return;
    }

    // 再查插件字体
    const pluginEntry = pluginFonts.find((e) => e.font.fontId === settings.fontFamily);
    if (pluginEntry) {
      document.documentElement.style.setProperty('--font-sans', pluginEntry.font.family);
      return;
    }

    // 回退到 Inter
    const inter = BUILTIN_FONTS[0];
    document.documentElement.style.setProperty('--font-sans', inter.family);
  }, [settings.fontFamily, pluginFonts]);

  // ── 主题色 ──
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accentColor;
  }, [settings.accentColor]);

  // ── 初始化时恢复保存的主题 ──
  useEffect(() => {
    setMode(settings.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // Only on mount
}
