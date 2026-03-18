# ProtoForge — 全功能网络协议工作站

> 替代 Postman 的跨平台桌面应用，集 HTTP 客户端、WebSocket、TCP/UDP 调试、压测、抓包、插件扩展于一体。

---

## 项目命名

| 用途 | 名称 | GitHub 仓库 | 说明 |
|------|------|------------|------|
| **主程序** | ProtoForge | `chenqi92/protoforge` | 桌面应用代码，Tauri + React |
| **插件仓库** | ProtoForge Plugins | `chenqi92/protoforge-plugins` | 插件分发索引 + 插件包 |

---

## 技术栈

### 为什么换栈

老项目问题：UI 粗糙、组件库不统一、样式临时拼凑。新项目从设计体系出发。

### 推荐栈

| 层 | 技术 | 理由 |
|----|------|------|
| **桌面框架** | Tauri 2.0 | 跨平台（macOS/Windows/Linux）、体积小、性能好 |
| **后端语言** | Rust | Tauri 原生、并发安全、适合网络/协议处理 |
| **前端框架** | React 19 + TypeScript | 生态最丰富 |
| **构建工具** | Vite 6 | 极速 HMR |
| **UI 组件库** | shadcn/ui | 高质量、可定制、基于 Radix |
| **CSS** | TailwindCSS 4 | 与 shadcn/ui 深度配合 |
| **动画** | Framer Motion | 流畅微交互 |
| **状态管理** | Zustand | 轻量、无样板代码 |
| **图标** | Lucide React | 统一风格、体积小 |
| **图表** | Recharts / ECharts | 压测/性能可视化 |
| **代码编辑** | CodeMirror 6 | 请求体/响应编辑器 |
| **数据库** | SQLite (via sqlx) | 本地持久化 |
| **WASM 引擎** | Wasmtime | 插件沙箱运行时 |
| **字体** | Inter / JetBrains Mono | 界面 + 等宽代码 |

---

## 设计风格

### 视觉方向

- **深色优先** + 浅色可切换
- **毛玻璃 + 微阴影**，类 Arc/Raycast 风格
- **圆角 12px**，间距舒适
- **渐变强调色**（紫蓝渐变 → 主操作）
- **微动效**：按钮 hover scale、面板展开弹簧、状态切换过渡
- 无多余装饰，信息密度适中

### 布局结构

```
┌─────────────────────────────────────────────┐
│  Title Bar (可拖拽，macOS 红绿灯 / Win 控件) │
├──────┬──────────────────────────────────────┤
│      │  Tab Bar (Request1 / Request2 / ... )│
│ Side ├──────────────────────────────────────┤
│ Bar  │  Main Workspace                      │
│      │  ┌─────────────┬────────────────────┐│
│ (导  │  │ Request     │ Response           ││
│  航  │  │ Config      │ Body / Headers     ││
│  树) │  │             │ Preview            ││
│      │  └─────────────┴────────────────────┘│
├──────┴──────────────────────────────────────┤
│  Status Bar (连接状态 / 耗时 / 大小)          │
└─────────────────────────────────────────────┘
```

---

## 功能模块需求

### 1. HTTP 客户端（核心）

#### 1.1 请求构建

- 方法：GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS
- URL 栏：自动补全历史 URL、环境变量替换 `{{baseUrl}}`
- Query Params：Key-Value 表格 ↔ URL 联动编辑
- Headers：Key-Value 表格，常用 Headers 自动补全
- Body 类型：
  - `none`
  - `form-data`（含文件上传）
  - `x-www-form-urlencoded`
  - `raw`（JSON / XML / Text / HTML / JavaScript）
  - `binary`（文件选择）
  - `GraphQL`
- Auth：
  - No Auth
  - Bearer Token
  - Basic Auth
  - API Key（Header / Query）
  - OAuth 2.0（Authorization Code / Client Credentials）

#### 1.2 响应展示

- Body 查看器：Pretty（语法高亮 JSON/XML/HTML）、Raw、Preview（HTML 渲染）
- Headers 表格
- Cookies 表格
- 时间轴（DNS / Connect / TLS / TTFB / Download）
- 状态码彩色标记（2xx 绿 / 3xx 黄 / 4xx 橙 / 5xx 红）
- 响应大小 + 耗时

