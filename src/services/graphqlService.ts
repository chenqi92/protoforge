// ProtoForge GraphQL Service — Schema Introspection

import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/stores/settingsStore';
import type { GqlSchema, IntrospectionResult } from '@/types/graphql';

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          args {
            name
            description
            type { ...TypeRef }
            defaultValue
          }
          type { ...TypeRef }
          isDeprecated
          deprecationReason
        }
        inputFields {
          name
          description
          type { ...TypeRef }
          defaultValue
        }
        interfaces { ...TypeRef }
        enumValues(includeDeprecated: true) {
          name
          description
          isDeprecated
          deprecationReason
        }
        possibleTypes { ...TypeRef }
      }
      directives {
        name
        description
        locations
        args {
          name
          description
          type { ...TypeRef }
          defaultValue
        }
      }
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Send an introspection query to a GraphQL endpoint and parse the result.
 * Uses the same Tauri HTTP backend as regular requests.
 */
export async function fetchIntrospection(
  url: string,
  headers?: Record<string, string>,
): Promise<IntrospectionResult> {
  const settings = useSettingsStore.getState().settings;

  const requestPayload = {
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    queryParams: {},
    body: {
      type: 'json',
      data: JSON.stringify({ query: INTROSPECTION_QUERY }),
    },
    auth: null,
    timeoutMs: settings.defaultTimeoutMs,
    followRedirects: settings.followRedirects,
    maxRedirects: settings.maxRedirects,
    sslVerify: settings.sslVerify,
    proxy: settings.proxyEnabled
      ? {
          type: settings.proxyType,
          host: settings.proxyHost,
          port: settings.proxyPort,
          auth: settings.proxyAuth
            ? { username: settings.proxyUsername, password: settings.proxyPassword }
            : null,
        }
      : null,
  };

  const resp = await invoke<{ status: number; body: string }>('send_request', {
    request: requestPayload,
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Introspection failed: HTTP ${resp.status}`);
  }

  const json = JSON.parse(resp.body);
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join('; '));
  }

  const schema = json.data?.__schema as GqlSchema | undefined;
  if (!schema) {
    throw new Error('Invalid introspection response: missing __schema');
  }

  return {
    schema,
    fetchedAt: Date.now(),
    url,
  };
}
