import { useEffect, useMemo, useState } from 'react';
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
  FolderOpen,
  GitMerge,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
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
import type { Collection, CollectionItem } from '@/types/collections';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

type ImportSource = 'file' | 'swagger';
type ImportMode = 'create' | 'merge';

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
    label: 'import.fileImport',
    desc: 'import.fileImportDesc',
    icon: FileJson,
    accentClassName: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-1 ring-inset ring-blue-500/15',
  },
  {
    id: 'swagger',
    label: 'import.openApiImport',
    desc: 'import.openApiImportDesc',
    icon: Globe,
    accentClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/15',
  },
];

const METHOD_COLORS: Record<string, { text: string; bg: string }> = {
  GET: { text: 'text-emerald-600 dark:text-emerald-300', bg: 'bg-emerald-500/10' },
  POST: { text: 'text-amber-600 dark:text-amber-300', bg: 'bg-amber-500/10' },
  PUT: { text: 'text-blue-600 dark:text-blue-300', bg: 'bg-blue-500/10' },
  DELETE: { text: 'text-red-600 dark:text-red-300', bg: 'bg-red-500/10' },
  PATCH: { text: 'text-violet-600 dark:text-violet-300', bg: 'bg-violet-500/10' },
  HEAD: { text: 'text-slate-600', bg: 'bg-slate-500/10' },
  OPTIONS: { text: 'text-cyan-600 dark:text-cyan-300', bg: 'bg-cyan-500/10' },
};

const inputClassName =
  'h-9 pf-rounded-md border border-border-default/80 bg-bg-secondary/60 px-3 pf-text-sm text-text-primary outline-none transition-all focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]';

