use std::collections::HashMap;
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;

use boa_engine::{Context, JsError, Source};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell, RwLock};

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
    /// 下载包的 SHA-256 完整性校验值（可选，缺省时跳过校验）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
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
    /// 右键菜单贡献 — 插件可注入自定义右键菜单项
    #[serde(default)]
    pub context_menu_items: Vec<ContextMenuContribution>,
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
    /// 自动检测正则数组, 任一匹配即命中. 如 ["^##\\d{4}"]
    #[serde(default)]
    pub match_patterns: Vec<String>,
    /// 优先级 (0-100), 越大越优先. 默认 0
    #[serde(default)]
    pub priority: i32,
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
    /// 是否支持响应数据导出
    #[serde(default)]
    pub supports_response: bool,
    /// 导出参数声明
    #[serde(default)]
    pub parameters: Vec<ExportParameterDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportParameterDef {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub options: Vec<ExportParameterOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportParameterOption {
    pub label: String,
    pub value: String,
}

/// 右键菜单贡献 — 插件可注入自定义右键菜单项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuContribution {
    pub menu_item_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub contexts: Vec<String>,
    #[serde(default)]
    pub requires_selection: bool,
    pub action: String,
}

/// 右键菜单动作执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuActionResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default)]
    pub replace_selection: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
    /// 下载包的 SHA-256 完整性校验值（可选）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
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
            sha256: self.sha256,
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
const GITHUB_BASE_URL: &str = "https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/";

/// Cloudflare R2 CDN 基础 URL（中国大陆加速）
const R2_BASE_URL: &str = "https://protoforge.tuytuy.com/";

/// Default registry URL — GitHub
const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/registry.json";

/// R2 registry URL
const R2_REGISTRY_URL: &str = "https://protoforge.tuytuy.com/registry.json";

/// 远程注册表缓存有效期：5 分钟
const CACHE_TTL_SECS: u64 = 300;

// Plugin package/resource limits. These are intentionally generous for normal
// plugins while bounding compressed downloads and decompression fan-out.
const MAX_PLUGIN_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PLUGIN_ARCHIVE_ENTRIES: usize = 4_096;
const MAX_PLUGIN_ARCHIVE_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PLUGIN_ARCHIVE_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

const MAX_RENDER_BASE64_INPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_RENDER_ZIP_ENTRIES: usize = 4_096;
const MAX_RENDER_ZIP_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_RENDER_ZIP_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
// ZIP text is embedded as a JavaScript JSON literal. Its escaped form can be
// much larger than the raw UTF-8 input (for example, NUL becomes `\u0000`).
const MAX_RENDER_ZIP_JSON_BYTES: usize = 64 * 1024 * 1024;

const JS_LOOP_ITERATION_LIMIT: u64 = 10_000_000;

#[derive(Clone, Copy)]
struct ArchiveLimits {
    entries: usize,
    file_bytes: u64,
    total_bytes: u64,
}

const PLUGIN_ARCHIVE_LIMITS: ArchiveLimits = ArchiveLimits {
    entries: MAX_PLUGIN_ARCHIVE_ENTRIES,
    file_bytes: MAX_PLUGIN_ARCHIVE_FILE_BYTES,
    total_bytes: MAX_PLUGIN_ARCHIVE_TOTAL_BYTES,
};

const RENDER_ZIP_LIMITS: ArchiveLimits = ArchiveLimits {
    entries: MAX_RENDER_ZIP_ENTRIES,
    file_bytes: MAX_RENDER_ZIP_FILE_BYTES,
    total_bytes: MAX_RENDER_ZIP_TOTAL_BYTES,
};

// ── Plugin Runtime Dispatch ──
// 统一插件运行时：通过注册表动态分发，零硬编码。
// 支持三种运行时：Native (Rust fn) / JavaScript (boa_engine) / WASM (wasmtime)

/// 插件运行时类型
#[allow(dead_code)]
#[derive(Clone, Copy)]
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

enum PluginExecutionRuntime {
    Native(fn(&str) -> ParseResult),
    JavaScript(String),
    Wasm,
}

