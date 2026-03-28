// Generate cURL command from a CollectionItem
import type { CollectionItem } from '@/types/collections';
import { resolveVariableTemplate } from '@/lib/requestVariables';

export function generateCurlFromItem(item: CollectionItem, collectionId?: string | null): string {
  const resolve = (s: string) => collectionId ? resolveVariableTemplate(s, collectionId, item.id) : s;
  const parts: string[] = ['curl'];
  const method = (item.method || 'GET').toUpperCase();

  // Method (omit -X for GET as it's the default)
  if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }

  // Build URL with query params
  let url = resolve(item.url || '');
  try { url = decodeURIComponent(url); } catch { /* keep original */ }
  try {
    if (item.queryParams) {
      const params = JSON.parse(item.queryParams);
      const paramPairs: string[] = [];
      if (Array.isArray(params)) {
        params.filter((p: any) => p.enabled !== false && p.key).forEach((p: any) => {
          paramPairs.push(`${resolve(p.key)}=${resolve(p.value || '')}`);
        });
      } else if (typeof params === 'object') {
        Object.entries(params).forEach(([k, v]) => {
          if (k) paramPairs.push(`${resolve(k)}=${resolve(String(v))}`);
        });
      }
      if (paramPairs.length > 0) {
        const separator = url.includes('?') ? '&' : '?';
        url += separator + paramPairs.join('&');
      }
    }
  } catch { /* ignore parse errors */ }

  // Headers
  try {
    if (item.headers) {
      const headers = JSON.parse(item.headers);
      if (Array.isArray(headers)) {
        headers.filter((h: any) => h.enabled !== false && h.key).forEach((h: any) => {
          parts.push(`-H '${resolve(h.key)}: ${resolve(h.value || '')}'`);
        });
      } else if (typeof headers === 'object') {
        Object.entries(headers).forEach(([k, v]) => {
          if (k) parts.push(`-H '${resolve(k)}: ${resolve(String(v))}'`);
        });
      }
    }
  } catch { /* ignore */ }

  // Auth
  try {
    if (item.authType && item.authType !== 'none' && item.authConfig) {
      const auth = JSON.parse(item.authConfig);
      switch (item.authType) {
        case 'bearer': {
          const token = auth.bearerToken || (Array.isArray(auth.bearer) ? auth.bearer.find((kv: any) => kv.key === 'token')?.value : '') || '';
          if (token) parts.push(`-H 'Authorization: Bearer ${resolve(token)}'`);
          break;
        }
        case 'basic': {
          const user = auth.basicUsername || (Array.isArray(auth.basic) ? auth.basic.find((kv: any) => kv.key === 'username')?.value : '') || '';
          const pass = auth.basicPassword || (Array.isArray(auth.basic) ? auth.basic.find((kv: any) => kv.key === 'password')?.value : '') || '';
          if (user) parts.push(`-u '${resolve(user)}:${resolve(pass)}'`);
          break;
        }
        case 'apikey': {
          const keyName = auth.apiKeyName || '';
          const keyValue = auth.apiKeyValue || '';
          const addTo = auth.apiKeyAddTo || 'header';
          if (keyName && addTo === 'header') {
            parts.push(`-H '${resolve(keyName)}: ${resolve(keyValue)}'`);
          }
          break;
        }
      }
    }
  } catch { /* ignore */ }

  // Body
  try {
    if (item.bodyContent && item.bodyType && item.bodyType !== 'none') {
      const bodyContent = resolve(item.bodyContent);
      switch (item.bodyType) {
        case 'json':
          parts.push(`-H 'Content-Type: application/json'`);
          parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
          break;
        case 'raw':
          parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
          break;
        case 'formUrlencoded': {
          parts.push(`-H 'Content-Type: application/x-www-form-urlencoded'`);
          try {
            const formData = JSON.parse(item.bodyContent);
            if (Array.isArray(formData)) {
              formData.filter((f: any) => f.enabled !== false && f.key).forEach((f: any) => {
                parts.push(`--data-urlencode '${resolve(f.key)}=${resolve(f.value || '')}'`);
              });
            } else {
              parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
            }
          } catch {
            parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
          }
          break;
        }
        case 'formData': {
          try {
            const fields = JSON.parse(item.bodyContent);
            if (Array.isArray(fields)) {
              fields.filter((f: any) => f.enabled !== false && f.key).forEach((f: any) => {
                if (f.type === 'file' || f.fieldType === 'file') {
                  // Support both filePaths array and legacy comma-separated value
                  const paths: string[] = Array.isArray(f.filePaths) && f.filePaths.length > 0
                    ? f.filePaths
                    : (f.value || '').split(',').map((p: string) => p.trim()).filter(Boolean);
                  for (const p of paths) {
                    parts.push(`-F '${resolve(f.key)}=@${p}'`);
                  }
                } else {
                  parts.push(`-F '${resolve(f.key)}=${resolve(f.value || "")}'`);
                }
              });
            }
          } catch {
            parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
          }
          break;
        }
        case 'binary':
          parts.push(`--data-binary '@${item.bodyContent}'`);
          break;
        case 'graphql': {
          parts.push(`-H 'Content-Type: application/json'`);
          try {
            const gql = JSON.parse(item.bodyContent);
            const payload = JSON.stringify({ query: resolve(gql.query || ''), variables: gql.variables || undefined });
            parts.push(`-d '${payload.replace(/'/g, "'\\''")}'`);
          } catch {
            parts.push(`-d '${bodyContent.replace(/'/g, "'\\''")}'`);
          }
          break;
        }
      }
    }
  } catch { /* ignore */ }

  // URL (quoted, placed last)
  parts.push(`'${url}'`);

  return parts.join(' \\\n  ');
}
