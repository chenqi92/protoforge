import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Copy, Check, Eraser, BookOpen, ChevronDown } from 'lucide-react';
import { CodeEditor } from '@/components/common/CodeEditor';


interface ScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type: 'pre' | 'post';
}

// 常用{t('http.script.snippets')}模板
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

export function ScriptEditor({ value, onChange, type }: ScriptEditorProps) {
  const { t } = useTranslation();
  const editorRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  const handleClear = useCallback(() => {
    onChange('');
    editorRef.current?.focus();
  }, [onChange]);

  const insertSnippet = useCallback((code: string) => {
    const editor = editorRef.current;
    if (editor) {
      const selection = editor.getSelection();
      editor.executeEdits('snippet', [{
        range: selection,
        text: code,
        forceMoveMarkers: true
      }]);
      editor.focus();
    } else {
      onChange(value + "\n" + code);
    }
    setShowSnippets(false);
  }, [value, onChange]);

  const snippets = SNIPPETS[type] || [];

  return (
    <div className="h-full flex flex-col p-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="flex items-center gap-1.5 text-text-tertiary">
          <Code className="w-3.5 h-3.5" />
          <span className="text-[var(--fs-sm)] font-medium">
            {type === 'pre' ? t('http.script.preScriptTitle') : t('http.script.postScriptTitle')}
          </span>
        </div>

        <div className="flex-1" />

        {/* Snippet Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSnippets(!showSnippets)}
            className="h-7 px-2.5 rounded-md flex items-center gap-1 text-[var(--fs-xs)] font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            {t('http.script.snippets')}
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
                    className="w-full px-3 py-2 text-left text-[var(--fs-sm)] text-text-secondary hover:bg-bg-hover transition-colors"
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
          className="h-7 px-2 rounded-md flex items-center gap-1 text-[var(--fs-xs)] text-text-tertiary hover:bg-bg-hover disabled:opacity-40 transition-colors"
          title={t('http.script.copyScript')}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        </button>

        <button
          onClick={handleClear}
          disabled={!value}
          className="h-7 px-2 rounded-md flex items-center gap-1 text-[var(--fs-xs)] text-text-tertiary hover:bg-bg-hover disabled:opacity-40 transition-colors"
          title={t('http.script.clear')}
        >
          <Eraser className="w-3 h-3" />
        </button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex border border-border-default rounded-lg overflow-hidden bg-bg-input focus-within:border-accent transition-colors">
        <div className="flex-1 h-full w-full">
          <CodeEditor
            value={value}
            onChange={onChange}
            language="javascript"
            onMount={(editor) => { editorRef.current = editor; }}
          />
        </div>
      </div>

      {/* Helper text */}
      <p className="mt-2 text-[var(--fs-xs)] text-text-disabled shrink-0">
        {t('http.script.helperText')} ·
        {type === 'pre' ? ` ${t('http.script.preScriptHelper')}` : ` ${t('http.script.postScriptHelper')}`}
      </p>
    </div>
  );
}
