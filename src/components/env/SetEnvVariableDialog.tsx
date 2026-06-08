/**
 * SetEnvVariableDialog — 快速将选中文本设为环境变量
 *
 * 通过 CustomEvent 'set-env-variable' 触发，detail: { value: string }
 * 支持选择作用域：全局变量 或 指定环境
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useEnvStore } from '@/stores/envStore';
import { useTranslation } from 'react-i18next';

interface PendingEnvVar {
  value: string;
}

export function SetEnvVariableDialog() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingEnvVar | null>(null);
  const [varName, setVarName] = useState('');
  const [scope, setScope] = useState<'global' | string>('global'); // 'global' or envId
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    environments, activeEnvId,
    globalVariables, variables: _variables,
    fetchEnvironments, fetchGlobalVariables, fetchVariables,
    saveGlobalVars, saveVariables,
  } = useEnvStore();

  // Listen for the custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PendingEnvVar>).detail;
      if (!detail?.value) return;
      setPending(detail);
      setVarName('');
      setScope(activeEnvId || 'global');
      // Ensure data is loaded
      fetchEnvironments();
      fetchGlobalVariables();
    };
    window.addEventListener('set-env-variable', handler);
    return () => window.removeEventListener('set-env-variable', handler);
  }, [activeEnvId, fetchEnvironments, fetchGlobalVariables]);

  // Autofocus the input when dialog opens
  useEffect(() => {
    if (pending) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [pending]);

  const handleSave = async () => {
    if (!varName.trim() || !pending) return;
    setSaving(true);
    try {
      if (scope === 'global') {
        const newVars = [
          ...globalVariables,
          { id: crypto.randomUUID(), key: varName.trim(), value: pending.value, enabled: 1 as const },
        ];
        await saveGlobalVars(newVars);
      } else {
        // Fetch latest variables for the target environment
        await fetchVariables(scope);
        const envVars = useEnvStore.getState().variables[scope] || [];
        const newVars = [
          ...envVars,
          {
            id: crypto.randomUUID(),
            environmentId: scope,
            key: varName.trim(),
            value: pending.value,
            enabled: 1 as const,
            isSecret: 0 as const,
            sortOrder: envVars.length,
          },
        ];
        await saveVariables(scope, newVars);
      }
      setPending(null);
      toast.success(t('env.variableSaved', { defaultValue: '变量已保存' }));
    } catch (err) {
      toast.error((t('env.saveVariableFailed', { defaultValue: '保存变量失败' }) as string) + ': ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && varName.trim()) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setPending(null);
    }
  };

  if (!pending) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[600] bg-black/40 backdrop-blur-sm"
        onClick={() => setPending(null)}
      />
      {/* Dialog */}
      <div
        className="fixed z-[601] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] bg-bg-elevated border border-border-strong rounded-[14px] shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-border-default">
          <div className="w-7 h-7 pf-rounded-md bg-accent-soft flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="min-w-0">
            <h3 className="pf-text-sm font-semibold text-text-primary">
              {t('contextMenu.setAsEnvVariable', '设为环境变量')}
            </h3>
            <p className="pf-text-xs text-text-secondary mt-0.5 truncate" title={pending.value}>
              {t('contextMenu.envVarValue', '值')}: <code className="font-mono bg-bg-tertiary text-accent px-1 pf-rounded-xs">{pending.value.length > 60 ? pending.value.slice(0, 60) + '...' : pending.value}</code>
            </p>
          </div>
        </div>

        <div className="px-5 space-y-3 pb-4 pt-3">
          {/* Variable name */}
          <div>
            <label className="pf-text-3xs font-semibold uppercase tracking-[0.05em] text-text-disabled block mb-1.5">
              {t('contextMenu.envVarName', '变量名')}
            </label>
            <input
              ref={inputRef}
              value={varName}
              onChange={(e) => setVarName(e.target.value)}
              placeholder="e.g. API_TOKEN"
              className="w-full px-3 py-1.5 pf-text-sm font-mono bg-bg-secondary border border-border-default pf-rounded-md text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-border-focus transition-colors"
            />
          </div>

          {/* Scope selector */}
          <div>
            <label className="pf-text-3xs font-semibold uppercase tracking-[0.05em] text-text-disabled block mb-1.5">
              {t('contextMenu.envVarScope', '作用域')}
            </label>
            <div className="space-y-1">
              <button
                onClick={() => setScope('global')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 pf-text-sm pf-rounded-md transition-colors text-left',
                  scope === 'global'
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover border border-transparent',
                )}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                {t('contextMenu.envScopeGlobal', '全局变量')}
              </button>
              {environments.map((env) => (
                <button
                  key={env.id}
                  onClick={() => setScope(env.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 pf-text-sm pf-rounded-md transition-colors text-left',
                    scope === env.id
                      ? 'bg-accent-soft text-accent border border-accent/30'
                      : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover border border-transparent',
                  )}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  {env.name}
                  {env.id === activeEnvId && (
                    <span className="pf-pill ok h-[15px] px-1.5 text-[9px] ml-auto">{t('contextMenu.envActive', '活跃')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            onClick={() => setPending(null)}
            className="px-3 py-1.5 pf-text-sm text-text-secondary hover:bg-bg-hover pf-rounded-md transition-colors"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            onClick={handleSave}
            disabled={!varName.trim() || saving}
            className={cn(
              'px-4 py-1.5 pf-text-sm pf-rounded-md font-medium transition-colors',
              varName.trim() && !saving
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-bg-tertiary text-text-disabled cursor-not-allowed',
            )}
          >
            {saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
