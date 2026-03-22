// CollectionSettingsPanel — 合集设置面板
// 提供合集级别的概览、变量、认证、脚本编辑功能

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Info, Variable, Shield, Code, Save,
  Plus, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useCollectionStore } from '@/stores/collectionStore';
import type { Collection } from '@/types/collections';
import type { CollectionVariableEntry } from '@/lib/requestVariables';
import { parseCollectionVariableEntries, saveCollectionVariables } from '@/lib/requestVariables';

type SettingsTab = 'overview' | 'variables' | 'auth' | 'scripts';

interface CollectionSettingsPanelProps {
  collectionId: string;
}

const tabs: { id: SettingsTab; label: string; icon: typeof Info }[] = [
  { id: 'overview', label: 'collectionSettings.overview', icon: Info },
  { id: 'variables', label: 'collectionSettings.variables', icon: Variable },
  { id: 'auth', label: 'collectionSettings.auth', icon: Shield },
  { id: 'scripts', label: 'collectionSettings.scripts', icon: Code },
];

type VarEntry = CollectionVariableEntry;

export function CollectionSettingsPanel({ collectionId }: CollectionSettingsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');
  const collections = useCollectionStore((s) => s.collections);
  const collection = collections.find((c) => c.id === collectionId);

  if (!collection) {
    return (
      <div className="h-full flex items-center justify-center text-text-disabled">
        <p className="text-sm">{t('collectionSettings.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-0 border-b border-border-subtle">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <Variable className="w-4.5 h-4.5 text-sky-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[var(--fs-lg)] font-semibold text-text-primary truncate">{collection.name}</h1>
            <p className="text-[var(--fs-xs)] text-text-tertiary">{t('collectionSettings.title')}</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5">
          {tabs.map(({ id, label: labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 text-[var(--fs-sm)] font-medium rounded-t-md transition-colors',
                activeTab === id
                  ? 'text-accent'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(labelKey)}
              {activeTab === id && (
                <motion.div
                  layoutId={`col-settings-tab-${collectionId}`}
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {activeTab === 'overview' && <OverviewTab collection={collection} />}
        {activeTab === 'variables' && <VariablesTab collection={collection} />}
        {activeTab === 'auth' && <AuthTab collection={collection} />}
        {activeTab === 'scripts' && <ScriptsTab collection={collection} />}
      </div>
    </div>
  );
}

/* ── Overview Tab ── */
function OverviewTab({ collection }: { collection: Collection }) {
  const { t } = useTranslation();
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description);
  const [dirty, setDirty] = useState(false);
  const collections = useCollectionStore((s) => s.collections);

  useEffect(() => {
    setName(collection.name);
    setDescription(collection.description);
    setDirty(false);
  }, [collection.id, collection.name, collection.description]);

  const handleSave = useCallback(async () => {
    // renameCollection only updates the name, we need full update
    const col = collections.find((c) => c.id === collection.id);
    if (!col) return;
    const { updateCollection: updateCol } = await import('@/services/collectionService');
    const updated = { ...col, name, description, updatedAt: new Date().toISOString() };
    await updateCol(updated);
    // refresh store
    useCollectionStore.getState().fetchCollections();
    setDirty(false);
  }, [name, description, collection.id, collections]);

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.name')}</label>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary transition-all"
        />
      </div>

      <div>
        <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.description')}</label>
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
          rows={4}
          placeholder={t('collectionSettings.descPlaceholder')}
          className="w-full px-3 py-2 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(59,130,246,0.08)] text-text-primary placeholder:text-text-tertiary resize-none transition-all"
        />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-[var(--fs-sm)] font-medium transition-all',
            dirty
              ? 'gradient-accent text-white shadow-sm hover:shadow-md active:scale-[0.98]'
              : 'border border-border-default text-text-disabled cursor-not-allowed'
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {t('collectionSettings.save')}
        </button>
      </div>
    </div>
  );
}

/* ── Variables Tab ── */
function VariablesTab({ collection }: { collection: Collection }) {
  const { t } = useTranslation();
  const [vars, setVars] = useState<VarEntry[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setVars(parseCollectionVariableEntries(collection.variables));
    setDirty(false);
  }, [collection.id, collection.variables]);

  const addVar = () => {
    setVars([...vars, { key: '', value: '', enabled: true, isSecret: false }]);
    setDirty(true);
  };

  const removeVar = (idx: number) => {
    setVars(vars.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateVar = (idx: number, field: keyof VarEntry, val: any) => {
    setVars(vars.map((v, i) => i === idx ? { ...v, [field]: val } : v));
    setDirty(true);
  };

  const handleSave = async () => {
    await saveCollectionVariables(collection.id, vars);
    setDirty(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[var(--fs-sm)] text-text-tertiary">
          {t('collectionSettings.varsDesc')}
        </p>
        <button
          onClick={addVar}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[var(--fs-xs)] font-medium text-accent hover:bg-accent-soft rounded-md transition-all active:scale-[0.97]"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('collectionSettings.addVar')}
        </button>
      </div>

      {vars.length === 0 ? (
        <div className="py-12 flex flex-col items-center text-text-disabled">
          <Variable className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-[var(--fs-sm)]">{t('collectionSettings.noVars')}</p>
          <p className="text-[var(--fs-xs)] mt-0.5 opacity-60">{t('collectionSettings.noVarsHint')}</p>
        </div>
      ) : (
        <div className="border border-border-default/60 rounded-lg overflow-hidden">
          <table className="w-full text-[var(--fs-sm)]">
            <thead>
              <tr className="bg-bg-secondary/50 border-b border-border-default/50">
                <th className="px-3 py-2 text-left text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wider w-6">
                  <span className="sr-only">Enabled</span>
                </th>
                <th className="px-3 py-2 text-left text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wider">KEY</th>
                <th className="px-3 py-2 text-left text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wider">VALUE</th>
                <th className="px-3 py-2 text-right text-[var(--fs-xxs)] font-semibold text-text-disabled uppercase tracking-wider w-20">{t('collectionSettings.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v, i) => (
                <tr
                  key={i}
                  className={cn(
                    'border-b border-border-default/30 last:border-b-0 transition-colors hover:bg-bg-hover/50',
                    !v.enabled && 'opacity-40'
                  )}
                >
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => updateVar(i, 'enabled', !v.enabled)}
                      className="flex items-center justify-center"
                      title={v.enabled ? t('collectionSettings.disable') : t('collectionSettings.enable')}
                    >
                      <div className={cn('w-3 h-3 rounded-full border-2 transition-colors', v.enabled ? 'border-emerald-500 bg-emerald-500' : 'border-text-disabled')} />
                    </button>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={v.key}
                      onChange={(e) => updateVar(i, 'key', e.target.value)}
                      placeholder="key"
                      className="w-full h-7 px-2 text-[var(--fs-sm)] bg-transparent border-none outline-none text-text-primary placeholder:text-text-tertiary font-mono"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={v.isSecret ? '••••••••' : v.value}
                      onChange={(e) => updateVar(i, 'value', e.target.value)}
                      placeholder="value"
                      type={v.isSecret ? 'password' : 'text'}
                      className="w-full h-7 px-2 text-[var(--fs-sm)] bg-transparent border-none outline-none text-text-primary placeholder:text-text-tertiary font-mono"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => updateVar(i, 'isSecret', !v.isSecret)}
                        className="w-6 h-6 flex items-center justify-center text-text-disabled hover:text-text-secondary transition-colors rounded hover:bg-bg-hover"
                        title={v.isSecret ? t('collectionSettings.showValue') : t('collectionSettings.hideValue')}
                      >
                        {v.isSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => removeVar(i)}
                        className="w-6 h-6 flex items-center justify-center text-text-disabled hover:text-red-500 transition-colors rounded hover:bg-red-500/8"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dirty && (
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[var(--fs-sm)] font-medium gradient-accent text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {t('collectionSettings.saveVars')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Auth Tab ── */
function AuthTab({ collection }: { collection: Collection }) {
  const { t } = useTranslation();
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'basic' | 'apikey'>('none');
  const [authConfig, setAuthConfig] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    try {
      const parsed = JSON.parse(collection.auth || 'null');
      if (parsed && typeof parsed === 'object') {
        setAuthType(parsed.type || 'none');
        setAuthConfig(parsed);
      } else {
        setAuthType('none');
        setAuthConfig({});
      }
    } catch {
      setAuthType('none');
      setAuthConfig({});
    }
    setDirty(false);
  }, [collection.id, collection.auth]);

  const updateField = (key: string, value: string) => {
    setAuthConfig({ ...authConfig, [key]: value });
    setDirty(true);
  };

  const handleSave = async () => {
    const { updateCollection } = await import('@/services/collectionService');
    const col = useCollectionStore.getState().collections.find(c => c.id === collection.id);
    if (!col) return;
    const authData = authType === 'none' ? null : JSON.stringify({ ...authConfig, type: authType });
    const updated = { ...col, auth: authData, updatedAt: new Date().toISOString() };
    await updateCollection(updated);
    useCollectionStore.getState().fetchCollections();
    setDirty(false);
  };

  const authTypes = [
    { value: 'none', label: t('collectionSettings.noAuth') },
    { value: 'bearer', label: 'Bearer Token' },
    { value: 'basic', label: 'Basic Auth' },
    { value: 'apikey', label: 'API Key' },
  ] as const;

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.authType')}</label>
        <div className="flex gap-1.5">
          {authTypes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setAuthType(value); setDirty(true); }}
              className={cn(
                'px-3 py-1.5 text-[var(--fs-sm)] font-medium rounded-md transition-all border',
                authType === value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border-default text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {authType === 'bearer' && (
        <div>
          <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">Token</label>
          <input
            value={authConfig.bearerToken || ''}
            onChange={(e) => updateField('bearerToken', e.target.value)}
            placeholder="Bearer token..."
            className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary font-mono transition-all"
          />
        </div>
      )}

      {authType === 'basic' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.username')}</label>
            <input
              value={authConfig.basicUsername || ''}
              onChange={(e) => updateField('basicUsername', e.target.value)}
              placeholder="Username"
              className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary transition-all"
            />
          </div>
          <div>
            <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.password')}</label>
            <input
              type="password"
              value={authConfig.basicPassword || ''}
              onChange={(e) => updateField('basicPassword', e.target.value)}
              placeholder="Password"
              className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary transition-all"
            />
          </div>
        </div>
      )}

      {authType === 'apikey' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.keyName')}</label>
            <input
              value={authConfig.apiKeyName || ''}
              onChange={(e) => updateField('apiKeyName', e.target.value)}
              placeholder="X-API-Key"
              className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary font-mono transition-all"
            />
          </div>
          <div>
            <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.keyValue')}</label>
            <input
              value={authConfig.apiKeyValue || ''}
              onChange={(e) => updateField('apiKeyValue', e.target.value)}
              placeholder="your-api-key"
              className="w-full h-9 px-3 text-[var(--fs-base)] bg-bg-secondary border border-border-default rounded-md outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary font-mono transition-all"
            />
          </div>
          <div>
            <label className="block text-[var(--fs-sm)] font-medium text-text-secondary mb-1.5">{t('collectionSettings.addTo')}</label>
            <div className="flex gap-1.5">
              {['header', 'query'].map((loc) => (
                <button
                  key={loc}
                  onClick={() => updateField('apiKeyIn', loc)}
                  className={cn(
                    'px-3 py-1.5 text-[var(--fs-sm)] font-medium rounded-md transition-all border',
                    (authConfig.apiKeyIn || 'header') === loc
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border-default text-text-tertiary hover:bg-bg-hover'
                  )}
                >
                  {loc === 'header' ? 'Header' : 'Query Param'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {dirty && (
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[var(--fs-sm)] font-medium gradient-accent text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {t('collectionSettings.saveAuth')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Scripts Tab ── */
function ScriptsTab({ collection }: { collection: Collection }) {
  const { t } = useTranslation();
  const [preScript, setPreScript] = useState(collection.preScript);
  const [postScript, setPostScript] = useState(collection.postScript);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPreScript(collection.preScript);
    setPostScript(collection.postScript);
    setDirty(false);
  }, [collection.id, collection.preScript, collection.postScript]);

  const handleSave = async () => {
    const { updateCollection } = await import('@/services/collectionService');
    const col = useCollectionStore.getState().collections.find(c => c.id === collection.id);
    if (!col) return;
    const updated = { ...col, preScript, postScript, updatedAt: new Date().toISOString() };
    await updateCollection(updated);
    useCollectionStore.getState().fetchCollections();
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">{t('collectionSettings.preScript')}</label>
          <span className="text-[var(--fs-xxs)] text-text-disabled">{t('collectionSettings.preScriptHint')}</span>
        </div>
        <textarea
          value={preScript}
          onChange={(e) => { setPreScript(e.target.value); setDirty(true); }}
          rows={10}
          placeholder={'// 在此合集下所有请求发送前执行\n// 可使用 pf.setVar("key", "value") 设置变量\n// 可使用 pf.getVar("key") 获取变量'}
          className="w-full px-4 py-3 text-[var(--fs-sm)] bg-bg-secondary border border-border-default rounded-lg outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary resize-none font-mono leading-relaxed transition-all"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[var(--fs-sm)] font-medium text-text-secondary">{t('collectionSettings.postScript')}</label>
          <span className="text-[var(--fs-xxs)] text-text-disabled">{t('collectionSettings.postScriptHint')}</span>
        </div>
        <textarea
          value={postScript}
          onChange={(e) => { setPostScript(e.target.value); setDirty(true); }}
          rows={10}
          placeholder={'// 在此合集下所有请求收到响应后执行\n// 可使用 pf.test("name", () => { ... }) 编写测试\n// 可使用 pf.response 访问响应对象'}
          className="w-full px-4 py-3 text-[var(--fs-sm)] bg-bg-secondary border border-border-default rounded-lg outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary resize-none font-mono leading-relaxed transition-all"
        />
      </div>

      {dirty && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[var(--fs-sm)] font-medium gradient-accent text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {t('collectionSettings.saveScripts')}
          </button>
        </div>
      )}
    </div>
  );
}
