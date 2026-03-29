// 内置视频播放器
// 支持三种播放模式:
// 1. HLS (.m3u8) — hls.js
// 2. WebSocket (ws://) — 后端 ffmpeg remux 推送 H.264 NAL, 前端用 jmuxer 或 MSE 解码
// 3. 其他格式 — 显示流信息

import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { Play, Pause, Square, Volume2, VolumeX, Maximize, Loader } from "lucide-react";

interface VideoPlayerProps {
  url: string | null;
  protocol?: string;
  onError?: (msg: string) => void;
}

export function VideoPlayer({ url, protocol, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [, setInitReceived] = useState(false);

  const isHls = url ? (url.includes('.m3u8') || protocol === 'hls') : false;
  const isWs = url ? url.startsWith('ws://') : false;

  // Cleanup on unmount or URL change
  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      wsRef.current?.close();
    };
  }, [url]);

  // HLS playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isHls) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 5 });
      hlsRef.current = hls;
      setLoading(true);
      setStatus("加载 HLS...");

      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false); setStatus("");
        video.play().then(() => setPlaying(true)).catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setLoading(false);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setTimeout(() => hls.startLoad(), 2000);
          } else {
            onError?.(`HLS 错误: ${data.details}`);
          }
        }
      });
      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      setLoading(true);
      video.addEventListener("loadedmetadata", () => { setLoading(false); video.play().then(() => setPlaying(true)).catch(() => {}); });
    }
  }, [url, isHls, onError]);

  // WebSocket + MSE playback (H.264 NAL from backend ffmpeg)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !isWs) return;

    setLoading(true);
    setStatus("连接播放器...");
    setInitReceived(false);
    queueRef.current = [];

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    let codec = "avc1.42E01E";
    let extradata: Uint8Array | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let pendingBuffers: ArrayBuffer[] = [];
    let initSegmentSent = false;

    ws.onopen = () => {
      setStatus("等待流数据...");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // JSON init message from backend
        try {
          const info = JSON.parse(event.data);
          if (info.type === "init") {
            setStatus(`${info.codec?.toUpperCase()} ${info.width}x${info.height}`);
            if (info.extradata) {
              extradata = Uint8Array.from(atob(info.extradata), c => c.charCodeAt(0));
            }

            // Parse SPS to get profile/level for codec string
            if (extradata && extradata.length > 4) {
              // avcC format: skip first byte, then SPS starts
              // Simple: use default profile
              const profile = extradata[1] || 0x42;
              const compat = extradata[2] || 0xE0;
              const level = extradata[3] || 0x1E;
              codec = `avc1.${profile.toString(16).padStart(2, '0')}${compat.toString(16).padStart(2, '0')}${level.toString(16).padStart(2, '0')}`;
            }

            setInitReceived(true);

            // Create MediaSource
            mediaSource = new MediaSource();
            mediaSourceRef.current = mediaSource;
            video.src = URL.createObjectURL(mediaSource);

            mediaSource.addEventListener("sourceopen", () => {
              try {
                const mimeType = `video/mp4; codecs="${codec}"`;
                if (!MediaSource.isTypeSupported(mimeType)) {
                  onError?.(`浏览器不支持编码格式: ${mimeType}`);
                  setLoading(false);
                  return;
                }
                sourceBuffer = mediaSource!.addSourceBuffer(mimeType);
                sourceBufferRef.current = sourceBuffer;
                sourceBuffer.mode = "segments";

                sourceBuffer.addEventListener("updateend", () => {
                  if (pendingBuffers.length > 0 && !sourceBuffer!.updating) {
                    sourceBuffer!.appendBuffer(pendingBuffers.shift()!);
                  }
                });

                setLoading(false);
                setStatus("播放中");
              } catch (e) {
                onError?.(`创建 SourceBuffer 失败: ${e}`);
                setLoading(false);
              }
            });
          }
        } catch { /* not JSON, ignore */ }
      } else {
        // Binary frame: 4-byte seq + 8-byte pts + H.264 data
        const buf = event.data as ArrayBuffer;
        if (buf.byteLength < 12) return;

        // For now, we need to wrap H.264 NAL units into fMP4 segments
        // This requires creating proper fMP4 boxes (moof+mdat)
        // Simplified: accumulate data and try to feed to MSE

        if (!initSegmentSent && extradata && sourceBuffer) {
          // Build minimal fMP4 init segment
          const initSeg = buildFmp4Init(extradata, codec);
          if (initSeg) {
            try {
              sourceBuffer.appendBuffer(initSeg);
              initSegmentSent = true;
            } catch { pendingBuffers.push(initSeg); }
          }
        }

        if (initSegmentSent && sourceBuffer) {
          const nalData = new Uint8Array(buf, 12); // skip seq+pts header
          const mediaSeg = buildFmp4Segment(nalData, pendingBuffers.length);
          if (mediaSeg) {
            if (!sourceBuffer.updating) {
              try {
                sourceBuffer.appendBuffer(mediaSeg);
                if (!playing) {
                  video.play().then(() => setPlaying(true)).catch(() => {});
                }
              } catch {
                pendingBuffers.push(mediaSeg);
              }
            } else {
              pendingBuffers.push(mediaSeg);
              // Keep buffer small
              if (pendingBuffers.length > 30) {
                pendingBuffers.splice(0, pendingBuffers.length - 10);
              }
            }
          }
        }
      }
    };

    ws.onerror = () => {
      setStatus("连接失败");
      setLoading(false);
    };

    ws.onclose = () => {
      setStatus("已断开");
      setPlaying(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [url, isWs, onError, playing]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const handleStop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
    wsRef.current?.close();
  }, []);

  // No URL
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

      {/* Loading / Status overlay */}
      {(loading || status) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/70">
            {loading && <Loader className="w-6 h-6 animate-spin" />}
            {status && <span className="text-[var(--fs-xxs)] font-mono">{status}</span>}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={handlePlayPause}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button onClick={handleStop}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>

        <button onClick={() => { setMuted(v => !v); if (videoRef.current) videoRef.current.muted = !muted; }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors ml-1"
        >
          {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>
        <input type="range" min={0} max={100} value={volume}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); if (videoRef.current) { videoRef.current.volume = v / 100; setMuted(v === 0); } }}
          className="w-14 h-0.5 accent-white rounded-full appearance-none bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />

        <div className="flex-1" />

        {status && !loading && (
          <span className="text-[var(--fs-3xs)] text-white/40 font-mono">{status}</span>
        )}

        <button onClick={() => videoRef.current?.requestFullscreen?.()}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-xs)] text-white/60 hover:text-white transition-colors"
        >
          <Maximize className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── fMP4 构建辅助函数（前端侧，用于将 H.264 NAL 封装为 MSE 可播放的 fMP4）──

