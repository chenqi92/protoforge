import type { ToolWindowType } from "./windowManager";

const CHANNEL_NAME = "protoforge:tool-docking";
const STORAGE_KEY = "protoforge:tool-docking-request";

interface DockRequest {
  tool: ToolWindowType;
  sessionId: string;
  ts: number;
  sourceLabel?: string;
}

function isDockRequest(value: unknown): value is DockRequest {
  return typeof value === "object"
    && value !== null
    && "tool" in value
    && "sessionId" in value
    && "ts" in value;
}

export function requestDockTool(tool: ToolWindowType, sessionId: string, sourceLabel?: string) {
  const payload: DockRequest = { tool, sessionId, ts: Date.now(), sourceLabel };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures and rely on channel
  }

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }
}

export function subscribeDockToolRequests(callback: (request: DockRequest) => void) {
  let channel: BroadcastChannel | null = null;

  const handlePayload = (payload: unknown) => {
    if (isDockRequest(payload)) {
      callback(payload);
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handlePayload(JSON.parse(event.newValue));
    } catch {
      // ignore malformed payloads
    }
  };

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => handlePayload(event.data));
  }

  window.addEventListener("storage", handleStorage);

  return () => {
    channel?.close();
    window.removeEventListener("storage", handleStorage);
  };
}
