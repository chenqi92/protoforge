// Tauri 多窗口管理器
// 封装独立工具窗口的创建、聚焦和关闭逻辑

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type ToolWindowType = "capture" | "loadtest" | "tcpudp";

interface ToolWindowConfig {
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

const toolConfigs: Record<ToolWindowType, ToolWindowConfig> = {
  capture: {
    title: "ProtoForge — 网络抓包",
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
  },
  loadtest: {
    title: "ProtoForge — 压力测试",
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
  },
  tcpudp: {
    title: "ProtoForge — TCP/UDP",
    width: 1000,
    height: 700,
    minWidth: 750,
    minHeight: 500,
  },
};

/**
 * 打开工具窗口（单例模式：如果已存在则聚焦）
 */
export async function openToolWindow(tool: ToolWindowType): Promise<void> {
  const label = `tool-${tool}`;

  // 检查窗口是否已存在
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const config = toolConfigs[tool];

  // 创建新窗口，加载同一 SPA 但带 ?window=xxx 参数
  new WebviewWindow(label, {
    url: `/?window=${tool}`,
    title: config.title,
    width: config.width,
    height: config.height,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    decorations: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    center: true,
  });
}

export async function isToolWindowOpen(tool: ToolWindowType): Promise<boolean> {
  const label = `tool-${tool}`;
  const existing = await WebviewWindow.getByLabel(label);
  return Boolean(existing);
}

export async function focusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}
