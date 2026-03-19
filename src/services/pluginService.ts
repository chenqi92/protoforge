import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, ProtocolParser, ParseResult } from "@/types/plugin";

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
