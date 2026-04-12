import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Search, Package, RefreshCw, Puzzle, Download, Trash2, Check,
  Loader2, Tag, Sparkles, Shield, Code2, Terminal, Wand2,
  FileOutput, LayoutDashboard, ChevronRight, ArrowUpCircle, Lock, Palette,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { useTranslation } from 'react-i18next';
import { usePluginStore } from "@/stores/pluginStore";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PluginManifest, PluginType } from "@/types/plugin";
import { pluginT } from "@/lib/pluginI18n";

interface PluginModalProps {
  open: boolean;
  onClose: () => void;
}

// ── 分类体系 ──

type CategoryMeta = {
  id: "all" | PluginType;
  label: string;
  desc: string;
  icon: LucideIcon;
  accentClassName: string;
};

const categories: CategoryMeta[] = [
  {
    id: "all",
    label: "plugin.allPlugins",
    desc: "plugin.allPluginsDesc",
    icon: Puzzle,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "protocol-parser",
    label: "plugin.protocolParser",
    desc: "plugin.protocolParserDesc",
    icon: Code2,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "request-hook",
    label: "plugin.requestHook",
    desc: "plugin.requestHookDesc",
    icon: Terminal,
    accentClassName: "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/15",
  },
  {
    id: "response-renderer",
    label: "plugin.responseRenderer",
    desc: "plugin.responseRendererDesc",
    icon: Sparkles,
    accentClassName: "bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/15",
  },
  {
    id: "data-generator",
    label: "plugin.dataGenerator",
    desc: "plugin.dataGeneratorDesc",
    icon: Wand2,
    accentClassName: "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15",
  },
  {
    id: "export-format",
    label: "plugin.exportFormat",
    desc: "plugin.exportFormatDesc",
    icon: FileOutput,
    accentClassName: "bg-cyan-500/10 text-cyan-600 ring-1 ring-inset ring-cyan-500/15",
  },
  {
    id: "sidebar-panel",
    label: "plugin.sidebarPanel",
    desc: "plugin.sidebarPanelDesc",
    icon: LayoutDashboard,
    accentClassName: "bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/15",
  },
  {
    id: "crypto-tool",
    label: "plugin.cryptoTool",
    desc: "plugin.cryptoToolDesc",
    icon: Lock,
    accentClassName: "bg-orange-500/10 text-orange-600 ring-1 ring-inset ring-orange-500/15",
  },
  {
    id: "icon-pack",
    label: "plugin.iconPack",
    desc: "plugin.iconPackDesc",
    icon: Palette,
    accentClassName: "bg-teal-500/10 text-teal-600 ring-1 ring-inset ring-teal-500/15",
  },
];

const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));

// ── 主 Modal ──

