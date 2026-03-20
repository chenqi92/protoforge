import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  type LucideIcon,
  X,
  FileJson,
  Globe,
  Search,
  ChevronRight,
  CheckSquare,
  Square,
  Loader2,
  Download,
  AlertCircle,
  MinusSquare,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useCollectionStore } from '@/stores/collectionStore';
import { useEnvStore } from '@/stores/envStore';
import {
  fetchSwagger,
  fetchSwaggerGroup,
  importSwaggerEndpoints,
} from '@/services/collectionService';
import type {
  SwaggerParseResult,
  SwaggerEndpoint,
  SwaggerGroup,
} from '@/types/swagger';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

type ImportSource = 'file' | 'swagger';

type SourceMeta = {
  id: ImportSource;
  label: string;
  desc: string;
  icon: LucideIcon;
  accentClassName: string;
};

const sourceItems: SourceMeta[] = [
  {
    id: 'file',
    label: '文件导入',
    desc: 'Postman 与 ProtoForge JSON 集合文件',
    icon: FileJson,
    accentClassName: 'bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500/15',
  },
  {
    id: 'swagger',
    label: 'OpenAPI 导入',
    desc: 'Swagger / OpenAPI URL 探测与接口预览',
    icon: Globe,
    accentClassName: 'bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15',
  },
];

const METHOD_COLORS: Record<string, { text: string; bg: string }> = {
  GET: { text: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  POST: { text: 'text-amber-600', bg: 'bg-amber-500/10' },
  PUT: { text: 'text-blue-600', bg: 'bg-blue-500/10' },
  DELETE: { text: 'text-red-600', bg: 'bg-red-500/10' },
  PATCH: { text: 'text-violet-600', bg: 'bg-violet-500/10' },
  HEAD: { text: 'text-slate-600', bg: 'bg-slate-500/10' },
  OPTIONS: { text: 'text-cyan-600', bg: 'bg-cyan-500/10' },
};

const inputClassName =
  'h-9 rounded-[12px] border border-border-default/80 bg-bg-secondary/60 px-3 text-[12px] text-text-primary outline-none transition-all focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]';

export function ImportModal({ open, onClose }: ImportModalProps) {
  const [activeSource, setActiveSource] = useState<ImportSource>('file');

  const currentSource = useMemo(
    () => sourceItems.find((item) => item.id === activeSource) ?? sourceItems[0],
    [activeSource]
  );

  const CurrentSourceIcon = currentSource.icon;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        className="w-[1080px] max-w-[96vw] min-h-[680px] max-h-[88vh] gap-0 overflow-hidden rounded-[28px] border border-white/65 bg-bg-primary/96 p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl sm:max-w-[1080px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">导入集合</DialogTitle>

        <div className="flex h-full min-h-[680px] flex-col">
          <div className="flex shrink-0 items-start justify-between border-b border-border-default/75 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_12px_28px_rgba(37,99,235,0.24)]">
                <Download className="h-5 w-5 text-white" />
              </div>

              <div className="min-w-0">
                <p className="text-[16px] font-semibold tracking-tight text-text-primary">导入集合</p>
                <p className="mt-1 text-[12px] leading-6 text-text-secondary">
                  从本地集合文件或 OpenAPI 文档快速生成请求工作区。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border-default/75 bg-bg-secondary/60 px-3 py-1 text-[11px] font-medium text-text-secondary">
                当前来源: {currentSource.label}
              </span>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-[14px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border-default/75 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] p-5 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="px-1 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  导入来源
                </p>
                <p className="mt-2 text-[11px] leading-5 text-text-tertiary">
                  选择导入方式，右侧会显示相应的配置和预览流程。
                </p>
              </div>

              <div className="space-y-1.5">
                {sourceItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeSource;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSource(item.id)}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-left transition-all',
                        isActive
                          ? 'bg-bg-primary/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-border-default'
                          : 'text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] transition-colors',
                          isActive ? item.accentClassName : 'bg-bg-secondary/80 text-text-disabled'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-text-primary">{item.label}</div>
                        <div className="mt-1 text-[11px] leading-5 text-text-tertiary">{item.desc}</div>
                      </div>

                      <ChevronRight
                        className={cn(
                          'h-4 w-4 shrink-0 transition-all',
                          isActive
                            ? 'translate-x-0 text-text-disabled opacity-100'
                            : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                        )}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mt-auto rounded-[20px] border border-border-default/75 bg-bg-primary/78 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-[12px] font-semibold text-text-primary">导入说明</p>
                <ul className="mt-3 space-y-2 text-[11px] leading-5 text-text-tertiary">
                  <li>文件导入支持 Postman v2.0/v2.1 与 ProtoForge JSON。</li>
                  <li>OpenAPI 导入支持 `doc.html`、`swagger-ui` 页面和原始规范地址。</li>
                  <li>所有导入内容会直接同步到当前集合工作台。</li>
                </ul>
              </div>
            </aside>

            <section className="min-w-0 bg-bg-primary/36">
              <AnimatePresence mode="wait">
                {activeSource === 'file' ? (
                  <FileImportView key="file" onClose={onClose} icon={CurrentSourceIcon} accentClassName={currentSource.accentClassName} />
                ) : (
                  <SwaggerImportView key="swagger" onClose={onClose} icon={CurrentSourceIcon} accentClassName={currentSource.accentClassName} />
                )}
              </AnimatePresence>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PanelCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[24px] border border-border-default/75 bg-bg-primary/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      {children}
    </div>
  );
}