#### 1.3 前置/后置脚本

- **前置脚本**：在发请求前执行 JavaScript
  - 设置 Headers、修改 Body
  - 操作环境变量 `pm.environment.set("token", "xxx")`
  - 签名计算（MD5 / HMAC-SHA256）
- **后置脚本**：请求完成后执行
  - 自动提取 Token 存入环境变量
  - 断言（状态码、Body 字段、响应时间）
  - 链式请求依赖

#### 1.4 环境变量

- **全局环境**：跨所有分组生效
- **分组环境**：不同分组可以有独立的环境变量（如 dev / staging / prod）
- **变量优先级**：分组环境 > 全局环境
- 变量替换语法：`{{variableName}}`
- 支持动态变量：`{{$timestamp}}`、`{{$randomInt}}`、`{{$guid}}`
- 环境变量快速切换（顶部下拉）

#### 1.5 集合/分组管理

- 树形目录结构：集合 → 文件夹 → 请求
- 拖拽排序
- 集合导入/导出（JSON 格式，兼容 Postman Collection v2.1）
- 集合级前置/后置脚本
- 集合级 Auth 继承
- 集合批量运行（Collection Runner）

#### 1.6 历史记录

- 自动记录每次请求
- 按时间分组（今天 / 昨天 / 7 天内）
- 搜索 + 过滤
- 点击恢复到工作区

---

### 2. WebSocket 客户端

- 连接管理：URL + 协议 + Headers
- 登录认证流程（JWT / Session）
- 消息发送：文本 / JSON / Binary
- 消息列表：时间戳 + 方向（发送/接收）+ 内容预览
- 自动重连 + 心跳检测
- 消息过滤/搜索

---

### 3. TCP / UDP 测试

- **TCP Client**：连接 + 发送/接收 + 十六进制/文本模式
- **TCP Server**：监听端口 + 接收连接列表 + 回复
- **UDP**：发送/接收 + 广播模式
- 数据编码：UTF-8 / GBK / HEX / Base64
- 消息历史列表
- 自定义分隔符（换行 / 固定长度 / 自定义标记）
- **与插件集成**：TCP Server 收到数据后可调用协议解析插件自动展示结构化数据

---

### 4. 压测（Load Testing）

- 配置：目标 URL、方法、Headers、Body
- 模式：
  - 固定并发（concurrent users × duration）
  - 渐进式（从 N 到 M，逐步递增）
  - 阶梯式（每隔 T 秒增加 N 并发）
  - 脉冲式（高低交替）
- 实时面板：
  - TPS 趋势图
  - 延迟分布图（P50 / P95 / P99）
  - 成功率
  - 6 指标卡片（总请求 / 成功 / 失败 / 平均延迟 / 最小 / 最大）
- 最终报告：汇总统计 + 可导出
- 预热期支持

---

### 5. 抓包（HTTP Proxy Capture）

- 本地代理服务器（默认 `127.0.0.1:8899`）
- HTTP 明文：完整录制（方法 / URL / Headers / Body / 状态码 / 响应 / 耗时）
- HTTPS：CONNECT 隧道透传（记录域名和连接状态）
- 请求列表：
  - 方法彩色标签
  - 状态码
  - URL + Host
  - 大小 + 耗时
- 详情面板：Request / Response 分栏，Headers + Body
- 过滤：域名 / 路径 / 方法 / 状态码 / 内容类型
- 暂停/恢复录制
- 清空列表
- JSON 自动格式化

---

### 6. 插件系统

#### 6.1 插件类型

| 类型 | 运行时 | 用途 |
|------|--------|------|
| **协议插件** | WASM (Wasmtime) | TCP/UDP 数据自动解析、编码、验证 |
| **工具插件** | WASM | 数据转换、加密解密、编码工具 |

#### 6.2 插件包格式 `.pfpkg`

```
my-plugin.pfpkg (ZIP)
├── manifest.json      ← 元数据 + 权限声明
├── plugin.wasm        ← 编译后的 WASM 模块
├── icon.png           ← 插件图标
└── README.md          ← 说明文档
```

#### 6.3 manifest.json 规范