#[derive(Default)]
struct PluginConcurrency {
    /// Serializes install/uninstall transactions for this plugin only. Slow
    /// download, extraction and validation never block other plugin IDs.
    mutation: Mutex<()>,
    /// Protects the canonical directory + registry entry as one versioned
    /// snapshot. Readers hold it only while reading the entrypoint bytes, not
    /// while executing JavaScript.
    version: RwLock<()>,
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
    /// Per-plugin transaction/version locks. The std mutex protects only this
    /// small map and is never held across await points.
    plugin_concurrency: StdMutex<HashMap<String, Arc<PluginConcurrency>>>,
    /// Readiness barrier for the one startup recovery + disk scan. The scan
    /// may run in the background, but every local plugin command joins this
    /// same initialization before it can inspect or mutate plugin state.
    initial_scan: OnceCell<()>,
    /// Serializes the short cross-plugin activation commit (namespace check,
    /// atomic renames and registry update), never download/extraction/compile.
    activation_lock: Mutex<()>,
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
            plugin_concurrency: StdMutex::new(HashMap::new()),
            initial_scan: OnceCell::new(),
            activation_lock: Mutex::new(()),
        }
    }

    fn concurrency_for(&self, plugin_id: &str) -> Arc<PluginConcurrency> {
        let mut locks = self
            .plugin_concurrency
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Arc::clone(
            locks
                .entry(plugin_id.to_string())
                .or_insert_with(|| Arc::new(PluginConcurrency::default())),
        )
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
        self.registry.write().await.insert(
            id,
            RegisteredPlugin {
                manifest,
                runtime: PluginRuntime::Native(parse_fn),
            },
        );
    }

    /// 恢复上次进程在目录切换中途退出留下的事务目录。
    ///
    /// `.install-*` 从未被正式启用、`.uninstall-*` 已从注册表切走，可以
    /// 直接清理。`.backup-*` 则按其中
    /// manifest 的插件 ID 分组：有效 canonical 已存在时备份已过期；canonical
    /// 缺失或损坏且只有一个有效备份时原子恢复；多个候选时保守保留，避免猜错版本。
    async fn recover_interrupted_installations(&self) -> Result<(), String> {
        let mut entries = tokio::fs::read_dir(&self.plugins_dir)
            .await
            .map_err(|e| format!("读取插件事务目录失败: {}", e))?;
        let mut backups_by_plugin: HashMap<String, Vec<PathBuf>> = HashMap::new();

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            if name.starts_with(".install-") || name.starts_with(".uninstall-") {
                if let Err(error) = remove_path_if_exists(&path).await {
                    log::warn!("清理中断的插件事务目录失败 {:?}: {}", path, error);
                } else {
                    log::info!("已清理中断的插件事务目录: {:?}", path);
                }
                continue;
            }

            if !name.starts_with(".backup-") {
                continue;
            }

            match valid_backup_plugin_id(&path).await {
                Ok(plugin_id) => backups_by_plugin.entry(plugin_id).or_default().push(path),
                Err(error) => {
                    // 无法证明归属的备份不做破坏性处理，但后续正式扫描会忽略它。
                    log::warn!("保留无法验证的插件备份 {:?}: {}", path, error);
                }
            }
        }

        for (plugin_id, backups) in backups_by_plugin {
            let canonical_dir = self.plugins_dir.join(&plugin_id);
            let canonical_exists = match tokio::fs::symlink_metadata(&canonical_dir).await {
                Ok(_) => true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(error) => {
                    log::warn!(
                        "检查插件 '{}' canonical 目录失败，保留 {} 个备份: {}",
                        plugin_id,
                        backups.len(),
                        error
                    );
                    continue;
                }
            };

            let canonical_valid = if canonical_exists {
                match valid_backup_plugin_id(&canonical_dir).await {
                    Ok(canonical_id) if canonical_id == plugin_id => true,
                    Ok(canonical_id) => {
                        log::warn!(
                            "插件 '{}' canonical manifest ID 为 '{}'，保留备份并尝试恢复",
                            plugin_id,
                            canonical_id
                        );
                        false
                    }
                    Err(error) => {
                        log::warn!(
                            "插件 '{}' canonical 目录无效，保留备份并尝试恢复: {}",
                            plugin_id,
                            error
                        );
                        false
                    }
                }
            } else {
                false
            };

            if canonical_valid {
                for backup in backups {
                    if let Err(error) = remove_path_if_exists(&backup).await {
                        log::warn!(
                            "清理插件 '{}' 陈旧备份失败 {:?}: {}",
                            plugin_id,
                            backup,
                            error
                        );
                    } else {
                        log::info!("已清理插件 '{}' 陈旧备份: {:?}", plugin_id, backup);
                    }
                }
                continue;
            }

            if backups.len() == 1 {
                let backup = &backups[0];
                let quarantined = canonical_exists.then(|| {
                    self.plugins_dir
                        .join(format!(".invalid-{}", uuid::Uuid::new_v4()))
                });
                match restore_backup_directory(&canonical_dir, backup, quarantined.as_deref()).await
                {
                    Ok(()) => log::warn!(
                        "检测到中断的插件安装，已从 {:?} 恢复 '{}'",
                        backup,
                        plugin_id
                    ),
                    Err(error) => log::warn!(
                        "恢复插件 '{}' 的中断备份失败 {:?}: {}",
                        plugin_id,
                        backup,
                        error
                    ),
                }
            } else {
                log::warn!(
                    "插件 '{}' 缺少 canonical 目录但存在 {} 个有效备份，无法安全判断版本，全部保留",
                    plugin_id,
                    backups.len()
                );
            }
        }

        Ok(())
    }

    /// Join the one startup recovery + disk scan. The application starts this
    /// in the background; commands that arrive immediately after launch wait
    /// on the same OnceCell, so recovery can never delete an active staging
    /// directory and a stale scan cannot resurrect an uninstalled plugin.
    pub async fn scan_installed(&self) -> Result<(), String> {
        self.scan_installed_after(std::future::ready(()), std::future::ready(()))
            .await
    }

    async fn scan_installed_after<B, C>(
        &self,
        before_recovery: B,
        before_registry_commit: C,
    ) -> Result<(), String>
    where
        B: Future<Output = ()>,
        C: Future<Output = ()>,
    {
        self.initial_scan
            .get_or_try_init(|| async {
                self.scan_installed_inner(before_recovery, before_registry_commit)
                    .await
            })
            .await
            .map(|_| ())
    }

    /// 扫描插件目录，加载所有已安装的 JS/WASM 插件到注册表。
    /// 注意：native 插件通过 register_native() 单独注册，不在此处理。
    async fn scan_installed_inner<B, C>(
        &self,
        before_recovery: B,
        before_registry_commit: C,
    ) -> Result<(), String>
    where
        B: Future<Output = ()>,
        C: Future<Output = ()>,
    {
        // Deterministic test gate; production passes an immediately-ready
        // future. Runtime mutations cannot start until this entire method has
        // initialized the OnceCell.
        before_recovery.await;
        tokio::fs::create_dir_all(&self.plugins_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;
        self.recover_interrupted_installations().await?;

        let mut before_registry_commit = Some(before_registry_commit);

        let mut entries = tokio::fs::read_dir(&self.plugins_dir)
            .await
            .map_err(|e| format!("读取插件目录失败: {}", e))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            // 即使进程在清理前退出，下次扫描也绝不能把安装事务目录中的
            // manifest 当作一个正式插件加载。
            let directory_name = entry.file_name();
            let directory_name = directory_name.to_string_lossy();
            if directory_name.starts_with(".install-")
                || directory_name.starts_with(".uninstall-")
                || directory_name.starts_with(".backup-")
                || directory_name.starts_with(".invalid-")
            {
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
                            if let Err(error) = validate_plugin_id(&manifest.id) {
                                log::warn!(
                                    "跳过插件目录 {:?}: manifest ID '{}' 非法 ({})",
                                    path,
                                    manifest.id,
                                    error
                                );
                                continue;
                            }
                            if directory_name.as_ref() != manifest.id.as_str() {
                                log::warn!(
                                    "跳过插件目录 {:?}: 目录名 '{}' 与 manifest ID '{}' 不一致",
                                    path,
                                    directory_name,
                                    manifest.id
                                );
                                continue;
                            }
                            if let Err(error) =
                                validate_plugin_entrypoint(&path, &manifest.entrypoint).await
                            {
                                log::warn!(
                                    "跳过插件目录 {:?}: entrypoint '{}' 无效 ({})",
                                    path,
                                    manifest.entrypoint,
                                    error
                                );
                                continue;
                            }

                            if let Some(gate) = before_registry_commit.take() {
                                gate.await;
                            }

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
                let is_installed = registry
                    .get(&m.id)
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
                                .plugins
                                .into_iter()
                                .map(|e| e.into_manifest())
                                .collect();
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
                                .plugins
                                .into_iter()
                                .map(|e| e.into_manifest())
                                .collect();
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
    /// 支持首次安装和版本升级。新包在隔离目录中完成下载、校验、解压和
    /// manifest 校验后，才会替换当前版本；替换失败会自动回滚。
    pub async fn install(
        &self,
        plugin_id: &str,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
    ) -> Result<PluginManifest, String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _mutation_guard = concurrency.mutation.lock().await;

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
                        cache
                            .as_ref()
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

        // Try remote
        let (download_url, expected_sha256) = {
            let cache = self.remote_cache.read().await;
            let entry = cache
                .as_ref()
                .and_then(|ps| ps.iter().find(|p| p.id == plugin_id));
            (
                entry.and_then(|p| p.download_url.clone()),
                entry.and_then(|p| p.sha256.clone()),
            )
        };

        if let Some(url) = download_url {
            let actual_url = self.rewrite_download_url(&url).await;
            let installed = self
                .install_from_remote(
                    plugin_id,
                    &actual_url,
                    expected_sha256.as_deref(),
                    wasm_runtime,
                )
                .await?;
            if is_upgrade {
                log::info!("插件升级成功: {} → {}", plugin_id, installed.version);
            }
            return Ok(installed);
        }

        Err(format!("插件 '{}' 在仓库中不存在", plugin_id))
    }

    /// Install from remote URL (download .tar.gz and extract)
    async fn install_from_remote(
        &self,
        plugin_id: &str,
        download_url: &str,
        expected_sha256: Option<&str>,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
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

        if resp
            .content_length()
            .is_some_and(|length| length > MAX_PLUGIN_ARCHIVE_BYTES as u64)
        {
            return Err(format!(
                "插件压缩包超过最大限制 {} MiB",
                MAX_PLUGIN_ARCHIVE_BYTES / 1024 / 1024
            ));
        }
        use futures_util::StreamExt;
        let mut bytes = Vec::with_capacity(
            resp.content_length()
                .unwrap_or_default()
                .min(MAX_PLUGIN_ARCHIVE_BYTES as u64) as usize,
        );
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取下载数据失败: {}", e))?;
            extend_with_size_limit(&mut bytes, &chunk, MAX_PLUGIN_ARCHIVE_BYTES, "插件压缩包")?;
        }

        self.verify_and_install_downloaded_archive(
            plugin_id,
            &bytes,
            expected_sha256,
            Some(wasm_runtime),
        )
        .await
    }

    /// 先完成下载内容的完整性校验，再创建 staging。哈希不匹配时不会触碰
    /// 当前插件目录或注册表。
    async fn verify_and_install_downloaded_archive(
        &self,
        plugin_id: &str,
        archive_bytes: &[u8],
        expected_sha256: Option<&str>,
        wasm_runtime: Option<&crate::wasm_runtime::WasmPluginRuntime>,
    ) -> Result<PluginManifest, String> {
        // 注册表声明了 sha256 则强制校验；未声明时仅为旧仓库兼容而放行。
        if let Some(expected) = expected_sha256 {
            use sha2::{Digest, Sha256};
            let actual = format!("{:x}", {
                let mut h = Sha256::new();
                h.update(archive_bytes);
                h.finalize()
            });
            // 大小写不敏感、仅剥离一次 "sha256:" 前缀（避免 trim_start_matches 重复剥离
            // 以及对 "SHA256:" 大写前缀失效）。
            let trimmed = expected.trim();
            let lower = trimmed.to_ascii_lowercase();
            let expected_norm = lower.strip_prefix("sha256:").unwrap_or(&lower);
            if !actual.eq_ignore_ascii_case(expected_norm) {
                return Err(format!(
                    "插件 '{}' 完整性校验失败: 期望 {}, 实际 {}",
                    plugin_id, expected_norm, actual
                ));
            }
            log::info!("插件 '{}' SHA-256 校验通过", plugin_id);
        } else {
            log::warn!(
                "插件 '{}' 未提供 SHA-256 校验值，跳过完整性校验（仅旧版仓库条目兼容）",
                plugin_id
            );
        }

        self.install_downloaded_archive(plugin_id, archive_bytes, wasm_runtime)
            .await
    }

    /// 将已下载并通过哈希校验的包安装到隔离目录，再以可回滚方式启用。
    async fn install_downloaded_archive(
        &self,
        plugin_id: &str,
        archive_bytes: &[u8],
        wasm_runtime: Option<&crate::wasm_runtime::WasmPluginRuntime>,
    ) -> Result<PluginManifest, String> {
        // Keep this lower-level boundary safe as well: future callers must not
        // create `.install-*` while startup recovery is still cleaning them.
        self.scan_installed().await?;
        tokio::fs::create_dir_all(&self.plugins_dir)
            .await
            .map_err(|e| format!("创建插件目录失败: {}", e))?;

        let staging_dir = self
            .plugins_dir
            .join(format!(".install-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&staging_dir)
            .await
            .map_err(|e| format!("创建插件暂存目录失败: {}", e))?;

        let prepared = self
            .prepare_staged_plugin(plugin_id, archive_bytes, &staging_dir)
            .await;
        let (manifest, runtime) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                if let Err(cleanup_error) = remove_path_if_exists(&staging_dir).await {
                    log::warn!("清理插件暂存目录失败 {:?}: {}", staging_dir, cleanup_error);
                }
                return Err(error);
            }
        };

        if let Err(error) = self
            .activate_staged_plugin(plugin_id, &staging_dir, &manifest, runtime, wasm_runtime)
            .await
        {
            if let Err(cleanup_error) = remove_path_if_exists(&staging_dir).await {
                log::warn!("清理插件暂存目录失败 {:?}: {}", staging_dir, cleanup_error);
            }
            return Err(error);
        }

        log::info!("远程插件安装成功: {}", plugin_id);
        Ok(manifest)
    }

    /// 完整解压并验证暂存目录。此阶段不会触碰当前已安装版本。
    async fn prepare_staged_plugin(
        &self,
        plugin_id: &str,
        archive_bytes: &[u8],
        staging_dir: &Path,
    ) -> Result<(PluginManifest, PluginRuntime), String> {
        let bytes = archive_bytes.to_vec();
        let target = staging_dir.to_path_buf();
        tokio::task::spawn_blocking(move || extract_tar_gz(&bytes, &target))
            .await
            .map_err(|e| format!("解压任务失败: {}", e))?
            .map_err(|e| format!("插件下载格式无效: {}", e))?;

        let manifest_path = staging_dir.join("manifest.json");
        let manifest_content = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| format!("读取插件 manifest 失败: {}", e))?;
        let manifest_content = manifest_content
            .strip_prefix('\u{feff}')
            .unwrap_or(&manifest_content);

        if manifest_content.trim().is_empty() {
            return Err(format!("插件 '{}' 的 manifest.json 为空", plugin_id));
        }

        let manifest_preview: String = manifest_content.chars().take(100).collect();
        let mut manifest: PluginManifest = serde_json::from_str(manifest_content).map_err(|e| {
            format!(
                "解析插件 manifest 失败: {} (内容前100字符: {:?})",
                e, manifest_preview
            )
        })?;

        if manifest.id != plugin_id {
            return Err(format!(
                "插件包 ID 不匹配: 请求安装 '{}', manifest 声明 '{}'",
                plugin_id, manifest.id
            ));
        }
        validate_plugin_entrypoint(staging_dir, &manifest.entrypoint).await?;

        manifest.installed = true;
        manifest.source = "remote".to_string();
        let updated_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("序列化 manifest 失败: {}", e))?;
        tokio::fs::write(&manifest_path, updated_json)
            .await
            .map_err(|e| format!("写回 manifest.json 失败: {}", e))?;

        let runtime = if manifest.entrypoint.ends_with(".wasm") {
            PluginRuntime::Wasm
        } else {
            PluginRuntime::JavaScript
        };
        Ok((manifest, runtime))
    }

    async fn ensure_activation_conflicts_absent(
        &self,
        plugin_id: &str,
        manifest: &PluginManifest,
    ) -> Result<(), String> {
        if manifest.plugin_type != PluginType::IconPack {
            return Ok(());
        }
        let Some(namespace) = manifest.icon_namespace.as_deref() else {
            return Ok(());
        };
        let registry = self.registry.read().await;
        if let Some((existing_id, _)) = registry.iter().find(|(existing_id, registered)| {
            existing_id.as_str() != plugin_id
                && registered.manifest.plugin_type == PluginType::IconPack
                && registered.manifest.icon_namespace.as_deref() == Some(namespace)
        }) {
            return Err(format!(
                "图标命名空间 '{}' 已被插件 '{}' 占用",
                namespace, existing_id
            ));
        }
        Ok(())
    }

    /// 将已验证的暂存目录切换为正式版本。旧目录先移入同级 backup；若第二次
    /// rename 失败，会把 backup 原样恢复，注册表也不会发生变化。
    async fn activate_staged_plugin(
        &self,
        plugin_id: &str,
        staging_dir: &Path,
        manifest: &PluginManifest,
        runtime: PluginRuntime,
        wasm_runtime: Option<&crate::wasm_runtime::WasmPluginRuntime>,
    ) -> Result<(), String> {
        self.activate_staged_plugin_after(
            plugin_id,
            staging_dir,
            manifest,
            runtime,
            wasm_runtime,
            std::future::ready(()),
        )
        .await
    }

    async fn activate_staged_plugin_after<F>(
        &self,
        plugin_id: &str,
        staging_dir: &Path,
        manifest: &PluginManifest,
        runtime: PluginRuntime,
        wasm_runtime: Option<&crate::wasm_runtime::WasmPluginRuntime>,
        before_wasm_cache_commit: F,
    ) -> Result<(), String>
    where
        F: Future<Output = ()>,
    {
        let plugin_dir = self.plugins_dir.join(plugin_id);
        let backup_dir = self
            .plugins_dir
            .join(format!(".backup-{}", uuid::Uuid::new_v4()));
        let concurrency = self.concurrency_for(plugin_id);
        let had_previous_dir = {
            // Existing executions may finish with their already-read old script.
            // New executions wait and can only observe one complete version.
            let _version_guard = concurrency.version.write().await;
            let _activation_guard = self.activation_lock.lock().await;
            self.ensure_activation_conflicts_absent(plugin_id, manifest)
                .await?;

            let had_previous_dir = plugin_dir.exists();
            if had_previous_dir {
                tokio::fs::rename(&plugin_dir, &backup_dir)
                    .await
                    .map_err(|e| format!("暂存旧插件版本失败: {}", e))?;
            }

            if let Err(activate_error) = tokio::fs::rename(staging_dir, &plugin_dir).await {
                let rollback_result = if had_previous_dir {
                    tokio::fs::rename(&backup_dir, &plugin_dir).await
                } else {
                    Ok(())
                };

                return match rollback_result {
                    Ok(()) => Err(format!(
                        "启用新插件版本失败，已恢复旧版本: {}",
                        activate_error
                    )),
                    Err(rollback_error) => Err(format!(
                        "启用新插件版本失败 ({})，恢复旧版本也失败 ({}); 旧版本保留在 {:?}",
                        activate_error, rollback_error, backup_dir
                    )),
                };
            }

            self.registry.write().await.insert(
                plugin_id.to_string(),
                RegisteredPlugin {
                    manifest: manifest.clone(),
                    runtime,
                },
            );
            if let Some(wasm_runtime) = wasm_runtime {
                // Directory, registry and compiled-code cache become one
                // version commit. Readers cannot observe the new manifest
                // while still executing the previous cached WASM module.
                before_wasm_cache_commit.await;
                wasm_runtime.commit_plugin_version(plugin_id).await;
            }
            had_previous_dir
        };

        if had_previous_dir {
            if let Err(error) = remove_path_if_exists(&backup_dir).await {
                // 新版本已成功启用，备份清理失败不应让调用方误以为安装失败；
                // 隐藏目录不会被 scan_installed 当成插件加载。
                log::warn!("清理插件旧版本备份失败 {:?}: {}", backup_dir, error);
            }
        }
        Ok(())
    }

    #[cfg(test)]
    async fn uninstall(&self, plugin_id: &str) -> Result<(), String> {
        self.uninstall_inner(plugin_id, None).await
    }

    pub async fn uninstall_with_wasm_runtime(
        &self,
        plugin_id: &str,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
    ) -> Result<(), String> {
        self.uninstall_inner(plugin_id, Some(wasm_runtime)).await
    }

    async fn uninstall_inner(
        &self,
        plugin_id: &str,
        wasm_runtime: Option<&crate::wasm_runtime::WasmPluginRuntime>,
    ) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _mutation_guard = concurrency.mutation.lock().await;

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
        let tombstone_dir = self
            .plugins_dir
            .join(format!(".uninstall-{}", uuid::Uuid::new_v4()));
        let had_plugin_dir = {
            let _version_guard = concurrency.version.write().await;
            let _activation_guard = self.activation_lock.lock().await;
            let had_plugin_dir = plugin_dir.exists();
            if had_plugin_dir {
                // A same-filesystem rename is the uninstall commit point. It
                // keeps the canonical path and registry transition atomic for
                // executions while allowing slow recursive deletion later.
                tokio::fs::rename(&plugin_dir, &tombstone_dir)
                    .await
                    .map_err(|e| format!("停用插件目录失败: {}", e))?;
            }
            self.registry.write().await.remove(plugin_id);
            if let Some(wasm_runtime) = wasm_runtime {
                wasm_runtime.commit_plugin_version(plugin_id).await;
            }
            had_plugin_dir
        };

        if had_plugin_dir {
            if let Err(error) = remove_path_if_exists(&tombstone_dir).await {
                // The plugin is already unreachable. Startup recovery will
                // retry deletion of this hidden tombstone.
                log::warn!("清理已卸载插件目录失败 {:?}: {}", tombstone_dir, error);
            }
        }
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
    pub async fn get_plugin_icon(&self, plugin_id: &str) -> Result<Option<String>, String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;

        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        let runtime = {
            let registry = self.registry.read().await;
            registry
                .get(plugin_id)
                .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?
                .runtime
        };
        if matches!(runtime, PluginRuntime::Native(_)) {
            return Ok(None);
        }

        let plugin_dir = self.plugins_dir.join(plugin_id);
        let plugin_metadata = match tokio::fs::symlink_metadata(&plugin_dir).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("读取插件目录元数据失败: {}", error)),
        };
        if plugin_metadata.file_type().is_symlink() || !plugin_metadata.is_dir() {
            return Err(format!("插件 '{}' 的目录不是普通目录", plugin_id));
        }

        let canonical_plugins_dir = tokio::fs::canonicalize(&self.plugins_dir)
            .await
            .map_err(|e| format!("规范化插件根目录失败: {}", e))?;
        let canonical_plugin_dir = tokio::fs::canonicalize(&plugin_dir)
            .await
            .map_err(|e| format!("规范化插件目录失败: {}", e))?;
        if canonical_plugin_dir.parent() != Some(canonical_plugins_dir.as_path()) {
            return Err(format!("插件 '{}' 的目录逃出插件根目录", plugin_id));
        }

        for (filename, mime_type) in [("icon.svg", "image/svg+xml"), ("icon.png", "image/png")] {
            let icon_path = plugin_dir.join(filename);
            let metadata = match tokio::fs::symlink_metadata(&icon_path).await {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("读取插件图标元数据失败: {}", error)),
            };
            if metadata.file_type().is_symlink() {
                return Err(format!("插件图标 '{}' 不允许使用符号链接", filename));
            }
            if !metadata.is_file() {
                return Err(format!("插件图标 '{}' 不是普通文件", filename));
            }

            let canonical_icon = tokio::fs::canonicalize(&icon_path)
                .await
                .map_err(|e| format!("规范化插件图标失败: {}", e))?;
            if canonical_icon.parent() != Some(canonical_plugin_dir.as_path()) {
                return Err(format!("插件图标 '{}' 逃出插件目录", filename));
            }
            let data = tokio::fs::read(&canonical_icon)
                .await
                .map_err(|e| format!("读取插件图标失败: {}", e))?;
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(data);
            return Ok(Some(format!("data:{};base64,{}", mime_type, b64)));
        }

        Ok(None)
    }

    async fn ensure_registered_wasm(&self, plugin_id: &str) -> Result<(), String> {
        let registry = self.registry.read().await;
        let registered = registry
            .get(plugin_id)
            .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;
        if !matches!(registered.runtime, PluginRuntime::Wasm) {
            return Err(format!("插件 '{}' 不是 WASM 插件", plugin_id));
        }
        Ok(())
    }

    /// Load only a registry-authorized WASM plugin while holding its version
    /// snapshot. A disk directory that collides with a native/JS plugin cannot
    /// bypass registry dispatch through the direct WASM IPC surface.
    pub async fn load_wasm_plugin(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
        plugin_id: &str,
    ) -> Result<crate::wasm_runtime::WasmPluginInfo, String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        self.ensure_registered_wasm(plugin_id).await?;
        wasm_runtime.load_plugin(plugin_id).await
    }

    pub async fn unload_wasm_plugin(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
        plugin_id: &str,
    ) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        self.ensure_registered_wasm(plugin_id).await?;
        wasm_runtime.unload_plugin(plugin_id).await
    }

    pub async fn parse_wasm_data(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
        plugin_id: &str,
        raw_data: &str,
    ) -> Result<ParseResult, String> {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        self.ensure_registered_wasm(plugin_id).await?;
        wasm_runtime.parse_data(plugin_id, raw_data).await
    }

    pub async fn list_loaded_wasm_plugins(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
    ) -> Result<Vec<crate::wasm_runtime::WasmPluginInfo>, String> {
        self.scan_installed().await?;
        let registered_ids: std::collections::HashSet<String> = self
            .registry
            .read()
            .await
            .iter()
            .filter_map(|(plugin_id, registered)| {
                matches!(registered.runtime, PluginRuntime::Wasm).then(|| plugin_id.clone())
            })
            .collect();
        Ok(wasm_runtime
            .list_loaded()
            .await
            .into_iter()
            .filter(|info| registered_ids.contains(&info.id))
            .collect())
    }

    pub async fn scan_and_load_wasm_plugins(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
    ) -> Result<Vec<String>, String> {
        self.scan_installed().await?;
        let plugin_ids: Vec<String> = self
            .registry
            .read()
            .await
            .iter()
            .filter_map(|(plugin_id, registered)| {
                matches!(registered.runtime, PluginRuntime::Wasm).then(|| plugin_id.clone())
            })
            .collect();
        let mut loaded = Vec::new();
        for plugin_id in plugin_ids {
            match self.load_wasm_plugin(wasm_runtime, &plugin_id).await {
                Ok(info) => {
                    log::info!("WASM 插件加载成功: {} ({})", info.name, info.id);
                    loaded.push(info.id);
                }
                Err(error) => log::warn!("WASM 插件加载失败 '{}': {}", plugin_id, error),
            }
        }
        Ok(loaded)
    }

    async fn run_registered_wasm_crypto(
        &self,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
        plugin_id: &str,
        algorithm_id: &str,
        mode: &str,
        input: &str,
        params_json: &str,
    ) -> Result<CryptoResult, String> {
        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        self.ensure_registered_wasm(plugin_id).await?;
        wasm_runtime.load_plugin(plugin_id).await?;
        wasm_runtime
            .run_crypto(plugin_id, algorithm_id, mode, input, params_json)
            .await
    }

    async fn execution_runtime(&self, plugin_id: &str) -> Result<PluginExecutionRuntime, String> {
        self.execution_runtime_after(plugin_id, std::future::ready(()))
            .await
    }

    async fn execution_runtime_after<F>(
        &self,
        plugin_id: &str,
        before_javascript_read: F,
    ) -> Result<PluginExecutionRuntime, String>
    where
        F: Future<Output = ()>,
    {
        validate_plugin_id(plugin_id)?;
        self.scan_installed().await?;
        let concurrency = self.concurrency_for(plugin_id);
        let _version_guard = concurrency.version.read().await;
        let (runtime, entrypoint) = {
            let registry = self.registry.read().await;
            let registered = registry
                .get(plugin_id)
                .ok_or_else(|| format!("插件 '{}' 未注册", plugin_id))?;
            (registered.runtime, registered.manifest.entrypoint.clone())
        };

        match runtime {
            PluginRuntime::Native(parse_fn) => Ok(PluginExecutionRuntime::Native(parse_fn)),
            PluginRuntime::Wasm => Ok(PluginExecutionRuntime::Wasm),
            PluginRuntime::JavaScript => {
                // Tests can stop at this exact point to prove an atomic switch
                // cannot replace the canonical directory between manifest
                // selection and entrypoint reading.
                before_javascript_read.await;
                let script_path = self.plugins_dir.join(plugin_id).join(entrypoint);
                let script = tokio::fs::read_to_string(&script_path)
                    .await
                    .map_err(|e| format!("读取插件脚本失败: {}", e))?;
                Ok(PluginExecutionRuntime::JavaScript(script))
            }
        }
    }

    /// Execute a plugin's parse function on raw data.
    /// 通过统一注册表动态分发到正确的运行时，零硬编码。
    pub async fn parse_data(&self, plugin_id: &str, raw_data: &str) -> Result<ParseResult, String> {
        match self.execution_runtime(plugin_id).await? {
            // Rust 原生函数指针 — 直接调用，零开销
            PluginExecutionRuntime::Native(parse_fn) => Ok(parse_fn(raw_data)),
            // JavaScript — boa_engine 解释执行
            PluginExecutionRuntime::JavaScript(script) => {
                let raw_data = raw_data.to_string();
                let result =
                    tokio::task::spawn_blocking(move || execute_parse_script(&script, &raw_data))
                        .await
                        .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            // WASM — wasmtime JIT（委托给 WasmPluginRuntime）
            PluginExecutionRuntime::Wasm => Err(format!(
                "WASM 插件 '{}' 请通过 wasm_parse_data 命令调用",
                plugin_id
            )),
        }
    }

    /// Execute a plugin's render function on base64-encoded binary data.
    /// 插件的 render(data) 函数接收 base64 字符串，返回 RenderResult JSON。
    pub async fn render_data(
        &self,
        plugin_id: &str,
        base64_data: &str,
    ) -> Result<RenderResult, String> {
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => {
                Err(format!("原生插件 '{}' 不支持 render 操作", plugin_id))
            }
            PluginExecutionRuntime::JavaScript(script) => {
                let data = base64_data.to_string();
                let result =
                    tokio::task::spawn_blocking(move || execute_render_script(&script, &data))
                        .await
                        .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => Err(format!(
                "WASM 插件 '{}' 的 render 功能请通过 wasm_render_data 命令调用",
                plugin_id
            )),
        }
    }

    /// 执行请求钩子插件的 hook(request) 函数
    pub async fn run_hook(
        &self,
        plugin_id: &str,
        request_json: &str,
    ) -> Result<HookResult, String> {
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => {
                Err(format!("原生插件 '{}' 不支持 hook 操作", plugin_id))
            }
            PluginExecutionRuntime::JavaScript(script) => {
                let req = request_json.to_string();
                let result =
                    tokio::task::spawn_blocking(move || execute_hook_script(&script, &req))
                        .await
                        .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => {
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
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => {
                Err(format!("原生插件 '{}' 不支持 generate 操作", plugin_id))
            }
            PluginExecutionRuntime::JavaScript(script) => {
                let gen_id = generator_id.to_string();
                let opts = options_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_generate_script(&script, &gen_id, &opts)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => {
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
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => {
                Err(format!("原生插件 '{}' 不支持 export 操作", plugin_id))
            }
            PluginExecutionRuntime::JavaScript(script) => {
                let req = request_json.to_string();
                let result =
                    tokio::task::spawn_blocking(move || execute_export_script(&script, &req))
                        .await
                        .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => {
                Err(format!("WASM 插件 '{}' 不支持 export 操作", plugin_id))
            }
        }
    }

    /// 执行导出格式插件的 exportResponse(data) 函数（响应数据导出）
    pub async fn run_response_export(
        &self,
        plugin_id: &str,
        data_json: &str,
    ) -> Result<ExportResult, String> {
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => Err(format!(
                "原生插件 '{}' 不支持 response export 操作",
                plugin_id
            )),
            PluginExecutionRuntime::JavaScript(script) => {
                let data = data_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_response_export_script(&script, &data)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => Err(format!(
                "WASM 插件 '{}' 不支持 response export 操作",
                plugin_id
            )),
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
    ///
    /// `wasm_runtime` 为长生命周期的共享实例（Tauri managed State），
    /// WASM 插件复用其已编译/缓存的模块，避免每次调用都重新读取与 JIT .wasm；
    /// JS / Native 路径忽略该参数。
    pub async fn run_crypto(
        &self,
        plugin_id: &str,
        algorithm_id: &str,
        mode: &str,
        input: &str,
        params_json: &str,
        wasm_runtime: &crate::wasm_runtime::WasmPluginRuntime,
    ) -> Result<CryptoResult, String> {
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => {
                Err(format!("原生插件 '{}' 不支持 crypto 操作", plugin_id))
            }
            PluginExecutionRuntime::JavaScript(script) => {
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
            PluginExecutionRuntime::Wasm => {
                // WASM crypto 走 buffer-ABI，由共享的 WasmPluginRuntime 执行，
                // 复用其已编译缓存的模块，避免每次调用重新读取与 JIT .wasm。
                // version read 锁覆盖 load + execute，升级/卸载只能在本次一致
                // 快照执行完成后提交。
                self.run_registered_wasm_crypto(
                    wasm_runtime,
                    plugin_id,
                    algorithm_id,
                    mode,
                    input,
                    params_json,
                )
                .await
            }
        }
    }

    /// 执行插件右键菜单动作
    pub async fn run_context_menu_action(
        &self,
        plugin_id: &str,
        action: &str,
        selected_text: &str,
        context_json: &str,
    ) -> Result<ContextMenuActionResult, String> {
        match self.execution_runtime(plugin_id).await? {
            PluginExecutionRuntime::Native(_) => Err(format!(
                "原生插件 '{}' 不支持 contextMenuAction 操作",
                plugin_id
            )),
            PluginExecutionRuntime::JavaScript(script) => {
                let act = action.to_string();
                let text = selected_text.to_string();
                let ctx = context_json.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    execute_context_menu_script(&script, &act, &text, &ctx)
                })
                .await
                .map_err(|e| format!("执行插件失败: {}", e))??;
                Ok(result)
            }
            PluginExecutionRuntime::Wasm => Err(format!(
                "WASM 插件 '{}' 不支持 contextMenuAction 操作",
                plugin_id
            )),
        }
    }
}

// ── tar.gz extraction ──

async fn restore_backup_directory(
    canonical_dir: &Path,
    backup_dir: &Path,
    quarantine_dir: Option<&Path>,
) -> Result<(), String> {
    if let Some(quarantine_dir) = quarantine_dir {
        tokio::fs::rename(canonical_dir, quarantine_dir)
            .await
            .map_err(|error| format!("隔离损坏 canonical 目录失败: {}", error))?;
    }

    if let Err(restore_error) = tokio::fs::rename(backup_dir, canonical_dir).await {
        if let Some(quarantine_dir) = quarantine_dir {
            return match tokio::fs::rename(quarantine_dir, canonical_dir).await {
                Ok(()) => Err(format!(
                    "恢复备份失败，已回滚损坏 canonical 目录: {}",
                    restore_error
                )),
                Err(rollback_error) => Err(format!(
                    "恢复备份失败 ({})，损坏 canonical 目录回滚也失败 ({})；隔离目录保留在 {:?}",
                    restore_error, rollback_error, quarantine_dir
                )),
            };
        }
        return Err(format!("恢复备份失败: {}", restore_error));
    }

    Ok(())
}

pub(crate) fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty() || plugin_id.chars().any(char::is_control) {
        return Err("插件 ID 不能为空或包含控制字符".to_string());
    }
    if plugin_id.starts_with(".install-")
        || plugin_id.starts_with(".backup-")
        || plugin_id.starts_with(".invalid-")
        || plugin_id.starts_with(".uninstall-")
    {
        return Err(format!("插件 ID '{}' 使用了保留的事务目录前缀", plugin_id));
    }

    let mut components = Path::new(plugin_id).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None)
            if component == std::ffi::OsStr::new(plugin_id) =>
        {
            Ok(())
        }
        _ => Err(format!("插件 ID '{}' 包含非法路径字符", plugin_id)),
    }
}

async fn valid_backup_plugin_id(backup_dir: &Path) -> Result<String, String> {
    let metadata = tokio::fs::symlink_metadata(backup_dir)
        .await
        .map_err(|e| format!("读取备份目录元数据失败: {}", e))?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("备份路径不是普通目录".to_string());
    }

    let manifest_path = backup_dir.join("manifest.json");
    let manifest_content = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("读取备份 manifest 失败: {}", e))?;
    let manifest_content = manifest_content
        .strip_prefix('\u{feff}')
        .unwrap_or(&manifest_content);
    let manifest: PluginManifest = serde_json::from_str(manifest_content)
        .map_err(|e| format!("解析备份 manifest 失败: {}", e))?;

    validate_plugin_id(&manifest.id)?;
    validate_plugin_entrypoint(backup_dir, &manifest.entrypoint).await?;
    Ok(manifest.id)
}

