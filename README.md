<p align="center">
  <img src="public/logo.svg" width="100" alt="ProtoForge Logo" />
</p>

<h1 align="center">ProtoForge</h1>

<p align="center">
  <b>轻量、离线、无云端的全功能网络协议工作站</b><br/>
  基于 Tauri 2 + React 19 + Rust 构建<br/>
  覆盖 HTTP · WebSocket · SSE · MQTT · TCP/UDP · Mock Server · 工作流编排 · 数据库客户端 · 视频流 · 抓包 · 压测 · 插件扩展
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

- **全方法支持** — GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS
- **请求体** — JSON / Form / FormData / Binary / GraphQL
- **认证** — Bearer / Basic / API Key / OAuth 2.0（Authorization Code / Client Credentials）
- **前/后置 JavaScript 脚本**（Boa 引擎沙箱执行）— 签名计算、Token 提取、断言、链式依赖
- **环境变量** — 全局 / 分组环境，优先级覆盖，快速切换
- **动态变量** — `{{$timestamp}}` / `{{$guid}}` / `{{$randomInt}}`
- **响应视图** — Pretty / Raw / Preview / Headers / Cookies / Timing 分解（DNS / TLS / TTFB）

### 📡 实时协议

| 协议 | 能力 |
|------|------|
| **WebSocket** | 消息收发、自定义 Headers、自动重连、心跳检测 |
| **SSE** | Server-Sent Events 事件流（自动检测 + 手动模式） |
| **MQTT** | 连接 / 订阅 / 发布 / QoS 0-2 |
| **TCP/UDP** | Client + Server 双模式，多编码支持（UTF-8 / GBK / HEX / Base64），插件协议解析集成 |

### 📦 集合管理

- 树形目录（集合 → 文件夹 → 请求），拖拽排序
- **Postman v2.1** 集合导入/导出
- **Swagger / OpenAPI** 文档一键导入
- 集合级前/后置脚本 & Auth 继承
- **Collection Runner** 批量运行
- 历史记录 — 自动记录每次请求，按时间分组，搜索 + 一键恢复

### 🎭 Mock Server

基于 **hyper** 的本地 HTTP Mock 服务器，无需外部依赖：

- **通配符路由** — 支持 `:param` / `*` / `**` 模式匹配，优先级 + 特异性排序
- **动态模板引擎** — `{{request.params.id}}` / `{{$randomUUID}}` / `{{$faker.name}}`
- **条件响应** — 按 Header / Body 内容 / JSONPath / 正则表达式匹配不同响应
- **响应序列** — 每次请求依次返回不同响应，支持循环
- **JS 脚本动态响应** — 用 JavaScript 编写完全自定义的响应逻辑
- **延迟模拟** — 可配置每个路由的响应延迟
- **代理转发** — 未匹配路由自动转发到目标服务器
- **请求日志** — 实时推送命中记录，方便调试
- 自动 CORS 处理，多会话管理，配置持久化

### 🔄 工作流编排引擎

可视化流程编排，将多种原子能力组装成自动化管道：

- **DAG 执行** — 拓扑排序保证依赖顺序，支持取消
- **节点类型** — HTTP 请求 / TCP 发送 / UDP 发送 / 延时 / JavaScript 脚本 / 数据提取 / Base64 编解码
- **变量传递** — `{{node_id.field}}` 模板语法，节点间数据自动流转
- **实时进度** — Tauri Event 推送，前端可视化观测每个节点执行状态
- 执行记录持久化 & 流程 CRUD

### 🗄️ 数据库客户端

内置多数据库连接与查询工具：

| 数据库 | 能力 |
|--------|------|
| **MySQL** | 连接管理 / SQL 查询 / 结果集展示 |
| **PostgreSQL** | 连接管理 / SQL 查询 / 结果集展示 |
| **SQLite** | 本地文件数据库直接打开 |
| **InfluxDB** | 时序数据查询 |

- 查询结果导出 — CSV / JSON / SQL INSERT
- 连接加密存储

### 📹 视频流工具

全协议视频流调试与播放：

| 协议 | 说明 |
|------|------|
| **RTSP** | 实时流传输协议 |
| **RTMP** | 直播推/拉流 |
| **HLS** | HTTP 直播流 (m3u8) |
| **HTTP-FLV** | HTTP-FLV 直播流 |
| **WebRTC** | 浏览器实时通信 |
| **SRT** | 安全可靠传输协议 |
| **GB28181** | 国标视频监控协议 |
| **ONVIF** | 网络摄像头设备发现 & 控制（PTZ / 预置位 / 流获取） |

- 内置 FFmpeg 管理 & EasyPlayer WASM 播放器
- 流媒体网关集中管理

### 🧪 测试工具

- **压力测试** — 固定并发模式，实时 TPS / 延迟分布（P50/P95/P99）/ 成功率仪表盘，可导出报告
- **HTTP 抓包代理** — HTTP + HTTPS CONNECT 隧道，自动 CA 证书管理，域名/方法/状态码过滤，JSON 自动格式化

### 🛠️ 实用工具箱

- **截图缩放** — 批量将图片缩放到多种尺寸
- **图标生成** — 一键生成 iOS / macOS / Windows ICO / Favicon 全套图标
- **批量重命名** — 安全的两阶段重命名，冲突检测

### ⚡ 交互体验

- `Ctrl+K` 全局命令面板
- 主题：浅色 / 深色 / 跟随系统
- 多 Tab 工作区 + 快捷键（`Ctrl+Enter` 发送、`Ctrl+S` 保存、`Ctrl+N` 新建）
- 窗口状态记忆 & 拖拽分割面板
- 应用内自动更新（Tauri Updater）
- 中英双语支持（i18n）

---

## 🧩 插件系统

