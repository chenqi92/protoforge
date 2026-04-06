// Tauri 多窗口管理器
// 封装独立工具窗口的创建、聚焦和关闭逻辑

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ToolSessionOptions } from "@/types/toolSession";

export type ToolWindowType = "capture" | "loadtest" | "tcpudp" | "videostream" | "mockserver" | "dbclient" | "toolbox";

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
  videostream: {
    title: "ProtoForge — 视频流",
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
  },
  mockserver: {
    title: "ProtoForge — Mock Server",
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
  },
  dbclient: {
    title: "ProtoForge — Database Client",
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
  },
  toolbox: {
    title: "ProtoForge — 工具箱",
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
  },
};

export function getToolWindowLabel(tool: ToolWindowType, sessionId: string): string {
  return `tool-${tool}-${sessionId}`;
}

function parseToolWindowLabel(label: string): { tool: ToolWindowType; sessionId: string } | null {
  const match = label.match(/^tool-(capture|loadtest|tcpudp|videostream|mockserver|dbclient)-(.+)$/);
  if (!match) return null;

  return {
    tool: match[1] as ToolWindowType,
    sessionId: match[2],
  };
}

async function getToolWindows(tool?: ToolWindowType) {
  const windows = await WebviewWindow.getAll();

  return windows.filter((window) => {
    const parsed = parseToolWindowLabel(window.label);
    if (!parsed) return false;
    return tool ? parsed.tool === tool : true;
  });
}

/**
 * 打开工具窗口（按会话实例管理）
 */
export async function openToolWindow(
  tool: ToolWindowType,
  sessionId: string = crypto.randomUUID(),
  options?: ToolSessionOptions,
): Promise<string> {
  const label = getToolWindowLabel(tool, sessionId);

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return sessionId;
  }

  const config = toolConfigs[tool];

  const params = new URLSearchParams({
    window: tool,
    session: sessionId,
  });
  if (options?.tcpMode) {
    params.set("tcpMode", options.tcpMode);
  }
  if (options?.videoMode) {
    params.set("videoMode", options.videoMode);
  }

  new WebviewWindow(label, {
    url: `/?${params.toString()}`,
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

  return sessionId;
}

export async function isToolWindowOpen(tool: ToolWindowType, sessionId?: string): Promise<boolean> {
  if (sessionId) {
    const existing = await WebviewWindow.getByLabel(getToolWindowLabel(tool, sessionId));
    return Boolean(existing);
  }

  const windows = await getToolWindows(tool);
  return windows.length > 0;
}

export async function listOpenToolWindowSessions(tool: ToolWindowType): Promise<string[]> {
  const windows = await getToolWindows(tool);
  return windows
    .map((window) => parseToolWindowLabel(window.label))
    .filter((item): item is { tool: ToolWindowType; sessionId: string } => Boolean(item))
    .map((item) => item.sessionId);
}

export async function focusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}

export async function closeWindowByLabel(label: string): Promise<void> {
  const target = await WebviewWindow.getByLabel(label);
  if (!target) return;

  try {
    await target.close();
  } catch {
    try {
      await target.destroy();
    } catch {
      // ignore close failures
    }
  }
}
