//! WASM 插件运行时
//!
//! 支持任意语言（Rust/C/Go/Zig/AssemblyScript 等）编写的 .wasm 插件。
//! 插件通过导出约定的函数与宿主交互。
//!
//! ## 插件接口约定
//!
//! WASM 模块需导出以下函数：
//!
//! - `plugin_info() -> ptr`       返回 JSON 格式的插件元信息
//! - `parse(ptr, len) -> ptr`     解析原始数据，返回 JSON 结果
//! - `alloc(size) -> ptr`         分配内存（宿主向 guest 传数据用）
//! - `dealloc(ptr, size)`         释放内存
//!
//! 宿主通过 `alloc` 写入输入数据，通过返回的 ptr 读取输出数据。
//! 输出数据格式: 前 4 字节为 u32 LE 表示长度，其后为 UTF-8 JSON。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use wasmtime::*;
use serde::{Serialize, Deserialize};

use crate::plugin_runtime::ParseResult;

// ── WASM Plugin Info (from guest) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(default)]
    pub protocol_ids: Vec<String>,
}

// ── Cached WASM Module ──

struct CachedModule {
    engine: Engine,
    module: Module,
    info: WasmPluginInfo,
}

// ── WASM Plugin Runtime ──

pub struct WasmPluginRuntime {
    plugins_dir: PathBuf,
    /// Cached compiled modules (plugin_id → module)
    modules: RwLock<HashMap<String, Arc<CachedModule>>>,
}

impl WasmPluginRuntime {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            plugins_dir: app_data_dir.join("plugins"),
            modules: RwLock::new(HashMap::new()),
        }
    }

    /// Load a WASM plugin from disk and cache the compiled module.
    pub async fn load_plugin(&self, plugin_id: &str) -> Result<WasmPluginInfo, String> {
        // Check if already loaded
        {
            let cache = self.modules.read().await;
            if let Some(cached) = cache.get(plugin_id) {
                return Ok(cached.info.clone());
            }
        }

        let wasm_path = self.find_wasm_file(plugin_id).await?;

        // Read WASM bytes
        let wasm_bytes = tokio::fs::read(&wasm_path)
            .await
            .map_err(|e| format!("读取 WASM 文件失败: {}", e))?;

        // Compile module in blocking context (CPU-intensive)
        let plugin_id_owned = plugin_id.to_string();
        let cached = tokio::task::spawn_blocking(move || {
            compile_and_query_info(&wasm_bytes, &plugin_id_owned)
        })
        .await
        .map_err(|e| format!("WASM 编译任务失败: {}", e))??;

        let info = cached.info.clone();
        let cached = Arc::new(cached);

        self.modules
            .write()
            .await
            .insert(plugin_id.to_string(), cached);

        Ok(info)
    }

    /// Unload a cached WASM module.
    pub async fn unload_plugin(&self, plugin_id: &str) {
        self.modules.write().await.remove(plugin_id);
    }

    /// Execute the `parse` function of a loaded WASM plugin.
    pub async fn parse_data(
        &self,
        plugin_id: &str,
        raw_data: &str,
    ) -> Result<ParseResult, String> {
        let cached = {
            let map = self.modules.read().await;
            map.get(plugin_id)
                .ok_or_else(|| format!("WASM 插件 '{}' 未加载，请先调用 load_plugin", plugin_id))?
                .clone()
        };

        let raw_data_owned = raw_data.to_string();

        // Execute in blocking context
        tokio::task::spawn_blocking(move || {
            execute_parse(&cached.engine, &cached.module, &raw_data_owned)
        })
        .await
        .map_err(|e| format!("WASM 执行任务失败: {}", e))?
    }

    /// Execute the `render(ptr, len) -> ptr` export for renderer plugins.
    pub async fn render_data(
        &self,
        plugin_id: &str,
        base64_data: &str,
    ) -> Result<crate::plugin_runtime::RenderResult, String> {
        let cached = {
            let map = self.modules.read().await;
            map.get(plugin_id)
                .ok_or_else(|| format!("WASM 插件 '{}' 未加载，请先调用 load_plugin", plugin_id))?
                .clone()
        };

        let data_owned = base64_data.to_string();

        tokio::task::spawn_blocking(move || {
            execute_render(&cached.engine, &cached.module, &data_owned)
        })
        .await
        .map_err(|e| format!("WASM 执行任务失败: {}", e))?
    }

    /// List all loaded WASM plugins.
    pub async fn list_loaded(&self) -> Vec<WasmPluginInfo> {
        let map = self.modules.read().await;
        map.values().map(|c| c.info.clone()).collect()
    }

    /// Scan plugins directory for .wasm files and try to load them.
    pub async fn scan_and_load(&self) -> Vec<String> {
        let mut loaded = Vec::new();

        let dir = &self.plugins_dir;
        if !dir.exists() {
            return loaded;
        }

        let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
            return loaded;
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let plugin_id = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();

            // Check if there's a .wasm file in this plugin directory
            if self.find_wasm_file(&plugin_id).await.is_ok() {
                match self.load_plugin(&plugin_id).await {
                    Ok(info) => {
                        log::info!("WASM 插件加载成功: {} ({})", info.name, info.id);
                        loaded.push(info.id);
                    }
                    Err(e) => {
                        log::warn!("WASM 插件加载失败 '{}': {}", plugin_id, e);
                    }
                }
            }
        }

        loaded
    }

    /// Find the .wasm file for a plugin (looks for *.wasm in plugin dir)
    async fn find_wasm_file(&self, plugin_id: &str) -> Result<PathBuf, String> {
        let plugin_dir = self.plugins_dir.join(plugin_id);
        if !plugin_dir.exists() {
            return Err(format!("插件目录不存在: {}", plugin_dir.display()));
        }

        let mut entries = tokio::fs::read_dir(&plugin_dir)
            .await
            .map_err(|e| format!("读取插件目录失败: {}", e))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("wasm") {
                return Ok(path);
            }
        }

        Err(format!("插件 '{}' 目录中没有 .wasm 文件", plugin_id))
    }
}

