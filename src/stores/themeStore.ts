import { create } from 'zustand';

interface ThemeStore {
  theme: 'dark' | 'light';
  toggle: () => void;
  setTheme: (t: 'dark' | 'light') => void;
}

const applyThemeClass = (t: 'dark' | 'light') => {
  document.documentElement.classList.toggle('dark', t === 'dark');
};

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'light',
  toggle: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    applyThemeClass(next);
    return { theme: next };
  }),
  setTheme: (t) => {
    applyThemeClass(t);
    set({ theme: t });
  },
}));
