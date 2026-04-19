import { useState, useEffect } from 'react';
import { X, FolderOpen, Plus, Save, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useCollectionStore } from '@/stores/collectionStore';
import type { HttpRequestConfig } from '@/types/http';
import type { CollectionItem } from '@/types/collections';
import { buildCollectionItemFromHttpConfig } from '@/lib/collectionRequest';

interface SaveRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: HttpRequestConfig;
  onSaved?: (item: CollectionItem) => void;
}

export function SaveRequestDialog({ isOpen, onClose, config, onSaved }: SaveRequestDialogProps) {
  const { t } = useTranslation();
  const { collections, fetchCollections, loadItems, items, saveRequest } = useCollectionStore();
  const [name, setName] = useState(config.name || 'Untitled Request');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchCollections();
      setName(config.name || 'Untitled Request');
    }
  }, [isOpen, config.name, fetchCollections]);

  useEffect(() => {
    if (selectedCollectionId) {
      loadItems(selectedCollectionId);
    }
  }, [selectedCollectionId, loadItems]);

  if (!isOpen) return null;

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      const { createCollection } = useCollectionStore.getState();
      await createCollection(newCollectionName.trim());
      await fetchCollections();
      setShowNewCollection(false);
      setNewCollectionName('');
    } catch (err) {
      console.error('创建集合失败:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedCollectionId || !name.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const item = buildCollectionItemFromHttpConfig({
        config,
        itemId: crypto.randomUUID(),
        collectionId: selectedCollectionId,
        parentId: selectedParentId || null,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        name: name.trim(),
      });
      const saved = await saveRequest(item);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      console.error('保存失败:', err);
    } finally {
      setSaving(false);
    }
  };

  const collectionFolders = selectedCollectionId
    ? (items[selectedCollectionId] || []).filter((i) => i.itemType === 'folder')
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[74vh] w-[520px] max-w-[92vw] flex-col overflow-hidden pf-rounded-xl border border-border-default bg-bg-primary shadow-[0_12px_32px_-4px_rgba(0,0,0,0.12),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-white/[0.08] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_16px_48px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-default/80 bg-bg-primary/78 px-5 py-4">
          <h2 className="pf-text-lg font-semibold text-text-primary flex items-center gap-2">
            <Save className="w-4 h-4 text-accent" />
            {t('saveDialog.title')}
          </h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center pf-rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-auto bg-bg-secondary/18 p-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="pf-text-sm font-medium text-text-secondary">{t('saveDialog.requestName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field w-full pf-text-base"
              placeholder={t('saveDialog.requestNamePlaceholder')}
              autoFocus
            />
          </div>

          {/* Collection Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="pf-text-sm font-medium text-text-secondary">{t('saveDialog.saveToCollection')}</label>
              <button
                onClick={() => setShowNewCollection(!showNewCollection)}
                className="pf-text-xs text-accent hover:text-accent-hover flex items-center gap-1 font-medium"
              >
                <Plus className="w-3 h-3" /> {t('saveDialog.newCollection')}
              </button>
            </div>

            {showNewCollection && (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder={t('saveDialog.collectionNamePlaceholder')}
                  className="input-field flex-1 pf-text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                />
                <button onClick={handleCreateCollection} className="h-7 px-3 bg-accent text-white rounded-md pf-text-xs font-medium hover:bg-accent-hover">
                  {t('saveDialog.create')}
                </button>
              </div>
            )}

            <div className="max-h-[220px] overflow-y-auto pf-rounded-xl border border-border-default/80 bg-bg-primary/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              {collections.length === 0 ? (
                <div className="p-4 text-center pf-text-sm text-text-disabled">{t('saveDialog.noCollections')}</div>
              ) : (
                collections.map((col) => (
                  <div key={col.id}>
                    <button
                      onClick={() => {
                        setSelectedCollectionId(col.id);
                        setSelectedParentId(null);
                        handleToggle(col.id);
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 pf-text-base text-left transition-colors hover:bg-bg-hover/70',
                        selectedCollectionId === col.id && !selectedParentId ? 'bg-accent/10 text-accent' : 'text-text-primary'
                      )}
                    >
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate flex-1">{col.name}</span>
                      {expandedIds.has(col.id) ? <ChevronDown className="w-3 h-3 text-text-disabled" /> : <ChevronRight className="w-3 h-3 text-text-disabled" />}
                    </button>
                    {expandedIds.has(col.id) && selectedCollectionId === col.id && collectionFolders.length > 0 && (
                      <div className="pl-6 border-l border-border-default ml-4">
                        {collectionFolders.map((folder) => (
                          <button
                            key={folder.id}
                            onClick={() => setSelectedParentId(folder.id)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-1.5 pf-text-sm text-left transition-colors hover:bg-bg-hover/70',
                              selectedParentId === folder.id ? 'bg-accent/10 text-accent' : 'text-text-secondary'
                            )}
                          >
                            <FolderOpen className="w-3 h-3 shrink-0" />
                            <span className="truncate">{folder.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-default/80 bg-bg-primary/78 px-5 py-3">
          <button
            onClick={onClose}
            className="h-8 pf-rounded-md px-4 pf-text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover"
          >
            {t('saveDialog.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedCollectionId || !name.trim() || saving}
            className="flex h-8 items-center gap-1.5 pf-rounded-md bg-accent px-5 pf-text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('saveDialog.saving') : t('saveDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
