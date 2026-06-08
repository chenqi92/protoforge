/**
 * CryptoResultDialog — 解密结果展示弹框
 * 展示解密后的内容，可一键复制。
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface CryptoResultDialogProps {
  output: string;
  algorithmName: string;
  onClose: () => void;
}

export function CryptoResultDialog({ output, algorithmName, onClose }: CryptoResultDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const isError = output.startsWith('[Error]');

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-toast)] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[480px] max-h-[80vh] pf-rounded-xl border border-border-strong bg-bg-elevated shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border-default shrink-0">
          <Unlock className={cn('w-4.5 h-4.5', isError ? 'text-error' : 'text-success')} />
          <div className="flex-1">
            <div className="font-semibold text-text-primary" style={{ fontSize: 'var(--fs-base)' }}>
              {isError ? t('crypto.operationFailed', '操作失败') : t('crypto.decryptResult', '解密结果')}
            </div>
            <div className="text-text-tertiary" style={{ fontSize: 'var(--fs-xs)' }}>
              {algorithmName}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
          <pre
            className={cn(
              'whitespace-pre-wrap break-all font-mono leading-relaxed rounded-xl border p-4',
              isError
                ? 'border-error/30 bg-error/5 text-error'
                : 'border-border-default bg-bg-primary text-text-primary',
            )}
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            {isError ? output.replace('[Error] ', '') : output}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-border-default shrink-0">
          {!isError && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white font-medium transition-colors hover:bg-accent-hover shadow-sm"
              style={{ fontSize: 'var(--fs-sm)' }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
            style={{ fontSize: 'var(--fs-sm)' }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
