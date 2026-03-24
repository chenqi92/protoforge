// ProtoForge Workflow Engine — 前端服务层
// 封装所有 Workflow Tauri commands 的 invoke 调用

import { invoke } from '@tauri-apps/api/core';
import type { Workflow } from '../types/workflow';

// ═══════════════════════════════════════════
//  CRUD
// ═══════════════════════════════════════════

/** 列出所有流程定义 */
export async function listWorkflows(): Promise<Workflow[]> {
  return invoke<Workflow[]>('workflow_list');
}

/** 获取单个流程定义 */
export async function getWorkflow(id: string): Promise<Workflow> {
  return invoke<Workflow>('workflow_get', { id });
}

/** 创建新流程 */
export async function createWorkflow(workflow: Workflow): Promise<Workflow> {
  return invoke<Workflow>('workflow_create', { workflow });
}

/** 更新流程定义 */
export async function updateWorkflow(workflow: Workflow): Promise<void> {
  return invoke<void>('workflow_update', { workflow });
}

/** 删除流程 */
export async function deleteWorkflow(id: string): Promise<void> {
  return invoke<void>('workflow_delete', { id });
}

// ═══════════════════════════════════════════
//  执行控制
// ═══════════════════════════════════════════

/** 运行流程（异步执行），返回 executionId */
export async function runWorkflow(id: string): Promise<string> {
  return invoke<string>('workflow_run', { id });
}

/** 取消正在运行的流程 */
export async function cancelWorkflow(executionId: string): Promise<void> {
  return invoke<void>('workflow_cancel', { executionId });
}
