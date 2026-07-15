/**
 * Connection Registry — tracks active backend connections per tool session.
 * Used to warn users before closing a session that has live connections.
 */

type ConnRecord = {
  label: string;  // human-readable description, e.g. "TCP 127.0.0.1:8080"
};

const registry = new Map<string, Map<string, ConnRecord>>();

/** Register an active connection. Call when connected/opened. */
export function registerConnection(sessionKey: string, connId: string, label: string): void {
  if (!registry.has(sessionKey)) registry.set(sessionKey, new Map());
  registry.get(sessionKey)!.set(connId, { label });
}

/** Unregister a connection after the backend handle is disconnected/closed. */
export function unregisterConnection(sessionKey: string, connId: string): void {
  registry.get(sessionKey)?.delete(connId);
  if (registry.get(sessionKey)?.size === 0) registry.delete(sessionKey);
}

/** Returns whether a specific backend handle is registered for this session. */
export function isConnectionRegistered(sessionKey: string, connId: string): boolean {
  return registry.get(sessionKey)?.has(connId) ?? false;
}

/** Forget all handles owned by one session key after centralized cleanup. */
export function clearConnections(sessionKey: string): void {
  registry.delete(sessionKey);
}

/** Forget all handles owned by a group of related session keys. */
export function clearConnectionsForKeys(sessionKeys: Iterable<string>): void {
  for (const sessionKey of sessionKeys) clearConnections(sessionKey);
}

/** Returns true if the session has any active connections. */
export function hasActiveConnections(sessionKey: string): boolean {
  return (registry.get(sessionKey)?.size ?? 0) > 0;
}

export function hasActiveConnectionsForKeys(sessionKeys: string[]): boolean {
  return sessionKeys.some((sessionKey) => hasActiveConnections(sessionKey));
}

/** Returns a list of active connection labels for display in a warning. */
export function getActiveConnectionLabels(sessionKey: string): string[] {
  const map = registry.get(sessionKey);
  if (!map) return [];
  return Array.from(map.values()).map((r) => r.label);
}

export function getActiveConnectionLabelsForKeys(sessionKeys: string[]): string[] {
  return sessionKeys.flatMap((sessionKey) => getActiveConnectionLabels(sessionKey));
}
