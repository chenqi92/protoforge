// ProtoForge — ImportModal
// 统一导入弹窗：支持 Postman 文件导入 + Swagger URL 导入（含智能探测 & 分组选择）

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, FileJson, Globe, Search, ChevronRight,
  CheckSquare, Square, Loader2, Download, AlertCircle,
  MinusSquare, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCollectionStore } from '@/stores/collectionStore';
import { useEnvStore } from '@/stores/envStore';
import { fetchSwagger, fetchSwaggerGroup, importSwaggerEndpoints } from '@/services/collectionService';
import type { SwaggerParseResult, SwaggerEndpoint, SwaggerGroup } from '@/types/swagger';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

type ImportTab = 'file' | 'swagger';

const METHOD_COLORS: Record<string, { text: string; bg: string }> = {
  GET: { text: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  POST: { text: 'text-amber-600', bg: 'bg-amber-500/10' },
  PUT: { text: 'text-blue-600', bg: 'bg-blue-500/10' },
  DELETE: { text: 'text-red-600', bg: 'bg-red-500/10' },
  PATCH: { text: 'text-violet-600', bg: 'bg-violet-500/10' },
  HEAD: { text: 'text-gray-600', bg: 'bg-gray-500/10' },
  OPTIONS: { text: 'text-cyan-600', bg: 'bg-cyan-500/10' },
};

export function ImportModal({ open, onClose }: ImportModalProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('file');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-white/60 bg-bg-primary/96 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-default/75 bg-bg-primary/78 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_10px_25px_rgba(37,99,235,0.22)]">
              <Download className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <span className="block text-sm font-semibold text-text-primary">导入集合</span>
              <span className="block text-[11px] text-text-tertiary">从文件或 OpenAPI 规范快速导入到当前工作台</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-[12px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 border-b border-border-default/70 bg-bg-secondary/18 px-5 py-3">
          <div className="flex w-fit gap-1 rounded-[14px] border border-border-default/70 bg-bg-secondary/55 p-1">
          {[
            { id: 'file' as ImportTab, icon: FileJson, label: '文件导入' },
            { id: 'swagger' as ImportTab, icon: Globe, label: 'Swagger / OpenAPI' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded-[12px] px-4 py-2 text-[12px] font-medium transition-all',
                activeTab === id
                  ? 'bg-bg-primary text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]'
                  : 'text-text-tertiary hover:bg-bg-primary/70 hover:text-text-secondary'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0">
          <AnimatePresence mode="wait">
            {activeTab === 'file' && (
              <motion.div
                key="file"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <FileImportView onClose={onClose} />
              </motion.div>
            )}
            {activeTab === 'swagger' && (
              <motion.div
                key="swagger"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
              >
                <SwaggerImportView onClose={onClose} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

/* ── File Import View ── */
function FileImportView({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const importCollection = useCollectionStore((s) => s.importCollection);
  const importPostman = useCollectionStore((s) => s.importPostman);

  const handleSelectFile = async () => {
    setError(null);
    setSuccess(false);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: '选择 Postman 或 ProtoForge 集合文件',
      });
      if (!selected) return;

      setLoading(true);
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const json = await readTextFile(selected as string);

      const parsed = JSON.parse(json);
      if (parsed.info && parsed.item) {
        await importPostman(json);
      } else {
        await importCollection(json);
      }

      setSuccess(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 flex flex-col items-center gap-4">
      <div className="w-full max-w-md">
        <div
          onClick={handleSelectFile}
          className={cn(
            'flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all',
            loading
              ? 'border-accent/30 bg-accent-soft/10'
              : success
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-border-default hover:border-accent hover:bg-accent-soft/10'
          )}
        >
          {loading ? (
            <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
          ) : success ? (
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckSquare className="w-5 h-5 text-emerald-600" />
            </div>
          ) : (
            <FileJson className="w-8 h-8 text-text-disabled mb-3" />
          )}
          <p className="text-sm font-medium text-text-secondary">
            {loading ? '正在导入...' : success ? '导入成功！' : '点击选择文件'}
          </p>
          <p className="text-[11px] text-text-disabled mt-1">
            支持 Postman Collection v2.0/v2.1 和 ProtoForge 格式
          </p>
        </div>
      </div>

      {error && (
        <div className="w-full max-w-md flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-600 break-all">{error}</p>
        </div>
      )}
    </div>
  );
}

/* ── Swagger Import View ── */
function SwaggerImportView({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 探测到的分组
  const [groups, setGroups] = useState<SwaggerGroup[]>([]);
  // 已选中的分组 URL 集合
  const [selectedGroupUrls, setSelectedGroupUrls] = useState<Set<string>>(new Set());
  // 缓存：每个分组 URL → 解析结果
  const [groupCache, setGroupCache] = useState<Record<string, SwaggerParseResult>>({});
  // 正在加载的分组
  const [loadingGroupUrls, setLoadingGroupUrls] = useState<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);

  // 合并所有选中分组的接口
  const mergedEndpoints = useMemo(() => {
    const all: SwaggerEndpoint[] = [];
    for (const gUrl of selectedGroupUrls) {
      const cached = groupCache[gUrl];
      if (cached) {
        all.push(...cached.endpoints);
      }
    }
    return all;
  }, [selectedGroupUrls, groupCache]);

  // 合并后的 baseUrl（取第一个选中分组的）
  const mergedBaseUrl = useMemo(() => {
    for (const gUrl of selectedGroupUrls) {
      const cached = groupCache[gUrl];
      if (cached) return cached.baseUrl;
    }
    return '';
  }, [selectedGroupUrls, groupCache]);

  // 合并后的标题
  const mergedTitle = useMemo(() => {
    const titles: string[] = [];
    for (const gUrl of selectedGroupUrls) {
      const cached = groupCache[gUrl];
      if (cached && cached.title) titles.push(cached.title);
    }
    return titles.join(' + ') || 'Swagger Import';
  }, [selectedGroupUrls, groupCache]);

  const hasResults = mergedEndpoints.length > 0;

  const handleFetch = async () => {
    if (!url.trim()) return;
    setError(null);
    setGroups([]);
    setSelectedGroupUrls(new Set());
    setGroupCache({});
    setSelectedIds(new Set());
    setExpandedTags(new Set());
    setSearch('');
    setLoading(true);
    try {
      const discovery = await fetchSwagger(url.trim());
      setGroups(discovery.groups);

      if (discovery.groups.length === 0) {
        setError('未发现任何 API 分组或文档');
        return;
      }

      // 缓存默认解析结果
      const newCache: Record<string, SwaggerParseResult> = {};
      if (discovery.defaultResult && discovery.groups.length > 0) {
        newCache[discovery.groups[0].url] = discovery.defaultResult;
      }

      if (discovery.groups.length === 1) {
        // 只有一个分组，自动选中并加载
        const gUrl = discovery.groups[0].url;
        if (newCache[gUrl]) {
          setGroupCache(newCache);
          setSelectedGroupUrls(new Set([gUrl]));
          applyEndpoints(newCache[gUrl].endpoints);
          setCollectionName(newCache[gUrl].title || 'Swagger Import');
        } else {
          setGroupCache(newCache);
          // 需要加载
          await loadAndSelectGroup(gUrl, newCache);
        }
      } else {
        // 多个分组：默认全选 + 并行加载所有分组
        setGroupCache(newCache);
        const allUrls = new Set(discovery.groups.map(g => g.url));
        setSelectedGroupUrls(allUrls);
        // 使用默认解析结果的标题，而非硬编码
        const defaultTitle = discovery.defaultResult?.title || '';
        setCollectionName(defaultTitle || 'API 集合');

        // 并行获取所有分组（跳过已缓存的）
        const toFetch = discovery.groups.filter(g => !newCache[g.url]);
        if (toFetch.length > 0) {
          setGroupLoading(true);
          const loadingUrls = new Set(toFetch.map(g => g.url));
          setLoadingGroupUrls(loadingUrls);

          const results = await Promise.allSettled(
            toFetch.map(g => fetchSwaggerGroup(g.url).then(r => ({ url: g.url, result: r })))
          );

          const updatedCache = { ...newCache };
          for (const res of results) {
            if (res.status === 'fulfilled') {
              updatedCache[res.value.url] = res.value.result;
            }
          }
          setGroupCache(updatedCache);
          setLoadingGroupUrls(new Set());
          setGroupLoading(false);

          // 应用合并后的接口
          const allEps: SwaggerEndpoint[] = [];
          for (const gUrl of allUrls) {
            if (updatedCache[gUrl]) allEps.push(...updatedCache[gUrl].endpoints);
          }
          applyEndpoints(allEps);
        } else {
          // 全部已缓存
          const allEps: SwaggerEndpoint[] = [];
          for (const gUrl of allUrls) {
            if (newCache[gUrl]) allEps.push(...newCache[gUrl].endpoints);
          }
          applyEndpoints(allEps);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyEndpoints = (endpoints: SwaggerEndpoint[]) => {
    const allIds = new Set(endpoints.map((_, i) => `${i}`));
    setSelectedIds(allIds);
    const tags = new Set(endpoints.map(e => e.tag || 'default'));
    setExpandedTags(tags);
    setSearch('');
  };

  const loadAndSelectGroup = async (
    groupUrl: string,
    existingCache: Record<string, SwaggerParseResult>,
  ) => {
    setLoadingGroupUrls(prev => new Set([...prev, groupUrl]));
    setGroupLoading(true);
    try {
      const data = await fetchSwaggerGroup(groupUrl);
      const updatedCache = { ...existingCache, [groupUrl]: data };
      setGroupCache(updatedCache);
      setSelectedGroupUrls(prev => new Set([...prev, groupUrl]));
      setCollectionName(data.title || 'Swagger Import');
      // Re-compute merged endpoints with the updated selection
      const allEps: SwaggerEndpoint[] = [];
      const newSelection = new Set([...selectedGroupUrls, groupUrl]);
      for (const gUrl of newSelection) {
        if (updatedCache[gUrl]) allEps.push(...updatedCache[gUrl].endpoints);
      }
      applyEndpoints(allEps);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingGroupUrls(prev => {
        const next = new Set(prev);
        next.delete(groupUrl);
        return next;
      });
      setGroupLoading(false);
    }
  };

  const toggleGroupSelection = async (groupUrl: string) => {
    if (selectedGroupUrls.has(groupUrl)) {
      // 取消选中
      const next = new Set(selectedGroupUrls);
      next.delete(groupUrl);
      setSelectedGroupUrls(next);
      // 重新计算合并的接口
      const allEps: SwaggerEndpoint[] = [];
      for (const gUrl of next) {
        if (groupCache[gUrl]) allEps.push(...groupCache[gUrl].endpoints);
      }
      applyEndpoints(allEps);
    } else {
      // 选中
      if (groupCache[groupUrl]) {
        // 已缓存，直接添加
        const next = new Set([...selectedGroupUrls, groupUrl]);
        setSelectedGroupUrls(next);
        const allEps: SwaggerEndpoint[] = [];
        for (const gUrl of next) {
          if (groupCache[gUrl]) allEps.push(...groupCache[gUrl].endpoints);
        }
        applyEndpoints(allEps);
      } else {
        // 需从服务器加载
        await loadAndSelectGroup(groupUrl, groupCache);
      }
    }
  };

  const selectAllGroups = () => {
    const allUrls = new Set(groups.map(g => g.url));
    const allSelected = groups.every(g => selectedGroupUrls.has(g.url));

    if (allSelected) {
      setSelectedGroupUrls(new Set());
      applyEndpoints([]);
    } else {
      setSelectedGroupUrls(allUrls);
      const allEps: SwaggerEndpoint[] = [];
      for (const gUrl of allUrls) {
        if (groupCache[gUrl]) allEps.push(...groupCache[gUrl].endpoints);
      }
      applyEndpoints(allEps);

      // 加载未缓存的分组
      const toFetch = groups.filter(g => !groupCache[g.url]);
      if (toFetch.length > 0) {
        (async () => {
          setGroupLoading(true);
          const loadingUrls = new Set(toFetch.map(g => g.url));
          setLoadingGroupUrls(prev => new Set([...prev, ...loadingUrls]));

          const results = await Promise.allSettled(
            toFetch.map(g => fetchSwaggerGroup(g.url).then(r => ({ url: g.url, result: r })))
          );

          const updatedCache = { ...groupCache };
          for (const res of results) {
            if (res.status === 'fulfilled') {
              updatedCache[res.value.url] = res.value.result;
            }
          }
          setGroupCache(updatedCache);
          setLoadingGroupUrls(new Set());
          setGroupLoading(false);

          // 重新应用
          const merged: SwaggerEndpoint[] = [];
          for (const gUrl of allUrls) {
            if (updatedCache[gUrl]) merged.push(...updatedCache[gUrl].endpoints);
          }
          applyEndpoints(merged);
        })();
      }
    }
  };

  const handleImport = async () => {
    if (mergedEndpoints.length === 0 || selectedIds.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const selected = mergedEndpoints.filter((_, i) => selectedIds.has(`${i}`));
      await importSwaggerEndpoints(
        collectionName || mergedTitle || 'Swagger Import',
        mergedBaseUrl,
        selected,
      );
      // 自动将 baseUrl 添加到全局变量（若不存在同名变量）
      const envState = useEnvStore.getState();
      const existingVars = envState.globalVariables;
      const hasBaseUrl = existingVars.some(v => v.key === 'baseUrl');
      if (!hasBaseUrl && mergedBaseUrl) {
        await envState.saveGlobalVars([
          ...existingVars,
          { id: crypto.randomUUID(), key: 'baseUrl', value: mergedBaseUrl, enabled: 1 },
        ]);
      }
      await fetchCollections();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  // 按 tag 分组
  const groupedEndpoints = useMemo(() => {
    const grouped: Record<string, { endpoint: SwaggerEndpoint; index: number }[]> = {};
    mergedEndpoints.forEach((ep, i) => {
      const tag = ep.tag || 'default';
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push({ endpoint: ep, index: i });
    });
    return grouped;
  }, [mergedEndpoints]);

  // 搜索过滤
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedEndpoints;
    const q = search.toLowerCase();
    const filtered: Record<string, { endpoint: SwaggerEndpoint; index: number }[]> = {};
    for (const [tag, items] of Object.entries(groupedEndpoints)) {
      const matched = items.filter(({ endpoint: ep }) =>
        ep.path.toLowerCase().includes(q) ||
        ep.summary.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q) ||
        ep.operationId.toLowerCase().includes(q)
      );
      if (matched.length > 0) filtered[tag] = matched;
    }
    return filtered;
  }, [groupedEndpoints, search]);

  const toggleTag = (tag: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  };

  const toggleEndpoint = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllInTag = (tag: string) => {
    const tagItems = groupedEndpoints[tag] || [];
    const allSelected = tagItems.every(({ index }) => selectedIds.has(`${index}`));
    setSelectedIds(prev => {
      const next = new Set(prev);
      tagItems.forEach(({ index }) => {
        allSelected ? next.delete(`${index}`) : next.add(`${index}`);
      });
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === mergedEndpoints.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mergedEndpoints.map((_, i) => `${i}`)));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* URL Input */}
      <div className="p-4 pb-3 border-b border-border-subtle shrink-0">
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
            placeholder="输入 Swagger/OpenAPI 地址，支持 doc.html、swagger-ui 页面或 API 文档 URL"
            className="flex-1 h-9 px-3 text-[12px] bg-bg-secondary border border-border-default rounded-lg outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary placeholder:text-text-disabled transition-all font-mono"
          />
          <button
            onClick={handleFetch}
            disabled={loading || !url.trim()}
            className={cn(
              'h-9 px-4 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1.5 shrink-0',
              loading || !url.trim()
                ? 'bg-bg-hover text-text-disabled cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent/90 active:scale-[0.97]'
            )}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            {loading ? '探测中...' : '获取'}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-600 break-all whitespace-pre-wrap">{error}</p>
          </div>
        )}
      </div>

      {/* Group Selector (multi-select with checkboxes) */}
      {groups.length > 1 && (
        <div className="px-4 py-2.5 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-text-disabled shrink-0" />
            <span className="text-[11px] text-text-disabled shrink-0">
              API 分组（{selectedGroupUrls.size}/{groups.length} 已选）
            </span>
            <button
              onClick={selectAllGroups}
              disabled={groupLoading}
              className="text-[10px] text-accent hover:text-accent/80 ml-auto shrink-0 transition-colors"
            >
              {groups.every(g => selectedGroupUrls.has(g.url)) ? '取消全选' : '全选'}
            </button>
            {groupLoading && <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => {
              const isSelected = selectedGroupUrls.has(g.url);
              const isLoading = loadingGroupUrls.has(g.url);
              const cached = groupCache[g.url];
              const count = cached ? cached.endpoints.length : null;

              return (
                <button
                  key={g.url}
                  onClick={() => toggleGroupSelection(g.url)}
                  disabled={isLoading}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-all shrink-0 border',
                    isSelected
                      ? 'bg-accent/10 text-accent border-accent/30 font-medium'
                      : 'bg-bg-secondary text-text-tertiary border-border-default hover:bg-bg-hover hover:text-text-secondary',
                    isLoading && 'opacity-50 cursor-wait'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : isSelected ? (
                    <CheckSquare className="w-3 h-3" />
                  ) : (
                    <Square className="w-3 h-3" />
                  )}
                  {g.displayName || g.name}
                  {count !== null && (
                    <span className="text-[9px] opacity-60 tabular-nums">({count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <>
          {/* Meta + Search */}
          <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                <input
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  placeholder="集合名称"
                  className="flex-1 h-7 px-2 text-[12px] font-medium bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary transition-all min-w-0"
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-text-disabled shrink-0">
                <span>{mergedEndpoints.length} 接口</span>
                {selectedGroupUrls.size > 0 && groups.length > 1 && (
                  <>
                    <span>•</span>
                    <span>{selectedGroupUrls.size} 个分组</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索接口..."
                  className="w-full h-7 pl-7 pr-3 text-[11px] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-disabled transition-all"
                />
              </div>
              <button
                onClick={selectAll}
                className="flex items-center gap-1 h-7 px-2 text-[11px] text-text-tertiary hover:text-accent hover:bg-accent-soft rounded-md transition-colors"
              >
                {selectedIds.size === mergedEndpoints.length ? (
                  <MinusSquare className="w-3.5 h-3.5" />
                ) : (
                  <CheckSquare className="w-3.5 h-3.5" />
                )}
                {selectedIds.size === mergedEndpoints.length ? '取消全选' : '全选'}
              </button>
            </div>
          </div>

          {/* Endpoint List */}
          <div className="flex-1 overflow-auto px-2 py-1" style={{ maxHeight: '360px' }}>
            {Object.entries(filteredGroups).map(([tag, items]) => {
              const tagItems = groupedEndpoints[tag] || [];
              const allSelected = tagItems.every(({ index }) => selectedIds.has(`${index}`));
              const someSelected = tagItems.some(({ index }) => selectedIds.has(`${index}`));
              const isExpanded = expandedTags.has(tag);

              return (
                <div key={tag} className="mb-0.5">
                  {/* Tag Header */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors group">
                    <button
                      onClick={() => toggleTag(tag)}
                      className="flex items-center gap-1 flex-1 min-w-0"
                    >
                      <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.12 }}
                      >
                        <ChevronRight className="w-3 h-3 text-text-disabled" />
                      </motion.div>
                      <span className="text-[12px] font-medium text-text-secondary truncate">{tag}</span>
                      <span className="text-[10px] text-text-disabled ml-1 tabular-nums">({items.length})</span>
                    </button>
                    <button
                      onClick={() => toggleAllInTag(tag)}
                      className="p-0.5 text-text-disabled hover:text-accent transition-colors"
                    >
                      {allSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-accent" />
                      ) : someSelected ? (
                        <MinusSquare className="w-3.5 h-3.5 text-accent/50" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Endpoints */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        {items.map(({ endpoint: ep, index }) => {
                          const id = `${index}`;
                          const isSelected = selectedIds.has(id);
                          const color = METHOD_COLORS[ep.method] || { text: 'text-text-tertiary', bg: '' };

                          return (
                            <div
                              key={id}
                              onClick={() => toggleEndpoint(id)}
                              className={cn(
                                'flex items-center gap-2 pl-7 pr-2 py-[5px] rounded-md cursor-pointer transition-all group/ep',
                                isSelected
                                  ? 'bg-accent-soft/20 hover:bg-accent-soft/30'
                                  : 'hover:bg-bg-hover'
                              )}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-3.5 h-3.5 text-accent shrink-0" />
                              ) : (
                                <Square className="w-3.5 h-3.5 text-text-disabled shrink-0" />
                              )}
                              <span className={cn(
                                'text-[10px] font-bold px-1.5 py-[1px] rounded shrink-0 min-w-[38px] text-center',
                                color.text, color.bg
                              )}>
                                {ep.method}
                              </span>
                              <span className="text-[11px] font-mono text-text-secondary truncate flex-1 min-w-0">
                                {ep.path}
                              </span>
                              {ep.summary && (
                                <span className="text-[10px] text-text-disabled truncate max-w-[180px] shrink-0">
                                  {ep.summary}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {Object.keys(filteredGroups).length === 0 && search && (
              <div className="flex flex-col items-center py-8 text-text-disabled">
                <Search className="w-6 h-6 mb-2 opacity-30" />
                <p className="text-[12px]">没有匹配的接口</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-bg-secondary/50 shrink-0">
            <span className="text-[11px] text-text-disabled">
              已选择 <strong className="text-text-secondary">{selectedIds.size}</strong> / {mergedEndpoints.length} 个接口
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="h-8 px-4 text-[12px] font-medium text-text-secondary hover:bg-bg-hover rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={importing || selectedIds.size === 0}
                className={cn(
                  'h-8 px-5 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1.5',
                  importing || selectedIds.size === 0
                    ? 'bg-bg-hover text-text-disabled cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent/90 active:scale-[0.97]'
                )}
              >
                {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {importing ? '导入中...' : `导入 ${selectedIds.size} 个接口`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Loading state */}
      {(loading || (groupLoading && !hasResults)) && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-text-disabled">
          <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
          <p className="text-[12px]">{loading ? '正在探测 API 文档...' : '正在获取分组文档...'}</p>
        </div>
      )}

      {/* Empty state before fetch */}
      {!hasResults && !loading && !groupLoading && !error && groups.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-text-disabled">
          <Globe className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-[12px]">输入 Swagger/OpenAPI 地址并点击获取</p>
          <p className="text-[11px] mt-1 opacity-60">支持 doc.html、swagger-ui 页面，自动发现所有分组</p>
        </div>
      )}
    </div>
  );
}
