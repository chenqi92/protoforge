// ProtoForge Workflow Engine — 自动化流程编排引擎
// 将 HTTP、TCP、UDP、脚本等原子能力组装成可串行执行的管道
//
// 设计原则：
// 1. 每种 NodeType 是独立的 enum variant + 独立的 execute 函数 → 原子性
// 2. FlowContext 管理节点间数据传递 → 模板变量 {{node_id.field}}
// 3. 拓扑排序 + 逐节点执行 → 确保依赖顺序
// 4. Tauri Event 实时推送状态 → 前端可观测

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::time::Instant;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

// ═══════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════

/// 流程定义（持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
    #[serde(default)]
    pub variables: Vec<FlowVariable>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 流程节点
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    pub id: String,
    pub name: String,
    pub node_type: NodeType,
    /// 节点特定配置（JSON），由 node_type 决定 schema
    pub config: serde_json::Value,
    /// 节点在画布上的 x/y 坐标（前端使用，后端透传）
    #[serde(default)]
    pub position: Option<NodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// 节点类型 — 每种类型对应一个独立的执行函数
/// 新增节点只需：1) 加一个 variant 2) 在 execute_node() 加一个 match arm 3) 实现 execute_xxx_node()
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NodeType {
    HttpRequest,
    TcpSend,
    UdpSend,
    Delay,
    Script,
    ExtractData,
    Base64Encode,
    Base64Decode,
    // Phase 1 新增 — 流程控制 & 辅助
    Condition,
    Loop,
    Parallel,
    SetVariable,
    Log,
    Assertion,
    Start,
    End,
}

/// 节点间的连线
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEdge {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    /// 可选条件表达式（预留，Phase 1 不使用）
    #[serde(default)]
    pub condition: Option<String>,
}

/// 流程变量（用户预定义的初始变量）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowVariable {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub description: String,
}

/// 流程执行实例
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExecution {
    pub execution_id: String,
    pub workflow_id: String,
    pub status: ExecutionStatus,
    pub node_results: Vec<NodeResult>,
    pub started_at: String,
    #[serde(default)]
    pub finished_at: Option<String>,
    pub total_duration_ms: u64,
}

/// 单个节点执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: String,
    pub node_name: String,
    pub node_type: NodeType,
    pub status: ExecutionStatus,
    /// 节点输出（JSON），后续节点可引用
    pub output: serde_json::Value,
    #[serde(default)]
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// 执行状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

// ═══════════════════════════════════════════
//  Tauri Event 载荷
// ═══════════════════════════════════════════

/// 流程执行进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowProgressEvent {
    pub execution_id: String,
    pub workflow_id: String,
    /// 当前执行到的节点 index (0-based)
    pub current_step: usize,
    pub total_steps: usize,
    /// 当前节点 ID
    pub current_node_id: String,
    /// 当前节点名称
    pub current_node_name: String,
    /// 当前节点状态
    pub status: ExecutionStatus,
    /// 节点结果（仅在节点完成/失败时填充）
    #[serde(default)]
    pub node_result: Option<NodeResult>,
}

// ═══════════════════════════════════════════
//  WorkflowState — Tauri 状态管理
// ═══════════════════════════════════════════

/// 管理运行中流程的取消令牌
#[derive(Clone)]
pub struct WorkflowState {
    pub running: std::sync::Arc<tokio::sync::Mutex<HashMap<String, CancellationToken>>>,
}

