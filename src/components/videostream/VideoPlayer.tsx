// 内置视频播放器
// HLS: hls.js 直接播放
// RTSP/RTMP/其他: 后端 ffmpeg 读取 → Tauri 事件推送 H.264 帧 → MSE 播放

import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { listen } from "@tauri-apps/api/event";
import { Play, Pause, Square, Volume2, VolumeX, Maximize, Loader } from "lucide-react";

interface VideoPlayerProps {
  url: string | null; // "hls:https://..." or "tauri:rtsp://..." or direct URL
  sessionId: string;
  onError?: (msg: string) => void;
}

interface InitEvent {
  sessionId: string;
  codec: string;
  width: number;
  height: number;
  extradata: string; // base64
}

interface FrameEvent {
  sessionId: string;
  seq: number;
  pts: number;
  isKey: boolean;
  data: string; // base64
}

export function VideoPlayer({ url, sessionId, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const isHls = url?.startsWith("hls:") ?? false;
  const isTauri = url?.startsWith("tauri:") ?? false;

  // Cleanup
  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  // HLS playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isHls) return;

    const hlsUrl = url.slice(4); // remove "hls:" prefix
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 5 });
      hlsRef.current = hls;
      setLoading(true);
      setStatus("加载 HLS...");
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false); setStatus("");
        video.play().then(() => setPlaying(true)).catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { setLoading(false); onError?.(`HLS: ${data.details}`); }
      });
      return () => { hls.destroy(); hlsRef.current = null; };
    }
  }, [url, isHls, onError]);

  // Tauri event playback (ffmpeg backend → MSE)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isTauri) return;

    let cancelled = false;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let pendingBuffers: ArrayBuffer[] = [];
    let initDone = false;
    let unlistenInit: (() => void) | null = null;
    let unlistenFrame: (() => void) | null = null;

    setLoading(true);
    setStatus("等待流数据...");

    async function setup() {
      // Listen for init event (codec info)
      unlistenInit = await listen<InitEvent>("player-init", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;
        const { width, height, extradata: edB64 } = event.payload;

        setStatus(`H.264 ${width}x${height}`);

        // Decode extradata
        const edBytes = Uint8Array.from(atob(edB64), c => c.charCodeAt(0));

        // Parse avcC to get codec string
        let codec = "avc1.42E01E";
        if (edBytes.length >= 4) {
          const p = edBytes[1] || 0x42;
          const c2 = edBytes[2] || 0xE0;
          const l = edBytes[3] || 0x1E;
          codec = `avc1.${p.toString(16).padStart(2,'0')}${c2.toString(16).padStart(2,'0')}${l.toString(16).padStart(2,'0')}`;
        }

        // Create MSE
        mediaSource = new MediaSource();
        video!.src = URL.createObjectURL(mediaSource);

        mediaSource.addEventListener("sourceopen", () => {
          try {
            const mime = `video/mp4; codecs="${codec}"`;
            if (!MediaSource.isTypeSupported(mime)) {
              onError?.(`不支持的编码: ${mime}`);
              setLoading(false);
              return;
            }
            sourceBuffer = mediaSource!.addSourceBuffer(mime);
            sourceBuffer.mode = "segments";
            sourceBuffer.addEventListener("updateend", () => {
              if (pendingBuffers.length > 0 && sourceBuffer && !sourceBuffer.updating) {
                sourceBuffer.appendBuffer(pendingBuffers.shift()!);
              }
            });

            // Build and append init segment
            const initSeg = buildFmp4Init(edBytes, width, height);
            sourceBuffer.appendBuffer(initSeg);
            initDone = true;
            setLoading(false);
            setStatus("播放中");
          } catch (e) {
            onError?.(`MSE 错误: ${e}`);
            setLoading(false);
          }
        });
      });

      // Listen for frame events
      let frameSeq = 0;
      unlistenFrame = await listen<FrameEvent>("player-frame", (event) => {
        if (cancelled || event.payload.sessionId !== sessionId) return;
        if (!initDone || !sourceBuffer) return;

        const { data: dataB64, isKey } = event.payload;
        const nalData = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));

        frameSeq++;
        const mediaSeg = buildFmp4Segment(nalData, frameSeq, isKey);

        if (!sourceBuffer.updating) {
          try {
            sourceBuffer.appendBuffer(mediaSeg);
            if (!playing && video) {
              video.play().then(() => setPlaying(true)).catch(() => {});
            }
          } catch {
            pendingBuffers.push(mediaSeg);
          }
        } else {
          pendingBuffers.push(mediaSeg);
          if (pendingBuffers.length > 30) pendingBuffers.splice(0, 20);
        }
      });
    }

    setup();

    return () => {
      cancelled = true;
      unlistenInit?.();
      unlistenFrame?.();
    };
  }, [url, isTauri, sessionId, onError, playing]);

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); }
    else { v.pause(); setPlaying(false); }
  }, []);

  const handleStop = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  if (!url) {
    return (
      <div className="h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-white/30">
          <Play className="w-6 h-6" />
          <span className="text-[var(--fs-xxs)]">获取流地址后播放</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-black rounded-[var(--radius-md)] overflow-hidden flex flex-col">
      <video ref={videoRef} className="flex-1 w-full bg-black object-contain" playsInline muted={muted} />

      {(loading || status) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/70">
            {loading && <Loader className="w-6 h-6 animate-spin" />}
            {status && <span className="text-[var(--fs-xxs)] font-mono">{status}</span>}
          </div>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={handlePlayPause}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>
        <button onClick={handleStop}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        ><Square className="w-3 h-3" /></button>

        <button onClick={() => { setMuted(v => !v); if (videoRef.current) videoRef.current.muted = !muted; }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors ml-1"
        >{muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}</button>
        <input type="range" min={0} max={100} value={volume}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (videoRef.current) { videoRef.current.volume = v / 100; setMuted(v === 0); } }}
          className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
        <div className="flex-1" />
        {status && !loading && <span className="text-[var(--fs-3xs)] text-white/40 font-mono">{status}</span>}
        <button onClick={() => videoRef.current?.requestFullscreen?.()}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors"
        ><Maximize className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// ── fMP4 工具函数 ──

// sequence counter for fMP4 segments (module-level)

function buildFmp4Init(extradata: Uint8Array, width: number, height: number): ArrayBuffer {
  const ftyp = fbox('ftyp', cat(s('isom'), u4(0x200), s('isom'), s('iso2'), s('avc1'), s('mp41')));
  const avcC = fbox('avcC', extradata);
  const stbl = fbox('stbl', cat(
    fbox('stsd', cat(u4(0), u4(1), fbox('avc1', cat(new Uint8Array(6), u2(1), new Uint8Array(16), u2(width), u2(height), u4(0x00480000), u4(0x00480000), u4(0), u2(1), new Uint8Array(32), u2(0x0018), u2(0xFFFF), avcC)))),
    fbox('stts', new Uint8Array(8)), fbox('stsc', new Uint8Array(8)), fbox('stsz', new Uint8Array(12)), fbox('stco', new Uint8Array(8))
  ));
  const trak = fbox('trak', cat(
    fbox('tkhd', cat(u4(3), u4(0), u4(0), u4(1), u4(0), u4(0), new Uint8Array(8), u2(0), u2(0), u2(0), u2(0), new Uint8Array([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x40,0,0,0]), u4(width<<16), u4(height<<16))),
    fbox('mdia', cat(
      fbox('mdhd', cat(u4(0), u4(0), u4(0), u4(90000), u4(0), u4(0))),
      fbox('hdlr', cat(u4(0), u4(0), s('vide'), new Uint8Array(12), s('VideoHandler'), new Uint8Array(1))),
      fbox('minf', cat(fbox('vmhd', cat(u4(1), new Uint8Array(8))), fbox('dinf', fbox('dref', cat(u4(0), u4(1), fbox('url ', new Uint8Array(4))))), stbl))
    ))
  ));
  const moov = fbox('moov', cat(
    fbox('mvhd', cat(u4(0), u4(0), u4(0), u4(90000), u4(0), u4(0x00010000), u2(0x0100), new Uint8Array(10), new Uint8Array([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x40,0,0,0]), new Uint8Array(24), u4(2))),
    trak,
    fbox('mvex', fbox('trex', cat(u4(0), u4(1), u4(1), u4(0), u4(0), u4(0))))
  ));
  return cat(ftyp, moov).buffer;
}

function buildFmp4Segment(nalData: Uint8Array, seq: number, _isKey: boolean): ArrayBuffer {
  const trun = fbox('trun', cat(u4(0x000201), u4(1), u4(0), u4(nalData.length + 4)));
  const tfhd = fbox('tfhd', cat(u4(0x020000), u4(1)));
  const tfdt = fbox('tfdt', cat(u4(0x01000000), u4(0), u4(seq * 3000)));
  const traf = fbox('traf', cat(tfhd, tfdt, trun));
  const moof = fbox('moof', cat(fbox('mfhd', cat(u4(0), u4(seq))), traf));
  const mb = new Uint8Array(moof);
  // Patch data offset
  const trunOff = findBox(mb, 'trun');
  if (trunOff >= 0) new DataView(mb.buffer).setUint32(trunOff + 16, mb.length + 8);
  const mdat = fbox('mdat', cat(u4(nalData.length), nalData));
  return cat(mb, mdat).buffer;
}

function fbox(type: string, payload: Uint8Array): Uint8Array {
  const r = new Uint8Array(8 + payload.length);
  new DataView(r.buffer).setUint32(0, r.length);
  r[4]=type.charCodeAt(0); r[5]=type.charCodeAt(1); r[6]=type.charCodeAt(2); r[7]=type.charCodeAt(3);
  r.set(payload, 8); return r;
}
function cat(...a: Uint8Array[]): Uint8Array { const t=a.reduce((s,x)=>s+x.length,0); const r=new Uint8Array(t); let o=0; for(const x of a){r.set(x,o);o+=x.length;} return r; }
function u4(v: number): Uint8Array { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,v); return b; }
function u2(v: number): Uint8Array { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,v); return b; }
function s(v: string): Uint8Array { return new Uint8Array(v.split('').map(c=>c.charCodeAt(0))); }
function findBox(d: Uint8Array, type: string): number {
  const v=new DataView(d.buffer); let o=0;
  while(o+8<=d.length) { const sz=v.getUint32(o); const t=String.fromCharCode(d[o+4],d[o+5],d[o+6],d[o+7]);
    if(t===type) return o; if(sz<8) break;
    if(['moof','traf','moov','trak','mdia','minf'].includes(t)){const i=findBox(d.subarray(o+8,o+sz),type);if(i>=0)return o+8+i;} o+=sz;} return -1;
}
