import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import * as pluginService from "@/services/pluginService";

// 模块级缓存：避免重复请求同一插件图标
const iconCache = new Map<string, string | null>();

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

  return (
    <div className={cn(
      "flex shrink-0 items-center justify-center border border-border-default/75 bg-bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
      sizeClasses[size],
      className
    )}>
      {loaded && iconUrl ? (
        <img src={iconUrl} alt="" className={cn("object-contain", imgSizeClasses[size])} />
      ) : (
        <span>{fallbackEmoji}</span>
      )}
    </div>
  );
}