impl WorkflowState {
    pub fn new() -> Self {
        Self {
            running: std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

// ═══════════════════════════════════════════
//  FlowContext — 节点间数据传递
// ═══════════════════════════════════════════

/// 执行上下文，管理变量和节点输出
#[derive(Debug, Clone)]
pub struct FlowContext {
    /// 用户预定义变量
    pub variables: HashMap<String, String>,
    /// 节点输出 — key 为 node_id，value 为节点输出 JSON
    pub node_outputs: HashMap<String, serde_json::Value>,
}

impl FlowContext {
    pub fn new(initial_vars: &[FlowVariable]) -> Self {
        let mut variables = HashMap::new();
        for var in initial_vars {
            variables.insert(var.key.clone(), var.value.clone());
        }
        Self {
            variables,
            node_outputs: HashMap::new(),
        }
    }

    /// 记录节点输出
    pub fn set_node_output(&mut self, node_id: &str, output: serde_json::Value) {
        // 同时将 output 的顶层字段展开为变量（方便模板引用）
        if let Some(obj) = output.as_object() {
            for (k, v) in obj {
                let var_key = format!("{}.{}", node_id, k);
                let var_val = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                self.variables.insert(var_key, var_val);
            }
        }
        // 也存一份完整的输出 JSON 字符串
        self.variables
            .insert(format!("{}.output", node_id), output.to_string());
        self.node_outputs.insert(node_id.to_string(), output);
    }

    /// 解析模板字符串，替换 {{variable}} 引用
    /// 支持：
    /// - {{var_name}} — 引用预定义变量
    /// - {{node_id.field}} — 引用上游节点输出的某个字段
    /// - {{node_id.output}} — 引用上游节点的完整输出 JSON
    pub fn resolve_template(&self, template: &str) -> String {
        let mut result = template.to_string();
        // 查找所有 {{...}} 模式并替换
        loop {
            let start = match result.find("{{") {
                Some(i) => i,
                None => break,
            };
            let end = match result[start..].find("}}") {
                Some(i) => start + i + 2,
                None => break,
            };
            let var_name = &result[start + 2..end - 2].trim();
            let replacement = self.variables.get(*var_name).cloned().unwrap_or_default();
            result = format!("{}{}{}", &result[..start], replacement, &result[end..]);
        }
        result
    }

    /// 解析整个 JSON 配置中的模板引用
    pub fn resolve_config(&self, config: &serde_json::Value) -> serde_json::Value {
        match config {
            serde_json::Value::String(s) => serde_json::Value::String(self.resolve_template(s)),
            serde_json::Value::Object(map) => {
                let mut resolved = serde_json::Map::new();
                for (k, v) in map {
                    resolved.insert(k.clone(), self.resolve_config(v));
                }
                serde_json::Value::Object(resolved)
            }
            serde_json::Value::Array(arr) => {
                let resolved: Vec<_> = arr.iter().map(|v| self.resolve_config(v)).collect();
                serde_json::Value::Array(resolved)
            }
            other => other.clone(),
        }
    }
}

// ═══════════════════════════════════════════
//  拓扑排序
// ═══════════════════════════════════════════

/// 对流程节点进行拓扑排序，返回节点 ID 的执行顺序
fn topological_sort(nodes: &[FlowNode], edges: &[FlowEdge]) -> Result<Vec<String>, String> {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    // 初始化
    for node in nodes {
        in_degree.insert(node.id.clone(), 0);
        adjacency.entry(node.id.clone()).or_default();
    }

    // 计算入度
    for edge in edges {
        adjacency
            .entry(edge.source_node_id.clone())
            .or_default()
            .push(edge.target_node_id.clone());
        *in_degree.entry(edge.target_node_id.clone()).or_insert(0) += 1;
    }

    // BFS (Kahn's algorithm)
    let mut queue: Vec<String> = in_degree
        .iter()
        .filter(|(_, deg)| **deg == 0)
        .map(|(id, _)| id.clone())
        .collect();
    queue.sort(); // 同入度节点按 ID 排序，保证确定性

    let mut result = Vec::new();
    while let Some(node_id) = queue.first().cloned() {
        queue.remove(0);
        result.push(node_id.clone());

        if let Some(neighbors) = adjacency.get(&node_id) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push(neighbor.clone());
                        queue.sort();
                    }
                }
            }
        }
    }

    if result.len() != nodes.len() {
        return Err("流程存在循环依赖，无法执行".to_string());
    }

    Ok(result)
}

// ═══════════════════════════════════════════
//  WorkflowRunner — 核心执行引擎
// ═══════════════════════════════════════════

