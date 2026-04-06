import { lazy, Suspense, useState, useCallback, useEffect, useRef } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Database, Gauge, List, MonitorPlay, Network, Plus, Radio, Server, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsEffect } from "@/hooks/useSettingsEffect";
import { useLanguageSync } from "@/hooks/useLanguageSync";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar, type Tab } from "@/components/layout/TabBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { WelcomePage, type WelcomeAction } from "@/components/WelcomePage";
import { useAppStore, type RequestProtocol, type ToolSession, type ToolWorkbench, type WorkbenchView } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePluginStore } from "@/stores/pluginStore";
import { closeWindowByLabel, listOpenToolWindowSessions, openToolWindow } from "@/lib/windowManager";
import { getActiveConnectionLabelsForKeys, hasActiveConnectionsForKeys } from '@/lib/connectionRegistry';
import { CommandPalette } from "@/components/ui/CommandPalette";

import { GlobalContextMenu } from "@/components/plugins/GlobalContextMenu";

import { WindowScaffold } from "@/components/layout/WindowScaffold";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { subscribeDockToolRequests } from "@/lib/toolDocking";
import { cn } from "@/lib/utils";
import type { HttpRequestMode } from "@/types/http";
import type { SocketMode } from "@/types/tcp";
import type { VideoProtocol } from "@/types/videostream";
import {
  DEFAULT_TCP_TOOL_MODE,
  DEFAULT_VIDEO_TOOL_MODE,
  type ToolSessionOptions,
} from "@/types/toolSession";

// Core workspace components — direct imports for instant tab switching (no Suspense flash)
import { HttpWorkspace } from "@/components/http/HttpWorkspace";
import { RequestsOverview } from "@/components/http/RequestsOverview";
import { WsWorkspace } from "@/components/ws/WsWorkspace";
import { MqttWorkspace } from "@/components/mqtt/MqttWorkspace";
import { TcpWorkspace } from "@/components/tcp/TcpWorkspace";
import { LoadTestWorkspace } from "@/components/loadtest/LoadTestWorkspace";
import { VideoStreamWorkspace } from "@/components/videostream/VideoStreamWorkspace";
import { CaptureWorkspace } from "@/components/capture/CaptureWorkspace";
import { MockServerWorkspace } from "@/components/mockserver/MockServerWorkspace";
import { DbClientWorkspace } from "@/components/dbclient/DbClientWorkspace";
import { ToolboxWorkspace } from "@/components/toolbox/ToolboxWorkspace";

// Low-frequency components — keep lazy for smaller initial bundle
const PluginModal = lazy(() => import("@/components/plugins/PluginModal").then((module) => ({ default: module.PluginModal })));
const SettingsModal = lazy(() => import("@/components/settings/SettingsModal").then((module) => ({ default: module.SettingsModal })));
const DesignSystemPage = lazy(() => import("@/components/dev/DesignSystemPage").then((module) => ({ default: module.DesignSystemPage })));
const EnvironmentVariablesModal = lazy(() => import("@/components/modals/EnvironmentVariablesModal"));
const CollectionSettingsPanel = lazy(() => import("@/components/collections/CollectionSettingsPanel").then((module) => ({ default: module.CollectionSettingsPanel })));

function LazyPaneFallback({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 items-center justify-center px-4 pf-text-sm text-text-tertiary", className)}>
      {label}
    </div>
  );
}

const toolWorkbenchMeta: Record<ToolWorkbench, {
  titleKey: string;
  shortTitleKey: string;
  descKey: string;
  icon: typeof Network;
  accentClassName: string;
  accentBorderClassName: string;
  accentDotClassName: string;
}> = {
  tcpudp: {
    titleKey: "toolWorkbench.tcpudp.title",
    shortTitleKey: "toolWorkbench.tcpudp.shortTitle",
    descKey: "toolWorkbench.tcpudp.description",
    icon: Network,
    accentClassName: "text-blue-600",
    accentBorderClassName: "border-blue-500",
    accentDotClassName: "bg-blue-500",
  },
  capture: {
    titleKey: "toolWorkbench.capture.title",
    shortTitleKey: "toolWorkbench.capture.shortTitle",
    descKey: "toolWorkbench.capture.description",
    icon: Radio,
    accentClassName: "text-cyan-600",
    accentBorderClassName: "border-cyan-500",
    accentDotClassName: "bg-cyan-500",
  },
  loadtest: {
    titleKey: "toolWorkbench.loadtest.title",
    shortTitleKey: "toolWorkbench.loadtest.shortTitle",
    descKey: "toolWorkbench.loadtest.description",
    icon: Gauge,
    accentClassName: "text-rose-600",
    accentBorderClassName: "border-rose-500",
    accentDotClassName: "bg-rose-500",
  },
  videostream: {
    titleKey: "toolWorkbench.videostream.title",
    shortTitleKey: "toolWorkbench.videostream.shortTitle",
    descKey: "toolWorkbench.videostream.description",
    icon: MonitorPlay,
    accentClassName: "text-purple-600",
    accentBorderClassName: "border-purple-500",
    accentDotClassName: "bg-purple-500",
  },
  mockserver: {
    titleKey: "toolWorkbench.mockserver.title",
    shortTitleKey: "toolWorkbench.mockserver.shortTitle",
    descKey: "toolWorkbench.mockserver.description",
    icon: Server,
    accentClassName: "text-green-600",
    accentBorderClassName: "border-green-500",
    accentDotClassName: "bg-green-500",
  },
  dbclient: {
    titleKey: "toolWorkbench.dbclient.title",
    shortTitleKey: "toolWorkbench.dbclient.shortTitle",
    descKey: "toolWorkbench.dbclient.description",
    icon: Database,
    accentClassName: "text-amber-600",
    accentBorderClassName: "border-amber-500",
    accentDotClassName: "bg-amber-500",
  },
  toolbox: {
    titleKey: "toolWorkbench.toolbox.title",
    shortTitleKey: "toolWorkbench.toolbox.shortTitle",
    descKey: "toolWorkbench.toolbox.description",
    icon: Wrench,
    accentClassName: "text-orange-600",
    accentBorderClassName: "border-orange-500",
    accentDotClassName: "bg-orange-500",
  },
};

