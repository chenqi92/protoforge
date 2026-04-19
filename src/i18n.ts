// i18n 初始化模块
// 支持中/英文切换，默认中文
// Only the active language is loaded synchronously; the other is fetched on idle
// so the initial bundle doesn't pay for both locales up-front.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

function readSavedLang(): 'zh' | 'en' {
  try {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('protoforge-language');
      if (v === 'en' || v === 'zh') return v;
    }
  } catch {
    // Tracking Prevention may block localStorage access
  }
  return 'zh';
}

async function loadBundle(lng: 'zh' | 'en'): Promise<Record<string, unknown>> {
  const mod = lng === 'en'
    ? await import('@/locales/en.json')
    : await import('@/locales/zh.json');
  return mod.default as Record<string, unknown>;
}

let initPromise: Promise<typeof i18n> | null = null;

export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;

  const active = readSavedLang();

  initPromise = (async () => {
    const resource = await loadBundle(active);

    await i18n
      .use(initReactI18next)
      .init({
        resources: { [active]: { translation: resource } },
        lng: active,
        // Fallback to the active language so missing keys don't require loading the other bundle at init
        fallbackLng: active,
        interpolation: { escapeValue: false },
      });

    // Pre-load the other language on idle so language-switch is instant
    const other: 'zh' | 'en' = active === 'en' ? 'zh' : 'en';
    const preload = () => {
      loadBundle(other)
        .then((data) => {
          i18n.addResourceBundle(other, 'translation', data);
        })
        .catch(() => {
          // ignore — will be retried on actual language switch
        });
    };
    if (typeof window !== 'undefined') {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (ric) ric(preload); else setTimeout(preload, 1200);
    }

    i18n.on('languageChanged', async (lng) => {
      try {
        localStorage.setItem('protoforge-language', lng);
      } catch {
        // Tracking Prevention may block localStorage access
      }
      if (!i18n.hasResourceBundle(lng, 'translation')) {
        const data = await loadBundle(lng as 'zh' | 'en');
        i18n.addResourceBundle(lng, 'translation', data);
      }
    });

    return i18n;
  })();

  return initPromise;
}

export default i18n;
