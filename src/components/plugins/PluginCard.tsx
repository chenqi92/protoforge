import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, Check, Loader2, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PluginManifest } from "@/types/plugin";

interface PluginCardProps {
  plugin: PluginManifest;
  onInstall?: (id: string) => Promise<void>;
  onUninstall?: (id: string) => Promise<void>;
}

const typeLabels: Record<string, { label: string; color: string }> = {
  "protocol-parser": { label: "协议解析", color: "text-blue-600 bg-blue-500/10" },
  "ui-panel": { label: "界面扩展", color: "text-violet-600 bg-violet-500/10" },
};

export function PluginCard({ plugin, onInstall, onUninstall }: PluginCardProps) {
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    setLoading(true);
    try {
      if (plugin.installed) {
        await onUninstall?.(plugin.id);
      } else {
        await onInstall?.(plugin.id);
      }
    } catch (err) {
      console.error('Plugin action failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const typeInfo = typeLabels[plugin.pluginType] || { label: plugin.pluginType, color: "text-text-tertiary bg-bg-secondary" };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="group relative rounded-xl border border-border-default bg-bg-primary hover:border-border-strong hover:shadow-md transition-all duration-200 overflow-hidden"
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-bg-secondary border border-border-default flex items-center justify-center text-xl shrink-0 shadow-sm">
            {plugin.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text-primary truncate">
                {plugin.name}
              </h3>
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0", typeInfo.color)}>
                {typeInfo.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-text-tertiary">{plugin.author}</span>
              <span className="text-[10px] text-text-disabled">v{plugin.version}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-2 mb-3">
          {plugin.description}
        </p>

        {/* Tags */}
        {plugin.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <Tag className="w-3 h-3 text-text-disabled shrink-0" />
            {plugin.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-medium text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded-md border border-border-subtle"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "w-full h-8 rounded-lg flex items-center justify-center gap-1.5 text-[12px] font-semibold transition-all active:scale-[0.98] disabled:cursor-wait",
            plugin.installed
              ? "text-red-500 border border-red-200 dark:border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10"
              : "text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-sm hover:shadow-md"
          )}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : plugin.installed ? (
            <>
              <Trash2 className="w-3.5 h-3.5" />
              卸载
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              安装
            </>
          )}
        </button>
      </div>

      {/* Installed badge */}
      {plugin.installed && (
        <div className="absolute top-2.5 right-2.5">
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
            <Check className="w-3 h-3 text-white" strokeWidth={3} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
