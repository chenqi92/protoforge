// ProtoForge Collection Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { Collection, CollectionItem } from '@/types/collections';
import type { SwaggerDiscoveryResult, SwaggerParseResult, SwaggerEndpoint } from '@/types/swagger';

export async function listCollections(): Promise<Collection[]> {
  return invoke<Collection[]>('list_collections');
}

export async function createCollection(collection: Collection): Promise<Collection> {
  return invoke<Collection>('create_collection', { collection });
}

export async function updateCollection(collection: Collection): Promise<void> {
  await invoke('update_collection', { collection });
}

export async function deleteCollection(id: string): Promise<void> {
  await invoke('delete_collection', { id });
}

export async function exportCollection(id: string): Promise<string> {
  return invoke<string>('export_collection', { id });
}

export async function importCollection(json: string): Promise<Collection> {
  return invoke<Collection>('import_collection', { json });
}

// ── Collection Items ──

export async function listCollectionItems(collectionId: string): Promise<CollectionItem[]> {
  return invoke<CollectionItem[]>('list_collection_items', { collectionId });
}

export async function createCollectionItem(item: CollectionItem): Promise<CollectionItem> {
  return invoke<CollectionItem>('create_collection_item', { item });
}

export async function updateCollectionItem(item: CollectionItem): Promise<void> {
  await invoke('update_collection_item', { item });
}

export async function deleteCollectionItem(id: string): Promise<void> {
  await invoke('delete_collection_item', { id });
}

// ── Postman Import / Export ──

export async function importPostmanCollection(json: string): Promise<Collection> {
  return invoke<Collection>('import_postman_collection', { json });
}

export async function exportPostmanCollection(id: string): Promise<string> {
  return invoke<string>('export_postman_collection', { id });
}

// ── Swagger Import ──

export async function fetchSwagger(url: string): Promise<SwaggerDiscoveryResult> {
  return invoke<SwaggerDiscoveryResult>('fetch_swagger', { url });
}

export async function fetchSwaggerGroup(url: string): Promise<SwaggerParseResult> {
  return invoke<SwaggerParseResult>('fetch_swagger_group', { url });
}

export async function importSwaggerEndpoints(
  collectionName: string,
  baseUrl: string,
  endpoints: SwaggerEndpoint[],
): Promise<Collection> {
  return invoke<Collection>('import_swagger_endpoints', { collectionName, baseUrl, endpoints });
}

// ── Save Request ──

export async function saveRequestToCollection(item: CollectionItem): Promise<CollectionItem> {
  return invoke<CollectionItem>('save_request_to_collection', { item });
}

// ── Deduplicate ──

export async function deduplicateCollectionItems(collectionId: string): Promise<number> {
  return invoke<number>('deduplicate_collection_items', { collectionId });
}
