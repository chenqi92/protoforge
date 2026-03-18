// ProtoForge HTTP Types

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'raw' | 'json' | 'formUrlencoded' | 'binary';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequestConfig {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  bodyType: BodyType;
  rawBody: string;
  rawContentType: string;
  jsonBody: string;
  formFields: KeyValue[];
  authType: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyAddTo: 'header' | 'query';
  timeoutMs: number;
  followRedirects: boolean;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodySize: number;
  contentType: string | null;
  durationMs: number;
  timing: { totalMs: number };
}

export interface RequestTab {
  id: string;
  config: HttpRequestConfig;
  response: HttpResponse | null;
  loading: boolean;
  error: string | null;
}

export function createDefaultRequest(): HttpRequestConfig {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '', enabled: true }],
    queryParams: [{ key: '', value: '', enabled: true }],
    bodyType: 'none',
    rawBody: '',
    rawContentType: 'text/plain',
    jsonBody: '{\n  \n}',
    formFields: [{ key: '', value: '', enabled: true }],
    authType: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyAddTo: 'header',
    timeoutMs: 30000,
    followRedirects: true,
  };
}

export function getMethodColor(method: HttpMethod): string {
  const colors: Record<HttpMethod, string> = {
    GET: 'text-method-get',
    POST: 'text-method-post',
    PUT: 'text-method-put',
    DELETE: 'text-method-delete',
    PATCH: 'text-method-patch',
    HEAD: 'text-method-head',
    OPTIONS: 'text-method-options',
  };
  return colors[method] || 'text-text-secondary';
}

export function getStatusColor(status: number): string {
  if (status < 200) return 'text-info';
  if (status < 300) return 'text-success';
  if (status < 400) return 'text-warning';
  if (status < 500) return 'text-method-post';
  return 'text-error';
}
