import { useState, useEffect } from 'react';
import { Globe, Plus, Trash2, Check, Eye, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useEnvStore } from '@/stores/envStore';
import type { EnvVariable } from '@/types/collections';

type EditorTab = 'environments' | 'global';

export function EnvironmentEditor() {
  const { t } = useTranslation();
  const {
    environments, activeEnvId,
    fetchEnvironments, createEnvironment, deleteEnvironment,
    setActive,
    fetchVariables, variables, saveVariables,
    fetchGlobalVariables, globalVariables, saveGlobalVars,
  } = useEnvStore();

  const [tab, setTab] = useState<EditorTab>('environments');
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [newEnvName, setNewEnvName] = useState('');
  const [editing, setEditing] = useState<EnvVariable[]>([]);
  const [globalEditing, setGlobalEditing] = useState<{ key: string; value: string; enabled: boolean }[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchEnvironments();
    fetchGlobalVariables();
  }, [fetchEnvironments, fetchGlobalVariables]);

  useEffect(() => {
    if (selectedEnvId) {
      fetchVariables(selectedEnvId);
    }
  }, [selectedEnvId, fetchVariables]);

  useEffect(() => {
    if (selectedEnvId && variables[selectedEnvId]) {
      setEditing(variables[selectedEnvId].map((v) => ({ ...v })));
      setDirty(false);
    }
  }, [selectedEnvId, variables]);

  useEffect(() => {
    setGlobalEditing(globalVariables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled === 1 })));
  }, [globalVariables]);

  const handleCreateEnv = async () => {
    if (!newEnvName.trim()) return;
    await createEnvironment(newEnvName.trim());
    setNewEnvName('');
  };

  const handleDeleteEnv = async (id: string) => {
    await deleteEnvironment(id);
    if (selectedEnvId === id) {
      setSelectedEnvId(null);
      setEditing([]);
    }
  };

  const handleSaveVariables = async () => {
    if (!selectedEnvId) return;
    await saveVariables(selectedEnvId, editing);
    setDirty(false);
  };

  const handleSaveGlobal = async () => {
    await saveGlobalVars(globalEditing.map((v) => ({
      id: '', key: v.key, value: v.value, enabled: v.enabled ? 1 : 0
    })));
  };

  const addVariable = () => {
    setEditing((prev) => [...prev, {
      id: crypto.randomUUID(),
      environmentId: selectedEnvId || '',
      key: '', value: '', enabled: 1, isSecret: 0, sortOrder: prev.length,
    }]);
    setDirty(true);
  };

  const addGlobalVariable = () => {
    setGlobalEditing((prev) => [...prev, { key: '', value: '', enabled: true }]);
  };

  const updateVar = (i: number, updates: Partial<EnvVariable>) => {
    setEditing((prev) => prev.map((v, j) => j === i ? { ...v, ...updates } : v));
    setDirty(true);
  };

  const removeVar = (i: number) => {
    setEditing((prev) => prev.filter((_, j) => j !== i));
    setDirty(true);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-3">
          <Globe className="w-5 h-5 text-accent" />
          <h2 className="text-[15px] font-semibold text-text-primary">{t('env.title')}</h2>
        </div>
        <div className="flex items-center gap-1 bg-bg-secondary p-1 rounded-lg w-fit">
          <button
            onClick={() => setTab('environments')}
            className={cn(
              "px-4 py-1.5 text-[12px] font-medium rounded-md transition-all",
              tab === 'environments' ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t('env.envVars')}
          </button>
          <button
            onClick={() => setTab('global')}
            className={cn(
              "px-4 py-1.5 text-[12px] font-medium rounded-md transition-all",
              tab === 'global' ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t('env.globalVars')}
          </button>
        </div>
      </div>

      {tab === 'environments' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Environment List */}
          <div className="w-56 shrink-0 border-r border-border-default flex flex-col">
            <div className="p-3 border-b border-border-default">
              <div className="flex items-center gap-1.5">
                <input
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateEnv()}
                  placeholder={t('env.newEnvPlaceholder')}
                  className="input-field flex-1 text-[12px] py-1.5"
                />
                <button onClick={handleCreateEnv} className="h-7 px-2 bg-accent text-white rounded-md text-[11px] font-medium hover:bg-accent-hover shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto py-1">
              {environments.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-text-disabled">{t('env.noEnvs')}</div>
              ) : (
                environments.map((env) => (
                  <div
                    key={env.id}
                    onClick={() => setSelectedEnvId(env.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group mx-1 rounded-md",
                      selectedEnvId === env.id ? "bg-accent/10" : "hover:bg-bg-hover"
                    )}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setActive(env.isActive === 1 ? null : env.id); }}
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                        env.isActive === 1 ? "border-emerald-500 bg-emerald-500" : "border-border-strong hover:border-accent"
                      )}
                    >
                      {env.isActive === 1 && <Check className="w-2.5 h-2.5 text-white" />}
                    </button>
                    <span className={cn(
                      "text-[13px] truncate flex-1",
                      selectedEnvId === env.id ? "text-accent font-medium" : "text-text-primary"
                    )}>
                      {env.name}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteEnv(env.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded text-text-disabled hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {/* Active env indicator */}
            {activeEnvId && (
              <div className="shrink-0 px-3 py-2 border-t border-border-default text-[11px] text-emerald-600 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {t('env.active')}: {environments.find((e) => e.id === activeEnvId)?.name || ''}
              </div>
            )}
          </div>

          {/* Right: Variable Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedEnvId ? (
              <>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-bg-secondary/30 shrink-0">
                  <span className="text-[13px] font-medium text-text-secondary">
                    {t('env.varsOf', { name: environments.find((e) => e.id === selectedEnvId)?.name })}
                  </span>
                  <div className="flex items-center gap-2">
                    {dirty && <span className="text-[11px] text-amber-500 font-medium">{t('env.unsaved')}</span>}
                    <button
                      onClick={handleSaveVariables}
                      disabled={!dirty}
                      className="h-7 px-3 bg-accent text-white rounded-md text-[11px] font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('env.save')}
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {/* Header */}
                  {editing.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 px-8 text-[11px] font-semibold text-text-disabled uppercase tracking-wider">
                      <div className="flex-1">{t('env.varName')}</div>
                      <div className="flex-1">{t('env.varValue')}</div>
                      <div className="w-16 text-center">{t('env.secret')}</div>
                      <div className="w-8" />
                    </div>
                  )}
                  <div className="space-y-2">
                    {editing.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2 group">
                        <div className="w-6 flex justify-center">
                          <input
                            type="checkbox"
                            checked={v.enabled === 1}
                            onChange={() => updateVar(i, { enabled: v.enabled === 1 ? 0 : 1 })}
                            className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                          />
                        </div>
                        <input
                          value={v.key}
                          onChange={(e) => updateVar(i, { key: e.target.value })}
                          placeholder="VARIABLE_NAME"
                          className={cn("input-field flex-1 font-mono text-[13px] py-1.5", v.enabled !== 1 && "opacity-40")}
                        />
                        <input
                          value={v.value}
                          onChange={(e) => updateVar(i, { value: e.target.value })}
                          placeholder="value"
                          type={v.isSecret === 1 ? 'password' : 'text'}
                          className={cn("input-field flex-1 font-mono text-[13px] py-1.5", v.enabled !== 1 && "opacity-40")}
                        />
                        <button
                          onClick={() => updateVar(i, { isSecret: v.isSecret === 1 ? 0 : 1 })}
                          className={cn("w-16 h-[34px] flex items-center justify-center rounded-md text-[11px] border transition-colors", v.isSecret === 1 ? "bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-500/10 dark:border-amber-500/30" : "border-border-default text-text-disabled hover:text-text-secondary")}
                          title={v.isSecret === 1 ? t('env.unmarkSecret') : t('env.markSecret')}
                        >
                          {v.isSecret === 1 ? <Lock className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                        <div className="w-8 flex justify-center">
                          <button onClick={() => removeVar(i)} className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all text-lg">×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addVariable}
                    className="mt-3 ml-8 text-[12px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors w-fit border border-dashed border-border-default hover:border-accent rounded-md px-3 py-1.5"
                  >
                    <span>+</span> {t('env.addVar')}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-disabled">
                <div className="text-center">
                  <Globe className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-[13px] text-text-secondary">{t('env.selectEnv')}</p>
                  <p className="text-[12px] mt-1">{t('env.selectEnvHint')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Global Variables Tab */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-bg-secondary/30 shrink-0">
            <span className="text-[13px] text-text-secondary">{t('env.globalVarsDesc')}</span>
            <button
              onClick={handleSaveGlobal}
              className="h-7 px-3 bg-accent text-white rounded-md text-[11px] font-medium hover:bg-accent-hover transition-colors"
            >
              {t('env.save')}
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {globalEditing.length > 0 && (
              <div className="flex items-center gap-2 mb-2 px-8 text-[11px] font-semibold text-text-disabled uppercase tracking-wider">
                <div className="flex-1">{t('env.varName')}</div>
                <div className="flex-1">{t('env.varValue')}</div>
                <div className="w-8" />
              </div>
            )}
            <div className="space-y-2">
              {globalEditing.map((v, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <div className="w-6 flex justify-center">
                    <input
                      type="checkbox"
                      checked={v.enabled}
                      onChange={() => setGlobalEditing((prev) => prev.map((g, j) => j === i ? { ...g, enabled: !g.enabled } : g))}
                      className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                    />
                  </div>
                  <input
                    value={v.key}
                    onChange={(e) => setGlobalEditing((prev) => prev.map((g, j) => j === i ? { ...g, key: e.target.value } : g))}
                    placeholder="GLOBAL_VAR"
                    className={cn("input-field flex-1 font-mono text-[13px] py-1.5", !v.enabled && "opacity-40")}
                  />
                  <input
                    value={v.value}
                    onChange={(e) => setGlobalEditing((prev) => prev.map((g, j) => j === i ? { ...g, value: e.target.value } : g))}
                    placeholder="value"
                    className={cn("input-field flex-1 font-mono text-[13px] py-1.5", !v.enabled && "opacity-40")}
                  />
                  <div className="w-8 flex justify-center">
                    <button onClick={() => setGlobalEditing((prev) => prev.filter((_, j) => j !== i))} className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all text-lg">×</button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addGlobalVariable}
              className="mt-3 ml-8 text-[12px] font-medium text-text-tertiary hover:text-accent flex items-center gap-1 transition-colors w-fit border border-dashed border-border-default hover:border-accent rounded-md px-3 py-1.5"
            >
              <span>+</span> {t('env.addGlobalVar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
