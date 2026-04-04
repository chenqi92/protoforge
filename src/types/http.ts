// ProtoForge HTTP Types

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'raw' | 'json' | 'formUrlencoded' | 'formData' | 'binary' | 'graphql';
export type HttpRequestMode = 'rest' | 'graphql' | 'sse';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey' | 'oauth2';

export interface KeyValue {
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  isAuto?: boolean;  // auto-generated default header
}

/** Form-Data field — supports text and file */
export interface FormDataField {
  key: string;
  value: string;        // text value (for text type) or legacy comma-separated file paths
  fieldType: 'text' | 'file';
  fileName?: string;    // legacy display name (comma-separated), kept for compat
  filePaths?: string[]; // multiple file full paths
  fileNames?: string[]; // corresponding file display names
  description?: string;
  contentType?: string;
  enabled: boolean;
}

/** OAuth 2.0 configuration */
export interface OAuth2Config {
  grantType: 'authorization_code' | 'client_credentials' | 'password';
  accessTokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  // Authorization Code specific
  authUrl: string;
  redirectUri: string;
  usePkce: boolean;
  // Password specific
  username: string;
  password: string;
  // Token state
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;  // absolute timestamp (ms), 0 = unknown
}

export interface HttpRequestConfig {
  id: string;
  name: string;
  requestMode: HttpRequestMode;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  bodyType: BodyType;
  rawBody: string;
  rawContentType: string;
  jsonBody: string;
  formFields: KeyValue[];         // form-urlencoded
  formDataFields: FormDataField[];  // multipart form-data
  binaryFilePath: string;           // binary file path
  binaryFileName: string;           // binary file display name
  // GraphQL
  graphqlQuery: string;
  graphqlVariables: string;
  // Auth
  authType: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyAddTo: 'header' | 'query';
  oauth2Config: OAuth2Config;
  // Scripts
  preScript: string;
  postScript: string;
  timeoutMs: number;
  followRedirects: boolean;
}

export interface CookieInfo {
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
  expires: string | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

export interface ResponseTiming {
  totalMs: number;
  connectMs: number | null;
  ttfbMs: number | null;
  downloadMs: number | null;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
  bodySize: number;
  contentType: string | null;
  durationMs: number;
  timing: ResponseTiming;
  cookies: CookieInfo[];
  isEventStream?: boolean;
  isBinary?: boolean;
}

/** Script execution result (from Boa engine) */
export interface ScriptResult {
  envUpdates: Record<string, string>;
  folderUpdates: Record<string, string>;
  collectionUpdates: Record<string, string>;
  globalUpdates: Record<string, string>;
  requestPatch?: ScriptRequestPatch | null;
  testResults: TestResult[];
  logs: string[];
  success: boolean;
  error: string | null;
}

export interface ScriptRequestPatch {
  headers: Record<string, string>;
  removedHeaders: string[];
  queryParams: Record<string, string>;
  removedQueryParams: string[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface HttpResponseWithScripts {
  response: HttpResponse;
  preScriptResult: ScriptResult | null;
  postScriptResult: ScriptResult | null;
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
    requestMode: 'rest',
    method: 'GET',
    url: '',
    headers: [
      { key: '', value: '', enabled: true },
    ],
    queryParams: [{ key: '', value: '', enabled: true }],
    bodyType: 'none',
    rawBody: '',
    rawContentType: 'text/plain',
    jsonBody: '{\n  \n}',
    formFields: [{ key: '', value: '', enabled: true }],
    formDataFields: [{ key: '', value: '', fieldType: 'text', enabled: true }],
    binaryFilePath: '',
    binaryFileName: '',
    graphqlQuery: '',
    graphqlVariables: '{\n  \n}',
    authType: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyAddTo: 'header',
    oauth2Config: {
      grantType: 'client_credentials',
      accessTokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      authUrl: '',
      redirectUri: 'http://localhost:1420/callback',
      usePkce: true,
      username: '',
      password: '',
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: 0,
    },
    preScript: '',
    postScript: '',
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

/** 注入默认请求头，补齐老数据中没有的隐式 Headers */
export function ensureAutoHeaders(headers: KeyValue[]): KeyValue[] {
  const arr = Array.isArray(headers) ? headers : [];
  const hasKey = (k: string) => arr.some(h => h.key.trim().toLowerCase() === k.toLowerCase());
  const defaults = [
    { key: 'User-Agent', value: 'ProtoForge/0.1.0', isAuto: true, enabled: true },
    { key: 'Accept', value: '*/*', isAuto: true, enabled: true },
    { key: 'Accept-Encoding', value: 'gzip, deflate, br', isAuto: true, enabled: true },
    { key: 'Connection', value: 'keep-alive', isAuto: true, enabled: true },
  ];
  const toUnshift = [];
  for (const def of defaults) {
    if (!hasKey(def.key)) {
      toUnshift.push(def);
    }
  }
  if (toUnshift.length > 0) {
    return [...toUnshift, ...arr];
  }
  return arr;
}
