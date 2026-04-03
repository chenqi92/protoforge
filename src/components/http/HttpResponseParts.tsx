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

export function HttpRequestErrorPanel({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="http-response-head shrink-0">
        <div className="http-response-tabs scrollbar-hide">
          <span className="http-response-tab is-active">{t('http.errorResult')}</span>
        </div>

        <div className="http-response-meta">
          <span className="http-response-status border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
            <span className="http-response-status-dot bg-red-500" />
            {t('http.requestFailed')}
          </span>
          <button type="button" onClick={onDismiss} className="wb-icon-btn" title={t('common.delete')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-bg-primary px-6 py-6">
        <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-red-200/80 bg-red-50 text-red-500 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
            <XCircle className="h-8 w-8" />
          </div>
          <p className="pf-text-3xl font-semibold text-text-primary">{t('http.requestFailed')}</p>
          <p className="mt-2 max-w-[520px] pf-text-sm leading-6 text-text-secondary">
            {t('http.requestFailedDesc')}
          </p>

          <div className="mt-5 w-full overflow-hidden pf-rounded-xl border border-border-default/80 bg-bg-secondary/30 text-left">
            <div className="border-b border-border-default/80 px-4 py-2 pf-text-xs font-semibold uppercase tracking-[0.08em] text-text-disabled">
              {t('http.errorDetails')}
            </div>
            <pre className="selectable overflow-auto px-4 py-4 pf-text-sm leading-6 text-text-secondary whitespace-pre-wrap break-all">
              {error}
            </pre>
          </div>
        </div>
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
