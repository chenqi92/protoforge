import type { HttpRequestConfig } from "@/types/http";
import type { Collection, CollectionItem, EnvVariable, GlobalVariable } from "@/types/collections";
import { useAppStore } from "@/stores/appStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useEnvStore } from "@/stores/envStore";
import { updateCollection, updateCollectionItem } from "@/services/collectionService";

export interface CollectionVariableEntry {
  key: string;
  value: string;
  enabled: boolean;
  isSecret?: boolean;
}

export type VariableSource = "collection" | "folder" | "environment" | "global" | "dynamic" | "missing";

export interface VariablePreview {
  key: string;
  rawValue: string;
  value: string;
  source: VariableSource;
  enabled: boolean;
  isSecret: boolean;
  editable: boolean;
}

export interface ScopedVariableMaps {
  globalVars?: Record<string, string>;
  collectionVars?: Record<string, string>;
  folderVars?: Record<string, string>;
  envVars?: Record<string, string>;
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

function findCollectionItem(collectionId?: string | null, itemId?: string | null): CollectionItem | undefined {
  if (!collectionId || !itemId) return undefined;
  return (useCollectionStore.getState().items[collectionId] || []).find((item) => item.id === itemId);
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

function getCollectionItemVariableEntries(collectionId?: string | null, itemId?: string | null): CollectionVariableEntry[] {
  return parseCollectionVariableEntries(findCollectionItem(collectionId, itemId)?.variables);
}

export function getFolderAncestorItems(collectionId?: string | null, itemId?: string | null): CollectionItem[] {
  if (!collectionId || !itemId) return [];

  const items = useCollectionStore.getState().items[collectionId] || [];
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const currentItem = itemMap.get(itemId);
  if (!currentItem) return [];

  const ancestors: CollectionItem[] = [];
  const visited = new Set<string>();
  let parentId = currentItem.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = itemMap.get(parentId);
    if (!parent) break;
    if (parent.itemType === "folder") {
      ancestors.push(parent);
    }
    parentId = parent.parentId;
  }

  return ancestors.reverse();
}

export function getFolderVariableMap(collectionId?: string | null, itemId?: string | null): Record<string, string> {
  return getFolderAncestorItems(collectionId, itemId).reduce<Record<string, string>>((acc, folder) => {
    getCollectionItemVariableEntries(collectionId, folder.id)
      .filter((entry) => entry.enabled && entry.key.trim())
      .forEach((entry) => {
        acc[entry.key.trim()] = entry.value;
      });
    return acc;
  }, {});
}

function getImmediateParentFolderItem(collectionId?: string | null, itemId?: string | null): CollectionItem | undefined {
  const currentItem = findCollectionItem(collectionId, itemId);
  if (!currentItem?.parentId) return undefined;

  const parentItem = findCollectionItem(collectionId, currentItem.parentId);
  if (!parentItem || parentItem.itemType !== "folder") {
    return undefined;
  }

  return parentItem;
}

export function getGlobalVariableMap(): Record<string, string> {
  return Object.fromEntries(
    useEnvStore.getState().globalVariables
      .filter((entry) => entry.enabled === 1 && entry.key.trim())
      .map((entry) => [entry.key.trim(), entry.value])
  );
}

export function getActiveEnvironmentVariableMap(): Record<string, string> {
  const state = useEnvStore.getState();
  if (!state.activeEnvId) {
    return {};
  }

  return Object.fromEntries(
    (state.variables[state.activeEnvId] || [])
      .filter((entry) => entry.enabled === 1 && entry.key.trim())
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

export function getLinkedCollectionItemIdForRequestConfig(config: HttpRequestConfig): string | null {
  const tabs = useAppStore.getState().tabs;
  const exactMatch = tabs.find((tab) => tab.httpConfig === config);
  if (exactMatch?.linkedCollectionItemId) return exactMatch.linkedCollectionItemId;

  const idMatch = tabs.find((tab) => tab.httpConfig?.id === config.id);
  return idMatch?.linkedCollectionItemId ?? null;
}

export function buildScopedVariableSnapshot(
  collectionId?: string | null,
  itemId?: string | null,
  includeDynamic = false
): Record<string, string> {
  const scoped = buildScopedVariableSnapshotFromMaps({
    globalVars: getGlobalVariableMap(),
    collectionVars: getCollectionVariableMap(collectionId),
    folderVars: getFolderVariableMap(collectionId, itemId),
    envVars: getActiveEnvironmentVariableMap(),
  }, includeDynamic);

  return scoped;
}

export function buildScopedVariableSnapshotFromMaps(
  maps: ScopedVariableMaps,
  includeDynamic = false
): Record<string, string> {
  const scoped = {
    ...(maps.globalVars || {}),
    ...(maps.collectionVars || {}),
    ...(maps.folderVars || {}),
    ...(maps.envVars || {}),
  };

  if (!includeDynamic) {
    return scoped;
  }

  const dynamicVars = Object.fromEntries(
    Object.entries(getDynamicVariableResolvers()).map(([key, resolver]) => [key, resolver()])
  );

  return { ...scoped, ...dynamicVars };
}

interface VariableLookupResult {
  source: VariableSource;
  rawValue: string;
  isSecret: boolean;
  enabled: boolean;
}

function lookupVariable(key: string, collectionId?: string | null, itemId?: string | null): VariableLookupResult {
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

  const folderChain = getFolderAncestorItems(collectionId, itemId).slice().reverse();
  for (const folder of folderChain) {
    const folderEntry = getCollectionItemVariableEntries(collectionId, folder.id).find((entry) => entry.enabled && entry.key.trim() === key);
    if (folderEntry) {
      return {
        source: "folder",
        rawValue: folderEntry.value,
        isSecret: Boolean(folderEntry.isSecret),
        enabled: true,
      };
    }
  }

  const collectionEntry = getCollectionVariableEntries(collectionId).find((entry) => entry.enabled && entry.key.trim() === key);
  if (collectionEntry) {
    return {
      source: "collection",
      rawValue: collectionEntry.value,
      isSecret: Boolean(collectionEntry.isSecret),
      enabled: true,
    };
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

function resolveVariableValueFromSnapshot(
  key: string,
  snapshot: Record<string, string>,
  visited = new Set<string>()
): string | null {
  if (visited.has(key)) return null;
  const current = snapshot[key];
  if (typeof current !== "string") return null;

  const nextVisited = new Set(visited);
  nextVisited.add(key);
  return current.replace(VARIABLE_PATTERN, (match, nestedKey) => {
    const nested = nestedKey?.trim();
    if (!nested) return match;
    const resolved = resolveVariableValueFromSnapshot(nested, snapshot, nextVisited);
    return resolved ?? match;
  });
}

function resolveVariableValue(
  key: string,
  collectionId?: string | null,
  itemId?: string | null,
  visited = new Set<string>()
): string | null {
  if (visited.has(key)) return null;

  const lookup = lookupVariable(key, collectionId, itemId);
  if (lookup.source === "missing") return null;
  if (lookup.source === "dynamic") return lookup.rawValue;

  const nextVisited = new Set(visited);
  nextVisited.add(key);
  return lookup.rawValue.replace(VARIABLE_PATTERN, (match, nestedKey) => {
    const nested = nestedKey?.trim();
    if (!nested) return match;
    const resolved = resolveVariableValue(nested, collectionId, itemId, nextVisited);
    return resolved ?? match;
  });
}

export function resolveVariableTemplate(
  input: string,
  collectionId?: string | null,
  itemId?: string | null,
  scopeSnapshot?: Record<string, string>
): string {
  return input.replace(VARIABLE_PATTERN, (match, key) => {
    const normalizedKey = key?.trim();
    if (!normalizedKey) return match;
    const resolved = scopeSnapshot
      ? resolveVariableValueFromSnapshot(normalizedKey, scopeSnapshot)
      : resolveVariableValue(normalizedKey, collectionId, itemId);
    return resolved ?? match;
  });
}

export function getVariablePreview(key: string, collectionId?: string | null, itemId?: string | null): VariablePreview {
  const lookup = lookupVariable(key, collectionId, itemId);
  const value = lookup.source === "missing" ? "" : resolveVariableValue(key, collectionId, itemId) ?? lookup.rawValue;

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

export function resolveRequestConfigVariables(
  config: HttpRequestConfig,
  collectionId?: string | null,
  itemId?: string | null,
  scopeSnapshot?: Record<string, string>
): HttpRequestConfig {
  return {
    ...config,
    url: resolveVariableTemplate(config.url, collectionId, itemId, scopeSnapshot),
    rawBody: resolveVariableTemplate(config.rawBody, collectionId, itemId, scopeSnapshot),
    jsonBody: resolveVariableTemplate(config.jsonBody, collectionId, itemId, scopeSnapshot),
    graphqlQuery: resolveVariableTemplate(config.graphqlQuery, collectionId, itemId, scopeSnapshot),
    graphqlVariables: resolveVariableTemplate(config.graphqlVariables, collectionId, itemId, scopeSnapshot),
    bearerToken: resolveVariableTemplate(config.bearerToken, collectionId, itemId, scopeSnapshot),
    basicUsername: resolveVariableTemplate(config.basicUsername, collectionId, itemId, scopeSnapshot),
    basicPassword: resolveVariableTemplate(config.basicPassword, collectionId, itemId, scopeSnapshot),
    apiKeyName: resolveVariableTemplate(config.apiKeyName, collectionId, itemId, scopeSnapshot),
    apiKeyValue: resolveVariableTemplate(config.apiKeyValue, collectionId, itemId, scopeSnapshot),
    oauth2Config: {
      ...config.oauth2Config,
      accessToken: resolveVariableTemplate(config.oauth2Config.accessToken, collectionId, itemId, scopeSnapshot),
    },
    headers: config.headers.map((header) => ({
      ...header,
      key: resolveVariableTemplate(header.key, collectionId, itemId, scopeSnapshot),
      value: resolveVariableTemplate(header.value, collectionId, itemId, scopeSnapshot),
    })),
    queryParams: config.queryParams.map((param) => ({
      ...param,
      key: resolveVariableTemplate(param.key, collectionId, itemId, scopeSnapshot),
      value: resolveVariableTemplate(param.value, collectionId, itemId, scopeSnapshot),
    })),
    formFields: config.formFields.map((field) => ({
      ...field,
      key: resolveVariableTemplate(field.key, collectionId, itemId, scopeSnapshot),
      value: resolveVariableTemplate(field.value, collectionId, itemId, scopeSnapshot),
    })),
    formDataFields: config.formDataFields.map((field) => ({
      ...field,
      key: resolveVariableTemplate(field.key, collectionId, itemId, scopeSnapshot),
      value: field.fieldType === "text" ? resolveVariableTemplate(field.value, collectionId, itemId, scopeSnapshot) : field.value,
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

export async function saveCollectionItemVariables(
  collectionId: string,
  itemId: string,
  entries: CollectionVariableEntry[]
): Promise<void> {
  const item = findCollectionItem(collectionId, itemId);
  if (!item) return;

  const normalized = entries
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value,
      enabled: entry.enabled !== false,
      isSecret: Boolean(entry.isSecret),
    }))
    .filter((entry) => entry.key);

  const updated: CollectionItem = {
    ...item,
    variables: serializeCollectionVariableEntries(normalized),
    updatedAt: new Date().toISOString(),
  };

  await updateCollectionItem(updated);
  useCollectionStore.setState((state) => ({
    items: {
      ...state.items,
      [collectionId]: (state.items[collectionId] || []).map((entry) => entry.id === itemId ? updated : entry),
    },
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

function mergeCollectionVariableEntries(
  entries: CollectionVariableEntry[],
  updates: Record<string, string>
): CollectionVariableEntry[] {
  const nextEntries = [...entries];

  Object.entries(updates).forEach(([key, value]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;

    const existingIndex = nextEntries.findIndex((entry) => entry.key.trim() === normalizedKey);
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = {
        ...nextEntries[existingIndex],
        key: normalizedKey,
        value,
        enabled: true,
      };
      return;
    }

    nextEntries.push({
      key: normalizedKey,
      value,
      enabled: true,
      isSecret: false,
    });
  });

  return nextEntries;
}

function mergeEnvironmentVariableEntries(
  entries: EnvVariable[],
  updates: Record<string, string>,
  environmentId: string
): EnvVariable[] {
  const nextEntries = [...entries];
  let nextSortOrder = nextEntries.reduce((max, entry) => Math.max(max, entry.sortOrder), -1) + 1;

  Object.entries(updates).forEach(([key, value]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;

    const existingIndex = nextEntries.findIndex((entry) => entry.key.trim() === normalizedKey);
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = {
        ...nextEntries[existingIndex],
        key: normalizedKey,
        value,
        enabled: 1,
      };
      return;
    }

    nextEntries.push({
      id: crypto.randomUUID(),
      environmentId,
      key: normalizedKey,
      value,
      enabled: 1,
      isSecret: 0,
      sortOrder: nextSortOrder++,
    });
  });

  return nextEntries;
}

function mergeGlobalVariableEntries(
  entries: GlobalVariable[],
  updates: Record<string, string>
): GlobalVariable[] {
  const nextEntries = [...entries];

  Object.entries(updates).forEach(([key, value]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;

    const existingIndex = nextEntries.findIndex((entry) => entry.key.trim() === normalizedKey);
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = {
        ...nextEntries[existingIndex],
        key: normalizedKey,
        value,
        enabled: 1,
      };
      return;
    }

    nextEntries.push({
      id: crypto.randomUUID(),
      key: normalizedKey,
      value,
      enabled: 1,
    });
  });

  return nextEntries;
}

export interface ScriptVariableScopeUpdates {
  envUpdates?: Record<string, string>;
  folderUpdates?: Record<string, string>;
  collectionUpdates?: Record<string, string>;
  globalUpdates?: Record<string, string>;
}

export async function persistScriptVariableUpdates(
  collectionId: string | null | undefined,
  itemId: string | null | undefined,
  updates: ScriptVariableScopeUpdates
): Promise<void> {
  const envUpdates = updates.envUpdates || {};
  const folderUpdates = updates.folderUpdates || {};
  const collectionUpdates = updates.collectionUpdates || {};
  const globalUpdates = updates.globalUpdates || {};

  if (collectionId && Object.keys(collectionUpdates).length > 0) {
    const entries = getCollectionVariableEntries(collectionId);
    await saveCollectionVariables(collectionId, mergeCollectionVariableEntries(entries, collectionUpdates));
  }

  if (collectionId && itemId && Object.keys(folderUpdates).length > 0) {
    const parentFolder = getImmediateParentFolderItem(collectionId, itemId);
    if (parentFolder) {
      const entries = getCollectionItemVariableEntries(collectionId, parentFolder.id);
      await saveCollectionItemVariables(collectionId, parentFolder.id, mergeCollectionVariableEntries(entries, folderUpdates));
    }
  }

  const envStore = useEnvStore.getState();
  if (envStore.activeEnvId && Object.keys(envUpdates).length > 0) {
    if (!envStore.variables[envStore.activeEnvId]) {
      await envStore.fetchVariables(envStore.activeEnvId);
    }

    const nextEntries = mergeEnvironmentVariableEntries(
      useEnvStore.getState().variables[envStore.activeEnvId] || [],
      envUpdates,
      envStore.activeEnvId
    );
    await useEnvStore.getState().saveVariables(envStore.activeEnvId, nextEntries);
  }

  if (Object.keys(globalUpdates).length > 0) {
    await envStore.fetchGlobalVariables();
    const nextEntries = mergeGlobalVariableEntries(useEnvStore.getState().globalVariables, globalUpdates);
    await useEnvStore.getState().saveGlobalVars(nextEntries);
  }
}