pub(crate) async fn validate_plugin_entrypoint(
    plugin_dir: &Path,
    entrypoint: &str,
) -> Result<(), String> {
    let entrypoint_path = Path::new(entrypoint);
    if entrypoint.is_empty()
        || entrypoint_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "插件 entrypoint '{}' 不是安全的相对路径",
            entrypoint
        ));
    }

    let plugin_dir_metadata = tokio::fs::symlink_metadata(plugin_dir)
        .await
        .map_err(|e| format!("读取插件目录元数据失败: {}", e))?;
    if plugin_dir_metadata.file_type().is_symlink() || !plugin_dir_metadata.is_dir() {
        return Err("插件目录不是普通目录".to_string());
    }

    let canonical_plugin_dir = tokio::fs::canonicalize(plugin_dir)
        .await
        .map_err(|e| format!("规范化插件暂存目录失败: {}", e))?;
    let candidate = plugin_dir.join(entrypoint_path);
    let canonical_entrypoint = tokio::fs::canonicalize(&candidate)
        .await
        .map_err(|e| format!("插件 entrypoint '{}' 不存在或不可访问: {}", entrypoint, e))?;
    if !canonical_entrypoint.starts_with(&canonical_plugin_dir) {
        return Err(format!("插件 entrypoint '{}' 逃出插件目录", entrypoint));
    }

    let metadata = tokio::fs::metadata(&canonical_entrypoint)
        .await
        .map_err(|e| format!("读取插件 entrypoint 元数据失败: {}", e))?;
    if !metadata.is_file() {
        return Err(format!("插件 entrypoint '{}' 不是文件", entrypoint));
    }
    Ok(())
}

async fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    let metadata = match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };

    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        tokio::fs::remove_dir_all(path)
            .await
            .map_err(|e| e.to_string())
    } else {
        tokio::fs::remove_file(path)
            .await
            .map_err(|e| e.to_string())
    }
}

fn extend_with_size_limit(
    target: &mut Vec<u8>,
    chunk: &[u8],
    max_bytes: usize,
    label: &str,
) -> Result<(), String> {
    let new_len = target
        .len()
        .checked_add(chunk.len())
        .ok_or_else(|| format!("{}大小溢出", label))?;
    if new_len > max_bytes {
        return Err(format!("{}超过最大限制 {} 字节", label, max_bytes));
    }
    target.extend_from_slice(chunk);
    Ok(())
}

fn ensure_size_limit(actual: usize, max_bytes: usize, label: &str) -> Result<(), String> {
    if actual > max_bytes {
        return Err(format!("{}超过最大限制 {} 字节", label, max_bytes));
    }
    Ok(())
}

fn add_bounded_size(
    total: &mut usize,
    additional: usize,
    max_bytes: usize,
    label: &str,
) -> Result<(), String> {
    *total = total
        .checked_add(additional)
        .ok_or_else(|| format!("{}大小溢出", label))?;
    ensure_size_limit(*total, max_bytes, label)
}

fn account_json_string_size(
    total: &mut usize,
    value: &str,
    max_bytes: usize,
    label: &str,
) -> Result<(), String> {
    // Opening and closing quotes.
    add_bounded_size(total, 2, max_bytes, label)?;
    for byte in value.bytes() {
        let encoded_len = match byte {
            b'\x08' | b'\x09' | b'\x0a' | b'\x0c' | b'\x0d' | b'"' | b'\\' => 2,
            b'\x00'..=b'\x1f' => 6,
            _ => 1,
        };
        add_bounded_size(total, encoded_len, max_bytes, label)?;
    }
    Ok(())
}

fn serialize_zip_files_bounded(
    files: &std::collections::HashMap<String, String>,
    max_bytes: usize,
) -> Result<String, String> {
    let label = "ZIP JSON 数据";
    let mut encoded_size = 0;
    add_bounded_size(&mut encoded_size, 1, max_bytes, label)?; // {
    for (index, (name, content)) in files.iter().enumerate() {
        if index != 0 {
            add_bounded_size(&mut encoded_size, 1, max_bytes, label)?; // ,
        }
        account_json_string_size(&mut encoded_size, name, max_bytes, label)?;
        add_bounded_size(&mut encoded_size, 1, max_bytes, label)?; // :
        account_json_string_size(&mut encoded_size, content, max_bytes, label)?;
    }
    add_bounded_size(&mut encoded_size, 1, max_bytes, label)?; // }

    // The exact preflight above prevents serde_json from allocating an
    // oversized escaped string. Keep the postcondition too, so a future
    // serializer configuration change cannot silently bypass the cap.
    let json =
        serde_json::to_string(files).map_err(|e| format!("序列化 ZIP 文件内容失败: {}", e))?;
    ensure_size_limit(json.len(), max_bytes, label)?;
    debug_assert_eq!(json.len(), encoded_size);
    Ok(json)
}

fn account_archive_entry(
    entry_count: &mut usize,
    total_file_bytes: &mut u64,
    file_size: Option<u64>,
    limits: ArchiveLimits,
    label: &str,
) -> Result<(), String> {
    *entry_count = entry_count
        .checked_add(1)
        .ok_or_else(|| format!("{}条目数量溢出", label))?;
    if *entry_count > limits.entries {
        return Err(format!("{}条目数量超过最大限制 {}", label, limits.entries));
    }

    let Some(file_size) = file_size else {
        return Ok(());
    };
    if file_size > limits.file_bytes {
        return Err(format!(
            "{}单个文件超过最大限制 {} 字节",
            label, limits.file_bytes
        ));
    }
    *total_file_bytes = total_file_bytes
        .checked_add(file_size)
        .ok_or_else(|| format!("{}展开大小溢出", label))?;
    if *total_file_bytes > limits.total_bytes {
        return Err(format!(
            "{}累计展开大小超过最大限制 {} 字节",
            label, limits.total_bytes
        ));
    }
    Ok(())
}

/// Extract a .tar.gz archive into the target directory.
/// 自动检测 tar.gz 是否包含根目录前缀，兼容两种打包格式：
///   - 有前缀: `plugin-name/manifest.json` → 提取时去掉 `plugin-name/`
///   - 无前缀: `manifest.json` → 直接提取
fn extract_tar_gz(data: &[u8], target_dir: &std::path::Path) -> Result<(), String> {
    extract_tar_gz_with_limits(data, target_dir, PLUGIN_ARCHIVE_LIMITS)
}

fn extract_tar_gz_with_limits(
    data: &[u8],
    target_dir: &std::path::Path,
    limits: ArchiveLimits,
) -> Result<(), String> {
    // ── Pass 1: 检测是否所有条目共享一个公共根目录 ──
    let should_strip = {
        let gz = GzDecoder::new(data);
        let mut archive = tar::Archive::new(gz);
        let entries = archive
            .entries()
            .map_err(|e| format!("读取 tar 条目失败: {}", e))?;

        let mut common_root: Option<String> = None;
        let mut all_share_root = true;
        let mut entry_count = 0;
        let mut total_file_bytes = 0;

        for entry_result in entries {
            let entry = entry_result.map_err(|e| format!("读取 tar 条目失败: {}", e))?;
            let entry_type = entry.header().entry_type();
            let file_size = if entry_type.is_file() {
                Some(
                    entry
                        .header()
                        .size()
                        .map_err(|e| format!("读取 tar 条目大小失败: {}", e))?,
                )
            } else if entry_type.is_dir() {
                None
            } else {
                return Err("插件包包含不支持的条目类型".to_string());
            };
            account_archive_entry(
                &mut entry_count,
                &mut total_file_bytes,
                file_size,
                limits,
                "插件包",
            )?;
            let path = entry
                .path()
                .map_err(|e| format!("获取条目路径失败: {}", e))?;

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
                continue;
            }

            // 多组件：检查第一个组件是否一致
            let first = components[0].as_os_str().to_string_lossy().to_string();
            match &common_root {
                None => common_root = Some(first),
                Some(root) if *root == first => {} // 一致
                Some(_) => {
                    all_share_root = false;
                }
            }
        }

        all_share_root && common_root.is_some()
    };

    // ── Pass 2: 实际解压 ──
    let gz2 = GzDecoder::new(data);
    let mut archive2 = tar::Archive::new(gz2);

    // 预先获取 target_dir 的规范路径用于安全校验
    let canonical_target =
        std::fs::canonicalize(target_dir).unwrap_or_else(|_| target_dir.to_path_buf());

    let skip_count = if should_strip { 1 } else { 0 };
    let mut entry_count = 0;
    let mut total_file_bytes = 0;

    for entry_result in archive2
        .entries()
        .map_err(|e| format!("读取 tar 条目失败: {}", e))?
    {
        let mut entry = entry_result.map_err(|e| format!("读取 tar 条目失败: {}", e))?;
        let entry_type = entry.header().entry_type();
        let file_size = if entry_type.is_file() {
            Some(
                entry
                    .header()
                    .size()
                    .map_err(|e| format!("读取 tar 条目大小失败: {}", e))?,
            )
        } else if entry_type.is_dir() {
            None
        } else {
            return Err("插件包包含不支持的条目类型".to_string());
        };
        account_archive_entry(
            &mut entry_count,
            &mut total_file_bytes,
            file_size,
            limits,
            "插件包",
        )?;
        let path = entry
            .path()
            .map_err(|e| format!("获取条目路径失败: {}", e))?;

        let relative: PathBuf = path.components().skip(skip_count).collect();

        // 跳过空路径（根目录条目本身）
        if relative.as_os_str().is_empty() {
            continue;
        }

        // 仅允许普通相对路径组件。发现可疑条目时整个安装失败，避免攻击包
        // 在跳过部分文件后仍因碰巧包含 manifest 而被当作有效插件启用。
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(format!("插件包包含不安全路径: {:?}", relative));
        }

        let target_path = target_dir.join(&relative);

        // 二次校验：确保最终路径在 target_dir 内
        let canonical_path = if target_path.exists() {
            std::fs::canonicalize(&target_path).unwrap_or_else(|_| target_path.clone())
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
            return Err(format!(
                "插件包路径逃出暂存目录: {:?} → {:?}",
                relative, canonical_path
            ));
        }

        if entry_type.is_dir() {
            std::fs::create_dir_all(&target_path)
                .map_err(|e| format!("创建目录失败 {:?}: {}", target_path, e))?;
        } else if entry_type.is_file() {
            // Ensure parent directory exists
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败 {:?}: {}", parent, e))?;
            }

            let mut output = std::fs::File::create(&target_path)
                .map_err(|e| format!("创建文件失败 {:?}: {}", target_path, e))?;
            let copied = std::io::copy(&mut entry, &mut output)
                .map_err(|e| format!("提取文件失败 {:?}: {}", relative, e))?;
            if copied != file_size.unwrap_or_default() {
                return Err(format!(
                    "插件包条目大小不一致: {:?}（声明 {}，实际 {}）",
                    relative,
                    file_size.unwrap_or_default(),
                    copied
                ));
            }
        }
    }

    log::info!("tar.gz 解压完成 (strip_root={})", should_strip);
    Ok(())
}

