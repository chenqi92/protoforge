export type PluginType =
  | 'protocol-parser'
  | 'request-hook'
  | 'response-renderer'
  | 'data-generator'
  | 'export-format'
  | 'sidebar-panel'
  | 'crypto-tool'
  | 'icon-pack'
  | 'database-driver'
  | 'query-formatter';

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
  /** 右键菜单贡献 — 插件可注入自定义右键菜单项 */
  contextMenuItems?: ContextMenuContribution[];
  /** 数据库驱动贡献 — database-driver 类型插件提供 */
  databaseDrivers?: DatabaseDriverContribution[];
  /** 查询格式化器贡献 — query-formatter 类型插件提供 */
  queryFormatters?: QueryFormatterContribution[];
}

// ── Database Plugin Contribution Types ──

/** 数据库驱动插件贡献声明 */
export interface DatabaseDriverContribution {
  /** 驱动唯一 ID (如 "clickhouse", "redis", "mongodb") */
  driverId: string;
  /** 显示名称 */
  name: string;
  /** 图标 */
  icon: string;
  /** 默认端口 */
  defaultPort: number;
  /** 驱动能力声明 */
  capabilities: string[];
  /** 连接参数模板 — 用于动态生成连接表单 */
  connectionFields?: DatabaseConnectionField[];
}

/** 连接表单字段定义 */
export interface DatabaseConnectionField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'password' | 'file' | 'boolean';
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
}

/** 查询格式化器插件贡献声明 */
export interface QueryFormatterContribution {
  formatterId: string;
  name: string;
  /** 支持的语言 (如 ["sql", "plpgsql", "flux"]) */
  languages: string[];
}

// ── Context Menu Contribution Types ──

/** 右键菜单上下文类型 */
export type ContextMenuContext =
  | 'editor'          // Monaco 编辑器
  | 'input'           // input/textarea 输入框
  | 'response'        // 响应体区域
  | 'kv-row'          // KV 编辑器行
  | 'json-node'       // JSON 树节点
  | 'history'         // 历史记录条目
  | 'global'          // 所有区域
  | 'db-grid-cell'    // 数据库网格单元格
  | 'db-grid-row'     // 数据库网格行
  | 'db-schema-node'  // Schema 树节点
  | 'db-editor';      // SQL 编辑器

/** 插件右键菜单贡献声明 */
export interface ContextMenuContribution {
  /** 菜单项唯一 ID */
  menuItemId: string;
  /** 菜单项显示名称 */
  label: string;
  /** lucide 图标名（可选） */
  icon?: string;
  /** 在哪些上下文中显示 */
  contexts: ContextMenuContext[];
  /** 是否需要选中文本才显示 */
  requiresSelection?: boolean;
  /** 插件内的 action 标识 — 传给 onContextMenuAction */
  action: string;
}

/** 右键菜单动作执行结果 */
export interface ContextMenuActionResult {
  /** 执行结果文本 */
  output?: string;
  /** 是否替换选中文本 */
  replaceSelection?: boolean;
  /** 错误信息 */
  error?: string;
}

export interface ParserContribution {
  protocolId: string;
  name: string;
  /** 自动检测正则数组, 任一匹配即命中. 如 ["^##\\d{4}"] */
  matchPatterns?: string[];
  /** 优先级 (0-100), 越大越优先, 相似协议通过此字段区分. 默认 0 */
  priority?: number;
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
  /** 插件自控布局声明 — 未提供时前端使用默认分组渲染 */
  layout?: LayoutConfig;
}

/** 插件自控布局配置 */
export interface LayoutConfig {
  sections: LayoutSection[];
}

export interface LayoutSection {
  title: string;
  /** 渲染风格: table=键值表, register=登记表, grid=卡片网格, key-value=紧凑键值 */
  style: 'table' | 'register' | 'grid' | 'key-value';
  /** 左边框色彩 */
  color?: string;
  /** 是否默认折叠 */
  collapsed?: boolean;
  /** table/key-value/grid: 直接引用字段 key 列表 */
  fieldKeys?: string[];
  /** register: 列标题 */
  columns?: string[];
  /** register: 结构化行 */
  rows?: RegisterRow[];
}

export interface RegisterRow {
  /** 行标签 (如因子名称) */
  label: string;
  /** 行色彩提示 */
  color?: string;
  /** 单元格 */
  cells: RegisterCell[];
}

export interface RegisterCell {
  /** 引用 ParsedField.key */
  key: string;
  /** 列跨度 */
  span?: number;
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