interface ToolSessionPreset {
  id: string;
  label: string;
  description: string;
  group?: "playback" | "assistant";
  options?: ToolSessionOptions;
}

const TCP_SESSION_LABELS: Record<SocketMode, string> = {
  "tcp-client": "TCP 客户端",
  "tcp-server": "TCP 服务端",
  "udp-client": "UDP 客户端",
  "udp-server": "UDP 服务端",
  serial: "串口",
  modbus: "Modbus 主站",
  "modbus-slave": "Modbus 从站",
};

const VIDEO_SESSION_LABELS: Record<VideoProtocol, string> = {
  rtsp: "RTSP",
  rtmp: "RTMP",
  "http-flv": "HTTP-FLV",
  hls: "HLS",
  webrtc: "WebRTC",
  srt: "SRT",
  onvif: "ONVIF 助手",
  gb28181: "GB28181 助手",
};

const TCP_SESSION_PRESETS: ToolSessionPreset[] = [
  { id: "tcp-client", label: "TCP 客户端", description: "主动连接远端 Socket", options: { tcpMode: "tcp-client" } },
  { id: "tcp-server", label: "TCP 服务端", description: "本地监听并接收客户端", options: { tcpMode: "tcp-server" } },
  { id: "udp-client", label: "UDP 客户端", description: "向固定目标发送 Datagram", options: { tcpMode: "udp-client" } },
  { id: "udp-server", label: "UDP 服务端", description: "本地绑定端口收发 Datagram", options: { tcpMode: "udp-server" } },
  { id: "serial", label: "串口", description: "串口调试与透传", options: { tcpMode: "serial" } },
  { id: "modbus", label: "Modbus 主站", description: "主站轮询与报文调试", options: { tcpMode: "modbus" } },
  { id: "modbus-slave", label: "Modbus 从站", description: "从站寄存器模拟", options: { tcpMode: "modbus-slave" } },
];

const VIDEO_SESSION_PRESETS: ToolSessionPreset[] = [
  { id: "rtsp", label: "RTSP", description: "摄像头与网关拉流", group: "playback", options: { videoMode: "rtsp" } },
  { id: "rtmp", label: "RTMP", description: "推拉流与 CDN 接入", group: "playback", options: { videoMode: "rtmp" } },
  { id: "http-flv", label: "HTTP-FLV", description: "浏览器友好的低延迟 FLV", group: "playback", options: { videoMode: "http-flv" } },
  { id: "hls", label: "HLS", description: "m3u8 播放与切片分析", group: "playback", options: { videoMode: "hls" } },
  { id: "webrtc", label: "WebRTC", description: "实时媒体与信令调试", group: "playback", options: { videoMode: "webrtc" } },
  { id: "srt", label: "SRT", description: "低时延可靠传输", group: "playback", options: { videoMode: "srt" } },
  { id: "onvif", label: "ONVIF 助手", description: "发现设备、取 RTSP、做 PTZ", group: "assistant", options: { videoMode: "onvif" } },
  { id: "gb28181", label: "GB28181 助手", description: "SIP 注册、目录查询与实况", group: "assistant", options: { videoMode: "gb28181" } },
];

function getToolSessionPresets(tool: ToolWorkbench): ToolSessionPreset[] {
  if (tool === "tcpudp") return TCP_SESSION_PRESETS;
  if (tool === "videostream") return VIDEO_SESSION_PRESETS;
  return [];
}

function getToolSessionBaseLabel(tool: ToolWorkbench, session: ToolSession, fallbackLabel: string): string {
  if (tool === "tcpudp") {
    return TCP_SESSION_LABELS[session.tcpMode ?? DEFAULT_TCP_TOOL_MODE];
  }
  if (tool === "videostream") {
    return VIDEO_SESSION_LABELS[session.videoMode ?? DEFAULT_VIDEO_TOOL_MODE];
  }
  return fallbackLabel;
}

function getToolSessionConnectionKeys(tool: ToolWorkbench, sessionId: string): string[] {
  if (tool === "tcpudp") {
    return [sessionId, `${sessionId}-split`];
  }
  return [sessionId];
}