/// 运行流程
pub async fn run_workflow(
    workflow: &Workflow,
    app: tauri::AppHandle,
    cancel_token: CancellationToken,
) -> WorkflowExecution {
    let execution_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();
    let start_time = Instant::now();

    // 拓扑排序
    let sorted_ids = match topological_sort(&workflow.nodes, &workflow.edges) {
        Ok(ids) => ids,
        Err(_e) => {
            return WorkflowExecution {
                execution_id,
                workflow_id: workflow.id.clone(),
                status: ExecutionStatus::Failed,
                node_results: vec![],
                started_at,
                finished_at: Some(chrono::Utc::now().to_rfc3339()),
                total_duration_ms: start_time.elapsed().as_millis() as u64,
            };
        }
    };

    // 构建节点 ID → 节点的查找表
    let node_map: HashMap<&str, &FlowNode> =
        workflow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut context = FlowContext::new(&workflow.variables);
    let mut node_results: Vec<NodeResult> = Vec::new();
    let mut final_status = ExecutionStatus::Completed;
    let total_steps = sorted_ids.len();

    for (step_idx, node_id) in sorted_ids.iter().enumerate() {
        // 检查取消
        if cancel_token.is_cancelled() {
            final_status = ExecutionStatus::Cancelled;
            // 将剩余节点标记为 Cancelled
            for remaining_id in &sorted_ids[step_idx..] {
                if let Some(node) = node_map.get(remaining_id.as_str()) {
                    node_results.push(NodeResult {
                        node_id: node.id.clone(),
                        node_name: node.name.clone(),
                        node_type: node.node_type.clone(),
                        status: ExecutionStatus::Cancelled,
                        output: serde_json::Value::Null,
                        error: None,
                        duration_ms: 0,
                    });
                }
            }
            break;
        }

        let node = match node_map.get(node_id.as_str()) {
            Some(n) => n,
            None => continue,
        };

        // 发送"正在执行"事件
        let _ = app.emit(
            "workflow-progress",
            WorkflowProgressEvent {
                execution_id: execution_id.clone(),
                workflow_id: workflow.id.clone(),
                current_step: step_idx,
                total_steps,
                current_node_id: node.id.clone(),
                current_node_name: node.name.clone(),
                status: ExecutionStatus::Running,
                node_result: None,
            },
        );

        // 解析节点配置中的变量引用
        let resolved_config = context.resolve_config(&node.config);

        // 执行节点
        let node_start = Instant::now();
        let exec_result = tokio::select! {
            result = execute_node(&node.node_type, &resolved_config, &context) => result,
            _ = cancel_token.cancelled() => {
                Err("流程已被用户取消".to_string())
            }
        };

        let duration_ms = node_start.elapsed().as_millis() as u64;

        let node_result = match exec_result {
            Ok(output) => {
                // 将输出写入上下文供后续节点使用
                context.set_node_output(&node.id, output.clone());
                NodeResult {
                    node_id: node.id.clone(),
                    node_name: node.name.clone(),
                    node_type: node.node_type.clone(),
                    status: ExecutionStatus::Completed,
                    output,
                    error: None,
                    duration_ms,
                }
            }
            Err(e) => {
                final_status = if cancel_token.is_cancelled() {
                    ExecutionStatus::Cancelled
                } else {
                    ExecutionStatus::Failed
                };
                NodeResult {
                    node_id: node.id.clone(),
                    node_name: node.name.clone(),
                    node_type: node.node_type.clone(),
                    status: final_status.clone(),
                    output: serde_json::Value::Null,
                    error: Some(e),
                    duration_ms,
                }
            }
        };

        // 发送节点完成事件
        let _ = app.emit(
            "workflow-progress",
            WorkflowProgressEvent {
                execution_id: execution_id.clone(),
                workflow_id: workflow.id.clone(),
                current_step: step_idx,
                total_steps,
                current_node_id: node.id.clone(),
                current_node_name: node.name.clone(),
                status: node_result.status.clone(),
                node_result: Some(node_result.clone()),
            },
        );

        let failed = node_result.status == ExecutionStatus::Failed
            || node_result.status == ExecutionStatus::Cancelled;
        node_results.push(node_result);

        // 如果节点执行失败，终止流程
        if failed {
            // 将剩余节点标记为 Pending
            for remaining_id in &sorted_ids[step_idx + 1..] {
                if let Some(remaining_node) = node_map.get(remaining_id.as_str()) {
                    node_results.push(NodeResult {
                        node_id: remaining_node.id.clone(),
                        node_name: remaining_node.name.clone(),
                        node_type: remaining_node.node_type.clone(),
                        status: ExecutionStatus::Pending,
                        output: serde_json::Value::Null,
                        error: None,
                        duration_ms: 0,
                    });
                }
            }
            break;
        }
    }

    WorkflowExecution {
        execution_id,
        workflow_id: workflow.id.clone(),
        status: final_status,
        node_results,
        started_at,
        finished_at: Some(chrono::Utc::now().to_rfc3339()),
        total_duration_ms: start_time.elapsed().as_millis() as u64,
    }
}

// ═══════════════════════════════════════════
//  节点执行分派
// ═══════════════════════════════════════════

/// 根据节点类型分派到对应的执行函数
async fn execute_node(
    node_type: &NodeType,
    config: &serde_json::Value,
    context: &FlowContext,
) -> Result<serde_json::Value, String> {
    match node_type {
        NodeType::HttpRequest => execute_http_node(config).await,
        NodeType::TcpSend => execute_tcp_send_node(config).await,
        NodeType::UdpSend => execute_udp_send_node(config).await,
        NodeType::Delay => execute_delay_node(config).await,
        NodeType::Script => execute_script_node(config, context).await,
        NodeType::ExtractData => execute_extract_node(config, context).await,
        NodeType::Base64Encode => execute_base64_node(config, true).await,
        NodeType::Base64Decode => execute_base64_node(config, false).await,
        // Phase 1: 占位执行器
        NodeType::Start | NodeType::End => Ok(serde_json::json!({})),
        NodeType::Log => execute_log_node(config).await,
        NodeType::SetVariable => execute_set_variable_node(config, context).await,
        NodeType::Assertion => execute_assertion_node(config, context).await,
        NodeType::Condition => execute_condition_node(config, context).await,
        NodeType::Loop => Ok(serde_json::json!({ "iterations": config.get("iterations").and_then(|v| v.as_u64()).unwrap_or(1) })),
        NodeType::Parallel => Ok(serde_json::json!({ "note": "Parallel execution planned for Phase 2" })),
    }
}

