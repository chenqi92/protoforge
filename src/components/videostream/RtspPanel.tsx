// RTSP 协议配置面板
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ChevronDown, Lock, Unlock } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";
import type { RtspConfig } from "@/types/videostream";

interface RtspPanelProps {
  sessionKey: string;
  connected: boolean;
  streamUrl: string;
  onStreamUrlChange: (url: string) => void;
  config: RtspConfig;
  onConfigChange: (config: RtspConfig) => void;
}

export function RtspPanel({ sessionKey, connected, streamUrl: _streamUrl, onStreamUrlChange: _onStreamUrlChange, config, onConfigChange }: RtspPanelProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [sdpContent, setSdpContent] = useState('');
  const [sdpVisible, setSdpVisible] = useState(false);
  const [rtspResponses, setRtspResponses] = useState<{ method: string; status: string; time: string }[]>([]);
  const [executing, setExecuting] = useState('');

  const sendCommand = useCallback(async (method: string) => {
    setExecuting(method);
    try {
      const resp = await vsSvc.rtspCommand(sessionKey, method);
      setRtspResponses(prev => [...prev, {
        method,
        status: resp.includes('200') ? '200 OK' : resp.substring(0, 30),
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      }]);
      if (method === 'DESCRIBE' && resp.includes('v=0')) {
        const sdpStart = resp.indexOf('v=0');
        setSdpContent(resp.substring(sdpStart));
        setSdpVisible(true);
      }
    } catch (err) {
      setRtspResponses(prev => [...prev, {
        method,
        status: `Error: ${err}`,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      }]);
    }
    setExecuting('');
  }, [sessionKey]);

  const rtspMethods = ['DESCRIBE', 'SETUP', 'PLAY', 'PAUSE', 'TEARDOWN'];
  void _streamUrl;
  void _onStreamUrlChange;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Transport */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtsp.transport', '传输方式')}
        </label>
        <SegmentedControl
          value={config.transport}
          onChange={(transport) => onConfigChange({ ...config, transport: transport as RtspConfig["transport"] })}
          options={[
            { value: 'tcp', label: 'TCP' },
            { value: 'udp', label: 'UDP' },
          ]}
          disabled={connected}
        />
      </div>

      {/* Authentication */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtsp.auth', '认证')}
        </label>
        <div className="relative">
          <select
            value={config.authMethod}
            onChange={(e) => onConfigChange({ ...config, authMethod: e.target.value as RtspConfig["authMethod"] })}
            disabled={connected}
            className="h-7 w-full appearance-none rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 pl-2 pr-6 text-[var(--fs-xs)] text-text-primary outline-none cursor-pointer disabled:opacity-50"
          >
            <option value="none">{t('videostream.rtsp.authNone', '无')}</option>
            <option value="basic">Basic</option>
            <option value="digest">Digest</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
        </div>
        {config.authMethod !== 'none' && (
          <div className="space-y-1.5 pt-1">
            <input
              value={config.username}
              onChange={(e) => onConfigChange({ ...config, username: e.target.value })}
              placeholder={t('videostream.rtsp.username', '用户名')}
              disabled={connected}
              className="wb-field-sm w-full font-mono disabled:opacity-50"
            />
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={config.password}
                onChange={(e) => onConfigChange({ ...config, password: e.target.value })}
                placeholder={t('videostream.rtsp.password', '密码')}
                disabled={connected}
                className="wb-field-sm w-full pr-7 font-mono disabled:opacity-50"
              />
              <button
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-disabled hover:text-text-secondary"
              >
                {showPassword ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RTSP Commands */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.rtsp.commands', 'RTSP 命令')}
        </label>
        <div className="flex flex-wrap gap-1">
          {rtspMethods.map((method) => (
            <button
              key={method}
              onClick={() => sendCommand(method)}
              disabled={!connected || executing === method}
              className={cn(
                "h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--fs-xxs)] font-semibold transition-colors",
                method === 'TEARDOWN'
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
                  : "bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {executing === method ? '...' : method}
            </button>
          ))}
        </div>
      </div>

      {/* Command History */}
      {rtspResponses.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
              {t('videostream.rtsp.history', '命令历史')}
            </label>
            <button
              onClick={() => setRtspResponses([])}
              className="text-[var(--fs-3xs)] text-text-disabled hover:text-red-500 transition-colors"
            >
              {t('sidebar.clearAll', '清空')}
            </button>
          </div>
          <div className="max-h-[120px] overflow-y-auto space-y-0.5">
            {rtspResponses.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-[var(--radius-xs)] bg-bg-secondary/30 text-[var(--fs-xxs)] font-mono">
                <span className="text-text-disabled">{r.time}</span>
                <span className="text-accent font-semibold">{r.method}</span>
                <span className={cn("flex-1 truncate", r.status.startsWith('200') ? 'text-emerald-500' : 'text-red-400')}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SDP Viewer */}
      {sdpVisible && sdpContent && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
              SDP
            </label>
            <button
              onClick={() => setSdpVisible(false)}
              className="text-[var(--fs-3xs)] text-text-disabled hover:text-text-secondary"
            >
              {t('videostream.rtsp.hide', '收起')}
            </button>
          </div>
          <pre className="max-h-[200px] overflow-auto rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 p-2 text-[var(--fs-xxs)] font-mono text-text-secondary whitespace-pre-wrap break-all">
            {sdpContent}
          </pre>
        </div>
      )}
    </div>
  );
}
