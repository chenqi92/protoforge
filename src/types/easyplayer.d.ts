export interface EasyPlayerOperateButtons {
  fullscreen?: boolean;
  screenshot?: boolean;
  play?: boolean;
  audio?: boolean;
  record?: boolean;
  stretch?: boolean;
  zoom?: boolean;
  quality?: boolean;
  ptz?: boolean;
}

export interface EasyPlayerPlaybackConfig {
  showRateBtn?: boolean;
  rateConfig?: Array<{ label: string; value: number }>;
  showControl?: boolean;
}

export interface EasyPlayerOptions {
  isLive?: boolean;
  hasAudio?: boolean;
  muted?: boolean;
  stretch?: boolean;
  supportHls265?: boolean;
  loadingTimeout?: number;
  loadingTimeoutReplayTimes?: number;
  useMSE?: boolean;
  useWCS?: boolean;
  useWasm?: boolean;
  autoWasm?: boolean;
  useSIMD?: boolean;
  showBandwidth?: boolean;
  showPerformance?: boolean;
  supportDblclickFullscreen?: boolean;
  hasControl?: boolean;
  controlAutoHide?: boolean;
  operateBtns?: EasyPlayerOperateButtons;
  playbackConfig?: EasyPlayerPlaybackConfig;
  watermarkConfig?: {
    text?: {
      content?: string;
      color?: string;
      opacity?: number;
      fontSize?: number;
    };
    right?: number;
    top?: number;
  };
  debug?: boolean;
}

export interface EasyPlayerInstance {
  play(url: string): Promise<void>;
  playback?(url: string): Promise<void>;
  pause?(): void;
  setMute?(muted: boolean): void;
  setRate?(rate: number): void;
  screenshot?(
    filename?: string,
    format?: "png" | "jpeg" | "webp",
    quality?: number,
    type?: "download" | "base64" | "blob",
  ): string | Blob | Promise<string | Blob>;
  destroy?(): void | Promise<void>;
  setFullscreen?(): void;
  exitFullscreen?(): void;
  on?(event: string, cb: (payload?: unknown) => void): void;
  off?(event: string, cb: (payload?: unknown) => void): void;
}

export interface EasyPlayerConstructor {
  new (container: HTMLElement, options?: EasyPlayerOptions): EasyPlayerInstance;
}

declare global {
  interface Window {
    EasyPlayerPro?: EasyPlayerConstructor;
    "EasyPlayer-pro"?: EasyPlayerConstructor;
  }
}

export {};