// ═══════════════════════════════════════════
//  内置节点执行器
// ═══════════════════════════════════════════

/// HTTP 请求节点 — 复用 http_client::execute_request
async fn execute_http_node(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::http_client;

    let request: http_client::HttpRequest = serde_json::from_value(config.clone())
        .map_err(|e| format!("HTTP 节点配置解析失败: {}", e))?;

    let response = http_client::execute_request(request).await?;

    serde_json::to_value(&response).map_err(|e| format!("HTTP 响应序列化失败: {}", e))
}

/// TCP 发送节点 — 连接 → 发送 → 可选等待响应 → 关闭
async fn execute_tcp_send_node(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TcpNodeConfig {
        host: String,
        port: u16,
        data: String,
        #[serde(default = "default_encoding")]
        encoding: String,
        /// 等待响应超时（毫秒），0 表示不等待
        #[serde(default)]
        read_timeout_ms: u64,
    }

    let cfg: TcpNodeConfig = serde_json::from_value(config.clone())
        .map_err(|e| format!("TCP 节点配置解析失败: {}", e))?;

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP 连接 {} 失败: {}", addr, e))?;

    // 编码数据
    let bytes = encode_data(&cfg.data, &cfg.encoding)?;
    stream
        .write_all(&bytes)
        .await
        .map_err(|e| format!("TCP 发送失败: {}", e))?;

    // 可选等待响应
    let response_data = if cfg.read_timeout_ms > 0 {
        let mut buf = vec![0u8; 65536];
        match tokio::time::timeout(
            std::time::Duration::from_millis(cfg.read_timeout_ms),
            stream.read(&mut buf),
        )
        .await
        {
            Ok(Ok(n)) => {
                let data = &buf[..n];
                Some(decode_response_data(data, &cfg.encoding))
            }
            Ok(Err(e)) => {
                return Err(format!("TCP 读取响应失败: {}", e));
            }
            Err(_) => {
                // 超时，不算错误
                None
            }
        }
    } else {
        None
    };

    let _ = stream.shutdown().await;

    Ok(serde_json::json!({
        "sent": cfg.data,
        "sentBytes": bytes.len(),
        "response": response_data,
        "address": addr,
    }))
}

/// UDP 发送节点 — 绑定 → 发送 → 可选等待响应
async fn execute_udp_send_node(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    use tokio::net::UdpSocket;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UdpNodeConfig {
        target_host: String,
        target_port: u16,
        data: String,
        #[serde(default = "default_encoding")]
        encoding: String,
        #[serde(default = "default_local_addr")]
        local_addr: String,
        #[serde(default)]
        read_timeout_ms: u64,
    }

    let cfg: UdpNodeConfig = serde_json::from_value(config.clone())
        .map_err(|e| format!("UDP 节点配置解析失败: {}", e))?;

    let socket = UdpSocket::bind(&cfg.local_addr)
        .await
        .map_err(|e| format!("UDP 绑定 {} 失败: {}", cfg.local_addr, e))?;

    let target = format!("{}:{}", cfg.target_host, cfg.target_port);
    let bytes = encode_data(&cfg.data, &cfg.encoding)?;

    let sent = socket
        .send_to(&bytes, &target)
        .await
        .map_err(|e| format!("UDP 发送到 {} 失败: {}", target, e))?;

    let response_data = if cfg.read_timeout_ms > 0 {
        let mut buf = vec![0u8; 65536];
        match tokio::time::timeout(
            std::time::Duration::from_millis(cfg.read_timeout_ms),
            socket.recv_from(&mut buf),
        )
        .await
        {
            Ok(Ok((n, from_addr))) => {
                let data = &buf[..n];
                Some(serde_json::json!({
                    "data": decode_response_data(data, &cfg.encoding),
                    "from": from_addr.to_string(),
                }))
            }
            Ok(Err(e)) => {
                return Err(format!("UDP 读取响应失败: {}", e));
            }
            Err(_) => None,
        }
    } else {
        None
    };

    Ok(serde_json::json!({
        "sent": cfg.data,
        "sentBytes": sent,
        "target": target,
        "response": response_data,
    }))
}

