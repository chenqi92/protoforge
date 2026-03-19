import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Clock, Search, Plus,
  ChevronRight, Download, Settings, Globe,
  MoreHorizontal, Folder, Zap, Edit3, Trash2, ExternalLink, Copy, FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useEnvStore } from "@/stores/envStore";
import { ImportModal } from "@/components/collections/ImportModal";
import type { HistoryEntry, CollectionItem } from '@/types/collections';

type SidebarView = "collections" | "history" | "environments";

interface SidebarProps {
  panelCollapsed: boolean;
  onTogglePanel: () => void;
}

const navItems: { id: SidebarView; icon: typeof FolderOpen; label: string }[] = [
  { id: "collections", icon: FolderOpen, label: "集合" },
  { id: "environments", icon: Globe, label: "环境" },
  { id: "history", icon: Clock, label: "历史" },
];

export function Sidebar({ panelCollapsed, onTogglePanel }: SidebarProps) {
  const [activeView, setActiveView] = useState<SidebarView>("collections");
  const [search, setSearch] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);

  // 初始化数据
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
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
    await createCollection("新建集合");
  };

  const handleImport = () => {
    setImportModalOpen(true);
  };

  const handleNewEnvironment = async () => {
    await createEnvironment("新环境");
  };

  return (
    <div className="h-full flex">
      {/* ── Icon Rail ── */}
      <div className="w-11 h-full flex flex-col items-center pt-2 pb-3 bg-bg-tertiary/50 border-r border-border-default shrink-0">
        {navItems.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                "w-8 h-8 flex items-center justify-center rounded-md transition-all duration-150 relative mb-0.5",
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
        <div className="flex-1 h-full flex flex-col bg-bg-secondary overflow-hidden min-w-0">
          {/* Panel Header */}
          <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-border-subtle">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold text-text-primary truncate">
                  {navItems.find(n => n.id === activeView)?.label}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {activeView === "collections" && (
                  <>
                    <button
                      onClick={handleNewCollection}
                      className="h-6 px-2 flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent-soft rounded-md transition-all active:scale-[0.97]"
                      title="新建集合"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      新建
                    </button>
                    <button
                      onClick={handleImport}
                      className="h-6 px-2 flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-secondary rounded-md transition-colors"
                      title="导入"
                    >
                      <Download className="w-3 h-3" />
                      导入
                    </button>
                  </>
                )}
                {activeView === "environments" && (
                  <button
                    onClick={handleNewEnvironment}
                    className="h-6 px-2 flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent-soft rounded-md transition-all active:scale-[0.97]"
                    title="新增环境"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新增
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
                placeholder={`搜索${navItems.find(n => n.id === activeView)?.label}...`}
                className="w-full h-[30px] pl-8 pr-3 text-[12px] bg-bg-primary border border-border-default rounded-md outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary placeholder:text-text-tertiary transition-all"
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto px-1.5 py-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                {activeView === "collections" && <CollectionsView search={search} />}
                {activeView === "history" && <HistoryView search={search} />}
                {activeView === "environments" && <EnvironmentsView />}
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
function CollectionsView({ search }: { search: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const addTab = useAppStore((s) => s.addTab);
  const openCollectionTab = useAppStore((s) => s.addCollectionTab);
  const { showMenu, MenuComponent } = useContextMenu();

  const collections = useCollectionStore((s) => s.collections);
  const items = useCollectionStore((s) => s.items);
  const fetchItems = useCollectionStore((s) => s.fetchItems);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const renameCollection = useCollectionStore((s) => s.renameCollection);
  const renameItem = useCollectionStore((s) => s.renameItem);
  const createItem = useCollectionStore((s) => s.createItem);
  const deleteItem = useCollectionStore((s) => s.deleteItem);

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

  // 双击打开集合请求项
  const handleOpenItem = (item: CollectionItem) => {
    const store = useAppStore.getState();
    store.addTab('http');
    const tab = store.tabs[store.tabs.length - 1];
    if (tab && item.method && item.url) {
      // Parse authConfig JSON if present
      let authConfig: Record<string, string> = {};
      try { if (item.authConfig) authConfig = JSON.parse(item.authConfig); } catch { /* ignore */ }
      
      store.updateHttpConfig(tab.id, {
        method: (item.method || 'GET') as any,
        url: item.url || '',
        name: item.name,
        headers: item.headers ? JSON.parse(item.headers) : [],
        queryParams: item.queryParams ? JSON.parse(item.queryParams) : [],
        rawBody: item.bodyContent || '',
        bodyType: (item.bodyType || 'none') as any,
        authType: (item.authType || 'none') as any,
        bearerToken: authConfig.bearerToken || '',
        basicUsername: authConfig.basicUsername || '',
        basicPassword: authConfig.basicPassword || '',
        apiKeyName: authConfig.apiKeyName || '',
        apiKeyValue: authConfig.apiKeyValue || '',
        apiKeyAddTo: (authConfig.apiKeyIn || 'header') as any,
        preScript: item.preScript || '',
        postScript: item.postScript || '',
      });
    }
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
        title: '导出为 Postman 格式',
      });
      if (!filePath) return;
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(filePath, json);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleFolderContextMenu = (e: React.MouseEvent, col: { id: string; name: string }) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "new-req", label: "新建请求", icon: <Plus className="w-3.5 h-3.5" />, onClick: () => createItem(col.id, null, 'request', '新建请求') },
      { id: "new-folder", label: "新建文件夹", icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => createItem(col.id, null, 'folder', '新建文件夹') },
      { type: "divider" },
      { id: "settings", label: "合集设置", icon: <Settings className="w-3.5 h-3.5" />, onClick: () => openCollectionTab(col.id, col.name) },
      { id: "rename", label: "重命名", icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(col.id, col.name) },
      { id: "export-postman", label: "导出为 Postman", icon: <Download className="w-3.5 h-3.5" />, onClick: () => handleExportPostman(col.id, col.name) },
      { type: "divider" },
      { id: "delete", label: "删除", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteCollection(col.id) },
    ];
    showMenu(e, menuItems);
  };

  const handleItemContextMenu = (e: React.MouseEvent, item: { id: string; name: string; url: string | null; collectionId: string }) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "open", label: "在新标签打开", icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => addTab("http") },
      { id: "rename", label: "重命名", icon: <Edit3 className="w-3.5 h-3.5" />, onClick: () => startRename(item.id, item.name) },
      { id: "copy-url", label: "复制 URL", icon: <Copy className="w-3.5 h-3.5" />, onClick: () => { if (item.url) navigator.clipboard.writeText(item.url); } },
      { type: "divider" },
      { id: "delete", label: "删除", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteItem(item.id, item.collectionId) },
    ];
    showMenu(e, menuItems);
  };

  const filteredCollections = collections.filter(
    (col) => !search || col.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="py-0.5">
      {filteredCollections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-text-disabled">
          <FolderOpen className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-[12px]">{search ? "无匹配集合" : "暂无集合"}</p>
          <p className="text-[11px] mt-0.5 opacity-60">点击"新建"创建第一个集合</p>
        </div>
      )}
      {filteredCollections.map((col) => {
        const colItems = items[col.id] || [];
        const requestItems = colItems.filter((i) => i.itemType === 'request');
        return (
          <div key={col.id} className="mb-0.5">
            <button
              onClick={() => toggleExpand(col.id)}
              onContextMenu={(e) => handleFolderContextMenu(e, col)}
              className="w-full flex items-center gap-1.5 px-2 py-[6px] rounded-md text-[12px] font-medium text-text-secondary hover:bg-bg-hover transition-colors group"
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
                  className="flex-1 min-w-0 text-[12px] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-medium"
                  autoFocus
                />
              ) : (
                <span className="truncate">{col.name}</span>
              )}
              {renamingId !== col.id && (
                <>
                  <span className="text-[10px] text-text-disabled ml-auto tabular-nums">{requestItems.length || ''}</span>
                  <MoreHorizontal className="w-3.5 h-3.5 text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
                    <p className="pl-[30px] pr-2 py-2 text-[11px] text-text-disabled">空集合</p>
                  )}
                  {colItems.map((item) => {
                    const method = item.method || '';
                    const color = methodColors[method] || { text: "text-text-tertiary", bg: "" };
                    const isRenamingItem = renamingId === item.id;
                    return (
                      <button
                        key={item.id}
                        onDoubleClick={() => isRenamingItem ? undefined : handleOpenItem(item)}
                        onContextMenu={(e) => handleItemContextMenu(e, { ...item, name: item.name, url: item.url, collectionId: item.collectionId })}
                        className="w-full flex items-center gap-2 pl-[30px] pr-2 py-[5px] rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors group/item"
                      >
                        {item.itemType === 'request' ? (
                          <span className={cn(
                            "text-[10px] font-bold px-1 py-[1px] rounded shrink-0 min-w-[32px] text-center",
                            color.text, color.bg
                          )}>
                            {method}
                          </span>
                        ) : (
                          <Folder className="w-3 h-3 shrink-0 text-amber-500/50" fill="currentColor" />
                        )}
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
                            className="flex-1 min-w-0 text-[11px] bg-transparent border-b border-accent outline-none text-text-primary px-0.5 py-0 font-mono"
                            autoFocus
                          />
                        ) : (
                          <span className="truncate font-mono text-[11px]">{item.name}</span>
                        )}
                      </button>
                    );
                  })}
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

