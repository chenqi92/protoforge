export type PluginType =
  | 'protocol-parser'
  | 'request-hook'
  | 'response-renderer'
  | 'data-generator'
  | 'export-format'
  | 'sidebar-panel'
  | 'crypto-tool';

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
}

export interface ParserContribution {
  protocolId: string;
  name: string;
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
  value: string;
  unit?: string;
  group?: string;
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
  type: 'text' | 'select' | 'number';
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
