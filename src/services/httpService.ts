// ProtoForge HTTP Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HttpRequestConfig, HttpResponse, FormDataField } from '@/types/http';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';

// ── Variable substitution engine ──

/**
 * Replace {{variableName}} placeholders in a string
 * with values from the active environment and global variables.
 */
function resolveVariables(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

function resolveConfigVariables(config: HttpRequestConfig): HttpRequestConfig {
  const vars = useEnvStore.getState().getResolvedVariables();
  if (Object.keys(vars).length === 0) return config;

  return {
    ...config,
    url: resolveVariables(config.url, vars),
    rawBody: resolveVariables(config.rawBody, vars),
    jsonBody: resolveVariables(config.jsonBody, vars),
    bearerToken: resolveVariables(config.bearerToken, vars),
    basicUsername: resolveVariables(config.basicUsername, vars),
    basicPassword: resolveVariables(config.basicPassword, vars),
    apiKeyName: resolveVariables(config.apiKeyName, vars),
    apiKeyValue: resolveVariables(config.apiKeyValue, vars),
    headers: config.headers.map(h => ({
      ...h,
      key: resolveVariables(h.key, vars),
      value: resolveVariables(h.value, vars),
    })),
    queryParams: config.queryParams.map(p => ({
      ...p,
      key: resolveVariables(p.key, vars),
      value: resolveVariables(p.value, vars),
    })),
    formFields: config.formFields.map(f => ({
      ...f,
      key: resolveVariables(f.key, vars),
      value: resolveVariables(f.value, vars),
    })),
    formDataFields: config.formDataFields.map(f => ({
      ...f,
      key: resolveVariables(f.key, vars),
      value: f.fieldType === 'text' ? resolveVariables(f.value, vars) : f.value,
    })),
  };
}

function buildRequestPayload(config: HttpRequestConfig) {
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
  switch (config.bodyType) {
    case 'raw':
      body = { type: 'raw', content: config.rawBody, contentType: config.rawContentType };
      break;
    case 'json':
      body = { type: 'json', data: config.jsonBody };
      break;
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

export async function sendHttpRequest(config: HttpRequestConfig): Promise<HttpResponse> {
  const settings = useSettingsStore.getState().settings;

  // Apply variable substitution before building payload
  const resolved = resolveConfigVariables(config);
  const payload = buildRequestPayload(resolved);

  // Merge global settings as fallback
  const finalPayload = {
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

  return await invoke<HttpResponse>('send_request', { request: finalPayload });
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

// Re-export for convenience
export type { FormDataField };

export async function getEnvironments(): Promise<string[]> {
  return await invoke<string[]>('get_environments');
}

export async function getActiveEnvironment(): Promise<string | null> {
  return await invoke<string | null>('get_active_environment');
}

export async function setActiveEnvironment(name: string | null): Promise<void> {
  await invoke('set_active_environment', { name });
}

export async function getEnvironmentVariables(name: string): Promise<Record<string, string>> {
  return await invoke<Record<string, string>>('get_environment_variables', { name });
}

export async function saveEnvironment(name: string, variables: Record<string, string>): Promise<void> {
  await invoke('save_environment', { name, variables });
}

export async function deleteEnvironment(name: string): Promise<void> {
  await invoke('delete_environment', { name });
}
