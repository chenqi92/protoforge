import type { CollectionItem } from "@/types/collections";
import type { HttpRequestConfig } from "@/types/http";

type CollectionRequestContent = Pick<
  CollectionItem,
  | "name"
  | "method"
  | "url"
  | "headers"
  | "queryParams"
  | "bodyType"
  | "bodyContent"
  | "authType"
  | "authConfig"
  | "preScript"
  | "postScript"
>;

function getBodyType(config: HttpRequestConfig): CollectionItem["bodyType"] {
  if (config.requestMode === "graphql") return "graphql";
  if (config.requestMode === "sse") return "sse";
  return config.bodyType;
}

function getBodyContent(config: HttpRequestConfig): string {
  if (config.requestMode === "graphql") {
    return JSON.stringify({
      query: config.graphqlQuery || "",
      variables: config.graphqlVariables || "",
    });
  }

  if (config.requestMode === "sse") {
    return "";
  }

  switch (config.bodyType) {
    case "json":
      return config.jsonBody || "";
    case "raw":
      return config.rawBody || "";
    case "formUrlencoded":
      return JSON.stringify(config.formFields || []);
    case "formData":
      return JSON.stringify(config.formDataFields || []);
    case "binary":
      return config.binaryFilePath || "";
    case "graphql":
      return JSON.stringify({
        query: config.graphqlQuery || "",
        variables: config.graphqlVariables || "",
      });
    default:
      return "";
  }
}

function getAuthConfig(config: HttpRequestConfig): string {
  return JSON.stringify({
    bearerToken: config.bearerToken,
    basicUsername: config.basicUsername,
    basicPassword: config.basicPassword,
    apiKeyName: config.apiKeyName,
    apiKeyValue: config.apiKeyValue,
    apiKeyAddTo: config.apiKeyAddTo,
  });
}

export function getCollectionRequestContent(
  config: HttpRequestConfig,
  name = config.name || "Untitled Request",
): CollectionRequestContent {
  return {
    name,
    method: config.method,
    url: config.url,
    headers: JSON.stringify(config.headers),
    queryParams: JSON.stringify(config.queryParams),
    bodyType: getBodyType(config),
    bodyContent: getBodyContent(config),
    authType: config.authType,
    authConfig: getAuthConfig(config),
    preScript: config.preScript,
    postScript: config.postScript,
  };
}

export function buildCollectionItemFromHttpConfig(params: {
  config: HttpRequestConfig;
  itemId: string;
  collectionId: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  name?: string;
  responseExample?: string;
}): CollectionItem {
  const { config, itemId, collectionId, parentId, sortOrder, createdAt, updatedAt, name, responseExample } = params;

  return {
    id: itemId,
    collectionId,
    parentId,
    itemType: "request",
    sortOrder,
    createdAt,
    updatedAt,
    responseExample: responseExample ?? '',
    ...getCollectionRequestContent(config, name),
  };
}

export function getCollectionRequestSignatureFromConfig(
  config: HttpRequestConfig,
  name = config.name || "Untitled Request",
): string {
  return JSON.stringify(getCollectionRequestContent(config, name));
}

export function getCollectionRequestSignatureFromItem(item: CollectionItem): string {
  return JSON.stringify({
    name: item.name,
    method: item.method,
    url: item.url,
    headers: item.headers,
    queryParams: item.queryParams,
    bodyType: item.bodyType,
    bodyContent: item.bodyContent,
    authType: item.authType,
    authConfig: item.authConfig,
    preScript: item.preScript,
    postScript: item.postScript,
  });
}
