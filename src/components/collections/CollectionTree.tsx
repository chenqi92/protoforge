import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, FolderPlus, ChevronRight, ChevronDown,
  MoreHorizontal, Upload, Play, GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getMethodColor } from '@/types/http';
import type { HttpMethod } from '@/types/http';

interface CollectionRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
}

interface CollectionFolder {
  id: string;
  name: string;
  items: (CollectionRequest | CollectionFolder)[];
  isFolder: true;
}

interface Collection {
  id: string;
  name: string;
  description: string;
  items: (CollectionRequest | CollectionFolder)[];
}

interface CollectionTreeProps {
  onSelectRequest?: (request: CollectionRequest) => void;
  onRunCollection?: (collectionId: string, collectionName: string) => void;
}

function TreeItem({ item, depth, onSelect, onDragStart, onDragOver, onDrop, dragOverId }: {
  item: CollectionRequest | CollectionFolder;
  depth: number;
  onSelect?: (r: CollectionRequest) => void;
  onDragStart?: (id: string) => void;
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDrop?: (e: React.DragEvent, id: string) => void;
  dragOverId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = 'isFolder' in item && item.isFolder;
  const isDragOver = dragOverId === item.id;

  if (isFolder) {
    const folder = item as CollectionFolder;
    return (
      <div>
      <div
          onClick={() => setExpanded(!expanded)}
          draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(folder.id); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(e, folder.id); }}
          onDrop={(e) => { e.preventDefault(); onDrop?.(e, folder.id); }}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-[var(--radius-sm)]',
            'hover:bg-bg-hover transition-colors group',
            isDragOver && 'border-t-2 border-accent',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <GripVertical className="w-3 h-3 text-text-disabled opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
          {expanded ? <ChevronDown className="w-3 h-3 text-text-disabled" /> : <ChevronRight className="w-3 h-3 text-text-disabled" />}
          <FolderOpen className="w-3.5 h-3.5 text-method-post shrink-0" />
          <span className="text-xs text-text-primary truncate flex-1">{folder.name}</span>
          <span className="text-[var(--fs-xxs)] text-text-disabled">{folder.items.length}</span>
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {folder.items.map((child) => (
                <TreeItem key={child.id} item={child} depth={depth + 1} onSelect={onSelect}
                  onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} dragOverId={dragOverId} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const req = item as CollectionRequest;
  return (
    <div
      onClick={() => onSelect?.(req)}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(req.id); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(e, req.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(e, req.id); }}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-[var(--radius-sm)]',
        'hover:bg-bg-hover transition-colors group',
        isDragOver && 'border-t-2 border-accent',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <GripVertical className="w-3 h-3 text-text-disabled opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
      <span className={cn('text-[var(--fs-xxs)] font-bold w-8 shrink-0', getMethodColor(req.method))}>
        {req.method.slice(0, 3)}
      </span>
      <span className="text-xs text-text-secondary truncate flex-1">{req.name}</span>
    </div>
  );
}

export function CollectionTree({ onSelectRequest, onRunCollection }: CollectionTreeProps) {
  const { t } = useTranslation();
  const [collections] = useState<Collection[]>([]);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const dragItemRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => { dragItemRef.current = id; };
  const handleDragOver = (_e: React.DragEvent, id: string) => { setDragOverId(id); };
  const handleDrop = (_e: React.DragEvent, _targetId: string) => {
    // TODO: reorder items in store when collection store has reorder support
    dragItemRef.current = null;
    setDragOverId(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (collections.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-text-disabled px-4">
        <FolderOpen className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">{t('sidebar.noCollections')}</p>
        <p className="text-xs mt-1 text-center">{t('sidebar.noCollectionsHint')}</p>
        <button className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] gradient-accent text-white text-xs font-medium">
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
        <span className="text-xs font-medium text-text-secondary">{t('sidebar.collections')}</span>
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
        {collections.map((col) => (
          <div key={col.id}>
            <div
              onClick={() => toggleExpand(col.id)}
              className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-hover transition-colors group"
            >
              {expandedCols.has(col.id)
                ? <ChevronDown className="w-3 h-3 text-text-disabled" />
                : <ChevronRight className="w-3 h-3 text-text-disabled" />
              }
              <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-medium text-text-primary truncate flex-1">{col.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRunCollection?.(col.id, col.name); }}
                className="p-0.5 opacity-0 group-hover:opacity-100 text-emerald-500 hover:text-emerald-600 transition-all"
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
                  {col.items.map((item) => (
                    <TreeItem key={item.id} item={item as any} depth={1} onSelect={onSelectRequest}
                      onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} dragOverId={dragOverId} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