```json
{
  "id": "com.example.modbus-parser",
  "name": "Modbus 协议解析器",
  "version": "1.2.0",
  "author": "Author Name",
  "description": "Modbus TCP/RTU 协议完整解析",
  "license": "MIT",
  "minAppVersion": "1.0.0",
  "runtime": "wasm",
  "entry": "plugin.wasm",
  "category": "protocol",
  "tags": ["modbus", "industrial", "iot"],
  "capabilities": {
    "decode": true,
    "encode": true,
    "guess": true
  },
  "permissions": ["network", "file:read"],
  "changelog": {
    "1.2.0": "新增 RTU 模式",
    "1.1.0": "修复 CRC 校验"
  }
}
```

#### 6.4 插件接口（宿主端 Trait）

```rust
trait PluginInterface {
    fn guess(data: &[u8]) -> f64;          // 协议识别置信度
    fn decode(data: &[u8]) -> DecodeResult; // 解码
    fn encode(fields: &FieldMap) -> Vec<u8>; // 编码
}
```

#### 6.5 插件分发

- **插件仓库结构**（`protoforge-plugins`）：

```
protoforge-plugins/
├── registry.json              ← 全局索引
├── plugins/
│   ├── modbus-parser/
│   │   ├── manifest.json
│   │   ├── plugin.wasm
│   │   ├── icon.png
│   │   └── README.md
│   └── hj212-decoder/
│       └── ...
```

- **客户端流程**：启动 → 拉 `registry.json` → 对比本地 `installed.json` → semver 版本对比 → 显示可安装/可更新

#### 6.6 插件安全

- WASM 沙箱隔离（无法访问宿主内存）
- 权限声明（manifest.json 中的 permissions）
- 资源限额（内存 ≤ 50MB，CPU 超时 5s）
- SHA256 完整性校验

---

### 7. 软件自身更新

- 使用 `tauri-plugin-updater`
- 检测 GitHub Releases 新版本
- 弹窗提示 → 后台下载 → 安装重启
- 更新日志展示

---

### 8. 数据持久化

| 数据类型 | 存储方式 |
|---------|---------|
| 集合/请求/环境变量/历史 | SQLite (本地) |
| 已安装插件 | `$APP_DATA/plugins/installed.json` |
| 用户偏好/主题 | JSON 配置文件 |
| 插件文件 | `$APP_DATA/plugins/{id}/` |

---

### 9. 通用交互需求

- **全局搜索**：`Ctrl+K` 快速搜索请求、集合、环境变量
- **多 Tab 工作区**：每个请求独立 Tab，可拖拽排序
- **快捷键**：`Ctrl+Enter` 发送请求、`Ctrl+S` 保存、`Ctrl+N` 新建
- **主题切换**：深色 / 浅色 / 跟随系统
- **多语言**：中文 / English
- **窗口状态记忆**：记住窗口大小、位置、侧边栏宽度
- **拖拽分割面板**：请求/响应面板比例可调

---

## 非功能需求

| 维度 | 要求 |
|------|------|
| **启动速度** | 冷启动 < 1.5s |
| **安装包大小** | < 15MB (Windows) |
| **内存占用** | 空闲 < 80MB |
| **跨平台** | Windows 10+、macOS 12+、Linux (AppImage) |
| **离线可用** | 核心功能无需网络 |
| **数据安全** | 敏感数据本地存储，不上传远程 |

---

## 实施路线（建议）

| 阶段 | 范围 | 预估 |
|------|------|------|
| **Phase 1** | 项目初始化 + 设计系统 + 主布局骨架 | 2 天 |
| **Phase 2** | HTTP 客户端核心（请求构建 + 响应展示 + 环境变量） | 5 天 |
| **Phase 3** | 集合管理 + 前后置脚本 + 历史记录 | 3 天 |
| **Phase 4** | WebSocket + TCP/UDP | 3 天 |
| **Phase 5** | 压测引擎 + UI | 2 天 |
| **Phase 6** | 抓包模块 | 2 天 |
| **Phase 7** | 插件系统（WASM 运行时 + 分发） | 5 天 |
| **Phase 8** | 软件更新 + 打包发布 | 2 天 |
