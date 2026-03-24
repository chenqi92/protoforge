/**
 * Environment Variables Modal
 * 环境变量管理弹框 — 全局变量 + 各环境变量的完整编辑界面
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Globe, Zap, Eye, EyeOff, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvStore } from "@/stores/envStore";
import type { EnvVariable, GlobalVariable } from "@/types/collections";



interface Props {
  open: boolean;
  onClose: () => void;
}

export default function EnvironmentVariablesModal({ open, onClose }: Props) {
  const environments = useEnvStore((s) => s.environments);
  const activeEnvId = useEnvStore((s) => s.activeEnvId);
  const variables = useEnvStore((s) => s.variables);
  const globalVariables = useEnvStore((s) => s.globalVariables);
  const setActive = useEnvStore((s) => s.setActive);
  const deleteEnvironment = useEnvStore((s) => s.deleteEnvironment);
  const createEnvironment = useEnvStore((s) => s.createEnvironment);
  const fetchVariables = useEnvStore((s) => s.fetchVariables);
  const saveVariables = useEnvStore((s) => s.saveVariables);
  const fetchGlobalVariables = useEnvStore((s) => s.fetchGlobalVariables);
  const saveGlobalVars = useEnvStore((s) => s.saveGlobalVars);

  // Selected tab: "global" or an environment ID
  const [selectedTab, setSelectedTab] = useState<string>("global");
  // Local editing state
  const [localEnvVars, setLocalEnvVars] = useState<EnvVariable[]>([]);
  const [localGlobalVars, setLocalGlobalVars] = useState<GlobalVariable[]>([]);
  const [search, setSearch] = useState("");

  // Load data when modal opens
  useEffect(() => {
    if (open) {
      fetchGlobalVariables();
      // Load vars for all environments
      for (const env of environments) {
        if (!variables[env.id]) fetchVariables(env.id);
      }
    }
  }, [open, environments, variables, fetchVariables, fetchGlobalVariables]);

  // Sync global vars to local state
  useEffect(() => {
    if (selectedTab === "global") setLocalGlobalVars(globalVariables);
  }, [globalVariables, selectedTab]);

  // Sync env vars to local state when tab changes
  useEffect(() => {
    if (selectedTab !== "global" && variables[selectedTab]) {
      setLocalEnvVars(variables[selectedTab]);
    }
  }, [selectedTab, variables]);

  // Filter vars by search
  const filteredGlobalVars = useMemo(() => {
    if (!search) return localGlobalVars;
    const q = search.toLowerCase();
    return localGlobalVars.filter((v) => v.key.toLowerCase().includes(q) || v.value.toLowerCase().includes(q));
  }, [localGlobalVars, search]);

  const filteredEnvVars = useMemo(() => {
    if (!search) return localEnvVars;
    const q = search.toLowerCase();
    return localEnvVars.filter((v) => v.key.toLowerCase().includes(q) || v.value.toLowerCase().includes(q));
  }, [localEnvVars, search]);

  // ── Global var handlers ──
  const flushGlobal = useCallback(() => { saveGlobalVars(localGlobalVars); }, [localGlobalVars, saveGlobalVars]);

  const addGlobalVar = useCallback(() => {
    const newVar: GlobalVariable = { id: crypto.randomUUID(), key: "", value: "", enabled: 1 };
    const updated = [...localGlobalVars, newVar];
    setLocalGlobalVars(updated);
    saveGlobalVars(updated);
  }, [localGlobalVars, saveGlobalVars]);

  const updateGlobalVar = useCallback((varId: string, updates: Partial<GlobalVariable>) => {
    setLocalGlobalVars((prev) => prev.map((v) => (v.id === varId ? { ...v, ...updates } : v)));
  }, []);

  const toggleGlobalVar = useCallback((varId: string) => {
    const updated = localGlobalVars.map((v) => (v.id === varId ? { ...v, enabled: v.enabled ? 0 : 1 } : v));
    setLocalGlobalVars(updated);
    saveGlobalVars(updated);
  }, [localGlobalVars, saveGlobalVars]);

  const deleteGlobalVar = useCallback((varId: string) => {
    const updated = localGlobalVars.filter((v) => v.id !== varId);
    setLocalGlobalVars(updated);
    saveGlobalVars(updated);
  }, [localGlobalVars, saveGlobalVars]);

  // ── Env var handlers ──
  const flushEnv = useCallback(() => {
    if (selectedTab !== "global") saveVariables(selectedTab, localEnvVars);
  }, [selectedTab, localEnvVars, saveVariables]);

  const addEnvVar = useCallback(() => {
    const newVar: EnvVariable = {
      id: crypto.randomUUID(), environmentId: selectedTab, key: "", value: "", enabled: 1, isSecret: 0, sortOrder: localEnvVars.length,
    };
    const updated = [...localEnvVars, newVar];
    setLocalEnvVars(updated);
    saveVariables(selectedTab, updated);
  }, [selectedTab, localEnvVars, saveVariables]);

  const updateEnvVar = useCallback((varId: string, updates: Partial<EnvVariable>) => {
    setLocalEnvVars((prev) => prev.map((v) => (v.id === varId ? { ...v, ...updates } : v)));
  }, []);

  const toggleEnvVar = useCallback((varId: string) => {
    const updated = localEnvVars.map((v) => (v.id === varId ? { ...v, enabled: v.enabled ? 0 : 1 } : v));
    setLocalEnvVars(updated);
    if (selectedTab !== "global") saveVariables(selectedTab, updated);
  }, [localEnvVars, selectedTab, saveVariables]);

  const deleteEnvVar = useCallback((varId: string) => {
    const updated = localEnvVars.filter((v) => v.id !== varId);
    setLocalEnvVars(updated);
    if (selectedTab !== "global") saveVariables(selectedTab, updated);
  }, [localEnvVars, selectedTab, saveVariables]);

  const toggleSecret = useCallback((varId: string) => {
    const updated = localEnvVars.map((v) => (v.id === varId ? { ...v, isSecret: v.isSecret ? 0 : 1 } : v));
    setLocalEnvVars(updated);
    if (selectedTab !== "global") saveVariables(selectedTab, updated);
  }, [localEnvVars, selectedTab, saveVariables]);

  // ── Environment management ──
  const handleNewEnv = async () => {
    const env = await createEnvironment("New Environment");
    setSelectedTab(env.id);
  };

  const handleDeleteEnv = async (envId: string) => {
    await deleteEnvironment(envId);
    setSelectedTab("global");
  };

  const handleToggleActive = async (envId: string) => {
    await setActive(activeEnvId === envId ? null : envId);
  };

  const selectedEnv = environments.find((e) => e.id === selectedTab);
  const isGlobal = selectedTab === "global";
  const currentVars = isGlobal ? filteredGlobalVars : filteredEnvVars;

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
            className="w-[860px] min-h-[520px] max-h-[80vh] rounded-xl border border-border-default bg-bg-primary shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 flex items-center justify-center border border-emerald-500/10">
                  <Zap className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-[var(--fs-md)] font-semibold text-text-primary">环境变量管理</h2>
                  <p className="text-[var(--fs-3xs)] text-text-disabled">管理全局变量和环境专属变量</p>
                </div>
              </div>
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-hover text-text-disabled hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
              {/* Left: Env list */}
              <div className="w-[200px] shrink-0 border-r border-border-subtle bg-bg-secondary/30 flex flex-col">
                <div className="p-2">
                  <button
                    onClick={() => setSelectedTab("global")}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[var(--fs-sm)] font-medium transition-colors",
                      isGlobal ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-bg-hover"
                    )}
                  >
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">全局变量</span>
                    <span className="text-[var(--fs-3xs)] text-text-disabled ml-auto tabular-nums">{globalVariables.length}</span>
                  </button>
                </div>

                <div className="px-2 py-1">
                  <div className="text-[var(--fs-3xs)] uppercase text-text-disabled font-semibold tracking-wider px-2.5">环境</div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
                  {environments.map((env) => {
                    const isSelected = selectedTab === env.id;
                    const isActiveEnv = env.id === activeEnvId;
                    return (
                      <button
                        key={env.id}
                        onClick={() => { setSelectedTab(env.id); if (!variables[env.id]) fetchVariables(env.id); }}
                        className={cn(
                          "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[var(--fs-sm)] transition-colors text-left",
                          isSelected ? "bg-accent-soft text-accent font-medium" : "text-text-tertiary hover:bg-bg-hover"
                        )}
                      >
                        <div className={cn("w-[5px] h-[5px] rounded-full shrink-0", isActiveEnv ? "bg-emerald-500" : "bg-border-strong")} />
                        <span className="truncate flex-1">{env.name}</span>
                        {isActiveEnv && <span className="text-[var(--fs-3xs)] text-emerald-600 font-semibold">ON</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="p-2 border-t border-border-subtle/50">
                  <button onClick={handleNewEnv} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[var(--fs-xs)] text-accent hover:bg-accent-soft transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    <span>新建环境</span>
                  </button>
                </div>
              </div>

              {/* Right: Variable editor */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Toolbar */}
                <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle/70">
                  <div className="flex items-center gap-2 flex-1">
                    <h3 className="text-[var(--fs-sm)] font-semibold text-text-primary">
                      {isGlobal ? "全局变量" : selectedEnv?.name || ""}
                    </h3>
                    {!isGlobal && (
                      <button
                        onClick={() => handleToggleActive(selectedTab)}
                        className={cn(
                          "ml-1 px-2 py-0.5 rounded-md text-[var(--fs-3xs)] font-semibold transition-colors",
                          activeEnvId === selectedTab
                            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                            : "bg-bg-hover text-text-disabled hover:text-text-secondary"
                        )}
                      >
                        {activeEnvId === selectedTab ? "已激活" : "激活"}
                      </button>
                    )}
                    {!isGlobal && (
                      <button
                        onClick={() => handleDeleteEnv(selectedTab)}
                        className="ml-1 px-1.5 py-0.5 rounded-md text-[var(--fs-3xs)] text-red-500/60 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        删除环境
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索变量..."
                      className="pl-6 pr-2 py-1 w-[140px] rounded-md bg-bg-secondary border border-border-subtle text-[var(--fs-xs)] text-text-primary outline-none focus:border-accent/50 transition-colors"
                    />
                  </div>
                  <button
                    onClick={isGlobal ? addGlobalVar : addEnvVar}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 text-accent text-[var(--fs-xs)] font-medium hover:bg-accent/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    添加
                  </button>
                </div>

                {/* Hint for env-level */}
                {!isGlobal && (
                  <div className="px-4 py-1.5 text-[var(--fs-3xs)] text-text-disabled bg-amber-500/3 border-b border-border-subtle/30">
                    环境变量会覆盖同名的全局变量（优先级更高）
                  </div>
                )}
                {isGlobal && (
                  <div className="px-4 py-1.5 text-[var(--fs-3xs)] text-text-disabled bg-blue-500/3 border-b border-border-subtle/30">
                    全局变量在所有环境中生效，环境变量可覆盖同名全局变量
                  </div>
                )}

                {/* Table */}
                <div className="flex-1 overflow-y-auto">
                  {currentVars.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-disabled">
                      <Zap className="w-8 h-8 mb-2 opacity-30" />
                      <p className="text-[var(--fs-sm)]">{search ? "未找到匹配的变量" : "暂无变量"}</p>
                      <p className="text-[var(--fs-3xs)] mt-0.5">点击上方"添加"按钮创建新变量</p>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead className="sticky top-0 bg-bg-primary z-10">
                        <tr className="text-[var(--fs-3xs)] text-text-disabled border-b border-border-subtle/50 uppercase tracking-wider">
                          <th className="text-left font-medium px-4 py-2 w-8" />
                          <th className="text-left font-medium px-2 py-2 w-[38%]">Key</th>
                          <th className="text-left font-medium px-2 py-2">Value</th>
                          <th className="w-16" />
                        </tr>
                      </thead>
                      <tbody>
                        {currentVars.map((v) => (
                          <tr key={v.id} className="group border-b border-border-subtle/30 hover:bg-bg-hover/40 transition-colors">
                            <td className="px-4 py-1.5">
                              <input
                                type="checkbox"
                                checked={v.enabled === 1}
                                onChange={() => isGlobal ? toggleGlobalVar(v.id) : toggleEnvVar(v.id)}
                                className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                value={v.key}
                                onChange={(e) => isGlobal ? updateGlobalVar(v.id, { key: e.target.value }) : updateEnvVar(v.id, { key: e.target.value })}
                                onBlur={isGlobal ? flushGlobal : flushEnv}
                                placeholder="VARIABLE_NAME"
                                className={cn(
                                  "w-full bg-transparent border-none outline-none text-text-primary text-[var(--fs-xs)] font-mono",
                                  v.enabled === 0 && "opacity-40 line-through"
                                )}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <input
                                  value={v.value}
                                  onChange={(e) => isGlobal ? updateGlobalVar(v.id, { value: e.target.value }) : updateEnvVar(v.id, { value: e.target.value })}
                                  onBlur={isGlobal ? flushGlobal : flushEnv}
                                  placeholder="value"
                                  type={!isGlobal && 'isSecret' in v && (v as EnvVariable).isSecret === 1 ? "password" : "text"}
                                  className={cn(
                                    "w-full bg-transparent border-none outline-none text-text-secondary text-[var(--fs-xs)] font-mono flex-1",
                                    v.enabled === 0 && "opacity-40"
                                  )}
                                />
                                {!isGlobal && (
                                  <button
                                    onClick={() => toggleSecret(v.id)}
                                    className="shrink-0 opacity-0 group-hover:opacity-70 hover:!opacity-100 text-text-disabled transition-opacity"
                                    title={'isSecret' in v && (v as EnvVariable).isSecret ? "显示值" : "隐藏值"}
                                  >
                                    {'isSecret' in v && (v as EnvVariable).isSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => isGlobal ? deleteGlobalVar(v.id) : deleteEnvVar(v.id)}
                                className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded-md hover:bg-red-500/10 hover:text-red-500 text-text-disabled transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer stats */}
                <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-border-subtle/50 text-[var(--fs-3xs)] text-text-disabled">
                  <span>共 {currentVars.length} 个变量 · {currentVars.filter((v) => v.enabled).length} 个已启用</span>
                  {!isGlobal && activeEnvId === selectedTab && (
                    <span className="text-emerald-600 font-medium">● 当前激活</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
