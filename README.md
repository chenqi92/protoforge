<p align="center">
  <img src="public/logo.svg" width="100" alt="ProtoForge Logo" />
</p>

<h1 align="center">ProtoForge</h1>

<p align="center">
  <b>轻量、离线、无云端的 API 开发与测试桌面工具</b><br/>
  基于 Tauri 2 + React 19 + Rust 构建，覆盖 HTTP · WebSocket · SSE · MQTT · TCP/UDP · 抓包 · 压测 · 插件扩展
</p>

<p align="center">
  <a href="https://github.com/chenqi92/protoforge/releases/latest"><img src="https://img.shields.io/github/v/release/chenqi92/protoforge?style=flat-square&logo=github&label=Latest" alt="Latest Release" /></a>
  <a href="https://github.com/chenqi92/protoforge/releases"><img src="https://img.shields.io/github/downloads/chenqi92/protoforge/total?style=flat-square&logo=github&label=Downloads" alt="Downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/chenqi92/protoforge?style=flat-square" alt="License" /></a>
  <a href="https://github.com/chenqi92/protoforge-plugins"><img src="https://img.shields.io/badge/Plugins-8-blueviolet?style=flat-square&logo=puzzle-piece" alt="Plugins" /></a>
</p>

---

## 📥 下载安装

| 平台 | 安装包 | 说明 |
|------|--------|------|
| 🪟 Windows (64-bit) | [**EXE 安装包**](https://github.com/chenqi92/protoforge/releases/latest) | ✅ 推荐 — 双击执行，自动安装 |
| 🪟 Windows (64-bit) | [MSI 安装包](https://github.com/chenqi92/protoforge/releases/latest) | 适合企业组策略静默部署 |
| 🍎 macOS (Apple Silicon) | [DMG 安装包](https://github.com/chenqi92/protoforge/releases/latest) | M1/M2/M3/M4 芯片 Mac |
| 🍎 macOS (Intel) | [DMG 安装包](https://github.com/chenqi92/protoforge/releases/latest) | Intel 芯片 Mac |
| 🐧 Linux (64-bit) | [DEB](https://github.com/chenqi92/protoforge/releases/latest) · [AppImage](https://github.com/chenqi92/protoforge/releases/latest) | Debian/Ubuntu 用 DEB，其他发行版用 AppImage |

> 💡 **Windows 用户推荐下载 EXE 安装包**，双击即可完成安装。MSI 包适用于 IT 管理员通过组策略批量部署的场景。

> 🍎 **macOS 用户注意**：应用未经 Apple 签名，首次打开会被 Gatekeeper 拦截。安装 DMG 后，请在终端执行：
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/ProtoForge.app
> ```
> 然后即可正常打开。

📦 历史版本及更新日志请查看 [Releases 页面](https://github.com/chenqi92/protoforge/releases)

---

## ✨ 功能特性

### 🌐 HTTP 客户端
- 全方法支持 — GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS
- 请求体 — JSON / Form / FormData / Binary / GraphQL
- 认证 — Bearer / Basic / API Key / OAuth 2.0
- 前/后置 JavaScript 脚本（Boa 引擎沙箱执行）
- 动态变量 — `{{$timestamp}}` / `{{$guid}}` / `{{$randomInt}}`
- 响应视图 — Pretty / Raw / Preview / Headers / Cookies / Timing 分解

### 📡 实时协议
| 协议 | 能力 |
|------|------|
| **WebSocket** | 消息收发、自定义 Headers、自动重连 |
| **SSE** | Server-Sent Events 事件流（自动检测 + 手动模式） |
| **MQTT** | 连接 / 订阅 / 发布 / QoS 0-2 |
| **TCP/UDP** | Client + Server 双模式，多编码支持 |

### 📦 集合管理
- 树形目录（集合 → 文件夹 → 请求）
- Postman v2.1 集合导入/导出
- Swagger / OpenAPI 文档一键导入
- Collection Runner 批量运行

### 🧪 测试工具
- **压力测试** — 固定并发模式，实时 TPS / 延迟 / 成功率仪表盘
- **HTTP 抓包代理** — HTTP + HTTPS CONNECT 隧道，自动 CA 证书管理

### ⚡ 交互体验
- `Ctrl+K` 全局命令面板
- 主题：浅色 / 深色 / 跟随系统
- 多 Tab 工作区 + 快捷键
- 窗口状态记忆 & 拖拽分割面板
- 应用内自动更新（Tauri Updater）
- 中英双语支持（i18n）

---

## 🧩 插件系统

ProtoForge 提供灵活的插件扩展能力，支持通过内置插件市场一键安装/卸载。

🔗 **插件仓库**：[chenqi92/protoforge-plugins](https://github.com/chenqi92/protoforge-plugins)

### 已上架插件

| 插件 | 类型 | 说明 |
|------|------|------|
| 🔬 HJ212 协议解析 | `protocol-parser` | 完整支持 HJ212-2005/2017 环保数据传输协议，含 CRC16 校验、报文解析与生成 |
| 📊 Excel 表格渲染 | `response-renderer` | 将 Excel 文件流响应渲染为可视化表格，支持 .xlsx/.xls，多 Sheet 切换 |
| 🔤 JetBrains Mono 字体 | `font` | JetBrains 出品的等宽编程字体，安装后可在设置中选用 |
| 📋 cURL 命令导出 | `export-format` | 将 HTTP 请求配置导出为 cURL 命令行格式，一键复制 |
| 🎲 Mock 数据生成器 | `data-generator` | 快速生成 UUID / 随机字符串 / Email / IPv4 / 时间戳等测试数据 |
| 📈 请求统计面板 | `sidebar-panel` | 侧边栏实时统计 — 请求总数、成功率、平均响应时间、状态码分布 |
| 🔐 请求时间戳签名 | `request-hook` | 自动注入 X-Timestamp / X-Signature Headers |
| 🔐 加密解密工具箱 | `crypto-tool` | Base64 / URL Encode / Hex / MD5 / SHA / AES-CBC / AES-ECB |

> 💡 在应用中打开 **设置 → 插件** 即可浏览并一键安装以上所有插件。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri 2.0 |
| 前端 | React 19 + TypeScript + Vite 7 |
| 后端 | Rust + Tokio |
| 存储 | SQLite (sqlx) |
| HTTP | reqwest |
| WebSocket | tokio-tungstenite |
| MQTT | rumqttc |
| 脚本引擎 | Boa Engine (JavaScript) |
| UI | TailwindCSS 4 + Framer Motion + lucide-react |
| 国际化 | i18next + react-i18next |

---

## 🚀 开发

```bash
# 安装依赖
npm install

# 开发模式（启动 Tauri 桌面应用 + Vite HMR）
npm run dev:tauri

# 构建生产包
npm run build:tauri
```

---

## 📄 许可证

[MIT License](LICENSE) © chenqi
