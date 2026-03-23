// ProtoForge Collection & Item Types — mirrors Rust structs

export interface Collection {
  id: string;
  name: string;
  description: string;
  auth: string | null;
  preScript: string;
  postScript: string;
  variables: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  parentId: string | null;
  itemType: 'request' | 'folder';
  name: string;
  sortOrder: number;
  method: string | null;
  url: string | null;
  headers: string;
  queryParams: string;
  bodyType: string;
  bodyContent: string;
  authType: string;
  authConfig: string;
  preScript: string;
  postScript: string;
  responseExample: string;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  name: string;
  isActive: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnvVariable {
  id: string;
  environmentId: string;
  key: string;
  value: string;
  enabled: number;
  isSecret: number;
  sortOrder: number;
}

export interface GlobalVariable {
  id: string;
  key: string;
  value: string;
  enabled: number;
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  bodySize: number | null;
  requestConfig: string | null;
  responseSummary: string | null;
  createdAt: string;
}

/** Generate ISO timestamp */
export function nowISO(): string {
  return new Date().toISOString();
}
