/**
 * pluginT — 读取插件的多语言字段
 *
 * 回退逻辑: i18n[currentLang][field] → manifest[field]（默认语言 zh）
 */
import i18next from 'i18next';
import type { PluginManifest } from '@/types/plugin';

type TranslatableField = 'name' | 'description';

export function pluginT(plugin: PluginManifest, field: TranslatableField): string {
  const lang = i18next.language || 'zh';

  // 当前语言与默认语言相同，直接返回原始值
  if (lang === 'zh') return plugin[field];

  // 查找 i18n 翻译
  const translated = plugin.i18n?.[lang]?.[field];
  if (translated) return translated;

  // 回退到原始值
  return plugin[field];
}
