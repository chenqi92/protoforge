// ProtoForge HTTP Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HttpRequestConfig, HttpResponse, HttpResponseWithScripts, FormDataField } from '@/types/http';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  buildScopedVariableSnapshot,
  getLinkedCollectionIdForRequestConfig,
  resolveRequestConfigVariables,
} from '@/lib/requestVariables';

function resolveConfigVariables(config: HttpRequestConfig): HttpRequestConfig {
  const collectionId = getLinkedCollectionIdForRequestConfig(config);
  return resolveRequestConfigVariables(config, collectionId);
}

export function resolveHttpConfig(config: HttpRequestConfig): HttpRequestConfig {
  return resolveConfigVariables(config);
}

export function buildRequestPayload(config: HttpRequestConfig) {
  // Headers
  const headers: Record<string, string> = {};
  for (const h of config.headers) {
    if (h.enabled && h.key.trim()) {
      headers[h.key.trim()] = h.value;
    }
  }

  // Query params
  const queryParams: Record<string, string> = {};
  for (const p of config.queryParams) {
    if (p.enabled && p.key.trim()) {
      queryParams[p.key.trim()] = p.value;
    }
  }

  // Body
  let body = null;
  switch (config.requestMode === 'graphql' ? 'graphql' : config.bodyType) {
    case 'raw':
      body = { type: 'raw', content: config.rawBody, contentType: config.rawContentType || 'text/plain' };
      break;
    case 'json':
      body = { type: 'json', data: config.jsonBody };
      break;
    case 'graphql': {
      // GraphQL is sent as JSON with query + variables
      const graphqlPayload: Record<string, unknown> = { query: config.graphqlQuery };
      try {
        const parsed = JSON.parse(config.graphqlVariables || '{}');
        if (parsed && typeof parsed === 'object') graphqlPayload.variables = parsed;
      } catch { /* ignore parse errors */ }
      body = { type: 'json', data: JSON.stringify(graphqlPayload) };
      break;
    }
    case 'formUrlencoded': {
      const fields: Record<string, string> = {};
      for (const f of config.formFields) {
        if (f.enabled && f.key.trim()) {
          fields[f.key.trim()] = f.value;
        }
      }
      body = { type: 'formUrlencoded', fields };
      break;
    }
    case 'formData': {
      const fields: { key: string; value: string; fieldType: string }[] = [];
      for (const f of config.formDataFields) {
        if (f.enabled && f.key.trim()) {
          fields.push({ key: f.key.trim(), value: f.value, fieldType: f.fieldType });
        }
      }
      body = { type: 'formData', fields };
      break;
    }
    case 'binary':
      if (config.binaryFilePath) {
        body = { type: 'binary', filePath: config.binaryFilePath };
      } else {
        body = { type: 'none' };
      }
      break;
    default:
      body = { type: 'none' };
  }

  // Auth
  let auth = null;
  switch (config.authType) {
    case 'bearer':
      auth = { type: 'bearer', token: config.bearerToken };
      break;
    case 'basic':
      auth = { type: 'basic', username: config.basicUsername, password: config.basicPassword };
      break;
    case 'apiKey':
      auth = { type: 'apiKey', key: config.apiKeyName, value: config.apiKeyValue, addTo: config.apiKeyAddTo };
      break;
    case 'oauth2':
      // Use the cached access token as a bearer token
      if (config.oauth2Config.accessToken) {
        auth = { type: 'bearer', token: config.oauth2Config.accessToken };
      }
      break;
  }

  return {
    method: config.method,
    url: config.url,
    headers,
    queryParams,
    body,
    auth,
    timeoutMs: config.timeoutMs,
    followRedirects: config.followRedirects,
  };
}

function buildFinalPayload(payload: ReturnType<typeof buildRequestPayload>) {
  const settings = useSettingsStore.getState().settings;
  return {
    ...payload,
    timeoutMs: payload.timeoutMs || settings.defaultTimeoutMs,
    followRedirects: payload.followRedirects ?? settings.followRedirects,
    sslVerify: settings.sslVerify,
    proxy: settings.proxyEnabled ? {
      type: settings.proxyType,
      host: settings.proxyHost,
      port: settings.proxyPort,
      auth: settings.proxyAuth ? {
        username: settings.proxyUsername,
        password: settings.proxyPassword,
      } : null,
    } : null,
  };
}

export async function sendHttpRequest(config: HttpRequestConfig): Promise<HttpResponse> {
  const resolved = resolveConfigVariables(config);
  const payload = buildRequestPayload(resolved);
  const finalPayload = buildFinalPayload(payload);
  return await invoke<HttpResponse>('send_request', { request: finalPayload });
}

/** Send request with pre/post script execution */
export async function sendRequestWithScripts(config: HttpRequestConfig): Promise<HttpResponseWithScripts> {
  const resolved = resolveConfigVariables(config);
  const payload = buildRequestPayload(resolved);
  const finalPayload = buildFinalPayload(payload);
  const collectionId = getLinkedCollectionIdForRequestConfig(config);
  const envVars = buildScopedVariableSnapshot(collectionId, true);

  return await invoke<HttpResponseWithScripts>('send_request_with_scripts', {
    request: {
      ...finalPayload,
      preScript: config.preScript || null,
      postScript: config.postScript || null,
      envVars: Object.keys(envVars).length > 0 ? envVars : null,
    },
  });
}

// ── File picker helper ──

export async function pickFile(): Promise<{ path: string; name: string } | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      title: '选择文件',
    });
    if (result && typeof result === 'string') {
      const name = result.split(/[\\/]/).pop() || 'file';
      return { path: result, name };
    }
    if (result && typeof result === 'object' && 'path' in result) {
      const r = result as { path: string; name?: string };
      return { path: r.path, name: r.name || r.path.split(/[\\/]/).pop() || 'file' };
    }
    return null;
  } catch {
    return null;
  }
}

/** 选择多个文件 */
export async function pickFiles(): Promise<{ paths: string; names: string } | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: true,
      title: '选择文件',
    });
    if (!result) return null;
    // multiple: true returns string[] or object[]
    if (Array.isArray(result)) {
      const files = result.map(r => {
        if (typeof r === 'string') return { path: r, name: r.split(/[\\/]/).pop() || 'file' };
        if (typeof r === 'object' && r && 'path' in r) {
          const f = r as { path: string; name?: string };
          return { path: f.path, name: f.name || f.path.split(/[\\/]/).pop() || 'file' };
        }
        return null;
      }).filter(Boolean) as { path: string; name: string }[];
      if (files.length === 0) return null;
      return {
        paths: files.map(f => f.path).join(','),
        names: files.map(f => f.name).join(', '),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Re-export for convenience
export type { FormDataField };