// ── JS execution ──

fn plugin_js_context() -> Context {
    let mut context = Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(JS_LOOP_ITERATION_LIMIT);
    context
}

/// Execute a JS plugin script in a sandboxed boa_engine context.
fn execute_parse_script(script: &str, raw_data: &str) -> Result<ParseResult, String> {
    let mut context = plugin_js_context();

    // Execute the plugin script (defines the parse function)
    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    // 使用 serde_json::to_string 对 raw_data 进行安全转义，
    // 可正确处理所有特殊字符（\0, \u2028, \u2029, 反引号等），防止 JS 注入。
    let json_escaped =
        serde_json::to_string(raw_data).map_err(|e| format!("序列化输入数据失败: {}", e))?;
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

    ensure_size_limit(base64_data.len(), MAX_RENDER_BASE64_INPUT_BYTES, "渲染输入")?;

    let mut context = plugin_js_context();

    // Execute the plugin script (defines the render function)
    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    // 尝试 base64 解码 + ZIP 预处理
    let zip_files_json = match base64::engine::general_purpose::STANDARD.decode(base64_data) {
        Ok(bytes) => {
            // 检查是否为 ZIP 文件（PK 签名 0x50 0x4b）
            if bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b {
                let files = extract_zip_to_map(&bytes)?;
                Some(serialize_zip_files_bounded(
                    &files,
                    MAX_RENDER_ZIP_JSON_BYTES,
                )?)
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
    let json_escaped =
        serde_json::to_string(base64_data).map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!("JSON.stringify(render({}))", json_escaped);

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 render() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "render() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let rendered: RenderResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 render 返回 JSON 失败: {}", e))?;

    Ok(rendered)
}

/// 将 ZIP 字节提取为 { 文件路径: 文件内容(字符串) } 映射。
/// 仅提取文本/XML 类型的文件，跳过二进制文件。
fn extract_zip_to_map(bytes: &[u8]) -> Result<std::collections::HashMap<String, String>, String> {
    extract_zip_to_map_with_limits(bytes, RENDER_ZIP_LIMITS)
}

fn extract_zip_to_map_with_limits(
    bytes: &[u8],
    limits: ArchiveLimits,
) -> Result<std::collections::HashMap<String, String>, String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP 解析失败: {}", e))?;

    if archive.len() > limits.entries {
        return Err(format!("ZIP 条目数量超过最大限制 {}", limits.entries));
    }

    let mut files = std::collections::HashMap::new();
    let mut declared_total = 0_u64;
    let mut actual_total = 0_u64;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目 {} 失败: {}", i, e))?;

        if file.is_dir() {
            continue;
        }

        let name = file.name().to_string();

        let declared_size = file.size();
        if declared_size > limits.file_bytes {
            return Err(format!(
                "ZIP 文件 '{}' 超过单文件最大限制 {} 字节",
                name, limits.file_bytes
            ));
        }
        declared_total = declared_total
            .checked_add(declared_size)
            .ok_or_else(|| "ZIP 累计展开大小溢出".to_string())?;
        if declared_total > limits.total_bytes {
            return Err(format!(
                "ZIP 累计展开大小超过最大限制 {} 字节",
                limits.total_bytes
            ));
        }

        // `take` also protects against a malformed archive whose actual
        // decompressed size exceeds the central-directory declaration.
        let mut content = Vec::with_capacity(declared_size as usize);
        (&mut file)
            .take(limits.file_bytes.saturating_add(1))
            .read_to_end(&mut content)
            .map_err(|e| format!("读取文件 {} 失败: {}", name, e))?;
        if content.len() as u64 > limits.file_bytes {
            return Err(format!(
                "ZIP 文件 '{}' 超过单文件最大限制 {} 字节",
                name, limits.file_bytes
            ));
        }
        actual_total = actual_total
            .checked_add(content.len() as u64)
            .ok_or_else(|| "ZIP 累计展开大小溢出".to_string())?;
        if actual_total > limits.total_bytes {
            return Err(format!(
                "ZIP 累计展开大小超过最大限制 {} 字节",
                limits.total_bytes
            ));
        }

        // 尝试作为 UTF-8 文本（XLSX 的 XML 文件都是 UTF-8）
        if let Ok(text) = String::from_utf8(content) {
            files.insert(name, text);
        }
    }

    Ok(files)
}

/// Execute a JS plugin's hook(request) function in a sandboxed boa_engine context.
fn execute_hook_script(script: &str, request_json: &str) -> Result<HookResult, String> {
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let json_escaped =
        serde_json::to_string(request_json).map_err(|e| format!("序列化输入数据失败: {}", e))?;
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
fn execute_generate_script(
    script: &str,
    generator_id: &str,
    options_json: &str,
) -> Result<GenerateDataResult, String> {
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let gen_id_escaped = serde_json::to_string(generator_id)
        .map_err(|e| format!("序列化 generatorId 失败: {}", e))?;
    let opts_escaped =
        serde_json::to_string(options_json).map_err(|e| format!("序列化 options 失败: {}", e))?;
    let call_script = format!(
        "JSON.stringify(generate({}, JSON.parse({})))",
        gen_id_escaped, opts_escaped
    );

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 generate() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "generate() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: GenerateDataResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 generate 返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute a JS plugin's exportRequest(request) function in a sandboxed boa_engine context.
fn execute_export_script(script: &str, request_json: &str) -> Result<ExportResult, String> {
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let json_escaped =
        serde_json::to_string(request_json).map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!(
        "JSON.stringify(exportRequest(JSON.parse({})))",
        json_escaped
    );

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 exportRequest() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "exportRequest() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: ExportResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 export 返回 JSON 失败: {}", e))?;

    Ok(parsed)
}

/// Execute a JS plugin's exportResponse(data) function in a sandboxed boa_engine context.
fn execute_response_export_script(script: &str, data_json: &str) -> Result<ExportResult, String> {
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let json_escaped =
        serde_json::to_string(data_json).map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let call_script = format!(
        "JSON.stringify(exportResponse(JSON.parse({})))",
        json_escaped
    );

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 exportResponse() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| "exportResponse() 返回值不是字符串（需要 JSON.stringify 包装）".to_string())?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: ExportResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 response export 返回 JSON 失败: {}", e))?;

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
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let algo_escaped = serde_json::to_string(algorithm_id)
        .map_err(|e| format!("序列化 algorithmId 失败: {}", e))?;
    let input_escaped =
        serde_json::to_string(input).map_err(|e| format!("序列化输入数据失败: {}", e))?;
    let params_escaped =
        serde_json::to_string(params_json).map_err(|e| format!("序列化参数失败: {}", e))?;

    // 调用 encrypt(algorithmId, input, params) 或 decrypt(algorithmId, input, params)
    let fn_name = if mode == "encrypt" {
        "encrypt"
    } else {
        "decrypt"
    };
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

    let parsed: CryptoResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 {} 返回 JSON 失败: {}", fn_name, e))?;

    Ok(parsed)
}

/// Execute a JS plugin's onContextMenuAction function in a sandboxed boa_engine context.
fn execute_context_menu_script(
    script: &str,
    action: &str,
    selected_text: &str,
    context_json: &str,
) -> Result<ContextMenuActionResult, String> {
    let mut context = plugin_js_context();

    context
        .eval(Source::from_bytes(script))
        .map_err(|e| format!("执行脚本错误: {}", format_js_error(&e)))?;

    let action_escaped =
        serde_json::to_string(action).map_err(|e| format!("序列化 action 失败: {}", e))?;
    let text_escaped =
        serde_json::to_string(selected_text).map_err(|e| format!("序列化选中文本失败: {}", e))?;
    let ctx_escaped =
        serde_json::to_string(context_json).map_err(|e| format!("序列化上下文失败: {}", e))?;

    let call_script = format!(
        "JSON.stringify(onContextMenuAction({}, {}, JSON.parse({})))",
        action_escaped, text_escaped, ctx_escaped
    );

    let result = context
        .eval(Source::from_bytes(call_script.as_bytes()))
        .map_err(|e| format!("调用 onContextMenuAction() 失败: {}", format_js_error(&e)))?;

    let json_str = result
        .as_string()
        .ok_or_else(|| {
            "onContextMenuAction() 返回值不是字符串（需要 JSON.stringify 包装）".to_string()
        })?
        .to_std_string()
        .map_err(|e| format!("UTF-16 转换失败: {}", e))?;

    let parsed: ContextMenuActionResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 contextMenuAction 返回 JSON 失败: {}", e))?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_directory_prefixes_are_reserved_plugin_ids() {
        for plugin_id in [
            ".install-demo",
            ".backup-demo",
            ".invalid-demo",
            ".uninstall-demo",
        ] {
            assert!(validate_plugin_id(plugin_id).is_err(), "{plugin_id}");
        }
        assert!(validate_plugin_id("demo-plugin").is_ok());
    }

    /// 自包含的 response-export 测试插件，避免测试依赖相邻的插件仓库。
    const RESPONSE_EXPORT_FIXTURE: &str = r#"
