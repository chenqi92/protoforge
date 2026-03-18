// ProtoForge HTTP Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HttpRequestConfig, HttpResponse, KeyValue } from '@/types/http';

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
  const payload = buildRequestPayload(config);
  return await invoke<HttpResponse>('send_request', { request: payload });
}

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