let _sequenceNumber = 0;

function buildFmp4Init(extradata: Uint8Array, _codec: string): ArrayBuffer | null {
  try {
    // 简化版 fMP4 init segment: ftyp + moov
    // 实际实现需要正确的 box 结构
    // 这里使用一个最小的可工作模板

    const width = 640; // 从 extradata 解析 SPS 可以获取实际值
    const height = 480;

    _sequenceNumber = 0;

    const ftyp = box('ftyp', concat(
      str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41')
    ));

    const avcC = box('avcC', extradata);

    const stbl = box('stbl', concat(
      box('stsd', concat(u32(0), u32(1),
        box('avc1', concat(
          new Uint8Array(6), u16(1),
          new Uint8Array(16),
          u16(width), u16(height),
          u32(0x00480000), u32(0x00480000),
          u32(0), u16(1),
          new Uint8Array(32),
          u16(0x0018), u16(0xFFFF),
          avcC
        ))
      )),
      box('stts', new Uint8Array(8)),
      box('stsc', new Uint8Array(8)),
      box('stsz', new Uint8Array(12)),
      box('stco', new Uint8Array(8))
    ));

    const trak = box('trak', concat(
      box('tkhd', concat(
        u32(0x00000003),
        u32(0), u32(0),
        u32(1), u32(0),
        u32(0),
        new Uint8Array(8),
        u16(0), u16(0),
        u16(0), u16(0),
        new Uint8Array([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x40,0,0,0]),
        u32(width << 16), u32(height << 16)
      )),
      box('mdia', concat(
        box('mdhd', concat(u32(0), u32(0), u32(0), u32(90000), u32(0), u32(0))),
        box('hdlr', concat(u32(0), u32(0), str('vide'), new Uint8Array(12), str('VideoHandler'), new Uint8Array(1))),
        box('minf', concat(
          box('vmhd', concat(u32(0x00000001), new Uint8Array(8))),
          box('dinf', box('dref', concat(u32(0), u32(1), box('url ', new Uint8Array(4))))),
          stbl
        ))
      ))
    ));

    const mvex = box('mvex', box('trex', concat(u32(0), u32(1), u32(1), u32(0), u32(0), u32(0))));

    const moov = box('moov', concat(
      box('mvhd', concat(
        u32(0), u32(0), u32(0), u32(90000), u32(0),
        u32(0x00010000), u16(0x0100), new Uint8Array(10),
        new Uint8Array([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x40,0,0,0]),
        new Uint8Array(24),
        u32(2)
      )),
      trak,
      mvex
    ));

    return concat(ftyp, moov).buffer;
  } catch (e) {
    console.error('buildFmp4Init error:', e);
    return null;
  }
}

