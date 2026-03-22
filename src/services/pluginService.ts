import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, ProtocolParser, ParseResult, HookResult, GenerateDataResult, ExportResult } from "@/types/plugin";

/** 列出所有已安装插件 */
export async function listPlugins(): Promise<PluginManifest[]> {
  return invoke<PluginManifest[]>("plugin_list");
}

/** 列出仓库中所有可用插件（含安装状态标记） */
export async function listAvailablePlugins(): Promise<PluginManifest[]> {
  return invoke<PluginManifest[]>("plugin_list_available");
}

/** 从仓库安装插件 */
export async function installPlugin(pluginId: string): Promise<PluginManifest> {
  return invoke<PluginManifest>("plugin_install", { pluginId });
}

/** 卸载已安装插件 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("plugin_uninstall", { pluginId });
}

/** 使用指定插件解析原始数据 */
export async function parseData(pluginId: string, rawData: string): Promise<ParseResult> {
  return invoke<ParseResult>("plugin_parse_data", { pluginId, rawData });
}

/** 获取所有已注册的协议解析器 */
export async function getProtocolParsers(): Promise<ProtocolParser[]> {
  return invoke<ProtocolParser[]>("plugin_get_protocol_parsers");
}

/** 强制刷新远程注册表（返回远程插件数量） */
export async function refreshRegistry(): Promise<number> {
  return invoke<number>("plugin_refresh_registry");
}

/** 获取插件图标 (base64 data URI)，无图标文件时返回 null */
export async function getPluginIcon(pluginId: string): Promise<string | null> {
  return invoke<string | null>("plugin_get_icon", { pluginId });
}

/** 执行请求钩子插件 */
export async function runHook(pluginId: string, requestJson: string): Promise<HookResult> {
  return invoke<HookResult>("plugin_run_hook", { pluginId, requestJson });
}

/** 执行数据生成插件 */
export async function runGenerator(pluginId: string, generatorId: string, optionsJson: string): Promise<GenerateDataResult> {
  return invoke<GenerateDataResult>("plugin_run_generator", { pluginId, generatorId, optionsJson });
}

/** 执行导出格式插件 */
export async function runExport(pluginId: string, requestJson: string): Promise<ExportResult> {
  return invoke<ExportResult>("plugin_run_export", { pluginId, requestJson });
}

