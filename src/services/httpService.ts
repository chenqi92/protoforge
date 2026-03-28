// ProtoForge HTTP Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { HttpRequestConfig, HttpResponse, HttpResponseWithScripts, FormDataField, CookieInfo, ScriptRequestPatch, ScriptResult } from '@/types/http';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  getActiveEnvironmentVariableMap,
  buildScopedVariableSnapshotFromMaps,
  getCollectionVariableMap,
  getFolderVariableMap,
  getGlobalVariableMap,
  getLinkedCollectionIdForRequestConfig,
  getLinkedCollectionItemIdForRequestConfig,
  resolveRequestConfigVariables,
} from '@/lib/requestVariables';
import { ensureAutoHeaders } from '@/types/http';
import { usePluginStore } from '@/stores/pluginStore';
import * as pluginService from '@/services/pluginService';

function resolveConfigVariables(config: HttpRequestConfig, scopeSnapshot?: Record<string, string>): HttpRequestConfig {
  const collectionId = getLinkedCollectionIdForRequestConfig(config);
  const itemId = getLinkedCollectionItemIdForRequestConfig(config);
  const resolved = resolveRequestConfigVariables(config, collectionId, itemId, scopeSnapshot);
  resolved.headers = ensureAutoHeaders(resolved.headers);
  return resolved;
}

/** 如果 URL 没有协议前缀，自动补全 http:// */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  // 已经带协议前缀的直接返回
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function resolveHttpConfig(config: HttpRequestConfig): HttpRequestConfig {
  return resolveConfigVariables(config);
}

function buildScriptRequestContext(payload: ReturnType<typeof buildRequestPayload>) {
  let body: string | null = null;
  if (payload.body) {
    switch (payload.body.type) {
      case 'raw':
        body = payload.body.content ?? null;
        break;
      case 'json':
        body = payload.body.data ?? null;
        break;
      case 'formUrlencoded':
        body = new URLSearchParams((payload.body as { fields: Record<string, string> }).fields).toString();
        break;
      case 'formData':
        body = JSON.stringify((payload.body as { fields: Array<{ key: string; value: string; fieldType: string }> }).fields);
        break;
      case 'binary':
        body = payload.body.filePath ?? null;
        break;
      default:
        body = null;
    }
  }

  return {
    method: payload.method,
    url: payload.url,
    headers: payload.headers,
    queryParams: payload.queryParams,
    body,
  };
}

function removeHeaderCaseInsensitive(headers: Record<string, string>, key: string) {
  Object.keys(headers).forEach((existing) => {
    if (existing.toLowerCase() === key.toLowerCase()) {
      delete headers[existing];
    }
  });
}

function applyScriptRequestPatch(
  payload: ReturnType<typeof buildRequestPayload>,
  patch?: ScriptRequestPatch | null,
): ReturnType<typeof buildRequestPayload> {
  if (!patch) return payload;

  const next = {
    ...payload,
    headers: { ...payload.headers },
    queryParams: { ...payload.queryParams },
  };

  for (const key of patch.removedHeaders || []) {
    removeHeaderCaseInsensitive(next.headers, key);
  }
  for (const [key, value] of Object.entries(patch.headers || {})) {
    removeHeaderCaseInsensitive(next.headers, key);
    next.headers[key] = value;
  }

  for (const key of patch.removedQueryParams || []) {
    delete next.queryParams[key];
  }
  Object.entries(patch.queryParams || {}).forEach(([key, value]) => {
    next.queryParams[key] = value;
  });

  return next;
}

