import { useState, useEffect } from 'react';
import { X, FolderOpen, Plus, Save, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCollectionStore } from '@/stores/collectionStore';
import type { HttpRequestConfig } from '@/types/http';
import type { CollectionItem } from '@/types/collections';

interface SaveRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: HttpRequestConfig;
  onSaved?: (item: CollectionItem) => void;
}

export function SaveRequestDialog({ isOpen, onClose, config, onSaved }: SaveRequestDialogProps) {
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
      const item: CollectionItem = {
        id: crypto.randomUUID(),
        collectionId: selectedCollectionId,
        parentId: selectedParentId || null,
        itemType: 'request',
        name: name.trim(),
        sortOrder: 0,
        method: config.method,
        url: config.url,
        headers: JSON.stringify(config.headers),
        queryParams: JSON.stringify(config.queryParams),
        bodyType: config.bodyType,
        bodyContent: config.bodyType === 'json' ? config.jsonBody : config.bodyType === 'raw' ? config.rawBody : '',
        authType: config.authType,
        authConfig: JSON.stringify({
          bearerToken: config.bearerToken,
          basicUsername: config.basicUsername,
          basicPassword: config.basicPassword,
          apiKeyName: config.apiKeyName,
          apiKeyValue: config.apiKeyValue,
          apiKeyAddTo: config.apiKeyAddTo,
        }),
        preScript: config.preScript,
        postScript: config.postScript,
        createdAt: now,
        updatedAt: now,
      };
      await saveRequest(item);
      onSaved?.(item);
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[480px] bg-bg-primary border border-border-default rounded-xl shadow-2xl flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
            <Save className="w-4 h-4 text-accent" />
            保存请求
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary">请求名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field w-full text-[13px]"
              placeholder="请求名称"
              autoFocus
            />
          </div>

          {/* Collection Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-medium text-text-secondary">保存到集合</label>
              <button
                onClick={() => setShowNewCollection(!showNewCollection)}
                className="text-[11px] text-accent hover:text-accent-hover flex items-center gap-1 font-medium"
              >
                <Plus className="w-3 h-3" /> 新建
              </button>
            </div>

            {showNewCollection && (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="集合名称"
                  className="input-field flex-1 text-[12px]"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
                />
                <button onClick={handleCreateCollection} className="h-7 px-3 bg-accent text-white rounded-md text-[11px] font-medium hover:bg-accent-hover">
                  创建
                </button>
              </div>
            )}

            <div className="border border-border-default rounded-lg overflow-hidden max-h-[200px] overflow-y-auto">
              {collections.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-text-disabled">暂无集合，请先创建</div>
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
                        'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-bg-hover transition-colors',
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
                              'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-bg-hover transition-colors',
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
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default shrink-0">
          <button
            onClick={onClose}
            className="h-8 px-4 text-[12px] font-medium text-text-secondary hover:bg-bg-hover rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedCollectionId || !name.trim() || saving}
            className="h-8 px-5 bg-accent text-white rounded-md text-[12px] font-semibold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
