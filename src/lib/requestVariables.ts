import type { HttpRequestConfig } from "@/types/http";
import type { Collection } from "@/types/collections";
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useEnvStore } from "@/stores/envStore";
import { updateCollection } from "@/services/collectionService";

export interface CollectionVariableEntry {
  key: string;
  value: string;
  enabled: boolean;
  isSecret?: boolean;
}

export type VariableSource = "collection" | "environment" | "global" | "dynamic" | "missing";

export interface VariablePreview {
  key: string;
  rawValue: string;
  value: string;
  source: VariableSource;
  enabled: boolean;
  isSecret: boolean;
  editable: boolean;
}

export const VARIABLE_PATTERN = /\{\{\s*([\w.$-]+)\s*\}\}/g;

function getDynamicVariableResolvers(): Record<string, () => string> {
  return {
    "$timestamp": () => String(Math.floor(Date.now() / 1000)),
    "$isoTimestamp": () => new Date().toISOString(),
    "$randomInt": () => String(Math.floor(Math.random() * 1000)),
    "$randomInt1000": () => String(Math.floor(Math.random() * 1000)),
    "$guid": () => crypto.randomUUID(),
    "$randomUUID": () => crypto.randomUUID(),
    "$randomEmail": () => `user${Math.floor(Math.random() * 10000)}@example.com`,
    "$randomColor": () => ["red", "green", "blue", "orange", "purple", "yellow"][Math.floor(Math.random() * 6)],
  };
}

export function extractVariableKeys(input: string | null | undefined): string[] {
  const text = input ?? "";
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const key = match[1]?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

export function parseCollectionVariableEntries(raw: string | null | undefined): CollectionVariableEntry[] {
  if (!raw?.trim()) return [];

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is Partial<CollectionVariableEntry> & { key: string } => !!entry && typeof entry === "object" && typeof entry.key === "string")
        .map((entry) => ({
          key: entry.key,
          value: typeof entry.value === "string" ? entry.value : String(entry.value ?? ""),
          enabled: entry.enabled !== false,
          isSecret: Boolean(entry.isSecret),
        }));
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : String(value ?? ""),
        enabled: true,
        isSecret: false,
      }));
    }
  } catch {
    return [];
  }

  return [];
}

function serializeCollectionVariableEntries(entries: CollectionVariableEntry[]): string {
  return JSON.stringify(entries);
}

function findCollection(collectionId?: string | null): Collection | undefined {
  if (!collectionId) return undefined;
  return useCollectionStore.getState().collections.find((collection) => collection.id === collectionId);
}

export function getCollectionVariableEntries(collectionId?: string | null): CollectionVariableEntry[] {
  return parseCollectionVariableEntries(findCollection(collectionId)?.variables);
}

export function getCollectionVariableMap(collectionId?: string | null): Record<string, string> {
  return Object.fromEntries(
    getCollectionVariableEntries(collectionId)
      .filter((entry) => entry.enabled && entry.key.trim())
      .map((entry) => [entry.key.trim(), entry.value])
  );
}

export function getLinkedCollectionIdForRequestConfig(config: HttpRequestConfig): string | null {
  const tabs = useAppStore.getState().tabs;
  const exactMatch = tabs.find((tab) => tab.httpConfig === config);
  if (exactMatch?.linkedCollectionId) return exactMatch.linkedCollectionId;

  const idMatch = tabs.find((tab) => tab.httpConfig?.id === config.id);
  return idMatch?.linkedCollectionId ?? null;
}

export function buildScopedVariableSnapshot(collectionId?: string | null, includeDynamic = false): Record<string, string> {
  const envVars = useEnvStore.getState().getResolvedVariables();
  const scoped = {
    ...envVars,
    ...getCollectionVariableMap(collectionId),
  };

  if (!includeDynamic) {
    return scoped;
  }

  const dynamicVars = Object.fromEntries(
    Object.entries(getDynamicVariableResolvers()).map(([key, resolver]) => [key, resolver()])
  );

  return {
    ...scoped,
    ...dynamicVars,
  };
}

interface VariableLookupResult {
  source: VariableSource;
  rawValue: string;
  isSecret: boolean;
  enabled: boolean;
}

function lookupVariable(key: string, collectionId?: string | null): VariableLookupResult {
  const collectionEntry = getCollectionVariableEntries(collectionId).find((entry) => entry.enabled && entry.key.trim() === key);
  if (collectionEntry) {
    return {
      source: "collection",
      rawValue: collectionEntry.value,
      isSecret: Boolean(collectionEntry.isSecret),
      enabled: true,
    };
  }

  const envState = useEnvStore.getState();
  if (envState.activeEnvId) {
    const envEntry = (envState.variables[envState.activeEnvId] || []).find((entry) => entry.enabled === 1 && entry.key.trim() === key);
    if (envEntry) {
      return {
        source: "environment",
        rawValue: envEntry.value,
        isSecret: envEntry.isSecret === 1,
        enabled: true,
      };
    }
  }

  const globalEntry = envState.globalVariables.find((entry) => entry.enabled === 1 && entry.key.trim() === key);
  if (globalEntry) {
    return {
      source: "global",
      rawValue: globalEntry.value,
      isSecret: false,
      enabled: true,
    };
  }

  const dynamicResolver = getDynamicVariableResolvers()[key];
  if (dynamicResolver) {
    return {
      source: "dynamic",
      rawValue: dynamicResolver(),
      isSecret: false,
      enabled: true,
    };
  }

  return {
    source: "missing",
    rawValue: "",
    isSecret: false,
    enabled: false,
  };
}

