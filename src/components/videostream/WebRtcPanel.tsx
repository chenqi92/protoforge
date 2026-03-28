// WebRTC 协议配置面板
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Plus, Trash2 } from "lucide-react";
import * as vsSvc from "@/services/videoStreamService";

interface WebRtcPanelProps {
  sessionKey: string;
  connected: boolean;
}

export function WebRtcPanel({ sessionKey, connected }: WebRtcPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'offer' | 'answer'>('offer');
  const [stunServers, setStunServers] = useState(['stun:stun.l.google.com:19302']);
  const [newStun, setNewStun] = useState('');
  const [turnUrl, setTurnUrl] = useState('');
  const [turnUser, setTurnUser] = useState('');
  const [turnPass, setTurnPass] = useState('');
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [iceCandidates, setIceCandidates] = useState<{ type: string; address: string; port: number; protocol: string; state: string }[]>([]);
  const [creating, setCreating] = useState(false);

  // Listen for ICE candidate events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    vsSvc.onStreamEvent((e) => {
      if (e.sessionId === sessionKey && e.eventType === 'protocol-data' && e.data) {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'ice-candidate' && data.candidate) {
            setIceCandidates(prev => [...prev, data.candidate]);
          }
        } catch { /* */ }
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [sessionKey]);

  const addStun = () => {
    if (newStun.trim()) {
      setStunServers(prev => [...prev, newStun.trim()]);
      setNewStun('');
    }
  };

  const handleCreateOffer = useCallback(async () => {
    setCreating(true);
    setIceCandidates([]);
    try {
      const turnServers = turnUrl ? [{ url: turnUrl, username: turnUser, credential: turnPass }] : [];
      const sdp = await vsSvc.webrtcCreateOffer(sessionKey, {
        stunServers,
        turnServers,
        mode,
      });
      setLocalSdp(sdp);
    } catch { /* */ }
    setCreating(false);
  }, [sessionKey, stunServers, turnUrl, turnUser, turnPass, mode]);

  const handleSetAnswer = useCallback(async () => {
    if (!remoteSdp.trim()) return;
    try {
      await vsSvc.webrtcSetAnswer(sessionKey, remoteSdp);
    } catch { /* */ }
  }, [sessionKey, remoteSdp]);

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Mode: Offer vs Answer */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {t('videostream.webrtc.role', '角色')}
        </label>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'offer', label: 'Offerer' },
            { value: 'answer', label: 'Answerer' },
          ]}
          disabled={connected}
        />
      </div>

      {/* STUN Servers */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          STUN {t('videostream.webrtc.servers', '服务器')}
        </label>
        <div className="space-y-1">
          {stunServers.map((s, i) => (
            <div key={i} className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate rounded bg-bg-secondary/30 px-2 py-1 text-[var(--fs-xxs)] font-mono text-text-secondary">{s}</span>
              <button onClick={() => setStunServers(prev => prev.filter((_, j) => j !== i))} className="text-text-disabled hover:text-red-500 p-0.5">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex min-w-0 gap-1">
            <input value={newStun} onChange={(e) => setNewStun(e.target.value)} placeholder="stun:host:port"
              onKeyDown={(e) => e.key === 'Enter' && addStun()}
              className="wb-field-xs min-w-0 flex-1 font-mono"
            />
            <button onClick={addStun} className="h-6 w-6 flex items-center justify-center rounded-[var(--radius-xs)] bg-accent/10 text-accent hover:bg-accent/20"><Plus className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      {/* TURN Server */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          TURN {t('videostream.webrtc.servers', '服务器')}
        </label>
        <input value={turnUrl} onChange={(e) => setTurnUrl(e.target.value)} placeholder="turn:host:port" disabled={connected}
          className="wb-field-sm w-full font-mono disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input value={turnUser} onChange={(e) => setTurnUser(e.target.value)} placeholder={t('videostream.rtsp.username', '用户名')} disabled={connected}
            className="wb-field-xs font-mono disabled:opacity-50"
          />
          <input type="password" value={turnPass} onChange={(e) => setTurnPass(e.target.value)} placeholder={t('videostream.rtsp.password', '密码')} disabled={connected}
            className="wb-field-xs font-mono disabled:opacity-50"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
          <button onClick={handleCreateOffer} disabled={creating}
            className="btn-ghost-action flex-1">
            {creating ? '生成中...' : mode === 'offer' ? 'Create Offer' : 'Create Answer'}
          </button>
          <button onClick={handleSetAnswer} disabled={!remoteSdp.trim()}
            className="btn-ghost-action flex-1">
            Set Remote SDP
          </button>
      </div>

      {/* SDP Editor */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          {mode === 'offer' ? 'Local SDP (Offer)' : 'Local SDP (Answer)'}
        </label>
        <textarea value={localSdp} onChange={(e) => setLocalSdp(e.target.value)} rows={4} placeholder="v=0\no=- ..."
          className="w-full rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-2 py-1.5 text-[var(--fs-xxs)] font-mono text-text-secondary outline-none focus:border-accent resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          Remote SDP
        </label>
        <textarea value={remoteSdp} onChange={(e) => setRemoteSdp(e.target.value)} rows={4} placeholder="v=0\no=- ..."
          className="w-full rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/40 px-2 py-1.5 text-[var(--fs-xxs)] font-mono text-text-secondary outline-none focus:border-accent resize-none"
        />
      </div>

      {/* ICE Candidates */}
      <div className="space-y-1.5">
        <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
          ICE Candidates ({iceCandidates.length})
        </label>
        <div className="max-h-[120px] overflow-y-auto rounded-[var(--radius-sm)] border border-border-default/60 bg-bg-secondary/30 p-1">
          {iceCandidates.length === 0 ? (
            <div className="text-[var(--fs-xs)] text-text-disabled text-center py-4">
              {t('videostream.webrtc.connectFirst', '点击 Create Offer 开始 ICE 收集')}
            </div>
          ) : (
            iceCandidates.map((c, i) => (
              <div key={i} className="flex min-w-0 items-center gap-2 px-2 py-1 text-[var(--fs-xxs)] font-mono">
                <span className={cn("px-1 rounded text-[var(--fs-3xs)] font-bold",
                  c.type === 'host' ? 'bg-blue-500/10 text-blue-500' : c.type === 'srflx' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                )}>{c.type}</span>
                <span className="min-w-0 flex-1 truncate text-text-primary">{c.address}:{c.port}</span>
                <span className="shrink-0 text-text-disabled">{c.protocol}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
