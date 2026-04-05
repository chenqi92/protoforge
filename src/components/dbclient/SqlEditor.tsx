// SQL 编辑器 — 统一 Tab 栏（Query + Table）+ Monaco 方言 + Schema 补全

import { memo, useCallback, useState, useRef, useEffect } from "react";
import {
  Play, Square, Loader2, Clock, AlertCircle, CheckCircle2,
  Download, Upload, Wand2, Plus, X, Table2, FileText,
} from "lucide-react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import { useThemeStore } from "@/stores/themeStore";
import { ImportExportDialog } from "./ImportExportDialog";
import { formatSql } from "@/lib/sqlFormatter";
import { getMonacoLanguage, getDbKeywords } from "@/lib/sqlDialect";

export const SqlEditor = memo(function SqlEditor({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const { resolved: theme } = useThemeStore();
  const tabs = useDbClientStore(sessionId, (s) => s.tabs);
  const activeTabId = useDbClientStore(sessionId, (s) => s.activeTabId);
  const sqlText = useDbClientStore(sessionId, (s) => s.sqlText);
  const queryRunning = useDbClientStore(sessionId, (s) => s.queryRunning);
  const queryResult = useDbClientStore(sessionId, (s) => s.queryResult);
  const queryError = useDbClientStore(sessionId, (s) => s.queryError);
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const connectionConfig = useDbClientStore(sessionId, (s) => s.connectionConfig);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);

  const [showImportExport, setShowImportExport] = useState(false);
  const completionDisposableRef = useRef<{ dispose(): void } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isQueryTab = activeTab?.kind === "query";
  const monacoLanguage = getMonacoLanguage(connectionConfig?.dbType);

  // ── Monaco 补全注册 ──
  const registerCompletionProvider = useCallback((monaco: Monaco) => {
    // 先清理旧的
    completionDisposableRef.current?.dispose();

    const disposable = monaco.languages.registerCompletionItemProvider(monacoLanguage, {
      triggerCharacters: ["."],
      provideCompletionItems: (_model: unknown, position: { lineNumber: number; column: number }) => {
        const store = getDbClientStoreApi(sessionId);
        const schema = store.getState().schemaObjects;
        if (!schema) return { suggestions: [] };

        const model = _model as { getWordUntilPosition(pos: { lineNumber: number; column: number }): { startColumn: number; endColumn: number } };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: languages.CompletionItem[] = [];

        // 表名补全
        for (const tbl of schema.tables) {
          suggestions.push({
            label: tbl.name,
            kind: monaco.languages.CompletionItemKind.Struct,
            detail: tbl.comment || t("dbClient.tables"),
            insertText: tbl.name,
            range,
          });
        }

        // 视图名补全
        for (const v of schema.views) {
          suggestions.push({
            label: v.name,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: v.comment || t("dbClient.views"),
            insertText: v.name,
            range,
          });
        }

        // 函数名补全
        for (const fn of schema.functions) {
          suggestions.push({
            label: fn.name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: fn.returnType ? `→ ${fn.returnType}` : t("dbClient.functions"),
            insertText: `${fn.name}()`,
            range,
          });
        }

        // 数据库特有关键字补全
        for (const kw of getDbKeywords(connectionConfig?.dbType)) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
          });
        }

        return { suggestions };
      },
    });

    completionDisposableRef.current = disposable;
  }, [sessionId, monacoLanguage, connectionConfig?.dbType, t]);

  // 清理补全 provider
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
    };
  }, []);

  const handleExecute = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().executeQuery();
  }, [sessionId]);

  const handleCancel = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().cancelQuery();
  }, [sessionId]);

  const handleFormat = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    const current = store.getState().sqlText;
    if (current.trim()) {
      store.getState().setSqlText(formatSql(current));
    }
  }, [sessionId]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    getDbClientStoreApi(sessionId).getState().setSqlText(value ?? "");
  }, [sessionId]);

  const handleAddTab = useCallback(() => {
    getDbClientStoreApi(sessionId).getState().addQueryTab();
  }, [sessionId]);

  const handleCloseTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    getDbClientStoreApi(sessionId).getState().closeTab(tabId);
  }, [sessionId]);

  const handleSwitchTab = useCallback((tabId: string) => {
    getDbClientStoreApi(sessionId).getState().setActiveTab(tabId);
  }, [sessionId]);

  // 自动创建第一个 query tab
  if (tabs.filter((t) => t.kind === "query").length === 0 && connected) {
    getDbClientStoreApi(sessionId).getState().addQueryTab();
  }

  return (
    <div className="flex h-full flex-col">
      {/* 统一 Tab 栏 */}
      <div className="flex items-center border-b border-border-default/50 bg-bg-base">
        <div className="flex flex-1 items-center overflow-x-auto min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSwitchTab(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium border-b-2 transition-colors shrink-0 max-w-[180px]",
                tab.id === activeTabId
                  ? "border-accent text-accent bg-bg-surface"
                  : "border-transparent text-text-tertiary hover:text-text-primary hover:bg-bg-hover/50",
              )}
            >
              {tab.kind === "query" ? (
                <FileText size={11} className="shrink-0 opacity-60" />
              ) : (
                <Table2 size={11} className="shrink-0 text-blue-500" />
              )}
              <span className="truncate">{tab.label}</span>
              {tab.kind === "query" && tab.queryRunning && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              {tab.kind === "table" && tab.tableDataLoading && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              {tabs.length > 1 && (
                <span
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="shrink-0 p-0.5 pf-rounded-sm opacity-0 group-hover:opacity-100 hover:bg-bg-hover transition-opacity"
                >
                  <X size={10} />
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={handleAddTab}
          disabled={!connected}
          className="shrink-0 p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30"
          title={t("dbClient.newQueryTab")}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Query Tab 内容：工具栏 + 编辑器 */}
      {isQueryTab && (
        <>
          {/* 工具栏 */}
          <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5">
            <button
              onClick={queryRunning ? handleCancel : handleExecute}
              disabled={!connected}
              className={cn(
                "flex items-center gap-1.5 pf-rounded-sm px-3 py-1 pf-text-xs font-medium transition-colors",
                queryRunning
                  ? "bg-red-500/15 text-red-600 hover:bg-red-500/25"
                  : "bg-accent/15 text-accent hover:bg-accent/25",
                !connected && "opacity-40 cursor-not-allowed",
              )}
            >
              {queryRunning ? (
                <><Square size={12} />{t("dbClient.stop")}</>
              ) : (
                <><Play size={12} />{t("dbClient.execute")}</>
              )}
            </button>

            {queryResult && !queryRunning && (
              <div className="flex items-center gap-1.5 pf-text-xs text-text-tertiary">
                <CheckCircle2 size={12} className="text-emerald-500" />
                {queryResult.rows.length} {t("dbClient.rows")}
                <span className="text-text-quaternary">·</span>
                <Clock size={11} />
                {queryResult.executionTimeMs}ms
              </div>
            )}

            {queryError && !queryRunning && (
              <div className="flex items-center gap-1.5 pf-text-xs text-red-500 truncate min-w-0">
                <AlertCircle size={12} className="shrink-0" />
                <span className="truncate">{queryError}</span>
              </div>
            )}

            {queryRunning && (
              <div className="flex items-center gap-1.5 pf-text-xs text-text-tertiary">
                <Loader2 size={12} className="animate-spin" />
                {t("dbClient.executing")}
              </div>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleFormat}
                disabled={!connected}
                className="flex items-center gap-1 pf-rounded-sm px-2 py-1 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                title={t("dbClient.formatSql")}
              >
                <Wand2 size={12} />
              </button>
              <button
                onClick={() => setShowImportExport(true)}
                disabled={!connected}
                className="flex items-center gap-1 pf-rounded-sm px-2 py-1 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                title={t("dbClient.importExport")}
              >
                <Download size={12} />
                <Upload size={12} />
              </button>
            </div>
          </div>

          {/* Monaco 编辑器 */}
          <div className="flex-1 min-h-0">
            <Editor
              language={monacoLanguage}
              theme={theme === "dark" ? "vs-dark" : "light"}
              value={sqlText}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                tabSize: 2,
                padding: { top: 8 },
                suggest: { showKeywords: true },
              }}
              onMount={(editor, monaco) => {
                // Ctrl/Cmd + Enter 执行查询
                editor.addAction({
                  id: "execute-query",
                  label: "Execute Query",
                  keybindings: [2048 | 3],
                  run: () => {
                    const store = getDbClientStoreApi(sessionId);
                    const state = store.getState();
                    if (state.connected && !state.queryRunning) {
                      state.executeQuery();
                    }
                  },
                });
                // 注册补全 provider
                registerCompletionProvider(monaco);
              }}
            />
          </div>
        </>
      )}

      {/* Table tab 的内容不在这里渲染，由 DbClientWorkspace 处理 */}

      {/* 导入导出对话框 */}
      <ImportExportDialog
        open={showImportExport}
        onClose={() => setShowImportExport(false)}
        sessionId={sessionId}
        connectionConfig={connectionConfig}
        selectedDatabase={selectedDatabase}
      />
    </div>
  );
});
