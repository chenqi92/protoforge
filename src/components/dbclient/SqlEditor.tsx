// SQL 编辑器 — 统一 Tab 栏（Query + Table）+ Monaco 方言 + Schema 补全
// 包含数据库选择器、SQL 关键字补全

import { memo, useCallback, useRef, useEffect } from "react";
import {
  Play, Square, Loader2, Clock, AlertCircle, CheckCircle2,
  Wand2, Plus, X, Table2, FileText, Database,
  Copy, ClipboardPaste, Search, Pencil,
  ArrowLeftFromLine, ArrowRightFromLine,
} from "lucide-react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatSql } from "@/lib/sqlFormatter";
import { getMonacoLanguage, getDbKeywords } from "@/lib/sqlDialect";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";

// ── SQL 标准关键字 ──
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP",
  "TABLE", "INDEX", "VIEW", "DATABASE", "SCHEMA", "INTO", "VALUES", "SET",
  "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "CROSS", "ON", "AS", "AND", "OR", "NOT",
  "IN", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL", "TRUE", "FALSE",
  "ORDER", "BY", "ASC", "DESC", "GROUP", "HAVING", "LIMIT", "OFFSET",
  "UNION", "ALL", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END",
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT",
  "CONSTRAINT", "IF", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION",
  "GRANT", "REVOKE", "TRUNCATE", "EXPLAIN", "ANALYZE", "WITH", "RECURSIVE",
];

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
  const databases = useDbClientStore(sessionId, (s) => s.databases);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);

  const completionDisposableRef = useRef<{ dispose(): void } | null>(null);
  const editorRef = useRef<{ getValue(): string; getSelection(): { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } | null; getModel(): { getValueInRange(range: unknown): string } | null } | null>(null);
  const { showMenu: showEditorMenu, MenuComponent: EditorMenuComponent } = useContextMenu();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isQueryTab = activeTab?.kind === "query";
  const monacoLanguage = getMonacoLanguage(connectionConfig?.dbType);

  // ── Monaco 补全注册 ──
  const registerCompletionProvider = useCallback((monaco: Monaco) => {
    completionDisposableRef.current?.dispose();

    const disposable = monaco.languages.registerCompletionItemProvider(monacoLanguage, {
      triggerCharacters: [".", " "],
      provideCompletionItems: (_model: unknown, position: { lineNumber: number; column: number }) => {
        const store = getDbClientStoreApi(sessionId);
        const schema = store.getState().schemaObjects;

        const model = _model as { getWordUntilPosition(pos: { lineNumber: number; column: number }): { startColumn: number; endColumn: number } };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: languages.CompletionItem[] = [];

        // SQL 标准关键字
        for (const kw of SQL_KEYWORDS) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: `2_${kw}`, // 排在表名后面
          });
        }

        // 数据库特有关键字
        for (const kw of getDbKeywords(connectionConfig?.dbType)) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: `2_${kw}`,
          });
        }

        if (!schema) return { suggestions };

        // 表名补全
        for (const tbl of schema.tables) {
          suggestions.push({
            label: tbl.name,
            kind: monaco.languages.CompletionItemKind.Struct,
            detail: tbl.comment || t("dbClient.tables"),
            insertText: tbl.name,
            range,
            sortText: `0_${tbl.name}`, // 排在最前
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
            sortText: `0_${v.name}`,
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
            sortText: `1_${fn.name}`,
          });
        }

        return { suggestions };
      },
    });

    completionDisposableRef.current = disposable;
  }, [sessionId, monacoLanguage, connectionConfig?.dbType, t]);

  useEffect(() => {
    return () => { completionDisposableRef.current?.dispose(); };
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

  const { showMenu: showTabMenu, MenuComponent: TabMenuComponent } = useContextMenu();

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    const store = getDbClientStoreApi(sessionId).getState();
    const currentTabs = store.tabs;
    const tabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    const items: ContextMenuEntry[] = [
      {
        id: "close",
        label: t("tabBar.close"),
        onClick: () => store.closeTab(tabId),
      },
      {
        id: "close-others",
        label: t("tabBar.closeOthers"),
        onClick: () => store.closeOtherTabs(tabId),
        disabled: currentTabs.length <= 1,
      },
      { type: "divider" },
      {
        id: "close-left",
        label: t("tabBar.closeLeft"),
        icon: <ArrowLeftFromLine size={12} />,
        onClick: () => store.closeTabsToLeft(tabId),
        disabled: tabIndex === 0,
      },
      {
        id: "close-right",
        label: t("tabBar.closeRight"),
        icon: <ArrowRightFromLine size={12} />,
        onClick: () => store.closeTabsToRight(tabId),
        disabled: tabIndex === currentTabs.length - 1,
      },
    ];
    showTabMenu(e, items);
  }, [sessionId, t, showTabMenu]);

  const handleSwitchTab = useCallback((tabId: string) => {
    getDbClientStoreApi(sessionId).getState().setActiveTab(tabId);
  }, [sessionId]);

  const handleSelectDatabase = useCallback((db: string) => {
    getDbClientStoreApi(sessionId).getState().selectDatabase(db);
  }, [sessionId]);

  // 获取选中文本
  const getSelectedText = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return "";
    const sel = ed.getSelection();
    if (!sel) return "";
    const model = ed.getModel();
    if (!model) return "";
    return model.getValueInRange(sel).trim();
  }, []);

  // 执行选中的 SQL
  const executeSelection = useCallback(() => {
    const sel = getSelectedText();
    if (!sel) return;
    const store = getDbClientStoreApi(sessionId);
    store.getState().setSqlText(sel);
    store.getState().executeQuery();
  }, [sessionId, getSelectedText]);

  // EXPLAIN 查询
  const explainQuery = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    const sel = getSelectedText() || store.getState().sqlText.trim();
    if (!sel) return;
    store.getState().addQueryTab("EXPLAIN", `EXPLAIN ${sel}`);
    store.getState().executeQuery();
  }, [sessionId, getSelectedText]);

  // 编辑器右键菜单
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sel = getSelectedText();
    const items: ContextMenuEntry[] = [
      { id: "copy", label: t("contextMenu.copy") || "Copy", icon: <Copy size={13} />, shortcut: "⌘C",
        disabled: !sel, onClick: () => { if (sel) copyTextToClipboard(sel); } },
      { id: "paste", label: t("contextMenu.paste") || "Paste", icon: <ClipboardPaste size={13} />, shortcut: "⌘V",
        onClick: async () => {
          const text = await navigator.clipboard.readText();
          const ed = editorRef.current as { trigger?(source: string, handlerId: string, payload: unknown): void } | null;
          if (ed?.trigger) ed.trigger("keyboard", "type", { text });
        } },
      { type: "divider" },
      { id: "exec-sel", label: t("dbClient.executeSelection"), icon: <Play size={13} />,
        disabled: !sel, onClick: executeSelection },
      { id: "explain", label: t("dbClient.explain"), icon: <Search size={13} />,
        onClick: explainQuery },
      { type: "divider" },
      { id: "format", label: t("dbClient.formatSql"), icon: <Wand2 size={13} />,
        onClick: handleFormat },
    ];
    showEditorMenu(e, items);
  }, [t, getSelectedText, executeSelection, explainQuery, handleFormat, showEditorMenu]);

  // 自动创建第一个 query tab
  if (tabs.filter((t) => t.kind === "query").length === 0 && connected) {
    getDbClientStoreApi(sessionId).getState().addQueryTab();
  }

  return (
    <div className={cn("flex flex-col", isQueryTab && "h-full")}>
      {/* 统一 Tab 栏 */}
      <div className="flex items-center border-b border-border-default/50 bg-bg-base shrink-0">
        <div className="flex flex-1 items-center overflow-x-auto min-w-0 scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSwitchTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); getDbClientStoreApi(sessionId).getState().closeTab(tab.id); } }}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1.5 pf-text-xs font-medium border-b-2 transition-colors shrink-0 max-w-[180px]",
                tab.id === activeTabId
                  ? "border-accent text-accent bg-bg-surface"
                  : "border-transparent text-text-tertiary hover:text-text-primary hover:bg-bg-hover/50",
              )}
            >
              {tab.kind === "structure" ? (
                <Pencil size={11} className="shrink-0 text-amber-500 dark:text-amber-300" />
              ) : tab.kind === "query" ? (
                <FileText size={11} className="shrink-0 opacity-60" />
              ) : (
                <Table2 size={11} className="shrink-0 text-blue-500 dark:text-blue-300" />
              )}
              <span className="truncate">{tab.label}</span>
              {tab.kind === "query" && tab.queryRunning && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              {tab.kind === "table" && tab.tableDataLoading && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              {tab.kind === "structure" && tab.loading && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              <span
                onClick={(e) => handleCloseTab(tab.id, e)}
                className={cn(
                  "shrink-0 p-0.5 pf-rounded-sm hover:bg-bg-hover transition-opacity",
                  tab.id === activeTabId ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={10} />
              </span>
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

      {/* Query Tab 内容 */}
      {isQueryTab && (
        <>
          {/* 工具栏 */}
          <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 shrink-0">
            <button
              onClick={queryRunning ? handleCancel : handleExecute}
              disabled={!connected}
              className={cn(
                "flex items-center gap-1.5 pf-rounded-sm px-3 py-1 pf-text-xs font-medium transition-colors",
                queryRunning
                  ? "bg-red-500/15 text-red-600 dark:text-red-300 hover:bg-red-500/25"
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

            {/* 数据库选择器 */}
            {databases.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <Database size={11} className="text-text-tertiary" />
                <select
                  value={selectedDatabase ?? ""}
                  onChange={(e) => handleSelectDatabase(e.target.value)}
                  className="pf-rounded-sm border border-border-default bg-bg-secondary px-1.5 py-0.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none max-w-[140px]"
                >
                  {databases.map((db) => (
                    <option key={db.name} value={db.name}>{db.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 结果状态 */}
            {queryResult && !queryRunning && (
              <div className="flex items-center gap-1.5 pf-text-xs text-text-tertiary">
                <CheckCircle2 size={12} className="text-emerald-500 dark:text-emerald-300" />
                {queryResult.rows.length} {t("dbClient.rows")}
                <span className="text-text-quaternary">·</span>
                <Clock size={11} />
                {queryResult.executionTimeMs}ms
              </div>
            )}

            {queryError && !queryRunning && (
              <div className="flex items-center gap-1.5 pf-text-xs text-red-500 dark:text-red-300 truncate min-w-0">
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

            {/* 右侧工具 */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleFormat}
                disabled={!connected}
                className="flex items-center gap-1 pf-rounded-sm px-2 py-1 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                title={t("dbClient.formatSql")}
              >
                <Wand2 size={12} />
              </button>
            </div>
          </div>

          {/* Monaco 编辑器 */}
          <div className="flex-1 min-h-0" onContextMenu={handleEditorContextMenu}>
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
                quickSuggestions: true,
                contextmenu: false, // 禁用默认右键菜单
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor as typeof editorRef.current;
                // Ctrl/Cmd + Enter 执行
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
                registerCompletionProvider(monaco);
              }}
            />
          </div>
        </>
      )}

      {/* 右键菜单 */}
      {EditorMenuComponent}
      {TabMenuComponent}
    </div>
  );
});
