import { useState } from "react";
import { X, XCircle } from "lucide-react";
import { useTranslation } from 'react-i18next';

export function ResponseMetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="http-response-meta-pill">
      <span className="http-response-meta-label">{label}</span>
      <span className="http-response-meta-value font-mono">{value}</span>
    </span>
  );
}

/** Inline error banner — shown at top of response panel, doesn't replace content */
export function HttpRequestErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-b border-red-500/20 bg-red-500/[0.04]">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/10 shrink-0">
          <XCircle className="h-3 w-3 text-red-500" />
        </div>
        <span className="pf-text-xs font-semibold text-red-600 dark:text-red-400">{t('http.requestFailed')}</span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="pf-text-xxs text-red-500/70 hover:text-red-500 transition-colors"
        >
          {expanded ? t('http.hideDetails', '收起') : t('http.errorDetails')}
        </button>
        <div className="flex-1" />
        <button onClick={onDismiss} className="p-0.5 text-red-400/60 hover:text-red-500 transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <pre className="selectable mx-3 mb-2.5 overflow-auto pf-rounded-md border border-red-500/10 bg-red-500/[0.03] px-3 py-2 pf-text-xxs leading-5 text-red-600/80 dark:text-red-300/80 whitespace-pre-wrap break-all max-h-[120px]">
          {error}
        </pre>
      )}
    </div>
  );
}

/** Full-page error — only shown when there's no previous response at all */
export function HttpRequestErrorPanel({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
        <XCircle className="h-6 w-6 text-red-500" />
      </div>
      <p className="pf-text-lg font-semibold text-text-primary">{t('http.requestFailed')}</p>
      <p className="mt-1.5 max-w-[420px] pf-text-xs leading-5 text-text-secondary">{t('http.requestFailedDesc')}</p>
      <div className="mt-4 w-full max-w-lg overflow-hidden pf-rounded-lg border border-border-default/60 bg-bg-secondary/20 text-left">
        <div className="flex items-center justify-between border-b border-border-default/40 px-3 py-1.5">
          <span className="pf-text-xxs font-semibold text-text-disabled uppercase tracking-wider">{t('http.errorDetails')}</span>
          <button onClick={onDismiss} className="p-0.5 text-text-disabled hover:text-text-primary transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
        <pre className="selectable overflow-auto px-3 py-2.5 pf-text-xs leading-5 text-text-secondary whitespace-pre-wrap break-all max-h-[160px]">
          {error}
        </pre>
      </div>
    </div>
  );
}

export function ResponseHeaderMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="response-summary-card">
      <div className="response-summary-label">{label}</div>
      <div className="response-summary-value">{value}</div>
      {hint ? <div className="response-summary-hint">{hint}</div> : null}
    </div>
  );
}
