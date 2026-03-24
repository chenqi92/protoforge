/**
 * Icon Registry — 全局图标注册表
 *
 * 管理 icon-pack 插件注入的自定义图标（SVG）。
 * 引用格式: "namespace:icon-name" (如 "ali:wechat-pay")
 * 无前缀时仅查 lucide 内置，不搜索插件注册表。
 */

import { create } from 'zustand';
import type { IconContribution } from '@/types/plugin';

// ── SVG 安全过滤 ────────────────────────────────
// 移除 <script>、on* 事件属性、javascript: 协议等 XSS 风险
const DANGEROUS_TAGS = /(<\s*\/?\s*(script|iframe|object|embed|form|link|meta|base|applet)[^>]*>)/gi;
const DANGEROUS_ATTRS = /\s+(on\w+|xlink:href\s*=\s*["']javascript:|href\s*=\s*["']javascript:)[^"']*["']?/gi;
const DANGEROUS_ENTITIES = /(&#x?[0-9a-fA-F]+;)/g;

function sanitizeSvg(raw: string): string {
  let svg = raw;
  // 移除危险标签
  svg = svg.replace(DANGEROUS_TAGS, '');
  // 移除危险属性
  svg = svg.replace(DANGEROUS_ATTRS, '');
  // 移除 HTML 实体编码的潜在注入
  svg = svg.replace(DANGEROUS_ENTITIES, '');
  // 确保是 SVG 根元素
  if (!svg.trim().startsWith('<svg')) {
    return '';
  }
  return svg;
}

// ── Store 类型 ────────────────────────────────────

interface IconRegistryState {
  /** namespace → { name → sanitized SVG string } */
  registry: Record<string, Record<string, string>>;

  /** 注册一个图标包（安装 icon-pack 插件时调用） */
  registerPack: (namespace: string, icons: IconContribution[]) => void;

  /** 取消注册一个图标包（卸载时调用） */
  unregisterPack: (namespace: string) => void;

  /**
   * 解析图标引用 → sanitized SVG 字符串 | null
   * - "ns:name" → 精确查 registry[ns][name]
   * - "name"    → 返回 null (无前缀不查注册表)
   */
  resolveIcon: (ref: string) => string | null;

  /** 获取所有已注册的命名空间 */
  getNamespaces: () => string[];

  /** 检查某个命名空间是否已被注册 */
  hasNamespace: (namespace: string) => boolean;
}

export const useIconRegistry = create<IconRegistryState>((set, get) => ({
  registry: {},

  registerPack: (namespace, icons) => {
    const sanitized: Record<string, string> = {};
    for (const icon of icons) {
      const clean = sanitizeSvg(icon.svg);
      if (clean) {
        sanitized[icon.name] = clean;
      }
    }
    set((state) => ({
      registry: { ...state.registry, [namespace]: sanitized },
    }));
  },

  unregisterPack: (namespace) => {
    set((state) => {
      const next = { ...state.registry };
      delete next[namespace];
      return { registry: next };
    });
  },

  resolveIcon: (ref) => {
    if (!ref.includes(':')) return null;
    const [ns, name] = ref.split(':', 2);
    return get().registry[ns]?.[name] ?? null;
  },

  getNamespaces: () => Object.keys(get().registry),

  hasNamespace: (namespace) => namespace in get().registry,
}));
