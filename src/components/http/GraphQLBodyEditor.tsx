import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, RefreshCw, BookOpen, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import { JsonEditorLite } from "@/components/common/JsonEditorLite";
import { useGraphQLSchemaStore } from "@/stores/graphqlSchemaStore";
import { registerGraphQLProviders, setGraphQLSchema } from "@/lib/graphqlMonaco";
import { GraphQLExplorer } from "./GraphQLExplorer";

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
  endpointUrl,
  requestHeaders,
}: {
  query: string;
  variables: string;
  onQueryChange: (value: string) => void;
  onVariablesChange: (value: string) => void;
  endpointUrl?: string;
  requestHeaders?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [showExplorer, setShowExplorer] = useState(false);
  const monacoRegistered = useRef(false);
  const trimmedVariables = variables.trim();
  const hasVariables = trimmedVariables.length > 0 && trimmedVariables !== "{}";

  // Schema store
  const fetchSchema = useGraphQLSchemaStore((s) => s.fetchSchema);
  const schema = useGraphQLSchemaStore((s) => endpointUrl ? s.getSchema(endpointUrl) : null);
  const schemaLoading = useGraphQLSchemaStore((s) => endpointUrl ? s.isLoading(endpointUrl) : false);
  const schemaError = useGraphQLSchemaStore((s) => endpointUrl ? s.getError(endpointUrl) : null);

  // Sync schema to Monaco autocomplete provider
  useEffect(() => {
    setGraphQLSchema(schema);
  }, [schema]);

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

  const handleFetchSchema = useCallback(() => {
    if (endpointUrl) {
      fetchSchema(endpointUrl, requestHeaders);
    }
  }, [endpointUrl, requestHeaders, fetchSchema]);

  // Register Monaco providers on first editor mount
  const handleEditorMount = useCallback((_editor: any, monaco: any) => {
    if (!monacoRegistered.current) {
      registerGraphQLProviders(monaco);
      monacoRegistered.current = true;
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Schema toolbar */}
      {endpointUrl && (
        <div className="flex items-center gap-2 shrink-0 px-1">
          <button
            onClick={handleFetchSchema}
            disabled={schemaLoading || !endpointUrl}
            className={cn("wb-ghost-btn inline-flex items-center gap-1.5 pf-text-xs", schemaLoading && "opacity-50")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", schemaLoading && "animate-spin")} />
            {schemaLoading ? t('http.graphql.schemaLoading') : schema ? t('http.graphql.schemaRefresh') : t('http.graphql.schemaFetch')}
          </button>
          {schema && (
            <>
              <span className="pf-text-xxs text-emerald-500 dark:text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {t('http.graphql.schemaLoaded')}
              </span>
              <button
                onClick={() => setShowExplorer((v) => !v)}
                className={cn("wb-ghost-btn inline-flex items-center gap-1.5 pf-text-xs", showExplorer && "text-accent")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t('http.graphql.explorer.title')}
              </button>
            </>
          )}
          {schemaError && (
            <span className="pf-text-xxs text-red-500 dark:text-red-300 flex items-center gap-1 truncate max-w-[300px]" title={schemaError}>
              <AlertCircle className="h-3 w-3 shrink-0" />
              {schemaError}
            </span>
          )}
        </div>
      )}

      <div className={cn(
        "grid min-h-0 flex-1 gap-3",
        showExplorer && schema
          ? "xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)_minmax(280px,0.6fr)]"
          : "xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]"
      )}>
        {/* Query editor */}
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
              onMount={handleEditorMount}
            />
          </div>
        </div>

        {/* Variables editor */}
        <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
          <div className="wb-panel-header shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="pf-text-sm font-semibold text-text-primary">Variables</span>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 pf-text-xxs font-semibold",
                  variableState.valid
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : "bg-red-500/10 text-red-500 dark:text-red-300"
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

        {/* Schema Explorer panel */}
        {showExplorer && schema && (
          <div className="wb-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden">
            <GraphQLExplorer
              schema={schema}
              onClose={() => setShowExplorer(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
