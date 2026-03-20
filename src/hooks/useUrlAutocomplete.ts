// URL 历史自动补全 Hook
// 从 history 表查询 URL 建议

import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface HistoryEntry {
  url: string;
  method: string;
}

export function useUrlAutocomplete() {
  const [suggestions, setSuggestions] = useState<HistoryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const history = await invoke<{ url: string; method: string }[]>('list_history', { limit: 200 });
        const q = query.toLowerCase();
        const seen = new Set<string>();
        const matched = history
          .filter(h => {
            if (seen.has(h.url)) return false;
            seen.add(h.url);
            return h.url.toLowerCase().includes(q);
          })
          .slice(0, 8);
        setSuggestions(matched);
        setShowSuggestions(matched.length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
  }, []);

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return { suggestions, showSuggestions, search, closeSuggestions };
}
