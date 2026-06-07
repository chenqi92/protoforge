import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolWindowShell } from "@/components/layout/ToolWindowShell";
import { VideoStreamWorkspace } from "@/components/videostream/VideoStreamWorkspace";
import { DEFAULT_VIDEO_TOOL_MODE } from "@/types/toolSession";
import type { VideoProtocol } from "@/types/videostream";

export function VideoStreamWindow() {
  const { t } = useTranslation();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [sessionId] = useState(() => params.get("session") ?? crypto.randomUUID());
  const [initialMode] = useState<VideoProtocol>(() => {
    const nextMode = params.get("videoMode");
    const validModes: VideoProtocol[] = ["rtsp", "rtmp", "http-flv", "hls", "webrtc", "gb28181", "srt", "onvif"];
    return validModes.includes(nextMode as VideoProtocol) ? (nextMode as VideoProtocol) : DEFAULT_VIDEO_TOOL_MODE;
  });

  return (
    <ToolWindowShell tool="videostream" sessionId={sessionId} title={t('statusBar.videostream')} module="videostream" accentClassName="bg-accent">
      <div className="h-full overflow-hidden bg-transparent">
        <VideoStreamWorkspace sessionId={sessionId} initialMode={initialMode} />
      </div>
    </ToolWindowShell>
  );
}
