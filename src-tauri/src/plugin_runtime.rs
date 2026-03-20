use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

use boa_engine::{Context, Source, JsError};
use flate2::read::GzDecoder;
use serde::{Serialize, Deserialize};
use tokio::sync::RwLock;

// ── Plugin Types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginType {
    ProtocolParser,
    UiPanel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(rename = "type")]
    pub plugin_type: PluginType,
    pub icon: String,
    pub entrypoint: String,
    #[serde(default)]
    pub protocol_ids: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Runtime-computed: whether the plugin is installed
    #[serde(default)]
    pub installed: bool,
    /// Remote download URL (only present for remote plugins)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    /// Source of this plugin: "builtin" or "remote"
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "builtin".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolParser {
    pub plugin_id: String,
    pub protocol_id: String,
    pub plugin_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedField {
    pub key: String,
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub success: bool,
    pub protocol_name: String,
    pub summary: String,
    pub fields: Vec<ParsedField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Remote Registry ──

/// Registry JSON format from remote
#[derive(Debug, Deserialize)]
struct RemoteRegistry {
    #[serde(default)]
    plugins: Vec<RemotePluginEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePluginEntry {
    id: String,
    name: String,
    version: String,
    description: String,
    author: String,
    #[serde(rename = "type")]
    plugin_type: PluginType,
    icon: String,
    entrypoint: String,
    #[serde(default)]
    protocol_ids: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    download_url: String,
}

impl RemotePluginEntry {
    fn into_manifest(self) -> PluginManifest {
        PluginManifest {
            id: self.id,
            name: self.name,
            version: self.version,
            description: self.description,
            author: self.author,
            plugin_type: self.plugin_type,
            icon: self.icon,
            entrypoint: self.entrypoint,
            protocol_ids: self.protocol_ids,
            tags: self.tags,
            installed: false,
            download_url: Some(self.download_url),
            source: "remote".to_string(),
        }
    }
}

/// Default registry URL — configurable in the future via settings
const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/registry.json";

// ── Plugin Runtime Dispatch ──
// 统一插件运行时：通过注册表动态分发，零硬编码。
// 支持三种运行时：Native (Rust fn) / JavaScript (boa_engine) / WASM (wasmtime)

/// 插件运行时类型
pub enum ParserRuntime {
    /// Rust 原生函数指针 — 零开销，最快
    Native(fn(&str) -> ParseResult),
    /// JavaScript 脚本 (boa_engine 解释执行)
    JavaScript,
    /// WASM 模块 (wasmtime JIT)
    Wasm,
}

/// 注册到统一注册表中的插件条目
pub struct RegisteredPlugin {
    pub manifest: PluginManifest,
    pub runtime: ParserRuntime,
}

// ── Plugin Manager ──

pub struct PluginManager {
    plugins_dir: PathBuf,
    /// 统一插件注册表：包含所有已注册的插件（native + installed JS/WASM）
    registry: RwLock<HashMap<String, RegisteredPlugin>>,
    /// Cached remote registry manifests (refreshed on demand)
    remote_cache: RwLock<Option<Vec<PluginManifest>>>,
    /// Registry URL
    registry_url: String,
}

impl PluginManager {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let plugins_dir = app_data_dir.join("plugins");
        Self {
            plugins_dir,
            registry: RwLock::new(HashMap::new()),
            remote_cache: RwLock::new(None),
            registry_url: DEFAULT_REGISTRY_URL.to_string(),
        }
    }

    /// 注册一个 Rust 原生解析器到统一注册表。
    /// 在 lib.rs 启动时调用，完全可拓展 — 新增解析器无需修改 PluginManager 代码。
    pub async fn register_native(
        &self,
        manifest: PluginManifest,
        parse_fn: fn(&str) -> ParseResult,
    ) {
        let id = manifest.id.clone();
        self.registry.write().await.insert(id, RegisteredPlugin {
            manifest,
            runtime: ParserRuntime::Native(parse_fn),
        });
    }

    /// 扫描插件目录，加载所有已安装的 JS/WASM 插件到注册表。
    /// 注意：native 插件通过 register_native() 单独注册，不在此处理。
    pub async fn scan_installed(&self) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.plugins_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        let mut entries = tokio::fs::read_dir(&self.plugins_dir)
            .await
            .map_err(|e| format!("读取插件目录失败: {}", e))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }

            match tokio::fs::read_to_string(&manifest_path).await {
                Ok(content) => {
                    match serde_json::from_str::<PluginManifest>(&content) {
                        Ok(mut manifest) => {
                            manifest.installed = true;
                            let id = manifest.id.clone();
                            // 不覆盖已注册的 native 插件
                            let mut reg = self.registry.write().await;
                            if !reg.contains_key(&id) {
                                // 根据 entrypoint 扩展名决定运行时
                                let runtime = if manifest.entrypoint.ends_with(".wasm") {
                                    ParserRuntime::Wasm
                                } else {
                                    ParserRuntime::JavaScript
                                };
                                reg.insert(id, RegisteredPlugin { manifest, runtime });
                            }
                        }
                        Err(e) => {
                            log::warn!("解析插件 manifest 失败 {:?}: {}", manifest_path, e);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("读取插件 manifest 失败 {:?}: {}", manifest_path, e);
                }
            }
        }

        Ok(())
    }

    /// List all installed plugins.
    pub async fn list_installed(&self) -> Vec<PluginManifest> {
        let reg = self.registry.read().await;
        reg.values().map(|r| r.manifest.clone()).collect()
    }

    /// Refresh remote registry — fetch from remote URL and cache.
    /// Returns the number of remote plugins found.
    pub async fn refresh_registry(&self) -> Result<usize, String> {
        log::info!("正在从远程仓库刷新插件注册表: {}", self.registry_url);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let resp = client
            .get(&self.registry_url)
            .send()
            .await
            .map_err(|e| format!("获取远程注册表失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("远程注册表返回 HTTP {}", resp.status()));
        }

        let registry: RemoteRegistry = resp
            .json()
            .await
            .map_err(|e| format!("解析远程注册表 JSON 失败: {}", e))?;

        let manifests: Vec<PluginManifest> = registry
            .plugins
            .into_iter()
            .map(|e| e.into_manifest())
            .collect();

        let count = manifests.len();
        *self.remote_cache.write().await = Some(manifests);

        log::info!("远程注册表刷新成功，共 {} 个插件", count);
        Ok(count)
    }

    /// List all available plugins: merge built-in + remote, mark installed.
    /// Tries remote cache first; if empty, fetches from remote.
    /// List all available plugins: merge registered + remote, mark installed.
    pub async fn list_available(&self) -> Vec<PluginManifest> {
        // Try to refresh remote if not cached
        {
            let cache = self.remote_cache.read().await;
            if cache.is_none() {
                drop(cache);
                let _ = self.refresh_registry().await;
            }
        }

        let registry = self.registry.read().await;
        let remote_cache = self.remote_cache.read().await;

        let mut all_plugins: HashMap<String, PluginManifest> = HashMap::new();

        // 1. 注册表中的插件（已安装，包含 native/JS/WASM）
        for (id, rp) in registry.iter() {
            all_plugins.insert(id.clone(), rp.manifest.clone());
        }

        // 2. 远程仓库中的插件
        if let Some(remote_plugins) = remote_cache.as_ref() {
            for p in remote_plugins {
                all_plugins.entry(p.id.clone()).or_insert(p.clone());
            }
        }

        // Mark installed
        all_plugins
            .into_values()
            .map(|mut m| {
                m.installed = registry.contains_key(&m.id);
                m
            })
            .collect()
    }

    /// Install a plugin by its ID.
    pub async fn install(&self, plugin_id: &str) -> Result<PluginManifest, String> {
        // 检查是否已在注册表中
        {
            let reg = self.registry.read().await;
            if reg.contains_key(plugin_id) {
                return Err(format!("插件 '{}' 已安装", plugin_id));
            }
        }

        // Try remote
        let download_url = {
            let cache = self.remote_cache.read().await;
            cache
                .as_ref()
                .and_then(|ps| ps.iter().find(|p| p.id == plugin_id))
                .and_then(|p| p.download_url.clone())
        };

        if let Some(url) = download_url {
            return self.install_from_remote(plugin_id, &url).await;
        }

        Err(format!("插件 '{}' 在仓库中不存在", plugin_id))
    }



    /// Install from remote URL (download .tar.gz and extract)
    async fn install_from_remote(
        &self,
        plugin_id: &str,
        download_url: &str,
    ) -> Result<PluginManifest, String> {
        log::info!("正在从远程下载插件: {} → {}", plugin_id, download_url);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let resp = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("下载插件失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("下载插件返回 HTTP {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取下载数据失败: {}", e))?;

        // Determine if it's a tar.gz or a single JS file
        let plugin_dir = self.plugins_dir.join(plugin_id);
        tokio::fs::create_dir_all(&plugin_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        // Try to extract as tar.gz first
        let bytes_vec = bytes.to_vec();
        let plugin_dir_clone = plugin_dir.clone();

        let extract_result = tokio::task::spawn_blocking(move || {
            extract_tar_gz(&bytes_vec, &plugin_dir_clone)
        })
        .await
        .map_err(|e| format!("解压任务失败: {}", e))?;

        if let Err(tar_err) = extract_result {
            // If tar.gz extraction fails, try treating it as raw JSON/JS content
            // This handles the case where the download URL points to a single file
            log::warn!("tar.gz 解压失败 ({}), 尝试作为原始文件处理", tar_err);

            // Check if we have manifest + script in the directory already
            if !plugin_dir.join("manifest.json").exists() {
                // Clean up and report error
                let _ = tokio::fs::remove_dir_all(&plugin_dir).await;
                return Err(format!("插件下载格式无效: {}", tar_err));
            }
        }

        // Read the manifest from the extracted directory
        let manifest_path = plugin_dir.join("manifest.json");
        let manifest_content = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| format!("读取已安装插件 manifest 失败: {}", e))?;

        let mut manifest: PluginManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("解析已安装插件 manifest 失败: {}", e))?;

        manifest.installed = true;
        manifest.source = "remote".to_string();

        // 根据 entrypoint 确定运行时类型
        let runtime = if manifest.entrypoint.ends_with(".wasm") {
            ParserRuntime::Wasm
        } else {
            ParserRuntime::JavaScript
        };

        self.registry
            .write()
            .await
            .insert(plugin_id.to_string(), RegisteredPlugin {
                manifest: manifest.clone(),
                runtime,
            });

        log::info!("远程插件安装成功: {}", plugin_id);
        Ok(manifest)
    }

    /// Uninstall a plugin by removing its directory.
    pub async fn uninstall(&self, plugin_id: &str) -> Result<(), String> {
        // 检查是否为 native 插件（不可卸载）
        {
            let reg = self.registry.read().await;
            if let Some(rp) = reg.get(plugin_id) {
                if matches!(rp.runtime, ParserRuntime::Native(_)) {
                    return Err(format!("插件 '{}' 是内置原生解析器，无法卸载", plugin_id));
                }
            } else {
                return Err(format!("插件 '{}' 未安装", plugin_id));
            }
        }

        let plugin_dir = self.plugins_dir.join(plugin_id);
        if plugin_dir.exists() {
            tokio::fs::remove_dir_all(&plugin_dir)
                .await
                .map_err(|e| format!("删除插件目录失败: {}", e))?;
        }

        self.registry.write().await.remove(plugin_id);
        Ok(())
    }

    /// Get all protocol parsers from installed plugins.
    pub async fn get_protocol_parsers(&self) -> Vec<ProtocolParser> {
        let reg = self.registry.read().await;
        let mut parsers = Vec::new();

        for rp in reg.values() {
            if rp.manifest.plugin_type == PluginType::ProtocolParser {
                let manifest = &rp.manifest;
                for protocol_id in &manifest.protocol_ids {
                    parsers.push(ProtocolParser {
                        plugin_id: manifest.id.clone(),
                        protocol_id: protocol_id.clone(),
                        plugin_name: manifest.name.clone(),
                    });
                }
            }
        }

        parsers
    }

    /// Execute a plugin's parse function on raw data.
    /// 通过统一注册表动态分发到正确的运行时，零硬编码。
    pub async fn parse_data(
        &self,
        plugin_id: &str,
        raw_data: &str,
    ) -> Result<ParseResult, String> {
        // 从注册表查找插件及其运行时类型
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            // Rust 原生函数指针 — 直接调用，零开销
            ParserRuntime::Native(parse_fn) => {
                let f = *parse_fn;
                drop(reg); // 释放锁
                Ok(f(raw_data))
            }
            // JavaScript — boa_engine 解释执行
            ParserRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let raw_data = raw_data.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_parse_script(&script, &raw_data)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            // WASM — wasmtime JIT（委托给 WasmPluginRuntime）
            ParserRuntime::Wasm => {
                drop(reg);
                // WASM 执行通过独立的 WasmPluginRuntime 处理
                Err(format!("WASM 插件 '{}' 请通过 wasm_parse_data 命令调用", plugin_id))
            }
        }
    }
}

// ── tar.gz extraction ──

/// Extract a .tar.gz archive into the target directory.
fn extract_tar_gz(data: &[u8], target_dir: &std::path::Path) -> Result<(), String> {
    let gz = GzDecoder::new(data);
    let mut archive = tar::Archive::new(gz);

    for entry_result in archive.entries().map_err(|e| format!("读取 tar 条目失败: {}", e))? {
        let mut entry = entry_result.map_err(|e| format!("读取 tar 条目失败: {}", e))?;
        let path = entry.path().map_err(|e| format!("获取条目路径失败: {}", e))?;

        // Strip the first component if the archive has a root directory
        // e.g., "hj212-parser/manifest.json" → "manifest.json"
        let relative: PathBuf = path
            .components()
            .skip(1) // skip root dir in archive
            .collect();

        // If stripping leaves nothing, use the original path
        let relative = if relative.as_os_str().is_empty() {
            path.to_path_buf()
        } else {
            relative
        };

        let target_path = target_dir.join(&relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&target_path)
                .map_err(|e| format!("创建目录失败 {:?}: {}", target_path, e))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败 {:?}: {}", parent, e))?;
            }

            let mut file_data = Vec::new();
            entry.read_to_end(&mut file_data)
                .map_err(|e| format!("读取条目数据失败: {}", e))?;

            std::fs::write(&target_path, &file_data)
                .map_err(|e| format!("写入文件失败 {:?}: {}", target_path, e))?;
        }
    }

    Ok(())
}

// ── JS execution ──

/// Execute a JS plugin script in a sandboxed boa_engine context.
fn execute_parse_script(script: &str, raw_data: &str) -> Result<ParseResult, String> {
    let mut context = Context::default();

    // Execute the plugin script (defines the parse function)
    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    // Build the call: parse("raw_data_escaped")
    let escaped = raw_data
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");

    let call_script = format!("JSON.stringify(parse(\"{}\"))", escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 parse() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "parse() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: ParseResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

fn format_js_error(err: &JsError) -> String {
    format!("{}", err)
}
