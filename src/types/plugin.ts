export type PluginType =
  | 'protocol-parser'
  | 'request-hook'
  | 'response-renderer'
  | 'data-generator'
  | 'export-format'
  | 'sidebar-panel';

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
}

/** 插件扩展点贡献声明 (类似 VS Code contributes) */
export interface PluginContributes {
  parsers?: ParserContribution[];
  requestHooks?: RequestHookContribution[];
  responseRenderers?: RendererContribution[];
  sidebarPanels?: SidebarContribution[];
  generators?: GeneratorContribution[];
  exportFormats?: ExportFormatContribution[];
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
