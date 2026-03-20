// WASM 插件 Tauri IPC 服务层

import { invoke } from '@tauri-apps/api/core';

export interface WasmPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  protocolIds: string[];
}

/** 加载一个 WASM 插件（编译并缓存） */
export async function wasmLoadPlugin(pluginId: string): Promise<WasmPluginInfo> {
  return invoke('wasm_load_plugin', { pluginId });
}

/** 卸载 WASM 插件（释放缓存模块） */
export async function wasmUnloadPlugin(pluginId: string): Promise<void> {
  return invoke('wasm_unload_plugin', { pluginId });
}

/** 使用 WASM 插件解析数据 */
export async function wasmParseData(pluginId: string, rawData: string): Promise<unknown> {
  return invoke('wasm_parse_data', { pluginId, rawData });
}

/** 列出所有已加载的 WASM 插件 */
export async function wasmListLoaded(): Promise<WasmPluginInfo[]> {
  return invoke('wasm_list_loaded');
}