function buildFmp4Segment(nalData: Uint8Array, _queueLen: number): ArrayBuffer | null {
  try {
    _sequenceNumber++;
    const seq = _sequenceNumber;

    // moof
    const trun = box('trun', concat(
      u32(0x000201), // flags: data-offset + sample-size
      u32(1), // sample count
      u32(0), // data offset (will be patched)
      u32(nalData.length + 4) // sample size (4-byte length prefix + NAL)
    ));

    const tfhd = box('tfhd', concat(
      u32(0x020000), // flags: default-base-is-moof
      u32(1), // track id
    ));

    const tfdt = box('tfdt', concat(
      u32(0x01000000), // version 1
      u32(0), u32(seq * 3000) // base decode time (64-bit, ~33ms per frame at 30fps)
    ));

    const traf = box('traf', concat(tfhd, tfdt, trun));
    const moof = box('moof', concat(
      box('mfhd', concat(u32(0), u32(seq))),
      traf
    ));

    // Patch data offset in trun (offset from moof start to mdat data)
    const moofBytes = new Uint8Array(moof);
    const dataOffset = moofBytes.length + 8; // +8 for mdat header
    // Find trun data-offset field (after flags + sample_count, at offset 8 in trun payload)
    // This is simplified — in production, calculate exact offset
    const trunOffset = findBoxOffset(moofBytes, 'trun');
    if (trunOffset >= 0) {
      const view = new DataView(moofBytes.buffer);
      view.setUint32(trunOffset + 8 + 8, dataOffset); // flags(4) + sample_count(4) + data_offset position
    }

    // mdat: length-prefixed NAL
    const mdatPayload = concat(u32(nalData.length), nalData);
    const mdat = box('mdat', mdatPayload);

    return concat(new Uint8Array(moofBytes), mdat).buffer;
  } catch (e) {
    console.error('buildFmp4Segment error:', e);
    return null;
  }
}

// ── Box 构建工具 ──

function box(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, size);
  result[4] = type.charCodeAt(0);
  result[5] = type.charCodeAt(1);
  result[6] = type.charCodeAt(2);
  result[7] = type.charCodeAt(3);
  result.set(payload, 8);
  return result;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function u32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value);
  return buf;
}

function u16(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value);
  return buf;
}

function str(s: string): Uint8Array {
  return new Uint8Array(s.split('').map(c => c.charCodeAt(0)));
}

function findBoxOffset(data: Uint8Array, type: string): number {
  const view = new DataView(data.buffer);
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = view.getUint32(offset);
    const t = String.fromCharCode(data[offset+4], data[offset+5], data[offset+6], data[offset+7]);
    if (t === type) return offset;
    if (size < 8) break;
    // Recurse into container boxes
    if (['moof', 'traf', 'moov', 'trak', 'mdia', 'minf'].includes(t)) {
      const inner = findBoxOffset(data.subarray(offset + 8, offset + size), type);
      if (inner >= 0) return offset + 8 + inner;
    }
    offset += size;
  }
  return -1;
}