ProtoForge 提供灵活的插件扩展能力，支持通过内置插件市场一键安装/卸载。

🔗 **插件仓库**：[chenqi92/protoforge-plugins](https://github.com/chenqi92/protoforge-plugins)

### 插件架构

- **双运行时** — WASM（Wasmtime 沙箱）+ JavaScript（Boa 引擎）
- **`.pfpkg` 插件包** — ZIP 格式 = `manifest.json` + 插件代码 + 图标 + README
- **安全机制** — WASM 沙箱隔离、权限声明、资源限额（内存 ≤ 50MB，CPU 超时 5s）、SHA256 校验
- **自动更新** — 基于 GitHub Registry，semver 版本对比

### 插件类型

| 类型标识 | 说明 | 示例 |
|----------|------|------|
| `protocol-parser` | TCP/UDP 数据协议解析 | HJ212 环保协议解析 |
| `response-renderer` | HTTP 响应自定义渲染 | Excel 表格可视化 |
| `export-format` | 请求配置导出格式 | cURL 命令导出 |
| `data-generator` | 测试数据生成 | UUID / Email / IPv4 |
| `sidebar-panel` | 侧边栏面板扩展 | 请求统计面板 |
| `request-hook` | 请求前/后钩子 | 时间戳签名注入 |
| `crypto-tool` | 加密解密工具 | Base64 / AES / MD5 / SHA |
| `font` | 自定义字体 | JetBrains Mono |

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

## 🏗️ 项目架构

```
protoforge/
├── src/                          # 前端 (React 19 + TypeScript)
│   ├── components/               # UI 组件
│   │   ├── http/                 # HTTP 客户端
│   │   ├── ws/                   # WebSocket
│   │   ├── sse/                  # SSE
│   │   ├── mqtt/                 # MQTT
│   │   ├── tcp/                  # TCP/UDP
│   │   ├── mockserver/           # Mock Server
│   │   ├── loadtest/             # 压力测试
│   │   ├── capture/              # HTTP 抓包
│   │   ├── dbclient/             # 数据库客户端
│   │   ├── videostream/          # 视频流
│   │   ├── toolbox/              # 工具箱
│   │   ├── collections/          # 集合管理
│   │   ├── plugins/              # 插件管理
│   │   └── settings/             # 设置
│   ├── stores/                   # Zustand 状态管理
│   ├── services/                 # 服务层
│   ├── locales/                  # i18n 语言包
│   └── hooks/                    # 自定义 Hooks
├── src-tauri/                    # 后端 (Rust + Tokio)
│   └── src/
│       ├── http_client.rs        # HTTP 请求引擎
│       ├── ws_client.rs          # WebSocket 客户端
│       ├── sse_client.rs         # SSE 客户端
│       ├── mqtt_client.rs        # MQTT 客户端
│       ├── tcp_client.rs         # TCP/UDP 客户端 & 服务端
│       ├── mock_server.rs        # Mock Server (hyper)
│       ├── workflow_engine.rs    # 工作流编排引擎
│       ├── load_test.rs          # 压测引擎
│       ├── proxy_capture.rs      # HTTP 抓包代理
│       ├── script_engine.rs      # Boa JS 脚本引擎
│       ├── plugin_runtime.rs     # 插件运行时
│       ├── wasm_runtime.rs       # WASM 沙箱 (Wasmtime)
│       ├── db_client/            # 数据库驱动 (MySQL/PG/SQLite/InfluxDB)
│       ├── video_streaming/      # 视频流 (RTSP/RTMP/HLS/WebRTC/SRT/GB28181/ONVIF)
│       ├── toolbox.rs            # 工具箱 (图片/图标/重命名)
│       ├── collections.rs        # 集合管理
│       ├── postman_compat.rs     # Postman 集合兼容
│       ├── swagger_import.rs     # Swagger/OpenAPI 导入
│       └── database.rs           # SQLite 持久层
└── .github/workflows/            # CI/CD (GitHub Actions)
```

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri 2.0 |
| 前端 | React 19 + TypeScript + Vite 7 |
| 后端 | Rust + Tokio |
| 存储 | SQLite (sqlx) |
| HTTP | reqwest |
| Mock Server | hyper |
| WebSocket | tokio-tungstenite |
| MQTT | rumqttc |
| 脚本引擎 | Boa Engine (JavaScript) |
| WASM 引擎 | Wasmtime |
| UI | TailwindCSS 4 + shadcn/ui + Framer Motion + Lucide React |
| 状态管理 | Zustand |
| 代码编辑器 | Monaco Editor |
| 国际化 | i18next + react-i18next |

---

## 🚀 开发

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) — `cargo install tauri-cli`

### 快速开始

```bash
# 克隆项目
git clone https://github.com/chenqi92/protoforge.git
cd protoforge

# 安装前端依赖
npm install

# 开发模式（启动 Tauri 桌面应用 + Vite HMR）
npm run dev:tauri

# 构建生产包
npm run build:tauri
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动前端 Vite 开发服务器 |
| `npm run dev:tauri` | 启动完整 Tauri 桌面应用（推荐） |
| `npm run build:tauri` | 构建生产发行包 |
| `npm run build:debug` | 构建 Debug 包（含 DevTools） |
| `npm run release:patch` | 版本号 patch +1 并推送触发 CI |
| `npm run release:minor` | 版本号 minor +1 并推送触发 CI |
| `npm run lint` | TypeScript 类型检查 |
| `npm run icons:generate` | 重新生成应用图标 |

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 — `git checkout -b feat/amazing-feature`
3. 提交修改 — `git commit -m 'feat: add amazing feature'`
4. 推送到分支 — `git push origin feat/amazing-feature`
5. 发起 Pull Request

---

## 📄 许可证

[MIT License](LICENSE) © chenqi
