import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Clock, Search, ChevronLeft, ChevronRight,
  Plus, ChevronDown, ChevronRight as ChevronR, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

type SidebarView = "collections" | "history";

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [view, setView] = useState<SidebarView>("collections");
  const [search, setSearch] = useState("");

  if (collapsed) {
    return (
      <div className="w-[46px] h-full flex flex-col items-center py-2 gap-1 bg-bg-secondary border-r border-border-subtle shrink-0">
        <button
          onClick={() => { setView("collections"); onToggle(); }}
          className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="集合"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setView("history"); onToggle(); }}
          className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="历史"
        >
          <Clock className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={onToggle}
          className="w-9 h-9 flex items-center justify-center text-text-disabled hover:text-text-tertiary transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <motion.aside
      initial={{ width: 46 }}
      animate={{ width: 260 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="h-full flex flex-col bg-bg-secondary border-r border-border-subtle shrink-0 select-none overflow-hidden"
    >
      {/* View switcher */}
      <div className="flex items-center border-b border-border-subtle shrink-0">
        <button
          onClick={() => setView("collections")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium transition-colors border-b-2",
            view === "collections" ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary"
          )}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          集合
        </button>
        <button
          onClick={() => setView("history")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium transition-colors border-b-2",
            view === "history" ? "text-accent border-accent" : "text-text-tertiary border-transparent hover:text-text-secondary"
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          历史
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="input-field w-full pl-7 py-1.5 text-[12px]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-2">
        {view === "collections" ? (
          <CollectionsView search={search} />
        ) : (
          <HistoryView search={search} />
        )}
      </div>

      {/* Bottom */}
      <div className="py-1.5 px-2 border-t border-border-subtle flex items-center justify-between shrink-0">
        {view === "collections" && (
          <button className="flex items-center gap-1 px-2 py-1 text-[11px] text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3 h-3" />
            新建集合
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center text-text-disabled hover:text-text-tertiary rounded transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.aside>
  );
}

/* ── Collections View ── */
function CollectionsView({ search }: { search: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ default: true });

  // Demo data
  const collections = [
    {
      id: "default",
      name: "示例集合",
      items: [
        { id: "1", method: "GET", name: "/api/users", url: "https://api.example.com/users" },
        { id: "2", method: "POST", name: "/api/users", url: "https://api.example.com/users" },
        { id: "3", method: "DELETE", name: "/api/users/:id", url: "https://api.example.com/users/1" },
      ],
    },
  ];

  const methodColor: Record<string, string> = {
    GET: "text-emerald-400", POST: "text-amber-400", PUT: "text-blue-400",
    DELETE: "text-red-400", PATCH: "text-violet-400",
  };

  return (
    <div className="space-y-0.5 py-1">
      {collections.map((col) => (
        <div key={col.id}>
          <button
            onClick={() => setExpanded((e) => ({ ...e, [col.id]: !e[col.id] }))}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {expanded[col.id] ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronR className="w-3 h-3 shrink-0" />}
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-text-disabled" />
            <span className="truncate">{col.name}</span>
            <span className="text-[10px] text-text-disabled ml-auto">{col.items.length}</span>
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
                {col.items
                  .filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()))
                  .map((item) => (
                    <button
                      key={item.id}
                      className="w-full flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-[var(--radius-sm)] text-[12px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
                    >
                      <span className={cn("text-[10px] font-bold w-8 text-left shrink-0", methodColor[item.method])}>
                        {item.method}
                      </span>
                      <span className="truncate font-mono text-[11px]">{item.name}</span>
                    </button>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/* ── History View ── */
function HistoryView({ search }: { search: string }) {
  const methodColor: Record<string, string> = {
    GET: "text-emerald-400", POST: "text-amber-400", PUT: "text-blue-400",
    DELETE: "text-red-400", PATCH: "text-violet-400",
  };

  // Demo data
  const history = [
    { id: "h1", method: "GET", url: "/api/users", status: 200, time: "2 分钟前" },
    { id: "h2", method: "POST", url: "/api/login", status: 401, time: "5 分钟前" },
    { id: "h3", method: "GET", url: "/api/products", status: 200, time: "10 分钟前" },
  ];

  const filtered = history.filter((h) => !search || h.url.includes(search));

  return (
    <div className="space-y-0.5 py-1">
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-text-disabled text-[12px]">
          {search ? "无匹配记录" : "暂无历史记录"}
        </div>
      ) : (
        filtered.map((h) => (
          <button
            key={h.id}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-[12px] hover:bg-bg-hover transition-colors group"
          >
            <span className={cn("text-[10px] font-bold w-8 text-left shrink-0", methodColor[h.method])}>
              {h.method}
            </span>
            <span className="truncate font-mono text-[11px] text-text-tertiary flex-1">{h.url}</span>
            <span className={cn("text-[10px] shrink-0", h.status < 400 ? "text-emerald-400" : "text-red-400")}>
              {h.status}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