function exportResponse(data) {
  function exportResult(content, error) {
    return {
      content: content,
      filename: "response.csv",
      mimeType: "text/csv",
      error: error || null
    };
  }

  var body;
  try {
    body = JSON.parse(data.body || "");
  } catch (error) {
    return exportResult("", "Response body is not valid JSON");
  }

  var selected = body;
  var path = data.params && data.params.jsonPath;
  if (path && path !== "(root)") {
    var segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i];
      if (!segment) {
        continue;
      }
      if (selected === null || selected === undefined || selected[segment] === undefined) {
        return exportResult("", "JSON path not found: " + path);
      }
      selected = selected[segment];
    }
  }

  if (!Array.isArray(selected)) {
    return exportResult("", "Selected value is not an array");
  }
  if (selected.length === 0) {
    return exportResult("", "Selected array is empty");
  }

  var first = selected[0];
  var primitiveRows = first === null || typeof first !== "object" || Array.isArray(first);
  var headers = primitiveRows ? ["value"] : Object.keys(first);
  if (headers.length === 0) {
    return exportResult("", "Selected objects have no fields");
  }

  function csvValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    var text = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/[",\r\n]/.test(text)) {
      return "\"" + text.replace(/"/g, "\"\"") + "\"";
    }
    return text;
  }

  var lines = [headers.map(csvValue).join(",")];
  for (var rowIndex = 0; rowIndex < selected.length; rowIndex += 1) {
    var row = selected[rowIndex];
    var values;
    if (primitiveRows) {
      values = [row];
    } else {
      values = headers.map(function (header) { return row[header]; });
    }
    lines.push(values.map(csvValue).join(","));
  }

  return exportResult(lines.join("\n"), null);
}
"#;

    fn load_plugin_script() -> String {
        RESPONSE_EXPORT_FIXTURE.to_string()
    }

    #[test]
    fn test_response_export_nested_array() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "{\"code\":200,\"data\":{\"records\":[{\"id\":1,\"name\":\"Alice\"},{\"id\":2,\"name\":\"Bob\"}]}}",
            "params": { "jsonPath": "data.records" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none(), "应无错误: {:?}", result.error);
        assert!(
            result.content.contains("id,name"),
            "应包含表头: {}",
            result.content
        );
        assert!(result.content.contains("1,Alice"), "应包含数据行");
        assert!(result.content.contains("2,Bob"), "应包含数据行");
        assert_eq!(result.mime_type, "text/csv");
        assert!(result.filename.ends_with(".csv"));
    }

    #[test]
    fn test_response_export_root_array() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "[{\"city\":\"北京\",\"pop\":2154},{\"city\":\"上海\",\"pop\":2487}]",
            "params": { "jsonPath": "(root)" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none());
        assert!(result.content.contains("city,pop"));
        assert!(result.content.contains("北京"));
        assert!(result.content.contains("上海"));
    }

    #[test]
    fn test_response_export_csv_escaping() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "[{\"name\":\"O'Brien, Jr.\",\"desc\":\"has \\\"quotes\\\"\"}]",
            "params": { "jsonPath": "(root)" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none());
        // 含逗号和引号的字段应被双引号包裹
        assert!(result.content.contains("\"O'Brien, Jr.\""));
        assert!(result.content.contains("\"\"quotes\"\""));
    }

    #[test]
    fn test_response_export_empty_array() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "{\"items\":[]}",
            "params": { "jsonPath": "items" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_some(), "空数组应返回错误");
    }

    #[test]
    fn test_response_export_invalid_path() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "{\"data\":{\"list\":[1,2,3]}}",
            "params": { "jsonPath": "data.nonexistent" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_some(), "不存在的路径应返回错误");
    }

    #[test]
    fn test_response_export_nested_objects_as_json_string() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "[{\"id\":1,\"meta\":{\"tags\":[\"a\",\"b\"]}}]",
            "params": { "jsonPath": "(root)" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none());
        // 嵌套对象应被 JSON.stringify
        assert!(result.content.contains("id,meta"));
    }

    #[test]
    fn test_response_export_primitive_array() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "{\"tags\":[\"rust\",\"tauri\",\"react\"]}",
            "params": { "jsonPath": "tags" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none());
        // 纯值数组应用 "value" 作为列名
        assert!(result.content.contains("value"));
        assert!(result.content.contains("rust"));
        assert!(result.content.contains("tauri"));
    }

    #[test]
    fn test_response_export_array_index_path() {
        let script = load_plugin_script();
        let data = serde_json::json!({
            "body": "{\"result\":{\"departments\":[{\"name\":\"dev\",\"members\":[{\"name\":\"Alice\"},{\"name\":\"Bob\"}]}]}}",
            "params": { "jsonPath": "result.departments[0].members" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none());
        assert!(result.content.contains("Alice"));
        assert!(result.content.contains("Bob"));
    }

    /// 生成大批量 JSON 数据并测试导出性能
    fn generate_bulk_json(count: usize, fields: usize) -> String {
        let mut records = Vec::with_capacity(count);
        for i in 0..count {
            let mut obj = serde_json::Map::new();
            obj.insert("id".into(), serde_json::json!(i + 1));
            obj.insert("name".into(), serde_json::json!(format!("User_{}", i + 1)));
            obj.insert(
                "email".into(),
                serde_json::json!(format!("user{}@test.com", i + 1)),
            );
            obj.insert("score".into(), serde_json::json!((i % 100) as f64 + 0.5));
            obj.insert("active".into(), serde_json::json!(i % 2 == 0));
            for f in 5..fields {
                obj.insert(
                    format!("field_{}", f),
                    serde_json::json!(format!("value_{}_{}", i, f)),
                );
            }
            records.push(serde_json::Value::Object(obj));
        }
        serde_json::to_string(&records).unwrap()
    }

    #[test]
    fn test_response_export_bulk_1000_rows() {
        let script = load_plugin_script();
        let body_json = generate_bulk_json(1_000, 10);
        let data = serde_json::json!({
            "body": body_json,
            "params": { "jsonPath": "(root)" }
        });
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        assert!(result.error.is_none(), "1K 行导出应成功");
        // 表头 + 1000 数据行
        let line_count = result.content.lines().count();
        assert_eq!(line_count, 1001, "应有 1001 行（1 表头 + 1000 数据）");
    }

    #[test]
    fn test_response_export_bulk_10000_rows() {
        let script = load_plugin_script();
        let body_json = generate_bulk_json(10_000, 10);
        let data = serde_json::json!({
            "body": body_json,
            "params": { "jsonPath": "(root)" }
        });
        let start = std::time::Instant::now();
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        let elapsed = start.elapsed();
        assert!(result.error.is_none(), "10K 行导出应成功");
        let line_count = result.content.lines().count();
        assert_eq!(line_count, 10_001);
        println!(
            "[perf] 10K rows / 10 fields => CSV {}KB in {:?}",
            result.content.len() / 1024,
            elapsed
        );
    }

    #[test]
    fn test_response_export_bulk_wide_table() {
        let script = load_plugin_script();
        let body_json = generate_bulk_json(5_000, 30);
        let data = serde_json::json!({
            "body": body_json,
            "params": { "jsonPath": "(root)" }
        });
        let start = std::time::Instant::now();
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        let elapsed = start.elapsed();
        assert!(result.error.is_none(), "5K 行 30 列宽表导出应成功");
        // 验证列数
        let header = result.content.lines().next().unwrap();
        let col_count = header.split(',').count();
        assert_eq!(col_count, 30, "应有 30 列");
        println!(
            "[perf] 5K rows / 30 fields => CSV {}KB in {:?}",
            result.content.len() / 1024,
            elapsed
        );
    }

    #[test]
    fn test_response_export_bulk_50000_rows() {
        let script = load_plugin_script();
        let body_json = generate_bulk_json(50_000, 8);
        let data = serde_json::json!({
            "body": body_json,
            "params": { "jsonPath": "(root)" }
        });
        let start = std::time::Instant::now();
        let result = execute_response_export_script(&script, &data.to_string()).unwrap();
        let elapsed = start.elapsed();
        assert!(result.error.is_none(), "50K 行导出应成功");
        let line_count = result.content.lines().count();
        assert_eq!(line_count, 50_001);
        println!(
            "[perf] 50K rows / 8 fields => CSV {}MB in {:?}",
            result.content.len() / 1024 / 1024,
            elapsed
        );
    }

    fn plugin_test_dir(test_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("protoforge-{}-{}", test_name, uuid::Uuid::new_v4()))
    }

    #[tokio::test]
    async fn recovery_restore_failure_rolls_back_quarantined_canonical() {
        let root = plugin_test_dir("plugin-recovery-rollback");
        let plugins_dir = root.join("plugins");
        let canonical = plugins_dir.join("demo-plugin");
        let missing_backup = plugins_dir.join(".backup-missing");
        let quarantine = plugins_dir.join(".invalid-test");
        tokio::fs::create_dir_all(&canonical).await.unwrap();
        tokio::fs::write(canonical.join("corrupt-marker"), "preserve me")
            .await
            .unwrap();

        let error = restore_backup_directory(&canonical, &missing_backup, Some(&quarantine))
            .await
            .unwrap_err();

        assert!(error.contains("已回滚损坏 canonical 目录"));
        assert_eq!(
            tokio::fs::read_to_string(canonical.join("corrupt-marker"))
                .await
                .unwrap(),
            "preserve me"
        );
        assert!(!quarantine.exists());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    fn test_manifest(id: &str, version: &str, entrypoint: &str) -> PluginManifest {
        PluginManifest {
            id: id.to_string(),
            name: id.to_string(),
            version: version.to_string(),
            description: "test plugin".to_string(),
            author: "test".to_string(),
            plugin_type: PluginType::ProtocolParser,
            icon: "test".to_string(),
            entrypoint: entrypoint.to_string(),
            protocol_ids: vec![],
            tags: vec![],
            installed: true,
            download_url: None,
            sha256: None,
            source: "remote".to_string(),
            contributes: PluginContributes::default(),
            i18n: HashMap::new(),
            has_update: false,
            latest_version: None,
            panel_position: None,
            icon_namespace: None,
        }
    }

    fn make_plugin_archive(manifest: &PluginManifest) -> Vec<u8> {
        use flate2::Compression;
        use flate2::write::GzEncoder;

        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut archive = tar::Builder::new(encoder);
        let manifest_bytes = serde_json::to_vec(manifest).unwrap();

        let mut manifest_header = tar::Header::new_gnu();
        manifest_header.set_size(manifest_bytes.len() as u64);
        manifest_header.set_mode(0o644);
        manifest_header.set_cksum();
        archive
            .append_data(
                &mut manifest_header,
                "manifest.json",
                manifest_bytes.as_slice(),
            )
            .unwrap();

        let script = b"function parse() { return {}; }";
        let mut script_header = tar::Header::new_gnu();
        script_header.set_size(script.len() as u64);
        script_header.set_mode(0o644);
        script_header.set_cksum();
        archive
            .append_data(&mut script_header, "index.js", script.as_slice())
            .unwrap();

        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap()
    }

    fn make_text_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let cursor = std::io::Cursor::new(Vec::new());
        let mut archive = zip::ZipWriter::new(cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            archive.start_file(*name, options).unwrap();
            archive.write_all(content).unwrap();
        }
        archive.finish().unwrap().into_inner()
    }

    #[test]
    fn streamed_download_limit_accepts_boundary_and_rejects_overage() {
        let mut bytes = Vec::new();
        extend_with_size_limit(&mut bytes, b"ab", 4, "测试数据").unwrap();
        extend_with_size_limit(&mut bytes, b"cd", 4, "测试数据").unwrap();
        assert_eq!(bytes, b"abcd");

        let error = extend_with_size_limit(&mut bytes, b"e", 4, "测试数据").unwrap_err();
        assert!(error.contains("超过最大限制"));
        assert_eq!(bytes, b"abcd", "超限块不能被部分追加");
    }

    #[test]
    fn render_input_limit_accepts_boundary_and_rejects_overage() {
        ensure_size_limit(4, 4, "渲染输入").unwrap();
        let error = ensure_size_limit(5, 4, "渲染输入").unwrap_err();
        assert!(error.contains("渲染输入超过最大限制"));
    }

    #[test]
    fn tar_extraction_enforces_entry_file_and_total_limits() {
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        let script_len = b"function parse() { return {}; }".len() as u64;
        let archive = make_plugin_archive(&manifest);
        let manifest_len = manifest_bytes.len() as u64;
        let exact_limits = ArchiveLimits {
            entries: 2,
            file_bytes: manifest_len.max(script_len),
            total_bytes: manifest_len + script_len,
        };
        let target = plugin_test_dir("tar-resource-limits");
        std::fs::create_dir_all(&target).unwrap();

        extract_tar_gz_with_limits(&archive, &target, exact_limits).unwrap();
        assert!(target.join("manifest.json").is_file());
        assert!(target.join("index.js").is_file());

        let entry_error = extract_tar_gz_with_limits(
            &archive,
            &target,
            ArchiveLimits {
                entries: 1,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(entry_error.contains("条目数量超过"));

        let file_error = extract_tar_gz_with_limits(
            &archive,
            &target,
            ArchiveLimits {
                file_bytes: exact_limits.file_bytes - 1,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(file_error.contains("单个文件超过"));

        let total_error = extract_tar_gz_with_limits(
            &archive,
            &target,
            ArchiveLimits {
                total_bytes: exact_limits.total_bytes - 1,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(total_error.contains("累计展开大小超过"));

        std::fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn render_zip_enforces_entry_file_and_total_limits() {
        let archive = make_text_zip(&[("a.txt", b"1234"), ("b.txt", b"xyz")]);
        let exact_limits = ArchiveLimits {
            entries: 2,
            file_bytes: 4,
            total_bytes: 7,
        };

        let files = extract_zip_to_map_with_limits(&archive, exact_limits).unwrap();
        assert_eq!(files.get("a.txt").map(String::as_str), Some("1234"));
        assert_eq!(files.get("b.txt").map(String::as_str), Some("xyz"));

        let entry_error = extract_zip_to_map_with_limits(
            &archive,
            ArchiveLimits {
                entries: 1,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(entry_error.contains("条目数量超过"));

        let file_error = extract_zip_to_map_with_limits(
            &archive,
            ArchiveLimits {
                file_bytes: 3,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(file_error.contains("单文件最大限制"));

        let total_error = extract_zip_to_map_with_limits(
            &archive,
            ArchiveLimits {
                total_bytes: 6,
                ..exact_limits
            },
        )
        .unwrap_err();
        assert!(total_error.contains("累计展开大小超过"));
    }

    #[test]
    fn zip_json_limit_accounts_for_escape_expansion_before_serializing() {
        let files = HashMap::from([("control.txt".to_string(), "\0\x01\n".to_string())]);
        let exact_json = serde_json::to_string(&files).unwrap();

        let serialized = serialize_zip_files_bounded(&files, exact_json.len()).unwrap();
        assert_eq!(serialized, exact_json);
        assert!(serialized.contains("\\u0000"));
        assert!(serialized.contains("\\u0001"));

        let error = serialize_zip_files_bounded(&files, exact_json.len() - 1).unwrap_err();
        assert!(error.contains("ZIP JSON 数据超过最大限制"));
    }

    #[test]
    fn parse_script_stops_infinite_loop() {
        let error = execute_parse_script("function parse() { while (true) {} }", "")
            .expect_err("无限循环必须被运行时限制中止");
        assert!(error.contains("Maximum loop iteration limit"), "{error}");
    }

    #[test]
    fn render_and_hook_scripts_stop_infinite_loops() {
        let render_error = execute_render_script("function render() { while (true) {} }", "")
            .expect_err("render 无限循环必须被运行时限制中止");
        assert!(
            render_error.contains("Maximum loop iteration limit"),
            "{render_error}"
        );

        let hook_error = execute_hook_script("function hook() { while (true) {} }", "{}")
            .expect_err("hook 无限循环必须被运行时限制中止");
        assert!(
            hook_error.contains("Maximum loop iteration limit"),
            "{hook_error}"
        );
    }

    async fn seed_installed_plugin(
        manager: &PluginManager,
        plugin_id: &str,
        version: &str,
    ) -> PathBuf {
        tokio::fs::create_dir_all(&manager.plugins_dir)
            .await
            .unwrap();
        let plugin_dir = manager.plugins_dir.join(plugin_id);
        tokio::fs::create_dir(&plugin_dir).await.unwrap();
        tokio::fs::write(plugin_dir.join("old-marker"), version)
            .await
            .unwrap();
        let manifest = test_manifest(plugin_id, version, "index.js");
        manager.registry.write().await.insert(
            plugin_id.to_string(),
            RegisteredPlugin {
                manifest,
                runtime: PluginRuntime::JavaScript,
            },
        );
        plugin_dir
    }

    async fn assert_no_transaction_dirs(manager: &PluginManager) {
        let mut entries = tokio::fs::read_dir(&manager.plugins_dir).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            assert!(
                !entry.file_name().to_string_lossy().starts_with('.'),
                "事务临时目录未清理: {:?}",
                entry.path()
            );
        }
    }

    async fn write_scanned_plugin(
        manager: &PluginManager,
        directory_name: &str,
        manifest: &PluginManifest,
    ) -> PathBuf {
        let plugin_dir = manager.plugins_dir.join(directory_name);
        tokio::fs::create_dir_all(&plugin_dir).await.unwrap();
        tokio::fs::write(
            plugin_dir.join("manifest.json"),
            serde_json::to_vec(manifest).unwrap(),
        )
        .await
        .unwrap();
        tokio::fs::write(
            plugin_dir.join("index.js"),
            "function parse() { return {}; }",
        )
        .await
        .unwrap();
        plugin_dir
    }

    #[tokio::test]
    async fn scan_installed_skips_manifest_id_that_differs_from_directory() {
        let root = plugin_test_dir("plugin-scan-id-mismatch");
        let manager = PluginManager::new(&root);
        let manifest = test_manifest("manifest-id", "1.0.0", "index.js");
        write_scanned_plugin(&manager, "directory-id", &manifest).await;

        manager.scan_installed().await.unwrap();

        assert!(manager.list_installed().await.is_empty());
        assert!(!manager.registry.read().await.contains_key("manifest-id"));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_installed_skips_entrypoint_that_escapes_plugin_directory() {
        let root = plugin_test_dir("plugin-scan-entrypoint-escape");
        let manager = PluginManager::new(&root);
        let manifest = test_manifest("demo-plugin", "1.0.0", "../outside.js");
        write_scanned_plugin(&manager, "demo-plugin", &manifest).await;
        tokio::fs::write(manager.plugins_dir.join("outside.js"), "outside")
            .await
            .unwrap();

        manager.scan_installed().await.unwrap();

        assert!(manager.list_installed().await.is_empty());
        assert!(!manager.registry.read().await.contains_key("demo-plugin"));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_installed_registers_matching_safe_plugin() {
        let root = plugin_test_dir("plugin-scan-valid");
        let manager = PluginManager::new(&root);
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        write_scanned_plugin(&manager, "demo-plugin", &manifest).await;

        manager.scan_installed().await.unwrap();

        let installed = manager.list_installed().await;
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].id, "demo-plugin");
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn startup_scan_commit_blocks_uninstall_and_cannot_resurrect_plugin() {
        use tokio::sync::Notify;

        let root = plugin_test_dir("plugin-startup-scan-uninstall");
        let manager = Arc::new(PluginManager::new(&root));
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        write_scanned_plugin(&manager, "demo-plugin", &manifest).await;

        let scan_entered = Arc::new(Notify::new());
        let allow_scan_commit = Arc::new(Notify::new());
        let scan = {
            let manager = Arc::clone(&manager);
            let scan_entered = Arc::clone(&scan_entered);
            let allow_scan_commit = Arc::clone(&allow_scan_commit);
            tokio::spawn(async move {
                manager
                    .scan_installed_after(std::future::ready(()), async move {
                        scan_entered.notify_one();
                        allow_scan_commit.notified().await;
                    })
                    .await
            })
        };
        scan_entered.notified().await;

        let mut uninstall = {
            let manager = Arc::clone(&manager);
            tokio::spawn(async move { manager.uninstall("demo-plugin").await })
        };
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut uninstall)
                .await
                .is_err(),
            "uninstall must join the in-progress startup scan"
        );

        allow_scan_commit.notify_one();
        scan.await.unwrap().unwrap();
        uninstall.await.unwrap().unwrap();

        assert!(!manager.registry.read().await.contains_key("demo-plugin"));
        assert!(!manager.plugins_dir.join("demo-plugin").exists());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn startup_recovery_finishes_before_install_creates_staging() {
        use tokio::sync::Notify;

        let root = plugin_test_dir("plugin-startup-scan-install");
        let manager = Arc::new(PluginManager::new(&root));
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        let archive = make_plugin_archive(&manifest);

        let recovery_entered = Arc::new(Notify::new());
        let allow_recovery = Arc::new(Notify::new());
        let scan = {
            let manager = Arc::clone(&manager);
            let recovery_entered = Arc::clone(&recovery_entered);
            let allow_recovery = Arc::clone(&allow_recovery);
            tokio::spawn(async move {
                manager
                    .scan_installed_after(
                        async move {
                            recovery_entered.notify_one();
                            allow_recovery.notified().await;
                        },
                        std::future::ready(()),
                    )
                    .await
            })
        };
        recovery_entered.notified().await;

        let mut install = {
            let manager = Arc::clone(&manager);
            tokio::spawn(async move {
                manager
                    .install_downloaded_archive("demo-plugin", &archive, None)
                    .await
            })
        };
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut install)
                .await
                .is_err(),
            "install must not create staging before startup recovery finishes"
        );
        assert!(!manager.plugins_dir.exists());

        allow_recovery.notify_one();
        scan.await.unwrap().unwrap();
        let installed = install.await.unwrap().unwrap();
        assert_eq!(installed.id, "demo-plugin");
        assert!(manager.plugins_dir.join("demo-plugin").exists());
        assert_no_transaction_dirs(&manager).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn plugin_icon_rejects_traversal_and_unregistered_directories() {
        let root = plugin_test_dir("plugin-icon-path-safety");
        let manager = PluginManager::new(&root);
        let outside_dir = root.join("outside");
        tokio::fs::create_dir_all(&outside_dir).await.unwrap();
        tokio::fs::write(outside_dir.join("icon.svg"), "outside-secret")
            .await
            .unwrap();

        assert!(manager.get_plugin_icon("../outside").await.is_err());
        assert!(
            manager
                .get_plugin_icon(outside_dir.to_str().unwrap())
                .await
                .is_err()
        );

        let rogue_dir = manager.plugins_dir.join("rogue-plugin");
        tokio::fs::create_dir_all(&rogue_dir).await.unwrap();
        tokio::fs::write(rogue_dir.join("icon.svg"), "unregistered-secret")
            .await
            .unwrap();
        let error = manager.get_plugin_icon("rogue-plugin").await.unwrap_err();
        assert!(error.contains("未注册"));

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn plugin_icon_rejects_symlink_escape_but_reads_regular_icon() {
        let root = plugin_test_dir("plugin-icon-symlink");
        let manager = PluginManager::new(&root);
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        let plugin_dir = write_scanned_plugin(&manager, "demo-plugin", &manifest).await;
        let outside_icon = root.join("outside.svg");
        tokio::fs::write(&outside_icon, "outside-secret")
            .await
            .unwrap();
        std::os::unix::fs::symlink(&outside_icon, plugin_dir.join("icon.svg")).unwrap();

        let error = manager.get_plugin_icon("demo-plugin").await.unwrap_err();
        assert!(error.contains("符号链接"));

        tokio::fs::remove_file(plugin_dir.join("icon.svg"))
            .await
            .unwrap();
        tokio::fs::write(plugin_dir.join("icon.svg"), "safe-icon")
            .await
            .unwrap();
        let icon = manager
            .get_plugin_icon("demo-plugin")
            .await
            .unwrap()
            .unwrap();
        assert!(icon.starts_with("data:image/svg+xml;base64,"));

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn direct_wasm_runtime_requires_registered_wasm_plugin() {
        fn native_stub(_: &str) -> ParseResult {
            unreachable!("native stub must not execute")
        }

        let root = plugin_test_dir("plugin-wasm-registry-authorization");
        let manager = PluginManager::new(&root);
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.wasm");
        let plugin_dir = write_scanned_plugin(&manager, "demo-plugin", &manifest).await;
        tokio::fs::write(plugin_dir.join("index.wasm"), "(module)")
            .await
            .unwrap();
        manager.registry.write().await.insert(
            "demo-plugin".to_string(),
            RegisteredPlugin {
                manifest: manifest.clone(),
                runtime: PluginRuntime::Native(native_stub),
            },
        );
        manager.scan_installed().await.unwrap();

        let wasm_runtime = crate::wasm_runtime::WasmPluginRuntime::new(&root);
        let error = manager
            .load_wasm_plugin(&wasm_runtime, "demo-plugin")
            .await
            .unwrap_err();
        assert!(error.contains("不是 WASM 插件"));
        assert!(
            manager
                .scan_and_load_wasm_plugins(&wasm_runtime)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(wasm_runtime.list_loaded().await.is_empty());

        // A plugin that was legitimately loaded must become unreachable as
        // soon as its registry entry is removed, even if a compiled cache is
        // deliberately left behind to model a delayed cleanup.
        manager.registry.write().await.insert(
            "demo-plugin".to_string(),
            RegisteredPlugin {
                manifest,
                runtime: PluginRuntime::Wasm,
            },
        );
        manager
            .load_wasm_plugin(&wasm_runtime, "demo-plugin")
            .await
            .unwrap();
        assert_eq!(wasm_runtime.list_loaded().await.len(), 1);
        manager.registry.write().await.remove("demo-plugin");

        let error = manager
            .parse_wasm_data(&wasm_runtime, "demo-plugin", "payload")
            .await
            .unwrap_err();
        assert!(error.contains("未注册"));

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_recovery_restores_single_backup_and_cleans_staging() {
        let root = plugin_test_dir("plugin-scan-recover-single");
        let setup_manager = PluginManager::new(&root);
        let manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        let backup = write_scanned_plugin(&setup_manager, ".backup-interrupted", &manifest).await;
        let staging = setup_manager.plugins_dir.join(".install-interrupted");
        tokio::fs::create_dir_all(&staging).await.unwrap();
        tokio::fs::write(staging.join("partial-download"), "partial")
            .await
            .unwrap();

        // 模拟进程退出后重新构造 manager，并执行启动扫描。
        let restarted_manager = PluginManager::new(&root);
        restarted_manager.scan_installed().await.unwrap();

        assert!(!backup.exists());
        assert!(!staging.exists());
        assert!(restarted_manager.plugins_dir.join("demo-plugin").exists());
        let installed = restarted_manager.list_installed().await;
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].id, "demo-plugin");
        assert_eq!(installed[0].version, "1.0.0");
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_recovery_cleans_stale_backup_when_canonical_exists() {
        let root = plugin_test_dir("plugin-scan-recover-stale");
        let setup_manager = PluginManager::new(&root);
        let current = test_manifest("demo-plugin", "2.0.0", "index.js");
        write_scanned_plugin(&setup_manager, "demo-plugin", &current).await;
        let old = test_manifest("demo-plugin", "1.0.0", "index.js");
        let backup = write_scanned_plugin(&setup_manager, ".backup-stale", &old).await;

        let restarted_manager = PluginManager::new(&root);
        restarted_manager.scan_installed().await.unwrap();

        assert!(!backup.exists());
        let installed = restarted_manager.list_installed().await;
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].version, "2.0.0");
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_recovery_restores_backup_when_canonical_is_corrupt() {
        let root = plugin_test_dir("plugin-scan-recover-corrupt");
        let setup_manager = PluginManager::new(&root);
        let canonical = setup_manager.plugins_dir.join("demo-plugin");
        tokio::fs::create_dir_all(&canonical).await.unwrap();
        tokio::fs::write(canonical.join("manifest.json"), "{ broken json")
            .await
            .unwrap();
        let backup_manifest = test_manifest("demo-plugin", "1.0.0", "index.js");
        let backup = write_scanned_plugin(&setup_manager, ".backup-valid", &backup_manifest).await;

        let restarted_manager = PluginManager::new(&root);
        restarted_manager.scan_installed().await.unwrap();

        assert!(!backup.exists());
        let installed = restarted_manager.list_installed().await;
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].id, "demo-plugin");
        assert_eq!(installed[0].version, "1.0.0");
        let mut entries = tokio::fs::read_dir(&restarted_manager.plugins_dir)
            .await
            .unwrap();
        let mut found_quarantine = false;
        while let Some(entry) = entries.next_entry().await.unwrap() {
            if entry.file_name().to_string_lossy().starts_with(".invalid-") {
                found_quarantine = true;
            }
        }
        assert!(found_quarantine);
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn scan_recovery_preserves_multiple_backups_when_canonical_is_missing() {
        let root = plugin_test_dir("plugin-scan-recover-ambiguous");
        let setup_manager = PluginManager::new(&root);
        let first = test_manifest("demo-plugin", "1.0.0", "index.js");
        let first_backup = write_scanned_plugin(&setup_manager, ".backup-first", &first).await;
        let second = test_manifest("demo-plugin", "2.0.0", "index.js");
        let second_backup = write_scanned_plugin(&setup_manager, ".backup-second", &second).await;

        let restarted_manager = PluginManager::new(&root);
        restarted_manager.scan_installed().await.unwrap();

        assert!(first_backup.exists());
        assert!(second_backup.exists());
        assert!(!restarted_manager.plugins_dir.join("demo-plugin").exists());
        assert!(restarted_manager.list_installed().await.is_empty());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn hash_mismatch_preserves_installed_plugin() {
        let root = plugin_test_dir("plugin-hash-rollback");
        let manager = PluginManager::new(&root);
        let plugin_dir = seed_installed_plugin(&manager, "demo-plugin", "1.0.0").await;

        let error = manager
            .verify_and_install_downloaded_archive(
                "demo-plugin",
                b"new archive bytes",
                Some("sha256:00"),
                None,
            )
            .await
            .unwrap_err();

        assert!(error.contains("完整性校验失败"));
        assert_eq!(
            tokio::fs::read_to_string(plugin_dir.join("old-marker"))
                .await
                .unwrap(),
            "1.0.0"
        );
        assert_eq!(
            manager
                .registry
                .read()
                .await
                .get("demo-plugin")
                .unwrap()
                .manifest
                .version,
            "1.0.0"
        );
        assert_no_transaction_dirs(&manager).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn manifest_id_mismatch_preserves_installed_plugin() {
        let root = plugin_test_dir("plugin-id-rollback");
        let manager = PluginManager::new(&root);
        let plugin_dir = seed_installed_plugin(&manager, "demo-plugin", "1.0.0").await;
        let archive = make_plugin_archive(&test_manifest("another-plugin", "2.0.0", "index.js"));

        let error = manager
            .install_downloaded_archive("demo-plugin", &archive, None)
            .await
            .unwrap_err();

        assert!(error.contains("插件包 ID 不匹配"));
        assert!(plugin_dir.join("old-marker").exists());
        assert_eq!(
            manager
                .registry
                .read()
                .await
                .get("demo-plugin")
                .unwrap()
                .manifest
                .version,
            "1.0.0"
        );
        assert_no_transaction_dirs(&manager).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn entrypoint_escape_is_rejected_before_activation() {
        let root = plugin_test_dir("plugin-entrypoint-safety");
        let manager = PluginManager::new(&root);
        let plugin_dir = seed_installed_plugin(&manager, "demo-plugin", "1.0.0").await;
        let archive = make_plugin_archive(&test_manifest("demo-plugin", "2.0.0", "../index.js"));

        let error = manager
            .install_downloaded_archive("demo-plugin", &archive, None)
            .await
            .unwrap_err();

        assert!(error.contains("不是安全的相对路径"));
        assert!(plugin_dir.join("old-marker").exists());
        assert_no_transaction_dirs(&manager).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn execution_and_atomic_switch_never_mix_manifest_and_directory_versions() {
        use tokio::sync::Notify;

        let root = plugin_test_dir("plugin-execution-atomic-switch");
        let manager = Arc::new(PluginManager::new(&root));
        tokio::fs::create_dir_all(&manager.plugins_dir)
            .await
            .unwrap();

        let old_manifest = test_manifest("demo-plugin", "1.0.0", "old.js");
        let old_dir = manager.plugins_dir.join("demo-plugin");
        tokio::fs::create_dir(&old_dir).await.unwrap();
        tokio::fs::write(old_dir.join("old.js"), "old-version-script")
            .await
            .unwrap();
        tokio::fs::write(
            old_dir.join("manifest.json"),
            serde_json::to_vec(&old_manifest).unwrap(),
        )
        .await
        .unwrap();
        manager.registry.write().await.insert(
            "demo-plugin".to_string(),
            RegisteredPlugin {
                manifest: old_manifest,
                runtime: PluginRuntime::JavaScript,
            },
        );
        manager.scan_installed().await.unwrap();

        let new_manifest = test_manifest("demo-plugin", "2.0.0", "new.js");
        let staging_dir = manager.plugins_dir.join(".install-switch-test");
        tokio::fs::create_dir(&staging_dir).await.unwrap();
        tokio::fs::write(staging_dir.join("new.js"), "new-version-script")
            .await
            .unwrap();
        tokio::fs::write(
            staging_dir.join("manifest.json"),
            serde_json::to_vec(&new_manifest).unwrap(),
        )
        .await
        .unwrap();

        let snapshot_entered = Arc::new(Notify::new());
        let allow_old_read = Arc::new(Notify::new());
        let execution = {
            let manager = Arc::clone(&manager);
            let snapshot_entered = Arc::clone(&snapshot_entered);
            let allow_old_read = Arc::clone(&allow_old_read);
            tokio::spawn(async move {
                manager
                    .execution_runtime_after("demo-plugin", async move {
                        snapshot_entered.notify_one();
                        allow_old_read.notified().await;
                    })
                    .await
            })
        };

        // The execution has selected the old manifest while holding the
        // per-plugin version read lock, but has not read its entrypoint yet.
        snapshot_entered.notified().await;
        let mut activation = {
            let manager = Arc::clone(&manager);
            let staging_dir = staging_dir.clone();
            let new_manifest = new_manifest.clone();
            tokio::spawn(async move {
                manager
                    .activate_staged_plugin(
                        "demo-plugin",
                        &staging_dir,
                        &new_manifest,
                        PluginRuntime::JavaScript,
                        None,
                    )
                    .await
            })
        };

        // Atomic activation must wait until the old entrypoint bytes are read;
        // otherwise it could pair old.js from the manifest with the new dir.
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut activation)
                .await
                .is_err()
        );
        allow_old_read.notify_one();

        match execution.await.unwrap().unwrap() {
            PluginExecutionRuntime::JavaScript(script) => {
                assert_eq!(script, "old-version-script")
            }
            _ => panic!("expected JavaScript execution snapshot"),
        }
        activation.await.unwrap().unwrap();

        assert!(!old_dir.join("old.js").exists());
        assert_eq!(
            manager
                .registry
                .read()
                .await
                .get("demo-plugin")
                .unwrap()
                .manifest
                .version,
            "2.0.0"
        );
        match manager.execution_runtime("demo-plugin").await.unwrap() {
            PluginExecutionRuntime::JavaScript(script) => {
                assert_eq!(script, "new-version-script")
            }
            _ => panic!("expected JavaScript execution snapshot"),
        }

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn wasm_cache_switch_commits_inside_plugin_version_write_lock() {
        use tokio::sync::Notify;

        let root = plugin_test_dir("plugin-wasm-cache-atomic-switch");
        let manager = Arc::new(PluginManager::new(&root));
        let wasm_runtime = Arc::new(crate::wasm_runtime::WasmPluginRuntime::new(&root));
        let old_manifest = test_manifest("demo-plugin", "1.0.0", "index.wasm");
        let old_dir = write_scanned_plugin(&manager, "demo-plugin", &old_manifest).await;
        tokio::fs::write(old_dir.join("index.wasm"), "(module)")
            .await
            .unwrap();
        manager.scan_installed().await.unwrap();
        manager
            .load_wasm_plugin(&wasm_runtime, "demo-plugin")
            .await
            .unwrap();
        assert_eq!(wasm_runtime.list_loaded().await.len(), 1);

        let new_manifest = test_manifest("demo-plugin", "2.0.0", "index.wasm");
        let staging_dir = manager.plugins_dir.join(".install-wasm-switch-test");
        tokio::fs::create_dir(&staging_dir).await.unwrap();
        tokio::fs::write(
            staging_dir.join("manifest.json"),
            serde_json::to_vec(&new_manifest).unwrap(),
        )
        .await
        .unwrap();
        tokio::fs::write(staging_dir.join("index.wasm"), "(module)")
            .await
            .unwrap();

        let commit_entered = Arc::new(Notify::new());
        let allow_cache_commit = Arc::new(Notify::new());
        let activation = {
            let manager = Arc::clone(&manager);
            let wasm_runtime = Arc::clone(&wasm_runtime);
            let commit_entered = Arc::clone(&commit_entered);
            let allow_cache_commit = Arc::clone(&allow_cache_commit);
            let staging_dir = staging_dir.clone();
            let new_manifest = new_manifest.clone();
            tokio::spawn(async move {
                manager
                    .activate_staged_plugin_after(
                        "demo-plugin",
                        &staging_dir,
                        &new_manifest,
                        PluginRuntime::Wasm,
                        Some(&wasm_runtime),
                        async move {
                            commit_entered.notify_one();
                            allow_cache_commit.notified().await;
                        },
                    )
                    .await
            })
        };
        commit_entered.notified().await;

        // Registry and directory already point at v2, while the old compiled
        // module is deliberately still cached. A direct parse must wait on the
        // same version lock instead of executing that old cache.
        let mut parse = {
            let manager = Arc::clone(&manager);
            let wasm_runtime = Arc::clone(&wasm_runtime);
            tokio::spawn(async move {
                manager
                    .parse_wasm_data(&wasm_runtime, "demo-plugin", "payload")
                    .await
            })
        };
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut parse)
                .await
                .is_err()
        );

        allow_cache_commit.notify_one();
        activation.await.unwrap().unwrap();
        let error = parse.await.unwrap().unwrap_err();
        assert!(error.contains("未加载"));
        assert!(wasm_runtime.list_loaded().await.is_empty());
        manager
            .load_wasm_plugin(&wasm_runtime, "demo-plugin")
            .await
            .unwrap();

        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn activation_failure_rolls_back_old_directory_and_registry() {
        let root = plugin_test_dir("plugin-rename-rollback");
        let manager = PluginManager::new(&root);
        let plugin_dir = seed_installed_plugin(&manager, "demo-plugin", "1.0.0").await;
        let missing_staging = manager.plugins_dir.join(".install-missing");
        let new_manifest = test_manifest("demo-plugin", "2.0.0", "index.js");

        let error = manager
            .activate_staged_plugin(
                "demo-plugin",
                &missing_staging,
                &new_manifest,
                PluginRuntime::JavaScript,
                None,
            )
            .await
            .unwrap_err();

        assert!(error.contains("已恢复旧版本"));
        assert!(plugin_dir.join("old-marker").exists());
        assert_eq!(
            manager
                .registry
                .read()
                .await
                .get("demo-plugin")
                .unwrap()
                .manifest
                .version,
            "1.0.0"
        );
        assert_no_transaction_dirs(&manager).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