/// 延时节点
async fn execute_delay_node(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DelayConfig {
        /// 延时毫秒数
        delay_ms: u64,
    }

    let cfg: DelayConfig = serde_json::from_value(config.clone())
        .map_err(|e| format!("Delay 节点配置解析失败: {}", e))?;

    tokio::time::sleep(std::time::Duration::from_millis(cfg.delay_ms)).await;

    Ok(serde_json::json!({
        "delayMs": cfg.delay_ms,
    }))
}

/// 脚本节点 — 复用 Boa JS 引擎
async fn execute_script_node(
    config: &serde_json::Value,
    context: &FlowContext,
) -> Result<serde_json::Value, String> {
    use crate::script_engine;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ScriptConfig {
        /// JavaScript 脚本代码
        script: String,
    }

    let cfg: ScriptConfig = serde_json::from_value(config.clone())
        .map_err(|e| format!("Script 节点配置解析失败: {}", e))?;

    // 将上下文变量注入脚本环境
    let result = script_engine::run_pre_script(&cfg.script, &context.variables);

    if !result.success {
        return Err(format!(
            "脚本执行失败: {}",
            result.error.unwrap_or_else(|| "unknown".to_string())
        ));
    }

    Ok(serde_json::json!({
        "logs": result.logs,
        "envUpdates": result.env_updates,
        "testResults": result.test_results,
    }))
}

/// 数据提取节点 — 从输入中提取指定数据
async fn execute_extract_node(
    config: &serde_json::Value,
    _context: &FlowContext,
) -> Result<serde_json::Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExtractConfig {
        /// 输入来源（模板引用，如 {{node1.body}}）
        source: String,
        /// 提取模式
        mode: ExtractMode,
        /// 提取表达式（JSONPath key, 正则表达式, 或固定值）
        expression: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    enum ExtractMode {
        /// JSON 字段提取（支持点分路径，如 "data.items[0].name"）
        JsonPath,
        /// 正则表达式提取（第一个捕获组）
        Regex,
        /// 固定值（直接输出 expression）
        Fixed,
    }

    let cfg: ExtractConfig = serde_json::from_value(config.clone())
        .map_err(|e| format!("Extract 节点配置解析失败: {}", e))?;

    // source 已经在 resolve_config 中被变量替换过了
    let source = &cfg.source;

    let extracted = match cfg.mode {
        ExtractMode::JsonPath => {
            let json: serde_json::Value =
                serde_json::from_str(source).map_err(|e| format!("解析 JSON 源数据失败: {}", e))?;
            extract_json_path(&json, &cfg.expression)
                .ok_or_else(|| format!("JSON 路径 '{}' 未找到匹配", cfg.expression))?
        }
        ExtractMode::Regex => {
            let re = regex_lite::Regex::new(&cfg.expression)
                .map_err(|e| format!("正则表达式编译失败: {}", e))?;
            match re.captures(source) {
                Some(caps) => {
                    // 如果有捕获组，返回第一个捕获组；否则返回整个匹配
                    caps.get(1)
                        .or_else(|| caps.get(0))
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default()
                }
                None => {
                    return Err(format!("正则表达式 '{}' 未匹配到内容", cfg.expression));
                }
            }
        }
        ExtractMode::Fixed => cfg.expression.clone(),
    };

    Ok(serde_json::json!({
        "value": extracted,
    }))
}

