import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, FolderPlus, ChevronRight, ChevronDown,
  MoreHorizontal, Upload, Play, GripVertical, Folder,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getMethodColor } from '@/types/http';
import type { CollectionItem } from '@/types/collections';
import { useCollectionStore } from '@/stores/collectionStore';

interface CollectionTreeProps {
  onSelectRequest?: (item: CollectionItem) => void;
  onRunCollection?: (collectionId: string, collectionName: string) => void;
}

// ── Drop position type ──

type DropPosition = 'before' | 'after' | 'inside';

// ── TreeItem ──

function TreeItem({
  item,
  children: childItems,
  allItems,
  depth,
  onSelect,
  dragState,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  item: CollectionItem;
  children: CollectionItem[];
  allItems: CollectionItem[];
  depth: number;
  onSelect?: (item: CollectionItem) => void;
  dragState: { dragId: string | null; dropTargetId: string | null; dropPosition: DropPosition | null };
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, id: string, isFolder: boolean) => void;
  onDragLeave: (id: string) => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = item.itemType === 'folder';
  const { dragId, dropTargetId, dropPosition } = dragState;
  const isDropTarget = dropTargetId === item.id;
  const isDragging = dragId === item.id;

  if (isFolder) {
    const folderChildren = childItems
      .filter((c) => c.parentId === item.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return (
      <div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
            onDragStart(item.id);
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOver(e, item.id, true)}
          onDragLeave={() => onDragLeave(item.id)}
          onDrop={(e) => { e.preventDefault(); onDrop(e, item.id); }}
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer pf-rounded-sm',
            'hover:bg-bg-hover transition-colors group',
            isDragging && 'opacity-40',
            isDropTarget && dropPosition === 'before' && 'border-t-2 border-t-accent',
            isDropTarget && dropPosition === 'after' && 'border-b-2 border-b-accent',
            isDropTarget && dropPosition === 'inside' && 'ring-1 ring-accent bg-accent/5',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <GripVertical className="w-3 h-3 text-text-disabled opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
          {expanded ? <ChevronDown className="w-3 h-3 text-text-disabled" /> : <ChevronRight className="w-3 h-3 text-text-disabled" />}
          <Folder className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300/50 shrink-0" fill="currentColor" />
          <span className="pf-text-xs text-text-primary truncate flex-1">{item.name}</span>
          <span className="pf-text-xxs text-text-disabled">{folderChildren.length}</span>
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              {folderChildren.map((child) => (
                <TreeItem
                  key={child.id}
                  item={child}
                  children={allItems}
                  allItems={allItems}
                  depth={depth + 1}
                  onSelect={onSelect}
                  dragState={dragState}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Request item
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
        onDragStart(item.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, item.id, false)}
      onDragLeave={() => onDragLeave(item.id)}
      onDrop={(e) => { e.preventDefault(); onDrop(e, item.id); }}
      onClick={() => onSelect?.(item)}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer pf-rounded-sm',
        'hover:bg-bg-hover transition-colors group',
        isDragging && 'opacity-40',
        isDropTarget && dropPosition === 'before' && 'border-t-2 border-t-accent',
        isDropTarget && dropPosition === 'after' && 'border-b-2 border-b-accent',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <GripVertical className="w-3 h-3 text-text-disabled opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
      <span className={cn('pf-text-xxs font-bold w-8 shrink-0', getMethodColor((item.method || 'GET') as any))}>
        {(item.method || 'GET').slice(0, 3)}
      </span>
      <span className="pf-text-xs text-text-secondary truncate flex-1">{item.name}</span>
    </div>
  );
}

// ── Main tree ──

export function CollectionTree({ onSelectRequest, onRunCollection }: CollectionTreeProps) {
  const { t } = useTranslation();

  // Store bindings
  const collections = useCollectionStore((s) => s.collections);
  const items = useCollectionStore((s) => s.items);
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);
  const fetchItems = useCollectionStore((s) => s.fetchItems);
  const reorderItems = useCollectionStore((s) => s.reorderItems);
  const moveItem = useCollectionStore((s) => s.moveItem);

  // Drag state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragCollectionId, setDragCollectionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());

  // Fetch collections on mount
  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // Fetch items when collection is expanded
  const toggleExpand = useCallback((colId: string) => {
    setExpandedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
        // Fetch items if not yet loaded
        if (!items[colId]) fetchItems(colId);
      }
      return next;
    });
  }, [items, fetchItems]);

  const handleDragStart = useCallback((id: string) => {
    setDragItemId(id);
    // Find collection id for this item
    for (const [colId, colItems] of Object.entries(items)) {
      if (colItems.some((i) => i.id === id)) {
        setDragCollectionId(colId);
        break;
      }
    }
  }, [items]);

  const handleDragEnd = useCallback(() => {
    setDragItemId(null);
    setDragCollectionId(null);
    setDropTargetId(null);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string, isFolder: boolean) => {
    if (!dragItemId || dragItemId === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const height = rect.height;

    if (isFolder) {
      // Folder has 3 zones: top 25% = before, middle 50% = inside, bottom 25% = after
      if (relY < height * 0.25) {
        setDropPosition('before');
      } else if (relY > height * 0.75) {
        setDropPosition('after');
      } else {
        setDropPosition('inside');
      }
    } else {
      // Request has 2 zones: top 50% = before, bottom 50% = after
      setDropPosition(relY < height / 2 ? 'before' : 'after');
    }

    setDropTargetId(targetId);
  }, [dragItemId]);

  const handleDragLeave = useCallback((targetId: string) => {
    if (dropTargetId === targetId) {
      setDropTargetId(null);
      setDropPosition(null);
    }
  }, [dropTargetId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();

    if (!dragItemId || !dragCollectionId || dragItemId === targetId || !dropPosition) {
      handleDragEnd();
      return;
    }

    // Find the target item to verify same collection
    const colItems = items[dragCollectionId];
    if (!colItems) {
      handleDragEnd();
      return;
    }

    const targetItem = colItems.find((i) => i.id === targetId);
    if (!targetItem) {
      handleDragEnd();
      return;
    }

    if (dropPosition === 'inside' && targetItem.itemType === 'folder') {
      // Move into folder
      moveItem(dragItemId, dragCollectionId, targetId);
    } else {
      // Reorder: before or after the target
      const pos = dropPosition === 'inside' ? 'after' : dropPosition;
      reorderItems(dragItemId, targetId, dragCollectionId, pos);
    }

    handleDragEnd();
  }, [dragItemId, dragCollectionId, dropPosition, items, moveItem, reorderItems, handleDragEnd]);

  const dragState = { dragId: dragItemId, dropTargetId, dropPosition };

  if (collections.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-disabled px-4">
        <FolderOpen className="w-10 h-10 mb-3 opacity-30" />
        <p className="pf-text-sm">{t('sidebar.noCollections')}</p>
        <p className="pf-text-xs mt-1 text-center">{t('sidebar.noCollectionsHint')}</p>
        <button className="mt-4 flex items-center gap-1.5 px-3 py-1.5 pf-rounded-sm bg-accent hover:bg-accent-hover text-white pf-text-xs font-medium">
          <FolderPlus className="w-3.5 h-3.5" />
          {t('contextMenu.newFolder')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="pf-text-xs font-medium text-text-secondary">{t('sidebar.collections')}</span>
        <div className="flex items-center gap-1">
          <button className="p-1 text-text-tertiary hover:text-text-secondary transition-colors" title={t('contextMenu.newFolder')}>
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 text-text-tertiary hover:text-text-secondary transition-colors" title={t('sidebar.import')}>
            <Upload className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto py-1">
        {collections.map((col) => {
          const colItems = items[col.id] || [];
          const rootItems = colItems
            .filter((i) => !i.parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder);

          return (
            <div key={col.id}>
              <div
                onClick={() => toggleExpand(col.id)}
                onDragOver={(e) => {
                  // Allow drop on collection root to move to top level
                  if (dragItemId && dragCollectionId === col.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTargetId(`col:${col.id}`);
                  }
                }}
                onDragLeave={() => { if (dropTargetId === `col:${col.id}`) setDropTargetId(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragItemId && dragCollectionId === col.id) {
                    moveItem(dragItemId, col.id, null);
                  }
                  handleDragEnd();
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-hover transition-colors group',
                  dropTargetId === `col:${col.id}` && 'ring-1 ring-accent bg-accent/5',
                )}
              >
                {expandedCols.has(col.id)
                  ? <ChevronDown className="w-3 h-3 text-text-disabled" />
                  : <ChevronRight className="w-3 h-3 text-text-disabled" />
                }
                <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="pf-text-xs font-medium text-text-primary truncate flex-1">{col.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRunCollection?.(col.id, col.name); }}
                  className="p-0.5 opacity-0 group-hover:opacity-100 text-emerald-500 hover:text-emerald-600 dark:text-emerald-300 transition-all"
                  title={t('runner.run')}
                >
                  <Play className="w-3 h-3" />
                </button>
                <button className="p-0.5 opacity-0 group-hover:opacity-100 text-text-disabled hover:text-text-secondary transition-all">
                  <MoreHorizontal className="w-3 h-3" />
                </button>
              </div>
              <AnimatePresence>
                {expandedCols.has(col.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                  >
                    {rootItems.map((item) => (
                      <TreeItem
                        key={item.id}
                        item={item}
                        children={colItems}
                        allItems={colItems}
                        depth={1}
                        onSelect={onSelectRequest}
                        dragState={dragState}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
