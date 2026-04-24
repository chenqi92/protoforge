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
        className="fixed z-[601] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] bg-bg-surface border border-border-default rounded-xl shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="px-5 pt-4 pb-3">
          <h3 className="pf-text-sm font-semibold text-text-primary">
            {t('contextMenu.setAsEnvVariable', '设为环境变量')}
          </h3>
          <p className="pf-text-xs text-text-secondary mt-1 truncate" title={pending.value}>
            {t('contextMenu.envVarValue', '值')}: <code className="bg-bg-elevated px-1 rounded">{pending.value.length > 60 ? pending.value.slice(0, 60) + '...' : pending.value}</code>
          </p>
        </div>

        <div className="px-5 space-y-3 pb-4">
          {/* Variable name */}
          <div>
            <label className="pf-text-xs text-text-secondary block mb-1">
              {t('contextMenu.envVarName', '变量名')}
            </label>
            <input
              ref={inputRef}
              value={varName}
              onChange={(e) => setVarName(e.target.value)}
              placeholder="e.g. API_TOKEN"
              className="w-full px-3 py-1.5 pf-text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-border-focus"
            />
          </div>

          {/* Scope selector */}
          <div>
            <label className="pf-text-xs text-text-secondary block mb-1">
              {t('contextMenu.envVarScope', '作用域')}
            </label>
            <div className="space-y-1">
              <button
                onClick={() => setScope('global')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 pf-text-sm rounded-lg transition-colors text-left',
                  scope === 'global'
                    ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/30'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-transparent',
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
                    'w-full flex items-center gap-2 px-3 py-1.5 pf-text-sm rounded-lg transition-colors text-left',
                    scope === env.id
                      ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/30'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-transparent',
                  )}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  {env.name}
                  {env.id === activeEnvId && (
                    <span className="pf-text-xxs text-accent-primary ml-auto">{t('contextMenu.envActive', '活跃')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <button
            onClick={() => setPending(null)}
            className="px-3 py-1.5 pf-text-sm text-text-secondary hover:bg-bg-hover rounded-lg transition-colors"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            onClick={handleSave}
            disabled={!varName.trim() || saving}
            className={cn(
              'px-4 py-1.5 pf-text-sm rounded-lg font-medium transition-colors',
              varName.trim() && !saving
                ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
                : 'bg-bg-elevated text-text-disabled cursor-not-allowed',
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
