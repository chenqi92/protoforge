export type PluginType =
  | 'protocol-parser'
  | 'request-hook'
  | 'response-renderer'
  | 'data-generator'
  | 'export-format'
  | 'sidebar-panel'
  | 'crypto-tool'
  | 'icon-pack';

/** 插件可翻译字段 */
export interface PluginI18nEntry {
  name?: string;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  pluginType: PluginType;
  /** 面板位置声明: left=左侧, right=右侧, both=两侧. 未设置时按 pluginType 推断 */
  panelPosition?: 'left' | 'right' | 'both';
  icon: string;
  entrypoint: string;
  protocolIds: string[];
  tags: string[];
  installed: boolean;
  downloadUrl?: string;
  source: 'native' | 'remote';
  contributes: PluginContributes;
  /** 多语言翻译 — 键为语言代码 (如 "en")，值为可翻译字段 */
  i18n?: Record<string, PluginI18nEntry>;
  /** 是否有可用更新 */
  hasUpdate?: boolean;
  /** 远程仓库最新版本号 */
  latestVersion?: string;
  /** 图标命名空间 — 仅 icon-pack 类型插件需要 */
  iconNamespace?: string;
}

/** 插件扩展点贡献声明 (类似 VS Code contributes) */
export interface PluginContributes {
  parsers?: ParserContribution[];
  requestHooks?: RequestHookContribution[];
  responseRenderers?: RendererContribution[];
  sidebarPanels?: SidebarContribution[];
  generators?: GeneratorContribution[];
  exportFormats?: ExportFormatContribution[];
  fonts?: FontContribution[];
  cryptoAlgorithms?: CryptoAlgorithm[];
  /** 图标贡献 — icon-pack 类型插件提供 */
  icons?: IconContribution[];
}

export interface ParserContribution {
  protocolId: string;
  name: string;
}

/** 图标贡献 — icon-pack 类型插件中每个图标的定义 */
export interface IconContribution {
  /** 图标名称（在命名空间内唯一），如 "wechat-pay" */
  name: string;
  /** 内联 SVG 字符串，如 "<svg>...</svg>" */
  svg: string;
}

export interface RequestHookContribution {
  hookType: 'pre-request' | 'post-response';
  name: string;
  description?: string;
}

export interface RendererContribution {
  contentTypes: string[];
  name: string;
  icon: string;
}

export interface SidebarContribution {
  panelId: string;
  name: string;
  icon: string;
}

export interface GeneratorContribution {
  generatorId: string;
  name: string;
  description: string;
}

export interface ExportFormatContribution {
  formatId: string;
  name: string;
  fileExtension: string;
}

export interface ProtocolParser {
  pluginId: string;
  protocolId: string;
  pluginName: string;
}

export interface ParsedField {
  key: string;
  label: string;
  value: any;
  unit?: string;
  group?: string;
  /** UI specific properties for declarative rendering */
  uiType?: 'text' | 'status-dot' | 'progress' | 'bit-map' | 'code' | 'json' | 'badge';
  color?: 'emerald' | 'amber' | 'red' | 'blue' | 'purple' | 'slate';
  isKeyInfo?: boolean;
  tooltip?: string;
}

export interface ParseResult {
  success: boolean;
  protocolName: string;
  summary: string;
  fields: ParsedField[];
  rawHex?: string;
  error?: string;
}

/** 字体贡献 — 插件可携带字体文件 */
export interface FontContribution {
  fontId: string;         // e.g. "jetbrains-mono"
  name: string;           // "JetBrains Mono"
  family: string;         // CSS font-family stack
  category: 'sans-serif' | 'monospace' | 'serif';
  /** 字体文件相对于插件目录的路径 */
  files: FontFile[];
}

export interface FontFile {
  path: string;           // e.g. "fonts/JetBrainsMono-Regular.woff2"
  weight?: string;        // e.g. "100 900" or "400"
  style?: string;         // "normal" | "italic"
  format?: string;        // "woff2" | "truetype"
}

/** 请求钩子执行结果 */
export interface HookResult {
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  error?: string;
}

/** 数据生成结果 */
export interface GenerateDataResult {
  data: string;
  error?: string;
}

/** 导出格式结果 */
export interface ExportResult {
  content: string;
  filename: string;
  mimeType: string;
  error?: string;
}

// ── Crypto Tool Types ──

export interface CryptoAlgorithm {
  algorithmId: string;
  name: string;
  category: 'encode' | 'hash' | 'symmetric' | 'asymmetric';
  supportEncrypt: boolean;
  supportDecrypt: boolean;
  params?: CryptoParam[];
}

export interface CryptoParam {
  paramId: string;
  name: string;
  paramType: 'text' | 'select' | 'number';
  required: boolean;
  defaultValue?: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

export interface CryptoResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface InstalledCryptoAlgorithm {
  pluginId: string;
  algorithm: CryptoAlgorithm;
}
