import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Clock, Search, Plus,
  ChevronRight, Download, Settings, Globe,
  MoreHorizontal, Folder, Zap, Edit3, Trash2, ExternalLink, Copy, FolderPlus,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useEnvStore } from "@/stores/envStore";
import { ImportModal } from "@/components/collections/ImportModal";
import type { HistoryEntry, CollectionItem } from '@/types/collections';
import { getCollectionRequestSignatureFromItem } from "@/lib/collectionRequest";
import { copyTextToClipboard } from "@/lib/clipboard";
import { generateCurlFromItem } from "@/lib/curlGenerator";

type SidebarView = "collections" | "history" | "environments";

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
  const createCollection = useCollectionStore((s) => s.createCollection);
  const createEnvironment = useEnvStore((s) => s.createEnvironment);

  useEffect(() => {
    fetchCollections();
    fetchHistory();
    fetchEnvironments();
  }, [fetchCollections, fetchHistory, fetchEnvironments]);

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

  const handleNewEnvironment = async () => {
    await createEnvironment(t('sidebar.environments'));
  };

  return (
    <div className="h-full flex">
      {/* ── Icon Rail ── */}
      <div className="w-12 h-full flex flex-col items-center pt-2 pb-3 bg-transparent border-r border-border-default/60 shrink-0">
        {navItems.map(({ id, icon: Icon, labelKey }) => {
          const label = t(labelKey);
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                "relative mb-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-[8px] transition-all duration-150",
                isActive
                  ? "text-accent bg-accent-soft"
                  : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
              )}
              title={label}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r-full"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={cn("w-4 h-4", isActive && "drop-shadow-sm")} strokeWidth={isActive ? 2.2 : 1.8} />
            </button>
          );
        })}

        <div className="flex-1" />
      </div>

      {/* ── Detail Panel ── */}
      {!panelCollapsed && (
        <div className="flex-1 h-full flex flex-col bg-transparent overflow-hidden min-w-0">
          {/* Panel Header */}
          <div className="shrink-0 border-b border-border-subtle/70 bg-transparent px-3 py-2.5">
            <div className={cn("flex items-center justify-between", activeView === "collections" ? "mb-2" : "mb-2")}>
              <div className="flex min-w-0 items-center gap-2">
                {activeView !== "collections" ? (
                  <span className="truncate text-[var(--fs-sm)] font-semibold text-text-primary">
                    {t(navItems.find(n => n.id === activeView)?.labelKey || '')}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {activeView === "collections" && (
                  <>
                    <button
                      onClick={handleNewCollection}
                      className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-accent transition-all hover:bg-accent-soft active:scale-[0.97]"
                      title={t('sidebar.new')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('sidebar.new')}
                    </button>
                    <button
                      onClick={handleImport}
                      className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
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
                    className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-accent transition-all hover:bg-accent-soft active:scale-[0.97]"
                    title={t('sidebar.addEnv')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('sidebar.add')}
                  </button>
                )}
                {activeView === "history" && hasHistoryItems && (
                  <button
                    onClick={() => useHistoryStore.getState().clearAll()}
                    className="flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-[length:var(--fs-sidebar-sm)] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-red-500"
                    title={t('sidebar.clearAll', '清空历史')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('sidebar.clearAll', '清空')}
                  </button>
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
                className="h-[30px] w-full rounded-[10px] border border-border-default/80 bg-bg-secondary/42 pl-8 pr-3 text-[length:var(--fs-sidebar)] text-text-primary outline-none transition-all placeholder:text-text-tertiary focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]"
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto px-2 py-1.5">
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
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const openCollectionPanel = useAppStore((s) => s.openCollectionPanel);
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

  // Drag-and-drop state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragCollectionId, setDragCollectionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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

  // 双击打开集合请求项
  const handleOpenItem = (item: CollectionItem) => {
    if (item.itemType !== 'request') return;
    if (!item.method && !item.url) return;

    // addTab 返回新 tab 的 ID，直接使用——不依赖旧快照
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

  const handleItemContextMenu = (e: React.MouseEvent, item: { id: string; name: string; url: string | null; collectionId: string }) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "open", label: t('sidebar.openInNewTab'), icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => addTab("http") },
      { id: "rename", label: t('contextMenu.rename'), icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(item.id, item.name) },
      { id: "copy-url", label: t('sidebar.copyUrl'), icon: <Copy className="w-3.5 h-3.5" />, onClick: () => { if (item.url) void copyTextToClipboard(item.url); } },
      { type: "divider" },
      { id: "delete", label: t('contextMenu.delete'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteItem(item.id, item.collectionId) },
    ];
    showMenu(e, menuItems);
  };

  const filteredCollections = collections.filter(
    (col) => !search || col.name.toLowerCase().includes(search.toLowerCase())
  );

  // ── 递归渲染集合树节点 ──
  const renderItems = (colItems: CollectionItem[], parentId: string | null, depth: number) => {
    const children = colItems.filter(it => it.parentId === parentId);
    if (children.length === 0) return null;
    return children.map((item) => {
      const method = item.method || '';
      const color = methodColors[method] || { text: "text-text-tertiary", bg: "" };
      const isRenamingItem = renamingId === item.id;
      const folderKey = `folder:${item.id}`;
      const isFolderExpanded = expanded[folderKey] === true; // 默认收起

      if (item.itemType === 'folder') {
        const childCount = colItems.filter(c => c.parentId === item.id && c.itemType === 'request').length;
        const isDropTarget = dropTargetId === `folder:${item.id}`;
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
              onDragEnd={() => { setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); }}
              onDragOver={(e) => {
                if (dragItemId && dragItemId !== item.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTargetId(`folder:${item.id}`);
                }
              }}
              onDragLeave={() => { if (dropTargetId === `folder:${item.id}`) setDropTargetId(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDropTargetId(null);
                if (dragItemId && dragCollectionId === item.collectionId && dragItemId !== item.id) {
                  moveItem(dragItemId, item.collectionId, item.id);
                  // Auto-expand the target folder
                  setExpanded((prev) => ({ ...prev, [`folder:${item.id}`]: true }));
                }
                setDragItemId(null);
                setDragCollectionId(null);
              }}
              onClick={() => toggleFolder(item.id)}
              onContextMenu={(e) => handleSubFolderContextMenu(e, item)}
              className={cn(
                "w-full flex items-center gap-1.5 pr-2 py-[3px] rounded-md text-[length:var(--fs-sidebar)] text-text-secondary hover:bg-bg-hover transition-colors group/folder",
                isDropTarget && "ring-1 ring-accent bg-accent/5",
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
                  className="flex-1 min-w-0 text-[length:var(--fs-sidebar-sm)] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-medium"
                  autoFocus
                />
              ) : (
                <span className="truncate text-[length:var(--fs-sidebar-sm)] font-medium">{item.name}</span>
              )}
              {childCount > 0 && (
                <span className="text-[var(--fs-3xs)] text-text-disabled ml-auto tabular-nums">{childCount}</span>
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
          onDragStart={(e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragItemId(item.id);
            setDragCollectionId(item.collectionId);
          }}
          onDragEnd={() => { setDragItemId(null); setDragCollectionId(null); setDropTargetId(null); }}
        />
      );
    });
  };

  return (
    <div className="py-0.5">
      {filteredCollections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] border border-border-subtle bg-bg-hover shadow-sm">
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
                if (dragItemId && dragCollectionId === col.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTargetId(`col:${col.id}`);
                }
              }}
              onDragLeave={() => { if (dropTargetId === `col:${col.id}`) setDropTargetId(null); }}
              onDrop={(e) => {
                e.preventDefault();
                setDropTargetId(null);
                if (dragItemId && dragCollectionId === col.id) {
                  moveItem(dragItemId, col.id, null);
                }
                setDragItemId(null);
                setDragCollectionId(null);
              }}
              className={cn(
                "w-full flex items-center gap-1.5 px-2 py-[4px] rounded-md text-[length:var(--fs-sidebar)] font-medium text-text-secondary hover:bg-bg-hover transition-colors group",
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
                  <span className="text-[var(--fs-3xs)] text-text-disabled ml-auto tabular-nums">{requestItems.length || ''}</span>
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
              {expanded[col.id] && (
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
  dragItemId, onDragStart, onDragEnd,
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
  handleItemContextMenu: (e: React.MouseEvent, item: { id: string; name: string; url: string | null; collectionId: string }) => void;
  dragItemId: string | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const curlCommand = useCallback(() => generateCurlFromItem(item), [item]);

  // 构建请求摘要信息
  const requestSummary = useMemo(() => {
    const summary: { label: string; value: string; accent?: string }[] = [];
    // URL
    if (item.url) summary.push({ label: "URL", value: item.url });
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
        onClick={() => isRenamingItem ? undefined : handleOpenItem(item)}
        onContextMenu={(e) => handleItemContextMenu(e, { ...item, name: item.name, url: item.url, collectionId: item.collectionId })}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        className={cn(
          "w-full flex items-center gap-2 pr-2 py-[3px] rounded-md text-[length:var(--fs-sidebar)] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors group/item",
          dragItemId === item.id && "opacity-40"
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className={cn(
          "text-[9px] font-semibold px-[3px] py-[0.5px] rounded shrink-0 min-w-[26px] text-center leading-tight",
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
            className="flex-1 min-w-0 text-[length:var(--fs-sidebar-sm)] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-mono"
            autoFocus
          />
        ) : (
          <span className="truncate font-mono text-[length:var(--fs-sidebar-sm)]">{item.name}</span>
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
              "text-[var(--fs-xxs)] font-bold px-1.5 py-[2px] rounded shrink-0",
              color.text, color.bg
            )}>
              {method}
            </span>
            <span className="text-[var(--fs-sm)] font-semibold text-text-primary truncate">{item.name}</span>
          </div>

          {/* 接口描述（如果有 — 使用 URL 作为补充说明） */}

          {/* 请求摘要 */}
          {requestSummary.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {requestSummary.map((s: { label: string; value: string; accent?: string }, i: number) => (
                <div key={i} className="flex items-start gap-2 text-[var(--fs-xs)]">
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
                <span className="text-[10px] font-semibold ml-1.5" style={{ color: 'var(--shell-accent)' }}>cURL</span>
              </div>
              <button
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-[2px] rounded text-[10px] font-medium transition-colors",
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

  // 从历史记录恢复请求到新 tab
  const handleOpenHistoryEntry = (entry: HistoryEntry) => {
    const tabId = addTab('http');
    if (!entry.requestConfig) return;
    try {
      const config = JSON.parse(entry.requestConfig);
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
  const groupByDate = (items: HistoryEntry[]) => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const groups: { label: string; items: HistoryEntry[] }[] = [];
    const todayItems: HistoryEntry[] = [];
    const yesterdayItems: HistoryEntry[] = [];
    const olderItems: HistoryEntry[] = [];

    for (const e of items) {
      const d = new Date(e.createdAt).toDateString();
      if (d === today) todayItems.push(e);
      else if (d === yesterday) yesterdayItems.push(e);
      else olderItems.push(e);
    }

    if (todayItems.length) groups.push({ label: t('sidebar.today'), items: todayItems });
    if (yesterdayItems.length) groups.push({ label: t('sidebar.yesterday'), items: yesterdayItems });
    if (olderItems.length) groups.push({ label: t('sidebar.earlier'), items: olderItems });
    return groups;
  };

  const filtered = entries.filter((e) => !search || e.url.includes(search) || e.method.includes(search.toUpperCase()));
  const groups = groupByDate(filtered);

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: HistoryEntry) => {
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
      return { path: pathAndQuery, origin: u.origin.replace(/^https?:\/\//, '') };
    } catch {
      return { path: urlString, origin: "" };
    }
  };

  return (
    <div className="py-0.5">
      {groups.map((group) => (
        <div key={group.label} className="mb-2">
          <div className="px-2 py-1 text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wider">
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
                    "text-[var(--fs-3xs)] font-bold px-1 py-[1px] rounded shrink-0 min-w-[28px] text-center",
                    color.text, color.bg
                  )}>
                    {h.method}
                  </span>
                  <div className="flex items-center min-w-0 font-mono text-[var(--fs-sidebar-sm)] flex-1">
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
                        "text-[var(--fs-3xs)] tabular-nums font-bold",
                        h.status < 400 ? "text-emerald-500" : "text-red-500"
                      )}>
                        {h.status}
                      </span>
                    ) : null}
                    <span className="text-[var(--fs-[10px])] text-text-disabled hidden group-hover:inline pr-0.5">
                      {formatTime(h.createdAt)}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] border border-border-subtle bg-bg-hover shadow-sm">
            <Clock className="w-6 h-6 text-text-tertiary" />
          </div>
          <p className="text-[var(--fs-sm)] font-medium text-text-secondary">{search ? t('sidebar.noHistoryMatch') : t('sidebar.noHistory')}</p>
          <p className="text-[var(--fs-xxs)] mt-1 text-text-disabled leading-relaxed">{t('sidebar.noHistoryHint')}</p>
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
                "w-[6px] h-[6px] rounded-[3px] shrink-0",
                isActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-border-strong"
              )} />
              <Globe className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-emerald-600" : "text-text-disabled")} />
              <span className={cn("truncate flex-1 text-left", isActive && "font-medium")}>{env.name}</span>
              {isActive && (
                <span className="rounded-[8px] bg-emerald-500/10 px-1.5 py-0.5 text-[var(--fs-3xs)] font-semibold text-emerald-600 shrink-0">{t('sidebar.active')}</span>
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

