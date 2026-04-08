// ProtoForge gRPC Types

export type GrpcMethodKind = 'unary' | 'serverStreaming' | 'clientStreaming' | 'bidiStreaming';

export interface GrpcFieldInfo {
  name: string;
  jsonName: string;
  fieldType: string;
  isRepeated: boolean;
  isMap: boolean;
  isOptional: boolean;
}

export interface GrpcMethodInfo {
  name: string;
  fullName: string;
  inputType: string;
  outputType: string;
  kind: GrpcMethodKind;
  inputFields: GrpcFieldInfo[];
}

export interface GrpcServiceInfo {
  name: string;
  fullName: string;
  methods: GrpcMethodInfo[];
}

export interface ProtoLoadResult {
  services: GrpcServiceInfo[];
  fileName: string;
}

export interface GrpcCallResult {
  responseJson: string;
  statusCode: number;
  statusMessage: string;
  durationMs: number;
  responseMetadata: Record<string, string>;
}

export interface GrpcStreamEvent {
  connectionId: string;
  eventType: 'data' | 'completed' | 'error';
  data?: string;
  statusCode?: number;
  statusMessage?: string;
  timestamp: string;
}

/** Build a JSON template from method input fields */
export function buildRequestTemplate(fields: GrpcFieldInfo[]): string {
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.isRepeated) {
      obj[f.jsonName] = [];
    } else if (f.isMap) {
      obj[f.jsonName] = {};
    } else {
      obj[f.jsonName] = getDefaultValue(f.fieldType);
    }
  }
  return JSON.stringify(obj, null, 2);
}

function getDefaultValue(fieldType: string): unknown {
  const lower = fieldType.toLowerCase();
  if (lower.includes('string') || lower.includes('bytes')) return '';
  if (lower.includes('bool')) return false;
  if (lower.includes('int') || lower.includes('float') || lower.includes('double') || lower.includes('fixed') || lower.includes('sint')) return 0;
  if (lower.includes('enum')) return 0;
  if (lower.includes('message')) return {};
  return '';
}

export function getMethodKindLabel(kind: GrpcMethodKind): string {
  switch (kind) {
    case 'unary': return 'Unary';
    case 'serverStreaming': return 'Server Stream';
    case 'clientStreaming': return 'Client Stream';
    case 'bidiStreaming': return 'Bidi Stream';
  }
}

export function getMethodKindColor(kind: GrpcMethodKind): string {
  switch (kind) {
    case 'unary': return 'text-emerald-500';
    case 'serverStreaming': return 'text-blue-500';
    case 'clientStreaming': return 'text-amber-500';
    case 'bidiStreaming': return 'text-purple-500';
  }
}
