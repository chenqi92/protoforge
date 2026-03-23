import { useState, useEffect, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import * as pluginService from "@/services/pluginService";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import type { LucideProps } from "lucide-react";

// 模块级缓存：避免重复请求同一插件图标
const iconCache = new Map<string, string | null>();

// Lucide 图标组件缓存
const lucideComponentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<LucideProps>>>();

/** 判断 icon 值是否为合法的 lucide 图标名称（非 emoji） */
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
  fallbackEmoji: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-8 w-8 rounded-[10px] text-lg",
  md: "h-11 w-11 rounded-[14px] text-2xl",
  lg: "h-14 w-14 rounded-[18px] text-3xl",
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

export function PluginIcon({ pluginId, fallbackEmoji, className, size = "md" }: PluginIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(
    iconCache.has(pluginId) ? iconCache.get(pluginId)! : null
  );
  const [loaded, setLoaded] = useState(iconCache.has(pluginId));

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

  // 渲染内容：三级 fallback
  const renderContent = () => {
    // 1. 优先使用插件目录中的 SVG/PNG 文件
    if (loaded && iconUrl) {
      return <img src={iconUrl} alt="" className={cn("object-contain", imgSizeClasses[size])} />;
    }

    // 2. 如果 icon 字段是 lucide 图标名称，渲染 lucide 图标
    if (loaded && isLucideIconName(fallbackEmoji)) {
      const LucideIcon = getLucideIcon(fallbackEmoji);
      return (
        <Suspense fallback={<span className={cn("block rounded bg-border-default/30 animate-pulse", lucideIconSizeClasses[size])} />}>
          <LucideIcon className={cn("text-text-secondary", lucideIconSizeClasses[size])} strokeWidth={1.8} />
        </Suspense>
      );
    }

    // 3. 兜底：渲染 emoji
    return <span>{fallbackEmoji}</span>;
  };

  return (
    <div className={cn(
      "flex shrink-0 items-center justify-center border border-border-default/75 bg-bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
      sizeClasses[size],
      className
    )}>
      {renderContent()}
    </div>
  );
}
