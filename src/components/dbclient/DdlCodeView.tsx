// DDL 代码视图 — DataGrip 风格，带行号和语法高亮

import { memo, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";

// SQL 关键字高亮
const SQL_KEYWORDS = new Set([
  "create", "table", "view", "index", "function", "trigger", "procedure",
  "alter", "drop", "select", "from", "where", "and", "or", "not", "null",
  "default", "primary", "key", "unique", "constraint", "references",
  "foreign", "check", "on", "delete", "update", "cascade", "set",
  "int", "integer", "bigint", "smallint", "tinyint", "serial", "bigserial",
  "varchar", "char", "text", "boolean", "bool", "date", "time", "timestamp",
  "datetime", "float", "double", "decimal", "numeric", "real",
  "auto_increment", "autoincrement", "if", "exists", "comment",
  "engine", "charset", "collate", "unsigned", "not", "using",
  "partition", "tablespace", "add", "column", "modify", "rename", "to",
  "type", "after", "before", "first",
]);

const SQL_VALUES = new Set(["true", "false", "null", "current_timestamp"]);

export const DdlCodeView = memo(function DdlCodeView({ text, showToolbar = true }: { text: string; showToolbar?: boolean }) {
  const [copied, setCopied] = useState(false);
  const lines = text.split("\n");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <div className="flex h-full flex-col bg-bg-base">
      {showToolbar && (
        <div className="flex items-center justify-end px-3 py-1 border-b border-border-default/30 shrink-0">
          <button onClick={handleCopy}
            className="flex items-center gap-1 pf-rounded-sm px-2 py-0.5 pf-text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[12px] leading-[20px]">
        <table className="border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-bg-hover/50">
                <td className="select-none text-right pr-4 pl-3 text-text-quaternary/60 w-[1%] whitespace-nowrap align-top">
                  {i + 1}
                </td>
                <td className="pr-4 text-text-primary whitespace-pre">
                  <DdlLine line={line} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

function DdlLine({ line }: { line: string }) {
  if (line.trimStart().startsWith("--")) {
    return <span className="text-text-tertiary italic">{line}</span>;
  }

  const parts: React.ReactNode[] = [];
  const regex = /('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.)*`)|("(?:[^"\\]|\\.)*")|(\b\w+\b)|([^\w'"`]+)/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(line)) !== null) {
    const [full, str, backtick, dblQuote, word] = m;
    if (str) {
      parts.push(<span key={key++} className="text-emerald-500">{full}</span>);
    } else if (backtick || dblQuote) {
      parts.push(<span key={key++} className="text-text-primary">{full}</span>);
    } else if (word) {
      const lower = word.toLowerCase();
      if (SQL_KEYWORDS.has(lower)) {
        parts.push(<span key={key++} className="text-blue-400 font-medium">{word}</span>);
      } else if (SQL_VALUES.has(lower)) {
        parts.push(<span key={key++} className="text-amber-400">{word}</span>);
      } else if (/^\d+$/.test(word)) {
        parts.push(<span key={key++} className="text-purple-400">{word}</span>);
      } else {
        parts.push(<span key={key++}>{word}</span>);
      }
    } else {
      parts.push(<span key={key++}>{full}</span>);
    }
  }
  return <>{parts}</>;
}