// ── Internal helpers ──

/// Compile a WASM module and query its plugin_info export.
fn compile_and_query_info(
    wasm_bytes: &[u8],
    fallback_id: &str,
) -> Result<CachedModule, String> {
    // 启用 fuel 资源限制，防止恶意 WASM 插件无限循环或消耗过量资源
    let mut config = wasmtime::Config::new();
    config.consume_fuel(true);
    let engine = Engine::new(&config)
        .map_err(|e| format!("WASM 引擎创建失败: {}", e))?;
    let module = Module::new(&engine, wasm_bytes)
        .map_err(|e| format!("WASM 编译失败: {}", e))?;

    // Try to get plugin info by calling plugin_info()
    let info = match call_plugin_info(&engine, &module) {
        Ok(info) => info,
        Err(_) => {
            // Fallback: create basic info from plugin_id
            WasmPluginInfo {
                id: fallback_id.to_string(),
                name: fallback_id.to_string(),
                version: "0.0.0".to_string(),
                description: "WASM plugin".to_string(),
                author: "unknown".to_string(),
                protocol_ids: vec![],
            }
        }
    };

    Ok(CachedModule {
        engine,
        module,
        info,
    })
}

/// Call the plugin_info() export to get plugin metadata.
fn call_plugin_info(engine: &Engine, module: &Module) -> Result<WasmPluginInfo, String> {
    let mut store = Store::new(engine, ());
    // 为 plugin_info 调用分配资源限制
    store.set_fuel(1_000_000).map_err(|e| format!("fuel 设置失败: {}", e))?;
    let linker = Linker::new(engine);
    let instance = linker
        .instantiate(&mut store, module)
        .map_err(|e| format!("实例化失败: {}", e))?;

    let plugin_info = instance
        .get_typed_func::<(), i32>(&mut store, "plugin_info")
        .map_err(|e| format!("找不到 plugin_info 导出: {}", e))?;

    let ptr = plugin_info
        .call(&mut store, ())
        .map_err(|e| format!("调用 plugin_info 失败: {}", e))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or("找不到 memory 导出")?;

    let json_str = read_guest_string(&store, &memory, ptr as u32)?;
    let info: WasmPluginInfo =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 plugin_info JSON 失败: {}", e))?;

    Ok(info)
}

