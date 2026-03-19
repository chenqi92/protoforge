# ProtoForge

> 🛠️ 现代化的 API 开发与测试工具，基于 Tauri 2 + React + Rust 构建。

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
- **SSE** — Server-Sent Events 事件流
- **MQTT** — 连接 / 订阅 / 发布 / QoS 支持
- **TCP/UDP** — Client + Server 模式，多编码支持

### 📦 集合管理
- 树形目录（集合 → 文件夹 → 请求）
- Postman v2.1 导入/导出
- Swagger/OpenAPI 导入
- Collection Runner 批量运行

### 🧪 测试工具
- 压力测试（固定并发，实时 TPS / 延迟 / 成功率面板）
- HTTP 抓包代理（HTTP + HTTPS CONNECT 隧道）

### 🧩 插件系统
- 内置协议解析插件（Modbus / HJ212 / MQTT）
- 远程插件仓库

### ⚡ 交互体验
- Ctrl+K 全局命令面板
- 主题：浅色 / 深色 / 跟随系统
- 窗口状态记忆
- 拖拽分割面板
- 多 Tab 工作区 + 快捷键

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
| UI | Vanilla CSS + lucide-react |

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