/// 简易 JSON 路径提取（支持点分路径和数组索引）
/// 例如: "data.items[0].name"
fn extract_json_path(json: &serde_json::Value, path: &str) -> Option<String> {
    let mut current = json;

    for segment in path.split('.') {
        // 检查是否有数组索引，如 "items[0]"
        if let Some(bracket_pos) = segment.find('[') {
            let key = &segment[..bracket_pos];
            let idx_str = &segment[bracket_pos + 1..segment.len() - 1];

            if !key.is_empty() {
                current = current.get(key)?;
            }

            let idx: usize = idx_str.parse().ok()?;
            current = current.get(idx)?;
        } else {
            current = current.get(segment)?;
        }
    }

    match current {
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

/// Base64 编解码节点
async fn execute_base64_node(
    config: &serde_json::Value,
    encode: bool,
) -> Result<serde_json::Value, String> {
    use base64::Engine as _;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Base64Config {
        /// 输入数据
        input: String,
    }

    let cfg: Base64Config = serde_json::from_value(config.clone())
        .map_err(|e| format!("Base64 节点配置解析失败: {}", e))?;

    let result = if encode {
        base64::engine::general_purpose::STANDARD.encode(cfg.input.as_bytes())
    } else {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&cfg.input)
            .map_err(|e| format!("Base64 解码失败: {}", e))?;
        String::from_utf8(decoded).map_err(|e| format!("Base64 解码后非 UTF-8: {}", e))?
    };

    Ok(serde_json::json!({
        "value": result,
    }))
}

/// 日志输出节点
async fn execute_log_node(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    let message = config
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let level = config
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("info")
        .to_string();
    // Log the message
    match level.as_str() {
        "warn" => log::warn!("[workflow:log] {}", message),
        "error" => log::error!("[workflow:log] {}", message),
        _ => log::info!("[workflow:log] {}", message),
    }
    Ok(serde_json::json!({
        "message": message,
        "level": level,
    }))
}

/// 设置变量节点
async fn execute_set_variable_node(
    config: &serde_json::Value,
    _context: &FlowContext,
) -> Result<serde_json::Value, String> {
    let key = config
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let value = config
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if key.is_empty() {
        return Err("变量名不能为空".to_string());
    }
    Ok(serde_json::json!({
        "key": key,
        "value": value,
    }))
}

/// 断言节点
async fn execute_assertion_node(
    config: &serde_json::Value,
    _context: &FlowContext,
) -> Result<serde_json::Value, String> {
    let target = config
        .get("target")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let operator = config
        .get("operator")
        .and_then(|v| v.as_str())
        .unwrap_or("equals")
        .to_string();
    let expected = config
        .get("expected")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let name = config
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Assertion")
        .to_string();

    let passed = match operator.as_str() {
        "equals" => target == expected,
        "notEquals" => target != expected,
        "contains" => target.contains(&expected),
        "greaterThan" => {
            target.parse::<f64>().unwrap_or(0.0) > expected.parse::<f64>().unwrap_or(0.0)
        }
        "lessThan" => {
            target.parse::<f64>().unwrap_or(0.0) < expected.parse::<f64>().unwrap_or(0.0)
        }
        "matches" => {
            regex_lite::Regex::new(&expected)
                .map(|re| re.is_match(&target))
                .unwrap_or(false)
        }
        _ => false,
    };

    if passed {
        Ok(serde_json::json!({
            "name": name,
            "passed": true,
            "target": target,
            "operator": operator,
            "expected": expected,
        }))
    } else {
        Err(format!(
            "断言失败 [{}]: '{}' {} '{}'",
            name, target, operator, expected
        ))
    }
}

/// 条件判断节点 — Phase 1 仅求值表达式，不做分支路由
async fn execute_condition_node(
    config: &serde_json::Value,
    _context: &FlowContext,
) -> Result<serde_json::Value, String> {
    let expression = config
        .get("expression")
        .and_then(|v| v.as_str())
        .unwrap_or("true")
        .to_string();
    // 简单求值：检查是否为 "true" 或非空非零
    let result = match expression.trim().to_lowercase().as_str() {
        "true" | "1" | "yes" => true,
        "false" | "0" | "no" | "" => false,
        _ => !expression.trim().is_empty(),
    };
    Ok(serde_json::json!({
        "expression": expression,
        "result": result,
    }))
}

// ═══════════════════════════════════════════
//  数据编解码工具
// ═══════════════════════════════════════════

fn default_encoding() -> String {
    "utf8".to_string()
}

fn default_local_addr() -> String {
    "0.0.0.0:0".to_string()
}

/// 将字符串数据按编码方式转为字节
fn encode_data(data: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "hex" => {
            let clean = data.replace(' ', "").replace("0x", "");
            (0..clean.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&clean[i..i + 2], 16))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Hex 编码失败: {}", e))
        }
        _ => Ok(data.as_bytes().to_vec()), // utf8 default
    }
}

/// 将响应字节解码为字符串
fn decode_response_data(data: &[u8], encoding: &str) -> String {
    match encoding {
        "hex" => data
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::from_utf8_lossy(data).to_string(), // utf8 default
    }
}

// ═══════════════════════════════════════════
//  持久化 — CRUD
// ═══════════════════════════════════════════

/// 列出所有流程定义
pub async fn list_workflows(pool: &SqlitePool) -> Result<Vec<Workflow>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String)>(
        "SELECT id, name, description, definition, created_at, updated_at FROM workflows ORDER BY updated_at DESC"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询流程列表失败: {}", e))?;

    let mut workflows = Vec::new();
    for (id, name, description, definition, created_at, updated_at) in rows {
        let mut workflow: Workflow =
            serde_json::from_str(&definition).unwrap_or_else(|_| Workflow {
                id: id.clone(),
                name: name.clone(),
                description: description.clone(),
                nodes: vec![],
                edges: vec![],
                variables: vec![],
                created_at: created_at.clone(),
                updated_at: updated_at.clone(),
            });
        workflow.id = id;
        workflow.name = name;
        workflow.description = description;
        workflow.created_at = created_at;
        workflow.updated_at = updated_at;
        workflows.push(workflow);
    }

    Ok(workflows)
}

