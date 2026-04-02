import type { EasyPlayerConstructor } from "@/types/easyplayer";

const EASY_PLAYER_SCRIPT_ID = "protoforge-easyplayer-script";
const EASY_PLAYER_SRC = "/vendor/easyplayer/EasyPlayer-pro.js";

let loadPromise: Promise<EasyPlayerConstructor> | null = null;

function getConstructor(): EasyPlayerConstructor | null {
  return window.EasyPlayerPro ?? window["EasyPlayer-pro"] ?? null;
}

export function loadEasyPlayer(): Promise<EasyPlayerConstructor> {
  const existing = getConstructor();
  if (existing) {
    return Promise.resolve(existing);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<EasyPlayerConstructor>((resolve, reject) => {
    const current = document.getElementById(EASY_PLAYER_SCRIPT_ID) as HTMLScriptElement | null;
    if (current) {
      current.addEventListener("load", () => {
        const ctor = getConstructor();
        if (ctor) resolve(ctor);
        else reject(new Error("EasyPlayer 脚本已加载，但未找到构造函数。"));
      }, { once: true });
      current.addEventListener("error", () => reject(new Error("EasyPlayer 脚本加载失败。")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = EASY_PLAYER_SCRIPT_ID;
    script.src = EASY_PLAYER_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = getConstructor();
      if (ctor) resolve(ctor);
      else reject(new Error("EasyPlayer 脚本已加载，但未找到构造函数。"));
    };
    script.onerror = () => reject(new Error("EasyPlayer 脚本加载失败。"));
    document.head.appendChild(script);
  }).catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}
