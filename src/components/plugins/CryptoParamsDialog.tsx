/**
 * CryptoParamsDialog — 加密/解密参数填写弹框
 * 当算法需要参数时（如 AES 需要 key、iv、mode），弹出此对话框。
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CryptoAlgorithm, CryptoParam } from '@/types/plugin';

interface CryptoParamsDialogProps {
  algorithm: CryptoAlgorithm;
  mode: 'encrypt' | 'decrypt';
  onConfirm: (paramsJson: string) => void;
  onCancel: () => void;
}

export function CryptoParamsDialog({ algorithm, mode, onConfirm, onCancel }: CryptoParamsDialogProps) {
  const params = algorithm.params || [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of params) {
      init[p.paramId] = p.defaultValue || '';
    }
    return init;
  });

  const handleChange = useCallback((paramId: string, value: string) => {
    setValues((prev) => ({ ...prev, [paramId]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    // 校验必填项
    for (const p of params) {
      if (p.required && !values[p.paramId]?.trim()) {
        return; // 必填项为空，不提交
      }
    }
    onConfirm(JSON.stringify(values));
  }, [values, params, onConfirm]);

  const isEncrypt = mode === 'encrypt';
  const Icon = isEncrypt ? Lock : Unlock;
  const iconColor = isEncrypt ? 'text-amber-500' : 'text-emerald-500';
  const btnColor = isEncrypt
    ? 'bg-amber-500 hover:bg-amber-600'
    : 'bg-emerald-500 hover:bg-emerald-600';

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[420px] rounded-2xl border border-border-default bg-bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border-default">
          <Icon className={cn('w-4.5 h-4.5', iconColor)} />
          <div className="flex-1">
            <div className="font-semibold text-text-primary" style={{ fontSize: 'var(--fs-base)' }}>
              {algorithm.name}
            </div>
            <div className="text-text-tertiary" style={{ fontSize: 'var(--fs-xs)' }}>
              {isEncrypt ? '配置加密参数' : '配置解密参数'}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Params */}
        <div className="px-5 py-4 space-y-3.5 max-h-[400px] overflow-y-auto">
          {params.map((param) => (
            <ParamField
              key={param.paramId}
              param={param}
              value={values[param.paramId] || ''}
              onChange={(v) => handleChange(param.paramId, v)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-border-default">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className={cn('px-5 py-2 rounded-lg text-white font-medium transition-colors shadow-sm', btnColor)}
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            {isEncrypt ? '加密' : '解密'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 单个参数字段 */
function ParamField({
  param,
  value,
  onChange,
}: {
  param: CryptoParam;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-text-secondary font-medium" style={{ fontSize: 'var(--fs-xs)' }}>
        {param.name}
        {param.required && <span className="text-red-400">*</span>}
      </label>

      {param.paramType === 'select' && param.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 rounded-lg border border-border-default bg-bg-primary px-3 text-text-primary outline-none focus:border-accent transition-colors"
          style={{ fontSize: 'var(--fs-sm)' }}
        >
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : param.paramType === 'number' ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.placeholder}
          className="w-full h-9 rounded-lg border border-border-default bg-bg-primary px-3 text-text-primary outline-none focus:border-accent transition-colors font-mono"
          style={{ fontSize: 'var(--fs-sm)' }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={param.placeholder}
          className="w-full h-9 rounded-lg border border-border-default bg-bg-primary px-3 text-text-primary outline-none focus:border-accent transition-colors font-mono"
          style={{ fontSize: 'var(--fs-sm)' }}
        />
      )}
    </div>
  );
}
