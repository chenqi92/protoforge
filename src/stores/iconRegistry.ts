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
// 基于 DOM 解析 + 标签/属性白名单，防止存储型 XSS。
// 正则只能 strip 已知模式，'<svg/onload=..>'、'<animate values=javascript:..>' 等
// 变体会绕过，故改用 DOMParser 解析后遍历元素逐一裁剪。

// 允许的 SVG 元素标签（小写）。script/foreignObject/animate* 等可执行或危险元素一律剔除。
const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'use',
  'title',
  'desc',
  'text',
  'tspan',
  'marker',
  'pattern',
  'symbol',
]);

function isDangerousUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('data:');
}

function isDangerousStyle(value: string): boolean {
  const v = value.toLowerCase();
  return v.includes('expression(') || v.includes('javascript:') || v.includes('url(');
}

function sanitizeElement(el: Element): void {
  // (a) 标签不在白名单 → 整个子树移除
  if (!ALLOWED_SVG_TAGS.has(el.tagName.toLowerCase())) {
    el.remove();
    return;
  }

  // (b) 逐一裁剪属性
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const localName = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
    } else if ((name === 'href' || localName === 'href') && isDangerousUrl(attr.value)) {
      el.removeAttribute(attr.name);
    } else if (name === 'style' && isDangerousStyle(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }

  // 递归处理子元素（先收集快照，避免 remove 改变 live 集合）
  for (const child of Array.from(el.children)) {
    sanitizeElement(child);
  }
}

function sanitizeSvg(raw: string): string {
  if (typeof DOMParser === 'undefined') return '';

  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');

  // 解析失败（含 parsererror）→ 拒绝
  if (doc.getElementsByTagName('parsererror').length > 0) return '';

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return '';

  sanitizeElement(root);

  // root 自身若被裁剪掉则返回空串
  if (root.tagName.toLowerCase() !== 'svg') return '';

  return new XMLSerializer().serializeToString(root);
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
