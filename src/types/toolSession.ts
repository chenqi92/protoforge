import type { SocketMode } from "@/types/tcp";
import type { VideoProtocol } from "@/types/videostream";

export interface ToolSessionOptions {
  customLabel?: string | null;
  tcpMode?: SocketMode;
  videoMode?: VideoProtocol;
}

export const DEFAULT_TCP_TOOL_MODE: SocketMode = "tcp-client";
export const DEFAULT_VIDEO_TOOL_MODE: VideoProtocol = "rtsp";
