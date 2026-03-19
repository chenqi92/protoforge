use std::collections::HashMap;
use std::path::PathBuf;

use boa_engine::{Context, Source, JsError};
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

// ── Built-in Plugin Registry ──

/// Built-in plugins are embedded at compile time.
/// These serve as the "official plugin store".
struct BuiltinPlugin {
    manifest_json: &'static str,
    script_js: &'static str,
}

fn get_builtin_plugins() -> Vec<BuiltinPlugin> {
    vec![
        BuiltinPlugin {
            manifest_json: include_str!("builtin_plugins/hj212-parser/manifest.json"),
            script_js: include_str!("builtin_plugins/hj212-parser/index.js"),
        },
        BuiltinPlugin {
            manifest_json: include_str!("builtin_plugins/sfjk200-parser/manifest.json"),
            script_js: include_str!("builtin_plugins/sfjk200-parser/index.js"),
        },
    ]
}

// ── Plugin Manager ──

pub struct PluginManager {
    plugins_dir: PathBuf,
    /// Cache of installed plugin manifests
    installed: RwLock<HashMap<String, PluginManifest>>,
}

impl PluginManager {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let plugins_dir = app_data_dir.join("plugins");
        Self {
            plugins_dir,
            installed: RwLock::new(HashMap::new()),
        }
    }

    /// Scan the plugins directory and load all installed plugin manifests.
    pub async fn scan_installed(&self) -> Result<(), String> {
        // Ensure plugins directory exists
        tokio::fs::create_dir_all(&self.plugins_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        let mut manifests = HashMap::new();

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
                            manifests.insert(manifest.id.clone(), manifest);
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

        *self.installed.write().await = manifests;
        Ok(())
    }

    /// List all installed plugins.
    pub async fn list_installed(&self) -> Vec<PluginManifest> {
        let map = self.installed.read().await;
        map.values().cloned().collect()
    }

    /// List all available plugins from the built-in registry,
    /// marking those that are already installed.
    pub async fn list_available(&self) -> Vec<PluginManifest> {
        let installed = self.installed.read().await;
        let builtins = get_builtin_plugins();

        builtins
            .into_iter()
            .filter_map(|bp| {
                serde_json::from_str::<PluginManifest>(bp.manifest_json)
                    .ok()
                    .map(|mut m| {
                        m.installed = installed.contains_key(&m.id);
                        m
                    })
            })
            .collect()
    }

    /// Install a plugin from the built-in registry by its ID.
    pub async fn install(&self, plugin_id: &str) -> Result<PluginManifest, String> {
        // Check if already installed
        {
            let map = self.installed.read().await;
            if map.contains_key(plugin_id) {
                return Err(format!("插件 '{}' 已安装", plugin_id));
            }
        }

        // Find in built-in registry
        let builtins = get_builtin_plugins();
        let builtin = builtins
            .iter()
            .find(|bp| {
                serde_json::from_str::<PluginManifest>(bp.manifest_json)
                    .ok()
                    .map_or(false, |m| m.id == plugin_id)
            })
            .ok_or_else(|| format!("插件 '{}' 在仓库中不存在", plugin_id))?;

        let mut manifest: PluginManifest =
            serde_json::from_str(builtin.manifest_json).map_err(|e| e.to_string())?;

        // Create plugin directory
        let plugin_dir = self.plugins_dir.join(plugin_id);
        tokio::fs::create_dir_all(&plugin_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        // Write manifest
        tokio::fs::write(
            plugin_dir.join("manifest.json"),
            builtin.manifest_json.as_bytes(),
        )
        .await
        .map_err(|e| format!("写入 manifest 失败: {}", e))?;

        // Write script
        tokio::fs::write(
            plugin_dir.join(&manifest.entrypoint),
            builtin.script_js.as_bytes(),
        )
        .await
        .map_err(|e| format!("写入脚本失败: {}", e))?;

        manifest.installed = true;

        // Cache
        self.installed
            .write()
            .await
            .insert(plugin_id.to_string(), manifest.clone());

        Ok(manifest)
    }

    /// Uninstall a plugin by removing its directory.
    pub async fn uninstall(&self, plugin_id: &str) -> Result<(), String> {
        {
            let map = self.installed.read().await;
            if !map.contains_key(plugin_id) {
                return Err(format!("插件 '{}' 未安装", plugin_id));
            }
        }

        let plugin_dir = self.plugins_dir.join(plugin_id);
        if plugin_dir.exists() {
            tokio::fs::remove_dir_all(&plugin_dir)
                .await
                .map_err(|e| format!("删除插件目录失败: {}", e))?;
        }

        self.installed.write().await.remove(plugin_id);
        Ok(())
    }

    /// Get all protocol parsers from installed plugins.
    pub async fn get_protocol_parsers(&self) -> Vec<ProtocolParser> {
        let map = self.installed.read().await;
        let mut parsers = Vec::new();

        for manifest in map.values() {
            if manifest.plugin_type == PluginType::ProtocolParser {
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
    pub async fn parse_data(
        &self,
        plugin_id: &str,
        raw_data: &str,
    ) -> Result<ParseResult, String> {
        // Read the plugin script
        let script_path = {
            let map = self.installed.read().await;
            let manifest = map
                .get(plugin_id)
                .ok_or_else(|| format!("插件 '{}' 未安装", plugin_id))?;
            self.plugins_dir.join(plugin_id).join(&manifest.entrypoint)
        };

        let script = tokio::fs::read_to_string(&script_path)
            .await
            .map_err(|e| format!("读取插件脚本失败: {}", e))?;

        // Clone raw_data for move into blocking task
        let raw_data = raw_data.to_string();

        // Execute in a blocking task to avoid blocking the async runtime
        let result = tokio::task::spawn_blocking(move || {
            execute_parse_script(&script, &raw_data)
        })
        .await
        .map_err(|e| format!("执行插件失败: {}", e))??;

        Ok(result)
    }
}

/// Execute a JS plugin script in a sandboxed boa_engine context.
///
/// The script must define a `parse(rawData)` function that returns:
/// ```js
/// {
///   success: true,
///   protocolName: "HJ212",
///   summary: "数据采集上报",
///   fields: [
///     { key: "w01018", label: "COD", value: "12.5", unit: "mg/L", group: "污染物" },
///   ],
///   rawHex: "optional hex dump"
/// }
/// ```
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
