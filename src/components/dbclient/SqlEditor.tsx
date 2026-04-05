// SQL 编辑器 — Monaco + 工具栏 + 结果面板

import { memo, useCallback, useRef, useState } from "react";
import { Play, Square, FileText, Loader2, Clock, AlertCircle, CheckCircle2, Download, Upload, Wand2 } from "lucide-react";
import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useDbClientStore, getDbClientStoreApi } from "@/stores/dbClientStore";
import { useThemeStore } from "@/stores/themeStore";
import { sqlValueDisplay } from "@/types/dbclient";
import { ImportExportDialog } from "./ImportExportDialog";
import { formatSql } from "@/lib/sqlFormatter";

export const SqlEditor = memo(function SqlEditor({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const { resolved: theme } = useThemeStore();
  const sqlText = useDbClientStore(sessionId, (s) => s.sqlText);
  const queryRunning = useDbClientStore(sessionId, (s) => s.queryRunning);
  const queryResult = useDbClientStore(sessionId, (s) => s.queryResult);
  const queryError = useDbClientStore(sessionId, (s) => s.queryError);
  const connected = useDbClientStore(sessionId, (s) => s.connected);
  const connectionConfig = useDbClientStore(sessionId, (s) => s.connectionConfig);
  const selectedDatabase = useDbClientStore(sessionId, (s) => s.selectedDatabase);

  const [showImportExport, setShowImportExport] = useState(false);

  const handleExecute = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().executeQuery();
  }, [sessionId]);

  const handleCancel = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().cancelQuery();
  }, [sessionId]);

  const handleFormat = useCallback(() => {
    const store = getDbClientStoreApi(sessionId);
    const current = store.getState().sqlText;
    if (current.trim()) {
      store.getState().setSqlText(formatSql(current));
    }
  }, [sessionId]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    const store = getDbClientStoreApi(sessionId);
    store.getState().setSqlText(value ?? "");
  }, [sessionId]);

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5">
        <button
          onClick={queryRunning ? handleCancel : handleExecute}
          disabled={!connected}
          className={cn(
            "flex items-center gap-1.5 pf-rounded-sm px-3 py-1 pf-text-xs font-medium transition-colors",
            queryRunning
              ? "bg-red-500/15 text-red-600 hover:bg-red-500/25"
              : "bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25",
            !connected && "opacity-40 cursor-not-allowed",
          )}
        >
          {queryRunning ? (
            <>
              <Square size={12} />
              {t("dbClient.stop")}
            </>
          ) : (
            <>
              <Play size={12} />
              {t("dbClient.execute")}
            </>
          )}
        </button>

        {/* 结果状态 */}
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

        {/* 右侧工具按钮 */}
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
          language="sql"
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
          onMount={(editor) => {
            // Ctrl/Cmd + Enter 执行查询
            editor.addAction({
              id: "execute-query",
              label: "Execute Query",
              keybindings: [
                // monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter
                2048 | 3,
              ],
              run: () => {
                const store = getDbClientStoreApi(sessionId);
                const state = store.getState();
                if (state.connected && !state.queryRunning) {
                  state.executeQuery();
                }
              },
            });
          }}
        />
      </div>

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
