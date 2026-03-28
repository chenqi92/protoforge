import { useState, useEffect, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import * as pluginService from "@/services/pluginService";
import { useIconRegistry } from "@/stores/iconRegistry";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import type { LucideProps } from "lucide-react";

// 模块级缓存：避免重复请求同一插件图标
const iconCache = new Map<string, string | null>();

// Lucide 图标组件缓存
const lucideComponentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LucideProps>>>();

/** 判断 icon 值是否为合法的 lucide 图标名称 */
function isLucideIconName(icon: string): icon is keyof typeof dynamicIconImports {
  return /^[a-z][a-z0-9-]*$/.test(icon) && icon in dynamicIconImports;
}

/** 懒加载 lucide 图标组件（带缓存） */
function getLucideIcon(name: keyof typeof dynamicIconImports) {
  if (!lucideComponentCache.has(name)) {
    const LazyIcon = lazy(dynamicIconImports[name]);
    lucideComponentCache.set(name, LazyIcon);
  }
  return lucideComponentCache.get(name)!;
}

interface PluginIconProps {
  pluginId: string;
  /** 图标引用: "ns:name" | "lucide-name" | 任意文本 */
  fallbackEmoji: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-8 w-8 rounded-[var(--radius-md)] text-[var(--fs-lg)]",
  md: "h-11 w-11 rounded-[var(--radius-lg)] text-2xl",
  lg: "h-14 w-14 rounded-[var(--radius-xl)] text-3xl",
};

const imgSizeClasses = {
  sm: "h-5 w-5",
  md: "h-7 w-7",
  lg: "h-9 w-9",
};

const lucideIconSizeClasses = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-7 h-7",
};

const registrySvgSizeClasses = {
  sm: 16,
  md: 24,
  lg: 28,
};

export function PluginIcon({ pluginId, fallbackEmoji, className, size = "md" }: PluginIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(
    iconCache.has(pluginId) ? iconCache.get(pluginId)! : null
  );
  const [loaded, setLoaded] = useState(iconCache.has(pluginId));
  const resolveIcon = useIconRegistry((s) => s.resolveIcon);

  useEffect(() => {
    if (iconCache.has(pluginId)) {
      setIconUrl(iconCache.get(pluginId)!);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    pluginService.getPluginIcon(pluginId).then((url) => {
      if (cancelled) return;
      iconCache.set(pluginId, url);
      setIconUrl(url);
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      iconCache.set(pluginId, null);
      setLoaded(true);
    });

    return () => { cancelled = true; };
  }, [pluginId]);

  // 渲染内容：四级 fallback
  const renderContent = () => {
    // 1. 优先使用插件目录中的 SVG/PNG 文件
    if (loaded && iconUrl) {
      return <img src={iconUrl} alt="" className={cn("object-contain", imgSizeClasses[size])} />;
    }

    // 2. 图标注册表查询（"ns:name" 格式）
    if (loaded && fallbackEmoji.includes(':')) {
      const svg = resolveIcon(fallbackEmoji);
      if (svg) {
        const px = registrySvgSizeClasses[size];
        return (
          <span
            className="inline-flex items-center justify-center text-text-secondary"
            style={{ width: px, height: px }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        );
      }
    }

    // 3. lucide 动态加载
    if (loaded && isLucideIconName(fallbackEmoji)) {
      const LucideIcon = getLucideIcon(fallbackEmoji);
      return (
        <Suspense fallback={<span className={cn("block rounded bg-border-default/30 animate-pulse", lucideIconSizeClasses[size])} />}>
          <LucideIcon className={cn("text-text-secondary", lucideIconSizeClasses[size])} strokeWidth={1.8} />
        </Suspense>
      );
    }

    // 4. 首字母灰色头像兜底
    if (loaded) {
      const letter = fallbackEmoji.replace(/^[^:]*:/, '').charAt(0).toUpperCase() || '?';
      return (
        <span className="text-text-disabled font-semibold" style={{ fontSize: size === 'sm' ? 12 : size === 'md' ? 16 : 20 }}>
          {letter}
        </span>
      );
    }

    // 尚未加载完成
    return <span className={cn("block rounded bg-border-default/20 animate-pulse", lucideIconSizeClasses[size])} />;
  };

  return (
    <div className={cn(
      "flex shrink-0 items-center justify-center border border-border-default/80 bg-bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
      sizeClasses[size],
      className
    )}>
      {renderContent()}
    </div>
  );
}
