// 基础 SQL 格式化器 — 纯前端实现
// 处理关键字大写、缩进、换行等基本格式化

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "INSERT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP",
  "INDEX", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS",
  "ON", "AS", "IN", "NOT", "NULL", "IS", "LIKE", "BETWEEN", "EXISTS",
  "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL",
  "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "BEGIN",
  "COMMIT", "ROLLBACK", "GRANT", "REVOKE", "WITH", "RECURSIVE",
  "ASC", "DESC", "CASCADE", "RESTRICT", "PRIMARY", "KEY", "FOREIGN",
  "REFERENCES", "CONSTRAINT", "DEFAULT", "CHECK", "UNIQUE",
  "RETURNING", "EXPLAIN", "ANALYZE", "VACUUM", "TRUNCATE",
  "OVER", "PARTITION", "WINDOW", "ROWS", "RANGE", "PRECEDING", "FOLLOWING",
  "CURRENT", "ROW", "UNBOUNDED", "FETCH", "FIRST", "NEXT", "ONLY",
  "LATERAL", "COALESCE", "NULLIF", "GREATEST", "LEAST",
]);

// 触发换行的关键字
const NEWLINE_BEFORE = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "JOIN", "LEFT", "RIGHT",
  "INNER", "OUTER", "FULL", "CROSS", "ORDER", "GROUP", "HAVING",
  "LIMIT", "OFFSET", "UNION", "INSERT", "UPDATE", "DELETE", "SET",
  "VALUES", "RETURNING", "WITH", "ON",
]);

// 增加缩进的关键字
const INDENT_AFTER = new Set([
  "SELECT", "SET", "VALUES",
]);

export function formatSql(sql: string): string {
  if (!sql.trim()) return sql;

  // 保护字符串字面量和注释
  const protected_parts: string[] = [];
  let processed = sql.replace(/'(?:[^']|'')*'|"[^"]*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) => {
    const idx = protected_parts.length;
    protected_parts.push(match);
    return `__PROTECTED_${idx}__`;
  });

  // 标准化空白
  processed = processed.replace(/\s+/g, " ").trim();

  // 分词
  const tokens = processed.split(/\b/).flatMap((part) => {
    // 进一步分割非字母字符
    return part.split(/(\s+|[(),;])/).filter((t) => t.length > 0);
  });

  const lines: string[] = [];
  let currentLine = "";
  let indentLevel = 0;
  let prevKeyword = "";

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    const isKeyword = SQL_KEYWORDS.has(upper);

    // 换行处理
    if (NEWLINE_BEFORE.has(upper) && currentLine.trim()) {
      lines.push(currentLine);
      // 某些关键字降低缩进
      if (["FROM", "WHERE", "ORDER", "GROUP", "HAVING", "LIMIT", "UNION", "RETURNING"].includes(upper)) {
        indentLevel = 0;
      }
      currentLine = "  ".repeat(indentLevel);
    }

    // 关键字大写
    if (isKeyword) {
      currentLine += upper;
      if (INDENT_AFTER.has(upper)) {
        indentLevel = 1;
      }
      prevKeyword = upper;
    } else if (trimmed === "(") {
      currentLine += " (";
    } else if (trimmed === ")") {
      currentLine += ")";
    } else if (trimmed === ",") {
      currentLine += ",";
      // SELECT 列之间换行
      if (prevKeyword === "SELECT" || indentLevel > 0) {
        lines.push(currentLine);
        currentLine = "  ".repeat(indentLevel);
        continue;
      }
    } else if (trimmed === ";") {
      currentLine += ";";
      lines.push(currentLine);
      currentLine = "";
      indentLevel = 0;
      lines.push("");
      continue;
    } else {
      currentLine += (currentLine.endsWith(" ") || currentLine.endsWith("(") || !currentLine.trim()) ? trimmed : ` ${trimmed}`;
    }

    if (!currentLine.endsWith(" ") && trimmed !== "(" && trimmed !== ")") {
      currentLine += " ";
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  // 还原保护的字符串
  let result = lines.map((l) => l.trimEnd()).join("\n");
  for (let i = 0; i < protected_parts.length; i++) {
    result = result.replace(`__PROTECTED_${i}__`, protected_parts[i]);
  }

  return result.trim();
}
