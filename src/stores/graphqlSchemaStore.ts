// ProtoForge GraphQL Schema Store — caches introspection results per endpoint

import { create } from 'zustand';
import type { IntrospectionResult, GqlType, GqlField } from '@/types/graphql';
import { unwrapType } from '@/types/graphql';
import { fetchIntrospection } from '@/services/graphqlService';

interface SchemaEntry {
  result: IntrospectionResult;
  loading: boolean;
  error: string | null;
}

interface GraphQLSchemaStore {
  /** Schema cache keyed by normalized URL */
  schemas: Record<string, SchemaEntry>;

  /** Fetch / refresh introspection for a URL */
  fetchSchema: (url: string, headers?: Record<string, string>) => Promise<void>;

  /** Get cached schema for a URL (or null) */
  getSchema: (url: string) => IntrospectionResult | null;

  /** Check if schema is currently loading */
  isLoading: (url: string) => boolean;

  /** Get error for a URL */
  getError: (url: string) => string | null;

  /** Clear cached schema for a URL */
  clearSchema: (url: string) => void;

  /** Look up a named type from the cached schema */
  findType: (url: string, typeName: string) => GqlType | null;

  /** Get fields available at root (query/mutation/subscription) */
  getRootFields: (url: string, operation: 'query' | 'mutation' | 'subscription') => GqlField[];
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const useGraphQLSchemaStore = create<GraphQLSchemaStore>((set, get) => ({
  schemas: {},

  fetchSchema: async (url, headers) => {
    const key = normalizeUrl(url);
    if (!key) return;

    set((state) => ({
      schemas: {
        ...state.schemas,
        [key]: {
          result: state.schemas[key]?.result ?? null!,
          loading: true,
          error: null,
        },
      },
    }));

    try {
      const result = await fetchIntrospection(key, headers);
      set((state) => ({
        schemas: {
          ...state.schemas,
          [key]: { result, loading: false, error: null },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((state) => ({
        schemas: {
          ...state.schemas,
          [key]: {
            result: state.schemas[key]?.result ?? null!,
            loading: false,
            error: msg,
          },
        },
      }));
    }
  },

  getSchema: (url) => {
    const entry = get().schemas[normalizeUrl(url)];
    return entry?.result ?? null;
  },

  isLoading: (url) => {
    return get().schemas[normalizeUrl(url)]?.loading ?? false;
  },

  getError: (url) => {
    return get().schemas[normalizeUrl(url)]?.error ?? null;
  },

  clearSchema: (url) => {
    const key = normalizeUrl(url);
    set((state) => {
      const next = { ...state.schemas };
      delete next[key];
      return { schemas: next };
    });
  },

  findType: (url, typeName) => {
    const schema = get().getSchema(url);
    if (!schema) return null;
    return schema.schema.types.find((t) => t.name === typeName) ?? null;
  },

  getRootFields: (url, operation) => {
    const schema = get().getSchema(url);
    if (!schema) return [];

    const rootName =
      operation === 'query'
        ? schema.schema.queryType?.name
        : operation === 'mutation'
          ? schema.schema.mutationType?.name
          : schema.schema.subscriptionType?.name;

    if (!rootName) return [];

    const rootType = schema.schema.types.find((t) => t.name === rootName);
    return rootType?.fields ?? [];
  },
}));

/** Build a type map for quick lookup */
export function buildTypeMap(result: IntrospectionResult): Map<string, GqlType> {
  const map = new Map<string, GqlType>();
  for (const t of result.schema.types) {
    if (t.name) map.set(t.name, t);
  }
  return map;
}

/** Get the fields reachable from a given type name */
export function getFieldsForType(typeMap: Map<string, GqlType>, typeName: string): GqlField[] {
  const type = typeMap.get(typeName);
  return type?.fields ?? [];
}

/** Resolve a dotted field path to find the current type context */
export function resolveFieldPath(
  typeMap: Map<string, GqlType>,
  rootTypeName: string,
  fieldPath: string[],
): GqlType | null {
  let current = typeMap.get(rootTypeName);
  for (const fieldName of fieldPath) {
    if (!current?.fields) return null;
    const field = current.fields.find((f) => f.name === fieldName);
    if (!field) return null;
    const innerName = unwrapType(field.type);
    current = typeMap.get(innerName);
    if (!current) return null;
  }
  return current ?? null;
}
