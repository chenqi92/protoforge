import { useState } from "react";
import { Download, Trash2, Check, Loader2, Tag, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { PluginManifest } from "@/types/plugin";
import { pluginT } from "@/lib/pluginI18n";
import { PluginIcon } from "@/components/plugins/PluginIcon";

interface PluginCardProps {
  plugin: PluginManifest;
  onInstall?: (id: string) => Promise<void>;
  onUninstall?: (id: string) => Promise<void>;
}

// 类型 -> .pf-pill 色调（对齐 Forge 原型 PluginMarket typeColor 映射）
const typeLabels: Record<string, { label: string; tone: string }> = {
  "protocol-parser": { label: "Protocol Parser", tone: "info" },
  "request-hook": { label: "Request Hook", tone: "acc" },
  "response-renderer": { label: "Response Renderer", tone: "acc" },
  "data-generator": { label: "Data Generator", tone: "warn" },
  "export-format": { label: "Export Format", tone: "ok" },
  "sidebar-panel": { label: "UI Extension", tone: "info" },
  "ui-panel": { label: "UI Extension", tone: "acc" },
  "crypto-tool": { label: "Crypto Tool", tone: "warn" },
  "icon-pack": { label: "Icon Pack", tone: "info" },
};

export function PluginCard({ plugin, onInstall, onUninstall }: PluginCardProps) {
  const { t } = useTranslation();
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
      toast.error((plugin.installed ? t('plugin.uninstallFailed', { defaultValue: '卸载失败' }) : t('plugin.installFailed', { defaultValue: '安装失败' })) + ': ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const typeInfo = typeLabels[plugin.pluginType] || { label: plugin.pluginType, tone: "" };

  return (
    <div
      className="group relative pf-rounded-lg border border-border-default bg-bg-primary hover:border-border-strong transition-colors overflow-hidden dark:bg-white/[0.02] dark:hover:bg-white/[0.035] dark:border-white/[0.06] dark:hover:border-white/[0.09]"
    >
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2.5 mb-2.5">
          <PluginIcon pluginId={plugin.id} fallbackEmoji={plugin.icon} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="pf-text-base font-semibold text-text-primary truncate">
                {pluginT(plugin, 'name')}
              </h3>
              <span className="pf-text-3xs font-mono text-text-disabled shrink-0">v{plugin.version}</span>
              {plugin.hasUpdate && (
                <span className="pf-pill acc shrink-0">
                  <ArrowUpCircle className="w-3 h-3" />
                  {plugin.latestVersion ? `v${plugin.latestVersion}` : t('plugin.updateAvailable')}
                </span>
              )}
            </div>
            {/* type pill + author */}
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("pf-pill shrink-0", typeInfo.tone)}>{typeInfo.label}</span>
              <span className="pf-text-3xs text-text-tertiary truncate">{plugin.author}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="pf-text-sm text-text-secondary leading-snug line-clamp-2 mb-2.5">
          {pluginT(plugin, 'description')}
        </p>

        {/* Tags */}
        {plugin.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
            <Tag className="w-3 h-3 text-text-disabled shrink-0" />
            {plugin.tags.map((tag) => (
              <span
                key={tag}
                className="pf-text-3xs font-medium text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 pf-rounded-xs border border-border-subtle"
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
            "w-full h-7 pf-rounded-md flex items-center justify-center gap-1.5 pf-text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-wait",
            plugin.installed
              ? "text-error border border-error/20 hover:bg-error/10"
              : "text-white bg-accent hover:bg-accent-hover"
          )}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : plugin.installed ? (
            <>
              <Trash2 className="w-3.5 h-3.5" />
              {t('plugin.uninstall')}
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              {t('plugin.install')}
            </>
          )}
        </button>
      </div>

      {/* Installed badge */}
      {plugin.installed && !plugin.hasUpdate && (
        <div className="absolute top-2.5 right-2.5">
          <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center shadow-sm">
            <Check className="w-3 h-3 text-white" strokeWidth={3} />
          </div>
        </div>
      )}
    </div>
  );
}