function ContentHeader({
  icon: Icon,
  accentClassName,
  title,
  desc,
  extra,
}: {
  icon: LucideIcon;
  accentClassName: string;
  title: string;
  desc: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border-default/70 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px]',
              accentClassName
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>

          <div className="min-w-0">
            <p className="text-[17px] font-semibold tracking-tight text-text-primary">{title}</p>
            <p className="mt-1 text-[12px] leading-6 text-text-secondary">{desc}</p>
          </div>
        </div>

        {extra ? <div className="shrink-0">{extra}</div> : null}
      </div>
    </div>
  );
}

function AlertMessage({
  error,
  className,
}: {
  error: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-2 rounded-[16px] border border-red-500/15 bg-red-500/5 px-3 py-3', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      <p className="break-all whitespace-pre-wrap text-[11px] leading-5 text-red-600">{error}</p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-bg-secondary/75 text-text-disabled">
        <Icon className="h-6 w-6 opacity-70" />
      </div>
      <p className="mt-4 text-[13px] font-semibold text-text-secondary">{title}</p>
      <p className="mt-2 max-w-md text-[11px] leading-5 text-text-tertiary">{desc}</p>
    </div>
  );
}

function FileImportView({
  onClose,
  icon,
  accentClassName,
}: {
  onClose: () => void;
  icon: LucideIcon;
  accentClassName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const importCollection = useCollectionStore((state) => state.importCollection);
  const importPostman = useCollectionStore((state) => state.importPostman);

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
      setTimeout(onClose, 900);
    } catch (errorValue) {
      setError(String(errorValue));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className="flex h-full min-h-0 flex-col p-6"
    >
      <PanelCard className="flex min-h-0 flex-1 flex-col">
        <ContentHeader
          icon={icon}
          accentClassName={accentClassName}
          title="从集合文件导入"
          desc="选择本地 JSON 文件，系统会自动识别 Postman Collection 或 ProtoForge 集合格式。"
        />

        <div className="grid min-h-0 flex-1 gap-5 p-6 xl:grid-cols-[minmax(0,1.1fr)_300px]">
          <PanelCard className="flex min-h-[360px] flex-col border-dashed bg-bg-primary/72">
            <div className="border-b border-border-default/70 px-5 py-4">
              <p className="text-[13px] font-semibold text-text-primary">集合文件</p>
              <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                点击下方区域选择要导入的本地文件。
              </p>
            </div>

            <button
              onClick={handleSelectFile}
              disabled={loading}
              className={cn(
                'group flex flex-1 flex-col items-center justify-center px-8 py-10 text-center transition-all',
                loading
                  ? 'cursor-wait bg-accent-soft/10'
                  : success
                    ? 'bg-emerald-500/5 hover:bg-emerald-500/8'
                    : 'hover:bg-accent-soft/10'
              )}
            >
              {loading ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent/10 text-accent">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : success ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-emerald-500/10 text-emerald-600">
                  <CheckSquare className="h-6 w-6" />
                </div>
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-bg-secondary/75 text-text-disabled transition-colors group-hover:bg-accent/10 group-hover:text-accent">
                  <FileJson className="h-6 w-6" />
                </div>
              )}

              <p className="mt-4 text-[14px] font-semibold text-text-primary">
                {loading ? '正在导入文件...' : success ? '导入完成' : '选择集合文件'}
              </p>
              <p className="mt-2 max-w-sm text-[11px] leading-5 text-text-tertiary">
                {loading
                  ? '系统正在解析并写入集合数据，请稍候。'
                  : success
                    ? '集合已经成功导入，窗口即将自动关闭。'
                    : '支持 `.json` 文件，导入后会自动同步到集合侧栏。'}
              </p>
            </button>
          </PanelCard>

          <PanelCard className="flex min-h-[360px] flex-col">
            <div className="border-b border-border-default/70 px-5 py-4">
              <p className="text-[13px] font-semibold text-text-primary">支持内容</p>
              <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                当前文件导入会自动识别以下结构。
              </p>
            </div>

            <div className="space-y-4 px-5 py-5 text-[11px] text-text-tertiary">
              <div className="rounded-[16px] border border-border-default/70 bg-bg-secondary/40 p-4">
                <p className="text-[12px] font-semibold text-text-primary">Postman Collection</p>
                <p className="mt-1 leading-5">兼容 v2.0 / v2.1 结构，自动转换请求、文件夹和基础元数据。</p>
              </div>

              <div className="rounded-[16px] border border-border-default/70 bg-bg-secondary/40 p-4">
                <p className="text-[12px] font-semibold text-text-primary">ProtoForge JSON</p>
                <p className="mt-1 leading-5">直接恢复本地集合数据，适合跨设备迁移或备份恢复。</p>
              </div>

              <div className="rounded-[16px] border border-border-default/70 bg-bg-secondary/40 p-4">
                <p className="text-[12px] font-semibold text-text-primary">导入行为</p>
                <p className="mt-1 leading-5">导入完成后会立即刷新侧栏集合列表，不需要手动重载。</p>
              </div>
            </div>
          </PanelCard>
        </div>

        <div className="border-t border-border-default/70 px-6 py-4">
          {error ? <AlertMessage error={error} className="mb-4" /> : null}

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-text-tertiary">
              {success ? '导入成功，集合已同步到当前工作台。' : '建议优先使用导出的原始 JSON 文件进行导入。'}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="h-9 rounded-[12px] px-4 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
              >
                取消
              </button>
              <button
                onClick={handleSelectFile}
                disabled={loading}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-[12px] px-4 text-[12px] font-medium transition-all',
                  loading
                    ? 'cursor-wait bg-bg-hover text-text-disabled'
                    : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                )}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {loading ? '导入中...' : '选择文件'}
              </button>
            </div>
          </div>
        </div>
      </PanelCard>
    </motion.div>
  );
}

