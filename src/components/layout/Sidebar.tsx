import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Clock, Search, Plus,
  ChevronRight, Download, Settings, Globe,
  MoreHorizontal, Folder, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarView = "collections" | "history" | "environments";

interface SidebarProps {
  panelCollapsed: boolean;
  onTogglePanel: () => void;
}

const navItems: { id: SidebarView; icon: typeof FolderOpen; label: string }[] = [
  { id: "collections", icon: FolderOpen, label: "集合" },
  { id: "environments", icon: Globe, label: "环境" },
  { id: "history", icon: Clock, label: "历史" },
];

export function Sidebar({ panelCollapsed, onTogglePanel }: SidebarProps) {
  const [activeView, setActiveView] = useState<SidebarView>("collections");
  const [search, setSearch] = useState("");

  const handleNavClick = (view: SidebarView) => {
    if (panelCollapsed) {
      setActiveView(view);
      onTogglePanel();
    } else if (activeView === view) {
      onTogglePanel();
    } else {
      setActiveView(view);
    }
  };

  return (
    <div className="h-full flex">
      {/* ── Icon Rail ── */}
      <div className="w-12 h-full flex flex-col items-center pt-2 pb-3 bg-bg-tertiary/50 border-r border-border-default shrink-0">
        {navItems.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                "w-10 h-10 flex flex-col items-center justify-center rounded-lg transition-all duration-150 relative mb-0.5",
                isActive
                  ? "text-accent"
                  : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
              )}
              title={label}
            >
              {/* Active indicator bar */}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-accent rounded-r-full"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={cn("w-[18px] h-[18px]", isActive && "drop-shadow-sm")} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className={cn(
                "text-[9px] leading-tight mt-0.5",
                isActive ? "font-semibold" : "font-medium"
              )}>{label}</span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-0.5">
          <button
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
            title="设置"
          >
            <Settings className="w-[17px] h-[17px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* ── Detail Panel ── */}
      {!panelCollapsed && (
        <div className="flex-1 h-full flex flex-col bg-bg-secondary overflow-hidden min-w-0">
          {/* Panel Header */}
          <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-border-subtle">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold text-text-primary truncate">
                  {navItems.find(n => n.id === activeView)?.label}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeView === "collections" && (
                  <>
                    <button
                      className="h-[26px] px-2.5 flex items-center gap-1 text-[11px] font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-all active:scale-[0.96] shadow-sm"
                      title="新建请求"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      新建
                    </button>
                    <button
                      className="h-[26px] px-2 flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded-md border border-border-default transition-colors"
                      title="导入"
                    >
                      <Download className="w-3 h-3" />
                      导入
                    </button>
                  </>
                )}
                {activeView === "environments" && (
                  <button
                    className="h-[26px] px-2.5 flex items-center gap-1 text-[11px] font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-all active:scale-[0.96] shadow-sm"
                    title="新增环境"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新增
                  </button>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled group-focus-within:text-accent transition-colors" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`搜索${navItems.find(n => n.id === activeView)?.label}...`}
                className="w-full h-[30px] pl-8 pr-3 text-[12px] bg-bg-primary border border-border-default rounded-md outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary placeholder:text-text-tertiary transition-all"
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto px-1.5 py-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                {activeView === "collections" && <CollectionsView search={search} />}
                {activeView === "history" && <HistoryView search={search} />}
                {activeView === "environments" && <EnvironmentsView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Collections View ── */
function CollectionsView({ search }: { search: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ default: true, users: true });

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
    {
      id: "users",
      name: "用户管理",
      items: [
        { id: "4", method: "GET", name: "/api/profile", url: "https://api.example.com/profile" },
        { id: "5", method: "PUT", name: "/api/settings", url: "https://api.example.com/settings" },
      ],
    },
  ];

  const methodColors: Record<string, { text: string; bg: string }> = {
    GET: { text: "text-emerald-600", bg: "bg-emerald-500/8" },
    POST: { text: "text-amber-600", bg: "bg-amber-500/8" },
    PUT: { text: "text-blue-600", bg: "bg-blue-500/8" },
    DELETE: { text: "text-red-600", bg: "bg-red-500/8" },
    PATCH: { text: "text-violet-600", bg: "bg-violet-500/8" },
  };

  return (
    <div className="py-0.5">
      {collections.map((col) => (
        <div key={col.id} className="mb-0.5">
          <button
            onClick={() => setExpanded((e) => ({ ...e, [col.id]: !e[col.id] }))}
            className="w-full flex items-center gap-1.5 px-2 py-[6px] rounded-md text-[12px] font-medium text-text-secondary hover:bg-bg-hover transition-colors group"
          >
            <motion.div
              animate={{ rotate: expanded[col.id] ? 90 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight className="w-3 h-3 shrink-0 text-text-disabled" />
            </motion.div>
            <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500/70" fill="currentColor" strokeWidth={1.5} />
            <span className="truncate">{col.name}</span>
            <span className="text-[10px] text-text-disabled ml-auto tabular-nums">{col.items.length}</span>
            <MoreHorizontal className="w-3.5 h-3.5 text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
                  .map((item) => {
                    const color = methodColors[item.method] || { text: "text-text-tertiary", bg: "" };
                    return (
                      <button
                        key={item.id}
                        className="w-full flex items-center gap-2 pl-[30px] pr-2 py-[5px] rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors group/item"
                      >
                        <span className={cn(
                          "text-[10px] font-bold px-1 py-[1px] rounded shrink-0 min-w-[32px] text-center",
                          color.text, color.bg
                        )}>
                          {item.method}
                        </span>
                        <span className="truncate font-mono text-[11px]">{item.name}</span>
                      </button>
                    );
                  })}
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
  const methodColors: Record<string, { text: string; bg: string }> = {
    GET: { text: "text-emerald-600", bg: "bg-emerald-500/8" },
    POST: { text: "text-amber-600", bg: "bg-amber-500/8" },
    PUT: { text: "text-blue-600", bg: "bg-blue-500/8" },
    DELETE: { text: "text-red-600", bg: "bg-red-500/8" },
    PATCH: { text: "text-violet-600", bg: "bg-violet-500/8" },
  };

  const historyGroups = [
    {
      label: "今天",
      items: [
        { id: "h1", method: "GET", url: "/api/users", status: 200, time: "2 分钟前" },
        { id: "h2", method: "POST", url: "/api/login", status: 401, time: "5 分钟前" },
      ],
    },
    {
      label: "昨天",
      items: [
        { id: "h3", method: "GET", url: "/api/products", status: 200, time: "昨天 15:30" },
        { id: "h4", method: "DELETE", url: "/api/users/3", status: 204, time: "昨天 14:10" },
      ],
    },
  ];

  return (
    <div className="py-0.5">
      {historyGroups.map((group) => {
        const filtered = group.items.filter((h) => !search || h.url.includes(search));
        if (filtered.length === 0) return null;
        return (
          <div key={group.label} className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold text-text-disabled uppercase tracking-wider">
              {group.label}
            </div>
            {filtered.map((h) => {
              const color = methodColors[h.method] || { text: "text-text-tertiary", bg: "" };
              return (
                <button
                  key={h.id}
                  className="w-full flex items-center gap-2 px-2 py-[5px] rounded-md text-[12px] hover:bg-bg-hover transition-colors group"
                >
                  <span className={cn(
                    "text-[10px] font-bold px-1 py-[1px] rounded shrink-0 min-w-[32px] text-center",
                    color.text, color.bg
                  )}>
                    {h.method}
                  </span>
                  <span className="truncate font-mono text-[11px] text-text-tertiary flex-1">{h.url}</span>
                  <span className={cn(
                    "text-[10px] shrink-0 tabular-nums font-medium",
                    h.status < 400 ? "text-emerald-600" : "text-red-500"
                  )}>
                    {h.status}
                  </span>
                  <span className="text-[10px] text-text-disabled shrink-0 hidden group-hover:inline">{h.time}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      {historyGroups.every(g => g.items.filter(h => !search || h.url.includes(search)).length === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-text-disabled">
          <Clock className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-[12px]">{search ? "无匹配记录" : "暂无历史记录"}</p>
          <p className="text-[11px] mt-0.5 opacity-60">发送请求后将自动记录</p>
        </div>
      )}
    </div>
  );
}

/* ── Environments View ── */
function EnvironmentsView() {
  return (
    <div className="py-0.5">
      {/* Active env */}
      <div className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[12px] text-text-secondary bg-emerald-500/5 border border-emerald-500/10 cursor-pointer hover:bg-emerald-500/8 transition-colors mb-1">
        <div className="w-[6px] h-[6px] rounded-full bg-emerald-500 shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
        <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="truncate font-medium">默认环境</span>
        <span className="text-[10px] text-emerald-600 ml-auto font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">活跃</span>
      </div>

      {/* Other envs */}
      <div className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover transition-colors cursor-pointer">
        <div className="w-[6px] h-[6px] rounded-full bg-border-strong shrink-0" />
        <Globe className="w-3.5 h-3.5 text-text-disabled shrink-0" />
        <span className="truncate">生产环境</span>
      </div>
      <div className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[12px] text-text-tertiary hover:bg-bg-hover transition-colors cursor-pointer">
        <div className="w-[6px] h-[6px] rounded-full bg-border-strong shrink-0" />
        <Globe className="w-3.5 h-3.5 text-text-disabled shrink-0" />
        <span className="truncate">测试环境</span>
      </div>

      {/* Empty state action */}
      <div className="mt-4 px-2">
        <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-border-default text-text-tertiary hover:border-accent hover:text-accent transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded-md bg-bg-hover flex items-center justify-center group-hover:bg-accent-soft transition-colors">
            <Zap className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium">环境变量</p>
            <p className="text-[10px] text-text-disabled">管理不同环境的配置</p>
          </div>
        </div>
      </div>
    </div>
  );
}
