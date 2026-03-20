// ProtoForge Swagger/OpenAPI types — mirrors Rust structs

export interface SwaggerGroup {
  name: string;
  url: string;
  displayName: string;
}

export interface SwaggerDiscoveryResult {
  groups: SwaggerGroup[];
  defaultResult: SwaggerParseResult | null;
}

export interface SwaggerParseResult {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  endpoints: SwaggerEndpoint[];
}

export interface SwaggerEndpoint {
  path: string;
  method: string;
  summary: string;
  description: string;
  tag: string;
  operationId: string;
  parameters: SwaggerParameter[];
  requestBody: SwaggerRequestBody | null;
}

export interface SwaggerParameter {
  name: string;
  location: string;
  required: boolean;
  paramType: string;
  description: string;
  defaultValue: string;
}

export interface SwaggerRequestBody {
  contentType: string;
  schemaJson: string;
  required: boolean;
}