function SwaggerImportView({
  onClose,
  icon,
  accentClassName,
}: {
  onClose: () => void;
  icon: LucideIcon;
  accentClassName: string;
}) {
  const [url, setUrl] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<SwaggerGroup[]>([]);
  const [selectedGroupUrls, setSelectedGroupUrls] = useState<Set<string>>(new Set());
  const [groupCache, setGroupCache] = useState<Record<string, SwaggerParseResult>>({});
  const [loadingGroupUrls, setLoadingGroupUrls] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const fetchCollections = useCollectionStore((state) => state.fetchCollections);

  const mergeEndpoints = (
    urls: Set<string>,
    cache: Record<string, SwaggerParseResult>
  ): SwaggerEndpoint[] => {
    const all: SwaggerEndpoint[] = [];
    for (const groupUrl of urls) {
      const cached = cache[groupUrl];
      if (cached) {
        all.push(...cached.endpoints);
      }
    }
    return all;
  };

  const applyEndpoints = (endpoints: SwaggerEndpoint[]) => {
    setSelectedIds(new Set(endpoints.map((_, index) => `${index}`)));
    setExpandedTags(new Set(endpoints.map((endpoint) => endpoint.tag || 'default')));
    setSearch('');
  };

  const mergedEndpoints = useMemo(
    () => mergeEndpoints(selectedGroupUrls, groupCache),
    [selectedGroupUrls, groupCache]
  );

  const mergedBaseUrl = useMemo(() => {
    for (const groupUrl of selectedGroupUrls) {
      const cached = groupCache[groupUrl];
      if (cached?.baseUrl) return cached.baseUrl;
    }
    return '';
  }, [selectedGroupUrls, groupCache]);

  const mergedTitle = useMemo(() => {
    const titles: string[] = [];
    for (const groupUrl of selectedGroupUrls) {
      const cached = groupCache[groupUrl];
      if (cached?.title) titles.push(cached.title);
    }
    return titles.join(' + ') || 'Swagger Import';
  }, [selectedGroupUrls, groupCache]);

  const groupedEndpoints = useMemo(() => {
    const grouped: Record<string, { endpoint: SwaggerEndpoint; index: number }[]> = {};

    mergedEndpoints.forEach((endpoint, index) => {
      const tag = endpoint.tag || 'default';
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push({ endpoint, index });
    });

    return grouped;
  }, [mergedEndpoints]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedEndpoints;

    const query = search.toLowerCase();
    const filtered: Record<string, { endpoint: SwaggerEndpoint; index: number }[]> = {};

    for (const [tag, items] of Object.entries(groupedEndpoints)) {
      const matched = items.filter(({ endpoint }) =>
        endpoint.path.toLowerCase().includes(query)
        || endpoint.summary.toLowerCase().includes(query)
        || endpoint.method.toLowerCase().includes(query)
        || endpoint.operationId.toLowerCase().includes(query)
      );

      if (matched.length > 0) {
        filtered[tag] = matched;
      }
    }

    return filtered;
  }, [groupedEndpoints, search]);

  const hasResults = mergedEndpoints.length > 0;
  const allGroupsSelected = groups.length > 0 && groups.every((group) => selectedGroupUrls.has(group.url));

  const loadAndSelectGroup = async (
    groupUrl: string,
    existingCache: Record<string, SwaggerParseResult>
  ) => {
    setLoadingGroupUrls((previous) => new Set([...previous, groupUrl]));
    setGroupLoading(true);

    try {
      const data = await fetchSwaggerGroup(groupUrl);
      const updatedCache = { ...existingCache, [groupUrl]: data };
      let nextSelection = new Set<string>();

      setGroupCache(updatedCache);
      setSelectedGroupUrls((previous) => {
        nextSelection = new Set(previous);
        nextSelection.add(groupUrl);
        return nextSelection;
      });

      setCollectionName((previous) => previous || data.title || 'Swagger Import');
      applyEndpoints(mergeEndpoints(nextSelection, updatedCache));
    } catch (errorValue) {
      setError(String(errorValue));
    } finally {
      setLoadingGroupUrls((previous) => {
        const next = new Set(previous);
        next.delete(groupUrl);
        return next;
      });
      setGroupLoading(false);
    }
  };

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

      const initialCache: Record<string, SwaggerParseResult> = {};
      if (discovery.defaultResult && discovery.groups.length > 0) {
        initialCache[discovery.groups[0].url] = discovery.defaultResult;
      }

      setGroupCache(initialCache);

      if (discovery.groups.length === 1) {
        const groupUrl = discovery.groups[0].url;
        if (initialCache[groupUrl]) {
          setSelectedGroupUrls(new Set([groupUrl]));
          setCollectionName(initialCache[groupUrl].title || 'Swagger Import');
          applyEndpoints(initialCache[groupUrl].endpoints);
        } else {
          await loadAndSelectGroup(groupUrl, initialCache);
        }
        return;
      }

      const allUrls = new Set(discovery.groups.map((group) => group.url));
      setSelectedGroupUrls(allUrls);
      setCollectionName(discovery.defaultResult?.title || 'API 集合');

      const toFetch = discovery.groups.filter((group) => !initialCache[group.url]);
      if (toFetch.length === 0) {
        applyEndpoints(mergeEndpoints(allUrls, initialCache));
        return;
      }

      setGroupLoading(true);
      setLoadingGroupUrls(new Set(toFetch.map((group) => group.url)));

      const results = await Promise.allSettled(
        toFetch.map((group) => fetchSwaggerGroup(group.url).then((result) => ({ url: group.url, result })))
      );

      const updatedCache = { ...initialCache };
      for (const result of results) {
        if (result.status === 'fulfilled') {
          updatedCache[result.value.url] = result.value.result;
        }
      }

      setGroupCache(updatedCache);
      setLoadingGroupUrls(new Set());
      setGroupLoading(false);
      applyEndpoints(mergeEndpoints(allUrls, updatedCache));
    } catch (errorValue) {
      setError(String(errorValue));
    } finally {
      setLoading(false);
    }
  };

  const toggleGroupSelection = async (groupUrl: string) => {
    if (selectedGroupUrls.has(groupUrl)) {
      const nextSelection = new Set(selectedGroupUrls);
      nextSelection.delete(groupUrl);
      setSelectedGroupUrls(nextSelection);
      applyEndpoints(mergeEndpoints(nextSelection, groupCache));
      return;
    }

    if (groupCache[groupUrl]) {
      const nextSelection = new Set(selectedGroupUrls);
      nextSelection.add(groupUrl);
      setSelectedGroupUrls(nextSelection);
      applyEndpoints(mergeEndpoints(nextSelection, groupCache));
      return;
    }

    await loadAndSelectGroup(groupUrl, groupCache);
  };

  const selectAllGroups = () => {
    const allUrls = new Set(groups.map((group) => group.url));

    if (allGroupsSelected) {
      setSelectedGroupUrls(new Set());
      applyEndpoints([]);
      return;
    }

    setSelectedGroupUrls(allUrls);
    applyEndpoints(mergeEndpoints(allUrls, groupCache));

    const toFetch = groups.filter((group) => !groupCache[group.url]);
    if (toFetch.length === 0) return;

    void (async () => {
      setGroupLoading(true);
      setLoadingGroupUrls(new Set(toFetch.map((group) => group.url)));

      const results = await Promise.allSettled(
        toFetch.map((group) => fetchSwaggerGroup(group.url).then((result) => ({ url: group.url, result })))
      );

      const updatedCache = { ...groupCache };
      for (const result of results) {
        if (result.status === 'fulfilled') {
          updatedCache[result.value.url] = result.value.result;
        }
      }

      setGroupCache(updatedCache);
      setLoadingGroupUrls(new Set());
      setGroupLoading(false);
      applyEndpoints(mergeEndpoints(allUrls, updatedCache));
    })();
  };

  const toggleTag = (tag: string) => {
    setExpandedTags((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const toggleEndpoint = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllInTag = (tag: string) => {
    const items = groupedEndpoints[tag] || [];
    const allSelected = items.every(({ index }) => selectedIds.has(`${index}`));

    setSelectedIds((previous) => {
      const next = new Set(previous);
      items.forEach(({ index }) => {
        if (allSelected) {
          next.delete(`${index}`);
        } else {
          next.add(`${index}`);
        }
      });
      return next;
    });
  };

  const selectAllEndpoints = () => {
    if (selectedIds.size === mergedEndpoints.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(mergedEndpoints.map((_, index) => `${index}`)));
  };

  const handleImport = async () => {
    if (mergedEndpoints.length === 0 || selectedIds.size === 0) return;

    setImporting(true);
    setError(null);

    try {
      const selectedEndpoints = mergedEndpoints.filter((_, index) => selectedIds.has(`${index}`));

      await importSwaggerEndpoints(
        collectionName || mergedTitle || 'Swagger Import',
        mergedBaseUrl,
        selectedEndpoints
      );

      const envState = useEnvStore.getState();
      const existingVars = envState.globalVariables;
      const hasBaseUrl = existingVars.some((item) => item.key === 'baseUrl');

      if (!hasBaseUrl && mergedBaseUrl) {
        await envState.saveGlobalVars([
          ...existingVars,
          { id: crypto.randomUUID(), key: 'baseUrl', value: mergedBaseUrl, enabled: 1 },
        ]);
      }

      await fetchCollections();
      onClose();
    } catch (errorValue) {
      setError(String(errorValue));
    } finally {
      setImporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className="flex h-full min-h-0 flex-col p-6"
    >
      <PanelCard className="flex min-h-0 flex-1 flex-col">
        <ContentHeader
          icon={icon}
          accentClassName={accentClassName}
          title="从 OpenAPI 文档导入"
          desc="输入 Swagger / OpenAPI 地址，自动探测分组并按需预览后导入。"
          extra={
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              {groups.length > 0 ? (
                <span className="rounded-full border border-border-default/75 bg-bg-secondary/60 px-2.5 py-1">
                  {groups.length} 个分组
                </span>
              ) : null}
              {hasResults ? (
                <span className="rounded-full border border-border-default/75 bg-bg-secondary/60 px-2.5 py-1">
                  {mergedEndpoints.length} 个接口
                </span>
              ) : null}
            </div>
          }
        />

        <div className="grid min-h-0 flex-1 gap-5 p-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-5">
            <PanelCard>
              <div className="border-b border-border-default/70 px-5 py-4">
                <p className="text-[13px] font-semibold text-text-primary">连接文档</p>
                <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                  输入文档 URL，支持 `doc.html`、`swagger-ui` 页面或原始规范地址。
                </p>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-secondary">文档地址</label>
                  <div className="flex gap-2">
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void handleFetch();
                        }
                      }}
                      placeholder="https://api.example.com/v3/api-docs"
                      className={cn(inputClassName, 'flex-1 font-mono')}
                    />
                    <button
                      onClick={() => void handleFetch()}
                      disabled={loading || !url.trim()}
                      className={cn(
                        'flex h-9 shrink-0 items-center gap-1.5 rounded-[12px] px-4 text-[12px] font-medium transition-all',
                        loading || !url.trim()
                          ? 'cursor-not-allowed bg-bg-hover text-text-disabled'
                          : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                      )}
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                      {loading ? '探测中...' : '获取'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-secondary">集合名称</label>
                  <input
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                    placeholder="例如: 支付中心 API"
                    className={inputClassName}
                  />
                </div>

                {mergedBaseUrl ? (
                  <div className="rounded-[16px] border border-border-default/70 bg-bg-secondary/40 px-4 py-3">
                    <p className="text-[11px] font-medium text-text-secondary">解析结果</p>
                    <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                      Base URL: <span className="font-mono text-text-secondary">{mergedBaseUrl}</span>
                    </p>
                  </div>
                ) : null}

                {error ? <AlertMessage error={error} /> : null}
              </div>
            </PanelCard>

            {groups.length > 1 ? (
              <PanelCard>
                <div className="border-b border-border-default/70 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-text-disabled" />
                    <p className="text-[13px] font-semibold text-text-primary">API 分组</p>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                    选择需要导入的文档分组，未缓存的分组会自动拉取。
                  </p>
                </div>

                <div className="px-5 py-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">
                      已选 {selectedGroupUrls.size} / {groups.length}
                    </span>
                    <button
                      onClick={selectAllGroups}
                      disabled={groupLoading}
                      className="text-[11px] font-medium text-accent transition-colors hover:text-accent-hover"
                    >
                      {allGroupsSelected ? '取消全选' : '全选'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {groups.map((group) => {
                      const isSelected = selectedGroupUrls.has(group.url);
                      const isLoading = loadingGroupUrls.has(group.url);
                      const count = groupCache[group.url]?.endpoints.length;

                      return (
                        <button
                          key={group.url}
                          onClick={() => void toggleGroupSelection(group.url)}
                          disabled={isLoading}
                          className={cn(
                            'flex items-center gap-1.5 rounded-[12px] border px-3 py-1.5 text-[11px] transition-all',
                            isSelected
                              ? 'border-accent/30 bg-accent/10 text-accent'
                              : 'border-border-default bg-bg-secondary/50 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
                            isLoading && 'cursor-wait opacity-60'
                          )}
                        >
                          {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isSelected ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>{group.displayName || group.name}</span>
                          {count !== undefined ? (
                            <span className="text-[10px] opacity-65">({count})</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </PanelCard>
            ) : null}

            {!hasResults && !loading && !groupLoading ? (
              <PanelCard className="flex flex-1 flex-col">
                <EmptyState
                  icon={Globe}
                  title="等待探测文档"
                  desc="输入文档地址后，系统会自动识别分组、解析接口并生成可导入预览。"
                />
              </PanelCard>
            ) : null}
          </div>

          <PanelCard className="flex min-h-[460px] min-h-0 flex-col">
            <div className="border-b border-border-default/70 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary">接口预览</p>
                  <p className="mt-1 text-[11px] leading-5 text-text-tertiary">
                    按标签分组浏览接口，并控制最终导入项。
                  </p>
                </div>

                {hasResults ? (
                  <div className="rounded-full border border-border-default/75 bg-bg-secondary/60 px-2.5 py-1 text-[11px] text-text-secondary">
                    已选择 {selectedIds.size} / {mergedEndpoints.length}
                  </div>
                ) : null}
              </div>
            </div>

            {hasResults ? (
              <>
                <div className="flex items-center gap-3 border-b border-border-default/70 px-5 py-4">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索路径、摘要或方法..."
                      className={cn(inputClassName, 'w-full pl-9')}
                    />
                  </div>

                  <button
                    onClick={selectAllEndpoints}
                    className="flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  >
                    {selectedIds.size === mergedEndpoints.length ? (
                      <MinusSquare className="h-3.5 w-3.5" />
                    ) : (
                      <CheckSquare className="h-3.5 w-3.5" />
                    )}
                    {selectedIds.size === mergedEndpoints.length ? '取消全选' : '全选'}
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                  {Object.entries(filteredGroups).length > 0 ? (
                    Object.entries(filteredGroups).map(([tag, items]) => {
                      const sourceItemsInTag = groupedEndpoints[tag] || [];
                      const allSelectedInTag = sourceItemsInTag.every(({ index }) => selectedIds.has(`${index}`));
                      const someSelectedInTag = sourceItemsInTag.some(({ index }) => selectedIds.has(`${index}`));
                      const expanded = expandedTags.has(tag);

                      return (
                        <div key={tag} className="mb-2 overflow-hidden rounded-[18px] border border-border-default/65 bg-bg-secondary/24">
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <button
                              onClick={() => toggleTag(tag)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <motion.div
                                animate={{ rotate: expanded ? 90 : 0 }}
                                transition={{ duration: 0.14 }}
                                className="shrink-0"
                              >
                                <ChevronRight className="h-3.5 w-3.5 text-text-disabled" />
                              </motion.div>
                              <span className="truncate text-[12px] font-semibold text-text-secondary">{tag}</span>
                              <span className="text-[10px] text-text-disabled">({items.length})</span>
                            </button>

                            <button
                              onClick={() => toggleAllInTag(tag)}
                              className="flex h-7 w-7 items-center justify-center rounded-[10px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
                            >
                              {allSelectedInTag ? (
                                <CheckSquare className="h-3.5 w-3.5 text-accent" />
                              ) : someSelectedInTag ? (
                                <MinusSquare className="h-3.5 w-3.5 text-accent/60" />
                              ) : (
                                <Square className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>

                          <AnimatePresence initial={false}>
                            {expanded ? (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.16 }}
                                className="overflow-hidden"
                              >
                                <div className="border-t border-border-default/65 px-2 py-2">
                                  {items.map(({ endpoint, index }) => {
                                    const id = `${index}`;
                                    const isSelected = selectedIds.has(id);
                                    const methodStyle = METHOD_COLORS[endpoint.method] || { text: 'text-text-tertiary', bg: 'bg-bg-secondary/50' };

                                    return (
                                      <button
                                        key={id}
                                        onClick={() => toggleEndpoint(id)}
                                        className={cn(
                                          'flex w-full items-center gap-2 rounded-[14px] px-3 py-2 text-left transition-all',
                                          isSelected
                                            ? 'bg-accent-soft/18 hover:bg-accent-soft/24'
                                            : 'hover:bg-bg-hover/80'
                                        )}
                                      >
                                        {isSelected ? (
                                          <CheckSquare className="h-4 w-4 shrink-0 text-accent" />
                                        ) : (
                                          <Square className="h-4 w-4 shrink-0 text-text-disabled" />
                                        )}

                                        <span
                                          className={cn(
                                            'min-w-[44px] shrink-0 rounded-[8px] px-2 py-1 text-center text-[10px] font-bold',
                                            methodStyle.text,
                                            methodStyle.bg
                                          )}
                                        >
                                          {endpoint.method}
                                        </span>

                                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">
                                          {endpoint.path}
                                        </span>

                                        {endpoint.summary ? (
                                          <span className="max-w-[220px] shrink-0 truncate text-[10px] text-text-disabled">
                                            {endpoint.summary}
                                          </span>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  ) : (
                    <EmptyState
                      icon={Search}
                      title="没有匹配的接口"
                      desc="尝试调整搜索关键字，或者重新选择需要导入的 API 分组。"
                    />
                  )}
                </div>

                <div className="border-t border-border-default/70 px-5 py-4">
                  {error ? <AlertMessage error={error} className="mb-4" /> : null}

                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-text-tertiary">
                      {mergedTitle ? (
                        <span>
                          文档标题: <span className="text-text-secondary">{mergedTitle}</span>
                        </span>
                      ) : (
                        <span>导入时会自动创建集合并写入选中的接口。</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={onClose}
                        className="h-9 rounded-[12px] px-4 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => void handleImport()}
                        disabled={importing || selectedIds.size === 0}
                        className={cn(
                          'flex h-9 items-center gap-1.5 rounded-[12px] px-4 text-[12px] font-medium transition-all',
                          importing || selectedIds.size === 0
                            ? 'cursor-not-allowed bg-bg-hover text-text-disabled'
                            : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                        )}
                      >
                        {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {importing ? '导入中...' : `导入 ${selectedIds.size} 个接口`}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : loading || groupLoading ? (
              <EmptyState
                icon={Loader2}
                title={loading ? '正在探测文档' : '正在获取分组'}
                desc={loading ? '系统正在识别可用的 API 文档分组。' : '正在拉取选中分组的接口详情，请稍候。'}
              />
            ) : (
              <EmptyState
                icon={Layers}
                title="等待接口预览"
                desc="完成文档探测后，这里会展示分组后的接口预览和导入选择。"
              />
            )}
          </PanelCard>
        </div>
      </PanelCard>
    </motion.div>
  );
}
