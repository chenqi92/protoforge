// ProtoForge HTTP Types

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'raw' | 'json' | 'formUrlencoded' | 'formData' | 'binary' | 'graphql';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey' | 'oauth2';

export interface KeyValue {
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

/** Form-Data field — supports text and file */
export interface FormDataField {
  key: string;
  value: string;        // text value or file path
  fieldType: 'text' | 'file';
  fileName?: string;    // display name for file
  description?: string;
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
  // Password specific
  username: string;
  password: string;
  // Cached token
  accessToken: string;
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
  headers: Record<string, string>;
  body: string;
  bodySize: number;
  contentType: string | null;
  durationMs: number;
  timing: ResponseTiming;
  cookies: CookieInfo[];
}

/** Script execution result (from Boa engine) */
export interface ScriptResult {
  envUpdates: Record<string, string>;
  testResults: TestResult[];
  logs: string[];
  success: boolean;
  error: string | null;
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
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '', enabled: true }],
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
      username: '',
      password: '',
      accessToken: '',
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

