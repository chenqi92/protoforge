// 表结构编辑器 — DataGrip 风格，列编辑 + SQL 预览

import { memo, useCallback, useMemo, useState } from "react";
import {
  Plus, Trash2, Loader2, AlertCircle, CheckCircle2,
  ChevronUp, ChevronDown, Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDbClientStoreApi } from "@/stores/dbClientStore";
import type { TableStructureTab } from "@/stores/dbClientStore";
import type { ColumnDetail } from "@/types/dbclient";
import { generateAlterTableSQL } from "@/lib/sqlDialect";
import { DdlCodeView } from "./DdlCodeView";

export const TableStructureEditor = memo(function TableStructureEditor({
  sessionId,
  tab,
}: {
  sessionId: string;
  tab: TableStructureTab;
}) {
  const store = getDbClientStoreApi(sessionId);
  const [showPreview, setShowPreview] = useState(true);

  // 生成 ALTER SQL 预览
  const previewSql = useMemo(() => {
    if (!tab.originalDescription) return "";
    const config = store.getState().connectionConfig;
    if (!config) return "";
    const stmts = generateAlterTableSQL(
      config.dbType, tab.schema, tab.table,
      tab.originalDescription.columns, tab.editedColumns,
      tab.deletedColumns, tab.addedColumns,
    );
    return stmts.join("\n");
  }, [store, tab.schema, tab.table, tab.originalDescription, tab.editedColumns, tab.deletedColumns, tab.addedColumns]);

  const hasChanges = previewSql.length > 0;

  const handleAdd = useCallback(() => store.getState().addStructureColumn(tab.id), [store, tab.id]);
  const handleRemove = useCallback((i: number) => store.getState().removeStructureColumn(tab.id, i), [store, tab.id]);
  const handleMove = useCallback((from: number, to: number) => store.getState().moveStructureColumn(tab.id, from, to), [store, tab.id]);
  const handleUpdate = useCallback((i: number, u: Partial<ColumnDetail>) => store.getState().updateStructureColumn(tab.id, i, u), [store, tab.id]);
  const handleApply = useCallback(() => store.getState().applyStructureChanges(tab.id), [store, tab.id]);
  const handleDiscard = useCallback(() => store.getState().discardStructureChanges(tab.id), [store, tab.id]);

  if (tab.loading && !tab.originalDescription) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-text-tertiary" /></div>;
  }
  if (!tab.originalDescription) {
    return <div className="flex h-full items-center justify-center pf-text-xs text-text-tertiary">无法加载表结构</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border-default/50 px-3 py-1.5 shrink-0">
        <button onClick={handleAdd}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary">
          <Plus size={12} /> 添加列
        </button>

        <div className="flex-1" />

        {tab.applyError && (
          <div className="flex items-center gap-1 pf-text-xs text-red-500 truncate max-w-[300px]">
            <AlertCircle size={12} className="shrink-0" />
            <span className="truncate">{tab.applyError}</span>
          </div>
        )}

        <button onClick={() => setShowPreview(!showPreview)}
          className={cn("flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs transition-colors",
            showPreview ? "bg-accent/10 text-accent" : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary")}>
          <Code2 size={12} /> SQL 预览
        </button>

        <button onClick={handleDiscard} disabled={!hasChanges}
          className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover disabled:opacity-30">
          放弃
        </button>
        <button onClick={handleApply} disabled={!hasChanges || tab.loading}
          className="flex items-center gap-1 pf-rounded-sm px-2.5 py-0.5 pf-text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
          {tab.loading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
          应用修改
        </button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 列编辑表格 */}
        <div className={cn("overflow-auto", showPreview && hasChanges ? "flex-1 min-h-0" : "flex-1")}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-bg-secondary">
              <tr className="border-b border-border-default/50">
                <th className="w-8 px-2 py-1.5 text-center text-text-quaternary font-medium">#</th>
                <th className="px-2 py-1.5 text-left text-text-secondary font-medium min-w-[140px]">列名</th>
                <th className="px-2 py-1.5 text-left text-text-secondary font-medium min-w-[140px]">类型</th>
                <th className="w-14 px-2 py-1.5 text-center text-text-secondary font-medium">可空</th>
                <th className="px-2 py-1.5 text-left text-text-secondary font-medium min-w-[120px]">默认值</th>
                <th className="px-2 py-1.5 text-left text-text-secondary font-medium min-w-[140px]">注释</th>
                <th className="w-20 px-2 py-1.5 text-center text-text-quaternary font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tab.editedColumns.map((col, i) => {
                const isNew = tab.addedColumns.includes(col);
                const orig = tab.originalDescription?.columns.find(c => c.name === col.name);
                const isModified = !isNew && orig && hasColumnDiff(orig, col);
                return (
                  <tr key={i} className={cn(
                    "border-b border-border-default/30 hover:bg-bg-hover/50 transition-colors",
                    isNew && "bg-emerald-500/5",
                    isModified && "bg-amber-500/5",
                  )}>
                    <td className="px-2 py-0.5 text-center text-text-quaternary tabular-nums">
                      {col.isPrimaryKey && <span className="text-amber-500" title="Primary Key">🔑</span>}
                      {!col.isPrimaryKey && (i + 1)}
                    </td>
                    <td className="px-1 py-0.5">
                      <input value={col.name} onChange={e => handleUpdate(i, { name: e.target.value })}
                        className="w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-bg-secondary rounded text-text-primary font-mono outline-none" />
                    </td>
                    <td className="px-1 py-0.5">
                      <input value={col.dataType} onChange={e => handleUpdate(i, { dataType: e.target.value })}
                        className="w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-bg-secondary rounded text-text-primary font-mono outline-none" />
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      <input type="checkbox" checked={col.nullable} onChange={e => handleUpdate(i, { nullable: e.target.checked })}
                        className="h-3.5 w-3.5 rounded cursor-pointer" />
                    </td>
                    <td className="px-1 py-0.5">
                      <input value={col.defaultValue ?? ""} onChange={e => handleUpdate(i, { defaultValue: e.target.value || null })}
                        placeholder="NULL"
                        className="w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-bg-secondary rounded text-text-primary font-mono outline-none placeholder:text-text-quaternary" />
                    </td>
                    <td className="px-1 py-0.5">
                      <input value={col.comment ?? ""} onChange={e => handleUpdate(i, { comment: e.target.value || null })}
                        className="w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-border-default focus:border-accent focus:bg-bg-secondary rounded text-text-primary outline-none" />
                    </td>
                    <td className="px-1 py-0.5">
                      <div className="flex items-center justify-center gap-0.5">
                        {i > 0 && (
                          <button onClick={() => handleMove(i, i - 1)} className="p-0.5 text-text-quaternary hover:text-text-primary rounded hover:bg-bg-hover">
                            <ChevronUp size={11} />
                          </button>
                        )}
                        {i < tab.editedColumns.length - 1 && (
                          <button onClick={() => handleMove(i, i + 1)} className="p-0.5 text-text-quaternary hover:text-text-primary rounded hover:bg-bg-hover">
                            <ChevronDown size={11} />
                          </button>
                        )}
                        <button onClick={() => handleRemove(i)} className="p-0.5 text-text-quaternary hover:text-red-500 rounded hover:bg-red-500/10"
                          title="删除列">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* SQL 预览 */}
        {showPreview && hasChanges && (
          <>
            <div className="shrink-0 border-t border-border-default/50 px-3 py-1 bg-bg-secondary/50">
              <span className="pf-text-xs font-medium text-text-secondary">SQL 预览</span>
            </div>
            <div className="h-[160px] shrink-0 border-t border-border-default/30">
              <DdlCodeView text={previewSql} showToolbar={false} />
            </div>
          </>
        )}
      </div>
    </div>
  );
});

function hasColumnDiff(a: ColumnDetail, b: ColumnDetail): boolean {
  return a.name !== b.name || a.dataType !== b.dataType
    || a.nullable !== b.nullable || a.defaultValue !== b.defaultValue
    || a.comment !== b.comment;
}
