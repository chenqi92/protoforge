import type { KeyValue } from "@/types/http";

function decodeQueryComponent(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

export function parseQueryStringToParams(query: string): KeyValue[] {
  if (!query) return [];

  return query
    .split("&")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const equalsIndex = segment.indexOf("=");
      const rawKey = equalsIndex >= 0 ? segment.slice(0, equalsIndex) : segment;
      const rawValue = equalsIndex >= 0 ? segment.slice(equalsIndex + 1) : "";
      return {
        key: decodeQueryComponent(rawKey),
        value: decodeQueryComponent(rawValue),
        enabled: true,
      };
    });
}

export function buildRawQueryString(params: KeyValue[]): string {
  return params
    .filter((param) => param.key.trim() && param.enabled)
    .map((param) => `${param.key}=${param.value}`)
    .join("&");
}

export function joinUrlWithParams(url: string, params: KeyValue[]): string {
  const qIndex = url.indexOf("?");
  const baseUrl = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const query = buildRawQueryString(params);
  return query ? `${baseUrl}?${query}` : baseUrl;
}
