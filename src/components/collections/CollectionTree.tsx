import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, FolderPlus, Plus, ChevronRight, ChevronDown,
  MoreHorizontal, Trash2, Edit2, Copy, Download, Upload,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
}

function TreeItem({ item, depth, onSelect }: {
  item: CollectionRequest | CollectionFolder;
  depth: number;
  onSelect?: (r: CollectionRequest) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = 'isFolder' in item && item.isFolder;

  if (isFolder) {
    const folder = item as CollectionFolder;
    return (
      <div>
        <div
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-[var(--radius-sm)]',
            'hover:bg-bg-hover transition-colors group',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-text-disabled" /> : <ChevronRight className="w-3 h-3 text-text-disabled" />}
          <FolderOpen className="w-3.5 h-3.5 text-method-post shrink-0" />
          <span className="text-xs text-text-primary truncate flex-1">{folder.name}</span>
          <span className="text-[10px] text-text-disabled">{folder.items.length}</span>
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
                <TreeItem key={child.id} item={child} depth={depth + 1} onSelect={onSelect} />
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
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-[var(--radius-sm)]',
        'hover:bg-bg-hover transition-colors group',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className={cn('text-[10px] font-bold w-8 shrink-0', getMethodColor(req.method))}>
        {req.method.slice(0, 3)}
      </span>
      <span className="text-xs text-text-secondary truncate flex-1">{req.name}</span>
    </div>
  );
}

export function CollectionTree({ onSelectRequest }: CollectionTreeProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());

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
        <p className="text-sm">暂无集合</p>
        <p className="text-xs mt-1 text-center">创建集合来组织你的 API 请求</p>
        <button className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] gradient-accent text-white text-xs font-medium">
          <FolderPlus className="w-3.5 h-3.5" />
          新建集合
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-medium text-text-secondary">集合</span>
        <div className="flex items-center gap-1">
          <button className="p-1 text-text-tertiary hover:text-text-secondary transition-colors" title="新建集合">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 text-text-tertiary hover:text-text-secondary transition-colors" title="导入集合">
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
                    <TreeItem key={item.id} item={item as any} depth={1} onSelect={onSelectRequest} />
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
