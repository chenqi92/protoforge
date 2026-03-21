import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Search, Package, RefreshCw, Puzzle, Download, Trash2, Check,
  Loader2, Tag, Sparkles, Shield, Code2, Terminal, Wand2,
  FileOutput, LayoutDashboard, ChevronRight, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePluginStore } from "@/stores/pluginStore";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PluginManifest, PluginType } from "@/types/plugin";

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
    label: "全部插件",
    desc: "浏览所有可用的扩展插件",
    icon: Puzzle,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "protocol-parser",
    label: "协议解析",
    desc: "解析原始报文为结构化数据",
    icon: Code2,
    accentClassName: "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15",
  },
  {
    id: "request-hook",
    label: "请求钩子",
    desc: "请求发送前后的签名、加密、注入",
    icon: Terminal,
    accentClassName: "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/15",
  },
  {
    id: "response-renderer",
    label: "响应渲染",
    desc: "自定义渲染图表、HEX、树形等",
    icon: Sparkles,
    accentClassName: "bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/15",
  },
  {
    id: "data-generator",
    label: "数据生成",
    desc: "Mock 数据、随机值、模板填充",
    icon: Wand2,
    accentClassName: "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15",
  },
  {
    id: "export-format",
    label: "导出格式",
    desc: "cURL、HTTPie、代码片段导出",
    icon: FileOutput,
    accentClassName: "bg-cyan-500/10 text-cyan-600 ring-1 ring-inset ring-cyan-500/15",
  },
  {
    id: "sidebar-panel",
    label: "侧边面板",
    desc: "监控、日志、统计等独立面板",
    icon: LayoutDashboard,
    accentClassName: "bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/15",
  },
];

const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));

// ── 主 Modal ──