export function ImportModal({ open, onClose }: ImportModalProps) {
  const { t } = useTranslation();
  const [activeSource, setActiveSource] = useState<ImportSource>('file');

  const currentSource = useMemo(
    () => sourceItems.find((item) => item.id === activeSource) ?? sourceItems[0],
    [activeSource]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        className="w-[1080px] max-w-[96vw] h-[88vh] gap-0 overflow-hidden pf-rounded-xl border border-white/65 bg-bg-primary p-0 shadow-[0_32px_90px_rgba(15,23,42,0.24)] sm:max-w-[1080px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('import.title')}</DialogTitle>

        <div className="flex h-full overflow-hidden flex-col">
          <div className="flex shrink-0 items-start justify-between border-b border-border-default/80 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center pf-rounded-xl bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] shadow-[0_12px_28px_rgba(37,99,235,0.24)]">
                <Download className="h-5 w-5 text-white" />
              </div>

              <div className="min-w-0">
                <p className="pf-text-xl font-semibold tracking-tight text-text-primary">{t('import.title')}</p>
                <p className="mt-1 pf-text-sm leading-6 text-text-secondary">
                  {t('import.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border-default/80 bg-bg-secondary/60 px-3 py-1 pf-text-xs font-medium text-text-secondary">
                {t('import.currentSource')}: {t(currentSource.label)}
              </span>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center pf-rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">{t('import.close')}</span>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border-default/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.78),rgba(255,255,255,0.42))] p-5 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(18,18,20,0.8))]">
              <div className="px-1 pb-3">
                <p className="pf-text-xxs font-semibold uppercase tracking-[0.18em] text-text-disabled">
                  {t('import.sourceTitle')}
                </p>
                <p className="mt-2 pf-text-xs leading-5 text-text-tertiary">
                  {t('import.sourceDesc')}
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
                        'group flex w-full items-center gap-3 pf-rounded-xl px-3.5 py-3 text-left transition-all',
                        isActive
                          ? 'bg-bg-primary/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-border-default'
                          : 'text-text-tertiary hover:bg-bg-primary/68 hover:text-text-primary'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center pf-rounded-lg transition-colors',
                          isActive ? item.accentClassName : 'bg-bg-secondary/80 text-text-disabled'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="pf-text-base font-semibold text-text-primary">{t(item.label)}</div>
                        <div className="mt-1 pf-text-xs leading-5 text-text-tertiary">{t(item.desc)}</div>
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
            </aside>

            <section className="min-w-0 overflow-hidden bg-bg-primary/36">
              <div className={cn('h-full', activeSource !== 'file' && 'hidden')}>
                <FileImportView onClose={onClose} accentClassName={sourceItems[0].accentClassName} />
              </div>
              <div className={cn('h-full', activeSource !== 'swagger' && 'hidden')}>
                <SwaggerImportView onClose={onClose} accentClassName={sourceItems[1].accentClassName} />
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Shared small components ── */

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
        'overflow-hidden pf-rounded-xl border border-border-default/80 bg-bg-primary/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      {children}
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
    <div className={cn('flex items-start gap-2 pf-rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-3', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-300" />
      <p className="break-all whitespace-pre-wrap pf-text-xs leading-5 text-red-600 dark:text-red-300">{error}</p>
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
      <div className="flex h-14 w-14 items-center justify-center pf-rounded-xl bg-bg-secondary/75 text-text-disabled">
        <Icon className="h-6 w-6 opacity-70" />
      </div>
      <p className="mt-4 pf-text-base font-semibold text-text-secondary">{title}</p>
      <p className="mt-2 max-w-md pf-text-xs leading-5 text-text-tertiary">{desc}</p>
    </div>
  );
}

/* ── Target selector + Import mode toggle (shared) ── */

function TargetSelector({
  targetCollectionId,
  setTargetCollectionId,
  targetFolderId,
  setTargetFolderId,
}: {
  targetCollectionId: string | null;
  setTargetCollectionId: (id: string | null) => void;
  targetFolderId: string | null;
  setTargetFolderId: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const collections = useCollectionStore((s) => s.collections);
  const items = useCollectionStore((s) => s.items);
  const fetchItems = useCollectionStore((s) => s.fetchItems);

  // Fetch items when a collection is selected
  useEffect(() => {
    if (targetCollectionId && !items[targetCollectionId]) {
      void fetchItems(targetCollectionId);
    }
  }, [targetCollectionId, items, fetchItems]);

  const folders = useMemo(() => {
    if (!targetCollectionId) return [];
    const colItems = items[targetCollectionId] || [];
    return colItems.filter((item: CollectionItem) => item.itemType === 'folder');
  }, [targetCollectionId, items]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-3.5 w-3.5 text-text-disabled" />
        <span className="pf-text-xs font-medium text-text-secondary">{t('import.targetCollection')}</span>
      </div>
      <select
        value={targetCollectionId ?? ''}
        onChange={(e) => {
          setTargetCollectionId(e.target.value || null);
          setTargetFolderId(null);
        }}
        className={cn(inputClassName, 'h-8 min-w-[160px] cursor-pointer px-2 pf-text-xs')}
      >
        <option value="">{t('import.createNewCollection')}</option>
        {collections.map((col: Collection) => (
          <option key={col.id} value={col.id}>{col.name}</option>
        ))}
      </select>

      {targetCollectionId && folders.length > 0 && (
        <>
          <ChevronRight className="h-3 w-3 text-text-disabled" />
          <select
            value={targetFolderId ?? ''}
            onChange={(e) => setTargetFolderId(e.target.value || null)}
            className={cn(inputClassName, 'h-8 min-w-[140px] cursor-pointer px-2 pf-text-xs')}
          >
            <option value="">{t('import.rootLevel')}</option>
            {folders.map((folder: CollectionItem) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function ImportModeToggle({
  mode,
  setMode,
}: {
  mode: ImportMode;
  setMode: (mode: ImportMode) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setMode('create')}
        className={cn(
          'flex items-center gap-1.5 pf-rounded-md px-3 py-1.5 pf-text-xs font-medium transition-all',
          mode === 'create'
            ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/20'
            : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
        )}
      >
        <Plus className="h-3 w-3" />
        {t('import.modeCreate')}
      </button>
      <button
        onClick={() => setMode('merge')}
        className={cn(
          'flex items-center gap-1.5 pf-rounded-md px-3 py-1.5 pf-text-xs font-medium transition-all',
          mode === 'merge'
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20'
            : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
        )}
      >
        <GitMerge className="h-3 w-3" />
        {t('import.modeMerge')}
      </button>
    </div>
  );
}

/* ── File Import View ── */

function FileImportView({
  onClose,
  accentClassName,
}: {
  onClose: () => void;
  accentClassName: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const importCollection = useCollectionStore((state) => state.importCollection);
  const importPostman = useCollectionStore((state) => state.importPostman);
  const fetchCollections = useCollectionStore((state) => state.fetchCollections);

  // Fetch collections on mount for the target selector
  useEffect(() => {
    void fetchCollections();
  }, [fetchCollections]);

  const handleSelectFile = async () => {
    setError(null);
    setSuccess(false);

    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: t('import.selectFile'),
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
    <div
      className="flex h-full min-h-0 flex-col p-6"
    >
      <PanelCard className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-border-default/60 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center pf-rounded-lg',
                  accentClassName
                )}
              >
                <FileJson className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="pf-text-2xl font-semibold tracking-tight text-text-primary">{t('import.fromFile')}</p>
                <p className="mt-1 pf-text-sm leading-6 text-text-secondary">{t('import.fromFileDesc')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Target + Mode bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default/60 px-6 py-3">
          <TargetSelector
            targetCollectionId={targetCollectionId}
            setTargetCollectionId={setTargetCollectionId}
            targetFolderId={targetFolderId}
            setTargetFolderId={setTargetFolderId}
          />
          <ImportModeToggle mode={importMode} setMode={setImportMode} />
        </div>

        {/* Upload area — full width, centered */}
        <button
          onClick={handleSelectFile}
          disabled={loading}
          className={cn(
            'group flex flex-1 flex-col items-center justify-center px-8 py-12 text-center transition-all',
            loading
              ? 'cursor-wait bg-accent-soft/10'
              : success
                ? 'bg-emerald-500/5 hover:bg-emerald-500/8'
                : 'hover:bg-accent-soft/6'
          )}
        >
          <div
            className={cn(
              'flex h-20 w-20 items-center justify-center pf-rounded-xl border-2 border-dashed transition-all',
              loading
                ? 'border-accent/40 bg-accent/8 text-accent'
                : success
                  ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-600 dark:text-emerald-300'
                  : 'border-border-default/80 bg-bg-secondary/50 text-text-disabled group-hover:border-accent/50 group-hover:bg-accent/8 group-hover:text-accent'
            )}
          >
            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : success ? (
              <CheckSquare className="h-8 w-8" />
            ) : (
              <FileJson className="h-8 w-8" />
            )}
          </div>

          <p className="mt-5 pf-text-lg font-semibold text-text-primary">
            {loading ? t('import.importing') : success ? t('import.importDone') : t('import.selectCollectionFile')}
          </p>
          <p className="mt-2 max-w-md pf-text-sm leading-6 text-text-tertiary">
            {loading
              ? t('import.importingDesc')
              : success
                ? t('import.importDoneDesc')
                : t('import.supportedFormats')}
          </p>
        </button>

        {/* Error area */}
        {error ? (
          <div className="border-t border-border-default/60 px-6 py-4">
            <AlertMessage error={error} />
          </div>
        ) : null}
      </PanelCard>
    </div>
  );
}

/* ── Swagger Import View ── */

function SwaggerImportView({
  onClose,
  accentClassName,
}: {
  onClose: () => void;
  accentClassName: string;
}) {
  const { t } = useTranslation();
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
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const fetchCollections = useCollectionStore((state) => state.fetchCollections);

  // Fetch collections on mount for the target selector
  useEffect(() => {
    void fetchCollections();
  }, [fetchCollections]);

  const mergeEndpoints = (
    urls: Set<string>,
    cache: Record<string, SwaggerParseResult>
  ): SwaggerEndpoint[] => {
    const all: SwaggerEndpoint[] = [];
    const seen = new Set<string>();
    for (const groupUrl of urls) {
      const cached = cache[groupUrl];
      if (cached) {
        for (const ep of cached.endpoints) {
          const key = `${ep.method}|${ep.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push(ep);
          }
        }
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
        setError(t('import.noApiFound'));
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
      setCollectionName(discovery.defaultResult?.title || t('import.apiCollection'));

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
    <div
      className="flex h-full min-h-0 flex-col p-6"
    >
      <PanelCard className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-border-default/60 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center pf-rounded-lg',
                  accentClassName
                )}
              >
                <Globe className="h-4.5 w-4.5" />
              </div>

              <div className="min-w-0">
                <p className="pf-text-2xl font-semibold tracking-tight text-text-primary">{t('import.fromOpenApi')}</p>
                <p className="mt-1 pf-text-sm leading-6 text-text-secondary">{t('import.fromOpenApiDesc')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pf-text-xs text-text-tertiary">
              {groups.length > 0 ? (
                <span className="rounded-full border border-border-default/80 bg-bg-secondary/60 px-2.5 py-1">
                  {t('import.groupCount', { count: groups.length })}
                </span>
              ) : null}
              {hasResults ? (
                <span className="rounded-full border border-border-default/80 bg-bg-secondary/60 px-2.5 py-1">
                  {t('import.endpointCount', { count: mergedEndpoints.length })}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Target + Mode bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default/60 px-6 py-3">
          <TargetSelector
            targetCollectionId={targetCollectionId}
            setTargetCollectionId={setTargetCollectionId}
            targetFolderId={targetFolderId}
            setTargetFolderId={setTargetFolderId}
          />
          <ImportModeToggle mode={importMode} setMode={setImportMode} />
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden p-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto">
            {/* URL Input Card */}
            <PanelCard>
              <div className="border-b border-border-default/60 px-5 py-4">
                <p className="pf-text-base font-semibold text-text-primary">{t('import.connectDoc')}</p>
                <p className="mt-1 pf-text-xs leading-5 text-text-tertiary">
                  {t('import.urlInputDesc')}
                </p>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="space-y-2">
                  <label className="pf-text-xs font-medium text-text-secondary">{t('import.docUrl')}</label>
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
                        'flex h-9 shrink-0 items-center gap-1.5 pf-rounded-md px-4 pf-text-sm font-medium transition-all',
                        loading || !url.trim()
                          ? 'cursor-not-allowed bg-bg-hover text-text-disabled'
                          : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                      )}
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                      {loading ? t('import.detecting') : t('import.fetch')}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="pf-text-xs font-medium text-text-secondary">{t('import.collectionName')}</label>
                  <input
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                    placeholder="例如: 支付中心 API"
                    className={inputClassName}
                  />
                </div>

                {mergedBaseUrl ? (
                  <div className="pf-rounded-xl border border-border-default/60 bg-bg-secondary/40 px-4 py-3">
                    <p className="pf-text-xs font-medium text-text-secondary">{t('import.parseResult')}</p>
                    <p className="mt-1 pf-text-xs leading-5 text-text-tertiary">
                      Base URL: <span className="font-mono text-text-secondary">{mergedBaseUrl}</span>
                    </p>
                  </div>
                ) : null}

                {error && !hasResults ? <AlertMessage error={error} /> : null}
              </div>
            </PanelCard>

            {/* Group selector */}
            {groups.length > 1 ? (
              <PanelCard>
                <div className="border-b border-border-default/60 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-text-disabled" />
                    <p className="pf-text-base font-semibold text-text-primary">{t('import.apiGroups')}</p>
                  </div>
                  <p className="mt-1 pf-text-xs leading-5 text-text-tertiary">
                    {t('import.groupSelectDesc')}
                  </p>
                </div>

                <div className="px-5 py-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="pf-text-xs text-text-tertiary">
                      {t('import.selectedGroups', { selected: selectedGroupUrls.size, total: groups.length })}
                    </span>
                    <button
                      onClick={selectAllGroups}
                      disabled={groupLoading}
                      className="pf-text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                    >
                      {allGroupsSelected ? t('import.deselectAll') : t('import.selectAll')}
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
                            'flex items-center gap-1.5 pf-rounded-md border px-3 py-1.5 pf-text-xs transition-all',
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
                            <span className="pf-text-xxs opacity-65">({count})</span>
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
                  title={t('import.waitDetect')}
                  desc={t('import.waitDetectDesc')}
                />
              </PanelCard>
            ) : null}
          </div>

          {/* Endpoint Preview */}
          <PanelCard className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-border-default/60 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="pf-text-base font-semibold text-text-primary">{t('import.endpointPreview')}</p>
                  <p className="mt-1 pf-text-xs leading-5 text-text-tertiary">
                    {t('import.endpointPreviewDesc')}
                  </p>
                </div>

                {hasResults ? (
                  <div className="rounded-full border border-border-default/80 bg-bg-secondary/60 px-2.5 py-1 pf-text-xs text-text-secondary">
                    {t('import.selectedEndpoints', { selected: selectedIds.size, total: mergedEndpoints.length })}
                  </div>
                ) : null}
              </div>
            </div>

            {hasResults ? (
              <>
                <div className="flex items-center gap-3 border-b border-border-default/60 px-5 py-4">
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
                    className="flex h-9 items-center gap-1.5 pf-rounded-md px-3 pf-text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  >
                    {selectedIds.size === mergedEndpoints.length ? (
                      <MinusSquare className="h-3.5 w-3.5" />
                    ) : (
                      <CheckSquare className="h-3.5 w-3.5" />
                    )}
                    {selectedIds.size === mergedEndpoints.length ? t('import.deselectAll') : t('import.selectAll')}
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
                        <div key={tag} className="mb-2 overflow-hidden pf-rounded-xl border border-border-default/60 bg-bg-secondary/24">
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
                              <span className="truncate pf-text-sm font-semibold text-text-secondary">{tag}</span>
                              <span className="pf-text-xxs text-text-disabled">({items.length})</span>
                            </button>

                            <button
                              onClick={() => toggleAllInTag(tag)}
                              className="flex h-7 w-7 items-center justify-center pf-rounded-md text-text-disabled transition-colors hover:bg-bg-hover hover:text-accent"
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
                                <div className="border-t border-border-default/60 px-2 py-2">
                                  {items.map(({ endpoint, index }) => {
                                    const id = `${index}`;
                                    const isSelected = selectedIds.has(id);
                                    const methodStyle = METHOD_COLORS[endpoint.method] || { text: 'text-text-tertiary', bg: 'bg-bg-secondary/50' };

                                    return (
                                      <button
                                        key={id}
                                        onClick={() => toggleEndpoint(id)}
                                        className={cn(
                                          'flex w-full items-center gap-2 pf-rounded-lg px-3 py-2 text-left transition-all',
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
                                            'min-w-[44px] shrink-0 pf-rounded-sm px-2 py-1 text-center pf-text-xxs font-bold',
                                            methodStyle.text,
                                            methodStyle.bg
                                          )}
                                        >
                                          {endpoint.method}
                                        </span>

                                        <span className="min-w-0 flex-1 truncate font-mono pf-text-xs text-text-secondary">
                                          {endpoint.path}
                                        </span>

                                        {endpoint.summary ? (
                                          <span className="max-w-[220px] shrink-0 truncate pf-text-xxs text-text-disabled">
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
                      title={t('import.noMatchEndpoints')}
                      desc={t('import.noMatchEndpointsDesc')}
                    />
                  )}
                </div>

                {/* Footer with import button */}
                <div className="border-t border-border-default/60 px-5 py-4">
                  {error ? <AlertMessage error={error} className="mb-4" /> : null}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={onClose}
                      className="h-9 pf-rounded-md px-4 pf-text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover"
                    >
                      {t('import.cancel')}
                    </button>
                    <button
                      onClick={() => void handleImport()}
                      disabled={importing || selectedIds.size === 0}
                      className={cn(
                        'flex h-9 items-center gap-1.5 pf-rounded-md px-4 pf-text-sm font-medium transition-all',
                        importing || selectedIds.size === 0
                          ? 'cursor-not-allowed bg-bg-hover text-text-disabled'
                          : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                      )}
                    >
                      {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      {importing ? t('import.importingBtn') : t('import.importEndpoints', { count: selectedIds.size })}
                    </button>
                  </div>
                </div>
              </>
            ) : loading || groupLoading ? (
              <EmptyState
                icon={Loader2}
                title={loading ? t('import.detectingDoc') : t('import.fetchingGroups')}
                desc={loading ? t('import.detectingDocDesc') : t('import.fetchingGroupsDesc')}
              />
            ) : (
              <EmptyState
                icon={Layers}
                title={t('import.waitPreview')}
                desc={t('import.waitPreviewDesc')}
              />
            )}
          </PanelCard>
        </div>
      </PanelCard>
    </div>
  );
}
