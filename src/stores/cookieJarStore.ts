// ProtoForge Cookie Jar — persists response cookies for reuse across requests
// Only active when settings.autoSaveCookies is enabled

import { create } from 'zustand';
import type { CookieInfo } from '@/types/http';

interface StoredCookie extends CookieInfo {
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

  /** Clear all stored cookies */
  clear: () => void;

  /** Remove cookies for a specific domain */
  clearDomain: (domain: string) => void;
}

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

export const useCookieJarStore = create<CookieJarStore>((set, get) => ({
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
        const idx = updated.findIndex(
          (c) =>
            c.name === cookie.name &&
            c.domain === effectiveDomain &&
            (c.path || '/') === (cookie.path || '/')
        );

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

  clear: () => set({ cookies: [] }),

  clearDomain: (domain) => {
    const d = domain.toLowerCase().replace(/^\./, '');
    set((state) => ({
      cookies: state.cookies.filter((c) => (c.domain || c.originDomain) !== d),
    }));
  },
}));
