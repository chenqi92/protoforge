// ONVIF 设备管理协议面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Search, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, RotateCcw, Star, Plus, Play } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";
import type { OnvifDeviceInfo, OnvifProfile, OnvifPreset, VideoProtocol } from "@/types/videostream";

interface OnvifPanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
  suggestedPlaybackMode?: VideoProtocol | null;
  onActivatePlaybackMode?: (mode: VideoProtocol) => void;
}

export function OnvifPanel({
  sessionKey,
  connected: _connected,
  streamUrl: _streamUrl,
  onStreamUrlChange,
  suggestedPlaybackMode,
  onActivatePlaybackMode,
}: OnvifPanelProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState('192.168.1.100');
  const [port, setPort] = useState(80);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<OnvifDeviceInfo | null>(null);
  const [profiles, setProfiles] = useState<OnvifProfile[]>([]);
  const [presets, setPresets] = useState<OnvifPreset[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<{ host: string; port: number; name?: string }[]>([]);
  const [ptzSpeed, setPtzSpeed] = useState(5);
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [selectedXaddr, setSelectedXaddr] = useState<string | null>(null);
  const playbackModeLabel =
    suggestedPlaybackMode === "rtsp" ? "RTSP"
    : suggestedPlaybackMode === "rtmp" ? "RTMP"
    : suggestedPlaybackMode === "hls" ? "HLS"
    : suggestedPlaybackMode === "http-flv" ? "HTTP-FLV"
    : suggestedPlaybackMode === "webrtc" ? "WebRTC"
    : suggestedPlaybackMode === "srt" ? "SRT"
    : suggestedPlaybackMode === "gb28181" ? "GB28181"
    : null;

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    try {
      const devices = await vsSvc.onvifDiscover();
      setDiscoveredDevices(devices as typeof discoveredDevices);
    } catch { /* */ }
    setDiscovering(false);
  }, []);

  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const handleGetDeviceInfo = useCallback(async () => {
    setQuerying(true);
    setQueryError(null);
    try {
      const info = await vsSvc.onvifGetDeviceInfo(sessionKey, { host, port, username, password, xaddr: selectedXaddr || undefined, useProxy });
      setDeviceInfo(info as OnvifDeviceInfo);
      try {
        const profs = await vsSvc.onvifGetProfiles(sessionKey);
        setProfiles(profs as OnvifProfile[]);
        if (profs.length > 0) {
          const firstToken = (profs[0] as OnvifProfile).token;
          setSelectedProfile(firstToken);
          const uri = await vsSvc.onvifGetStreamUri(sessionKey, firstToken);
          if (uri) onStreamUrlChange(uri);
        }
      } catch (e) {
        console.warn('GetProfiles/GetStreamUri failed:', e);
      }
    } catch (e) {
      setQueryError(String(e));
    }
    setQuerying(false);
  }, [sessionKey, host, port, username, password, selectedXaddr, useProxy, onStreamUrlChange]);

  const handleSelectProfile = useCallback(async (token: string) => {
    setSelectedProfile(token);
    try {
      const uri = await vsSvc.onvifGetStreamUri(sessionKey, token);
      onStreamUrlChange(uri);
    } catch { /* */ }
  }, [sessionKey, onStreamUrlChange]);

  const handlePtz = useCallback(async (direction: string) => {
    try { await vsSvc.onvifPtzMove(sessionKey, direction, ptzSpeed, selectedProfile || undefined); } catch { /* */ }
  }, [sessionKey, ptzSpeed, selectedProfile]);

  const handlePtzStop = useCallback(async () => {
    try { await vsSvc.onvifPtzStop(sessionKey, selectedProfile || undefined); } catch { /* */ }
  }, [sessionKey, selectedProfile]);

  const handleLoadPresets = useCallback(async () => {
    try {
      const p = await vsSvc.onvifGetPresets(sessionKey, selectedProfile || undefined);
      setPresets(p as OnvifPreset[]);
    } catch { /* */ }
  }, [sessionKey, selectedProfile]);

  const handleGotoPreset = useCallback(async (token: string) => {
    try { await vsSvc.onvifGotoPreset(sessionKey, token, selectedProfile || undefined); } catch { /* */ }
  }, [sessionKey, selectedProfile]);

  const handleSetPreset = useCallback(async () => {
    if (!newPresetName.trim()) return;
    try {
      await vsSvc.onvifSetPreset(sessionKey, newPresetName.trim(), selectedProfile || undefined);
      setNewPresetName('');
      setShowPresetInput(false);
      handleLoadPresets();
    } catch { /* */ }
  }, [sessionKey, newPresetName, selectedProfile, handleLoadPresets]);

  const handleCloseSession = useCallback(async () => {
    try {
      await vsSvc.onvifClose(sessionKey);
    } catch {
      // Ignore stale backend session cleanup failures.
    }
    setDeviceInfo(null);
    setProfiles([]);
    setSelectedProfile('');
    setPresets([]);
    setSelectedXaddr(null);
    onStreamUrlChange('');
  }, [onStreamUrlChange, sessionKey]);

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden">
      {/* ── Before device connected: Discovery + Connection form ── */}
      {!deviceInfo && (
        <>
          {/* Device Discovery */}
          <div className="space-y-1.5">
            <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {t('videostream.onvif.discover', '设备发现')}
            </label>
            <button onClick={handleDiscover} disabled={discovering}
              className={cn("wb-primary-btn w-full px-3 bg-accent hover:bg-accent-hover", discovering && "opacity-70 cursor-wait")}
            >
              <Search className="w-3.5 h-3.5" />
              {discovering ? t('videostream.onvif.discovering', '发现中...') : t('videostream.onvif.discoverBtn', 'WS-Discovery 扫描')}
            </button>
            {discoveredDevices.length > 0 && (
              <div className="max-h-[80px] overflow-y-auto space-y-0.5 pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 p-1">
                {discoveredDevices.map((d, i) => (
                  <button key={i} onClick={() => { setHost(d.host); setPort(d.port); setSelectedXaddr((d as any).xaddr || null); }}
                    className="w-full text-left flex items-center gap-2 px-2 py-1 pf-rounded-xs hover:bg-bg-hover/50 pf-text-xxs font-mono"
                  >
                    <span className="text-accent">{d.host}:{d.port}</span>
                    {d.name && <span className="text-text-disabled truncate">{d.name}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Connection Config */}
          <div className="space-y-1.5">
            <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {t('videostream.onvif.connection', '设备连接')}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-2">
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.100"
                  className="wb-field-sm w-full font-mono"
                />
              </div>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))}
                className="wb-field-sm w-full font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('videostream.rtsp.username', '用户名')}
                className="wb-field-sm w-full font-mono"
              />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('videostream.rtsp.password', '密码')}
                className="wb-field-sm w-full font-mono"
              />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)}
                className="accent-accent w-3.5 h-3.5 rounded"
              />
              <span className="pf-text-xxs text-text-secondary">
                {t('videostream.onvif.useProxy', '通过系统代理')}
              </span>
            </label>
            <button onClick={handleGetDeviceInfo} disabled={querying}
              className={cn("wb-primary-btn w-full px-3 bg-accent hover:bg-accent-hover", querying && "opacity-70 cursor-wait")}
            >
              {querying ? t('videostream.onvif.querying', '查询中...') : t('videostream.onvif.queryDevice', '查询设备')}
            </button>
            {queryError && (
              <div className="flex items-start gap-2 pf-rounded-sm bg-error/8 border border-error/20 px-3 py-2">
                <span className="shrink-0 mt-0.5 text-error">&#9888;</span>
                <span className="pf-text-xxs text-error leading-relaxed">{queryError}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── After device connected: Compact device header + content ── */}
      {deviceInfo && (
        <div className="flex items-center gap-2 pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 px-2.5 py-1.5">
          <div className="flex-1 min-w-0">
            <div className="pf-text-xs font-semibold text-text-primary truncate">{deviceInfo.manufacturer} {deviceInfo.model}</div>
            <div className="pf-text-3xs text-text-disabled font-mono truncate">{host}:{port} &middot; {deviceInfo.firmwareVersion}</div>
          </div>
          <button onClick={handleCloseSession}
            className="shrink-0 pf-text-xxs text-text-disabled hover:text-text-secondary transition-colors"
          >
            {t('videostream.onvif.disconnect', '断开')}
          </button>
        </div>
      )}

      {/* Profiles */}
      {profiles.length > 0 && (
        <div className="space-y-1.5">
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.onvif.profiles', '媒体配置')} ({profiles.length})
          </label>
          <div className="space-y-0.5">
            {profiles.map((p) => (
              <button key={p.token} onClick={() => handleSelectProfile(p.token)}
                className={cn("w-full flex items-center gap-2 px-2 py-1.5 pf-rounded-xs text-left transition-colors pf-text-xxs",
                  selectedProfile === p.token ? "bg-accent/10 border border-accent/30" : "bg-bg-secondary/30 hover:bg-bg-hover/50"
                )}
              >
                <Play className="w-3 h-3 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary">{p.name}</div>
                  <div className="text-text-disabled font-mono">{p.videoEncoding} {p.resolution} {p.fps}fps</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stream URI — shown after profile selection */}
      {profiles.length > 0 && selectedProfile && (
        <div className="space-y-1.5">
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            {t('videostream.onvif.streamUri', '流地址')}
          </label>
          <div className="pf-rounded-sm border border-accent/20 bg-accent-soft p-2 pf-text-xxs font-mono text-accent break-all select-text">
            {_streamUrl || t('videostream.onvif.noUri', '未获取到流地址')}
          </div>
          {_streamUrl && (
            <div className="flex items-center justify-between gap-3">
              <p className="pf-text-3xs text-text-disabled">
                {t('videostream.onvif.streamHint', '流地址已填入当前会话的播放地址，建议切到对应播放协议继续调试')}
              </p>
              {suggestedPlaybackMode && suggestedPlaybackMode !== "onvif" && playbackModeLabel && onActivatePlaybackMode ? (
                <button
                  onClick={() => onActivatePlaybackMode(suggestedPlaybackMode)}
                  className="shrink-0 h-6 px-2.5 pf-rounded-sm bg-accent/10 text-accent pf-text-3xs font-semibold hover:bg-accent/20 transition-colors"
                >
                  切到 {playbackModeLabel}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* PTZ Control */}
      {deviceInfo && (
        <div className="space-y-1.5">
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            PTZ {t('videostream.gb.control', '控制')}
          </label>
          <div className="flex flex-col items-center gap-1">
            <button onMouseDown={() => handlePtz('up')} onMouseUp={handlePtzStop}
              className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ArrowUp className="w-4 h-4" /></button>
            <div className="flex gap-1">
              <button onMouseDown={() => handlePtz('left')} onMouseUp={handlePtzStop}
                className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
              ><ArrowLeft className="w-4 h-4" /></button>
              <button onClick={handlePtzStop}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-colors"
              ><RotateCcw className="w-3.5 h-3.5" /></button>
              <button onMouseDown={() => handlePtz('right')} onMouseUp={handlePtzStop}
                className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
              ><ArrowRight className="w-4 h-4" /></button>
            </div>
            <button onMouseDown={() => handlePtz('down')} onMouseUp={handlePtzStop}
              className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ArrowDown className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button onMouseDown={() => handlePtz('zoom_in')} onMouseUp={handlePtzStop}
              className="h-7 w-7 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onMouseDown={() => handlePtz('zoom_out')} onMouseUp={handlePtzStop}
              className="h-7 w-7 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ZoomOut className="w-3.5 h-3.5" /></button>
            <span className="pf-text-3xs text-text-disabled ml-1">{t('videostream.gb.speed', '速度')}</span>
            <input type="range" min={1} max={15} value={ptzSpeed} onChange={(e) => setPtzSpeed(Number(e.target.value))} className="w-16 h-1 accent-accent" />
            <span className="pf-text-3xs text-text-disabled w-4">{ptzSpeed}</span>
          </div>
        </div>
      )}

      {/* Presets */}
      {deviceInfo && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {t('videostream.onvif.presets', '预置位')} ({presets.length})
            </label>
            <div className="flex items-center gap-1">
              <button onClick={handleLoadPresets} className="pf-text-3xs text-accent hover:underline">
                {t('videostream.gb.query', '加载')}
              </button>
              <button onClick={() => setShowPresetInput(v => !v)}
                className="h-5 w-5 flex items-center justify-center rounded text-text-disabled hover:text-accent transition-colors"
              ><Plus className="w-3 h-3" /></button>
            </div>
          </div>
          {showPresetInput && (
            <div className="flex gap-1">
              <input value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder={t('videostream.onvif.presetName', '预置位名称')}
                onKeyDown={(e) => e.key === 'Enter' && handleSetPreset()}
                className="wb-field-xs flex-1 font-mono"
              />
              <button onClick={handleSetPreset} className="h-6 px-2 pf-rounded-xs bg-accent/10 text-accent pf-text-xxs hover:bg-accent/20 transition-colors">
                {t('videostream.onvif.save', '保存')}
              </button>
            </div>
          )}
          {presets.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto space-y-0.5 pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 p-1">
              {presets.map((p) => (
                <div key={p.token} className="flex items-center gap-2 px-2 py-1 pf-rounded-xs hover:bg-bg-hover/50 pf-text-xxs transition-colors">
                  <Star className="w-3 h-3 text-amber-500 shrink-0" />
                  <span className="text-text-primary flex-1 truncate">{p.name || `Preset ${p.token}`}</span>
                  <button onClick={() => handleGotoPreset(p.token)} className="text-accent hover:underline shrink-0">
                    {t('videostream.onvif.goto', '转到')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