/// Execute the parse(ptr, len) -> ptr export.
fn execute_parse(engine: &Engine, module: &Module, raw_data: &str) -> Result<ParseResult, String> {
    let mut store = Store::new(engine, ());
    // 为 parse 执行分配充裕的 fuel 限制（10M 指令级别）
    store.set_fuel(10_000_000).map_err(|e| format!("fuel 设置失败: {}", e))?;
    let linker = Linker::new(engine);
    let instance = linker
        .instantiate(&mut store, module)
        .map_err(|e| format!("WASM 实例化失败: {}", e))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or("找不到 memory 导出")?;

    // Allocate memory in guest for input data
    let input_bytes = raw_data.as_bytes();
    let input_len = input_bytes.len() as i32;

    let alloc = instance
        .get_typed_func::<i32, i32>(&mut store, "alloc")
        .map_err(|e| format!("找不到 alloc 导出: {}", e))?;

    let input_ptr = alloc
        .call(&mut store, input_len)
        .map_err(|e| format!("alloc 调用失败: {}", e))?;

    // Write input data to guest memory
    memory
        .write(&mut store, input_ptr as usize, input_bytes)
        .map_err(|e| format!("写入 guest 内存失败: {}", e))?;

    // Call parse(ptr, len)
    let parse = instance
        .get_typed_func::<(i32, i32), i32>(&mut store, "parse")
        .map_err(|e| format!("找不到 parse 导出: {}", e))?;

    let result_ptr = parse
        .call(&mut store, (input_ptr, input_len))
        .map_err(|e| format!("parse 调用失败: {}", e))?;

    // Read result string from guest memory
    let result_json = read_guest_string(&store, &memory, result_ptr as u32)?;

    // Try to deallocate input buffer
    if let Ok(dealloc) = instance.get_typed_func::<(i32, i32), ()>(&mut store, "dealloc") {
        let _ = dealloc.call(&mut store, (input_ptr, input_len));
    }

    // Parse result
    let parsed: ParseResult = serde_json::from_str(&result_json)
        .map_err(|e| format!("解析 parse 结果 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute the render(ptr, len) -> ptr export for renderer plugins.
fn execute_render(engine: &Engine, module: &Module, base64_data: &str) -> Result<crate::plugin_runtime::RenderResult, String> {
    let mut store = Store::new(engine, ());
    // 渲染操作可能需要更多资源（Excel 解析等），给予更多 fuel
    store.set_fuel(50_000_000).map_err(|e| format!("fuel 设置失败: {}", e))?;
    let linker = Linker::new(engine);
    let instance = linker
        .instantiate(&mut store, module)
        .map_err(|e| format!("WASM 实例化失败: {}", e))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or("找不到 memory 导出")?;

    let input_bytes = base64_data.as_bytes();
    let input_len = input_bytes.len() as i32;

    let alloc = instance
        .get_typed_func::<i32, i32>(&mut store, "alloc")
        .map_err(|e| format!("找不到 alloc 导出: {}", e))?;

    let input_ptr = alloc
        .call(&mut store, input_len)
        .map_err(|e| format!("alloc 调用失败: {}", e))?;

    memory
        .write(&mut store, input_ptr as usize, input_bytes)
        .map_err(|e| format!("写入 guest 内存失败: {}", e))?;

    let render = instance
        .get_typed_func::<(i32, i32), i32>(&mut store, "render")
        .map_err(|e| format!("找不到 render 导出: {}", e))?;

    let result_ptr = render
        .call(&mut store, (input_ptr, input_len))
        .map_err(|e| format!("render 调用失败: {}", e))?;

    let result_json = read_guest_string(&store, &memory, result_ptr as u32)?;

    if let Ok(dealloc) = instance.get_typed_func::<(i32, i32), ()>(&mut store, "dealloc") {
        let _ = dealloc.call(&mut store, (input_ptr, input_len));
    }

    let rendered: crate::plugin_runtime::RenderResult = serde_json::from_str(&result_json)
        .map_err(|e| format!("解析 render 结果 JSON 失败: {}", e))?;

    Ok(rendered)
}

/// Read a length-prefixed string from guest memory.
/// Format: [u32 LE length][UTF-8 bytes...]
fn read_guest_string(store: &Store<()>, memory: &Memory, ptr: u32) -> Result<String, String> {
    let data = memory.data(store);
    let ptr = ptr as usize;
    const MAX_GUEST_STRING: usize = 64 * 1024 * 1024; // 64MB 上限

    if ptr + 4 > data.len() {
        return Err("指针超出内存边界".to_string());
    }

    let len = u32::from_le_bytes([
        data[ptr],
        data[ptr + 1],
        data[ptr + 2],
        data[ptr + 3],
    ]) as usize;

    if len > MAX_GUEST_STRING {
        return Err(format!("guest 字符串长度 {} 超过最大限制 {}MB", len, MAX_GUEST_STRING / 1024 / 1024));
    }

    if ptr + 4 + len > data.len() {
        return Err(format!("字符串长度 {} 超出内存边界", len));
    }

    String::from_utf8(data[ptr + 4..ptr + 4 + len].to_vec())
        .map_err(|e| format!("UTF-8 解码失败: {}", e))
}
