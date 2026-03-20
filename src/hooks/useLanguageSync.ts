// settingsStore 语言设置 → i18n.changeLanguage 同步 Hook
// 在 App.tsx 中调用即可

import { useEffect } from 'react';
import i18n from 'i18next';
import { useSettingsStore } from '@/stores/settingsStore';

export function useLanguageSync() {
  const language = useSettingsStore((s) => s.settings.language);

  useEffect(() => {
    // 将 settingsStore 的 'zh-CN' 映射为 i18n 的 'zh'
    const lng = language === 'zh-CN' ? 'zh' : 'en';
    if (i18n.language !== lng) {
      i18n.changeLanguage(lng);
    }
  }, [language]);
}
