// ProtoForge Cookie Jar — persists response cookies for reuse across requests
// Only active when settings.autoSaveCookies is enabled

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { CookieInfo } from '@/types/http';

export interface StoredCookie extends CookieInfo {
  /** Origin domain from the response URL */
  originDomain: string;
  /** Timestamp when stored (ms) */
  storedAt: number;
}

interface CookieJarStore {
  cookies: StoredCookie[];

  /** Store cookies from a response. Replaces existing cookies with the same name+domain+path. */
  saveCookies: (responseUrl: string, cookies: CookieInfo[]) => void;

  /** Get cookies matching a request URL (domain + path matching per RFC 6265) */
  getCookiesForUrl: (url: string) => StoredCookie[];

  /** Build a Cookie header value for a request URL */
  buildCookieHeader: (url: string) => string;

  /** Add a single cookie manually */
  addCookie: (cookie: StoredCookie) => void;

  /** Update an existing cookie identified by original name+domain+path */
  updateCookie: (
    key: { name: string; domain: string; path: string },
    updated: StoredCookie,
  ) => void;

  /** Remove a single cookie by name+domain+path */
  removeCookie: (name: string, domain: string, path: string) => void;

  /** Clear all stored cookies */
  clear: () => void;

  /** Remove cookies for a specific domain */
  clearDomain: (domain: string) => void;
}

// Safe storage adapter: falls back to in-memory if localStorage is blocked (WebView2)
const memoryStore = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return memoryStore.get(name) ?? null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      memoryStore.set(name, value);
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      memoryStore.delete(name);
    }
  },
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

function isExpired(cookie: StoredCookie): boolean {
  if (!cookie.expires) return false;
  try {
    return new Date(cookie.expires).getTime() < Date.now();
  } catch {
    return false;
  }
}

function domainMatches(cookieDomain: string, requestHost: string): boolean {
  const cd = cookieDomain.toLowerCase().replace(/^\./, '');
  const rh = requestHost.toLowerCase();
  return rh === cd || rh.endsWith('.' + cd);
}

function pathMatches(cookiePath: string | null, requestPath: string): boolean {
  const cp = cookiePath || '/';
  if (requestPath === cp) return true;
  if (requestPath.startsWith(cp)) {
    return cp.endsWith('/') || requestPath[cp.length] === '/';
  }
  return false;
}

function cookieKey(c: { name: string; domain: string | null; path: string | null }) {
  return `${c.name}\0${(c.domain || '').toLowerCase()}\0${c.path || '/'}`;
}

export const useCookieJarStore = create<CookieJarStore>()(
  persist(
    (set, get) => ({
      cookies: [],

      saveCookies: (responseUrl, cookies) => {
        if (!cookies.length) return;
        const originDomain = extractDomain(responseUrl);
        if (!originDomain) return;
        const now = Date.now();

        set((state) => {
          let updated = [...state.cookies];

          for (const cookie of cookies) {
            const effectiveDomain = cookie.domain
              ? cookie.domain.toLowerCase().replace(/^\./, '')
              : originDomain;

            // Validate: cookie domain must be a suffix of the origin
            if (!domainMatches(effectiveDomain, originDomain) && effectiveDomain !== originDomain) {
              continue;
            }

            const stored: StoredCookie = {
              ...cookie,
              domain: effectiveDomain,
              originDomain,
              storedAt: now,
            };

            // Replace existing cookie with same name+domain+path
            const key = cookieKey(stored);
            const idx = updated.findIndex((c) => cookieKey(c) === key);

            if (idx >= 0) {
              updated[idx] = stored;
            } else {
              updated.push(stored);
            }
          }

          // Evict expired cookies
          updated = updated.filter((c) => !isExpired(c));

          return { cookies: updated };
        });
      },

      getCookiesForUrl: (url) => {
        const host = extractDomain(url);
        const path = extractPath(url);
        if (!host) return [];

        return get().cookies.filter((c) => {
          if (isExpired(c)) return false;
          const cd = c.domain || c.originDomain;
          if (!domainMatches(cd, host)) return false;
          if (!pathMatches(c.path, path)) return false;
          // Secure cookies only over HTTPS
          if (c.secure) {
            try {
              if (new URL(url).protocol !== 'https:') return false;
            } catch {
              return false;
            }
          }
          return true;
        });
      },

      buildCookieHeader: (url) => {
        const matching = get().getCookiesForUrl(url);
        if (!matching.length) return '';
        return matching.map((c) => `${c.name}=${c.value}`).join('; ');
      },

      addCookie: (cookie) => {
        set((state) => {
          const key = cookieKey(cookie);
          const idx = state.cookies.findIndex((c) => cookieKey(c) === key);
          if (idx >= 0) {
            // Replace if same key exists
            const updated = [...state.cookies];
            updated[idx] = cookie;
            return { cookies: updated };
          }
          return { cookies: [...state.cookies, cookie] };
        });
      },

      updateCookie: (key, updated) => {
        set((state) => {
          const oldKey = `${key.name}\0${key.domain.toLowerCase()}\0${key.path || '/'}`;
          const idx = state.cookies.findIndex((c) => cookieKey(c) === oldKey);
          if (idx < 0) return state;
          const list = [...state.cookies];
          list[idx] = updated;
          return { cookies: list };
        });
      },

      removeCookie: (name, domain, path) => {
        const target = `${name}\0${domain.toLowerCase()}\0${path || '/'}`;
        set((state) => ({
          cookies: state.cookies.filter((c) => cookieKey(c) !== target),
        }));
      },

      clear: () => set({ cookies: [] }),

      clearDomain: (domain) => {
        const d = domain.toLowerCase().replace(/^\./, '');
        set((state) => ({
          cookies: state.cookies.filter((c) => (c.domain || c.originDomain) !== d),
        }));
      },
    }),
    {
      name: 'protoforge-cookie-jar',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
    },
  ),
);