function mergeScriptScopeMap(
  base: Record<string, string>,
  updates?: Record<string, string>,
): Record<string, string> {
  if (!updates || Object.keys(updates).length === 0) return base;
  return { ...base, ...updates };
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
          if (f.fieldType === 'file') {
            // Multi-file: each path becomes a separate field for the backend
            const paths = f.filePaths && f.filePaths.length > 0
              ? f.filePaths
              : f.value ? f.value.split(',').map(p => p.trim()).filter(Boolean) : [];
            for (const p of paths) {
              fields.push({ key: f.key.trim(), value: p, fieldType: 'file' });
            }
          } else {
            fields.push({ key: f.key.trim(), value: f.value, fieldType: f.fieldType });
          }
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

  // 剥离 URL 中已有的 query string，避免与 queryParams 重复
  // （URL 和参数面板是双向同步的，参数已在 queryParams 对象中，
  //  如果 URL 也含 ?key=value，Rust 后端 append_pair 会导致参数翻倍）
  const rawUrl = normalizeUrl(config.url);
  const qIndex = rawUrl.indexOf('?');
  const cleanUrl = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;

  return {
    method: config.method,
    url: cleanUrl,
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

/** Filter and infer cookies based on RFC 6265 security and domain matching rules */
function processAndFilterCookies(urlStr: string, cookies: CookieInfo[]): CookieInfo[] {
  try {
    const url = new URL(urlStr);
    const requestHost = url.hostname.toLowerCase();
    
    // Check if the request host is an IP address (basic IPv4 or IPv6 detection)
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(requestHost) || (requestHost.includes(':') && !requestHost.includes('.'));

    return cookies.map(cookie => {
      // 1. Completion Inference (补全推导)
      if (!cookie.domain) {
        return { ...cookie, domain: requestHost };
      }
      
      const cookieDomain = cookie.domain.toLowerCase().replace(/^\./, '');
      
      // 2. Strict Security Filtering
      let isValid = false;
      if (isIp) {
        // IP addresses must match exactly
        isValid = requestHost === cookieDomain;
      } else {
        // Hostname suffix matching
        if (requestHost === cookieDomain) {
          isValid = true;
        } else if (requestHost.endsWith('.' + cookieDomain)) {
          isValid = true;
        }
      }
      
      return isValid ? cookie : null;
    }).filter(Boolean) as CookieInfo[];
  } catch {
    return cookies;
  }
}

/**
 * 自动执行已安装的 request-hook 类型插件（如时间戳签名）
 * 将返回的 headers / queryParams 合并到请求 payload
 */
async function applyRequestHooks(payload: ReturnType<typeof buildRequestPayload>): Promise<ReturnType<typeof buildRequestPayload>> {
  const hookPlugins = usePluginStore.getState().getInstalledByType('request-hook');
  if (hookPlugins.length === 0) return payload;

  let mutated = { ...payload, headers: { ...payload.headers }, queryParams: { ...payload.queryParams } };

  for (const plugin of hookPlugins) {
    try {
      const requestJson = JSON.stringify({
        method: mutated.method,
        url: mutated.url,
        headers: mutated.headers,
        queryParams: mutated.queryParams,
        body: mutated.body,
      });
      const result = await pluginService.runHook(plugin.id, requestJson);
      if (result.error) {
        console.warn(`[ProtoForge] request-hook plugin "${plugin.name}":`, result.error);
        continue;
      }
      if (result.headers && typeof result.headers === 'object') {
        mutated.headers = { ...mutated.headers, ...result.headers };
      }
      if (result.queryParams && typeof result.queryParams === 'object') {
        mutated.queryParams = { ...mutated.queryParams, ...result.queryParams };
      }
    } catch (e) {
      console.warn(`[ProtoForge] request-hook plugin "${plugin.name}" failed:`, e);
    }
  }

  return mutated;
}

export async function sendHttpRequest(config: HttpRequestConfig): Promise<HttpResponse> {
  const resolved = resolveConfigVariables(config);
  const payload = buildRequestPayload(resolved);
  const hookedPayload = await applyRequestHooks(payload);
  const finalPayload = buildFinalPayload(hookedPayload);
  const resp = await invoke<HttpResponse>('send_request', { request: finalPayload });
  
  if (resp && resp.cookies && Array.isArray(resp.cookies)) {
    resp.cookies = processAndFilterCookies(resolved.url, resp.cookies);
  }
  return resp;
}

/** Send request with pre/post script execution */
export async function sendRequestWithScripts(config: HttpRequestConfig): Promise<HttpResponseWithScripts> {
  const collectionId = getLinkedCollectionIdForRequestConfig(config);
  const itemId = getLinkedCollectionItemIdForRequestConfig(config);
  const envVars = getActiveEnvironmentVariableMap();
  const folderVars = getFolderVariableMap(collectionId, itemId);
  const collectionVars = getCollectionVariableMap(collectionId);
  const globalVars = getGlobalVariableMap();
  const initialResolved = resolveConfigVariables(config);
  const initialPayload = buildRequestPayload(initialResolved);

  let preScriptResult: ScriptResult | null = null;
  let postScriptResult: ScriptResult | null = null;

  if (config.preScript?.trim()) {
    preScriptResult = await invoke<ScriptResult>('run_pre_request_script', {
      script: config.preScript,
      envVars: Object.keys(envVars).length > 0 ? envVars : null,
      folderVars: Object.keys(folderVars).length > 0 ? folderVars : null,
      collectionVars: Object.keys(collectionVars).length > 0 ? collectionVars : null,
      globalVars: Object.keys(globalVars).length > 0 ? globalVars : null,
      request: buildScriptRequestContext(initialPayload),
    });

    if (!preScriptResult.success) {
      throw new Error(preScriptResult.error || '前置脚本执行失败');
    }
  }

  const mergedScopes = {
    envVars: mergeScriptScopeMap(envVars, preScriptResult?.envUpdates),
    folderVars: mergeScriptScopeMap(folderVars, preScriptResult?.folderUpdates),
    collectionVars: mergeScriptScopeMap(collectionVars, preScriptResult?.collectionUpdates),
    globalVars: mergeScriptScopeMap(globalVars, preScriptResult?.globalUpdates),
  };
  const mergedSnapshot = buildScopedVariableSnapshotFromMaps(mergedScopes, true);

  const resolved = resolveConfigVariables(config, mergedSnapshot);
  const payload = buildRequestPayload(resolved);
  const patchedPayload = applyScriptRequestPatch(payload, preScriptResult?.requestPatch);
  const hookedPayload = await applyRequestHooks(patchedPayload);
  const finalPayload = buildFinalPayload(hookedPayload);

  const response = await invoke<HttpResponse>('send_request', { request: finalPayload });

  if (config.postScript?.trim()) {
    postScriptResult = await invoke<ScriptResult>('run_post_response_script', {
      script: config.postScript,
      envVars: Object.keys(mergedScopes.envVars).length > 0 ? mergedScopes.envVars : null,
      folderVars: Object.keys(mergedScopes.folderVars).length > 0 ? mergedScopes.folderVars : null,
      collectionVars: Object.keys(mergedScopes.collectionVars).length > 0 ? mergedScopes.collectionVars : null,
      globalVars: Object.keys(mergedScopes.globalVars).length > 0 ? mergedScopes.globalVars : null,
      response: {
        status: response.status,
        statusText: response.statusText,
        body: response.body,
        headers: response.headers,
        durationMs: response.durationMs,
      },
    });
  }

  if (response && response.cookies && Array.isArray(response.cookies)) {
    response.cookies = processAndFilterCookies(resolved.url, response.cookies);
  }

  return {
    response,
    preScriptResult,
    postScriptResult,
  };
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

/** 选择多个文件，返回路径和名称数组 */
export async function pickFiles(): Promise<{ paths: string[]; names: string[] } | null> {
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
        paths: files.map(f => f.path),
        names: files.map(f => f.name),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Re-export for convenience
export type { FormDataField };
