use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::time::Instant;

use boa_engine::{Context, Source, JsError};
use flate2::read::GzDecoder;
use serde::{Serialize, Deserialize};
use tokio::sync::{Mutex, RwLock};

// ── Plugin Types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginType {
    /// 协议解析器 — 解析原始报文为结构化数据
    ProtocolParser,
    /// 请求钩子 — 请求发送前/后的处理（签名、加密、Token 注入）
    RequestHook,
    /// 响应渲染器 — 自定义渲染响应数据（图表、HEX、树形）
    ResponseRenderer,
    /// 数据生成器 — Mock 数据、随机值、模板填充
    DataGenerator,
    /// 导出格式 — 自定义导出（cURL、HTTPie、代码片段）
    ExportFormat,
    /// 侧边栏面板 — 独立功能面板（监控、日志、统计）
    SidebarPanel,
    /// 加密工具 — 编码/解码、哈希、对称加密等
    CryptoTool,
    /// 图标包 — 提供自定义图标库（如 iconfont）
    IconPack,
    /// 未知类型 — 向前兼容，旧版本 app 遇到新插件类型时不会崩溃
    #[serde(other)]
    Unknown,
}

/// 插件可翻译字段
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginI18nEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    #[serde(alias = "type")]
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
    /// 插件声明的扩展点贡献 (类似 VS Code contributes)
    #[serde(default)]
    pub contributes: PluginContributes,
    /// 多语言翻译 — 键为语言代码 ("en"), 值为可翻译字段
    #[serde(default)]
    pub i18n: HashMap<String, PluginI18nEntry>,
    /// 是否有可用更新（仅用于前端展示, 运行时计算）
    #[serde(default)]
    pub has_update: bool,
    /// 远程仓库中的最新版本号（有更新时填充）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    /// 面板位置声明: "left" / "right" / "both"。未设置时按 pluginType 推断
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_position: Option<String>,
    /// 图标命名空间 — 仅 icon-pack 类型插件使用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_namespace: Option<String>,
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
    pub value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// UI 渲染类型提示: text | badge | status-dot | code | json | bit-map
    #[serde(skip_serializing_if = "Option::is_none", rename = "uiType")]
    pub ui_type: Option<String>,
    /// 色彩语义: emerald | amber | red | blue | purple | slate
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 是否提取到顶部摘要卡片
    #[serde(default, rename = "isKeyInfo")]
    pub is_key_info: bool,
    /// 悬停提示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
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
    /// 插件自控布局声明 — 透传给前端，Rust 不处理
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
}