function ToolWorkbenchPanel({
  tool,
  sessions,
  activeSessionId,
  detachedSessionIds,
  onAddSession,
  onSelectSession,
  onCloseSession,
  onPopout,
  children,
}: {
  tool: ToolWorkbench;
  sessions: ToolSession[];
  activeSessionId: string | null;
  detachedSessionIds: string[];
  onAddSession: (tool: ToolWorkbench, options?: ToolSessionOptions) => void;
  onSelectSession: (tool: ToolWorkbench, sessionId: string) => void;
  onCloseSession: (tool: ToolWorkbench, sessionId: string) => void;
  onPopout: (tool: ToolWorkbench, sessionId: string) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const meta = toolWorkbenchMeta[tool];
  const Icon = meta.icon;
  const sessionPresets = getToolSessionPresets(tool);

  // Filter out detached sessions from visible tab list
  const visibleSessions = sessions.filter((s) => !detachedSessionIds.includes(s.id));
  const activeVisible = activeSessionId && !detachedSessionIds.includes(activeSessionId);

  const sessionScrollRef = useRef<HTMLDivElement>(null);
  const sessionBarRef = useRef<HTMLDivElement>(null);
  const sessionMenuAnchorRef = useRef<HTMLDivElement>(null);
  const createMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [sessionMenuPos, setSessionMenuPos] = useState({ top: 0, left: 0 });
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });

  // Drag-to-popout state for session tabs
  const dragStateRef = useRef<{
    sessionId: string | null;
    startX: number;
    startY: number;
    popped: boolean;
  }>({
    sessionId: null,
    startX: 0,
    startY: 0,
    popped: false,
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds.sessionId || ds.popped || !sessionBarRef.current) return;

      const movedX = Math.abs(event.clientX - ds.startX);
      const movedY = Math.abs(event.clientY - ds.startY);
      if (movedX < 18 && movedY < 18) return;

      const rect = sessionBarRef.current.getBoundingClientRect();
      const outside =
        event.clientX < rect.left - 24 ||
        event.clientX > rect.right + 24 ||
        event.clientY < rect.top - 18 ||
        event.clientY > rect.bottom + 24;

      if (!outside) return;

      ds.popped = true;
      onPopout(tool, ds.sessionId);
    };

    const clearDrag = () => {
      dragStateRef.current.sessionId = null;
      dragStateRef.current.popped = false;
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", clearDrag, true);
    window.addEventListener("blur", clearDrag);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", clearDrag, true);
      window.removeEventListener("blur", clearDrag);
    };
  }, [onPopout, tool]);

  const handleSessionTabMouseDown = (sessionId: string, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    dragStateRef.current = {
      sessionId,
      startX: event.clientX,
      startY: event.clientY,
      popped: false,
    };
  };

  const updateSessionScrollState = useCallback(() => {
    const el = sessionScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = sessionScrollRef.current;
    if (!el) return;

    const handleScroll = () => updateSessionScrollState();
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      if (el.scrollWidth <= el.clientWidth) {
        return;
      }

      event.preventDefault();
      el.scrollBy({ left: event.deltaY, behavior: "auto" });
    };

    updateSessionScrollState();
    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: false });
    const observer = new ResizeObserver(() => updateSessionScrollState());
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [visibleSessions.length, updateSessionScrollState]);

  const hasOverflow = canScrollLeft || canScrollRight;
  const scrollSessionsBy = (direction: "left" | "right") => {
    const el = sessionScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -220 : 220, behavior: "smooth" });
  };

  const toggleSessionMenu = () => {
    if (sessionMenuAnchorRef.current) {
      const rect = sessionMenuAnchorRef.current.getBoundingClientRect();
      setSessionMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 220) });
    }
    setShowSessionMenu((prev) => !prev);
  };

  const toggleCreateMenu = (anchor?: HTMLElement | null) => {
    if (sessionPresets.length === 0) {
      onAddSession(tool);
      return;
    }
    const anchorEl = anchor ?? createMenuAnchorRef.current;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setCreateMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 260) });
    }
    setShowCreateMenu((prev) => !prev);
  };

  const sessionLabelMap = new Map<string, string>();
  const fallbackLabel = t(meta.shortTitleKey);
  const labelCounts = new Map<string, number>();
  sessions.forEach((session) => {
    const customLabel = session.customLabel?.trim();
    if (customLabel) {
      sessionLabelMap.set(session.id, customLabel);
      return;
    }

    const baseLabel = getToolSessionBaseLabel(tool, session, fallbackLabel);
    const nextIndex = (labelCounts.get(baseLabel) ?? 0) + 1;
    labelCounts.set(baseLabel, nextIndex);
    sessionLabelMap.set(session.id, `${baseLabel} ${nextIndex}`);
  });

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div ref={sessionBarRef} className="flex h-11 shrink-0 items-center gap-3 border-b border-border-default/65 bg-bg-primary/38 px-3">
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <div className="flex h-7 items-center gap-2 rounded-[10px] border border-border-default/70 bg-bg-primary/85 px-2.5 shadow-xs">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.accentClassName)} />
            <div className="pf-text-sm font-semibold text-text-primary">{t(meta.shortTitleKey)}</div>
          </div>
        </div>

        <div ref={sessionScrollRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-hide">
          {visibleSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const label = sessionLabelMap.get(session.id) ?? session.id;

            return (
              <div
                key={session.id}
                onMouseDown={(e) => handleSessionTabMouseDown(session.id, e)}
                onClick={() => {
                  const ds = dragStateRef.current;
                  if (ds.popped && ds.sessionId === session.id) {
                    ds.sessionId = null;
                    ds.popped = false;
                    return;
                  }
                  onSelectSession(tool, session.id);
                }}
                className={cn(
                  "group flex h-8 shrink-0 cursor-grab items-center gap-1 rounded-[9px] px-2 pf-text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 text-text-primary"
                    : "bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                )}
                title={t('toolWorkbench.dragToDetachSession')}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isActive ? meta.accentDotClassName : "bg-border-strong"
                  )}
                />
                <span className="truncate">{label}</span>
                {visibleSessions.length > 1 ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const sessionKeys = getToolSessionConnectionKeys(tool, session.id);
                      if (hasActiveConnectionsForKeys(sessionKeys)) {
                        const labels = getActiveConnectionLabelsForKeys(sessionKeys);
                        const msg = `此会话存在活跃连接：\n${labels.join('\n')}\n\n确定要关闭吗？`;
                        if (!window.confirm(msg)) return;
                      }
                      onCloseSession(tool, session.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex h-4.5 w-4.5 items-center justify-center rounded-[6px] text-text-disabled transition-colors hover:bg-bg-hover hover:text-text-primary"
                    title={t('tabBar.closeTab')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasOverflow ? (
            <>
              <button
                onClick={() => scrollSessionsBy("left")}
                disabled={!canScrollLeft}
                className="wb-icon-btn"
                title={t('tabBar.scrollLeft')}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => scrollSessionsBy("right")}
                disabled={!canScrollRight}
                className="wb-icon-btn"
                title={t('tabBar.scrollRight')}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <div ref={sessionMenuAnchorRef}>
                <button
                  onClick={toggleSessionMenu}
                  className={cn("wb-icon-btn", showSessionMenu && "bg-bg-hover text-text-primary")}
                  title={t('toolWorkbench.allInstances')}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : null}

          <div ref={createMenuAnchorRef}>
            <button
              onClick={(event) => toggleCreateMenu(event.currentTarget)}
              className="wb-ghost-btn px-2.5"
              title={sessionPresets.length > 0 ? t('toolWorkbench.newTypedInstance', { defaultValue: '按类型新建实例' }) : t('toolWorkbench.newInstance')}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('toolWorkbench.newInstance')}
            </button>
          </div>

          <button
            onClick={() => activeSessionId && activeVisible && onPopout(tool, activeSessionId)}
            disabled={!activeSessionId || !activeVisible}
            className="wb-ghost-btn px-2.5"
            title={t('toolWorkbench.popoutWindow')}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {t('toolWorkbench.popoutWindow')}
          </button>
        </div>
      </div>

      {showSessionMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowSessionMenu(false)} />
          <div
            className="fixed z-[221] w-[220px] overflow-hidden rounded-[12px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            style={{ top: sessionMenuPos.top, left: sessionMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('toolWorkbench.allInstances')}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {sessions.map((session) => {
                const label = sessionLabelMap.get(session.id) ?? session.id;
                const isActive = session.id === activeSessionId;
                const isDetached = detachedSessionIds.includes(session.id);

                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      if (isDetached) {
                        // Focus the detached window instead
                        onPopout(tool, session.id);
                      } else {
                        onSelectSession(tool, session.id);
                      }
                      setShowSessionMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[7px] text-left transition-colors hover:bg-bg-hover/70",
                      isActive && !isDetached && "bg-bg-hover/45"
                    )}
                  >
                    <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", isActive && !isDetached ? meta.accentDotClassName : isDetached ? "bg-accent" : "bg-border-strong")} />
                    <span className="min-w-0 flex-1 truncate pf-text-sm font-medium text-text-primary">{label}</span>
                    {isDetached ? <ArrowUpRight className="h-3 w-3 text-text-disabled" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {showCreateMenu ? (
        <>
          <div className="fixed inset-0 z-[220]" onClick={() => setShowCreateMenu(false)} />
          <div
            className="fixed z-[221] w-[260px] overflow-hidden rounded-[12px] border border-border-default/80 bg-bg-primary/96 p-1 shadow-[0_16px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            <div className="px-2.5 pb-0.5 pt-1.5 pf-text-xxs font-semibold uppercase tracking-[0.14em] text-text-disabled">
              {t('toolWorkbench.newInstance')}
            </div>
            {sessionPresets.some((preset) => preset.group === "playback") && (
              <div className="px-2.5 pb-0.5 pt-1.5 pf-text-3xs font-semibold uppercase tracking-[0.14em] text-text-disabled">
                播放协议
              </div>
            )}
            <div className="max-h-[360px] overflow-y-auto">
              {sessionPresets.map((preset) => {
                const showGroupDivider =
                  preset.group === "assistant" &&
                  sessionPresets.some((item) => item.group === "playback") &&
                  sessionPresets.findIndex((item) => item.id === preset.id) === sessionPresets.findIndex((item) => item.group === "assistant");

                return (
                  <div key={preset.id}>
                    {showGroupDivider ? (
                      <div className="px-2.5 pb-0.5 pt-2 pf-text-3xs font-semibold uppercase tracking-[0.14em] text-text-disabled">
                        辅助协议
                      </div>
                    ) : null}
                    <button
                      onClick={() => {
                        onAddSession(tool, preset.options);
                        setShowCreateMenu(false);
                      }}
                      className="flex w-full items-start gap-2 rounded-[10px] px-2.5 py-[9px] text-left transition-colors hover:bg-bg-hover/70"
                    >
                      <span className={cn("mt-1 h-[6px] w-[6px] shrink-0 rounded-full", meta.accentDotClassName)} />
                      <span className="min-w-0 flex-1">
                        <span className="block pf-text-sm font-medium text-text-primary">{preset.label}</span>
                        <span className="block pf-text-xxs text-text-tertiary">{preset.description}</span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {visibleSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
            <ArrowUpRight className="h-8 w-8 text-text-disabled" />
            <div className="pf-text-sm">{t('toolWorkbench.allSessionsDetached')}</div>
            <button
              onClick={(event) => toggleCreateMenu(event.currentTarget)}
              className="wb-ghost-btn mt-1 px-3"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('toolWorkbench.newInstance')}
            </button>
          </div>
        ) : children}
      </div>
    </div>
  );
}

function App() {
  const sidebarPanelRef = usePanelRef();
  const rightSidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);
  const sidebarDefaultSize = `${Math.max(useSettingsStore.getState().settings.sidebarWidth, 14)}%`;
  const rightSidebarDefaultSize = `${Math.max(useSettingsStore.getState().settings.rightSidebarWidth, 14)}%`;
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [designSystemOpen, setDesignSystemOpen] = useState(false);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [detachedToolSessions, setDetachedToolSessions] = useState<Record<ToolWorkbench, string[]>>({
    tcpudp: [],
    capture: [],
    loadtest: [],
    videostream: [],
    mockserver: [],
    dbclient: [],
    toolbox: [],
  });

  useKeyboardShortcuts();
  useSettingsEffect();
  useLanguageSync();

  // 启动时自动加载已安装的插件（确保渲染器 tab 等扩展点立即可用）
  const fetchInstalledPlugins = usePluginStore((s) => s.fetchInstalledPlugins);
  useEffect(() => {
    fetchInstalledPlugins();
  }, [fetchInstalledPlugins]);

  useEffect(() => {
    const handler = () => setCmdPaletteOpen((value) => !value);
    window.addEventListener("toggle-command-palette", handler);
    return () => window.removeEventListener("toggle-command-palette", handler);
  }, []);

  useEffect(() => {
    const openPlugins = () => setPluginModalOpen(true);
    const openSettings = () => setSettingsOpen(true);
    const openDesignSystem = () => setDesignSystemOpen(true);

    window.addEventListener("open-plugin-modal", openPlugins);
    window.addEventListener("open-settings-modal", openSettings);
    window.addEventListener("open-design-system", openDesignSystem);

    return () => {
      window.removeEventListener("open-plugin-modal", openPlugins);
      window.removeEventListener("open-settings-modal", openSettings);
      window.removeEventListener("open-design-system", openDesignSystem);
    };
  }, []);

  // 监听 macOS 菜单「检查更新」事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('check-for-updates', () => {
          import('@/stores/updateStore').then(({ useUpdateStore: store }) => {
            store.getState().checkForUpdate();
          });
        });
      } catch {
        // 非 Tauri 环境忽略
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = useAppStore((s) => s.getActiveTab());
  const activeWorkbench = useAppStore((s) => s.activeWorkbench);
  const activeCollectionId = useAppStore((s) => s.activeCollectionId);
  const toolSessions = useAppStore((s) => s.toolSessions);
  const activeToolSessionIds = useAppStore((s) => s.activeToolSessionIds);
  const addTab = useAppStore((s) => s.addTab);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);
  const openToolTab = useAppStore((s) => s.openToolTab);
  const addToolSession = useAppStore((s) => s.addToolSession);
  const setActiveToolSession = useAppStore((s) => s.setActiveToolSession);
  const closeToolSession = useAppStore((s) => s.closeToolSession);
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveWorkbench = useAppStore((s) => s.setActiveWorkbench);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const closeCollectionPanel = useAppStore((s) => s.closeCollectionPanel);

  // 右侧面板默认折叠：首次切换到非 home 视图时折叠（此时 Panel 才真正挂载）
  const rightSidebarInitialized = useRef(false);
  useEffect(() => {
    if (activeWorkbench !== "home" && !rightSidebarInitialized.current) {
      rightSidebarInitialized.current = true;
      requestAnimationFrame(() => {
        rightSidebarPanelRef.current?.collapse();
      });
    }
  }, [activeWorkbench, rightSidebarPanelRef]);

  const refreshDetachedTools = useCallback(async () => {
    const toolKeys: ToolWorkbench[] = ["tcpudp", "capture", "loadtest", "videostream", "mockserver", "dbclient", "toolbox"];
    const states = await Promise.all(
      toolKeys.map(async (tool) => [tool, await listOpenToolWindowSessions(tool)] as const)
    );

    setDetachedToolSessions({
      tcpudp: states.find(([tool]) => tool === "tcpudp")?.[1] ?? [],
      capture: states.find(([tool]) => tool === "capture")?.[1] ?? [],
      loadtest: states.find(([tool]) => tool === "loadtest")?.[1] ?? [],
      videostream: states.find(([tool]) => tool === "videostream")?.[1] ?? [],
      mockserver: states.find(([tool]) => tool === "mockserver")?.[1] ?? [],
      dbclient: states.find(([tool]) => tool === "dbclient")?.[1] ?? [],
      toolbox: states.find(([tool]) => tool === "toolbox")?.[1] ?? [],
    });
  }, []);

  useEffect(() => {
    void refreshDetachedTools();

    const handleFocus = () => {
      void refreshDetachedTools();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshDetachedTools();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshDetachedTools]);

  useEffect(() => {
    return subscribeDockToolRequests(({ tool, sessionId, sourceLabel }) => {
      openToolTab(tool, sessionId);
      setDetachedToolSessions((prev) => ({
        ...prev,
        [tool]: prev[tool].filter((item) => item !== sessionId),
      }));
      if (sourceLabel) {
        void closeWindowByLabel(sourceLabel);
      }
    });
  }, [openToolTab]);

  // 不再自动创建空 tab，当 tabs.length === 0 时展示概览页面

  const displayTabs: Tab[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.customLabel?.trim()
      || (tab.protocol === "http" && tab.httpConfig?.name?.trim() && tab.httpConfig.name !== "Untitled Request" ? tab.httpConfig.name.trim() : "")
      || (tab.protocol === "http" ? tab.httpConfig?.url?.trim() : "")
      || tab.label,
    protocol: tab.protocol,
    method: tab.protocol === "http" ? tab.httpConfig?.method : undefined,
    requestMode: tab.protocol === "http" ? tab.httpConfig?.requestMode : undefined,
    modified: false,
  }));

  const createHttpModeTab = useCallback((mode: HttpRequestMode) => {
    const tabId = addTab("http");
    updateHttpConfig(tabId, {
      requestMode: mode,
      name: mode === "graphql" ? "GraphQL Request" : mode === "sse" ? "SSE Stream" : "Untitled Request",
      method: mode === "graphql" ? "POST" : "GET",
    });
    return tabId;
  }, [addTab, updateHttpConfig]);

  const handleNewTab = useCallback((protocol?: RequestProtocol) => {
    addTab(protocol || "http");
  }, [addTab]);

  const handleSelectWorkbench = useCallback(async (workbench: WorkbenchView) => {
    if (workbench === "home") {
      setActiveWorkbench("home");
      return;
    }
    if (workbench === "requests") {
      setActiveWorkbench("requests");
      if (activeCollectionId && !activeTabId) {
        closeCollectionPanel();
      }
      return;
    }

    openToolTab(workbench);
  }, [activeCollectionId, activeTabId, closeCollectionPanel, openToolTab, setActiveWorkbench]);

  const handlePopoutWorkbench = useCallback(async (tool: ToolWorkbench, sessionId: string) => {
    const session = useAppStore.getState().toolSessions[tool].find((item) => item.id === sessionId);
    const detachedSessionId = await openToolWindow(tool, sessionId, {
      tcpMode: session?.tcpMode ?? undefined,
      videoMode: session?.videoMode ?? undefined,
    });
    setDetachedToolSessions((prev) => {
      const nextDetached = prev[tool].includes(detachedSessionId) ? prev[tool] : [...prev[tool], detachedSessionId];

      // Auto-switch to next visible session if the popped-out one was active
      const currentActiveId = useAppStore.getState().activeToolSessionIds[tool];
      if (currentActiveId === detachedSessionId) {
        const sessions = useAppStore.getState().toolSessions[tool];
        const nextVisible = sessions.find((s) => !nextDetached.includes(s.id));
        if (nextVisible) {
          useAppStore.getState().setActiveToolSession(tool, nextVisible.id);
        }
      }

      return {
        ...prev,
        [tool]: nextDetached,
      };
    });
  }, []);

  const handleOpenPlugins = useCallback(() => {
    setPluginModalOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setSidebarCollapsed(size.inPixels <= 52);
    if (size.asPercentage > 5) {
      useSettingsStore.getState().update("sidebarWidth", Math.round(size.asPercentage));
    }
  }, []);

  const handleSidebarToggle = useCallback(() => {
    const ref = sidebarPanelRef.current;
    if (!ref) return;
    if (sidebarCollapsed) {
      ref.expand();
      const width = useSettingsStore.getState().settings.sidebarWidth;
      ref.resize(`${Math.max(width, 14)}%`);
    } else {
      ref.collapse();
    }
  }, [sidebarPanelRef, sidebarCollapsed]);

  const handleRightSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setRightSidebarCollapsed(size.inPixels <= 52);
    if (size.asPercentage > 5) {
      useSettingsStore.getState().update('rightSidebarWidth', Math.round(size.asPercentage));
    }
  }, []);

  const handleRightSidebarToggle = useCallback(() => {
    const ref = rightSidebarPanelRef.current;
    if (!ref) return;
    if (rightSidebarCollapsed) {
      ref.expand();
      const width = useSettingsStore.getState().settings.rightSidebarWidth;
      ref.resize(`${Math.max(width, 14)}%`);
    } else {
      ref.collapse();
    }
  }, [rightSidebarPanelRef, rightSidebarCollapsed]);

  const handleWelcomeAction = useCallback((action: WelcomeAction) => {
    switch (action) {
      case "http":
        addTab(action);
        break;
      case "graphql":
        createHttpModeTab("graphql");
        break;
      case "sse":
        createHttpModeTab("sse");
        break;
      case "ws":
      case "mqtt":
        addTab(action);
        break;
      case "tcpudp":
      case "loadtest":
      case "capture":
      case "mockserver":
      case "dbclient":
        void handleSelectWorkbench(action);
        break;
      case "plugins":
        setPluginModalOpen(true);
        break;
    }
  }, [addTab, createHttpModeTab, handleSelectWorkbench]);



  const renderContent = () => {
    return (
      <div className="h-full min-w-0 overflow-hidden">
        {/* Home 视图 — 全屏渲染 WelcomePage，无侧边栏 */}
        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "home" ? "block" : "hidden")}>
          <WelcomePage onAction={handleWelcomeAction} />
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "requests" ? "block" : "hidden")}>
          <PanelGroup orientation="horizontal">
            <Panel
              id="sidebar"
              defaultSize={sidebarDefaultSize}
              minSize="14%"
              maxSize="50%"
              collapsible
              collapsedSize="48px"
              panelRef={sidebarPanelRef}
              onResize={handleSidebarResize}
              className="relative flex h-full shrink-0 flex-col"
            >
              <Sidebar
                panelCollapsed={sidebarCollapsed}
                onTogglePanel={handleSidebarToggle}
                onOpenEnvModal={() => setEnvModalOpen(true)}
              />
            </Panel>
            <PanelResizeHandle className="relative w-[3px] shrink-0 cursor-col-resize bg-bg-app transition-colors hover:bg-accent/30" />

            <Panel className="flex flex-col overflow-hidden bg-transparent">
              <TabBar
                tabs={displayTabs}
                activeTabId={activeTabId}
                onTabChange={setActiveTab}
                onTabClose={closeTab}
                onNewTab={handleNewTab}
                onReorder={reorderTabs}
              />

              <div className="min-h-0 flex-1 overflow-hidden relative">
                <div className={cn("absolute inset-0 z-10 bg-bg-primary", activeCollectionId ? "block" : "hidden")}>
                  {activeCollectionId && (
                    <Suspense fallback={<LazyPaneFallback className="bg-bg-primary" label="加载集合设置..." />}>
                      <CollectionSettingsPanel collectionId={activeCollectionId} />
                    </Suspense>
                  )}
                </div>

                {/* No tabs: show overview */}
                {tabs.length === 0 && !activeCollectionId && (
                  <div className="absolute inset-0 bg-bg-primary">
                    <RequestsOverview
                      onNewTab={handleNewTab}
                      onOpenCollection={(id) => useAppStore.getState().openCollectionPanel(id)}
                      onOpenEnvModal={() => setEnvModalOpen(true)}
                    />
                  </div>
                )}

                {tabs.map((tab) => {
                  const isActive = !activeCollectionId && activeTabId === tab.id;
                  return (
                    <div key={tab.id} className={cn("absolute inset-0 bg-bg-primary", isActive ? "block" : "hidden")}>
                      {tab.protocol === "http" && <HttpWorkspace tabId={tab.id} />}
                      {tab.protocol === "ws" && <WsWorkspace tabId={tab.id} />}
                      {tab.protocol === "mqtt" && <MqttWorkspace tabId={tab.id} />}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </PanelGroup>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "tcpudp" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="tcpudp"
            sessions={toolSessions.tcpudp}
            activeSessionId={activeToolSessionIds.tcpudp}
            detachedSessionIds={detachedToolSessions.tcpudp}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.tcpudp.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.tcpudp ? "block" : "hidden")}
              >
                <TcpWorkspace sessionId={session.id} initialMode={session.tcpMode ?? DEFAULT_TCP_TOOL_MODE} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "capture" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="capture"
            sessions={toolSessions.capture}
            activeSessionId={activeToolSessionIds.capture}
            detachedSessionIds={detachedToolSessions.capture}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.capture.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.capture ? "block" : "hidden")}
              >
                <CaptureWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "loadtest" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="loadtest"
            sessions={toolSessions.loadtest}
            activeSessionId={activeToolSessionIds.loadtest}
            detachedSessionIds={detachedToolSessions.loadtest}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.loadtest.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.loadtest ? "block" : "hidden")}
              >
                <LoadTestWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "videostream" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="videostream"
            sessions={toolSessions.videostream}
            activeSessionId={activeToolSessionIds.videostream}
            detachedSessionIds={detachedToolSessions.videostream}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.videostream.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.videostream ? "block" : "hidden")}
              >
                <VideoStreamWorkspace sessionId={session.id} initialMode={session.videoMode ?? DEFAULT_VIDEO_TOOL_MODE} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "mockserver" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="mockserver"
            sessions={toolSessions.mockserver}
            activeSessionId={activeToolSessionIds.mockserver}
            detachedSessionIds={detachedToolSessions.mockserver}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.mockserver.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.mockserver ? "block" : "hidden")}
              >
                <MockServerWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "dbclient" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="dbclient"
            sessions={toolSessions.dbclient}
            activeSessionId={activeToolSessionIds.dbclient}
            detachedSessionIds={detachedToolSessions.dbclient}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.dbclient.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.dbclient ? "block" : "hidden")}
              >
                <DbClientWorkspace sessionId={session.id} />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>

        <div className={cn("h-full min-w-0 overflow-hidden", activeWorkbench === "toolbox" ? "block" : "hidden")}>
          <ToolWorkbenchPanel
            tool="toolbox"
            sessions={toolSessions.toolbox}
            activeSessionId={activeToolSessionIds.toolbox}
            detachedSessionIds={detachedToolSessions.toolbox}
            onAddSession={addToolSession}
            onSelectSession={setActiveToolSession}
            onCloseSession={closeToolSession}
            onPopout={handlePopoutWorkbench}
          >
            {toolSessions.toolbox.map((session) => (
              <div
                key={session.id}
                className={cn("h-full min-h-0 overflow-hidden", session.id === activeToolSessionIds.toolbox ? "block" : "hidden")}
              >
                <ToolboxWorkspace />
              </div>
            ))}
          </ToolWorkbenchPanel>
        </div>
      </div>
    );
  };

  const activeModule =
    activeWorkbench === "requests"
      ? activeCollectionId
        ? "collection"
        : activeTab?.protocol === "http" && activeTab.httpConfig?.requestMode && activeTab.httpConfig.requestMode !== "rest"
          ? activeTab.httpConfig.requestMode
          : activeTab?.protocol || "requests"
      : activeWorkbench;

  return (
    <>
      <WindowScaffold
        header={(
          <TitleBar
            activeWorkbench={activeWorkbench}
            onSelectWorkbench={(workbench) => {
              void handleSelectWorkbench(workbench);
            }}
            onOpenPlugins={handleOpenPlugins}
            onOpenSettings={handleOpenSettings}
          />
        )}
        footer={(
          <StatusBar
            activeModule={activeModule}
            responseTime={activeWorkbench === "requests" ? activeTab?.httpResponse?.durationMs : undefined}
            responseSize={activeWorkbench === "requests" ? activeTab?.httpResponse?.bodySize : undefined}
          />
        )}
        bodyClassName="p-0"
      >
      <div className="h-full min-w-0 overflow-hidden">
          {activeWorkbench === "home" ? (
            renderContent()
          ) : (
            <PanelGroup orientation="horizontal">
              <Panel className="min-w-0 overflow-hidden">
                {renderContent()}
              </Panel>
              <PanelResizeHandle className="relative w-[3px] shrink-0 cursor-col-resize bg-bg-app transition-colors hover:bg-accent/30" />
              <Panel
                id="right-sidebar"
                defaultSize={rightSidebarDefaultSize}
                minSize="14%"
                maxSize="40%"
                collapsible
                collapsedSize="48px"
                panelRef={rightSidebarPanelRef}
                onResize={handleRightSidebarResize}
                className="relative flex h-full shrink-0 flex-col overflow-hidden"
              >
                <RightSidebar
                  panelCollapsed={rightSidebarCollapsed}
                  onTogglePanel={handleRightSidebarToggle}
                />
              </Panel>
            </PanelGroup>
          )}
        </div>
      </WindowScaffold>

      {pluginModalOpen && (
        <Suspense fallback={null}>
          <PluginModal open={pluginModalOpen} onClose={() => setPluginModalOpen(false)} />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {/* Design System Page — dev overlay */}
      {designSystemOpen && (
        <div className="fixed inset-0 z-[9999] bg-bg-app overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-primary shrink-0">
            <span className="pf-text-sm font-semibold text-text-primary">Design System</span>
            <button onClick={() => setDesignSystemOpen(false)} className="wb-icon-btn"><X className="w-4 h-4" /></button>
          </div>
          <Suspense fallback={<LazyPaneFallback className="flex-1 bg-bg-app" label="加载设计系统..." />}>
            <DesignSystemPage />
          </Suspense>
        </div>
      )}
      {envModalOpen && (
        <Suspense fallback={null}>
          <EnvironmentVariablesModal open={envModalOpen} onClose={() => setEnvModalOpen(false)} />
        </Suspense>
      )}
      <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />

      <GlobalContextMenu />

    </>
  );
}

export default App;
