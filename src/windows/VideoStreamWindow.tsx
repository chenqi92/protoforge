import { useState } from "react";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { VideoStreamWorkspace } from "@/components/videostream/VideoStreamWorkspace";
import { DEFAULT_VIDEO_TOOL_MODE } from "@/types/toolSession";
import type { VideoProtocol } from "@/types/videostream";

export function VideoStreamWindow() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [sessionId] = useState(() => params.get("session") ?? crypto.randomUUID());
  const [initialMode] = useState<VideoProtocol>(() => {
    const nextMode = params.get("videoMode");
    const validModes: VideoProtocol[] = ["rtsp", "rtmp", "http-flv", "hls", "webrtc", "gb28181", "srt", "onvif"];
    return validModes.includes(nextMode as VideoProtocol) ? (nextMode as VideoProtocol) : DEFAULT_VIDEO_TOOL_MODE;
  });

  return (
    <ToolWindowShell tool="videostream" sessionId={sessionId} title="视频流调试" module="videostream" accentClassName="bg-purple-500">
      <div className="h-full overflow-hidden bg-transparent">
        <VideoStreamWorkspace sessionId={sessionId} initialMode={initialMode} />
      </div>
    </ToolWindowShell>
  );
}
