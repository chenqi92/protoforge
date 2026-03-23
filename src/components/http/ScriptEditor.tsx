import { useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Copy, Check, Eraser, BookOpen, ChevronDown } from 'lucide-react';
import { CodeEditor } from '@/components/common/CodeEditor';
import { usePluginStore } from '@/stores/pluginStore';


interface ScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type: 'pre' | 'post';
}

// 常用代码片段模板
const BASE_SNIPPETS: Record<string, { label: string; code: string }[]> = {
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

// 加密解密插件代码片段
const CRYPTO_SNIPPETS: { label: string; code: string }[] = [
  {
    label: '🔐 Base64 编码',
    code: `// Base64 编码
var result = encrypt("base64", "要编码的字符串", {});
if (result.success) {
  pm.environment.set("encoded", result.output);
}
`,
  },
  {
    label: '🔓 Base64 解码',
    code: `// Base64 解码
var result = decrypt("base64", "aGVsbG8gd29ybGQ=", {});
if (result.success) {
  console.log("解码结果:", result.output);
}
`,
  },
  {
    label: '🔐 MD5 哈希',
    code: `// MD5 哈希
var result = encrypt("md5", "要哈希的字符串", {});
if (result.success) {
  pm.environment.set("md5Hash", result.output);
}
`,
  },
  {
    label: '🔐 SHA-256 哈希',
    code: `// SHA-256 哈希
var result = encrypt("sha256", "要哈希的字符串", {});
if (result.success) {
  pm.environment.set("sha256Hash", result.output);
}
`,
  },
  {
    label: '🔐 AES-CBC 加密',
    code: `// AES-CBC 加密（密钥需 16/24/32 字节，IV 需 16 字节）
var result = encrypt("aes-cbc", "要加密的明文", {
  key: "1234567890123456",
  iv: "1234567890123456",
  padding: "pkcs7",
  outputEncoding: "base64"
});
if (result.success) {
  pm.environment.set("encrypted", result.output);
}
`,
  },
  {
    label: '🔓 AES-CBC 解密',
    code: `// AES-CBC 解密
var result = decrypt("aes-cbc", pm.environment.get("encrypted"), {
  key: "1234567890123456",
  iv: "1234567890123456",
  padding: "pkcs7",
  outputEncoding: "base64"
});
if (result.success) {
  console.log("解密结果:", result.output);
}
`,
  },
  {
    label: '🔐 URL 编码',
    code: `// URL 编码
var result = encrypt("url-encode", "需要编码的内容&key=value", {});
if (result.success) {
  pm.environment.set("urlEncoded", result.output);
}
`,
  },
  {
    label: '🔐 请求签名（MD5）',
    code: `// 使用 MD5 对请求参数签名
var timestamp = Date.now().toString();
var secret = "your-api-secret";
var signStr = "timestamp=" + timestamp + "&secret=" + secret;
var result = encrypt("md5", signStr, {});
if (result.success) {
  pm.request.headers.add({ key: "X-Timestamp", value: timestamp });
  pm.request.headers.add({ key: "X-Signature", value: result.output });
}
`,
  },
];

export function ScriptEditor({ value, onChange, type }: ScriptEditorProps) {
  const { t } = useTranslation();
  const editorRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);

  // 检查是否安装了 crypto 插件
  const hasCryptoPlugin = usePluginStore((s) =>
    s.installedPlugins.some((p) => p.pluginType === 'crypto-tool')
  );

  // 合并基础片段和 crypto 片段
  const snippets = useMemo(() => {
    const base = BASE_SNIPPETS[type] || [];
    if (!hasCryptoPlugin) return base;
    return [...base, ...CRYPTO_SNIPPETS];
  }, [type, hasCryptoPlugin]);

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

  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor;

    // 注册分组入口 actions（与 HttpWorkspace 一致，只注册入口不展开所有算法）
    const plugins = usePluginStore.getState().installedPlugins;

    const hasGens = plugins.some(p => p.pluginType === 'data-generator' && (p.contributes?.generators?.length || 0) > 0);
    if (hasGens) {
      editor.addAction({
        id: 'plugin-mock-data',
        label: '🪄 Mock 数据生成',
        contextMenuGroupId: '9_plugins',
        contextMenuOrder: 1,
        run: (ed: any) => {
          const rect = ed.getDomNode()?.getBoundingClientRect();
          const pos = ed.getPosition();
          const coords = pos ? ed.getScrolledVisiblePosition(pos) : null;
          const x = (rect?.left || 0) + (coords?.left || 100);
          const y = (rect?.top || 0) + (coords?.top || 100) + 20;
          window.dispatchEvent(new CustomEvent('plugin-action-menu', {
            detail: { type: 'mock', editorId: ed.getId(), x, y },
          }));
        },
      });
    }

    const hasCrypto = plugins.some(p => p.pluginType === 'crypto-tool' && (p.contributes?.cryptoAlgorithms?.length || 0) > 0);
    if (hasCrypto) {
      editor.addAction({
        id: 'plugin-crypto',
        label: '🔐 加密 / 解密',
        contextMenuGroupId: '9_plugins',
        contextMenuOrder: 2,
        precondition: 'editorHasSelection',
        run: (ed: any) => {
          const rect = ed.getDomNode()?.getBoundingClientRect();
          const pos = ed.getPosition();
          const coords = pos ? ed.getScrolledVisiblePosition(pos) : null;
          const x = (rect?.left || 0) + (coords?.left || 100);
          const y = (rect?.top || 0) + (coords?.top || 100) + 20;
          window.dispatchEvent(new CustomEvent('plugin-action-menu', {
            detail: { type: 'crypto', editorId: ed.getId(), x, y },
          }));
        },
      });
    }
  }, []);

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
              <div className="absolute right-0 top-8 z-50 w-64 max-h-[400px] overflow-y-auto bg-bg-primary border border-border-default rounded-lg shadow-xl py-1 animate-in fade-in slide-in-from-top-1">
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
            onMount={handleEditorMount}
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