/// 获取单个流程定义
pub async fn get_workflow(pool: &SqlitePool, id: &str) -> Result<Workflow, String> {
    let row = sqlx::query_as::<_, (String, String, String, String, String, String)>(
        "SELECT id, name, description, definition, created_at, updated_at FROM workflows WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("查询流程失败: {}", e))?
    .ok_or_else(|| format!("流程 {} 不存在", id))?;

    let (id, name, description, definition, created_at, updated_at) = row;
    let mut workflow: Workflow =
        serde_json::from_str(&definition).map_err(|e| format!("解析流程定义失败: {}", e))?;
    workflow.id = id;
    workflow.name = name;
    workflow.description = description;
    workflow.created_at = created_at;
    workflow.updated_at = updated_at;

    Ok(workflow)
}

/// 创建流程
pub async fn create_workflow(pool: &SqlitePool, workflow: &Workflow) -> Result<Workflow, String> {
    let definition = serde_json::json!({
        "nodes": workflow.nodes,
        "edges": workflow.edges,
        "variables": workflow.variables,
    });
    let def_str =
        serde_json::to_string(&definition).map_err(|e| format!("序列化流程定义失败: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO workflows (id, name, description, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&workflow.id)
    .bind(&workflow.name)
    .bind(&workflow.description)
    .bind(&def_str)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("创建流程失败: {}", e))?;

    let mut result = workflow.clone();
    result.created_at = now.clone();
    result.updated_at = now;
    Ok(result)
}

/// 更新流程
pub async fn update_workflow(pool: &SqlitePool, workflow: &Workflow) -> Result<(), String> {
    let definition = serde_json::json!({
        "nodes": workflow.nodes,
        "edges": workflow.edges,
        "variables": workflow.variables,
    });
    let def_str =
        serde_json::to_string(&definition).map_err(|e| format!("序列化流程定义失败: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "UPDATE workflows SET name = ?, description = ?, definition = ?, updated_at = ? WHERE id = ?"
    )
    .bind(&workflow.name)
    .bind(&workflow.description)
    .bind(&def_str)
    .bind(&now)
    .bind(&workflow.id)
    .execute(pool)
    .await
    .map_err(|e| format!("更新流程失败: {}", e))?;

    Ok(())
}

/// 删除流程
pub async fn delete_workflow(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM workflows WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("删除流程失败: {}", e))?;

    Ok(())
}

// ═══════════════════════════════════════════
//  单元测试
// ═══════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── FlowContext 模板替换 ──

    #[test]
    fn test_resolve_template_simple() {
        let ctx = FlowContext::new(&[FlowVariable {
            key: "host".into(),
            value: "example.com".into(),
            description: "".into(),
        }]);
        assert_eq!(
            ctx.resolve_template("https://{{host}}/api"),
            "https://example.com/api"
        );
    }

    #[test]
    fn test_resolve_template_node_output() {
        let mut ctx = FlowContext::new(&[]);
        ctx.set_node_output(
            "step1",
            serde_json::json!({
                "body": "{\"token\":\"abc123\"}",
                "status": 200,
            }),
        );
        assert_eq!(
            ctx.resolve_template("Token: {{step1.body}}"),
            "Token: {\"token\":\"abc123\"}"
        );
        assert_eq!(
            ctx.resolve_template("Status: {{step1.status}}"),
            "Status: 200"
        );
    }

    #[test]
    fn test_resolve_template_no_match() {
        let ctx = FlowContext::new(&[]);
        assert_eq!(ctx.resolve_template("{{unknown}}"), "");
    }

    #[test]
    fn test_resolve_template_no_template() {
        let ctx = FlowContext::new(&[]);
        assert_eq!(ctx.resolve_template("plain text"), "plain text");
    }

    #[test]
    fn test_resolve_config_nested() {
        let ctx = FlowContext::new(&[FlowVariable {
            key: "base".into(),
            value: "https://api.test.com".into(),
            description: "".into(),
        }]);
        let config = serde_json::json!({
            "url": "{{base}}/users",
            "headers": {
                "Authorization": "Bearer token"
            }
        });
        let resolved = ctx.resolve_config(&config);
        assert_eq!(resolved["url"], "https://api.test.com/users");
        assert_eq!(resolved["headers"]["Authorization"], "Bearer token");
    }

    // ── 拓扑排序 ──

    #[test]
    fn test_topological_sort_linear() {
        let nodes = vec![
            FlowNode {
                id: "c".into(),
                name: "C".into(),
                node_type: NodeType::Delay,
                config: serde_json::json!({}),
                position: None,
            },
            FlowNode {
                id: "a".into(),
                name: "A".into(),
                node_type: NodeType::Delay,
                config: serde_json::json!({}),
                position: None,
            },
            FlowNode {
                id: "b".into(),
                name: "B".into(),
                node_type: NodeType::Delay,
                config: serde_json::json!({}),
                position: None,
            },
        ];
        let edges = vec![
            FlowEdge {
                id: "e1".into(),
                source_node_id: "a".into(),
                target_node_id: "b".into(),
                condition: None,
            },
            FlowEdge {
                id: "e2".into(),
                source_node_id: "b".into(),
                target_node_id: "c".into(),
                condition: None,
            },
        ];
        let result = topological_sort(&nodes, &edges).unwrap();
        assert_eq!(result, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_topological_sort_cycle_detection() {
        let nodes = vec![
            FlowNode {
                id: "a".into(),
                name: "A".into(),
                node_type: NodeType::Delay,
                config: serde_json::json!({}),
                position: None,
            },
            FlowNode {
                id: "b".into(),
                name: "B".into(),
                node_type: NodeType::Delay,
                config: serde_json::json!({}),
                position: None,
            },
        ];
        let edges = vec![
            FlowEdge {
                id: "e1".into(),
                source_node_id: "a".into(),
                target_node_id: "b".into(),
                condition: None,
            },
            FlowEdge {
                id: "e2".into(),
                source_node_id: "b".into(),
                target_node_id: "a".into(),
                condition: None,
            },
        ];
        assert!(topological_sort(&nodes, &edges).is_err());
    }

    #[test]
    fn test_topological_sort_single_node() {
        let nodes = vec![FlowNode {
            id: "a".into(),
            name: "A".into(),
            node_type: NodeType::Delay,
            config: serde_json::json!({}),
            position: None,
        }];
        let edges = vec![];
        let result = topological_sort(&nodes, &edges).unwrap();
        assert_eq!(result, vec!["a"]);
    }

    // ── JSON 路径提取 ──

    #[test]
    fn test_extract_json_path_simple() {
        let json = serde_json::json!({"name": "ProtoForge", "version": "1.0"});
        assert_eq!(
            extract_json_path(&json, "name"),
            Some("ProtoForge".to_string())
        );
        assert_eq!(extract_json_path(&json, "version"), Some("1.0".to_string()));
    }

    #[test]
    fn test_extract_json_path_nested() {
        let json = serde_json::json!({"data": {"items": [{"id": 1}, {"id": 2}]}});
        assert_eq!(
            extract_json_path(&json, "data.items[0].id"),
            Some("1".to_string())
        );
        assert_eq!(
            extract_json_path(&json, "data.items[1].id"),
            Some("2".to_string())
        );
    }

    #[test]
    fn test_extract_json_path_not_found() {
        let json = serde_json::json!({"a": 1});
        assert_eq!(extract_json_path(&json, "b"), None);
        assert_eq!(extract_json_path(&json, "a.b.c"), None);
    }

    // ── 数据编解码 ──

    #[test]
    fn test_encode_data_utf8() {
        let bytes = encode_data("hello", "utf8").unwrap();
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn test_encode_data_hex() {
        let bytes = encode_data("48 65 6c 6c 6f", "hex").unwrap();
        assert_eq!(bytes, b"Hello");
    }

    #[test]
    fn test_decode_response_data_hex() {
        let data = b"Hello";
        assert_eq!(decode_response_data(data, "hex"), "48 65 6c 6c 6f");
    }

    // ── Base64 节点 ──

    #[tokio::test]
    async fn test_execute_base64_encode() {
        let config = serde_json::json!({"input": "Hello, World!"});
        let result = execute_base64_node(&config, true).await.unwrap();
        assert_eq!(result["value"], "SGVsbG8sIFdvcmxkIQ==");
    }

    #[tokio::test]
    async fn test_execute_base64_decode() {
        let config = serde_json::json!({"input": "SGVsbG8sIFdvcmxkIQ=="});
        let result = execute_base64_node(&config, false).await.unwrap();
        assert_eq!(result["value"], "Hello, World!");
    }

    // ── Delay 节点 ──

    #[tokio::test]
    async fn test_execute_delay_node() {
        let config = serde_json::json!({"delayMs": 50});
        let start = Instant::now();
        let result = execute_delay_node(&config).await.unwrap();
        let elapsed = start.elapsed().as_millis();
        assert!(elapsed >= 40); // 允许少量误差
        assert_eq!(result["delayMs"], 50);
    }

    // ── Script 节点 ──

    #[tokio::test]
    async fn test_execute_script_node() {
        let config = serde_json::json!({
            "script": "pm.environment.set('result', '42'); console.log('hello from script');"
        });
        let context = FlowContext::new(&[]);
        let result = execute_script_node(&config, &context).await.unwrap();
        assert!(
            result["logs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|l| l == "hello from script")
        );
        assert_eq!(result["envUpdates"]["result"], "42");
    }
}
