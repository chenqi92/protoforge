import { create } from 'zustand';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeStore {
  mode: ThemeMode;        // user preference
  resolved: 'dark' | 'light';  // effective theme
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(t: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  // Listen for system theme changes
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const state = get();
      if (state.mode === 'system') {
        const resolved = getSystemTheme();
        applyThemeClass(resolved);
        set({ resolved });
      }
    });
  } catch { /* SSR safe */ }

  return {
    mode: 'light',
    resolved: 'light',
    toggle: () => set((s) => {
      const modes: ThemeMode[] = ['light', 'dark', 'system'];
      const nextIdx = (modes.indexOf(s.mode) + 1) % modes.length;
      const nextMode = modes[nextIdx];
      const resolved = nextMode === 'system' ? getSystemTheme() : nextMode;
      applyThemeClass(resolved);
      return { mode: nextMode, resolved };
    }),
    setMode: (m) => {
      const resolved = m === 'system' ? getSystemTheme() : m;
      applyThemeClass(resolved);
      set({ mode: m, resolved });
    },
  };
});
