/**
 * ResolvedIcon — 通用图标解析渲染组件
 *
 * 支持三种图标引用格式：
 * 1. "namespace:icon-name" → 从图标注册表查询 SVG
 * 2. "lucide-icon-name"    → lucide 动态加载
 * 3. 其他                  → 首字母灰色头像
 */

import { lazy, Suspense, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useIconRegistry } from '@/stores/iconRegistry';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import type { LucideProps } from 'lucide-react';

// Lucide 图标组件缓存
const lucideCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LucideProps>>>();

function isLucideIconName(icon: string): icon is keyof typeof dynamicIconImports {
  return /^[a-z][a-z0-9-]*$/.test(icon) && icon in dynamicIconImports;
}

function getLucideIcon(name: keyof typeof dynamicIconImports) {
  if (!lucideCache.has(name)) {
    lucideCache.set(name, lazy(dynamicIconImports[name]));
  }
  return lucideCache.get(name)!;
}

interface ResolvedIconProps {
  /** 图标引用: "ns:name" | "lucide-name" | 任意文本 */
  icon: string;
  className?: string;
  /** 图标尺寸(px)，默认 16 */
  size?: number;
}

export function ResolvedIcon({ icon, className, size = 16 }: ResolvedIconProps) {
  const resolveIcon = useIconRegistry((s) => s.resolveIcon);

  const resolved = useMemo(() => {
    // 1. 含 ":" → 从图标注册表查
    if (icon.includes(':')) {
      const svg = resolveIcon(icon);
      if (svg) return { type: 'svg' as const, svg };
      // namespace 图标未找到 → 首字母兜底
      const name = icon.split(':')[1] || icon;
      return { type: 'letter' as const, letter: name.charAt(0).toUpperCase() };
    }

    // 2. lucide 名称
    if (isLucideIconName(icon)) {
      return { type: 'lucide' as const, name: icon };
    }

    // 3. 首字母灰色头像
    return { type: 'letter' as const, letter: icon.charAt(0).toUpperCase() };
  }, [icon, resolveIcon]);

  const sizeStyle = { width: size, height: size };

  if (resolved.type === 'svg') {
    return (
      <span
        className={cn('inline-flex items-center justify-center shrink-0', className)}
        style={sizeStyle}
        dangerouslySetInnerHTML={{ __html: resolved.svg }}
      />
    );
  }

  if (resolved.type === 'lucide') {
    const LucideIcon = getLucideIcon(resolved.name as keyof typeof dynamicIconImports);
    return (
      <Suspense fallback={<span className={cn('block rounded bg-border-default/30 animate-pulse', className)} style={sizeStyle} />}>
        <LucideIcon className={cn('text-text-secondary shrink-0', className)} style={sizeStyle} strokeWidth={1.8} />
      </Suspense>
    );
  }

  // letter fallback
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center shrink-0 rounded bg-bg-secondary text-text-disabled font-medium',
        className,
      )}
      style={{ ...sizeStyle, fontSize: size * 0.55 }}
    >
      {resolved.letter}
    </span>
  );
}