export function PluginModal({ open, onClose }: PluginModalProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginManifest | null>(null);
  const [tab, setTab] = useState<"store" | "installed">("store");

  const availablePlugins = usePluginStore((s) => s.availablePlugins);
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const loading = usePluginStore((s) => s.loading);
  const initializeIfNeeded = usePluginStore((s) => s.initializeIfNeeded);
  const install = usePluginStore((s) => s.installPlugin);
  const uninstall = usePluginStore((s) => s.uninstallPlugin);
  const update = usePluginStore((s) => s.updatePlugin);
  const refreshRegistry = usePluginStore((s) => s.refreshRegistry);
  const fetchInstalled = usePluginStore((s) => s.fetchInstalledPlugins);

  useEffect(() => {
    if (open) {
      initializeIfNeeded();
    }
  }, [open, initializeIfNeeded]);

  // Data source based on tab
  const sourcePlugins = tab === "store" ? availablePlugins : installedPlugins;

  // Filter plugins
  const filteredPlugins = useMemo(() => {
    let list = sourcePlugins;
    if (activeCategory !== "all") {
      list = list.filter((p) => p.pluginType === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          pluginT(p, 'name').toLowerCase().includes(q) ||
          pluginT(p, 'description').toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [sourcePlugins, activeCategory, search]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sourcePlugins.length };
    for (const p of sourcePlugins) {
      counts[p.pluginType] = (counts[p.pluginType] || 0) + 1;
    }
    return counts;
  }, [sourcePlugins]);

  const handleRefresh = () => {
    refreshRegistry();
    fetchInstalled();
  };

  const currentCategory = categoryMap[activeCategory] || categories[0];
  const CurrentIcon = currentCategory.icon;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { setSelectedPlugin(null); onClose(); } }}>
      <DialogContent
        className="w-[1080px] max-w-[96vw] min-h-[680px] max-h-[88vh] gap-0 overflow-hidden pf-rounded-xl border border-white/65 bg-bg-primary p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] sm:max-w-[1080px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('plugin.centerTitle')}</DialogTitle>

        <div className="flex h-[min(88vh,800px)] min-h-0 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-border-default/80 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center pf-rounded-xl bg-[linear-gradient(135deg,#7c3aed,#a855f7)] shadow-[0_12px_28px_rgba(124,58,237,0.24)]">
                <Puzzle className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="pf-text-xl font-semibold tracking-tight text-text-primary">{t('plugin.centerTitle')}</p>
                <p className="mt-1 pf-text-sm leading-6 text-text-secondary">
                  {t('plugin.centerDesc')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Tab switcher */}
              <div className="flex items-center gap-0.5 pf-rounded-md border border-border-default/80 bg-bg-secondary/55 p-0.5">
                <button
                  onClick={() => { setTab("store"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 pf-rounded-md px-3 py-1.5 pf-text-xs font-medium transition-all",
                    tab === "store"
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {t('plugin.store')}
                  {availablePlugins.filter((p) => !p.installed).length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-violet-500 px-1.5 py-[1px] text-center pf-text-3xs font-bold leading-tight text-white">
                      {availablePlugins.filter((p) => !p.installed).length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setTab("installed"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 pf-rounded-md px-3 py-1.5 pf-text-xs font-medium transition-all",
                    tab === "installed"
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {t('plugin.installed')}
                  {installedPlugins.length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-bg-secondary px-1.5 py-[1px] text-center pf-text-3xs font-medium leading-tight text-text-disabled">
                      {installedPlugins.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center pf-rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body: sidebar + content */}
          <div className="grid min-h-0 flex-1 grid-cols-[232px_minmax(0,1fr)]">
            {/* Sidebar */}
            <aside className="flex min-h-0 flex-col border-r border-border-default/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] p-4 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="px-1 pb-3">
                <p className="pf-text-xxs font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  {t('plugin.categories')}
                </p>
              </div>

              <div className="space-y-0.5 overflow-auto flex-1">
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = cat.id === activeCategory;
                  const count = categoryCounts[cat.id] || 0;

                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setActiveCategory(cat.id); setSelectedPlugin(null); }}
                      className={cn(
                        "group flex w-full items-center gap-2.5 pf-rounded-lg px-3 py-2.5 text-left transition-all",
                        isActive
                          ? "bg-bg-primary/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-border-default"
                          : "text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary"
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center pf-rounded-md transition-colors",
                        isActive ? cat.accentClassName : "bg-bg-secondary/80 text-text-disabled"
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="pf-text-sm font-semibold text-text-primary">{t(cat.label)}</div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {count > 0 && (
                          <span className={cn(
                            "min-w-[18px] rounded-full px-1.5 py-[1px] text-center pf-text-3xs font-medium leading-tight",
                            isActive ? "bg-violet-500/15 text-violet-600" : "bg-bg-secondary/90 text-text-disabled"
                          )}>
                            {count}
                          </span>
                        )}
                        <ChevronRight className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-all",
                          isActive
                            ? "translate-x-0 text-text-disabled opacity-100"
                            : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-60"
                        )} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Info card */}
              <div className="mt-3 pf-rounded-xl border border-border-default/80 bg-bg-primary/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="pf-text-xs font-semibold text-text-primary">{t('plugin.aboutSystem')}</p>
                <ul className="mt-2 space-y-1.5 pf-text-xxs leading-4 text-text-tertiary">
                  <li>{t('plugin.aboutTip1')}</li>
                  <li>{t('plugin.aboutTip2')}</li>
                  <li>{t('plugin.aboutTip3')}</li>
                </ul>
              </div>
            </aside>

            {/* Content area */}
            <section className="flex min-h-0 flex-col bg-bg-primary/36">
              {/* Content header */}
              <div className="shrink-0 border-b border-border-default/60 px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center pf-rounded-lg", currentCategory.accentClassName)}>
                      <CurrentIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="pf-text-md font-semibold text-text-primary">{t(currentCategory.label)}</p>
                      <p className="pf-text-xs text-text-tertiary">{t(currentCategory.desc)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="relative group">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-violet-500 transition-colors" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('plugin.searchPlaceholder')}
                        className="h-8 w-[200px] pf-rounded-md border border-border-default/80 bg-bg-primary/78 pl-8 pr-3 pf-text-sm text-text-primary outline-none transition-all placeholder:text-text-tertiary focus:border-violet-400 focus:shadow-[0_0_0_2px_rgba(124,58,237,0.08)]"
                      />
                    </div>
                    {/* Refresh */}
                    <button
                      onClick={handleRefresh}
                      disabled={loading}
                      className="flex h-8 w-8 items-center justify-center pf-rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      title={t('plugin.refreshRegistry')}
                    >
                      <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Plugin grid + detail */}
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Grid */}
                <div className={cn(
                  "flex-1 overflow-auto p-4 transition-all duration-200",
                  selectedPlugin ? "w-[42%]" : "w-full"
                )}>
                  {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                      <RefreshCw className="w-8 h-8 animate-spin mb-3 opacity-30" />
                      <p className="pf-text-base">{t('plugin.loading')}</p>
                    </div>
                  ) : filteredPlugins.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                      <div className="flex h-14 w-14 items-center justify-center pf-rounded-xl bg-bg-secondary/75 text-text-disabled mb-4">
                        <Package className="h-6 w-6 opacity-50" />
                      </div>
                      <p className="pf-text-base font-semibold text-text-secondary">
                        {search ? t('plugin.noMatch') : tab === "installed" ? t('plugin.noInstalled') : t('plugin.noCategory')}
                      </p>
                      <p className="pf-text-xs mt-1 text-text-tertiary">
                        {tab === "installed" ? t('plugin.installFromStore') : t('plugin.trySwitchCategory')}
                      </p>
                    </div>
                  ) : (
                    <div className={cn(
                      "grid gap-2.5",
                      selectedPlugin ? "grid-cols-1" : "grid-cols-2"
                    )}>
                      {filteredPlugins.map((plugin) => (
                        <PluginCard
                          key={plugin.id}
                          plugin={plugin}
                          selected={selectedPlugin?.id === plugin.id}
                          compact={!!selectedPlugin}
                          onSelect={() => setSelectedPlugin(selectedPlugin?.id === plugin.id ? null : plugin)}
                          onInstall={install}
                          onUninstall={uninstall}
                          onUpdate={update}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Detail panel */}
                <AnimatePresence>
                  {selectedPlugin && (
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "58%", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="shrink-0 overflow-hidden border-l border-border-default/60 bg-bg-secondary/18"
                    >
                      <PluginDetail
                        plugin={selectedPlugin}
                        onInstall={install}
                        onUninstall={uninstall}
                        onUpdate={update}
                        onClose={() => setSelectedPlugin(null)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 插件卡片 ──

function PluginCard({
  plugin, selected, compact, onSelect, onInstall, onUninstall, onUpdate,
}: {
  plugin: PluginManifest;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
  onUpdate: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      if (plugin.hasUpdate) await onUpdate(plugin.id);
      else if (plugin.installed) await onUninstall(plugin.id);
      else await onInstall(plugin.id);
    } catch (err) { console.error("Plugin action failed:", err); }
    finally { setLoading(false); }
  };

  const cat = categoryMap[plugin.pluginType] || categories[0];

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group cursor-pointer pf-rounded-xl border p-3.5 transition-all hover:-translate-y-[1px]",
        selected
          ? "border-violet-300 dark:border-violet-500/30 bg-bg-primary/92 shadow-[0_4px_16px_rgba(124,58,237,0.08)]"
          : "border-border-default/60 bg-bg-primary/78 hover:border-border-default hover:shadow-[0_4px_16px_rgba(15,23,42,0.06)]",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <PluginIcon pluginId={plugin.id} fallbackEmoji={plugin.icon} size="md" />

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="pf-text-base font-semibold text-text-primary truncate">{pluginT(plugin, 'name')}</span>
            {plugin.installed && !plugin.hasUpdate && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-sm">
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              </span>
            )}
            {plugin.hasUpdate && (
              <span className="flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 pf-text-3xs font-semibold text-amber-600">
                <ArrowUpCircle className="w-3 h-3" />
                {t('plugin.updateAvailable')}
              </span>
            )}
            {plugin.removedFromRegistry && (
              <span className="flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 pf-text-3xs font-semibold text-red-600">
                {t('plugin.removedFromRegistry', '已从仓库移除')}
              </span>
            )}
          </div>
          <p className="pf-text-xs text-text-tertiary mt-0.5 line-clamp-2 leading-4">{pluginT(plugin, 'description')}</p>

          {/* Tags row */}
          {!compact && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className={cn("pf-text-3xs font-medium px-1.5 py-[2px] rounded-full border shrink-0", cat.accentClassName)}>
                {t(cat.label)}
              </span>
              {plugin.source === "remote" && !plugin.removedFromRegistry && (
                <span className="pf-text-3xs font-medium px-1.5 py-[2px] rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 shrink-0">{t('plugin.remote')}</span>
              )}
              {plugin.removedFromRegistry && (
                <span className="pf-text-3xs font-medium px-1.5 py-[2px] rounded-full bg-red-500/10 text-red-600 border border-red-500/20 shrink-0">{t('plugin.deprecated', '已废弃')}</span>
              )}
              <span className="pf-text-3xs text-text-disabled">
                v{plugin.version}
                {plugin.hasUpdate && plugin.latestVersion && (
                  <> → v{plugin.latestVersion}</>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "mt-0.5 flex h-7 shrink-0 items-center gap-1 pf-rounded-md px-2.5 pf-text-xs font-semibold transition-all active:scale-[0.97]",
            plugin.hasUpdate
              ? "bg-warning hover:bg-warning/90 text-white shadow-sm"
              : plugin.installed
                ? "text-text-tertiary border border-border-default hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/30"
                : "bg-accent hover:bg-accent-hover text-white shadow-sm"
          )}
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : plugin.hasUpdate ? (
            <><ArrowUpCircle className="w-3 h-3" /> {t('plugin.update')}</>
          ) : plugin.installed ? (
            <><Trash2 className="w-3 h-3" /> {t('plugin.uninstall')}</>
          ) : (
            <><Download className="w-3 h-3" /> {t('plugin.install')}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── 详情面板 ──

function PluginDetail({
  plugin, onInstall, onUninstall, onUpdate, onClose,
}: {
  plugin: PluginManifest;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
  onUpdate: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    setLoading(true);
    try {
      if (plugin.hasUpdate) await onUpdate(plugin.id);
      else if (plugin.installed) await onUninstall(plugin.id);
      else await onInstall(plugin.id);
    } catch (err) { console.error("Plugin action failed:", err); }
    finally { setLoading(false); }
  };

  const cat = categoryMap[plugin.pluginType] || categories[0];
  const CatIcon = cat.icon;

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Hero */}
      <div className="border-b border-border-default/60 bg-bg-primary/72 px-6 pb-5 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <PluginIcon pluginId={plugin.id} fallbackEmoji={plugin.icon} size="lg" />
            <div className="flex-1 min-w-0">
              <h3 className="pf-text-2xl font-bold text-text-primary">{pluginT(plugin, 'name')}</h3>
              <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                <span className="pf-text-xs text-text-tertiary">{plugin.author}</span>
                <span className="pf-text-xs text-text-disabled">
                  v{plugin.version}
                  {plugin.hasUpdate && plugin.latestVersion && (
                    <span className="text-amber-600 font-semibold"> → v{plugin.latestVersion}</span>
                  )}
                </span>
                <span className={cn("pf-text-xxs font-medium px-2 py-[2px] rounded-full border flex items-center gap-1", cat.accentClassName)}>
                  <CatIcon className="w-3 h-3" />
                  {t(cat.label)}
                </span>
                {plugin.hasUpdate && (
                  <span className="pf-text-xxs font-semibold px-2 py-[2px] rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20 flex items-center gap-1">
                    <ArrowUpCircle className="w-3 h-3" />
                    {t('plugin.updateAvailable')}
                  </span>
                )}
                {plugin.removedFromRegistry && (
                  <span className="pf-text-xxs font-semibold px-2 py-[2px] rounded-full bg-red-500/15 text-red-600 border border-red-500/20">
                    {t('plugin.removedFromRegistry', '已从仓库移除')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center pf-rounded-md text-text-tertiary transition-colors hover:bg-bg-hover">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Action Button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "w-full h-9 mt-4 rounded-xl flex items-center justify-center gap-2 pf-text-base font-bold transition-all active:scale-[0.98]",
            plugin.hasUpdate
              ? "bg-warning hover:bg-warning/90 text-white shadow-sm"
              : plugin.installed
                ? "text-red-500 border-2 border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
                : "bg-accent hover:bg-accent-hover text-white shadow-sm"
          )}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : plugin.hasUpdate ? (
            <><ArrowUpCircle className="w-4 h-4" /> {t('plugin.updatePlugin')}</>
          ) : plugin.installed ? (
            <><Trash2 className="w-4 h-4" /> {t('plugin.uninstallPlugin')}</>
          ) : (
            <><Download className="w-4 h-4" /> {t('plugin.installPlugin')}</>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-5 flex-1">
        <div className="mb-4">
          <h4 className="pf-text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">{t('plugin.about')}</h4>
          <p className="pf-text-base text-text-secondary leading-relaxed">{pluginT(plugin, 'description')}</p>
        </div>

        {/* Protocol IDs */}
        {plugin.protocolIds.length > 0 && (
          <div className="mb-4">
            <h4 className="pf-text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">{t('plugin.protocols')}</h4>
            <div className="flex items-center gap-2 flex-wrap">
              {plugin.protocolIds.map((pid) => (
                <span key={pid} className="inline-flex items-center gap-1 px-2.5 py-1 pf-text-sm font-mono font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg border border-blue-200 dark:border-blue-500/20">
                  <Shield className="w-3 h-3" />
                  {pid.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {plugin.tags.length > 0 && (
          <div className="mb-4">
            <h4 className="pf-text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">{t('plugin.tags')}</h4>
            <div className="flex items-center gap-1.5 flex-wrap">
              {plugin.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 pf-text-xs font-medium text-text-tertiary bg-bg-secondary rounded-md border border-border-subtle">
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="mt-auto pt-4 border-t border-border-subtle">
          <div className="grid grid-cols-2 gap-3 pf-text-xs">
            <div>
              <span className="text-text-disabled">{t('plugin.pluginId')}</span>
              <p className="text-text-secondary font-mono mt-0.5">{plugin.id}</p>
            </div>
            <div>
              <span className="text-text-disabled">{t('plugin.entrypoint')}</span>
              <p className="text-text-secondary font-mono mt-0.5">{plugin.entrypoint}</p>
            </div>
            <div>
              <span className="text-text-disabled">{t('plugin.source')}</span>
              <p className="text-text-secondary font-mono mt-0.5">
                {plugin.source === "remote" ? t('plugin.remoteRegistry') : t('plugin.local')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