/// 插件渲染器输出结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    /// 渲染类型: "html" | "table"
    #[serde(rename = "type")]
    pub result_type: String,
    /// type="html" 时的 HTML 内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// type="table" 时的多 Sheet 数据
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheets: Vec<RenderSheet>,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 渲染表格的单个 Sheet
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSheet {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// 请求钩子执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResult {
    /// 需要注入/覆盖的 Headers（key → value）
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    /// 需要注入/覆盖的 Query Params
    #[serde(default)]
    pub query_params: std::collections::HashMap<String, String>,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 数据生成结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDataResult {
    /// 生成的数据内容
    pub data: String,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 导出格式结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 导出内容
    pub content: String,
    /// 建议的文件名
    pub filename: String,
    /// MIME 类型
    pub mime_type: String,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Plugin Contributes (Extension Points) ──

/// 插件声明的扩展点贡献
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributes {
    /// 协议解析器贡献
    #[serde(default)]
    pub parsers: Vec<ParserContribution>,
    /// 请求钩子 (pre/post)
    #[serde(default)]
    pub request_hooks: Vec<RequestHookContribution>,
    /// 响应渲染器
    #[serde(default)]
    pub response_renderers: Vec<RendererContribution>,
    /// 侧边栏面板
    #[serde(default)]
    pub sidebar_panels: Vec<SidebarContribution>,
    /// 数据生成器
    #[serde(default)]
    pub generators: Vec<GeneratorContribution>,
    /// 导出格式
    #[serde(default)]
    pub export_formats: Vec<ExportFormatContribution>,
    /// 字体贡献 — 插件可携带字体文件
    #[serde(default)]
    pub fonts: Vec<FontContribution>,
    /// 加密解密算法贡献
    #[serde(default)]
    pub crypto_algorithms: Vec<CryptoAlgorithmContribution>,
    /// 图标贡献 — icon-pack 类型插件提供
    #[serde(default)]
    pub icons: Vec<IconContribution>,
}

/// 字体贡献
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontContribution {
    pub font_id: String,
    pub name: String,
    pub family: String,
    pub category: String,
    #[serde(default)]
    pub files: Vec<FontFile>,
}

/// 字体文件描述
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParserContribution {
    pub protocol_id: String,
    pub name: String,
}

/// 图标贡献 — icon-pack 插件中每个图标的定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconContribution {
    /// 图标名称（在命名空间内唯一）
    pub name: String,
    /// 内联 SVG 字符串
    pub svg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestHookContribution {
    /// 钩子类型: "pre-request" or "post-response"
    pub hook_type: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererContribution {
    /// 支持的 Content-Type MIME 模式
    pub content_types: Vec<String>,
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarContribution {
    pub panel_id: String,
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorContribution {
    pub generator_id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFormatContribution {
    pub format_id: String,
    pub name: String,
    pub file_extension: String,
}

/// 加密解密算法贡献
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoAlgorithmContribution {
    pub algorithm_id: String,
    pub name: String,
    /// "encode" | "hash" | "symmetric" | "asymmetric"
    pub category: String,
    #[serde(default)]
    pub support_encrypt: bool,
    #[serde(default)]
    pub support_decrypt: bool,
    #[serde(default)]
    pub params: Vec<CryptoParamDef>,
}

/// 加密算法参数定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoParamDef {
    pub param_id: String,
    pub name: String,
    /// "text" | "select" | "number"
    pub param_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    #[serde(default)]
    pub options: Vec<CryptoParamOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

/// 加密算法参数选项（type=select 时使用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoParamOption {
    pub label: String,
    pub value: String,
}

/// 加密/解密执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 已安装的加密插件算法信息（含 plugin_id）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCryptoAlgorithm {
    pub plugin_id: String,
    pub algorithm: CryptoAlgorithmContribution,
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
    /// 插件声明的扩展点贡献
    #[serde(default)]
    contributes: PluginContributes,
    /// 多语言翻译
    #[serde(default)]
    i18n: HashMap<String, PluginI18nEntry>,
    /// 面板位置
    #[serde(default, skip_serializing_if = "Option::is_none")]
    panel_position: Option<String>,
    /// 图标命名空间 — 仅 icon-pack 类型
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_namespace: Option<String>,
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
            contributes: self.contributes,
            i18n: self.i18n,
            has_update: false,
            latest_version: None,
            panel_position: self.panel_position,
            icon_namespace: self.icon_namespace,
        }
    }
}

/// GitHub 基础 URL（默认 / 海外）
const GITHUB_BASE_URL: &str =
    "https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/";

/// Cloudflare R2 CDN 基础 URL（中国大陆加速）
const R2_BASE_URL: &str = "https://protoforge.tuytuy.com/";

/// Default registry URL — GitHub
const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/registry.json";

/// R2 registry URL
const R2_REGISTRY_URL: &str = "https://protoforge.tuytuy.com/registry.json";

/// 远程注册表缓存有效期：5 分钟
const CACHE_TTL_SECS: u64 = 300;

// ── Plugin Runtime Dispatch ──
// 统一插件运行时：通过注册表动态分发，零硬编码。
// 支持三种运行时：Native (Rust fn) / JavaScript (boa_engine) / WASM (wasmtime)

/// 插件运行时类型
#[allow(dead_code)]
pub enum PluginRuntime {
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
    pub runtime: PluginRuntime,
}

// ── Plugin Manager ──

pub struct PluginManager {
    plugins_dir: PathBuf,
    /// 统一插件注册表：包含所有已注册的插件（native + installed JS/WASM）
    registry: RwLock<HashMap<String, RegisteredPlugin>>,
    /// Cached remote registry manifests (refreshed on demand)
    remote_cache: RwLock<Option<Vec<PluginManifest>>>,
    /// Registry URL (dynamically selected based on IP geolocation)
    registry_url: RwLock<String>,
    /// 是否使用 R2 CDN（中国大陆 IP 时为 true）
    use_r2: RwLock<bool>,
    /// 上次远程注册表刷新时间（缓存过期策略）
    last_refresh: Mutex<Option<Instant>>,
}

impl PluginManager {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let plugins_dir = app_data_dir.join("plugins");
        Self {
            plugins_dir,
            registry: RwLock::new(HashMap::new()),
            remote_cache: RwLock::new(None),
            registry_url: RwLock::new(DEFAULT_REGISTRY_URL.to_string()),
            use_r2: RwLock::new(false),
            last_refresh: Mutex::new(None),
        }
    }

    /// 检测用户 IP 地理位置，自动选择最优下载源。
    /// 中国大陆 IP → R2 CDN；其他地区 → GitHub。
    /// 检测失败时默认 GitHub（降级策略）。
    pub async fn detect_and_set_mirror(&self) {
        match detect_china_ip().await {
            Ok(true) => {
                log::info!("检测到中国大陆 IP，切换到 Cloudflare R2 CDN 下载源");
                *self.registry_url.write().await = R2_REGISTRY_URL.to_string();
                *self.use_r2.write().await = true;
            }
            Ok(false) => {
                log::info!("检测到非中国大陆 IP，使用 GitHub 默认下载源");
            }
            Err(e) => {
                log::warn!("IP 地理位置检测失败（降级为 GitHub）: {}", e);
            }
        }
    }

    /// 将 GitHub 下载 URL 替换为 R2 CDN URL（仅在 use_r2 时生效）
    async fn rewrite_download_url(&self, url: &str) -> String {
        if *self.use_r2.read().await {
            url.replace(GITHUB_BASE_URL, R2_BASE_URL)
        } else {
            url.to_string()
        }
    }

    /// 注册一个 Rust 原生解析器到统一注册表。
    /// 在 lib.rs 启动时调用，完全可拓展 — 新增解析器无需修改 PluginManager 代码。
    #[allow(dead_code)]
    pub async fn register_native(
        &self,
        manifest: PluginManifest,
        parse_fn: fn(&str) -> ParseResult,
    ) {
        let id = manifest.id.clone();
        self.registry.write().await.insert(id, RegisteredPlugin {
            manifest,
            runtime: PluginRuntime::Native(parse_fn),
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
                                    PluginRuntime::Wasm
                                } else {
                                    PluginRuntime::JavaScript
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

    /// List all installed plugins (excludes native built-in plugins).
    pub async fn list_installed(&self) -> Vec<PluginManifest> {
        let reg = self.registry.read().await;
        reg.values()
            .filter(|r| r.manifest.source != "native")
            .map(|r| r.manifest.clone())
            .collect()
    }

    /// Refresh remote registry — fetch from remote URL and cache.
    /// Returns the number of remote plugins found.
    pub async fn refresh_registry(&self) -> Result<usize, String> {
        let url = self.registry_url.read().await.clone();
        log::info!("正在从远程仓库刷新插件注册表: {}", url);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let resp = client
            .get(&url)
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
        *self.last_refresh.lock().await = Some(Instant::now());

        log::info!("远程注册表刷新成功，共 {} 个插件", count);
        Ok(count)
    }

    /// 检查远程缓存是否过期
    async fn is_cache_stale(&self) -> bool {
        let last = self.last_refresh.lock().await;
        match *last {
            None => true,
            Some(t) => t.elapsed().as_secs() > CACHE_TTL_SECS,
        }
    }

    /// 应用启动时调用：后台预热远程插件缓存
    pub async fn ensure_remote_cache(&self) {
        if self.is_cache_stale().await {
            if let Err(e) = self.refresh_registry().await {
                log::warn!("预热远程插件缓存失败（非致命）: {}", e);
            }
        }
    }

    /// List all available plugins: merge registered + remote, mark installed.
    /// **非阻塞**：总是立即返回已有数据，缓存过期时后台异步刷新。
    pub async fn list_available(&self) -> Vec<PluginManifest> {
        // 如果缓存过期，触发后台异步刷新（不等待结果）
        if self.is_cache_stale().await {
            // 用 log 记录刷新触发，但不阻塞当前调用
            let registry_url = self.registry_url.read().await.clone();
            log::info!("远程插件缓存已过期，后台刷新 (url={})", registry_url);
            let _ = self.refresh_registry_background().await;
        }

        let registry = self.registry.read().await;
        let remote_cache = self.remote_cache.read().await;

        // 使用 Vec + 去重来保留 registry.json 的原始顺序
        let mut all_plugins: Vec<PluginManifest> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 1. 先添加远程仓库的插件（按 registry.json 中的顺序）
        if let Some(remote_plugins) = remote_cache.as_ref() {
            for p in remote_plugins {
                if seen.insert(p.id.clone()) {
                    all_plugins.push(p.clone());
                }
            }
        }

        // 2. 对于仅本地安装但远程不存在的插件，追加到末尾
        for (id, rp) in registry.iter() {
            if rp.manifest.source != "native" && seen.insert(id.clone()) {
                all_plugins.push(rp.manifest.clone());
            }
        }

        // 3. 标记安装状态 + 版本升级检测
        let result: Vec<PluginManifest> = all_plugins
            .into_iter()
            .map(|mut m| {
                let is_installed = registry.get(&m.id)
                    .map(|rp| rp.manifest.source != "native")
                    .unwrap_or(false);
                m.installed = is_installed;

                // 版本比对：已安装 且 远程有此插件 → 比较版本号
                if is_installed {
                    if let Some(rp) = registry.get(&m.id) {
                        let installed_version = &rp.manifest.version;
                        let remote_version = &m.version;
                        if installed_version != remote_version {
                            m.has_update = true;
                            m.latest_version = Some(remote_version.clone());
                            // 保留已安装的版本号在 version 字段，便于前端展示
                            m.version = installed_version.clone();
                        }
                    }
                }
                m
            })
            .collect();

        // 4. 倒序排列：registry.json 中越靠后（=越新上架）的排在前面
        result.into_iter().rev().collect()
    }

    /// 后台异步刷新远程注册表（非阻塞，超时短）
    /// 如果已有缓存，直接返回不阻塞；否则做一次快速尝试
    async fn refresh_registry_background(&self) -> Result<(), String> {
        // 如果已有缓存数据，不阻塞当前请求
        let has_cache = self.remote_cache.read().await.is_some();
        if has_cache {
            // 已有缓存 → 用较短超时在后台刷新，失败也无妨
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .build()
                .map_err(|e| format!("{}", e))?;

            let url = self.registry_url.read().await.clone();
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    match resp.json::<RemoteRegistry>().await {
                        Ok(registry) => {
                            let manifests: Vec<PluginManifest> = registry
                                .plugins.into_iter().map(|e| e.into_manifest()).collect();
                            let count = manifests.len();
                            *self.remote_cache.write().await = Some(manifests);
                            *self.last_refresh.lock().await = Some(Instant::now());
                            log::info!("后台刷新远程注册表成功，共 {} 个插件", count);
                        }
                        Err(e) => {
                            log::warn!("后台刷新远程注册表 JSON 解析失败: {}", e);
                        }
                    }
                }
                _ => {
                    log::debug!("后台刷新远程注册表失败，继续使用旧缓存");
                }
            }
        } else {
            // 无缓存 → 首次加载，做一次快速尝试（3s 超时）
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .map_err(|e| format!("{}", e))?;

            let url = self.registry_url.read().await.clone();
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    match resp.json::<RemoteRegistry>().await {
                        Ok(registry) => {
                            let manifests: Vec<PluginManifest> = registry
                                .plugins.into_iter().map(|e| e.into_manifest()).collect();
                            let count = manifests.len();
                            *self.remote_cache.write().await = Some(manifests);
                            *self.last_refresh.lock().await = Some(Instant::now());
                            log::info!("首次快速加载远程注册表成功，共 {} 个插件", count);
                        }
                        Err(e) => {
                            log::warn!("首次加载远程注册表 JSON 解析失败: {}", e);
                        }
                    }
                }
                _ => {
                    log::debug!("首次快速加载远程注册表失败，将只显示本地插件");
                }
            }
        }
        Ok(())
    }

    /// Install a plugin by its ID.
    /// 支持首次安装和版本升级（已安装时先清理旧版本目录再重新下载）。
    pub async fn install(&self, plugin_id: &str) -> Result<PluginManifest, String> {
        // 检查是否已安装
        let is_upgrade = {
            let reg = self.registry.read().await;
            if let Some(rp) = reg.get(plugin_id) {
                if matches!(rp.runtime, PluginRuntime::Native(_)) {
                    // native 插件 → 允许被远程版本覆盖
                    false
                } else {
                    // 检查远程是否有更新版本
                    let remote_version = {
                        let cache = self.remote_cache.read().await;
                        cache.as_ref()
                            .and_then(|ps| ps.iter().find(|p| p.id == plugin_id))
                            .map(|p| p.version.clone())
                    };
                    match remote_version {
                        Some(rv) if rv != rp.manifest.version => true, // 版本不同 → 升级
                        Some(_) => return Err(format!("插件 '{}' 已是最新版本", plugin_id)),
                        None => return Err(format!("插件 '{}' 已安装", plugin_id)),
                    }
                }
            } else {
                false
            }
        };

        // 升级时先清理旧版本
        if is_upgrade {
            let plugin_dir = self.plugins_dir.join(plugin_id);
            if plugin_dir.exists() {
                tokio::fs::remove_dir_all(&plugin_dir)
                    .await
                    .map_err(|e| format!("清理旧版本失败: {}", e))?;
            }
            self.registry.write().await.remove(plugin_id);
            log::info!("已清理旧版本插件: {}", plugin_id);
        }

        // icon-pack 命名空间冲突检查
        {
            let cache = self.remote_cache.read().await;
            if let Some(ps) = cache.as_ref() {
                if let Some(target) = ps.iter().find(|p| p.id == plugin_id) {
                    if target.plugin_type == PluginType::IconPack {
                        if let Some(ref ns) = target.icon_namespace {
                            let reg = self.registry.read().await;
                            for (existing_id, rp) in reg.iter() {
                                if existing_id != plugin_id
                                    && rp.manifest.plugin_type == PluginType::IconPack
                                    && rp.manifest.icon_namespace.as_deref() == Some(ns.as_str())
                                {
                                    return Err(format!(
                                        "图标命名空间 '{}' 已被插件 '{}' 占用",
                                        ns, existing_id
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        // 清理可能残留的旧插件目录（确保干净安装）
        if !is_upgrade {
            let plugin_dir = self.plugins_dir.join(plugin_id);
            if plugin_dir.exists() {
                log::info!("发现插件目录残留，清理中: {:?}", plugin_dir);
                let _ = tokio::fs::remove_dir_all(&plugin_dir).await;
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
            let actual_url = self.rewrite_download_url(&url).await;
            return self.install_from_remote(plugin_id, &actual_url).await;
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

        // 去掉 UTF-8 BOM（某些编辑器会在文件头添加 \u{FEFF}）
        let manifest_content = manifest_content.strip_prefix('\u{feff}').unwrap_or(&manifest_content);

        if manifest_content.trim().is_empty() {
            let _ = tokio::fs::remove_dir_all(&plugin_dir).await;
            return Err(format!(
                "插件 '{}' 的 manifest.json 为空，可能是 tar.gz 包结构不正确",
                plugin_id
            ));
        }

        let mut manifest: PluginManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| format!("解析已安装插件 manifest 失败: {} (内容前100字符: {:?})", e, &manifest_content[..manifest_content.len().min(100)]))?;

        manifest.installed = true;
        manifest.source = "remote".to_string();

        // 将更新后的 manifest 写回磁盘，确保重启后 scan_installed 仍能读到 source="remote"
        let updated_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("序列化 manifest 失败: {}", e))?;
        tokio::fs::write(&manifest_path, &updated_json)
            .await
            .map_err(|e| format!("写回 manifest.json 失败: {}", e))?;

        // 根据 entrypoint 确定运行时类型
        let runtime = if manifest.entrypoint.ends_with(".wasm") {
            PluginRuntime::Wasm
        } else {
            PluginRuntime::JavaScript
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
                if matches!(rp.runtime, PluginRuntime::Native(_)) {
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

    /// 按插件类型查询已注册的插件列表
    #[allow(dead_code)]
    pub async fn get_plugins_by_type(&self, plugin_type: &PluginType) -> Vec<PluginManifest> {
        let reg = self.registry.read().await;
        reg.values()
            .filter(|rp| &rp.manifest.plugin_type == plugin_type)
            .map(|rp| rp.manifest.clone())
            .collect()
    }

    /// 获取插件图标文件并返回 base64 data URI
    /// 查找顺序: icon.svg → icon.png → None (前端 fallback 到 emoji)
    pub async fn get_plugin_icon(&self, plugin_id: &str) -> Option<String> {
        let plugin_dir = self.plugins_dir.join(plugin_id);
        
        // 优先 SVG
        let svg_path = plugin_dir.join("icon.svg");
        if svg_path.exists() {
            if let Ok(data) = tokio::fs::read(&svg_path).await {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                return Some(format!("data:image/svg+xml;base64,{}", b64));
            }
        }
        
        // 其次 PNG
        let png_path = plugin_dir.join("icon.png");
        if png_path.exists() {
            if let Ok(data) = tokio::fs::read(&png_path).await {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                return Some(format!("data:image/png;base64,{}", b64));
            }
        }
        
        None
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
            PluginRuntime::Native(parse_fn) => {
                let f = *parse_fn;
                drop(reg); // 释放锁
                Ok(f(raw_data))
            }
            // JavaScript — boa_engine 解释执行
            PluginRuntime::JavaScript => {
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
            PluginRuntime::Wasm => {
                drop(reg);
                    // WASM 执行通过独立的 WasmPluginRuntime 处理
                Err(format!("WASM 插件 '{}' 请通过 wasm_parse_data 命令调用", plugin_id))
            }
        }
    }

    /// Execute a plugin's render function on base64-encoded binary data.
    /// 插件的 render(data) 函数接收 base64 字符串，返回 RenderResult JSON。
    pub async fn render_data(
        &self,
        plugin_id: &str,
        base64_data: &str,
    ) -> Result<RenderResult, String> {
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            PluginRuntime::Native(_) => {
                drop(reg);
                Err(format!("原生插件 '{}' 不支持 render 操作", plugin_id))
            }
            PluginRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let data = base64_data.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_render_script(&script, &data)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginRuntime::Wasm => {
                drop(reg);
                Err(format!("WASM 插件 '{}' 的 render 功能请通过 wasm_render_data 命令调用", plugin_id))
            }
        }
    }

    /// 执行请求钩子插件的 hook(request) 函数
    pub async fn run_hook(
        &self,
        plugin_id: &str,
        request_json: &str,
    ) -> Result<HookResult, String> {
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            PluginRuntime::Native(_) => {
                drop(reg);
                Err(format!("原生插件 '{}' 不支持 hook 操作", plugin_id))
            }
            PluginRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let req = request_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_hook_script(&script, &req)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginRuntime::Wasm => {
                drop(reg);
                Err(format!("WASM 插件 '{}' 不支持 hook 操作", plugin_id))
            }
        }
    }

    /// 执行数据生成插件的 generate(generatorId, options) 函数
    pub async fn run_generator(
        &self,
        plugin_id: &str,
        generator_id: &str,
        options_json: &str,
    ) -> Result<GenerateDataResult, String> {
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            PluginRuntime::Native(_) => {
                drop(reg);
                Err(format!("原生插件 '{}' 不支持 generate 操作", plugin_id))
            }
            PluginRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let gen_id = generator_id.to_string();
                let opts = options_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_generate_script(&script, &gen_id, &opts)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginRuntime::Wasm => {
                drop(reg);
                Err(format!("WASM 插件 '{}' 不支持 generate 操作", plugin_id))
            }
        }
    }

    /// 执行导出格式插件的 exportRequest(request) 函数
    pub async fn run_export(
        &self,
        plugin_id: &str,
        request_json: &str,
    ) -> Result<ExportResult, String> {
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            PluginRuntime::Native(_) => {
                drop(reg);
                Err(format!("原生插件 '{}' 不支持 export 操作", plugin_id))
            }
            PluginRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let req = request_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_export_script(&script, &req)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginRuntime::Wasm => {
                drop(reg);
                Err(format!("WASM 插件 '{}' 不支持 export 操作", plugin_id))
            }
        }
    }

    /// 列出所有已安装 crypto-tool 插件的算法
    pub async fn list_crypto_algorithms(&self) -> Vec<InstalledCryptoAlgorithm> {
        let reg = self.registry.read().await;
        let mut result = Vec::new();
        for rp in reg.values() {
            if rp.manifest.plugin_type == PluginType::CryptoTool {
                for algo in &rp.manifest.contributes.crypto_algorithms {
                    result.push(InstalledCryptoAlgorithm {
                        plugin_id: rp.manifest.id.clone(),
                        algorithm: algo.clone(),
                    });
                }
            }
        }
        result
    }

    /// 执行加密/解密操作
    /// mode: "encrypt" 或 "decrypt"
    pub async fn run_crypto(
        &self,
        plugin_id: &str,
        algorithm_id: &str,
        mode: &str,
        input: &str,
        params_json: &str,
    ) -> Result<CryptoResult, String> {
        let reg = self.registry.read().await;
        let rp = reg
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;

        match &rp.runtime {
            PluginRuntime::Native(_) => {
                drop(reg);
                Err(format!("原生插件 '{}' 不支持 crypto 操作", plugin_id))
            }
            PluginRuntime::JavaScript => {
                let script_path = self.plugins_dir.join(plugin_id).join(&rp.manifest.entrypoint);
                drop(reg);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                let algo = algorithm_id.to_string();
                let m = mode.to_string();
                let inp = input.to_string();
                let params = params_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_crypto_script(&script, &algo, &m, &inp, &params)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginRuntime::Wasm => {
                drop(reg);
                Err(format!("WASM 插件 '{}' 不支持 crypto 操作（暂未实现）", plugin_id))
            }
        }
    }
}

// ── tar.gz extraction ──

/// Extract a .tar.gz archive into the target directory.
/// 自动检测 tar.gz 是否包含根目录前缀，兼容两种打包格式：
///   - 有前缀: `plugin-name/manifest.json` → 提取时去掉 `plugin-name/`
///   - 无前缀: `manifest.json` → 直接提取
fn extract_tar_gz(data: &[u8], target_dir: &std::path::Path) -> Result<(), String> {
    // ── Pass 1: 检测是否所有条目共享一个公共根目录 ──
    let should_strip = {
        let gz = GzDecoder::new(data);
        let mut archive = tar::Archive::new(gz);
        let entries = archive.entries().map_err(|e| format!("读取 tar 条目失败: {}", e))?;

        let mut common_root: Option<String> = None;
        let mut all_share_root = true;

        for entry_result in entries {
            let entry = entry_result.map_err(|e| format!("读取 tar 条目失败: {}", e))?;
            let path = entry.path().map_err(|e| format!("获取条目路径失败: {}", e))?;

            // 跳过 macOS AppleDouble 资源分支文件 (._xxx)，不影响公共根目录判断
            if let Some(name) = path.file_name() {
                if name.to_string_lossy().starts_with("._") {
                    continue;
                }
            }

            let components: Vec<_> = path.components().collect();

            if components.len() <= 1 {
                // 单组件条目（如 "manifest.json" 或 "plugin-name/"）
                if entry.header().entry_type().is_dir() && components.len() == 1 {
                    // 根目录条目本身，跳过不影响判断
                    continue;
                }
                // 单组件文件 → 无根目录前缀
                all_share_root = false;
                break;
            }

            // 多组件：检查第一个组件是否一致
            let first = components[0].as_os_str().to_string_lossy().to_string();
            match &common_root {
                None => common_root = Some(first),
                Some(root) if *root == first => {} // 一致
                Some(_) => {
                    all_share_root = false;
                    break;
                }
            }
        }

        all_share_root && common_root.is_some()
    };

    // ── Pass 2: 实际解压 ──
    let gz2 = GzDecoder::new(data);
    let mut archive2 = tar::Archive::new(gz2);

    // 预先获取 target_dir 的规范路径用于安全校验
    let canonical_target = std::fs::canonicalize(target_dir)
        .unwrap_or_else(|_| target_dir.to_path_buf());

    let skip_count = if should_strip { 1 } else { 0 };

    for entry_result in archive2.entries().map_err(|e| format!("读取 tar 条目失败: {}", e))? {
        let mut entry = entry_result.map_err(|e| format!("读取 tar 条目失败: {}", e))?;
        let path = entry.path().map_err(|e| format!("获取条目路径失败: {}", e))?;

        let relative: PathBuf = path
            .components()
            .skip(skip_count)
            .collect();

        // 跳过空路径（根目录条目本身）
        if relative.as_os_str().is_empty() {
            continue;
        }

        // 安全检查：过滤掉包含 ".." 的路径组件以防止路径穿越攻击 (Zip Slip)
        if relative.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            log::warn!("跳过可疑路径 (路径穿越): {:?}", relative);
            continue;
        }

        let target_path = target_dir.join(&relative);

        // 二次校验：确保最终路径在 target_dir 内
        let canonical_path = if target_path.exists() {
            std::fs::canonicalize(&target_path)
                .unwrap_or_else(|_| target_path.clone())
        } else {
            // 文件尚不存在，检查父目录的规范路径
            let parent = target_path.parent().unwrap_or(target_dir);
            if parent.exists() {
                std::fs::canonicalize(parent)
                    .map(|p| p.join(target_path.file_name().unwrap_or_default()))
                    .unwrap_or_else(|_| target_path.clone())
            } else {
                target_path.clone()
            }
        };
        if !canonical_path.starts_with(&canonical_target) {
            log::warn!("跳过路径穿越文件: {:?} → {:?}", relative, canonical_path);
            continue;
        }

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

    log::info!("tar.gz 解压完成 (strip_root={})", should_strip);
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

    // 使用 serde_json::to_string 对 raw_data 进行安全转义，
    // 可正确处理所有特殊字符（\0, \u2028, \u2029, 反引号等），防止 JS 注入。
    let json_escaped = serde_json::to_string(raw_data)
        .map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!("JSON.stringify(parse({}))", json_escaped);

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

/// Execute a JS plugin's render() function in a sandboxed boa_engine context.
///
/// **性能优化**：如果 base64_data 解码后是 ZIP 文件，Rust 端会先提取所有文件条目，
/// 并注入为 `__ZIP_FILES` 全局变量（JSON 对象），JS 插件只需做轻量的文本解析。
/// 这避免了在 boa_engine 解释器中执行 CPU 密集型的 Deflate 解码。
fn execute_render_script(script: &str, base64_data: &str) -> Result<RenderResult, String> {
    use base64::Engine as _;

    let mut context = Context::default();

    // Execute the plugin script (defines the render function)
    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    // 尝试 base64 解码 + ZIP 预处理
    let zip_files_json = match base64::engine::general_purpose::STANDARD.decode(base64_data) {
        Ok(bytes) => {
            // 检查是否为 ZIP 文件（PK 签名 0x50 0x4b）
            if bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b {
                match extract_zip_to_map(&bytes) {
                    Ok(files) => {
                        // 构建 JSON 对象
                        match serde_json::to_string(&files) {
                            Ok(json) => Some(json),
                            Err(_) => None,
                        }
                    }
                    Err(e) => {
                        log::warn!("ZIP 预提取失败: {}", e);
                        None
                    }
                }
            } else {
                None
            }
        }
        Err(_) => None,
    };

    // 注入 __ZIP_FILES 全局变量（如果是 ZIP 文件）
    if let Some(files_json) = &zip_files_json {
        let inject_script = format!("var __ZIP_FILES = {};", files_json);
        context
            .eval(Source::from_bytes(inject_script.as_bytes()))
            .map_err(|e| format!("注入 __ZIP_FILES 失败: {}", format_js_error(&e)))?;
    } else {
        // 非 ZIP 文件，注入 null
        context
            .eval(Source::from_bytes(b"var __ZIP_FILES = null;"))
            .map_err(|e| format!("注入 __ZIP_FILES 失败: {}", format_js_error(&e)))?;
    }

    // 将 base64 数据也传给 render()（插件可用于非 ZIP 场景）
    let json_escaped = serde_json::to_string(base64_data)
        .map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!("JSON.stringify(render({}))", json_escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 render() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "render() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let rendered: RenderResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 render 返回 JSON 失败: {}", e))?;

    Ok(rendered)
}

/// 将 ZIP 字节提取为 { 文件路径: 文件内容(字符串) } 映射。
/// 仅提取文本/XML 类型的文件，跳过二进制文件。
fn extract_zip_to_map(bytes: &[u8]) -> Result<std::collections::HashMap<String, String>, String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("ZIP 解析失败: {}", e))?;

    let mut files = std::collections::HashMap::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取 ZIP 条目 {} 失败: {}", i, e))?;

        if file.is_dir() {
            continue;
        }

        let name = file.name().to_string();

        // 读取内容（限制最大 10MB 防止恶意文件）
        let mut content = Vec::new();
        let max_size: u64 = 10 * 1024 * 1024;
        if file.size() > max_size {
            continue;
        }

        file.read_to_end(&mut content)
            .map_err(|e| format!("读取文件 {} 失败: {}", name, e))?;

        // 尝试作为 UTF-8 文本（XLSX 的 XML 文件都是 UTF-8）
        if let Ok(text) = String::from_utf8(content) {
            files.insert(name, text);
        }
    }

    Ok(files)
}

/// Execute a JS plugin's hook(request) function in a sandboxed boa_engine context.
fn execute_hook_script(script: &str, request_json: &str) -> Result<HookResult, String> {
    let mut context = Context::default();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let json_escaped = serde_json::to_string(request_json)
        .map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!("JSON.stringify(hook(JSON.parse({})))", json_escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 hook() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "hook() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: HookResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 hook 返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute a JS plugin's generate(generatorId, options) function in a sandboxed boa_engine context.
fn execute_generate_script(script: &str, generator_id: &str, options_json: &str) -> Result<GenerateDataResult, String> {
    let mut context = Context::default();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let gen_id_escaped = serde_json::to_string(generator_id)
        .map_err(|e| format!("序列化 generatorId 失败: {}", e))?;
    let opts_escaped = serde_json::to_string(options_json)
        .map_err(|e| format!("序列化 options 失败: {}", e))?;
    let call_script = format!("JSON.stringify(generate({}, JSON.parse({})))", gen_id_escaped, opts_escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 generate() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "generate() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: GenerateDataResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 generate 返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute a JS plugin's exportRequest(request) function in a sandboxed boa_engine context.
fn execute_export_script(script: &str, request_json: &str) -> Result<ExportResult, String> {
    let mut context = Context::default();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let json_escaped = serde_json::to_string(request_json)
        .map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!("JSON.stringify(exportRequest(JSON.parse({})))", json_escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 exportRequest() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "exportRequest() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: ExportResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 export 返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute a JS plugin's encrypt/decrypt function in a sandboxed boa_engine context.
/// mode: "encrypt" or "decrypt"
fn execute_crypto_script(
    script: &str,
    algorithm_id: &str,
    mode: &str,
    input: &str,
    params_json: &str,
) -> Result<CryptoResult, String> {
    let mut context = Context::default();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let algo_escaped = serde_json::to_string(algorithm_id)
        .map_err(|e| format!("序列化 algorithmId 失败: {}", e))?;
    let input_escaped = serde_json::to_string(input)
        .map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let params_escaped = serde_json::to_string(params_json)
        .map_err(|e| format!("序列化参数失败: {}", e))?;

    // 调用 encrypt(algorithmId, input, params) 或 decrypt(algorithmId, input, params)
    let fn_name = if mode == "encrypt" { "encrypt" } else { "decrypt" };
    let call_script = format!(
        "JSON.stringify({}({}, {}, JSON.parse({})))",
        fn_name, algo_escaped, input_escaped, params_escaped
    );

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 {}() 失败: {}", fn_name, format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| format!("{}() 返回值不是字符串（需要 JSON.stringify 包装）", fn_name))?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: CryptoResult =
        serde_json::from_str(&json_str).map_err(|e| format!("解析 {} 返回 JSON 失败: {}", fn_name, e))?;

    Ok(parsed)
}

fn format_js_error(err: &JsError) -> String {
    format!("{}", err)
}

// ── IP Geolocation Detection ──

/// IP 地理位置检测 API 的响应结构
#[derive(Deserialize)]
struct IpApiResponse {
    #[serde(default)]
    country_code: String,
}

/// 检测当前公网 IP 是否位于中国大陆。
/// 使用 ip-api.com 免费服务（不需要 API key，限 45 req/min）。
/// 超时 3 秒，失败返回 Err。
async fn detect_china_ip() -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get("http://ip-api.com/json/?fields=countryCode")
        .send()
        .await
        .map_err(|e| format!("IP 检测请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("IP 检测 API 返回 HTTP {}", resp.status()));
    }

    let data: IpApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 IP 检测响应失败: {}", e))?;

    Ok(data.country_code == "CN")
}