export function PluginModal({ open, onClose }: PluginModalProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginManifest | null>(null);
  const [tab, setTab] = useState<"store" | "installed">("store");

  const availablePlugins = usePluginStore((s) => s.availablePlugins);
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const loading = usePluginStore((s) => s.loading);
  const fetchInstalled = usePluginStore((s) => s.fetchInstalledPlugins);
  const fetchAvailable = usePluginStore((s) => s.fetchAvailablePlugins);
  const install = usePluginStore((s) => s.installPlugin);
  const uninstall = usePluginStore((s) => s.uninstallPlugin);
  const refreshRegistry = usePluginStore((s) => s.refreshRegistry);

  useEffect(() => {
    if (open) {
      fetchInstalled();
      fetchAvailable();
    }
  }, [open, fetchInstalled, fetchAvailable]);

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
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
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
        className="w-[1080px] max-w-[96vw] min-h-[680px] max-h-[88vh] gap-0 overflow-hidden rounded-[28px] border border-white/65 bg-bg-primary/96 p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl sm:max-w-[1080px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">插件中心</DialogTitle>

        <div className="flex h-full min-h-[680px] flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-border-default/75 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#7c3aed,#a855f7)] shadow-[0_12px_28px_rgba(124,58,237,0.24)]">
                <Puzzle className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold tracking-tight text-text-primary">插件中心</p>
                <p className="mt-1 text-[12px] leading-6 text-text-secondary">
                  浏览、安装和管理扩展插件，为工作台注入更多能力。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Tab switcher */}
              <div className="flex items-center gap-0.5 rounded-[12px] border border-border-default/75 bg-bg-secondary/55 p-0.5">
                <button
                  onClick={() => { setTab("store"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11px] font-medium transition-all",
                    tab === "store"
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  仓库
                  {availablePlugins.filter((p) => !p.installed).length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-violet-500 px-1.5 py-[1px] text-center text-[9px] font-bold leading-tight text-white">
                      {availablePlugins.filter((p) => !p.installed).length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setTab("installed"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11px] font-medium transition-all",
                    tab === "installed"
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  已安装
                  {installedPlugins.length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-bg-secondary px-1.5 py-[1px] text-center text-[9px] font-medium leading-tight text-text-disabled">
                      {installedPlugins.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-[14px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body: sidebar + content */}
          <div className="grid min-h-0 flex-1 grid-cols-[232px_minmax(0,1fr)]">
            {/* Sidebar */}
            <aside className="flex min-h-0 flex-col border-r border-border-default/75 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] p-4 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="px-1 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  插件分类
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
                        "group flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-all",
                        isActive
                          ? "bg-bg-primary/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-border-default"
                          : "text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary"
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] transition-colors",
                        isActive ? cat.accentClassName : "bg-bg-secondary/80 text-text-disabled"
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-text-primary">{cat.label}</div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {count > 0 && (
                          <span className={cn(
                            "min-w-[18px] rounded-full px-1.5 py-[1px] text-center text-[9px] font-medium leading-tight",
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
              <div className="mt-3 rounded-[16px] border border-border-default/75 bg-bg-primary/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-[11px] font-semibold text-text-primary">关于插件系统</p>
                <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-text-tertiary">
                  <li>插件从远程仓库下载安装，支持热加载。</li>
                  <li>所有插件运行在沙箱中，不影响核心功能。</li>
                  <li>卸载插件会同时删除其本地数据。</li>
                </ul>
              </div>
            </aside>

            {/* Content area */}
            <section className="flex min-h-0 flex-col bg-bg-primary/36">
              {/* Content header */}
              <div className="shrink-0 border-b border-border-default/70 px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]", currentCategory.accentClassName)}>
                      <CurrentIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-text-primary">{currentCategory.label}</p>
                      <p className="text-[11px] text-text-tertiary">{currentCategory.desc}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="relative group">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-violet-500 transition-colors" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索插件..."
                        className="h-8 w-[200px] rounded-[12px] border border-border-default/80 bg-bg-primary/78 pl-8 pr-3 text-[12px] text-text-primary outline-none transition-all placeholder:text-text-tertiary focus:border-violet-400 focus:shadow-[0_0_0_2px_rgba(124,58,237,0.08)]"
                      />
                    </div>
                    {/* Refresh */}
                    <button
                      onClick={handleRefresh}
                      disabled={loading}
                      className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      title="刷新仓库"
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
                      <p className="text-[13px]">加载中...</p>
                    </div>
                  ) : filteredPlugins.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-bg-secondary/75 text-text-disabled mb-4">
                        <Package className="h-6 w-6 opacity-50" />
                      </div>
                      <p className="text-[13px] font-semibold text-text-secondary">
                        {search ? "没有找到匹配插件" : tab === "installed" ? "暂无已安装插件" : "该分类暂无插件"}
                      </p>
                      <p className="text-[11px] mt-1 text-text-tertiary">
                        {tab === "installed" ? "从插件仓库中安装插件以扩展功能" : "尝试选择其他分类或清除搜索条件"}
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
                      className="shrink-0 overflow-hidden border-l border-border-default/70 bg-bg-secondary/18"
                    >
                      <PluginDetail
                        plugin={selectedPlugin}
                        onInstall={install}
                        onUninstall={uninstall}
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
  plugin, selected, compact, onSelect, onInstall, onUninstall,
}: {
  plugin: PluginManifest;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      if (plugin.installed) await onUninstall(plugin.id);
      else await onInstall(plugin.id);
    } catch (err) { console.error("Plugin action failed:", err); }
    finally { setLoading(false); }
  };

  const cat = categoryMap[plugin.pluginType] || categories[0];

  return (
    <motion.div
      layout
      onClick={onSelect}
      className={cn(
        "group cursor-pointer rounded-[18px] border p-3.5 transition-all hover:-translate-y-[1px]",
        selected
          ? "border-violet-300 dark:border-violet-500/30 bg-bg-primary/92 shadow-[0_4px_16px_rgba(124,58,237,0.08)]"
          : "border-border-default/70 bg-bg-primary/78 hover:border-border-default hover:shadow-[0_4px_16px_rgba(15,23,42,0.06)]",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-border-default/75 bg-bg-primary text-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
          {plugin.icon}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-text-primary truncate">{plugin.name}</span>
            {plugin.installed && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-sm">
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2 leading-4">{plugin.description}</p>

          {/* Tags row */}
          {!compact && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className={cn("text-[9px] font-medium px-1.5 py-[2px] rounded-full border shrink-0", cat.accentClassName)}>
                {cat.label}
              </span>
              {plugin.source === "remote" && (
                <span className="text-[9px] font-medium px-1.5 py-[2px] rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 shrink-0">远程</span>
              )}
              <span className="text-[9px] text-text-disabled">v{plugin.version}</span>
            </div>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "mt-0.5 flex h-7 shrink-0 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-semibold transition-all active:scale-[0.97]",
            plugin.installed
              ? "text-text-tertiary border border-border-default hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/30"
              : "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm hover:from-violet-600 hover:to-purple-600"
          )}
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : plugin.installed ? (
            <><Trash2 className="w-3 h-3" /> 卸载</>
          ) : (
            <><Download className="w-3 h-3" /> 安装</>
          )}
        </button>
      </div>
    </motion.div>
  );
}

// ── 详情面板 ──

function PluginDetail({
  plugin, onInstall, onUninstall, onClose,
}: {
  plugin: PluginManifest;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    setLoading(true);
    try {
      if (plugin.installed) await onUninstall(plugin.id);
      else await onInstall(plugin.id);
    } catch (err) { console.error("Plugin action failed:", err); }
    finally { setLoading(false); }
  };

  const cat = categoryMap[plugin.pluginType] || categories[0];
  const CatIcon = cat.icon;

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Hero */}
      <div className="border-b border-border-default/70 bg-bg-primary/72 px-6 pb-5 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-border-default/75 bg-bg-primary text-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              {plugin.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[17px] font-bold text-text-primary">{plugin.name}</h3>
              <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                <span className="text-[11px] text-text-tertiary">{plugin.author}</span>
                <span className="text-[11px] text-text-disabled">v{plugin.version}</span>
                <span className={cn("text-[10px] font-medium px-2 py-[2px] rounded-full border flex items-center gap-1", cat.accentClassName)}>
                  <CatIcon className="w-3 h-3" />
                  {cat.label}
                </span>
              </div>
            </div>
          </div>

          <button onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-text-tertiary transition-colors hover:bg-bg-hover">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Action Button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "w-full h-9 mt-4 rounded-xl flex items-center justify-center gap-2 text-[13px] font-bold transition-all active:scale-[0.98]",
            plugin.installed
              ? "text-red-500 border-2 border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
              : "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm hover:from-violet-600 hover:to-purple-600"
          )}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : plugin.installed ? (
            <><Trash2 className="w-4 h-4" /> 卸载插件</>
          ) : (
            <><Download className="w-4 h-4" /> 安装插件</>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-5 flex-1">
        <div className="mb-4">
          <h4 className="text-[12px] font-bold text-text-secondary uppercase tracking-wider mb-2">插件介绍</h4>
          <p className="text-[13px] text-text-secondary leading-relaxed">{plugin.description}</p>
        </div>

        {/* Protocol IDs */}
        {plugin.protocolIds.length > 0 && (
          <div className="mb-4">
            <h4 className="text-[12px] font-bold text-text-secondary uppercase tracking-wider mb-2">支持协议</h4>
            <div className="flex items-center gap-2 flex-wrap">
              {plugin.protocolIds.map((pid) => (
                <span key={pid} className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-mono font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg border border-blue-200 dark:border-blue-500/20">
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
            <h4 className="text-[12px] font-bold text-text-secondary uppercase tracking-wider mb-2">标签</h4>
            <div className="flex items-center gap-1.5 flex-wrap">
              {plugin.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-text-tertiary bg-bg-secondary rounded-md border border-border-subtle">
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="mt-auto pt-4 border-t border-border-subtle">
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <span className="text-text-disabled">插件 ID</span>
              <p className="text-text-secondary font-mono mt-0.5">{plugin.id}</p>
            </div>
            <div>
              <span className="text-text-disabled">入口文件</span>
              <p className="text-text-secondary font-mono mt-0.5">{plugin.entrypoint}</p>
            </div>
            <div>
              <span className="text-text-disabled">来源</span>
              <p className="text-text-secondary font-mono mt-0.5">
                {plugin.source === "remote" ? "🌐 远程仓库" : "📦 本地"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
