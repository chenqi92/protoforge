import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Package, Store, RefreshCw, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePluginStore } from "@/stores/pluginStore";
import { PluginCard } from "./PluginCard";

type StoreTab = "installed" | "store";

export function PluginsView({ search }: { search: string }) {
  const [tab, setTab] = useState<StoreTab>("store");

  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const availablePlugins = usePluginStore((s) => s.availablePlugins);
  const loading = usePluginStore((s) => s.loading);
  const fetchInstalled = usePluginStore((s) => s.fetchInstalledPlugins);
  const fetchAvailable = usePluginStore((s) => s.fetchAvailablePlugins);
  const install = usePluginStore((s) => s.installPlugin);
  const uninstall = usePluginStore((s) => s.uninstallPlugin);

  useEffect(() => {
    fetchInstalled();
    fetchAvailable();
  }, [fetchInstalled, fetchAvailable]);

  const filteredInstalled = installedPlugins.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAvailable = availablePlugins.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  const handleRefresh = () => {
    fetchInstalled();
    fetchAvailable();
  };

  return (
    <div className="py-0.5">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 mb-3 px-1">
        <div className="flex items-center gap-0.5 bg-bg-tertiary/50 p-0.5 rounded-lg flex-1">
          <button
            onClick={() => setTab("store")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-md transition-all",
              tab === "store"
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Store className="w-3 h-3" />
            仓库
            {availablePlugins.filter((p) => !p.installed).length > 0 && (
              <span className="text-[9px] bg-accent text-white px-1 py-[1px] rounded-full min-w-[14px] text-center leading-tight">
                {availablePlugins.filter((p) => !p.installed).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("installed")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-md transition-all",
              tab === "installed"
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Package className="w-3 h-3" />
            已安装
            {installedPlugins.length > 0 && (
              <span className="text-[9px] text-text-disabled bg-bg-secondary px-1 py-[1px] rounded-full min-w-[14px] text-center leading-tight">
                {installedPlugins.length}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors shrink-0"
          title="刷新"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: tab === "store" ? -6 : 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: tab === "store" ? 6 : -6 }}
          transition={{ duration: 0.15 }}
          className="space-y-2 px-0.5"
        >
          {tab === "store" && (
            <>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-text-disabled">
                  <RefreshCw className="w-6 h-6 animate-spin mb-3 opacity-40" />
                  <p className="text-[12px]">加载中...</p>
                </div>
              ) : filteredAvailable.length === 0 ? (
                <EmptyState
                  icon={<Store className="w-8 h-8 opacity-30" />}
                  title={search ? "无匹配插件" : "仓库为空"}
                  desc="暂无可用插件"
                />
              ) : (
                filteredAvailable.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onInstall={install}
                    onUninstall={uninstall}
                  />
                ))
              )}
            </>
          )}

          {tab === "installed" && (
            <>
              {filteredInstalled.length === 0 ? (
                <EmptyState
                  icon={<Puzzle className="w-8 h-8 opacity-30" />}
                  title={search ? "无匹配插件" : "暂无已安装插件"}
                  desc="从仓库中安装插件以扩展功能"
                />
              ) : (
                filteredInstalled.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    onUninstall={uninstall}
                  />
                ))
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-text-disabled">
      {icon}
      <p className="text-[12px] mt-2">{title}</p>
      <p className="text-[11px] mt-0.5 opacity-60">{desc}</p>
    </div>
  );
}
