import { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
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

// 常用代码片段模板。labelKey/labelZh 由组件内 t() 解析为用户可见文案
const BASE_SNIPPETS: Record<string, { labelKey: string; labelZh: string; code: string }[]> = {
  pre: [
    { labelKey: 'http.script.snippet.setEnvVar', labelZh: '设置环境变量', code: '// pm.environment.set("key", "value");\n' },
    { labelKey: 'http.script.snippet.setFolderVar', labelZh: '设置目录变量', code: '// pm.folderVariables.set("token", "value");\n' },
    { labelKey: 'http.script.snippet.setCollectionVar', labelZh: '设置集合变量', code: '// pm.collectionVariables.set("token", "value");\n' },
    { labelKey: 'http.script.snippet.genUuid', labelZh: '生成 UUID', code: '// const uuid = crypto.randomUUID();\n// pm.environment.set("requestId", uuid);\n' },
    { labelKey: 'http.script.snippet.timestamp', labelZh: '时间戳', code: '// const ts = Date.now().toString();\n// pm.environment.set("timestamp", ts);\n// pm.request.headers.set("X-Timestamp", ts);\n' },
    { labelKey: 'http.script.snippet.random', labelZh: '随机数', code: '// pm.environment.set("random", Math.floor(Math.random() * 10000).toString());\n' },
    { labelKey: 'http.script.snippet.base64Encode', labelZh: 'Base64 编码', code: '// const encoded = btoa("username:password");\n// pm.environment.set("auth", encoded);\n' },
    { labelKey: 'http.script.snippet.addHeader', labelZh: '当前请求加 Header', code: '// pm.request.headers.set("Authorization", "Bearer " + pm.variables.get("token"));\n' },
    { labelKey: 'http.script.snippet.bearerTokenSign', labelZh: 'Bearer Token 签名', code: '// 自定义 Token 生成逻辑\n// const token = generateToken(secret, payload);\n// pm.collectionVariables.set("token", token);\n// pm.request.headers.set("Authorization", "Bearer " + token);\n' },
  ],
  post: [
    { labelKey: 'http.script.snippet.assertStatus', labelZh: '断言状态码', code: '// pm.test("Status is 200", () => {\n//   if (pm.response.code !== 200) {\n//     throw new Error("Unexpected status: " + pm.response.code);\n//   }\n// });\n' },
    { labelKey: 'http.script.snippet.assertBodyContains', labelZh: '断言响应体包含', code: '// pm.test("Body contains key", () => {\n//   const json = pm.response.json();\n//   if (!json || !json.data) {\n//     throw new Error("Missing data field");\n//   }\n// });\n' },
    { labelKey: 'http.script.snippet.extractSaveVar', labelZh: '提取并保存变量', code: '// const json = pm.response.json();\n// pm.environment.set("token", json.data.token);\n' },
    { labelKey: 'http.script.snippet.extractToCollection', labelZh: '提取到集合变量', code: '// const json = pm.response.json();\n// pm.collectionVariables.set("token", json.data.token);\n' },
    { labelKey: 'http.script.snippet.assertResponseTime', labelZh: '断言响应时间', code: '// pm.test("Response time < 500ms", () => {\n//   if (pm.response.responseTime >= 500) {\n//     throw new Error("Response too slow: " + pm.response.responseTime);\n//   }\n// });\n' },
    { labelKey: 'http.script.snippet.iterateAssert', labelZh: '遍历数组断言', code: '// const items = pm.response.json().data || [];\n// pm.test("All items have id", () => {\n//   items.forEach((item) => {\n//     if (!item.id) throw new Error("Item missing id");\n//   });\n// });\n' },
    { labelKey: 'http.script.snippet.saveNextPage', labelZh: '保存下一页地址', code: '// const json = pm.response.json();\n// pm.environment.set("nextPageUrl", json.links?.next || "");\n' },
  ],
};

// 加密解密插件代码片段
const CRYPTO_SNIPPETS: { labelKey: string; labelZh: string; code: string }[] = [
  {
    labelKey: 'http.script.snippet.cryptoBase64Encode',
    labelZh: 'Base64 编码',
    code: `// Base64 编码
var result = encrypt("base64", "要编码的字符串", {});
if (result.success) {
  pm.environment.set("encoded", result.output);
}
`,
  },
  {
    labelKey: 'http.script.snippet.cryptoBase64Decode',
    labelZh: 'Base64 解码',
    code: `// Base64 解码
var result = decrypt("base64", "aGVsbG8gd29ybGQ=", {});
if (result.success) {
  console.log("解码结果:", result.output);
}
`,
  },
  {
    labelKey: 'http.script.snippet.cryptoMd5',
    labelZh: 'MD5 哈希',
    code: `// MD5 哈希
var result = encrypt("md5", "要哈希的字符串", {});
if (result.success) {
  pm.environment.set("md5Hash", result.output);
}
`,
  },
  {
    labelKey: 'http.script.snippet.cryptoSha256',
    labelZh: 'SHA-256 哈希',
    code: `// SHA-256 哈希
var result = encrypt("sha256", "要哈希的字符串", {});
if (result.success) {
  pm.environment.set("sha256Hash", result.output);
}
`,
  },
  {
    labelKey: 'http.script.snippet.cryptoAesCbcEncrypt',
    labelZh: 'AES-CBC 加密',
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
    labelKey: 'http.script.snippet.cryptoAesCbcDecrypt',
    labelZh: 'AES-CBC 解密',
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
    labelKey: 'http.script.snippet.cryptoUrlEncode',
    labelZh: 'URL 编码',
    code: `// URL 编码
var result = encrypt("url-encode", "需要编码的内容&key=value", {});
if (result.success) {
  pm.environment.set("urlEncoded", result.output);
}
`,
  },
  {
    labelKey: 'http.script.snippet.cryptoRequestSignMd5',
    labelZh: '请求签名（MD5）',
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
  const snippetBtnRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetPos, setSnippetPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

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

  return (
    <div className="h-full flex flex-col p-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="flex items-center gap-1.5 text-text-tertiary">
          <Code className="w-3.5 h-3.5" />
          <span className="pf-text-sm font-medium">
            {type === 'pre' ? t('http.script.preScriptTitle', '前置脚本') : t('http.script.postScriptTitle', '后置测试脚本')}
          </span>
        </div>

        <div className="flex-1" />

        {/* Snippet Dropdown — portal to escape overflow:hidden panel */}
        <div>
          <button
            ref={snippetBtnRef}
            onClick={() => {
              if (!showSnippets && snippetBtnRef.current) {
                const rect = snippetBtnRef.current.getBoundingClientRect();
                setSnippetPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setShowSnippets((v) => !v);
            }}
            className="h-7 px-2.5 rounded-md flex items-center gap-1 pf-text-xs font-medium text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            {t('http.script.snippets', '代码片段')}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSnippets && createPortal(
            <>
              <div className="fixed inset-0 z-[200]" onClick={() => setShowSnippets(false)} />
              <div
                className="fixed z-[201] w-64 max-h-[280px] overflow-y-auto bg-bg-primary border border-border-default pf-rounded-md shadow-panel py-1"
                style={{ top: snippetPos.top, right: snippetPos.right }}
              >
                {snippets.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => insertSnippet(s.code)}
                    className="w-full px-3 py-2 text-left pf-text-sm text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    {t(s.labelKey, s.labelZh)}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>

        <div className="w-px h-4 bg-border-default" />

        <button
          onClick={handleCopy}
          disabled={!value}
          className="h-7 px-2 rounded-md flex items-center gap-1 pf-text-xs text-text-tertiary hover:bg-bg-hover disabled:opacity-50 transition-colors"
          title={t('http.script.copyScript', '复制脚本')}
        >
          {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
        </button>

        <button
          onClick={handleClear}
          disabled={!value}
          className="h-7 px-2 rounded-md flex items-center gap-1 pf-text-xs text-text-tertiary hover:bg-bg-hover disabled:opacity-50 transition-colors"
          title={t('http.script.clear', '清空')}
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
      <p className="mt-2 pf-text-xs text-text-disabled shrink-0">
        {t('http.script.helperText', '支持 Tab 缩进 · 使用「代码片段」快速插入常用模板')} ·
        {type === 'pre' ? ` ${t('http.script.preScriptHelper', '在请求发送之前执行')}` : ` ${t('http.script.postScriptHelper', '在收到响应之后执行')}`}
      </p>
    </div>
  );
}
