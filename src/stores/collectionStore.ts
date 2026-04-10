// ProtoForge Collection Store — Zustand

import { create } from 'zustand';
import type { Collection, CollectionItem } from '@/types/collections';
import { nowISO } from '@/types/collections';
import * as svc from '@/services/collectionService';
import { extractVariableKeys, parseCollectionVariableEntries, type CollectionVariableEntry } from '@/lib/requestVariables';

interface CollectionStore {
  collections: Collection[];
  items: Record<string, CollectionItem[]>;  // collectionId → items
  loading: boolean;
  error: string | null;

  // Actions
  fetchCollections: () => Promise<void>;
  fetchItems: (collectionId: string) => Promise<void>;
  createCollection: (name: string) => Promise<Collection>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  createItem: (collectionId: string, parentId: string | null, itemType: 'request' | 'folder', name: string, method?: string) => Promise<CollectionItem>;
  updateItem: (item: CollectionItem) => Promise<void>;
  deleteItem: (id: string, collectionId: string) => Promise<void>;
  exportCollection: (id: string) => Promise<string>;
  importCollection: (json: string) => Promise<void>;
  importPostman: (json: string) => Promise<void>;
  exportPostman: (id: string) => Promise<string>;
  renameItem: (id: string, collectionId: string, name: string) => Promise<void>;
  moveItem: (id: string, collectionId: string, newParentId: string | null) => Promise<void>;
  reorderItems: (dragId: string, targetId: string, collectionId: string, position: 'before' | 'after') => Promise<void>;
  saveRequest: (item: CollectionItem) => Promise<CollectionItem>;
  loadItems: (collectionId: string) => Promise<void>;
  deduplicateItems: (collectionId: string) => Promise<number>;
  duplicateItem: (id: string, collectionId: string) => Promise<CollectionItem | null>;
  copyItemToCollection: (id: string, sourceCollectionId: string, targetCollectionId: string, targetParentId: string | null, migrateVariables?: boolean) => Promise<CollectionItem | null>;
}

