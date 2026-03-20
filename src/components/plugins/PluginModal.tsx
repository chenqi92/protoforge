import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Search, Package, Store as StoreIcon, RefreshCw, Puzzle,
  Download, Trash2, Check, Loader2, Tag, Sparkles, Shield, Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePluginStore } from "@/stores/pluginStore";
import type { PluginManifest } from "@/types/plugin";

interface PluginModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = "store" | "installed";

const typeLabels: Record<string, { label: string; color: string; icon: typeof Code2 }> = {
  "protocol-parser": { label: "协议解析", color: "text-blue-600 bg-blue-500/10 border-blue-500/20", icon: Code2 },
  "ui-panel": { label: "界面扩展", color: "text-violet-600 bg-violet-500/10 border-violet-500/20", icon: Sparkles },
};

export function PluginModal({ open, onClose }: PluginModalProps) {
  const [tab, setTab] = useState<ModalTab>("store");
  const [search, setSearch] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginManifest | null>(null);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const availablePlugins = usePluginStore((s) => s.availablePlugins);
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

  // Filter
  const filterFn = (p: PluginManifest) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase()) ||
    p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));

  const filteredAvailable = availablePlugins.filter(filterFn);
  const filteredInstalled = installedPlugins.filter(filterFn);
  const plugins = tab === "store" ? filteredAvailable : filteredInstalled;

  const handleRefresh = () => {
    refreshRegistry();
    fetchInstalled();
  };

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedPlugin) setSelectedPlugin(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, selectedPlugin]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => { setSelectedPlugin(null); onClose(); }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative flex h-[580px] max-h-[84vh] w-[840px] max-w-[92vw] flex-col overflow-hidden rounded-[26px] border border-white/60 bg-bg-primary/96 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between border-b border-border-default/75 bg-bg-primary/78 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_12px_28px_rgba(37,99,235,0.22)]">
                  <Puzzle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-text-primary">插件中心</h2>
                  <p className="text-[11px] text-text-tertiary">浏览、安装和管理扩展，让工作台能力保持在同一处收口</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Toolbar */}
            <div className="shrink-0 flex items-center gap-3 border-b border-border-default/70 bg-bg-secondary/28 px-6 py-3.5">
              {/* Tabs */}
              <div className="flex items-center gap-1 rounded-[14px] border border-border-default/70 bg-bg-secondary/55 p-1">
                <button
                  onClick={() => { setTab("store"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[12px] px-4 py-1.5 text-[12px] font-medium transition-all",
                    tab === "store"
                      ? "bg-bg-primary text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
                      : "text-text-tertiary hover:bg-bg-primary/70 hover:text-text-secondary"
                  )}
                >
                  <StoreIcon className="w-3.5 h-3.5" />
                  插件仓库
                  {availablePlugins.filter((p) => !p.installed).length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-accent px-1.5 py-[1px] text-center text-[9px] font-bold leading-tight text-white">
                      {availablePlugins.filter((p) => !p.installed).length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setTab("installed"); setSelectedPlugin(null); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[12px] px-4 py-1.5 text-[12px] font-medium transition-all",
                    tab === "installed"
                      ? "bg-bg-primary text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
                      : "text-text-tertiary hover:bg-bg-primary/70 hover:text-text-secondary"
                  )}
                >
                  <Package className="w-3.5 h-3.5" />
                  已安装
                  {installedPlugins.length > 0 && (
                    <span className="min-w-[16px] rounded-full bg-bg-primary/90 px-1.5 py-[1px] text-center text-[9px] font-medium leading-tight text-text-disabled">
                      {installedPlugins.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="flex-1" />

              {/* Search */}
              <div className="relative group">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-accent transition-colors" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索插件..."
                  className="h-8 w-[220px] rounded-[12px] border border-border-default/80 bg-bg-primary/78 pl-8 pr-3 text-[12px] text-text-primary outline-none transition-all placeholder:text-text-tertiary focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]"
                />
              </div>

              {/* Refresh */}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                title="刷新"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
              {/* Plugin Grid */}
              <div className={cn(
                "flex-1 overflow-auto p-4 transition-all duration-200",
                selectedPlugin ? "w-[45%]" : "w-full"
              )}>
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                    <RefreshCw className="w-8 h-8 animate-spin mb-3 opacity-30" />
                    <p className="text-[13px]">加载中...</p>
                  </div>
                ) : plugins.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                    <div className="w-16 h-16 rounded-2xl bg-bg-secondary border border-border-default flex items-center justify-center mb-4 shadow-sm">
                      {tab === "store"
                        ? <StoreIcon className="w-8 h-8 opacity-20" />
                        : <Puzzle className="w-8 h-8 opacity-20" />
                      }
                    </div>
                    <p className="text-[13px] font-medium text-text-secondary">
                      {search ? "没有找到匹配插件" : tab === "store" ? "仓库为空" : "暂无已安装插件"}</p>
                    <p className="text-[12px] mt-1 opacity-60">
                      {tab === "installed" ? "从插件仓库中安装插件以扩展功能" : ""}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {plugins.map((plugin) => (
                      <PluginListItem
                        key={plugin.id}
                        plugin={plugin}
                        selected={selectedPlugin?.id === plugin.id}
                        onSelect={() => setSelectedPlugin(selectedPlugin?.id === plugin.id ? null : plugin)}
                        onInstall={install}
                        onUninstall={uninstall}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Detail Panel */}
              <AnimatePresence>
                {selectedPlugin && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "55%", opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="shrink-0 overflow-hidden border-l border-border-default/70 bg-bg-secondary/24"
                  >
                    <PluginDetail
                      plugin={selectedPlugin}
                      onInstall={install}
                      onUninstall={uninstall}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════
//  插件列表项
// ═══════════════════════════════════════════

function PluginListItem({
  plugin, selected, onSelect, onInstall, onUninstall,
}: {
  plugin: PluginManifest;
  selected: boolean;
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
    } catch (err) { console.error('Plugin action failed:', err); }
    finally { setLoading(false); }
  };

  const typeInfo = typeLabels[plugin.pluginType] || { label: plugin.pluginType, color: "text-text-tertiary bg-bg-secondary", icon: Code2 };

  return (
    <motion.div
      layout
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[16px] border px-3.5 py-3 transition-all",
        selected
          ? "border-border-default/80 bg-bg-primary/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
          : "border-transparent bg-transparent hover:border-border-default/75 hover:bg-bg-hover/55"
      )}
    >
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-border-default/75 bg-bg-primary/82 text-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
        {plugin.icon}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary truncate">{plugin.name}</span>
          <span className={cn("text-[10px] font-medium px-1.5 py-[1px] rounded-full border shrink-0", typeInfo.color)}>
            {typeInfo.label}
          </span>
          {plugin.installed && (
            <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
            </span>
          )}
          {plugin.source === "remote" && (
            <span className="text-[9px] font-medium px-1.5 py-[1px] rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 shrink-0">远程</span>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary truncate mt-0.5">{plugin.description}</p>
      </div>

      {/* Action */}
      <button
        onClick={handleAction}
        disabled={loading}
        className={cn(
          "h-7 px-3 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1 active:scale-[0.97]",
          plugin.installed
            ? "text-text-tertiary border border-border-default hover:text-red-500 hover:border-red-200 dark:hover:border-red-500/30"
            : "bg-accent text-white hover:bg-accent-hover shadow-sm"
        )}
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : plugin.installed ? (
          <>
            <Trash2 className="w-3 h-3" />
            卸载
          </>
        ) : (
          <>
            <Download className="w-3 h-3" />
            安装
          </>
        )}
      </button>
    </motion.div>
  );
}

// ═══════════════════════════════════════════
//  插件详情面板
// ═══════════════════════════════════════════

function PluginDetail({
  plugin, onInstall, onUninstall,
}: {
  plugin: PluginManifest;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    setLoading(true);
    try {
      if (plugin.installed) await onUninstall(plugin.id);
      else await onInstall(plugin.id);
    } catch (err) { console.error('Plugin action failed:', err); }
    finally { setLoading(false); }
  };

  const typeInfo = typeLabels[plugin.pluginType] || { label: plugin.pluginType, color: "text-text-tertiary bg-bg-secondary", icon: Code2 };
  const TypeIcon = typeInfo.icon;

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Hero */}
      <div className="border-b border-border-default/70 bg-bg-primary/72 px-6 pb-5 pt-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border border-border-default/75 bg-bg-primary text-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            {plugin.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[17px] font-bold text-text-primary">{plugin.name}</h3>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[11px] text-text-tertiary">{plugin.author}</span>
              <span className="text-[11px] text-text-disabled">v{plugin.version}</span>
              <span className={cn("text-[10px] font-medium px-2 py-[2px] rounded-full border flex items-center gap-1", typeInfo.color)}>
                <TypeIcon className="w-3 h-3" />
                {typeInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleAction}
          disabled={loading}
          className={cn(
            "w-full h-9 mt-4 rounded-xl flex items-center justify-center gap-2 text-[13px] font-bold transition-all active:scale-[0.98]",
            plugin.installed
              ? "text-red-500 border-2 border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
              : "bg-accent text-white hover:bg-accent-hover shadow-sm"
          )}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : plugin.installed ? (
            <>
              <Trash2 className="w-4 h-4" />
              卸载插件
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              安装插件
            </>
          )}
        </button>
      </div>

      {/* Description */}
      <div className="px-6 py-5 flex-1">
        <div className="mb-4">
          <h4 className="text-[12px] font-bold text-text-secondary uppercase tracking-wider mb-2">插件介绍</h4>
          <p className="text-[13px] text-text-secondary leading-relaxed">
            {plugin.description}
          </p>
        </div>

        {/* Protocol IDs */}
        {plugin.protocolIds.length > 0 && (
          <div className="mb-4">
            <h4 className="text-[12px] font-bold text-text-secondary uppercase tracking-wider mb-2">支持协议</h4>
            <div className="flex items-center gap-2 flex-wrap">
              {plugin.protocolIds.map((pid) => (
                <span
                  key={pid}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-mono font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg border border-blue-200 dark:border-blue-500/20"
                >
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
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-text-tertiary bg-bg-secondary rounded-md border border-border-subtle"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Meta info */}
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
                {plugin.source === "remote" ? "🌐 远程仓库" : "📦 内置"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
