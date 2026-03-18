import { useState } from "react";
import { X, Plus, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ProtocolType } from "@/stores/appStore";

export interface Tab {
  id: string;
  label: string;
  protocol: ProtocolType;
  method?: string;
  modified?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: (protocol?: ProtocolType) => void;
  onProtocolChange: (id: string, protocol: ProtocolType) => void;
}

const protocolLabels: Record<ProtocolType, string> = {
  http: "HTTP", ws: "WebSocket", sse: "SSE", mqtt: "MQTT", tcp: "TCP", udp: "UDP",
};

const protocolColors: Record<ProtocolType, string> = {
  http: "bg-emerald-500/15 text-emerald-400",
  ws: "bg-amber-500/15 text-amber-400",
  sse: "bg-orange-500/15 text-orange-400",
  mqtt: "bg-purple-500/15 text-purple-400",
  tcp: "bg-blue-500/15 text-blue-400",
  udp: "bg-cyan-500/15 text-cyan-400",
};

const methodColors: Record<string, string> = {
  GET: "text-emerald-400", POST: "text-amber-400", PUT: "text-blue-400",
  DELETE: "text-red-400", PATCH: "text-violet-400", HEAD: "text-cyan-400", OPTIONS: "text-gray-400",
};

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onNewTab, onProtocolChange }: TabBarProps) {
  return (
    <div className="h-[var(--tabbar-height)] flex items-center bg-bg-secondary border-b border-border-subtle shrink-0">
      <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide px-1 gap-0.5">
        <AnimatePresence mode="popLayout">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={isActive}
                onClick={() => onTabChange(tab.id)}
                onClose={() => onTabClose(tab.id)}
                onProtocolChange={(p) => onProtocolChange(tab.id, p)}
              />
            );
          })}
        </AnimatePresence>
      </div>

      <button
        onClick={() => onNewTab("http")}
        className="w-8 h-8 flex items-center justify-center shrink-0 mx-1 text-text-disabled hover:text-text-secondary hover:bg-bg-hover rounded-[var(--radius-sm)] transition-colors"
        title="新建请求"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function TabItem({ tab, isActive, onClick, onClose, onProtocolChange }: {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onProtocolChange: (p: ProtocolType) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-1.5 px-2 h-[30px] rounded-[var(--radius-sm)]",
        "cursor-pointer transition-all duration-[var(--transition-fast)]",
        "min-w-[120px] max-w-[220px] shrink-0",
        isActive
          ? "bg-bg-surface text-text-primary shadow-sm"
          : "text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/60"
      )}
    >
      {/* Protocol badge (clickable to change) */}
      <div className="relative">
        <button
          onClick={(e) => { e.stopPropagation(); setShowPicker(!showPicker); }}
          className={cn(
            "text-[9px] font-bold px-1.5 py-0.5 rounded-[3px] leading-none shrink-0",
            protocolColors[tab.protocol]
          )}
        >
          {tab.protocol === "http" && tab.method ? tab.method : protocolLabels[tab.protocol]}
          <ChevronDown className="w-2 h-2 inline-block ml-0.5 opacity-50" />
        </button>

        {showPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowPicker(false); }} />
            <div className="absolute top-full left-0 mt-1 z-50 bg-bg-elevated border border-border-default rounded-[var(--radius-md)] shadow-md overflow-hidden min-w-[100px]">
              {(Object.keys(protocolLabels) as ProtocolType[]).map((p) => (
                <button
                  key={p}
                  onClick={(e) => { e.stopPropagation(); onProtocolChange(p); setShowPicker(false); }}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-[11px] font-medium hover:bg-bg-hover transition-colors",
                    tab.protocol === p ? "bg-bg-active text-text-primary" : "text-text-secondary"
                  )}
                >
                  {protocolLabels[p]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Label */}
      <span className="text-[12px] truncate flex-1">{tab.label}</span>

      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="w-4 h-4 flex items-center justify-center rounded-sm shrink-0 opacity-0 group-hover:opacity-100 hover:bg-bg-active transition-all"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
