import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Clock, Search, Plus,
  ChevronRight, Download, Upload, Settings, Globe,
  MoreHorizontal, Folder, Zap, Edit3, Trash2, ExternalLink, Copy, FolderPlus,
  ChevronsUpDown, BarChart3, Server, CopyPlus, FolderInput,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { getMockServerStoreApi } from "@/stores/mockServerStore";
import { useEnvStore } from "@/stores/envStore";
import { ImportModal } from "@/components/collections/ImportModal";
import type { HistoryEntrySummary, CollectionItem } from '@/types/collections';
import { getCollectionRequestSignatureFromItem } from "@/lib/collectionRequest";
import { copyTextToClipboard } from "@/lib/clipboard";
import { generateCurlFromItem } from "@/lib/curlGenerator";
import { resolveVariableTemplate } from "@/lib/requestVariables";
import { usePluginStore } from "@/stores/pluginStore";
import { RequestStatsPanel } from "@/components/plugins/RequestStatsPanel";

type SidebarView = "collections" | "history" | "environments" | "stats";

interface SidebarProps {
  panelCollapsed: boolean;
  onTogglePanel: () => void;
  onOpenEnvModal: () => void;
}

const navItems: { id: SidebarView; icon: typeof FolderOpen; labelKey: string }[] = [
  { id: "collections", icon: FolderOpen, labelKey: 'sidebar.collections' },
  { id: "environments", icon: Globe, labelKey: 'sidebar.environments' },
  { id: "history", icon: Clock, labelKey: 'sidebar.history' },
];

// Dynamic nav item for installed sidebar-panel plugins
const statsNavItem = { id: "stats" as SidebarView, icon: BarChart3, labelKey: 'plugin.statsPanel' };


