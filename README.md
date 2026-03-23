# ProtoForge

> 🛠️ 现代化的 API 开发与测试工具，基于 Tauri 2 + React + Rust 构建。

[![GitHub Release](https://img.shields.io/github/v/release/chenqi92/protoforge?style=flat-square&logo=github&label=最新版本)](https://github.com/chenqi92/protoforge/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/chenqi92/protoforge/total?style=flat-square&logo=github&label=下载量)](https://github.com/chenqi92/protoforge/releases)
[![License](https://img.shields.io/github/license/chenqi92/protoforge?style=flat-square&label=许可证)](LICENSE)

## 下载安装

| 平台 | 下载 |
|------|------|
| 🍎 macOS (Apple Silicon) | [.dmg](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_aarch64-apple-darwin.dmg) |
| 🍎 macOS (Intel) | [.dmg](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_x86_64-apple-darwin.dmg) |
| 🪟 Windows (64-bit) | [.msi](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_0.2.0_x64_en-US.msi) · [.exe](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_0.2.0_x64-setup.exe) |
| 🐧 Linux (64-bit) | [.deb](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_0.2.0_amd64.deb) · [.AppImage](https://github.com/chenqi92/protoforge/releases/latest/download/protoforge_0.2.0_amd64.AppImage) |

> 📥 更多版本请查看 [Releases 页面](https://github.com/chenqi92/protoforge/releases)

## 功能特性

### 🌐 HTTP 客户端
- 全方法支持（GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS）
- 请求体：JSON / Form / FormData / Binary / GraphQL
- 认证：Bearer / Basic / API Key / OAuth 2.0
- 前后置 JavaScript 脚本（Boa 引擎）
- 动态变量（`{{$timestamp}}` / `{{$guid}}` / `{{$randomInt}}`）
- 响应：Pretty / Raw / Preview / Headers / Cookies / Timing 分解

### 📡 实时协议
- **WebSocket** — 消息收发、自定义 Headers、自动重连
- **SSE** — Server-Sent Events 事件流（自动检测 + 手动模式）
- **MQTT** — 连接 / 订阅 / 发布 / QoS 支持
- **TCP/UDP** — Client + Server 模式，多编码支持

### 📦 集合管理
- 树形目录（集合 → 文件夹 → 请求）
- Postman v2.1 导入/导出
- Swagger/OpenAPI 导入
- Collection Runner 批量运行

### 🧪 测试工具
- 压力测试（固定并发，实时 TPS / 延迟 / 成功率面板）
- HTTP 抓包代理（HTTP + HTTPS CONNECT 隧道，自动 CA 管理）

### 🧩 插件系统
- **6 种插件类型**：协议解析、请求钩子、响应渲染、数据生成、导出格式、侧边面板
- 远程插件仓库（一键安装/卸载）
- JavaScript 沙箱执行（Boa 引擎）
- WASM 插件支持
- 已有插件：
  - 🔬 HJ212 协议解析（环保数据传输协议）
  - 📊 Excel 表格渲染
  - 🔤 JetBrains Mono 字体
  - 🔐 请求时间戳签名（自动注入 X-Timestamp / X-Signature）
  - 🎲 Mock 数据生成器（UUID / 随机字符串 / Email / IP 等）
  - 📋 cURL 命令导出
  - 📈 请求统计面板（侧边栏实时统计）

### ⚡ 交互体验
- Ctrl+K 全局命令面板
- 主题：浅色 / 深色 / 跟随系统
- 窗口状态记忆
- 拖拽分割面板
- 多 Tab 工作区 + 快捷键
- 自动更新（Tauri Updater）

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri 2.0 |
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Rust + Tokio |
| 存储 | SQLite (sqlx) |
| HTTP | reqwest |
| WebSocket | tokio-tungstenite |
| MQTT | rumqttc |
| 脚本 | Boa Engine (JS) |
| UI | Vanilla CSS + TailwindCSS + lucide-react |

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建
npm run tauri build
```

## 许可证

MIT License © chenqi
