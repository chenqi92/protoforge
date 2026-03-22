import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Package, Store, RefreshCw, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { usePluginStore } from "@/stores/pluginStore";
import { PluginCard } from "./PluginCard";
import { pluginT } from "@/lib/pluginI18n";

type StoreTab = "installed" | "store";

export function PluginsView({ search }: { search: string }) {
  const { t } = useTranslation();
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
    (p) => !search || pluginT(p, 'name').toLowerCase().includes(search.toLowerCase()) ||
      pluginT(p, 'description').toLowerCase().includes(search.toLowerCase())
  );

  const filteredAvailable = availablePlugins.filter(
    (p) => !search || pluginT(p, 'name').toLowerCase().includes(search.toLowerCase()) ||
      pluginT(p, 'description').toLowerCase().includes(search.toLowerCase())
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
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[var(--fs-xs)] font-medium rounded-md transition-all",
              tab === "store"
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Store className="w-3 h-3" />
            {t('plugin.store')}
            {availablePlugins.filter((p) => !p.installed).length > 0 && (
              <span className="text-[var(--fs-3xs)] bg-accent text-white px-1 py-[1px] rounded-full min-w-[14px] text-center leading-tight">
                {availablePlugins.filter((p) => !p.installed).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("installed")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[var(--fs-xs)] font-medium rounded-md transition-all",
              tab === "installed"
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            <Package className="w-3 h-3" />
            {t('plugin.installed')}
            {installedPlugins.length > 0 && (
              <span className="text-[var(--fs-3xs)] text-text-disabled bg-bg-secondary px-1 py-[1px] rounded-full min-w-[14px] text-center leading-tight">
                {installedPlugins.length}
              </span>
            )}
          </button>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors shrink-0"
          title={t('plugin.refreshRegistry')}
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
                  <p className="text-[var(--fs-sm)]">{t('plugin.loading')}</p>
                </div>
              ) : filteredAvailable.length === 0 ? (
                <EmptyState
                  icon={<Store className="w-8 h-8 opacity-30" />}
                  title={search ? t('plugin.noMatch') : t('plugin.storeEmpty')}
                  desc={t('plugin.noPlugins')}
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
                  title={search ? t('plugin.noMatch') : t('plugin.noInstalled')}
                  desc={t('plugin.installFromStore')}
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
      <p className="text-[var(--fs-sm)] mt-2">{title}</p>
      <p className="text-[var(--fs-xs)] mt-0.5 opacity-60">{desc}</p>
    </div>
  );
}
