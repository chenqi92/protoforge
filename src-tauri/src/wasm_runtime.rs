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

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use wasmtime::*;

use crate::plugin_runtime::{
    ParseResult, PluginManifest, validate_plugin_entrypoint, validate_plugin_id,
};

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

#[derive(Default)]
struct WasmCacheState {
    modules: HashMap<String, Arc<CachedModule>>,
    /// Per-plugin epoch used to invalidate loads that are doing disk I/O or
    /// compilation without holding the cache lock.
    generations: HashMap<String, u64>,
}

impl WasmCacheState {
    fn generation(&self, plugin_id: &str) -> u64 {
        self.generations.get(plugin_id).copied().unwrap_or(0)
    }

    fn advance_generation(&mut self, plugin_id: &str) {
        let generation = self.generations.entry(plugin_id.to_string()).or_default();
        *generation = generation.wrapping_add(1);
    }
}

// ── WASM Plugin Runtime ──

pub struct WasmPluginRuntime {
    plugins_dir: PathBuf,
    /// Compiled modules and their commit epochs. The lock is held only for
    /// cache snapshots/commits, never for filesystem I/O or compilation.
    cache: RwLock<WasmCacheState>,
}

impl WasmPluginRuntime {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            plugins_dir: app_data_dir.join("plugins"),
            cache: RwLock::new(WasmCacheState::default()),
        }
    }

    /// Load a WASM plugin from disk and cache the compiled module.
    pub async fn load_plugin(&self, plugin_id: &str) -> Result<WasmPluginInfo, String> {
        self.load_plugin_with(plugin_id, async {
            let wasm_path = self.find_wasm_file(plugin_id).await?;
            let wasm_bytes = tokio::fs::read(&wasm_path)
                .await
                .map_err(|e| format!("读取 WASM 文件失败: {}", e))?;
            let plugin_id_owned = plugin_id.to_string();
            tokio::task::spawn_blocking(move || {
                compile_and_query_info(&wasm_bytes, &plugin_id_owned)
            })
            .await
            .map_err(|e| format!("WASM 编译任务失败: {}", e))?
        })
        .await
    }

    async fn load_plugin_with<F>(&self, plugin_id: &str, load: F) -> Result<WasmPluginInfo, String>
    where
        F: Future<Output = Result<CachedModule, String>>,
    {
        validate_plugin_id(plugin_id)?;
        let generation = {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.modules.get(plugin_id) {
                return Ok(cached.info.clone());
            }
            cache.generation(plugin_id)
        };

        // Slow I/O and compilation intentionally happen outside the cache lock.
        let compiled = Arc::new(load.await?);
        let mut cache = self.cache.write().await;
        if cache.generation(plugin_id) != generation {
            return Err(format!(
                "WASM 插件 '{}' 在加载期间已卸载或升级，请重试",
                plugin_id
            ));
        }
        if let Some(existing) = cache.modules.get(plugin_id) {
            return Ok(existing.info.clone());
        }
        let info = compiled.info.clone();
        cache.modules.insert(plugin_id.to_string(), compiled);
        Ok(info)
    }

    /// Mark the beginning of an install/upgrade/uninstall transaction.
    /// Existing cached code remains usable until the transaction succeeds, but
    /// loads that started before this boundary can no longer commit.
    pub async fn invalidate_inflight_loads(&self, plugin_id: &str) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        self.cache.write().await.advance_generation(plugin_id);
        Ok(())
    }

    /// Unload a cached WASM module and invalidate every load that has not yet
    /// committed. This is also the successful transaction boundary.
    pub async fn unload_plugin(&self, plugin_id: &str) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        self.commit_plugin_version(plugin_id).await;
        Ok(())
    }

    /// Commit hook used while PluginManager holds this plugin's version write
    /// lock. The caller has already validated the ID, so this cannot fail after
    /// the directory/registry transaction has committed.
    pub(crate) async fn commit_plugin_version(&self, plugin_id: &str) {
        let mut cache = self.cache.write().await;
        cache.advance_generation(plugin_id);
        cache.modules.remove(plugin_id);
    }

    /// Execute the `parse` function of a loaded WASM plugin.
    pub async fn parse_data(&self, plugin_id: &str, raw_data: &str) -> Result<ParseResult, String> {
        let cached = {
            let cache = self.cache.read().await;
            cache
                .modules
                .get(plugin_id)
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
    #[allow(dead_code)]
    pub async fn render_data(
        &self,
        plugin_id: &str,
        base64_data: &str,
    ) -> Result<crate::plugin_runtime::RenderResult, String> {
        let cached = {
            let cache = self.cache.read().await;
            cache
                .modules
                .get(plugin_id)
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

    /// Execute the `crypto(ptr, len) -> ptr` export for crypto-tool plugins.
    ///
    /// 镜像 parse_data/render_data 的 buffer-ABI：宿主把 { algorithmId, mode, input, params }
    /// 序列化为 JSON 写入 guest 内存，调用 guest 导出的 `crypto` 函数，读取返回的 JSON
    /// 字符串并解析为 CryptoResult。
    pub async fn run_crypto(
        &self,
        plugin_id: &str,
        algorithm_id: &str,
        mode: &str,
        input: &str,
        params_json: &str,
    ) -> Result<crate::plugin_runtime::CryptoResult, String> {
        let cached = {
            let cache = self.cache.read().await;
            cache
                .modules
                .get(plugin_id)
                .ok_or_else(|| format!("WASM 插件 '{}' 未加载，请先调用 load_plugin", plugin_id))?
                .clone()
        };

        let algo_owned = algorithm_id.to_string();
        let mode_owned = mode.to_string();
        let input_owned = input.to_string();
        let params_owned = params_json.to_string();

        tokio::task::spawn_blocking(move || {
            execute_crypto(
                &cached.engine,
                &cached.module,
                &algo_owned,
                &mode_owned,
                &input_owned,
                &params_owned,
            )
        })
        .await
        .map_err(|e| format!("WASM 执行任务失败: {}", e))?
    }

    /// List all loaded WASM plugins.
    pub async fn list_loaded(&self) -> Vec<WasmPluginInfo> {
        let cache = self.cache.read().await;
        cache.modules.values().map(|c| c.info.clone()).collect()
    }

    /// Scan plugins directory for .wasm files and try to load them.
    #[cfg(test)]
    async fn scan_and_load(&self) -> Vec<String> {
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

    /// Resolve the exact WASM entrypoint declared by this plugin's manifest.
    /// Auxiliary `.wasm` files in JavaScript plugins and directory iteration
    /// order must never decide which code is compiled.
    async fn find_wasm_file(&self, plugin_id: &str) -> Result<PathBuf, String> {
        validate_plugin_id(plugin_id)?;
        let plugin_dir = self.plugins_dir.join(plugin_id);
        let plugin_dir_metadata = tokio::fs::symlink_metadata(&plugin_dir)
            .await
            .map_err(|e| format!("读取插件目录元数据失败: {}", e))?;
        if plugin_dir_metadata.file_type().is_symlink() || !plugin_dir_metadata.is_dir() {
            return Err(format!("插件 '{}' 的目录不是普通目录", plugin_id));
        }

        let manifest_content = tokio::fs::read_to_string(plugin_dir.join("manifest.json"))
            .await
            .map_err(|e| format!("读取插件 manifest 失败: {}", e))?;
        let manifest_content = manifest_content
            .strip_prefix('\u{feff}')
            .unwrap_or(&manifest_content);
        let manifest: PluginManifest = serde_json::from_str(manifest_content)
            .map_err(|e| format!("解析插件 manifest 失败: {}", e))?;
        if manifest.id != plugin_id {
            return Err(format!(
                "插件目录 '{}' 的 manifest ID 为 '{}'",
                plugin_id, manifest.id
            ));
        }
        if Path::new(&manifest.entrypoint)
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("wasm")
        {
            return Err(format!(
                "插件 '{}' 的 manifest entrypoint '{}' 不是 WASM",
                plugin_id, manifest.entrypoint
            ));
        }

        validate_plugin_entrypoint(&plugin_dir, &manifest.entrypoint).await?;
        tokio::fs::canonicalize(plugin_dir.join(&manifest.entrypoint))
            .await
            .map_err(|e| format!("规范化 WASM entrypoint 失败: {}", e))
    }
}

// ── Internal helpers ──

/// Compile a WASM module and query its plugin_info export.
fn compile_and_query_info(wasm_bytes: &[u8], fallback_id: &str) -> Result<CachedModule, String> {
    // 启用 fuel 资源限制，防止恶意 WASM 插件无限循环或消耗过量资源
    let mut config = wasmtime::Config::new();
    config.consume_fuel(true);
    let engine = Engine::new(&config).map_err(|e| format!("WASM 引擎创建失败: {}", e))?;
    let module = Module::new(&engine, wasm_bytes).map_err(|e| format!("WASM 编译失败: {}", e))?;

    // Try to get plugin info by calling plugin_info()
    let info = match call_plugin_info(&engine, &module) {
        Ok(info) => {
            if info.id != fallback_id {
                return Err(format!(
                    "WASM plugin_info ID '{}' 与 manifest ID '{}' 不一致",
                    info.id, fallback_id
                ));
            }
            info
        }
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
    store
        .set_fuel(1_000_000)
        .map_err(|e| format!("fuel 设置失败: {}", e))?;
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
    let info: WasmPluginInfo = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 plugin_info JSON 失败: {}", e))?;

    Ok(info)
}

/// Execute the parse(ptr, len) -> ptr export.
fn execute_parse(engine: &Engine, module: &Module, raw_data: &str) -> Result<ParseResult, String> {
    let mut store = Store::new(engine, ());
    // 为 parse 执行分配充裕的 fuel 限制（10M 指令级别）
    store
        .set_fuel(10_000_000)
        .map_err(|e| format!("fuel 设置失败: {}", e))?;
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
#[allow(dead_code)]
fn execute_render(
    engine: &Engine,
    module: &Module,
    base64_data: &str,
) -> Result<crate::plugin_runtime::RenderResult, String> {
    let mut store = Store::new(engine, ());
    // 渲染操作可能需要更多资源（Excel 解析等），给予更多 fuel
    store
        .set_fuel(50_000_000)
        .map_err(|e| format!("fuel 设置失败: {}", e))?;
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

/// Execute the crypto(ptr, len) -> ptr export for crypto-tool plugins.
///
/// 请求 JSON 形如：{ "algorithmId": "...", "mode": "encrypt"|"decrypt",
/// "input": "...", "params": { ... } }，其中 params 为解析后的对象（与 JS
/// crypto 路径传给 encrypt/decrypt 的第三个参数一致）。返回 JSON 解析为 CryptoResult。
fn execute_crypto(
    engine: &Engine,
    module: &Module,
    algorithm_id: &str,
    mode: &str,
    input: &str,
    params_json: &str,
) -> Result<crate::plugin_runtime::CryptoResult, String> {
    let mut store = Store::new(engine, ());
    // crypto 运算（哈希/分组密码等）可能较重，给予与 render 同量级（50M）的 fuel
    store
        .set_fuel(50_000_000)
        .map_err(|e| format!("fuel 设置失败: {}", e))?;
    let linker = Linker::new(engine);
    let instance = linker
        .instantiate(&mut store, module)
        .map_err(|e| format!("WASM 实例化失败: {}", e))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or("找不到 memory 导出")?;

    // 将 params JSON 字符串解析为结构化对象：空串/纯空白退化为 null，
    // 但格式错误必须报错——静默吞掉会丢失 IV/key/mode 等必需字段，导致输出错误。
    let params_value: serde_json::Value = if params_json.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(params_json)
            .map_err(|e| format!("解析 crypto 参数 JSON 失败: {}", e))?
    };

    // 组装请求 JSON 块
    let request = serde_json::json!({
        "algorithmId": algorithm_id,
        "mode": mode,
        "input": input,
        "params": params_value,
    });
    let request_json =
        serde_json::to_string(&request).map_err(|e| format!("序列化 crypto 请求失败: {}", e))?;

    let input_bytes = request_json.as_bytes();
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

    // 调用 guest 导出的 crypto(ptr, len) -> ptr；兼容备用导出名 run_crypto
    let crypto = instance
        .get_typed_func::<(i32, i32), i32>(&mut store, "crypto")
        .or_else(|_| instance.get_typed_func::<(i32, i32), i32>(&mut store, "run_crypto"))
        .map_err(|e| format!("找不到 crypto/run_crypto 导出: {}", e))?;

    let result_ptr = crypto
        .call(&mut store, (input_ptr, input_len))
        .map_err(|e| format!("crypto 调用失败: {}", e))?;

    let result_json = read_guest_string(&store, &memory, result_ptr as u32)?;

    if let Ok(dealloc) = instance.get_typed_func::<(i32, i32), ()>(&mut store, "dealloc") {
        let _ = dealloc.call(&mut store, (input_ptr, input_len));
    }

    let result: crate::plugin_runtime::CryptoResult = serde_json::from_str(&result_json)
        .map_err(|e| format!("解析 crypto 结果 JSON 失败: {}", e))?;

    Ok(result)
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

    let len = u32::from_le_bytes([data[ptr], data[ptr + 1], data[ptr + 2], data[ptr + 3]]) as usize;

    if len > MAX_GUEST_STRING {
        return Err(format!(
            "guest 字符串长度 {} 超过最大限制 {}MB",
            len,
            MAX_GUEST_STRING / 1024 / 1024
        ));
    }

    if ptr + 4 + len > data.len() {
        return Err(format!("字符串长度 {} 超出内存边界", len));
    }

    String::from_utf8(data[ptr + 4..ptr + 4 + len].to_vec())
        .map_err(|e| format!("UTF-8 解码失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Notify;

    fn test_module(plugin_id: &str) -> CachedModule {
        compile_and_query_info(b"(module)", plugin_id).unwrap()
    }

    fn wasm_test_root(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "protoforge-wasm-{}-{}",
            test_name,
            uuid::Uuid::new_v4()
        ))
    }

    async fn write_test_manifest(plugin_dir: &Path, plugin_id: &str, entrypoint: &str) {
        let manifest = serde_json::json!({
            "id": plugin_id,
            "name": plugin_id,
            "version": "1.0.0",
            "description": "test plugin",
            "author": "test",
            "type": "protocol-parser",
            "icon": "test",
            "entrypoint": entrypoint
        });
        tokio::fs::write(
            plugin_dir.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn manifest_selects_exact_wasm_entrypoint() {
        let root = wasm_test_root("exact-entrypoint");
        let plugin_dir = root.join("plugins").join("demo-plugin");
        tokio::fs::create_dir_all(&plugin_dir).await.unwrap();
        write_test_manifest(&plugin_dir, "demo-plugin", "chosen.wasm").await;
        tokio::fs::write(plugin_dir.join("first.wasm"), b"wrong")
            .await
            .unwrap();
        tokio::fs::write(plugin_dir.join("chosen.wasm"), b"right")
            .await
            .unwrap();

        let runtime = WasmPluginRuntime::new(&root);
        let resolved = runtime.find_wasm_file("demo-plugin").await.unwrap();
        assert_eq!(
            resolved,
            plugin_dir.join("chosen.wasm").canonicalize().unwrap()
        );

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn javascript_manifest_with_auxiliary_wasm_is_not_a_wasm_plugin() {
        let root = wasm_test_root("js-auxiliary-wasm");
        let plugin_dir = root.join("plugins").join("demo-plugin");
        tokio::fs::create_dir_all(&plugin_dir).await.unwrap();
        write_test_manifest(&plugin_dir, "demo-plugin", "index.js").await;
        tokio::fs::write(plugin_dir.join("index.js"), "function parse() {}")
            .await
            .unwrap();
        tokio::fs::write(plugin_dir.join("helper.wasm"), b"helper")
            .await
            .unwrap();

        let runtime = WasmPluginRuntime::new(&root);
        let error = runtime.find_wasm_file("demo-plugin").await.unwrap_err();
        assert!(error.contains("不是 WASM"));
        assert!(runtime.scan_and_load().await.is_empty());

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn wasm_manifest_id_must_match_directory() {
        let root = wasm_test_root("manifest-id-mismatch");
        let plugin_dir = root.join("plugins").join("demo-plugin");
        tokio::fs::create_dir_all(&plugin_dir).await.unwrap();
        write_test_manifest(&plugin_dir, "another-plugin", "index.wasm").await;
        tokio::fs::write(plugin_dir.join("index.wasm"), b"module")
            .await
            .unwrap();

        let runtime = WasmPluginRuntime::new(&root);
        let error = runtime.find_wasm_file("demo-plugin").await.unwrap_err();
        assert!(error.contains("manifest ID"));

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn wasm_plugin_info_id_must_match_manifest_id() {
        let json = serde_json::json!({
            "id": "another-plugin",
            "name": "Another",
            "version": "1.0.0",
            "description": "test",
            "author": "test"
        })
        .to_string();
        let mut guest_string = (json.len() as u32).to_le_bytes().to_vec();
        guest_string.extend_from_slice(json.as_bytes());
        let wat_data = guest_string
            .iter()
            .map(|byte| format!("\\{:02x}", byte))
            .collect::<String>();
        let wat = format!(
            "(module (memory (export \"memory\") 1) \
             (data (i32.const 0) \"{}\") \
             (func (export \"plugin_info\") (result i32) i32.const 0))",
            wat_data
        );

        let error = compile_and_query_info(wat.as_bytes(), "demo-plugin")
            .err()
            .expect("mismatched plugin_info ID must fail");
        assert!(error.contains("another-plugin"));
        assert!(error.contains("demo-plugin"));
    }

    #[tokio::test]
    async fn unload_plugin_removes_compiled_module_from_cache() {
        let runtime = WasmPluginRuntime::new(&std::env::temp_dir());
        let cached = test_module("demo-plugin");
        runtime
            .cache
            .write()
            .await
            .modules
            .insert("demo-plugin".to_string(), Arc::new(cached));

        assert!(
            runtime
                .cache
                .read()
                .await
                .modules
                .contains_key("demo-plugin")
        );
        runtime.unload_plugin("demo-plugin").await.unwrap();
        assert!(
            !runtime
                .cache
                .read()
                .await
                .modules
                .contains_key("demo-plugin")
        );
    }

    #[tokio::test]
    async fn slow_load_cannot_reinsert_after_unload() {
        let runtime = Arc::new(WasmPluginRuntime::new(&std::env::temp_dir()));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let load_task = {
            let runtime = Arc::clone(&runtime);
            let entered = Arc::clone(&entered);
            let release = Arc::clone(&release);
            tokio::spawn(async move {
                runtime
                    .load_plugin_with("demo-plugin", async move {
                        entered.notify_one();
                        release.notified().await;
                        Ok(test_module("demo-plugin"))
                    })
                    .await
            })
        };

        entered.notified().await;
        runtime.unload_plugin("demo-plugin").await.unwrap();
        release.notify_one();

        let error = load_task.await.unwrap().unwrap_err();
        assert!(error.contains("已卸载或升级"));
        assert!(runtime.list_loaded().await.is_empty());
    }

    #[tokio::test]
    async fn upgrade_boundaries_reject_loads_before_and_during_switch() {
        let runtime = Arc::new(WasmPluginRuntime::new(&std::env::temp_dir()));

        let before_entered = Arc::new(Notify::new());
        let before_release = Arc::new(Notify::new());
        let before_task = {
            let runtime = Arc::clone(&runtime);
            let entered = Arc::clone(&before_entered);
            let release = Arc::clone(&before_release);
            tokio::spawn(async move {
                runtime
                    .load_plugin_with("demo-plugin", async move {
                        entered.notify_one();
                        release.notified().await;
                        Ok(test_module("demo-plugin"))
                    })
                    .await
            })
        };
        before_entered.notified().await;

        // Transaction start invalidates loads that began against the previous
        // directory while retaining any already-cached old module for rollback.
        runtime
            .invalidate_inflight_loads("demo-plugin")
            .await
            .unwrap();

        let during_entered = Arc::new(Notify::new());
        let during_release = Arc::new(Notify::new());
        let during_task = {
            let runtime = Arc::clone(&runtime);
            let entered = Arc::clone(&during_entered);
            let release = Arc::clone(&during_release);
            tokio::spawn(async move {
                runtime
                    .load_plugin_with("demo-plugin", async move {
                        entered.notify_one();
                        release.notified().await;
                        Ok(test_module("demo-plugin"))
                    })
                    .await
            })
        };
        during_entered.notified().await;

        // A successful atomic switch removes the old cache and invalidates
        // loads that started anywhere inside the transaction window.
        runtime.unload_plugin("demo-plugin").await.unwrap();
        before_release.notify_one();
        during_release.notify_one();

        assert!(before_task.await.unwrap().is_err());
        assert!(during_task.await.unwrap().is_err());
        assert!(runtime.list_loaded().await.is_empty());
    }

    #[tokio::test]
    async fn failed_upgrade_boundary_keeps_cached_old_module() {
        let runtime = WasmPluginRuntime::new(&std::env::temp_dir());
        runtime.cache.write().await.modules.insert(
            "demo-plugin".to_string(),
            Arc::new(test_module("demo-plugin")),
        );

        runtime
            .invalidate_inflight_loads("demo-plugin")
            .await
            .unwrap();

        assert_eq!(runtime.list_loaded().await.len(), 1);
    }

    #[tokio::test]
    async fn invalid_plugin_ids_do_not_create_generation_entries() {
        let runtime = WasmPluginRuntime::new(&std::env::temp_dir());

        assert!(runtime.unload_plugin("../invalid").await.is_err());
        assert!(
            runtime
                .invalidate_inflight_loads(".uninstall-invalid")
                .await
                .is_err()
        );
        assert!(runtime.cache.read().await.generations.is_empty());
    }
}