export const useCollectionStore = create<CollectionStore>((set, get) => ({
  collections: [],
  items: {},
  loading: false,
  error: null,

  fetchCollections: async () => {
    set({ loading: true, error: null });
    try {
      const collections = await svc.listCollections();
      set({ collections, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchItems: async (collectionId: string) => {
    try {
      const items = await svc.listCollectionItems(collectionId);
      set((s) => ({ items: { ...s.items, [collectionId]: items } }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createCollection: async (name: string) => {
    const now = nowISO();
    const col: Collection = {
      id: crypto.randomUUID(),
      name,
      description: '',
      auth: null,
      preScript: '',
      postScript: '',
      variables: '{}',
      sortOrder: get().collections.length,
      createdAt: now,
      updatedAt: now,
    };
    const created = await svc.createCollection(col);
    set((s) => ({ collections: [...s.collections, created] }));
    return created;
  },

  renameCollection: async (id: string, name: string) => {
    const col = get().collections.find((c) => c.id === id);
    if (!col) return;
    const updated = { ...col, name, updatedAt: nowISO() };
    await svc.updateCollection(updated);
    set((s) => ({
      collections: s.collections.map((c) => (c.id === id ? updated : c)),
    }));
  },

  deleteCollection: async (id: string) => {
    await svc.deleteCollection(id);
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      items: Object.fromEntries(Object.entries(s.items).filter(([k]) => k !== id)),
    }));
  },

  createItem: async (collectionId, parentId, itemType, name, method) => {
    const now = nowISO();
    const item: CollectionItem = {
      id: crypto.randomUUID(),
      collectionId,
      parentId,
      itemType,
      variables: '[]',
      name,
      sortOrder: 0,
      method: method || (itemType === 'request' ? 'GET' : null),
      url: itemType === 'request' ? '' : null,
      headers: '{}',
      queryParams: '{}',
      bodyType: 'none',
      bodyContent: '',
      authType: 'none',
      authConfig: '{}',
      preScript: '',
      postScript: '',
      responseExample: '',
      createdAt: now,
      updatedAt: now,
    };
    const created = await svc.createCollectionItem(item);
    set((s) => ({
      items: {
        ...s.items,
        [collectionId]: [...(s.items[collectionId] || []), created],
      },
    }));
    return created;
  },

  updateItem: async (item: CollectionItem) => {
    await svc.updateCollectionItem(item);
    set((s) => ({
      items: {
        ...s.items,
        [item.collectionId]: (s.items[item.collectionId] || []).map((i) =>
          i.id === item.id ? item : i
        ),
      },
    }));
  },

  deleteItem: async (id: string, collectionId: string) => {
    await svc.deleteCollectionItem(id);
    set((s) => ({
      items: {
        ...s.items,
        [collectionId]: (s.items[collectionId] || []).filter((i) => i.id !== id),
      },
    }));
  },

  exportCollection: async (id: string) => {
    return svc.exportCollection(id);
  },

  importCollection: async (json: string) => {
    await svc.importCollection(json);
    await get().fetchCollections();
  },

  importPostman: async (json: string) => {
    await svc.importPostmanCollection(json);
    await get().fetchCollections();
  },

  exportPostman: async (id: string) => {
    return svc.exportPostmanCollection(id);
  },

  renameItem: async (id: string, collectionId: string, name: string) => {
    const items = get().items[collectionId] || [];
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const updated = { ...item, name, updatedAt: nowISO() };
    await svc.updateCollectionItem(updated);
    set((s) => ({
      items: {
        ...s.items,
        [collectionId]: (s.items[collectionId] || []).map((i) =>
          i.id === id ? updated : i
        ),
      },
    }));
  },

  moveItem: async (id: string, collectionId: string, newParentId: string | null) => {
    const items = get().items[collectionId] || [];
    const item = items.find((i) => i.id === id);
    if (!item) return;
    // Prevent moving a folder into itself or its own descendants
    if (newParentId === id) return;
    if (item.itemType === 'folder') {
      let checkId: string | null = newParentId;
      while (checkId) {
        if (checkId === id) return; // circular
        const parent = items.find((i) => i.id === checkId);
        checkId = parent?.parentId ?? null;
      }
    }
    const updated = { ...item, parentId: newParentId, updatedAt: nowISO() };
    await svc.updateCollectionItem(updated);
    set((s) => ({
      items: {
        ...s.items,
        [collectionId]: (s.items[collectionId] || []).map((i) =>
          i.id === id ? updated : i
        ),
      },
    }));
  },

  reorderItems: async (dragId: string, targetId: string, collectionId: string, position: 'before' | 'after') => {
    const allItems = get().items[collectionId] || [];
    const dragItem = allItems.find((i) => i.id === dragId);
    const targetItem = allItems.find((i) => i.id === targetId);
    if (!dragItem || !targetItem) return;

    // Only reorder within the same parent
    const parentId = targetItem.parentId;
    const siblings = allItems
      .filter((i) => i.parentId === parentId && i.id !== dragId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Insert dragItem at the target position
    const targetIndex = siblings.findIndex((i) => i.id === targetId);
    const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
    siblings.splice(insertAt, 0, dragItem);

    // Build ordered ID list and update local sort_order
    const orderedIds = siblings.map((i) => i.id);
    const updatedItems = allItems.map((item) => {
      const newIndex = orderedIds.indexOf(item.id);
      if (newIndex !== -1) {
        return { ...item, parentId: item.id === dragId ? parentId : item.parentId, sortOrder: newIndex };
      }
      return item;
    });

    // Optimistic update
    set((s) => ({
      items: { ...s.items, [collectionId]: updatedItems },
    }));

    // Persist to backend
    try {
      await svc.reorderCollectionItems(orderedIds);
      // Also update parentId if it changed
      if (dragItem.parentId !== parentId) {
        const movedItem = updatedItems.find((i) => i.id === dragId)!;
        await svc.updateCollectionItem(movedItem);
      }
    } catch (e) {
      // Rollback on failure
      set((s) => ({
        items: { ...s.items, [collectionId]: allItems },
        error: String(e),
      }));
    }
  },

  saveRequest: async (item: CollectionItem) => {
    const saved = await svc.saveRequestToCollection(item);
    // Refresh items for the collection
    await get().fetchItems(item.collectionId);
    return saved;
  },

  loadItems: async (collectionId: string) => {
    await get().fetchItems(collectionId);
  },

  deduplicateItems: async (collectionId: string) => {
    const removed = await svc.deduplicateCollectionItems(collectionId);
    await get().fetchItems(collectionId);
    return removed;
  },

  duplicateItem: async (id: string, collectionId: string) => {
    const items = get().items[collectionId] || [];
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    const now = nowISO();
    const newItem: CollectionItem = {
      ...item,
      id: crypto.randomUUID(),
      name: `${item.name} (copy)`,
      sortOrder: item.sortOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    const created = await svc.createCollectionItem(newItem);
    set((s) => ({
      items: {
        ...s.items,
        [collectionId]: [...(s.items[collectionId] || []), created],
      },
    }));
    return created;
  },

  copyItemToCollection: async (id: string, sourceCollectionId: string, targetCollectionId: string, targetParentId: string | null, migrateVariables = true) => {
    const sourceItems = get().items[sourceCollectionId] || [];
    const item = sourceItems.find((i) => i.id === id);
    if (!item) return null;

    // Migrate collection-level variables referenced by the request
    if (migrateVariables) {
      const allText = [item.url, item.headers, item.queryParams, item.bodyContent, item.authConfig].join(' ');
      const referencedKeys = extractVariableKeys(allText);

      if (referencedKeys.length > 0) {
        const sourceCollection = get().collections.find((c) => c.id === sourceCollectionId);
        const targetCollection = get().collections.find((c) => c.id === targetCollectionId);
        if (sourceCollection && targetCollection) {
          const sourceVars = parseCollectionVariableEntries(sourceCollection.variables);
          const targetVars = parseCollectionVariableEntries(targetCollection.variables);
          const targetKeySet = new Set(targetVars.map((v) => v.key));

          const missingVars: CollectionVariableEntry[] = [];
          for (const key of referencedKeys) {
            if (targetKeySet.has(key)) continue;
            const sourceVar = sourceVars.find((v) => v.key === key);
            if (sourceVar) missingVars.push(sourceVar);
          }

          if (missingVars.length > 0) {
            const mergedVars = [...targetVars, ...missingVars];
            const updated = { ...targetCollection, variables: JSON.stringify(mergedVars), updatedAt: nowISO() };
            await svc.updateCollection(updated);
            set((s) => ({
              collections: s.collections.map((c) => (c.id === targetCollectionId ? updated : c)),
            }));
          }
        }
      }
    }

    const now = nowISO();
    const newItem: CollectionItem = {
      ...item,
      id: crypto.randomUUID(),
      collectionId: targetCollectionId,
      parentId: targetParentId,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };
    const created = await svc.createCollectionItem(newItem);
    set((s) => ({
      items: {
        ...s.items,
        [targetCollectionId]: [...(s.items[targetCollectionId] || []), created],
      },
    }));
    return created;
  },
}));
