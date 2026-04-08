/**
 * RequestsOverview — 当没有打开任何请求 tab 时显示的概览页面
 * 展示：集合网格、活跃环境变量、全局变量、快捷操作
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen, Globe2, KeyRound, Plus, FileJson,
  Clock, ChevronRight, Braces, Shield, Variable,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCollectionStore } from '@/stores/collectionStore';
import { useEnvStore } from '@/stores/envStore';
import { useHistoryStore } from '@/stores/historyStore';
import type { RequestProtocol } from '@/stores/appStore';
import type { Collection } from '@/types/collections';

// HTTP method color mapping
const methodDot: Record<string, string> = {
  GET: 'bg-emerald-500',
  POST: 'bg-amber-500',
  PUT: 'bg-blue-500',
  DELETE: 'bg-red-500',
  PATCH: 'bg-violet-500',
};

interface RequestsOverviewProps {
  onNewTab: (protocol?: RequestProtocol) => void;
  onOpenCollection: (collectionId: string) => void;
  onOpenEnvModal: () => void;
}

export function RequestsOverview({ onNewTab, onOpenCollection, onOpenEnvModal }: RequestsOverviewProps) {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { t } = useTranslation();
  const collections = useCollectionStore((s) => s.collections);
  const allItems = useCollectionStore((s) => s.items);
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);

  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeEnvId);
  const globalVariables = useEnvStore((s) => s.globalVariables);
  const activeEnvVars = useEnvStore((s) => s.variables);
  const fetchEnvironments = useEnvStore((s) => s.fetchEnvironments);
  const fetchGlobalVariables = useEnvStore((s) => s.fetchGlobalVariables);
  const fetchVariables = useEnvStore((s) => s.fetchVariables);

  const historyEntries = useHistoryStore((s) => s.entries);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);

  const fetchItems = useCollectionStore((s) => s.fetchItems);

  useEffect(() => {
    fetchCollections();
    fetchEnvironments();
    fetchGlobalVariables();
    fetchHistory();
  }, [fetchCollections, fetchEnvironments, fetchGlobalVariables, fetchHistory]);

  // Load items for each collection and active env vars
  useEffect(() => {
    collections.forEach((c) => {
      if (!allItems[c.id]) fetchItems(c.id);
    });
  }, [collections, allItems, fetchItems]);

  useEffect(() => {
    if (activeEnvId && !activeEnvVars[activeEnvId]) {
      fetchVariables(activeEnvId);
    }
  }, [activeEnvId, activeEnvVars, fetchVariables]);

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId),
    [environments, activeEnvId]
  );

  const currentEnvVars = activeEnvId ? (activeEnvVars[activeEnvId] || []) : [];
  const enabledGlobalVars = globalVariables.filter((v) => v.enabled);
  const enabledEnvVars = currentEnvVars.filter((v) => v.enabled);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="pf-text-2xl font-bold text-text-primary">
            {t('overview.title', 'API Workspace')}
          </h1>
          <p className="mt-1 pf-text-sm text-text-tertiary">
            {t('overview.subtitle', 'Create a new request or select from your collections to get started.')}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="mb-8 flex flex-wrap gap-2">
          <button onClick={() => onNewTab('http')} className="wb-ghost-btn h-8 gap-1.5 px-3">
            <Plus className="h-3.5 w-3.5 text-accent" />
            {t('overview.newRequest', 'New Request')}
          </button>
          <button onClick={() => onNewTab('ws')} className="wb-ghost-btn h-8 gap-1.5 px-3">
            <Plus className="h-3.5 w-3.5 text-cyan-500" />
            WebSocket
          </button>
          <button onClick={() => onNewTab('mqtt')} className="wb-ghost-btn h-8 gap-1.5 px-3">
            <Plus className="h-3.5 w-3.5 text-emerald-500" />
            MQTT
          </button>
          <button onClick={onOpenEnvModal} className="wb-ghost-btn h-8 gap-1.5 px-3">
            <Variable className="h-3.5 w-3.5 text-amber-500" />
            {t('overview.manageEnv', 'Environments')}
          </button>
        </div>

        {/* Two-column layout */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Left: Collections (3/5) */}
          <div className="lg:col-span-3 flex min-w-0 flex-col gap-6">
            {/* Collections */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 pf-text-sm font-semibold text-text-primary">
                  <FolderOpen className="h-4 w-4 text-accent/70" />
                  {t('overview.collections', 'Collections')}
                  <span className="ml-1 rounded-full bg-bg-tertiary px-2 py-0.5 pf-text-xxs font-medium text-text-tertiary">
                    {collections.length}
                  </span>
                </h2>
              </div>

              {collections.length === 0 ? (
                <div className="pf-rounded-md border border-dashed border-border-default/80 bg-bg-secondary/30 px-5 py-8 text-center">
                  <FolderOpen className="mx-auto mb-2 h-8 w-8 text-text-disabled" />
                  <p className="pf-text-sm font-medium text-text-secondary">
                    {t('overview.noCollections', 'No collections yet')}
                  </p>
                  <p className="mt-1 pf-text-xs text-text-tertiary">
                    {t('overview.noCollectionsHint', 'Create a collection to organize your API requests')}
                  </p>
                </div>
              ) : (
                <div className="grid min-w-0 gap-2">
                  {collections.map((col) => (
                    <CollectionCard
                      key={col.id}
                      collection={col}
                      itemCount={(allItems[col.id] || []).filter((i) => i.itemType === 'request').length}
                      folderCount={(allItems[col.id] || []).filter((i) => i.itemType === 'folder').length}
                      onClick={() => onOpenCollection(col.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Recent History */}
            {historyEntries.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 pf-text-sm font-semibold text-text-primary">
                  <Clock className="h-4 w-4 text-text-tertiary" />
                  {t('overview.recentHistory', 'Recent Requests')}
                </h2>
                <div className="pf-rounded-md border border-border-default/60 bg-bg-primary overflow-hidden">
                  {historyEntries.slice(0, 6).map((entry, i) => (
                    <div
                      key={entry.id}
                      className={cn(
                        'flex items-center gap-3 px-3.5 py-2 pf-text-xs',
                        i > 0 && 'border-t border-border-subtle/50'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', methodDot[entry.method] || 'bg-text-disabled')} />
                      <span className="w-[52px] shrink-0 font-mono pf-text-xxs font-bold text-text-secondary">
                        {entry.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono pf-text-xxs text-text-tertiary">
                        {entry.url}
                      </span>
                      {entry.status && (
                        <span className={cn(
                          'shrink-0 font-mono pf-text-xxs font-medium',
                          entry.status < 300 ? 'text-emerald-600' : entry.status < 400 ? 'text-amber-600' : 'text-red-500'
                        )}>
                          {entry.status}
                        </span>
                      )}
                      {entry.durationMs != null && (
                        <span className="shrink-0 font-mono pf-text-xxs tabular-nums text-text-disabled">
                          {entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right: Variables & Environment (2/5) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* Active Environment */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 pf-text-sm font-semibold text-text-primary">
                <Globe2 className="h-4 w-4 text-emerald-500/70" />
                {t('overview.environment', 'Environment')}
              </h2>
              <div className="pf-rounded-md border border-border-default/60 bg-bg-primary">
                {/* Active env header */}
                <button
                  onClick={onOpenEnvModal}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-bg-hover/50"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'h-2 w-2 rounded-full',
                      activeEnv ? 'bg-emerald-500' : 'bg-text-disabled'
                    )} />
                    <span className="pf-text-sm font-medium text-text-primary">
                      {activeEnv?.name || t('overview.noActiveEnv', 'No active environment')}
                    </span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-text-disabled" />
                </button>

                {/* Env variables */}
                {enabledEnvVars.length > 0 && (
                  <div className="border-t border-border-subtle/50">
                    {enabledEnvVars.slice(0, 8).map((v) => (
                      <div key={v.id} className="flex items-center gap-2 px-3.5 py-1.5 pf-text-xxs">
                        <Braces className="h-3 w-3 shrink-0 text-emerald-500/50" />
                        <span className="font-mono font-semibold text-text-secondary">{v.key}</span>
                        <span className="text-text-disabled">=</span>
                        <span className={cn(
                          'min-w-0 flex-1 truncate font-mono text-text-tertiary',
                          v.isSecret && 'italic'
                        )}>
                          {v.isSecret ? '******' : v.value}
                        </span>
                      </div>
                    ))}
                    {enabledEnvVars.length > 8 && (
                      <div className="px-3.5 py-1.5 pf-text-xxs text-text-disabled">
                        +{enabledEnvVars.length - 8} {t('overview.more')}
                      </div>
                    )}
                  </div>
                )}

                {/* Other environments */}
                {environments.length > 1 && (
                  <div className="border-t border-border-subtle/50 px-3.5 py-2 pf-text-xxs text-text-disabled">
                    {environments.length - 1} {t('overview.otherEnvs', 'other environment(s) available')}
                  </div>
                )}
              </div>
            </section>

            {/* Global Variables */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 pf-text-sm font-semibold text-text-primary">
                <Variable className="h-4 w-4 text-amber-500/70" />
                {t('overview.globalVars', 'Global Variables')}
                <span className="ml-1 rounded-full bg-bg-tertiary px-2 py-0.5 pf-text-xxs font-medium text-text-tertiary">
                  {enabledGlobalVars.length}
                </span>
              </h2>
              <div className="pf-rounded-md border border-border-default/60 bg-bg-primary">
                {enabledGlobalVars.length === 0 ? (
                  <div className="px-3.5 py-4 text-center pf-text-xs text-text-disabled">
                    {t('overview.noGlobalVars', 'No global variables defined')}
                  </div>
                ) : (
                  enabledGlobalVars.slice(0, 10).map((v, i) => (
                    <div
                      key={v.id}
                      className={cn(
                        'flex items-center gap-2 px-3.5 py-1.5 pf-text-xxs',
                        i > 0 && 'border-t border-border-subtle/40'
                      )}
                    >
                      <KeyRound className="h-3 w-3 shrink-0 text-amber-500/50" />
                      <span className="font-mono font-semibold text-text-secondary">{v.key}</span>
                      <span className="text-text-disabled">=</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-text-tertiary">{v.value}</span>
                    </div>
                  ))
                )}
                {enabledGlobalVars.length > 10 && (
                  <div className="border-t border-border-subtle/40 px-3.5 py-1.5 pf-text-xxs text-text-disabled">
                    +{enabledGlobalVars.length - 10} {t('overview.more')}
                  </div>
                )}
              </div>
            </section>

            {/* Stats Summary */}
            <section>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label={t('overview.totalRequests', 'Collection Requests')}
                  value={Object.values(allItems).flat().filter((i) => i.itemType === 'request').length}
                  icon={<FileJson className="h-4 w-4" />}
                  color="text-accent/60"
                />
                <StatCard
                  label={t('overview.totalEnvs', 'Environments')}
                  value={environments.length}
                  icon={<Globe2 className="h-4 w-4" />}
                  color="text-emerald-500/60"
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Collection Card ── */
function CollectionCard({
  collection,
  itemCount,
  folderCount,
  onClick,
}: {
  collection: Collection;
  itemCount: number;
  folderCount: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const hasAuth = collection.auth && collection.auth !== 'null' && collection.auth !== '{}';
  const hasVars = collection.variables && collection.variables !== '{}' && collection.variables !== '[]';
  const hasScripts = collection.preScript?.trim() || collection.postScript?.trim();

  return (
    <button
      onClick={onClick}
      className="group flex min-w-0 items-center gap-3 overflow-hidden pf-rounded-md border border-border-default/60 bg-bg-primary px-4 py-3 text-left transition-all hover:border-accent/30 hover:bg-bg-hover/40 hover:shadow-xs"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center pf-rounded-sm bg-accent/8 text-accent/60 transition-colors group-hover:bg-accent/12 group-hover:text-accent">
        <FolderOpen className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate pf-text-sm font-semibold text-text-primary">{collection.name}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden pf-text-xxs text-text-disabled">
          <span className="shrink-0">{itemCount} {itemCount !== 1 ? t('overview.requests') : t('overview.requestsSingular')}</span>
          {folderCount > 0 && <span className="shrink-0">{folderCount} {folderCount !== 1 ? t('overview.folders') : t('overview.foldersSingular')}</span>}
          {collection.description && (
            <span className="min-w-0 truncate text-text-disabled/70">{collection.description}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasAuth && (
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-emerald-500/10" title={t('overview.authConfigured', 'Auth configured')}>
            <Shield className="h-3 w-3 text-emerald-500/70" />
          </span>
        )}
        {hasVars && (
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-amber-500/10" title={t('overview.varsConfigured', 'Variables defined')}>
            <Braces className="h-3 w-3 text-amber-500/70" />
          </span>
        )}
        {hasScripts && (
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-violet-500/10" title={t('overview.scriptsConfigured', 'Scripts configured')}>
            <FileJson className="h-3 w-3 text-violet-500/70" />
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-text-disabled transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

/* ── Stat Card ── */
function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="pf-rounded-md border border-border-default/60 bg-bg-primary px-3.5 py-3">
      <div className={cn('mb-1', color)}>{icon}</div>
      <div className="pf-text-xl font-bold tabular-nums text-text-primary">{value}</div>
      <div className="pf-text-xxs text-text-tertiary">{label}</div>
    </div>
  );
}
