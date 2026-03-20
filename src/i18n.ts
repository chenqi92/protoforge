// i18n 初始化模块
// 支持中/英文切换，默认中文

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from '@/locales/zh.json';
import en from '@/locales/en.json';

// 从 localStorage 读取上次保存的语言偏好
const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('protoforge-language') || 'zh'
  : 'zh';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false, // React 已自动转义
    },
  });

// 监听语言切换并保存到 localStorage
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('protoforge-language', lng);
});

export default i18n;
