// WebRTC 协议配置面板
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";

interface WebRtcPanelProps {
  sessionKey: string;
  connected: boolean;
}

export function WebRtcPanel({ connected }: WebRtcPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'offer' | 'answer'>('offer');
  const [stunServers, setStunServers] = useState(['stun:stun.l.google.com:19302']);
  const [newStun, setNewStun] = useState('');
  const [turnUrl, setTurnUrl] = useState('');
  const [turnUser, setTurnUser] = useState('');
  const [turnPass, setTurnPass] = useState('');
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [iceCandidates] = useState<{ type: string; address: string; port: number; protocol: string; state: string }[]>([]);

  const addStun = () => {
    if (newStun.trim()) {
      setStunServers(prev => [...prev, newStun.trim()]);
      setNewStun('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode: Offer vs Answer */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.webrtc.role', '角色')}
        </label>
        <div className="flex h-7 items-center rounded-[6px] border border-border-default/60 bg-bg-secondary/40 overflow-hidden">
          {(['offer', 'answer'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={connected}
              className={cn(
                "h-full flex-1 text-[var(--fs-xxs)] font-semibold uppercase tracking-wide transition-colors",
                mode === m ? "bg-accent text-white" : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"
              )}
            >
              {m === 'offer' ? 'Offerer' : 'Answerer'}
            </button>
          ))}
        </div>
      </div>

      {/* STUN Servers */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          STUN {t('videostream.webrtc.servers', '服务器')}
        </label>
        <div className="space-y-1">
          {stunServers.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="flex-1 text-[var(--fs-xxs)] font-mono text-text-secondary truncate px-2 py-1 rounded bg-bg-secondary/30">{s}</span>
              <button onClick={() => setStunServers(prev => prev.filter((_, j) => j !== i))} className="text-text-disabled hover:text-red-500 p-0.5">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input value={newStun} onChange={(e) => setNewStun(e.target.value)} placeholder="stun:host:port"
              onKeyDown={(e) => e.key === 'Enter' && addStun()}
              className="h-6 flex-1 rounded-[4px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xxs)] font-mono text-text-primary outline-none focus:border-accent"
            />
            <button onClick={addStun} className="h-6 w-6 flex items-center justify-center rounded-[4px] bg-accent/10 text-accent hover:bg-accent/20"><Plus className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      {/* TURN Server */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          TURN {t('videostream.webrtc.servers', '服务器')}
        </label>
        <input value={turnUrl} onChange={(e) => setTurnUrl(e.target.value)} placeholder="turn:host:port" disabled={connected}
          className="h-7 w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xs)] font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input value={turnUser} onChange={(e) => setTurnUser(e.target.value)} placeholder={t('videostream.rtsp.username', '用户名')} disabled={connected}
            className="h-6 rounded-[4px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xxs)] font-mono text-text-primary outline-none disabled:opacity-50"
          />
          <input type="password" value={turnPass} onChange={(e) => setTurnPass(e.target.value)} placeholder={t('videostream.rtsp.password', '密码')} disabled={connected}
            className="h-6 rounded-[4px] border border-border-default/60 bg-bg-secondary/40 px-2 text-[var(--fs-xxs)] font-mono text-text-primary outline-none disabled:opacity-50"
          />
        </div>
      </div>

      {/* SDP Editor */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {mode === 'offer' ? 'Local SDP (Offer)' : 'Local SDP (Answer)'}
        </label>
        <textarea value={localSdp} onChange={(e) => setLocalSdp(e.target.value)} rows={4} placeholder="v=0\no=- ..."
          className="w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 py-1.5 text-[var(--fs-xxs)] font-mono text-text-secondary outline-none focus:border-accent resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          Remote SDP
        </label>
        <textarea value={remoteSdp} onChange={(e) => setRemoteSdp(e.target.value)} rows={4} placeholder="v=0\no=- ..."
          className="w-full rounded-[6px] border border-border-default/60 bg-bg-secondary/40 px-2 py-1.5 text-[var(--fs-xxs)] font-mono text-text-secondary outline-none focus:border-accent resize-none"
        />
      </div>

      {/* ICE Candidates */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          ICE Candidates ({iceCandidates.length})
        </label>
        <div className="max-h-[120px] overflow-y-auto rounded-[6px] border border-border-default/60 bg-bg-secondary/30 p-1">
          {iceCandidates.length === 0 ? (
            <div className="text-[var(--fs-xs)] text-text-disabled text-center py-4">
              {connected ? t('videostream.webrtc.gatheringIce', '正在收集 ICE 候选...') : t('videostream.webrtc.connectFirst', '连接后开始 ICE 协商')}
            </div>
          ) : (
            iceCandidates.map((c, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 text-[var(--fs-xxs)] font-mono">
                <span className={cn("px-1 rounded text-[var(--fs-3xs)] font-bold",
                  c.type === 'host' ? 'bg-blue-500/10 text-blue-500' : c.type === 'srflx' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                )}>{c.type}</span>
                <span className="text-text-primary">{c.address}:{c.port}</span>
                <span className="text-text-disabled">{c.protocol}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