function resolveVariableValue(key: string, collectionId?: string | null, visited = new Set<string>()): string | null {
  if (visited.has(key)) return null;

  const lookup = lookupVariable(key, collectionId);
  if (lookup.source === "missing") return null;
  if (lookup.source === "dynamic") return lookup.rawValue;

  const nextVisited = new Set(visited);
  nextVisited.add(key);
  return lookup.rawValue.replace(VARIABLE_PATTERN, (match, nestedKey) => {
    const nested = nestedKey?.trim();
    if (!nested) return match;
    const resolved = resolveVariableValue(nested, collectionId, nextVisited);
    return resolved ?? match;
  });
}

export function resolveVariableTemplate(input: string, collectionId?: string | null): string {
  return input.replace(VARIABLE_PATTERN, (match, key) => {
    const normalizedKey = key?.trim();
    if (!normalizedKey) return match;
    const resolved = resolveVariableValue(normalizedKey, collectionId);
    return resolved ?? match;
  });
}

export function getVariablePreview(key: string, collectionId?: string | null): VariablePreview {
  const lookup = lookupVariable(key, collectionId);
  const value = lookup.source === "missing" ? "" : resolveVariableValue(key, collectionId) ?? lookup.rawValue;

  return {
    key,
    rawValue: lookup.rawValue,
    value,
    source: lookup.source,
    enabled: lookup.enabled,
    isSecret: lookup.isSecret,
    editable: Boolean(collectionId) && lookup.source !== "dynamic",
  };
}

export function resolveRequestConfigVariables(config: HttpRequestConfig, collectionId?: string | null): HttpRequestConfig {
  return {
    ...config,
    url: resolveVariableTemplate(config.url, collectionId),
    rawBody: resolveVariableTemplate(config.rawBody, collectionId),
    jsonBody: resolveVariableTemplate(config.jsonBody, collectionId),
    graphqlQuery: resolveVariableTemplate(config.graphqlQuery, collectionId),
    graphqlVariables: resolveVariableTemplate(config.graphqlVariables, collectionId),
    bearerToken: resolveVariableTemplate(config.bearerToken, collectionId),
    basicUsername: resolveVariableTemplate(config.basicUsername, collectionId),
    basicPassword: resolveVariableTemplate(config.basicPassword, collectionId),
    apiKeyName: resolveVariableTemplate(config.apiKeyName, collectionId),
    apiKeyValue: resolveVariableTemplate(config.apiKeyValue, collectionId),
    oauth2Config: {
      ...config.oauth2Config,
      accessToken: resolveVariableTemplate(config.oauth2Config.accessToken, collectionId),
    },
    headers: config.headers.map((header) => ({
      ...header,
      key: resolveVariableTemplate(header.key, collectionId),
      value: resolveVariableTemplate(header.value, collectionId),
    })),
    queryParams: config.queryParams.map((param) => ({
      ...param,
      key: resolveVariableTemplate(param.key, collectionId),
      value: resolveVariableTemplate(param.value, collectionId),
    })),
    formFields: config.formFields.map((field) => ({
      ...field,
      key: resolveVariableTemplate(field.key, collectionId),
      value: resolveVariableTemplate(field.value, collectionId),
    })),
    formDataFields: config.formDataFields.map((field) => ({
      ...field,
      key: resolveVariableTemplate(field.key, collectionId),
      value: field.fieldType === "text" ? resolveVariableTemplate(field.value, collectionId) : field.value,
      filePaths: field.filePaths,
      fileNames: field.fileNames,
    })),
  };
}

export async function saveCollectionVariables(collectionId: string, entries: CollectionVariableEntry[]): Promise<void> {
  const collection = findCollection(collectionId);
  if (!collection) return;

  const normalized = entries
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value,
      enabled: entry.enabled !== false,
      isSecret: Boolean(entry.isSecret),
    }))
    .filter((entry) => entry.key);

  const updated: Collection = {
    ...collection,
    variables: serializeCollectionVariableEntries(normalized),
    updatedAt: new Date().toISOString(),
  };

  await updateCollection(updated);
  useCollectionStore.setState((state) => ({
    collections: state.collections.map((item) => item.id === collectionId ? updated : item),
  }));
}

export async function upsertCollectionVariable(collectionId: string, key: string, value: string): Promise<void> {
  const entries = getCollectionVariableEntries(collectionId);
  const normalizedKey = key.trim();
  const nextEntries = [...entries];
  const existingIndex = nextEntries.findIndex((entry) => entry.key.trim() === normalizedKey);

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = {
      ...nextEntries[existingIndex],
      key: normalizedKey,
      value,
      enabled: true,
    };
  } else {
    nextEntries.push({
      key: normalizedKey,
      value,
      enabled: true,
      isSecret: false,
    });
  }

  await saveCollectionVariables(collectionId, nextEntries);
}
