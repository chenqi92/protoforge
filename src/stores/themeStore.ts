import { create } from 'zustand';

interface ThemeStore {
  theme: 'dark' | 'light';
  toggle: () => void;
  setTheme: (t: 'dark' | 'light') => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'dark',
  toggle: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.className = next === 'light' ? 'light' : '';
    return { theme: next };
  }),
  setTheme: (t) => {
    document.documentElement.className = t === 'light' ? 'light' : '';
    set({ theme: t });
  },
}));