/* ── History View (Real Data) ── */
function HistoryView({ search }: { search: string }) {
  const addTab = useAppStore((s) => s.addTab);
  const { showMenu, MenuComponent } = useContextMenu();

  const entries = useHistoryStore((s) => s.entries);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);

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

    if (todayItems.length) groups.push({ label: "今天", items: todayItems });
    if (yesterdayItems.length) groups.push({ label: "昨天", items: yesterdayItems });
    if (olderItems.length) groups.push({ label: "更早", items: olderItems });
    return groups;
  };

  const filtered = entries.filter((e) => !search || e.url.includes(search) || e.method.includes(search.toUpperCase()));
  const groups = groupByDate(filtered);

  const handleHistoryContextMenu = (e: React.MouseEvent, entry: { id: string; url: string }) => {
    const menuItems: ContextMenuEntry[] = [
      { id: "open", label: "在新标签打开", icon: <ExternalLink className="w-3.5 h-3.5" />, onClick: () => addTab("http") },
      { id: "copy-url", label: "复制 URL", icon: <Copy className="w-3.5 h-3.5" />, onClick: () => navigator.clipboard.writeText(entry.url) },
      { type: "divider" },
      { id: "delete", label: "删除记录", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteEntry(entry.id) },
    ];
    showMenu(e, menuItems);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="py-0.5">
      {groups.map((group) => (
        <div key={group.label} className="mb-2">
          <div className="px-2 py-1 text-[10px] font-semibold text-text-disabled uppercase tracking-wider">
            {group.label}
          </div>
          {group.items.map((h) => {
            const color = methodColors[h.method] || { text: "text-text-tertiary", bg: "" };
            return (
              <button
                key={h.id}
                onDoubleClick={() => addTab("http")}
                onContextMenu={(e) => handleHistoryContextMenu(e, h)}
                className="w-full flex items-center gap-2 px-2 py-[5px] rounded-md text-[12px] hover:bg-bg-hover transition-colors group"
              >
                <span className={cn(
                  "text-[10px] font-bold px-1 py-[1px] rounded shrink-0 min-w-[32px] text-center",
                  color.text, color.bg
                )}>
                  {h.method}
                </span>
                <span className="truncate font-mono text-[11px] text-text-tertiary flex-1">{h.url}</span>
                {h.status && (
                  <span className={cn(
                    "text-[10px] shrink-0 tabular-nums font-medium",
                    h.status < 400 ? "text-emerald-600" : "text-red-500"
                  )}>
                    {h.status}
                  </span>
                )}
                <span className="text-[10px] text-text-disabled shrink-0 hidden group-hover:inline">
                  {formatTime(h.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-text-disabled">
          <Clock className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-[12px]">{search ? "无匹配记录" : "暂无历史记录"}</p>
          <p className="text-[11px] mt-0.5 opacity-60">发送请求后将自动记录</p>
        </div>
      )}
      {MenuComponent}
    </div>
  );
}

/* ── Environments View (Real Data) ── */
function EnvironmentsView() {
  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeEnvId);
  const setActive = useEnvStore((s) => s.setActive);
  const deleteEnvironment = useEnvStore((s) => s.deleteEnvironment);
  const { showMenu, MenuComponent } = useContextMenu();

  const handleEnvContextMenu = (e: React.MouseEvent, env: { id: string; name: string }) => {
    const isActive = env.id === activeEnvId;
    const menuItems: ContextMenuEntry[] = [
      { id: "activate", label: isActive ? "取消激活" : "设为活跃", icon: <Zap className="w-3.5 h-3.5" />, onClick: () => setActive(isActive ? null : env.id) },
      { type: "divider" },
      { id: "delete", label: "删除", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => deleteEnvironment(env.id) },
    ];
    showMenu(e, menuItems);
  };

  return (
    <div className="py-0.5">
      {environments.map((env) => {
        const isActive = env.id === activeEnvId;
        return (
          <div
            key={env.id}
            onClick={() => setActive(isActive ? null : env.id)}
            onContextMenu={(e) => handleEnvContextMenu(e, env)}
            className={cn(
              "flex items-center gap-2 px-2 py-[6px] rounded-md text-[12px] cursor-pointer transition-colors mb-0.5",
              isActive
                ? "text-text-secondary bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/8"
                : "text-text-tertiary hover:bg-bg-hover border border-transparent"
            )}
          >
            <div className={cn(
              "w-[6px] h-[6px] rounded-full shrink-0",
              isActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-border-strong"
            )} />
            <Globe className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-emerald-600" : "text-text-disabled")} />
            <span className={cn("truncate", isActive && "font-medium")}>{env.name}</span>
            {isActive && (
              <span className="text-[10px] text-emerald-600 ml-auto font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">活跃</span>
            )}
          </div>
        );
      })}

      {environments.length === 0 && (
        <div className="mt-4 px-2">
          <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-border-default text-text-tertiary hover:border-accent hover:text-accent transition-colors cursor-pointer group">
            <div className="w-8 h-8 rounded-md bg-bg-hover flex items-center justify-center group-hover:bg-accent-soft transition-colors">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium">环境变量</p>
              <p className="text-[10px] text-text-disabled">点击"新增"创建第一个环境</p>
            </div>
          </div>
        </div>
      )}
      {MenuComponent}
    </div>
  );
}
