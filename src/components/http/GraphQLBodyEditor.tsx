import { lazy, Suspense, useCallback, useMemo } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { JsonEditorLite } from "@/components/common/JsonEditorLite";

const LazyMonacoCodeEditor = lazy(() => import("@/components/common/CodeEditor").then((module) => ({ default: module.CodeEditor })));

function EditorSurfaceFallback({ label = "加载编辑器..." }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-bg-input/88 px-4">
      <div className="flex items-center gap-2 pf-text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function MonacoEditorSurface({
  value,
  onChange,
  language,
  onMount,
  readOnly = false,
  height = "100%",
  stickyScroll = true,
}: {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  onMount?: (editor: any, monaco: any) => void;
  readOnly?: boolean;
  height?: string;
  stickyScroll?: boolean;
}) {
  return (
    <Suspense fallback={<EditorSurfaceFallback />}>
      <LazyMonacoCodeEditor
        value={value}
        onChange={onChange}
        language={language}
        onMount={onMount}
        readOnly={readOnly}
        height={height}
        stickyScroll={stickyScroll}
      />
    </Suspense>
  );
}

export { EditorSurfaceFallback };

export function GraphQLBodyEditor({
  query,
  variables,
  onQueryChange,
  onVariablesChange,
}: {
  query: string;
  variables: string;
  onQueryChange: (value: string) => void;
  onVariablesChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const trimmedVariables = variables.trim();
  const hasVariables = trimmedVariables.length > 0 && trimmedVariables !== "{}";
  const variableState = useMemo(() => {
    if (!trimmedVariables) {
      return { valid: true, label: t('http.graphql.variablesOptional'), detail: t('http.graphql.variablesOptionalDetail') };
    }

    try {
      const parsed = JSON.parse(variables);
      const count = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).length
        : 0;
      return {
        valid: true,
        label: count > 0 ? t('http.graphql.variablesCount', { count }) : t('http.graphql.variablesValid'),
        detail: count > 0 ? t('http.graphql.variablesValidDetail') : t('http.graphql.variablesValidEmpty'),
      };
    } catch {
      return {
        valid: false,
        label: t('http.graphql.variablesInvalid'),
        detail: t('http.graphql.variablesInvalidDetail'),
      };
    }
  }, [trimmedVariables, variables]);

  const handleInsertTemplate = useCallback(() => {
    if (!query.trim()) {
      onQueryChange(
        [
          "query ExampleQuery($id: ID!) {",
          "  user(id: $id) {",
          "    id",
          "    name",
          "    email",
          "  }",
          "}",
        ].join("\n")
      );
    }

    if (!trimmedVariables) {
      onVariablesChange('{\n  "id": "123"\n}');
    }
  }, [onQueryChange, onVariablesChange, query, trimmedVariables]);

  const handleFormatVariables = useCallback(() => {
    if (!trimmedVariables) {
      onVariablesChange("{\n  \n}");
      return;
    }

    try {
      const parsed = JSON.parse(variables);
      onVariablesChange(JSON.stringify(parsed, null, 2));
    } catch {
      // Keep current text when invalid; header already highlights the issue.
    }
  }, [onVariablesChange, trimmedVariables, variables]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div>
              <div className="pf-text-sm font-semibold text-text-primary">Query</div>
              <div className="mt-1 pf-text-xs text-text-tertiary">{t('http.graphql.queryDesc')}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="wb-tool-chip">GraphQL</span>
              <button onClick={handleInsertTemplate} className="wb-ghost-btn">
                {t('http.graphql.insertTemplate')}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default/60 bg-bg-input/88">
            <MonacoEditorSurface
              value={query}
              onChange={onQueryChange}
              language="graphql"
            />
          </div>
        </div>

        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="pf-text-sm font-semibold text-text-primary">Variables</span>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 pf-text-xxs font-semibold",
                  variableState.valid
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-red-500/10 text-red-500"
                )}>
                  {variableState.valid ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {variableState.label}
                </span>
              </div>
              <div className="mt-1 pf-text-xs text-text-tertiary">{variableState.detail}</div>
            </div>
            <div className="flex items-center gap-2">
              {hasVariables ? <span className="wb-tool-chip">JSON</span> : null}
              <button onClick={handleFormatVariables} className="wb-ghost-btn">
                {t('http.graphql.formatVariables')}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default/60 bg-bg-input/88">
            <JsonEditorLite
              value={variables}
              onChange={onVariablesChange}
              className="h-full bg-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
