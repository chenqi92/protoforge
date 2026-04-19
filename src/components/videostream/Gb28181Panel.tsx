// GB28181 国标协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ChevronRight, ChevronDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, RotateCcw, Video } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";

interface Gb28181PanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
}

export function Gb28181Panel({ sessionKey, streamUrl, onStreamUrlChange }: Gb28181PanelProps) {
  const { t } = useTranslation();
  const [sipServerIp, setSipServerIp] = useState('192.168.1.100');
  const [sipServerPort, setSipServerPort] = useState(5060);
  const [sipDomain, setSipDomain] = useState('3402000000');
  const [deviceId, setDeviceId] = useState('34020000001320000001');
  const [localPort, setLocalPort] = useState(5080);
  const [sipTransport, setSipTransport] = useState<'udp' | 'tcp'>('udp');
  const [registered, setRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [catalogItems, setCatalogItems] = useState<{ id: string; name: string; type: string; status: string }[]>([]);
  const [expandedCatalog, setExpandedCatalog] = useState(false);
  const [ptzSpeed, setPtzSpeed] = useState(5);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [startingLive, setStartingLive] = useState(false);
  const liveActive = streamUrl.trim().startsWith('gb28181+udp://');

  const handleRegister = useCallback(async () => {
    setRegistering(true);
    try {
      await vsSvc.gb28181Register(sessionKey, { sipServerIp, sipServerPort, sipDomain, deviceId, localPort, transport: sipTransport });
      setRegistered(true);
    } catch {}
    setRegistering(false);
  }, [sessionKey, sipServerIp, sipServerPort, sipDomain, deviceId, localPort, sipTransport]);

  const handleQueryCatalog = useCallback(async () => {
    try {
      const result = await vsSvc.gb28181QueryCatalog(sessionKey);
      setCatalogItems(result as unknown as typeof catalogItems);
    } catch {}
  }, [sessionKey]);

  const handlePtz = useCallback(async (command: string) => {
    try {
      await vsSvc.gb28181Ptz(sessionKey, command, ptzSpeed);
    } catch {}
  }, [sessionKey, ptzSpeed]);

  const handleUnregister = useCallback(async () => {
    try {
      await vsSvc.gb28181Unregister(sessionKey);
    } catch {
      // Keep local cleanup even if backend session was already gone.
    }
    setRegistered(false);
    setCatalogItems([]);
    setExpandedCatalog(false);
    setSelectedChannelId('');
    onStreamUrlChange('');
  }, [onStreamUrlChange, sessionKey]);

  const handleStartLive = useCallback(async (channelId?: string) => {
    const targetId = (channelId || selectedChannelId || deviceId).trim();
    if (!targetId) return;

    setStartingLive(true);
    try {
      const mediaUrl = await vsSvc.gb28181StartLive(sessionKey, targetId);
      setSelectedChannelId(targetId);
      onStreamUrlChange(mediaUrl);
    } catch {
      // Errors are surfaced by the shared protocol log and workspace banner.
    }
    setStartingLive(false);
  }, [deviceId, onStreamUrlChange, selectedChannelId, sessionKey]);

  const handleStopLive = useCallback(async () => {
    try {
      await vsSvc.gb28181StopLive(sessionKey);
    } catch {
      // Errors are surfaced by the shared protocol log and workspace banner.
    }
    onStreamUrlChange('');
  }, [onStreamUrlChange, sessionKey]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* SIP Config */}
      <div className="space-y-1.5">
        <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
          SIP {t('videostream.gb.serverConfig', '服务器配置')}
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <span className="pf-text-3xs text-text-disabled">SIP IP</span>
            <input value={sipServerIp} onChange={(e) => setSipServerIp(e.target.value)} disabled={registered}
              className="wb-field-xs w-full font-mono disabled:opacity-50"
            />
          </div>
          <div className="space-y-0.5">
            <span className="pf-text-3xs text-text-disabled">Port</span>
            <input type="number" value={sipServerPort} onChange={(e) => setSipServerPort(Number(e.target.value))} disabled={registered}
              className="wb-field-xs w-full font-mono disabled:opacity-50"
            />
          </div>
        </div>
        <div className="space-y-0.5">
          <span className="pf-text-3xs text-text-disabled">{t('videostream.gb.domain', 'SIP 域')}</span>
          <input value={sipDomain} onChange={(e) => setSipDomain(e.target.value)} disabled={registered}
            className="wb-field-xs w-full font-mono disabled:opacity-50"
          />
        </div>
        <div className="space-y-0.5">
          <span className="pf-text-3xs text-text-disabled">{t('videostream.gb.deviceId', '设备编码')}</span>
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={registered}
            className="wb-field-xs w-full font-mono disabled:opacity-50"
          />
        </div>
        <div className="space-y-0.5">
          <span className="pf-text-3xs text-text-disabled">媒体地址</span>
          <div className="flex gap-1.5">
            <input
              value={streamUrl}
              onChange={(e) => onStreamUrlChange(e.target.value)}
              placeholder="gb28181+udp:// / rtsp:// / http(s):// / ws(s)://"
              className="wb-field-xs w-full font-mono"
            />
            <button
              onClick={() => void handleStartLive()}
              disabled={!registered || startingLive || sipTransport !== 'udp'}
              className="shrink-0 h-7 px-2.5 pf-rounded-sm bg-accent/10 text-accent pf-text-xxs font-semibold hover:bg-accent/20 disabled:opacity-50"
            >
              {startingLive ? '取流中...' : '请求实况'}
            </button>
            <button
              onClick={() => void handleStopLive()}
              disabled={!registered || !liveActive}
              className="shrink-0 h-7 px-2.5 pf-rounded-sm bg-error/10 text-error pf-text-xxs font-semibold hover:bg-error/20 disabled:opacity-50"
            >
              停止实况
            </button>
          </div>
          <p className="pf-text-3xs text-text-disabled leading-relaxed">
            现在可以直接向国标设备发起 `INVITE`，成功后会生成本地 `gb28181+udp://` 媒体入口，顶部播放按钮会把它接入内置网关。
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-0.5">
            <span className="pf-text-3xs text-text-disabled">{t('videostream.gb.localPort', '本地端口')}</span>
            <input type="number" value={localPort} onChange={(e) => setLocalPort(Number(e.target.value))} disabled={registered}
              className="wb-field-xs w-full font-mono disabled:opacity-50"
            />
          </div>
          <div className="shrink-0 space-y-0.5">
            <span className="pf-text-3xs text-text-disabled">{t('videostream.gb.transport', '传输')}</span>
            <SegmentedControl
              value={sipTransport}
              onChange={setSipTransport}
              options={[
                { value: 'udp', label: 'UDP' },
                { value: 'tcp', label: 'TCP' },
              ]}
              disabled={registered}
              size="sm"
            />
          </div>
        </div>
        {sipTransport === 'tcp' && !registered && (
          <p className="pf-text-3xs text-warning leading-relaxed">
            当前 GB28181 只实现了 UDP SIP 注册和 UDP 实况取流，TCP 传输还没有真正接通。
          </p>
        )}
        <button
          onClick={registered ? handleUnregister : handleRegister}
          disabled={registering || (!registered && sipTransport !== 'udp')}
          className={cn("wb-primary-btn w-full px-3",
            registered ? "bg-error hover:bg-error/90" : "bg-accent hover:bg-accent-hover"
          )}
        >
          {registered ? t('videostream.gb.unregister', '注销') : registering ? t('videostream.gb.registering', '注册中...') : t('videostream.gb.register', 'SIP 注册')}
        </button>
      </div>

      {/* Device Catalog */}
      {registered && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button onClick={() => setExpandedCatalog(v => !v)}
              className="flex items-center gap-1 pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled hover:text-text-secondary"
            >
              {expandedCatalog ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {t('videostream.gb.catalog', '设备目录')} ({catalogItems.length})
            </button>
            <button onClick={handleQueryCatalog}
              className="pf-text-3xs text-accent hover:underline"
            >
              {t('videostream.gb.query', '查询')}
            </button>
          </div>
          {expandedCatalog && (
            <div className="max-h-[120px] overflow-y-auto pf-rounded-sm border border-border-default/60 bg-bg-secondary/30 p-1">
              {catalogItems.length === 0 ? (
                <div className="pf-text-xs text-text-disabled text-center py-4">
                  {t('videostream.gb.noCatalog', '点击"查询"获取设备目录')}
                </div>
              ) : (
                catalogItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 pf-text-xxs">
                    <Video className="w-3 h-3 text-accent shrink-0" />
                    <button
                      onClick={() => setSelectedChannelId(item.id)}
                      className={cn(
                        "font-mono text-left truncate",
                        selectedChannelId === item.id ? "text-accent" : "text-text-primary",
                      )}
                    >
                      {item.id}
                    </button>
                    <span className="text-text-tertiary truncate">{item.name}</span>
                    <span className={cn("pf-text-3xs px-1 rounded", item.status === 'ON' ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-300' : 'bg-red-500/10 text-red-400')}>
                      {item.status}
                    </span>
                    <button
                      onClick={() => void handleStartLive(item.id)}
                      disabled={startingLive || item.status !== 'ON'}
                      className="ml-auto shrink-0 pf-text-3xs text-accent hover:underline disabled:opacity-50"
                    >
                      取流
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* PTZ Control */}
      {registered && (
        <div className="space-y-1.5">
          <label className="pf-text-xxs font-semibold uppercase tracking-[0.06em] text-text-disabled">
            PTZ {t('videostream.gb.control', '控制')}
          </label>
          {/* Direction pad */}
          <div className="flex flex-col items-center gap-1">
            <button onMouseDown={() => handlePtz('up')} onMouseUp={() => handlePtz('stop')}
              className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ArrowUp className="w-4 h-4" /></button>
            <div className="flex gap-1">
              <button onMouseDown={() => handlePtz('left')} onMouseUp={() => handlePtz('stop')}
                className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
              ><ArrowLeft className="w-4 h-4" /></button>
              <button onClick={() => handlePtz('stop')}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-300 hover:bg-red-500/20 transition-colors"
              ><RotateCcw className="w-3.5 h-3.5" /></button>
              <button onMouseDown={() => handlePtz('right')} onMouseUp={() => handlePtz('stop')}
                className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
              ><ArrowRight className="w-4 h-4" /></button>
            </div>
            <button onMouseDown={() => handlePtz('down')} onMouseUp={() => handlePtz('stop')}
              className="h-8 w-8 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ArrowDown className="w-4 h-4" /></button>
          </div>
          {/* Zoom */}
          <div className="flex items-center justify-center gap-2">
            <button onMouseDown={() => handlePtz('zoom_in')} onMouseUp={() => handlePtz('stop')}
              className="h-7 w-7 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onMouseDown={() => handlePtz('zoom_out')} onMouseUp={() => handlePtz('stop')}
              className="h-7 w-7 flex items-center justify-center pf-rounded-sm bg-bg-secondary/60 border border-border-default/40 text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            ><ZoomOut className="w-3.5 h-3.5" /></button>
            <div className="flex items-center gap-1.5 ml-2">
              <span className="pf-text-3xs text-text-disabled">{t('videostream.gb.speed', '速度')}</span>
              <input type="range" min={1} max={15} value={ptzSpeed} onChange={(e) => setPtzSpeed(Number(e.target.value))}
                className="w-16 h-1 accent-accent"
              />
              <span className="pf-text-3xs text-text-disabled w-4">{ptzSpeed}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
