# ProtoForge 插件系统文档

ProtoForge 支持基于 WebAssembly (WASM) 和 JavaScript 运行时的插件系统，第三方开发者可通过声明式的扩展点模型（类似 VS Code 的 `contributes`）来扩展应用功能。

## 目录

- [架构概览](#架构概览)
- [插件类型](#插件类型)
- [插件清单结构](#插件清单结构)
- [扩展点详解（Contributes）](#扩展点详解contributes)
  - [1. 协议解析器 (parsers)](#1-协议解析器-parsers)
  - [2. 请求钩子 (requestHooks)](#2-请求钩子-requesthooks)
  - [3. 响应渲染器 (responseRenderers)](#3-响应渲染器-responserenderers)
  - [4. 数据生成器 (generators)](#4-数据生成器-generators)
  - [5. 导出格式 (exportFormats)](#5-导出格式-exportformats)
  - [6. 侧边栏面板 (sidebarPanels)](#6-侧边栏面板-sidebarpanels)
  - [7. 加密算法 (cryptoAlgorithms)](#7-加密算法-cryptoalgorithms)
  - [8. 图标包 (icons)](#8-图标包-icons)
  - [9. 右键菜单项 (contextMenuItems)](#9-右键菜单项-contextmenuitems)
  - [10. 字体 (fonts)](#10-字体-fonts)
- [运行时模型](#运行时模型)
- [插件开发指南](#插件开发指南)
- [完整示例](#完整示例)
- [API 参考](#api-参考)

---

## 架构概览

```
+----------------------------+
|     ProtoForge 前端        |
|  (React + TypeScript)      |
|                            |
|  pluginStore (Zustand)     |  ← 状态管理
|  pluginService (IPC)       |  ← 调用后端
+------------|---------------+
             | Tauri IPC (invoke)
+------------|---------------+
|   ProtoForge 后端          |
|   (Rust + Tauri)           |
|                            |
|   PluginManager            |
|   +-- registry (HashMap)   |  ← 统一注册表
|   +-- JavaScript (Boa)     |  ← JS 沙箱引擎
|   +-- WASM (Wasmtime)      |  ← WASM 运行时
|   +-- Native (Rust fn)     |  ← 原生函数
+----------------------------+
             |
   plugins/  目录
   +-- plugin-id/
       +-- manifest.json      ← 插件清单
       +-- index.js            ← 入口脚本
       +-- icon.png            ← 图标（可选）
```

### 核心设计原则

1. **声明式扩展点**：插件在 `manifest.json` 的 `contributes` 中声明提供的功能，前端根据声明动态构建 UI（菜单、面板、标签页等）。
2. **沙箱执行**：插件 JavaScript 在 Boa 引擎（Rust 实现的 JS 解释器）中运行，与主应用完全隔离，无法访问 DOM、网络和文件系统。
3. **三种运行时**：Native（Rust 原生，性能最高）、JavaScript（Boa，第三方插件主力）、WASM（Wasmtime，适合高性能场景）。
4. **热发现**：插件从 `{app_data}/plugins/` 目录和远程仓库发现，安装/卸载无破坏性。

---

## 插件类型

ProtoForge 支持 8 种插件类型：

| 类型 | 说明 | 适用场景 |
|---|---|---|
| `protocol-parser` | 将原始二进制/文本解析为结构化字段 | Modbus、MQTT、自定义协议 |
| `request-hook` | 请求发送前/响应接收后的钩子处理 | 签名、Token 注入、日志 |
| `response-renderer` | 自定义响应数据可视化 | Excel 查看器、图片画廊 |
| `data-generator` | Mock 数据生成 | 假名、UUID、时间戳 |
| `export-format` | 自定义导出格式 | cURL、HTTPie、代码片段 |
| `sidebar-panel` | 自定义侧边栏面板 | 统计面板、监控面板 |
| `crypto-tool` | 加密/解密/编码算法 | Base64、AES、RSA、SHA |
| `icon-pack` | 自定义图标库 | 品牌图标、协议图标 |

---

## 插件清单结构

每个插件的根目录必须包含 `manifest.json`：

```json
{
  "id": "my-plugin-id",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "插件功能简述",
  "author": "作者名",
  "pluginType": "crypto-tool",
  "icon": "icon.png",
  "entrypoint": "index.js",
  "protocolIds": [],
  "tags": ["crypto", "encoding"],
  "source": "remote",
  "contributes": { ... },
  "i18n": {
    "en": { "name": "My Plugin", "description": "English description" },
    "zh": { "name": "我的插件", "description": "中文描述" }
  },
  "panelPosition": "left",
  "iconNamespace": "my-icons"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识符（建议 kebab-case） |
| `name` | string | 是 | 显示名称 |
| `version` | string | 是 | 语义版本号（如 "1.2.0"） |
| `description` | string | 是 | 简要描述 |
| `author` | string | 是 | 作者名 |
| `pluginType` | enum | 是 | 上述 8 种类型之一 |
| `icon` | string | 是 | 图标文件路径（相对于插件目录）或 base64 |
| `entrypoint` | string | 是 | 主 JS 文件（如 "index.js"） |
| `protocolIds` | string[] | 否 | 该插件处理的协议 ID 列表 |
| `tags` | string[] | 否 | 分类标签 |
| `source` | string | 否 | "native" 或 "remote" |
| `contributes` | object | 是 | 扩展点声明（见下文） |
| `i18n` | object | 否 | 多语言翻译，键为语言代码 |
| `panelPosition` | enum | 否 | "left"、"right" 或 "both"（仅 sidebar-panel） |
| `iconNamespace` | string | 否 | 图标命名空间（仅 icon-pack） |

---

## 扩展点详解（Contributes）

`contributes` 是插件系统的核心，声明插件提供的所有功能。

### 1. 协议解析器 (parsers)

**插件类型**：`protocol-parser`

将原始二进制/文本数据解析为结构化字段，支持丰富的 UI 元数据。

```json
{
  "contributes": {
    "parsers": [
      { "protocolId": "modbus-tcp", "name": "Modbus TCP 解析器" }
    ]
  }
}
```

**JS 入口**需导出 `parse(rawData)` 函数：

```javascript
function parse(rawData) {
  // rawData 为十六进制字符串
  return {
    success: true,
    protocolName: "Modbus TCP",
    summary: "读保持寄存器 (FC 03)",
    fields: [
      {
        key: "transactionId", label: "事务 ID", value: 1,
        group: "头部", uiType: "text", color: "blue",
        isKeyInfo: true, tooltip: "MBAP 头部事务标识"
      }
    ],
    layout: {
      sections: [
        { title: "MBAP 头部", style: "key-value", color: "#3b82f6",
          fieldKeys: ["transactionId", "protocolId", "length", "unitId"] }
      ]
    }
  };
}
```

| 字段 UI 类型 | 说明 |
|---|---|
| `text` | 普通文本 |
| `status-dot` | 状态圆点 |
| `progress` | 进度条 |
| `bit-map` | 位图 |
| `code` | 代码块 |
| `json` | JSON 格式 |
| `badge` | 徽章 |

| 布局样式 | 说明 |
|---|---|
| `table` | 键值表格 |
| `register` | 登记表（多列多行） |
| `grid` | 卡片网格 |
| `key-value` | 紧凑键值对 |

**集成位置**：右侧边栏 > 协议解析面板 (`src/components/plugins/ProtocolParserPanel.tsx`)

---

### 2. 请求钩子 (requestHooks)

**插件类型**：`request-hook`

在请求发送前修改请求或在响应接收后处理响应。

```json
{
  "contributes": {
    "requestHooks": [
      { "hookType": "pre-request", "name": "AWS Signature V4", "description": "使用 AWS SigV4 签名请求" }
    ]
  }
}
```

**JS 入口**需导出 `preRequest(requestJson)` 或 `postResponse(responseJson)`：

```javascript
function preRequest(requestJson) {
  var req = JSON.parse(requestJson);
  return {
    headers: { "Authorization": "AWS4-HMAC-SHA256 ...", "X-Amz-Date": "20240101T000000Z" },
    queryParams: {}
  };
}
```

**集成位置**：HTTP 请求管线 (`src/services/httpService.ts`)

---

### 3. 响应渲染器 (responseRenderers)

**插件类型**：`response-renderer`

为特定 Content-Type 提供自定义渲染。

```json
{
  "contributes": {
    "responseRenderers": [
      { "contentTypes": ["application/vnd.ms-excel"], "name": "Excel 查看器", "icon": "table" }
    ]
  }
}
```

**JS 入口**需导出 `render(responseData)`：

```javascript
function render(responseData) {
  return {
    type: "table",
    sheets: [
      { name: "Sheet1", columns: ["姓名", "年龄"], rows: [["张三", "30"], ["李四", "25"]] }
    ]
  };
}
```

**集成位置**：响应查看器标签页 (`src/components/ui/ResponseViewer.tsx`)

---

### 4. 数据生成器 (generators)

**插件类型**：`data-generator`

生成 Mock 测试数据。出现在右键菜单的 "Mock 数据" 子菜单和 KV 编辑器的内联 Mock 按钮中。

```json
{
  "contributes": {
    "generators": [
      { "generatorId": "uuid-v4", "name": "UUID v4", "description": "生成随机 UUID" },
      { "generatorId": "fake-name", "name": "随机姓名", "description": "生成假名" }
    ]
  }
}
```

**JS 入口**需导出 `generate(generatorId, optionsJson)`：

```javascript
function generate(generatorId, optionsJson) {
  if (generatorId === "uuid-v4") {
    var hex = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return { data: hex };
  }
  return { error: "未知生成器: " + generatorId };
}
```

**集成位置**：
- 全局右键菜单 > "Mock 数据" 子菜单 (`src/components/plugins/GlobalContextMenu.tsx`)
- KV 编辑器内联 Mock 按钮 (`src/components/http/ExportPluginDropdown.tsx`)

---

### 5. 导出格式 (exportFormats)

**插件类型**：`export-format`

自定义请求导出/代码生成格式。

```json
{
  "contributes": {
    "exportFormats": [
      { "formatId": "httpie", "name": "HTTPie", "fileExtension": "sh" }
    ]
  }
}
```

**JS 入口**需导出 `exportRequest(requestJson)`：

```javascript
function exportRequest(requestJson) {
  var req = JSON.parse(requestJson);
  return { content: "http " + req.method + " " + req.url, filename: "request.sh", mimeType: "text/plain" };
}
```

**集成位置**：导出下拉按钮 (`src/components/http/ExportPluginDropdown.tsx`)

---

### 6. 侧边栏面板 (sidebarPanels)

**插件类型**：`sidebar-panel`

在左侧或右侧边栏添加自定义面板。

```json
{
  "contributes": {
    "sidebarPanels": [
      { "panelId": "request-stats", "name": "请求统计", "icon": "bar-chart-2" }
    ]
  }
}
```

**集成位置**：左侧边栏导航 (`src/components/layout/Sidebar.tsx`)

---

### 7. 加密算法 (cryptoAlgorithms)

**插件类型**：`crypto-tool`

提供加密、解密、哈希和编码算法。出现在右键菜单的"加密/编码"和"解密/解码"子菜单中。

```json
{
  "contributes": {
    "cryptoAlgorithms": [
      {
        "algorithmId": "base64",
        "name": "Base64",
        "category": "encode",
        "supportEncrypt": true,
        "supportDecrypt": true,
        "params": []
      },
      {
        "algorithmId": "aes-cbc",
        "name": "AES-CBC",
        "category": "symmetric",
        "supportEncrypt": true,
        "supportDecrypt": true,
        "params": [
          { "paramId": "key", "name": "密钥", "paramType": "text", "required": true, "placeholder": "16/24/32 字节十六进制密钥" },
          { "paramId": "iv", "name": "IV", "paramType": "text", "required": true, "placeholder": "16 字节十六进制 IV" },
          { "paramId": "padding", "name": "填充", "paramType": "select", "required": false, "defaultValue": "pkcs7",
            "options": [{ "label": "PKCS7", "value": "pkcs7" }, { "label": "Zero", "value": "zero" }] }
        ]
      }
    ]
  }
}
```

**JS 入口**需导出 `encrypt(algorithmId, input, params)` 和 `decrypt(algorithmId, input, params)`：

```javascript
function encrypt(algorithmId, input, params) {
  if (algorithmId === "base64") return { success: true, output: btoa(input) };
  return { success: false, error: "未知算法" };
}

function decrypt(algorithmId, input, params) {
  if (algorithmId === "base64") return { success: true, output: atob(input) };
  return { success: false, error: "未知算法" };
}
```

| 算法分类 | 说明 |
|---|---|
| `encode` | 编码类（Base64、URL 编码等） |
| `hash` | 哈希类（MD5、SHA 等） |
| `symmetric` | 对称加密（AES、DES 等） |
| `asymmetric` | 非对称加密（RSA 等） |

| 参数类型 | 说明 |
|---|---|
| `text` | 文本输入框 |
| `select` | 下拉选择框（需配合 `options`） |
| `number` | 数字输入框 |

**执行流程**：加密模式 → 替换选中文本；解密模式 → 在弹窗中显示结果。若算法有 `params`，执行前会弹出参数输入对话框。

**集成位置**：全局右键菜单 > "加密/编码" 和 "解密/解码" 子菜单

---

### 8. 图标包 (icons)

**插件类型**：`icon-pack`

提供自定义图标库，通过命名空间隔离。

```json
{
  "iconNamespace": "brand-icons",
  "contributes": {
    "icons": [
      { "name": "wechat-pay", "svg": "<svg viewBox='0 0 24 24'>...</svg>" },
      { "name": "alipay", "svg": "<svg viewBox='0 0 24 24'>...</svg>" }
    ]
  }
}
```

**使用方式**：通过 `brand-icons:wechat-pay` 格式引用。

**集成位置**：图标注册表 (`src/stores/iconRegistry.ts`)

---

### 9. 右键菜单项 (contextMenuItems)

**插件类型**：任意（所有插件类型均可使用）

向右键上下文菜单中注入自定义操作项。这是最灵活的扩展点，允许任何插件在不同 UI 区域添加自定义菜单项。

```json
{
  "contributes": {
    "contextMenuItems": [
      {
        "menuItemId": "decode-jwt",
        "label": "解码 JWT",
        "icon": "key",
        "contexts": ["editor", "input", "response"],
        "requiresSelection": true,
        "action": "decode-jwt"
      },
      {
        "menuItemId": "timestamp-convert",
        "label": "时间戳转换",
        "contexts": ["editor", "input", "global"],
        "requiresSelection": true,
        "action": "timestamp-convert"
      }
    ]
  }
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `menuItemId` | string | 是 | 插件内唯一的菜单项 ID |
| `label` | string | 是 | 菜单中显示的文本 |
| `icon` | string | 否 | Lucide 图标名（可选） |
| `contexts` | string[] | 是 | 在哪些上下文中显示（见下表） |
| `requiresSelection` | boolean | 否 | 为 true 时仅在有选中文本时显示（默认 false） |
| `action` | string | 是 | 传给 `onContextMenuAction` 的动作标识 |

#### 上下文类型

| 上下文 | 说明 | 对应 UI 位置 |
|---|---|---|
| `editor` | Monaco 代码编辑器 | 请求体、脚本、GraphQL 编辑器 |
| `input` | HTML input/textarea 输入框 | URL 栏、Header 值、各种输入框 |
| `response` | 响应体区域 | 响应查看器 |
| `kv-row` | KV 编辑器行 | Headers、Params、Form Data 编辑器 |
| `json-node` | JSON 树查看器节点 | 响应 JSON 树 |
| `history` | 历史记录条目 | 请求历史面板 |
| `global` | 所有区域 | 在任何上下文中都显示 |

#### JS 入口

需导出 `onContextMenuAction(action, selectedText, context)` 函数：

```javascript
function onContextMenuAction(action, selectedText, context) {
  if (action === "decode-jwt") {
    try {
      var parts = selectedText.split(".");
      if (parts.length !== 3) return { error: "无效的 JWT 格式（需要 3 段）" };
      var header = JSON.parse(atob(parts[0]));
      var payload = JSON.parse(atob(parts[1]));
      return { output: JSON.stringify({ header: header, payload: payload }, null, 2) };
    } catch (e) {
      return { error: "JWT 解码失败: " + e.message };
    }
  }

  if (action === "timestamp-convert") {
    var ts = parseInt(selectedText, 10);
    if (isNaN(ts)) return { error: "不是有效数字" };
    if (ts < 1e12) ts *= 1000;  // 自动检测秒 vs 毫秒
    return { output: new Date(ts).toISOString() };
  }

  return { error: "未知动作: " + action };
}
```

#### 返回值（`ContextMenuActionResult`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `output` | string? | 结果文本。若 `replaceSelection` 为 false 则显示在弹窗中 |
| `replaceSelection` | boolean? | 为 true 时用 `output` 替换选中文本 |
| `error` | string? | 错误信息（在结果弹窗中显示） |

#### 集成位置

| 区域 | 源文件 | 匹配的 context |
|---|---|---|
| 全局右键菜单 | `src/components/plugins/GlobalContextMenu.tsx` | `editor`, `input`, `response`, `global` |
| KV 编辑器 | `src/components/http/KVEditor.tsx` | `kv-row` |
| JSON 树查看器 | `src/components/common/JsonTreeViewer.tsx` | `json-node` |
| 历史记录面板 | `src/components/history/HistoryPanel.tsx` | `history` |

---

### 10. 字体 (fonts)

**插件类型**：任意（通常与 icon-pack 一起或独立使用）

在插件中嵌入自定义字体。

```json
{
  "contributes": {
    "fonts": [
      {
        "fontId": "jetbrains-mono",
        "name": "JetBrains Mono",
        "family": "'JetBrains Mono', monospace",
        "category": "monospace",
        "files": [
          { "path": "fonts/JetBrainsMono-Regular.woff2", "weight": "400", "style": "normal", "format": "woff2" },
          { "path": "fonts/JetBrainsMono-Bold.woff2", "weight": "700", "style": "normal", "format": "woff2" }
        ]
      }
    ]
  }
}
```

---

## 运行时模型

### 执行流程

1. **发现**：应用启动时，`PluginManager` 扫描 `{app_data}/plugins/` 目录中的已安装插件
2. **注册**：解析每个插件的 manifest 并注册到运行时注册表
3. **懒加载**：插件代码仅在功能被请求时才加载执行
4. **沙箱 JS**：JavaScript 插件在 Boa 引擎中运行 —— 无 DOM、无网络、无文件系统访问
5. **JSON 序列化**：Rust 与 JS 之间的所有通信通过 JSON 序列化

### 远程仓库

- **GitHub**：`https://raw.githubusercontent.com/chenqi92/protoforge-plugins/main/registry.json`
- **Cloudflare R2 CDN**（中国大陆加速）：通过 IP 地理位置自动检测切换
- 缓存有效期：5 分钟
- 插件包格式为 `.tar.gz` 压缩包

### 插件目录结构

```
plugins/
  my-plugin/
    manifest.json     ← 插件元数据 + 扩展点声明
    index.js          ← 主入口脚本
    icon.png          ← 插件图标（可选）
    fonts/            ← 字体文件（可选）
```

---

## 插件开发指南

### 第一步：创建 manifest.json

```json
{
  "id": "my-awesome-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一个示例插件",
  "author": "开发者",
  "pluginType": "data-generator",
  "icon": "icon.png",
  "entrypoint": "index.js",
  "protocolIds": [],
  "tags": ["utility"],
  "contributes": {
    "generators": [
      { "generatorId": "lorem-ipsum", "name": "Lorem Ipsum", "description": "生成占位文本" }
    ],
    "contextMenuItems": [
      { "menuItemId": "word-count", "label": "字数统计", "contexts": ["editor", "input"], "requiresSelection": true, "action": "word-count" }
    ]
  }
}
```

### 第二步：实现入口脚本

```javascript
// index.js

// data-generator 扩展点调用
function generate(generatorId, optionsJson) {
  if (generatorId === "lorem-ipsum") {
    return { data: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." };
  }
  return { error: "未知生成器" };
}

// contextMenuItems 扩展点调用
function onContextMenuAction(action, selectedText, context) {
  if (action === "word-count") {
    var words = selectedText.trim().split(/\s+/).length;
    return { output: "字数统计: " + words };
  }
  return { error: "未知动作" };
}
```

### 第三步：打包与分发

```bash
# 创建 tar.gz 压缩包
tar -czf my-awesome-plugin.tar.gz -C my-awesome-plugin/ .

# 压缩包应包含：
# manifest.json
# index.js
# icon.png（可选）
```

### 重要限制

| 限制 | 说明 |
|---|---|
| 不支持 ES Modules | Boa 引擎不支持 `import`/`export`，使用普通函数声明 |
| 不支持 async/await | Boa 不支持 Promise，所有操作必须同步 |
| 无 Web API | 无 `fetch`、`XMLHttpRequest`、`setTimeout`、`console.log` 等 |
| JSON 交互 | 复杂数据通过 JSON 字符串传递，使用 `JSON.parse()` 和 `JSON.stringify()` |
| 错误处理 | 始终返回结构化的错误对象，避免直接抛异常 |

---

## 完整示例

### 示例 1：JWT 解码器插件（右键菜单项）

**manifest.json**：
```json
{
  "id": "jwt-decoder",
  "name": "JWT 解码器",
  "version": "1.0.0",
  "description": "在右键菜单中快速解码 JWT Token",
  "author": "ProtoForge",
  "pluginType": "crypto-tool",
  "icon": "icon.png",
  "entrypoint": "index.js",
  "protocolIds": [],
  "tags": ["jwt", "auth"],
  "contributes": {
    "cryptoAlgorithms": [],
    "contextMenuItems": [
      { "menuItemId": "decode-jwt", "label": "解码 JWT", "contexts": ["editor", "input", "response", "global"], "requiresSelection": true, "action": "decode-jwt" },
      { "menuItemId": "check-expiry", "label": "检查 JWT 过期时间", "contexts": ["editor", "input"], "requiresSelection": true, "action": "check-expiry" }
    ]
  }
}
```

**index.js**：
```javascript
function onContextMenuAction(action, selectedText, context) {
  var token = selectedText.trim();

  if (action === "decode-jwt") {
    var parts = token.split(".");
    if (parts.length !== 3) return { error: "无效 JWT：需要 3 段以点分隔" };
    try {
      var header = JSON.parse(atob(parts[0]));
      var payload = JSON.parse(atob(parts[1]));
      return { output: JSON.stringify({ header: header, payload: payload }, null, 2) };
    } catch (e) {
      return { error: "解码失败: " + e.message };
    }
  }

  if (action === "check-expiry") {
    try {
      var payload = JSON.parse(atob(token.split(".")[1]));
      if (!payload.exp) return { output: "Payload 中未找到 'exp' 字段" };
      var expDate = new Date(payload.exp * 1000);
      var now = new Date();
      return { output: "过期时间: " + expDate.toISOString() + "\n状态: " + (now > expDate ? "已过期" : "有效") };
    } catch (e) {
      return { error: "JWT 解析失败: " + e.message };
    }
  }

  return { error: "未知动作: " + action };
}
```

### 示例 2：Base64 编解码插件（加密算法）

**manifest.json**：
```json
{
  "id": "base64-codec",
  "name": "Base64 编解码",
  "version": "1.0.0",
  "description": "Base64 标准编解码与 URL 安全变体",
  "author": "ProtoForge",
  "pluginType": "crypto-tool",
  "icon": "icon.png",
  "entrypoint": "index.js",
  "protocolIds": [],
  "tags": ["base64", "encoding"],
  "contributes": {
    "cryptoAlgorithms": [
      { "algorithmId": "base64-standard", "name": "Base64", "category": "encode", "supportEncrypt": true, "supportDecrypt": true },
      { "algorithmId": "base64-url", "name": "Base64 URL 安全", "category": "encode", "supportEncrypt": true, "supportDecrypt": true }
    ]
  }
}
```

**index.js**：
```javascript
function encrypt(algorithmId, input, params) {
  if (algorithmId === "base64-standard") return { success: true, output: btoa(input) };
  if (algorithmId === "base64-url") {
    var urlSafe = btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { success: true, output: urlSafe };
  }
  return { success: false, error: "未知算法" };
}

function decrypt(algorithmId, input, params) {
  if (algorithmId === "base64-standard") {
    try { return { success: true, output: atob(input) }; }
    catch (e) { return { success: false, error: "无效 Base64: " + e.message }; }
  }
  if (algorithmId === "base64-url") {
    try {
      var std = input.replace(/-/g, '+').replace(/_/g, '/');
      while (std.length % 4) std += '=';
      return { success: true, output: atob(std) };
    } catch (e) { return { success: false, error: "无效 Base64URL: " + e.message }; }
  }
  return { success: false, error: "未知算法" };
}
```

### 示例 3：Mock 数据生成器插件

**manifest.json**：
```json
{
  "id": "mock-data-essentials",
  "name": "常用 Mock 数据",
  "version": "1.0.0",
  "description": "常见的 Mock 数据生成器集合",
  "author": "ProtoForge",
  "pluginType": "data-generator",
  "icon": "icon.png",
  "entrypoint": "index.js",
  "protocolIds": [],
  "tags": ["mock", "test"],
  "contributes": {
    "generators": [
      { "generatorId": "uuid", "name": "UUID v4", "description": "随机 UUID" },
      { "generatorId": "timestamp", "name": "时间戳", "description": "当前 Unix 时间戳" },
      { "generatorId": "email", "name": "随机邮箱", "description": "假邮箱地址" },
      { "generatorId": "ipv4", "name": "随机 IPv4", "description": "随机 IP 地址" }
    ]
  }
}
```

**index.js**：
```javascript
function generate(generatorId, optionsJson) {
  if (generatorId === "uuid") {
    var hex = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return { data: hex };
  }
  if (generatorId === "timestamp") return { data: String(Math.floor(Date.now() / 1000)) };
  if (generatorId === "email") {
    var names = ["alice", "bob", "charlie", "david", "emma"];
    var domains = ["example.com", "test.org", "demo.io"];
    return { data: names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 999) + "@" + domains[Math.floor(Math.random() * domains.length)] };
  }
  if (generatorId === "ipv4") {
    var p = []; for (var i = 0; i < 4; i++) p.push(Math.floor(Math.random() * 256));
    return { data: p.join(".") };
  }
  return { error: "未知生成器: " + generatorId };
}
```

---

## API 参考

### 前端服务 (`src/services/pluginService.ts`)

| 函数 | 说明 | 返回类型 |
|---|---|---|
| `listPlugins()` | 列出已安装插件 | `PluginManifest[]` |
| `listAvailablePlugins()` | 列出仓库中可用插件 | `PluginManifest[]` |
| `installPlugin(pluginId)` | 从仓库安装插件 | `PluginManifest` |
| `uninstallPlugin(pluginId)` | 卸载插件 | `void` |
| `parseData(pluginId, rawData)` | 执行协议解析 | `ParseResult` |
| `runHook(pluginId, requestJson)` | 执行请求钩子 | `HookResult` |
| `runGenerator(pluginId, generatorId, optionsJson)` | 生成 Mock 数据 | `GenerateDataResult` |
| `runExport(pluginId, requestJson)` | 执行导出格式 | `ExportResult` |
| `runCrypto(pluginId, algorithmId, mode, input, paramsJson)` | 加密/解密 | `CryptoResult` |
| `runContextMenuAction(pluginId, action, selectedText, contextJson)` | 执行右键菜单动作 | `ContextMenuActionResult` |
| `listCryptoAlgorithms()` | 列出所有加密算法 | `InstalledCryptoAlgorithm[]` |
| `getProtocolParsers()` | 列出所有协议解析器 | `ProtocolParser[]` |
| `refreshRegistry()` | 强制刷新远程仓库 | `number` |
| `getPluginIcon(pluginId)` | 获取插件图标（data URI） | `string \| null` |

### 插件状态管理 (`src/stores/pluginStore.ts`)

| 属性/方法 | 说明 |
|---|---|
| `installedPlugins` | 已安装插件清单缓存数组 |
| `availablePlugins` | 可用插件缓存数组 |
| `getInstalledByType(type)` | 按类型过滤已安装插件 |
| `fetchInstalledPlugins()` | 刷新已安装插件列表 |
| `installPlugin(pluginId)` | 安装并刷新列表 |
| `uninstallPlugin(pluginId)` | 卸载并刷新列表 |

### TypeScript 类型定义 (`src/types/plugin.ts`)

核心类型：

| 类型 | 说明 |
|---|---|
| `PluginManifest` | 完整的插件清单 |
| `PluginContributes` | 所有扩展点声明 |
| `ContextMenuContribution` | 右键菜单项声明 |
| `ContextMenuActionResult` | 右键菜单动作返回值 |
| `CryptoAlgorithm` / `CryptoResult` | 加密操作 |
| `GeneratorContribution` / `GenerateDataResult` | 数据生成 |
| `ExportFormatContribution` / `ExportResult` | 导出格式 |
| `ParseResult` / `ParsedField` | 协议解析 |
| `RendererContribution` | 响应渲染 |
| `HookResult` | 请求钩子结果 |

### Rust 后端 (`src-tauri/src/plugin_runtime.rs`)

所有类型使用 `#[serde(rename_all = "camelCase")]`，Rust snake_case 与 TypeScript camelCase 之间自动转换。

注册的 Tauri 命令（位于 `src-tauri/src/lib.rs`）：

| 命令 | 说明 |
|---|---|
| `plugin_list` / `plugin_list_available` | 列出插件 |
| `plugin_install` / `plugin_uninstall` | 安装/卸载 |
| `plugin_parse_data` | 协议解析 |
| `plugin_run_hook` | 请求钩子 |
| `plugin_run_generator` | 数据生成 |
| `plugin_run_export` | 导出格式 |
| `plugin_run_crypto` / `plugin_list_crypto_algorithms` | 加密操作 |
| `plugin_run_context_menu_action` | 右键菜单动作 |
