import { useState, useRef, useCallback, useEffect } from 'react';
import { Code, Copy, Check, Eraser, BookOpen, ChevronDown } from 'lucide-react';


interface ScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type: 'pre' | 'post';
}

// 常用代码片段模板
const SNIPPETS: Record<string, { label: string; code: string }[]> = {
  pre: [
    { label: '设置环境变量', code: '// pm.environment.set("key", "value");\n' },
    { label: '生成 UUID', code: '// const uuid = crypto.randomUUID();\n// pm.environment.set("requestId", uuid);\n' },
    { label: '时间戳', code: '// pm.environment.set("timestamp", Date.now().toString());\n' },
    { label: '随机数', code: '// pm.environment.set("random", Math.floor(Math.random() * 10000).toString());\n' },
    { label: 'Base64 编码', code: '// const encoded = btoa("username:password");\n// pm.environment.set("auth", encoded);\n' },
    { label: 'Bearer Token 签名', code: '// 自定义 Token 生成逻辑\n// const token = generateToken(secret, payload);\n// pm.request.headers.add({ key: "Authorization", value: `Bearer ${token}` });\n' },
  ],
  post: [
    { label: '断言状态码', code: '// pm.test("Status is 200", () => {\n//   pm.expect(pm.response.code).to.equal(200);\n// });\n' },
    { label: '断言响应体包含', code: '// pm.test("Body contains key", () => {\n//   const json = pm.response.json();\n//   pm.expect(json).to.have.property("data");\n// });\n' },
    { label: '提取并保存变量', code: '// const json = pm.response.json();\n// pm.environment.set("token", json.data.token);\n' },
    { label: '断言响应时间', code: '// pm.test("Response time < 500ms", () => {\n//   pm.expect(pm.response.responseTime).to.be.below(500);\n// });\n' },
    { label: '遍历数组断言', code: '// const items = pm.response.json().data;\n// pm.test("All items have id", () => {\n//   items.forEach(item => pm.expect(item).to.have.property("id"));\n// });\n' },
    { label: '链式请求设置', code: '// const json = pm.response.json();\n// pm.environment.set("nextPageUrl", json.links?.next);\n// pm.setNextRequest("Get Next Page");\n' },
  ],
};

export function ScriptEditor({ value, onChange, placeholder, type }: ScriptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [lineCount, setLineCount] = useState(1);

  useEffect(() => {
    setLineCount(Math.max(1, (value || '').split('\n').length));
  }, [value]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  const handleClear = useCallback(() => {
    onChange('');
    textareaRef.current?.focus();
  }, [onChange]);

  const insertSnippet = useCallback((code: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const before = value.substring(0, start);
      const after = value.substring(ta.selectionEnd);
      const newVal = before + code + after;
      onChange(newVal);
      // Set cursor after inserted snippet
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + code.length;
        ta.focus();
      });
    } else {
      onChange(value + code);
    }
    setShowSnippets(false);
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab 键插入 2 个空格
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const before = value.substring(0, start);
      const after = value.substring(ta.selectionEnd);
      const newVal = before + '  ' + after;
      onChange(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [value, onChange]);

  const snippets = SNIPPETS[type] || [];

  return (
    <div className="h-full flex flex-col p-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="flex items-center gap-1.5 text-text-tertiary">
          <Code className="w-3.5 h-3.5" />
          <span className="text-[12px] font-medium">
            {type === 'pre' ? '前置脚本' : '后置测试脚本'}
          </span>
        </div>

        <div className="flex-1" />

        {/* Snippet Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSnippets(!showSnippets)}
            className="h-7 px-2.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            代码片段
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSnippets && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSnippets(false)} />
              <div className="absolute right-0 top-8 z-50 w-56 bg-bg-primary border border-border-default rounded-lg shadow-xl py-1 animate-in fade-in slide-in-from-top-1">
                {snippets.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => insertSnippet(s.code)}
                    className="w-full px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="w-px h-4 bg-border-default" />

        <button
          onClick={handleCopy}
          disabled={!value}
          className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] text-text-tertiary hover:bg-bg-hover disabled:opacity-40 transition-colors"
          title="复制脚本"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        </button>

        <button
          onClick={handleClear}
          disabled={!value}
          className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] text-text-tertiary hover:bg-bg-hover disabled:opacity-40 transition-colors"
          title="清空"
        >
          <Eraser className="w-3 h-3" />
        </button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex border border-border-default rounded-lg overflow-hidden bg-bg-input focus-within:border-accent transition-colors">
        {/* Line Numbers */}
        <div className="w-10 shrink-0 border-r border-border-default bg-bg-secondary/50 py-3 select-none overflow-hidden">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="text-[12px] font-mono text-text-disabled text-right pr-2 leading-[20px]">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code Area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (type === 'pre'
            ? '// 在发送请求前执行的脚本\n// 可用于设置变量、生成签名等'
            : '// 在收到响应后执行的脚本\n// 可用于断言、提取变量等'
          )}
          className="flex-1 px-3 py-3 font-mono text-[13px] text-text-secondary bg-transparent resize-none outline-none leading-[20px] placeholder:text-text-tertiary/50"
          style={{ tabSize: 2, userSelect: 'text' }}
          spellCheck={false}
          wrap="off"
        />
      </div>

      {/* Helper text */}
      <p className="mt-2 text-[11px] text-text-disabled shrink-0">
        支持 Tab 缩进 · 使用「代码片段」快速插入常用模板 ·
        {type === 'pre' ? ' 在请求发送之前执行' : ' 在收到响应之后执行'}
      </p>
    </div>
  );
}