export function Sidebar({ panelCollapsed, onTogglePanel, onOpenEnvModal }: SidebarProps) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<SidebarView>("collections");
  const [search, setSearch] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);

  // 合集展开状态提升到 Sidebar，避免切换 tab 时丢失
  const [collectionExpanded, setCollectionExpanded] = useState<Record<string, boolean>>({});

  // 初始化数据
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
  const hasHistoryItems = useHistoryStore((s) => s.entries.length > 0);
  const fetchEnvironments = useEnvStore((s) => s.fetchEnvironments);
  const fetchGlobalVariables = useEnvStore((s) => s.fetchGlobalVariables);
  const createCollection = useCollectionStore((s) => s.createCollection);
  const createEnvironment = useEnvStore((s) => s.createEnvironment);

  useEffect(() => {
    fetchCollections();
    fetchHistory();
    fetchEnvironments();
  }, [fetchCollections, fetchHistory, fetchEnvironments]);

  // Check if sidebar-panel plugin is installed
  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const hasSidebarPanelPlugin = installedPlugins.some(
    (p) => p.pluginType === 'sidebar-panel' && p.panelPosition !== 'right'
  );

  const allNavItems = useMemo(() => {
    const items = [...navItems];
    if (hasSidebarPanelPlugin) items.push(statsNavItem);
    return items;
  }, [hasSidebarPanelPlugin]);

  const handleNavClick = (view: SidebarView) => {
    if (panelCollapsed) {
      setActiveView(view);
      onTogglePanel();
    } else if (activeView === view) {
      onTogglePanel();
    } else {
      setActiveView(view);
    }
  };

  const handleNewCollection = async () => {
    await createCollection(t('sidebar.newCollection'));
  };

  const handleImport = () => {
    setImportModalOpen(true);
  };

  // ── History export ──
  const exportHistory = async (format: 'json' | 'csv') => {
    try {
      const { listHistory } = await import('@/services/historyService');
      const entries = await listHistory(10000);
      let content: string;
      let fileName: string;

      if (format === 'csv') {
        const header = 'Method,URL,Status,Duration(ms),BodySize,CreatedAt';
        const rows = entries.map((e) =>
          `${e.method},"${e.url}",${e.status ?? ''},${e.durationMs ?? ''},${e.bodySize ?? ''},${e.createdAt}`
        );
        content = [header, ...rows].join('\n');
        fileName = `protoforge-history-${new Date().toISOString().slice(0, 10)}.csv`;
      } else {
        content = JSON.stringify(entries, null, 2);
        fileName = `protoforge-history-${new Date().toISOString().slice(0, 10)}.json`;
      }

      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: fileName, filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }] });
      if (path) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, content);
      }
    } catch (e) {
      console.error('History export failed:', e);
    }
  };

  // ── Environment export/import ──
  const handleExportEnvs = async () => {
    try {
      const { listEnvironments, listEnvVariables, listGlobalVariables } = await import('@/services/envService');
      const envs = await listEnvironments();
      const vars: Record<string, unknown[]> = {};
      for (const env of envs) {
        vars[env.id] = await listEnvVariables(env.id);
      }
      const globals = await listGlobalVariables();
      const data = { environments: envs, variables: vars, globalVariables: globals };

      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: 'protoforge-environments.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (path) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(path, JSON.stringify(data, null, 2));
      }
    } catch (e) {
      console.error('Environment export failed:', e);
    }
  };

  const handleImportEnvs = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false });
      if (!filePath) return;
      const path = typeof filePath === 'string' ? filePath : (filePath as { path: string }).path;
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(path);
      const data = JSON.parse(content);

      const { createEnvironment: createEnvSvc, saveEnvVariables, saveGlobalVariables } = await import('@/services/envService');
      const envIdMap: Record<string, string> = {};

      if (Array.isArray(data.environments)) {
        for (const env of data.environments) {
          const newEnv = await createEnvSvc({ ...env, id: crypto.randomUUID(), name: env.name || 'Imported' });
          envIdMap[env.id] = newEnv.id;
        }
      }

      if (data.variables && typeof data.variables === 'object') {
        for (const [oldEnvId, vars] of Object.entries(data.variables)) {
          const newEnvId = envIdMap[oldEnvId];
          if (newEnvId && Array.isArray(vars)) {
            const remapped = (vars as any[]).map((v: any) => ({ ...v, id: crypto.randomUUID(), environmentId: newEnvId }));
            await saveEnvVariables(newEnvId, remapped);
          }
        }
      }

      if (Array.isArray(data.globalVariables)) {
        await saveGlobalVariables(data.globalVariables);
      }

      // Refresh store
      await fetchEnvironments();
      await fetchGlobalVariables();
    } catch (e) {
      console.error('Environment import failed:', e);
    }
  };

  const handleNewEnvironment = async () => {
    await createEnvironment(t('sidebar.environments'));
  };

  return (
    <div className="h-full flex">
      {/* ── Icon Rail ── */}
      <div className="w-[52px] h-full flex flex-col items-center py-3 gap-1 bg-bg-sidebar border-r border-border-sidebar shrink-0">
        {allNavItems.map(({ id, icon: Icon, labelKey }) => {
          const label = t(labelKey);
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                "relative flex h-[34px] w-[34px] items-center justify-center pf-rounded-sm transition-all duration-150",
                isActive
                  ? "text-accent bg-accent-soft"
                  : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              )}
              title={label}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 pf-rounded-sm bg-accent-soft"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={cn("relative w-[18px] h-[18px]", isActive && "drop-shadow-sm")} strokeWidth={isActive ? 2.2 : 1.8} />
            </button>
          );
        })}

        <div className="flex-1" />
      </div>

      {/* ── Detail Panel ── */}
      {!panelCollapsed && (
        <div className="flex-1 h-full flex flex-col bg-bg-sidebar overflow-hidden min-w-0">
          {/* Panel Header */}
          <div className="shrink-0 border-b border-border-sidebar px-3 pt-3 pb-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                  {t(allNavItems.find(n => n.id === activeView)?.labelKey || '')}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {activeView === "collections" && (
                  <>
                    <button
                      onClick={handleNewCollection}
                      className="flex h-[26px] items-center gap-1 pf-rounded-sm px-2 text-[length:var(--fs-sidebar-sm)] font-medium text-accent transition-all hover:bg-accent-soft/80 active:scale-[0.97]"
                      title={t('sidebar.new')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('sidebar.new')}
                    </button>
                    <button
                      onClick={handleImport}
                      className="flex h-7 items-center gap-1 pf-rounded-sm px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                      title={t('sidebar.import')}
                    >
                      <Download className="w-3 h-3" />
                      {t('sidebar.import')}
                    </button>
                  </>
                )}
                {activeView === "environments" && (
                  <button
                    onClick={handleNewEnvironment}
                    className="flex h-7 items-center gap-1 pf-rounded-sm px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-accent transition-all hover:bg-accent-soft active:scale-[0.97]"
                    title={t('sidebar.addEnv')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('sidebar.add')}
                  </button>
                )}
                {activeView === "history" && hasHistoryItems && (
                  <>
                    <button
                      onClick={() => exportHistory('json')}
                      className="flex h-7 items-center gap-1 pf-rounded-sm px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover"
                      title={t('history.exportJson')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => useHistoryStore.getState().clearAll()}
                      className="flex h-7 items-center gap-1 pf-rounded-sm px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-red-500"
                      title={t('sidebar.clearAll', '清空历史')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {activeView === "environments" && (
                  <>
                    <button
                      onClick={handleExportEnvs}
                      className="flex h-7 items-center gap-1 pf-rounded-sm px-1.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover"
                      title={t('env.export')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleImportEnvs}
                      className="flex h-7 items-center gap-1 pf-rounded-sm px-1.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover"
                      title={t('env.import')}
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-accent transition-colors" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${t('common.search')}${t(navItems.find(n => n.id === activeView)?.labelKey || '')}...`}
                className="h-[30px] w-full pf-rounded-sm border border-border-sidebar bg-bg-inset pl-8 pr-3 text-[length:var(--fs-sidebar)] text-text-primary outline-none transition-all shadow-inset placeholder:text-text-tertiary focus:border-accent focus:shadow-[0_0_0_2px_var(--color-accent-soft)]"
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto px-2 py-1.5" data-contextmenu-zone="sidebar" onContextMenu={(e) => e.preventDefault()}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                {activeView === "collections" && <CollectionsView search={search} expanded={collectionExpanded} setExpanded={setCollectionExpanded} />}
                {activeView === "history" && <HistoryView search={search} />}
                {activeView === "environments" && <EnvironmentsView onOpenEnvModal={onOpenEnvModal} />}
                {activeView === "stats" && <RequestStatsPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <ImportModal open={importModalOpen} onClose={() => setImportModalOpen(false)} />
    </div>
  );
}

/* ── Collections View (Real Data) ── */
function CollectionsView({ search, expanded, setExpanded }: {
  search: string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const addTab = useAppStore((s) => s.addTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const openCollectionPanel = useAppStore((s) => s.openCollectionPanel);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const { showMenu, MenuComponent } = useContextMenu();

  const collections = useCollectionStore((s) => s.collections);
  const items = useCollectionStore((s) => s.items);
  const fetchItems = useCollectionStore((s) => s.fetchItems);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const renameCollection = useCollectionStore((s) => s.renameCollection);
  const renameItem = useCollectionStore((s) => s.renameItem);
  const createItem = useCollectionStore((s) => s.createItem);
  const deleteItem = useCollectionStore((s) => s.deleteItem);
  const moveItem = useCollectionStore((s) => s.moveItem);
  const reorderItems = useCollectionStore((s) => s.reorderItems);
  const deduplicateItems = useCollectionStore((s) => s.deduplicateItems);
  const duplicateItem = useCollectionStore((s) => s.duplicateItem);
  const copyItemToCollection = useCollectionStore((s) => s.copyItemToCollection);

  // Drag-and-drop state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragCollectionId, setDragCollectionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const commitCollectionRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== collections.find(c => c.id === id)?.name) {
      renameCollection(id, trimmed);
    }
    setRenamingId(null);
  };

  const commitItemRename = (id: string, collectionId: string) => {
    const colItems = items[collectionId] || [];
    const item = colItems.find(i => i.id === id);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item?.name) {
      renameItem(id, collectionId, trimmed);
    }
    setRenamingId(null);
  };

  // 展开集合时加载子项
  const toggleExpand = (colId: string) => {
    const next = !expanded[colId];
    setExpanded((e) => ({ ...e, [colId]: next }));
    if (next && !items[colId]) {
      fetchItems(colId);
    }
  };

  // 展开/折叠文件夹
  const toggleFolder = (folderId: string) => {
    const key = `folder:${folderId}`;
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  };

  const handleOpenItem = (item: CollectionItem, options?: { forceNewTab?: boolean }) => {
    if (item.itemType !== 'request') return;
    if (!item.method && !item.url) return;

    if (!options?.forceNewTab) {
      const existingTab = useAppStore.getState().tabs.find(
        (tab) => tab.protocol === 'http' && tab.linkedCollectionItemId === item.id,
      );
      if (existingTab) {
        setActiveTab(existingTab.id);
        return;
      }
    }

    // addTab 返回新 tab 的 ID，直接使用
    const tabId = addTab('http');

    // Parse data
    let parsedHeaders: any[] = [];
    let parsedQueryParams: any[] = [];
    let authConfigRaw: Record<string, any> = {};
    try { if (item.headers) parsedHeaders = JSON.parse(item.headers); } catch { /* ignore */ }
    try { if (item.queryParams) parsedQueryParams = JSON.parse(item.queryParams); } catch { /* ignore */ }
    try { if (item.authConfig) authConfigRaw = JSON.parse(item.authConfig); } catch { /* ignore */ }

    // 如果解析出的不是数组（旧格式兼容），转换为 KeyValue 数组
    if (!Array.isArray(parsedHeaders)) {
      parsedHeaders = Object.entries(parsedHeaders).map(([k, v]) => ({ key: k, value: String(v), enabled: true }));
    }
    if (!Array.isArray(parsedQueryParams)) {
      parsedQueryParams = Object.entries(parsedQueryParams).map(([k, v]) => ({ key: k, value: String(v), enabled: true }));
    }

    // 适配两种 authConfig 格式（Postman 嵌套数组 vs ProtoForge 平面格式）
    const findKV = (arr: any[] | undefined, key: string): string =>
      arr?.find((kv: any) => kv.key === key)?.value ?? '';
    const authConfig = (authConfigRaw.bearerToken !== undefined || authConfigRaw.basicUsername !== undefined)
      ? {  // 平面格式（SaveRequestDialog 保存的）
          bearerToken: authConfigRaw.bearerToken || '',
          basicUsername: authConfigRaw.basicUsername || '',
          basicPassword: authConfigRaw.basicPassword || '',
          apiKeyName: authConfigRaw.apiKeyName || '',
          apiKeyValue: authConfigRaw.apiKeyValue || '',
          apiKeyAddTo: authConfigRaw.apiKeyAddTo || authConfigRaw.apiKeyIn || 'header',
        }
      : {  // Postman 嵌套数组格式
          bearerToken: findKV(authConfigRaw.bearer, 'token'),
          basicUsername: findKV(authConfigRaw.basic, 'username'),
          basicPassword: findKV(authConfigRaw.basic, 'password'),
          apiKeyName: findKV(authConfigRaw.apikey, 'key'),
          apiKeyValue: findKV(authConfigRaw.apikey, 'value'),
          apiKeyAddTo: findKV(authConfigRaw.apikey, 'in') || 'header',
        };

    // 根据 bodyType 正确恢复 body 到对应字段
    const bodyContent = item.bodyContent || '';
    const normalizedBodyType = item.bodyType === 'sse' ? 'none' : item.bodyType === 'graphql' ? 'json' : (item.bodyType || 'none');
    const bodyUpdates: Partial<import('@/types/http').HttpRequestConfig> = {
      requestMode: item.bodyType === 'sse' ? 'sse' : item.bodyType === 'graphql' ? 'graphql' : 'rest',
      bodyType: normalizedBodyType as any,
    };

    switch (item.bodyType) {
      case 'json':
        bodyUpdates.jsonBody = bodyContent || '{\n  \n}';
        break;
      case 'raw':
        bodyUpdates.rawBody = bodyContent;
        break;
      case 'formUrlencoded':
        try {
          const formObj = JSON.parse(bodyContent);
          if (typeof formObj === 'object' && !Array.isArray(formObj)) {
            bodyUpdates.formFields = Object.entries(formObj).map(([k, v]) => ({ key: k, value: String(v), enabled: true }));
          } else if (Array.isArray(formObj)) {
            bodyUpdates.formFields = formObj;
          }
        } catch { bodyUpdates.rawBody = bodyContent; }
        break;
      case 'formData':
        try {
          const fdArr = JSON.parse(bodyContent);
          if (Array.isArray(fdArr)) {
            bodyUpdates.formDataFields = fdArr;
          }
        } catch { bodyUpdates.rawBody = bodyContent; }
        break;
      case 'binary':
        bodyUpdates.binaryFilePath = bodyContent;
        break;
      case 'graphql':
        try {
          const gql = JSON.parse(bodyContent);
          bodyUpdates.graphqlQuery = gql.query || '';
          bodyUpdates.graphqlVariables = gql.variables || '';
        } catch {
          bodyUpdates.graphqlQuery = bodyContent;
        }
        break;
      case 'sse':
        bodyUpdates.bodyType = 'none';
        break;
      default:
        bodyUpdates.rawBody = bodyContent;
        break;
    }

    // Restore OAuth2 config from saved collection (tokens are not persisted)
    const savedOAuth2 = authConfigRaw.oauth2Config;
    const oauth2Updates = savedOAuth2 ? {
      oauth2Config: {
        grantType: savedOAuth2.grantType || 'client_credentials',
        accessTokenUrl: savedOAuth2.accessTokenUrl || '',
        clientId: savedOAuth2.clientId || '',
        clientSecret: savedOAuth2.clientSecret || '',
        scope: savedOAuth2.scope || '',
        authUrl: savedOAuth2.authUrl || '',
        redirectUri: savedOAuth2.redirectUri || 'http://localhost:1420/callback',
        usePkce: savedOAuth2.usePkce ?? true,
        username: savedOAuth2.username || '',
        password: savedOAuth2.password || '',
        accessToken: '',
        refreshToken: '',
        tokenExpiresAt: 0,
      },
    } : {};

    updateHttpConfig(tabId, {
      method: (item.method || 'GET') as any,
      url: item.url || '',
      name: item.name,
      headers: parsedHeaders.length > 0 ? parsedHeaders : [{ key: '', value: '', enabled: true }],
      queryParams: parsedQueryParams.length > 0 ? parsedQueryParams : [{ key: '', value: '', enabled: true }],
      ...bodyUpdates,
      authType: (item.authType || 'none') as any,
      bearerToken: authConfig.bearerToken,
      basicUsername: authConfig.basicUsername,
      basicPassword: authConfig.basicPassword,
      apiKeyName: authConfig.apiKeyName,
      apiKeyValue: authConfig.apiKeyValue,
      apiKeyAddTo: authConfig.apiKeyAddTo as any,
      ...oauth2Updates,
      preScript: item.preScript || '',
      postScript: item.postScript || '',
    });

    useAppStore.getState().updateTab(tabId, {
      label: item.name || `${item.method} ${item.url}`,
      customLabel: item.name || `${item.method} ${item.url}`,
      linkedCollectionItemId: item.id,
      linkedCollectionId: item.collectionId,
      linkedCollectionParentId: item.parentId,
      linkedCollectionSortOrder: item.sortOrder,
      linkedCollectionCreatedAt: item.createdAt,
      savedRequestSignature: getCollectionRequestSignatureFromItem(item),
    });
  };

  const methodColors: Record<string, { text: string; bg: string }> = {
    GET: { text: "text-emerald-600", bg: "bg-emerald-500/8" },
    POST: { text: "text-amber-600", bg: "bg-amber-500/8" },
    PUT: { text: "text-blue-600", bg: "bg-blue-500/8" },
    DELETE: { text: "text-red-600", bg: "bg-red-500/8" },
    PATCH: { text: "text-violet-600", bg: "bg-violet-500/8" },
  };

  const exportPostman = useCollectionStore((s) => s.exportPostman);

  const handleExportPostman = async (colId: string, colName: string) => {
    try {
      const json = await exportPostman(colId);
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: `${colName}.postman_collection.json`,
        title: t('sidebar.exportPostman'),
      });
      if (!filePath) return;
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(filePath, json);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  // 全部展开/收起集合内的文件夹
  const expandAllFolders = (colId: string, expand: boolean) => {
    const colItems = items[colId] || [];
    const folderKeys: Record<string, boolean> = {};
    colItems.filter(it => it.itemType === 'folder').forEach(f => { folderKeys[`folder:${f.id}`] = expand; });
    setExpanded(e => ({ ...e, ...folderKeys }));
  };

  const handleFolderContextMenu = (e: React.MouseEvent, col: { id: string; name: string }) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "new-req", label: t('contextMenu.newRequest'), icon: <Plus className="w-3.5 h-3.5" />, onClick: () => createItem(col.id, null, 'request', t('contextMenu.newRequest')) },
      { id: "new-folder", label: t('contextMenu.newFolder'), icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => createItem(col.id, null, 'folder', t('contextMenu.newFolder')) },
      { type: "divider" },
      { id: "expand-all", label: t('sidebar.expandAll'), icon: <ChevronsUpDown className="w-3.5 h-3.5" />, onClick: () => expandAllFolders(col.id, true) },
      { id: "collapse-all", label: t('sidebar.collapseAll'), icon: <ChevronsUpDown className="w-3.5 h-3.5" />, onClick: () => expandAllFolders(col.id, false) },
      { id: "deduplicate", label: t('sidebar.deduplicate', { defaultValue: '一键去重' }), icon: <Zap className="w-3.5 h-3.5" />, onClick: async () => {
        const removed = await deduplicateItems(col.id);
        if (removed > 0) {
          console.log(`去重完成，移除 ${removed} 条重复项`);
        }
      }},
      { type: "divider" },
      { id: "settings", label: t('collection.settings'), icon: <Settings className="w-3.5 h-3.5" />, onClick: () => openCollectionPanel(col.id) },
      { id: "rename", label: t('contextMenu.rename'), icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(col.id, col.name) },
      { id: "export-postman", label: t('sidebar.exportPostman'), icon: <Download className="w-3.5 h-3.5" />, onClick: () => handleExportPostman(col.id, col.name) },
      { type: "divider" },
      { id: "delete", label: t('contextMenu.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteCollection(col.id) },
    ];
    showMenu(e, menuItems);
  };

  // 子文件夹的右键菜单
  const handleSubFolderContextMenu = (e: React.MouseEvent, item: CollectionItem) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "new-req", label: t('contextMenu.newRequest'), icon: <Plus className="w-3.5 h-3.5" />, onClick: () => createItem(item.collectionId, item.id, 'request', t('contextMenu.newRequest')) },
      { id: "new-folder", label: t('contextMenu.newFolder'), icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => createItem(item.collectionId, item.id, 'folder', t('contextMenu.newFolder')) },
      { type: "divider" },
      { id: "rename", label: t('contextMenu.rename'), icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(item.id, item.name) },
      { type: "divider" },
      { id: "delete", label: t('contextMenu.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteItem(item.id, item.collectionId) },
    ];
    showMenu(e, menuItems);
  };

  const handleGenerateMock = useCallback((item: CollectionItem) => {
    // 从集合请求生成 Mock 路由
    let path = "/";
    try {
      const urlStr = item.url || "/";
      if (urlStr.startsWith("http")) {
        path = new URL(urlStr).pathname;
      } else {
        // 处理 {{baseUrl}}/api/xxx 格式
        const match = urlStr.match(/\}\}(.+)/);
        path = match ? match[1] : urlStr;
      }
    } catch {
      path = item.url || "/";
    }

    const sessionId = openToolTab("mockserver");
    // 延迟一帧等 store 创建完成
    setTimeout(() => {
      const mockStore = getMockServerStoreApi(sessionId);
      mockStore.getState().addRouteFromTemplate({
        method: item.method || "GET",
        pattern: path,
        bodyTemplate: item.responseExample || '{\n  "message": "mock response"\n}',
        description: item.name || "",
      });
    }, 100);
  }, [openToolTab]);

  const handleItemContextMenu = (e: React.MouseEvent, item: CollectionItem) => {
    // Build "Copy to Collection" entries for other collections
    const copyToEntries: ContextMenuEntry[] = collections
      .filter((c) => c.id !== item.collectionId)
      .map((c) => ({
        id: `copy-to-${c.id}`,
        label: c.name,
        icon: <FolderInput className="w-3.5 h-3.5" />,
        onClick: () => void copyItemToCollection(item.id, item.collectionId, c.id, null),
      }));

    const menuItems: ContextMenuEntry[] = [
      { id: "open", label: t('sidebar.openInNewTab'), icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => handleOpenItem(item, { forceNewTab: true }) },
      { id: "rename", label: t('contextMenu.rename'), icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(item.id, item.name) },
      { id: "copy-url", label: t('sidebar.copyUrl'), icon: <Copy className="w-3.5 h-3.5" />, onClick: () => { if (item.url) void copyTextToClipboard(item.url); } },
      { id: "duplicate", label: t('sidebar.duplicateRequest'), icon: <CopyPlus className="w-3.5 h-3.5" />, onClick: () => void duplicateItem(item.id, item.collectionId) },
      ...(copyToEntries.length > 0 ? [
        { type: "divider" as const },
        { id: "copy-to-header", label: t('sidebar.copyToCollection'), icon: <FolderInput className="w-3.5 h-3.5" />, disabled: true, onClick: () => {} },
        ...copyToEntries,
      ] : []),
      { type: "divider" },
      { id: "generate-mock", label: t('sidebar.generateMock'), icon: <Server className="w-3.5 h-3.5" />, onClick: () => handleGenerateMock(item) },
      { type: "divider" },
      { id: "delete", label: t('contextMenu.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteItem(item.id, item.collectionId) },
    ];
    showMenu(e, menuItems);
  };

  // 搜索匹配辅助函数：匹配请求名称、URL、HTTP 方法
  const searchLower = search.toLowerCase();
  const itemMatchesSearch = (item: CollectionItem): boolean => {
    if (!search) return true;
    if (item.itemType !== 'request') return false;
    const nameMatch = item.name.toLowerCase().includes(searchLower);
    const urlMatch = item.url?.toLowerCase().includes(searchLower) ?? false;
    const methodMatch = item.method?.toLowerCase().includes(searchLower) ?? false;
    return nameMatch || urlMatch || methodMatch;
  };

  // 检查集合内是否有匹配的请求项
  const collectionHasMatchingItems = (colId: string): boolean => {
    const colItems = items[colId] || [];
    return colItems.some(itemMatchesSearch);
  };

  // 搜索时自动加载未加载集合的 items
  useEffect(() => {
    if (!search) return;
    collections.forEach((col) => {
      if (!items[col.id]) {
        fetchItems(col.id);
      }
    });
  }, [search, collections, items, fetchItems]);

  const filteredCollections = collections.filter(
    (col) => !search || col.name.toLowerCase().includes(searchLower) || collectionHasMatchingItems(col.id)
  );

  // 在搜索模式下，获取匹配项所在的所有祖先文件夹 ID
  const getAncestorFolderIds = (colItems: CollectionItem[], itemId: string): Set<string> => {
    const ancestors = new Set<string>();
    let current = colItems.find(it => it.id === itemId);
    while (current?.parentId) {
      ancestors.add(current.parentId);
      current = colItems.find(it => it.id === current!.parentId);
    }
    return ancestors;
  };

  // ── 递归渲染集合树节点 ──
  const renderItems = (colItems: CollectionItem[], parentId: string | null, depth: number) => {
    let children = colItems.filter(it => it.parentId === parentId);
    // 搜索模式下过滤子项
    if (search) {
      // 收集所有匹配项的祖先文件夹 ID
      const matchingItems = colItems.filter(itemMatchesSearch);
      const keepFolderIds = new Set<string>();
      matchingItems.forEach(mi => {
        getAncestorFolderIds(colItems, mi.id).forEach(id => keepFolderIds.add(id));
      });
      children = children.filter(it => {
        if (it.itemType === 'request') return itemMatchesSearch(it);
        if (it.itemType === 'folder') return keepFolderIds.has(it.id);
        return true;
      });
    }
    if (children.length === 0) return null;
    return children.map((item) => {
      const method = item.method || '';
      const color = methodColors[method] || { text: "text-text-tertiary", bg: "" };
      const isRenamingItem = renamingId === item.id;
      const folderKey = `folder:${item.id}`;
      const isFolderExpanded = search ? true : expanded[folderKey] === true; // 搜索时自动展开文件夹

      if (item.itemType === 'folder') {
        const childCount = colItems.filter(c => c.parentId === item.id && c.itemType === 'request').length;
        const folderDropKey = `folder:${item.id}`;
        const isDropTarget = dropTargetId === folderDropKey;
        const folderDropPos = isDropTarget ? dropPosition : null;
        return (
          <div key={item.id}>
            <button
              draggable={!isRenamingItem}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragItemId(item.id);
                setDragCollectionId(item.collectionId);
              }}
              onDragEnd={() => { setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); setDropPosition(null); }}
              onDragOver={(e) => {
                if (!dragItemId || dragItemId === item.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = dragCollectionId !== item.collectionId ? 'copy' : 'move';
                // 3-zone detection: top 25% = before, middle 50% = inside (move into folder), bottom 25% = after
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const relY = e.clientY - rect.top;
                const h = rect.height;
                // Cross-collection: always drop inside folder
                const pos = dragCollectionId !== item.collectionId ? null : (relY < h * 0.25 ? 'before' : relY > h * 0.75 ? 'after' : null);
                setDropTargetId(folderDropKey);
                setDropPosition(pos);
              }}
              onDragLeave={() => { if (dropTargetId === folderDropKey) { setDropTargetId(null); setDropPosition(null); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragItemId && dragItemId !== item.id) {
                  if (dragCollectionId && dragCollectionId !== item.collectionId) {
                    // Cross-collection: copy into this folder
                    void copyItemToCollection(dragItemId, dragCollectionId, item.collectionId, item.id);
                    setExpanded((prev) => ({ ...prev, [`folder:${item.id}`]: true }));
                  } else if (dragCollectionId === item.collectionId) {
                    if (folderDropPos === 'before' || folderDropPos === 'after') {
                      // Reorder relative to this folder
                      reorderItems(dragItemId, item.id, item.collectionId, folderDropPos);
                    } else {
                      // Move into folder (middle zone or no position)
                      moveItem(dragItemId, item.collectionId, item.id);
                      setExpanded((prev) => ({ ...prev, [`folder:${item.id}`]: true }));
                    }
                  }
                }
                setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); setDropPosition(null);
              }}
              onClick={() => toggleFolder(item.id)}
              onContextMenu={(e) => handleSubFolderContextMenu(e, item)}
              className={cn(
                "w-full flex items-center gap-1.5 pr-2 py-[3px] rounded-md text-[length:var(--fs-sidebar)] text-text-secondary hover:bg-bg-hover transition-colors group/folder",
                isDropTarget && !folderDropPos && "ring-1 ring-accent bg-accent/5",
                isDropTarget && folderDropPos === 'before' && "border-t-2 border-t-accent",
                isDropTarget && folderDropPos === 'after' && "border-b-2 border-b-accent",
                dragItemId === item.id && "opacity-40"
              )}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
            >
              <motion.div
                animate={{ rotate: isFolderExpanded ? 90 : 0 }}
                transition={{ duration: 0.12 }}
              >
                <ChevronRight className="w-3 h-3 shrink-0 text-text-disabled" />
              </motion.div>
              <Folder className="w-3 h-3 shrink-0 text-amber-500/50" fill="currentColor" />
              {isRenamingItem ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitItemRename(item.id, item.collectionId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitItemRename(item.id, item.collectionId);
                    if (e.key === 'Escape') setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 text-[length:var(--fs-sidebar)] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-medium"
                  autoFocus
                />
              ) : (
                <span className="truncate text-[length:var(--fs-sidebar)] font-medium">{item.name}</span>
              )}
              {childCount > 0 && (
                <span className="pf-text-3xs text-text-disabled ml-auto tabular-nums">{childCount}</span>
              )}
            </button>
            <AnimatePresence>
              {isFolderExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="overflow-hidden"
                >
                  {renderItems(colItems, item.id, depth + 1)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      }

      // request item
      return (
        <RequestItemWithTooltip
          key={item.id}
          item={item}
          method={method}
          color={color}
          depth={depth}
          isRenamingItem={isRenamingItem}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          commitItemRename={commitItemRename}
          setRenamingId={setRenamingId}
          handleOpenItem={handleOpenItem}
          handleItemContextMenu={handleItemContextMenu}
          dragItemId={dragItemId}
          dropTargetId={dropTargetId}
          dropPosition={dropPosition}
          onDragStart={(e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragItemId(item.id);
            setDragCollectionId(item.collectionId);
          }}
          onDragEnd={() => { setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); setDropPosition(null); }}
          onDragOver={(e: React.DragEvent) => {
            if (!dragItemId || dragItemId === item.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = dragCollectionId !== item.collectionId ? 'copy' : 'move';
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const pos = e.clientY < midY ? 'before' : 'after';
            setDropTargetId(item.id);
            setDropPosition(pos);
          }}
          onDragLeave={() => { if (dropTargetId === item.id) { setDropTargetId(null); setDropPosition(null); } }}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            if (dragItemId && dragItemId !== item.id) {
              if (dragCollectionId && dragCollectionId !== item.collectionId) {
                // Cross-collection: copy to the same parent as the drop target
                void copyItemToCollection(dragItemId, dragCollectionId, item.collectionId, item.parentId);
              } else if (dragCollectionId === item.collectionId && dropPosition) {
                reorderItems(dragItemId, item.id, item.collectionId, dropPosition);
              }
            }
            setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); setDropPosition(null);
          }}
        />
      );
    });
  };

  return (
    <div className="py-0.5">
      {filteredCollections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center pf-rounded-lg border border-border-subtle bg-bg-hover shadow-sm">
            <FolderOpen className="w-6 h-6 text-text-tertiary" />
          </div>
          <p className="text-[length:var(--fs-sidebar)] font-medium text-text-secondary">{search ? t('sidebar.noMatch') : t('sidebar.noCollections')}</p>
          <p className="text-[length:var(--fs-sidebar-sm)] mt-1 text-text-disabled">{t('sidebar.noCollectionsHint')}</p>
        </div>
      )}
      {filteredCollections.map((col) => {
        const colItems = items[col.id] || [];
        const requestItems = colItems.filter((i) => i.itemType === 'request');
        const isColDropTarget = dropTargetId === `col:${col.id}`;
        return (
          <div key={col.id} className="mb-0.5">
            <button
              onClick={() => toggleExpand(col.id)}
              onContextMenu={(e) => handleFolderContextMenu(e, col)}
              onDragOver={(e) => {
                if (dragItemId) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = dragCollectionId !== col.id ? 'copy' : 'move';
                  setDropTargetId(`col:${col.id}`);
                }
              }}
              onDragLeave={() => { if (dropTargetId === `col:${col.id}`) setDropTargetId(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDropTargetId(null);
                if (dragItemId && dragCollectionId) {
                  if (dragCollectionId !== col.id) {
                    // Cross-collection: copy to root of target collection
                    void copyItemToCollection(dragItemId, dragCollectionId, col.id, null);
                  } else {
                    // Same collection: move to root
                    moveItem(dragItemId, col.id, null);
                  }
                }
                setDragItemId(null);
                setDragCollectionId(null);
              }}
              className={cn(
                "w-full flex items-center gap-1.5 px-2 py-[5px] pf-rounded-sm text-[length:var(--fs-sidebar)] font-semibold text-text-primary hover:bg-bg-hover transition-colors group",
                isColDropTarget && "ring-1 ring-accent bg-accent/5"
              )}
            >
              <motion.div
                animate={{ rotate: expanded[col.id] ? 90 : 0 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronRight className="w-3 h-3 shrink-0 text-text-disabled" />
              </motion.div>
              <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500/70" fill="currentColor" strokeWidth={1.5} />
              {renamingId === col.id ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitCollectionRename(col.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitCollectionRename(col.id);
                    if (e.key === 'Escape') setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 text-[length:var(--fs-sidebar)] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-medium"
                  autoFocus
                />
              ) : (
                <span className="truncate">{col.name}</span>
              )}
              {renamingId !== col.id && (
                <>
                  <span className="pf-text-3xs text-text-disabled ml-auto tabular-nums">{requestItems.length || ''}</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); handleFolderContextMenu(e, col); }}
                    className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-bg-hover transition-all shrink-0"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5 text-text-disabled" />
                  </span>
                </>
              )}
            </button>
            <AnimatePresence>
              {(search || expanded[col.id]) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  {colItems.length === 0 && (
                    <p className="pl-[30px] pr-2 py-2 text-[length:var(--fs-sidebar-sm)] text-text-disabled">{t('sidebar.emptyCollection')}</p>
                  )}
                  {renderItems(colItems, null, 1)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      {MenuComponent}
    </div>
  );
}

/* ── Request Item with cURL Tooltip ── */
function RequestItemWithTooltip({
  item, method, color, depth, isRenamingItem,
  renameValue, setRenameValue, commitItemRename, setRenamingId,
  handleOpenItem, handleItemContextMenu,
  dragItemId, dropTargetId, dropPosition,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: {
  item: CollectionItem;
  method: string;
  color: { text: string; bg: string };
  depth: number;
  isRenamingItem: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  commitItemRename: (id: string, colId: string) => void;
  setRenamingId: (id: string | null) => void;
  handleOpenItem: (item: CollectionItem) => void;
  handleItemContextMenu: (e: React.MouseEvent, item: CollectionItem) => void;
  dragItemId: string | null;
  dropTargetId: string | null;
  dropPosition: 'before' | 'after' | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const curlCommand = useCallback(() => generateCurlFromItem(item, item.collectionId), [item]);

  // 构建请求摘要信息
  const requestSummary = useMemo(() => {
    const summary: { label: string; value: string; accent?: string }[] = [];
    // URL
    if (item.url) {
      let displayUrl = item.url;
      try { displayUrl = decodeURIComponent(item.url); } catch { /* keep original if decode fails */ }
      displayUrl = resolveVariableTemplate(displayUrl, item.collectionId, item.id);
      summary.push({ label: "URL", value: displayUrl });
    }
    // Query params
    const params = (() => { try { const p = JSON.parse(item.queryParams || "[]"); return Array.isArray(p) ? p.filter((q: any) => q.key && q.enabled !== false) : []; } catch { return []; } })();
    if (params.length > 0) summary.push({ label: t('http.params'), value: params.map((p: any) => p.key).join(', ') });
    // Headers
    const headers = (() => { try { const h = JSON.parse(item.headers || "[]"); return Array.isArray(h) ? h.filter((h: any) => h.key && h.enabled !== false && !h.isAuto) : []; } catch { return []; } })();
    if (headers.length > 0) summary.push({ label: t('http.headers'), value: headers.map((h: any) => h.key).join(', ') });
    // Auth
    if (item.authType && item.authType !== "none") summary.push({ label: t('http.auth'), value: item.authType === "bearer" ? "Bearer Token" : item.authType === "basic" ? "Basic Auth" : item.authType === "apiKey" ? "API Key" : item.authType === "oauth2" ? "OAuth 2.0" : item.authType, accent: "text-amber-500" });
    // Body
    if (item.bodyType && item.bodyType !== "none") summary.push({ label: t('http.body'), value: item.bodyType === "json" ? "JSON" : item.bodyType === "formUrlencoded" ? "URL-Encoded" : item.bodyType === "formData" ? "Form-Data" : item.bodyType === "binary" ? "Binary" : item.bodyType === "graphql" ? "GraphQL" : item.bodyType.toUpperCase() });
    return summary;
  }, [item, t]);

  const scheduleShow = useCallback((e: React.MouseEvent) => {
    if (isRenamingItem) return;
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      // 确保 tooltip 不超出屏幕底部
      const tooltipHeight = 320;
      const y = Math.min(rect.top, window.innerHeight - tooltipHeight - 16);
      setTooltipPos({ x: rect.right + 8, y: Math.max(8, y) });
      setShowTooltip(true);
      setCopied(false);
    }, 350);
  }, [isRenamingItem]);

  const scheduleHide = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    hideTimerRef.current = setTimeout(() => setShowTooltip(false), 200);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }, []);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyTextToClipboard(curlCommand());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [curlCommand]);

  return (
    <>
      <button
        ref={btnRef}
        draggable={!isRenamingItem}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => isRenamingItem ? undefined : handleOpenItem(item)}
        onContextMenu={(e) => handleItemContextMenu(e, item)}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        className={cn(
          "w-full flex items-center gap-2 pr-2 py-[4px] pf-rounded-sm text-[length:var(--fs-sidebar)] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors group/item",
          dragItemId === item.id && "opacity-40",
          dropTargetId === item.id && dropPosition === 'before' && "border-t-2 border-t-accent",
          dropTargetId === item.id && dropPosition === 'after' && "border-b-2 border-b-accent"
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className={cn(
          "pf-text-xxs font-bold px-[4px] py-[1px] pf-rounded-xs shrink-0 min-w-[28px] text-center leading-tight tracking-wide",
          color.text, color.bg
        )}>
          {method}
        </span>
        {isRenamingItem ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitItemRename(item.id, item.collectionId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitItemRename(item.id, item.collectionId);
              if (e.key === 'Escape') setRenamingId(null);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-[length:var(--fs-sidebar)] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0"
            autoFocus
          />
        ) : (
          <span className="truncate text-[length:var(--fs-sidebar)]">{item.name}</span>
        )}
      </button>
      {showTooltip && createPortal(
        <div
          className="request-preview-tooltip"
          style={{ position: 'fixed', left: tooltipPos.x, top: tooltipPos.y, zIndex: 9999 }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* 顶部: Method + Name */}
          <div className="flex items-center gap-2 mb-2">
            <span className={cn(
              "pf-text-xxs font-bold px-1.5 py-[2px] rounded shrink-0",
              color.text, color.bg
            )}>
              {method}
            </span>
            <span className="pf-text-sm font-semibold text-text-primary truncate">{item.name}</span>
          </div>

          {/* 接口描述（如果有 — 使用 URL 作为补充说明） */}

          {/* 请求摘要 */}
          {requestSummary.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {requestSummary.map((s: { label: string; value: string; accent?: string }, i: number) => (
                <div key={i} className="flex items-start gap-2 pf-text-xs">
                  <span className="shrink-0 text-text-disabled font-medium min-w-[52px]">{s.label}</span>
                  <span className={cn("text-text-secondary break-all", s.accent)}>{s.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Shell 风格 cURL 区域 */}
          <div className="request-preview-shell">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5">
                <div className="flex gap-1">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57] opacity-60" />
                  <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e] opacity-60" />
                  <span className="h-[7px] w-[7px] rounded-full bg-[#28c840] opacity-60" />
                </div>
                <span className="pf-text-xxs font-semibold ml-1.5" style={{ color: 'var(--shell-accent)' }}>cURL</span>
              </div>
              <button
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-[2px] rounded pf-text-xxs font-medium transition-colors",
                  copied ? "text-emerald-500" : "hover:opacity-80"
                )}
                style={{ color: copied ? undefined : 'var(--shell-copy)' }}
              >
                <Copy className="w-3 h-3" />
                {copied ? t('sidebar.copied') : t('sidebar.copyCurl')}
              </button>
            </div>
            <pre className="font-mono whitespace-pre-wrap break-all leading-relaxed max-h-[160px] overflow-auto scrollbar-hide" style={{ fontSize: 'var(--fs-xs)', color: 'var(--shell-text)' }}>{curlCommand()}</pre>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ── History View (Real Data) ── */
function HistoryView({ search }: { search: string }) {
  const { t } = useTranslation();
  const addTab = useAppStore((s) => s.addTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const { showMenu, MenuComponent } = useContextMenu();

  const entries = useHistoryStore((s) => s.entries);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const hasMore = useHistoryStore((s) => s.hasMore);
  const loadMore = useHistoryStore((s) => s.loadMore);
  const loading = useHistoryStore((s) => s.loading);
  const writeError = useHistoryStore((s) => s.writeError);

  // 从历史记录恢复请求到新 tab（按需从 SQLite 加载 requestConfig）
  const handleOpenHistoryEntry = async (entry: HistoryEntrySummary) => {
    const tabId = addTab('http');
    const detail = await useHistoryStore.getState().getEntryDetail(entry.id);
    if (!detail?.requestConfig) return;
    try {
      const config = JSON.parse(detail.requestConfig);
      updateHttpConfig(tabId, config);
      useAppStore.getState().renameTab(tabId, `${entry.method} ${entry.url}`);
    } catch { /* requestConfig 解析失败时保留空 tab */ }
  };

  const methodColors: Record<string, { text: string; bg: string }> = {
    GET: { text: "text-emerald-600", bg: "bg-emerald-500/8" },
    POST: { text: "text-amber-600", bg: "bg-amber-500/8" },
    PUT: { text: "text-blue-600", bg: "bg-blue-500/8" },
    DELETE: { text: "text-red-600", bg: "bg-red-500/8" },
    PATCH: { text: "text-violet-600", bg: "bg-violet-500/8" },
  };

  // 按日期分组
  const groupByDate = (items: HistoryEntrySummary[]) => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const groups: { label: string; items: HistoryEntrySummary[] }[] = [];
    const buckets: Record<string, HistoryEntrySummary[]> = {};
    const bucketOrder: string[] = [];
    const addToBucket = (label: string, item: HistoryEntrySummary) => {
      if (!buckets[label]) { buckets[label] = []; bucketOrder.push(label); }
      buckets[label].push(item);
    };

    for (const e of items) {
      const d = new Date(e.createdAt);
      const ds = d.toDateString();
      const ts = d.getTime();
      if (ds === today) addToBucket(t('sidebar.today'), e);
      else if (ds === yesterday) addToBucket(t('sidebar.yesterday'), e);
      else if (ts >= sevenDaysAgo) addToBucket(t('sidebar.lastSevenDays'), e);
      else if (ts >= thirtyDaysAgo) addToBucket(t('sidebar.lastThirtyDays'), e);
      else {
        const monthLabel = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
        addToBucket(monthLabel, e);
      }
    }

    for (const label of bucketOrder) {
      groups.push({ label, items: buckets[label] });
    }
    return groups;
  };

  const filtered = entries.filter((e) => !search || e.url.includes(search) || e.method.includes(search.toUpperCase()));
  const groups = groupByDate(filtered);

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: HistoryEntrySummary) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "open", label: t('sidebar.openInNewTab'), icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => handleOpenHistoryEntry(entry) },
      { id: "copy-url", label: t('sidebar.copyUrl'), icon: <Copy className="w-3.5 h-3.5" />, onClick: () => void copyTextToClipboard(entry.url) },
      { type: "divider" },
      { id: "delete", label: t('sidebar.deleteRecord'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteEntry(entry.id) },
    ];
    showMenu(e, menuItems);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return t('sidebar.justNow');
    if (diff < 3600000) return t('sidebar.minutesAgo', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('sidebar.hoursAgo', { count: Math.floor(diff / 3600000) });
    return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const parseUrl = (urlString: string) => {
    try {
      const u = new URL(urlString.includes('://') ? urlString : `http://${urlString}`);
      let pathAndQuery = u.pathname + u.search;
      if (pathAndQuery === '/' || !pathAndQuery) {
        pathAndQuery = '/';
      }
      try { pathAndQuery = decodeURIComponent(pathAndQuery); } catch { /* keep encoded if invalid */ }
      return { path: pathAndQuery, origin: u.origin.replace(/^https?:\/\//, '') };
    } catch {
      return { path: urlString, origin: "" };
    }
  };

  return (
    <div className="py-0.5">
      {groups.map((group) => (
        <div key={group.label} className="mb-2">
          <div className="px-2 py-1 pf-text-xxs font-semibold text-text-disabled uppercase tracking-wider">
            {group.label}
          </div>
          {group.items.map((h) => {
            const color = methodColors[h.method] || { text: "text-text-tertiary", bg: "" };
            const { path, origin } = parseUrl(h.url);
            
            return (
              <button
                key={h.id}
                onClick={() => handleOpenHistoryEntry(h)}
                onContextMenu={(e) => handleHistoryContextMenu(e, h)}
                className="w-full flex items-center justify-between px-2 py-[5px] rounded-md hover:bg-bg-hover transition-colors group text-left gap-2"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className={cn(
                    "pf-text-3xs font-bold px-1 py-[1px] rounded shrink-0 min-w-[28px] text-center",
                    color.text, color.bg
                  )}>
                    {h.method}
                  </span>
                      <div className="flex items-center min-w-0 font-mono pf-text-sidebar-sm flex-1">
                    {origin ? (
                      <>
                        <span className="text-accent hidden group-hover:block truncate shrink-0 max-w-full pr-0.5">
                          {origin}
                        </span>
                        <span className="text-text-primary font-medium truncate shrink">
                          {path}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-primary font-medium truncate shrink">
                        {path}
                      </span>
                    )}
                  </div>
                </div>
                {(h.status || h.createdAt) && (
                  <div className="flex items-center shrink-0 gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                    {h.status ? (
                      <span className={cn(
                        "pf-text-3xs tabular-nums font-bold",
                        h.status < 400 ? "text-emerald-500" : "text-red-500"
                      )}>
                        {h.status}
                      </span>
                    ) : null}
                    <span className="pf-text-xxs text-text-disabled hidden group-hover:inline pr-0.5">
                      {formatTime(h.createdAt)}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
      {/* Write error banner */}
      {writeError && (
        <div className="mx-2 my-1 px-2 py-1 pf-rounded-sm bg-red-500/10 text-red-500 pf-text-xxs truncate" title={writeError}>
          {t('history.writeFailed')}: {writeError}
        </div>
      )}
      {/* Load more button */}
      {!search && hasMore && filtered.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-2 pf-text-xxs text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
        >
          {loading ? t('history.loading') : t('history.loadMore')}
        </button>
      )}
      {/* Entry count */}
      {filtered.length > 0 && (
        <div className="px-2 py-1 pf-text-xxs text-text-disabled text-center">
          {t('history.entryCount', { count: filtered.length })}
        </div>
      )}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center pf-rounded-lg border border-border-subtle bg-bg-hover shadow-sm">
            <Clock className="w-6 h-6 text-text-tertiary" />
          </div>
          <p className="pf-text-sm font-medium text-text-secondary">{search ? t('sidebar.noHistoryMatch') : t('sidebar.noHistory')}</p>
          <p className="pf-text-xxs mt-1 text-text-disabled leading-relaxed">{t('sidebar.noHistoryHint')}</p>
        </div>
      )}
      {MenuComponent}
    </div>
  );
}

/* ── Environments View (Simplified — opens modal for editing) ── */
function EnvironmentsView({ onOpenEnvModal }: { onOpenEnvModal: () => void }) {
  const { t } = useTranslation();
  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeEnvId);
  const setActive = useEnvStore((s) => s.setActive);
  const { showMenu, MenuComponent } = useContextMenu();

  const handleEnvContextMenu = (e: React.MouseEvent, env: { id: string; name: string }) => {
    const isActive = env.id === activeEnvId;
    showMenu(e, [
      { id: "activate", label: isActive ? t('sidebar.deactivate') : t('sidebar.activate'), icon: <Zap className="w-3.5 h-3.5" />, onClick: () => setActive(isActive ? null : env.id) },
      { id: "edit-vars", label: "管理变量", icon: <Edit3 className="w-3.5 h-3.5" />, onClick: onOpenEnvModal },
    ]);
  };

  return (
    <div className="py-0.5">
      {environments.map((env) => {
        const isActive = env.id === activeEnvId;
        return (
          <div key={env.id} className="mb-0.5">
            <button
              onClick={() => setActive(isActive ? null : env.id)}
              onContextMenu={(e) => handleEnvContextMenu(e, env)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-[6px] rounded-md text-[length:var(--fs-sidebar)] cursor-pointer transition-colors",
                isActive
                  ? "text-text-secondary bg-emerald-500/5 hover:bg-emerald-500/8"
                  : "text-text-tertiary hover:bg-bg-hover"
              )}
            >
              <div className={cn(
                "w-[6px] h-[6px] pf-rounded-xs shrink-0",
                isActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-border-strong"
              )} />
              <Globe className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-emerald-600" : "text-text-disabled")} />
              <span className={cn("truncate flex-1 text-left", isActive && "font-medium")}>{env.name}</span>
              {isActive && (
                <span className="pf-rounded-sm bg-emerald-500/10 px-1.5 py-0.5 pf-text-3xs font-semibold text-emerald-600 shrink-0">{t('sidebar.active')}</span>
              )}
            </button>
          </div>
        );
      })}

      {/* "管理变量" button */}
      <div className="mt-2 px-1">
        <button
          onClick={onOpenEnvModal}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-dashed border-border-default text-[length:var(--fs-sidebar)] text-text-tertiary hover:border-accent hover:text-accent transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          <span>管理变量</span>
        </button>
      </div>

      {MenuComponent}
    </div>
  );
}
