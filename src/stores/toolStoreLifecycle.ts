export type DetachedToolRelease = () => Promise<void>;

type ToolStoreDetacher = (sessionId: string) => DetachedToolRelease | undefined;

const detachers = new Map<string, ToolStoreDetacher>();

/** Register a synchronous frontend-store detach hook without coupling appStore
 * to each lazily loaded workspace store (and pulling those stores into startup). */
export function registerToolStoreDetacher(tool: string, detacher: ToolStoreDetacher): void {
  detachers.set(tool, detacher);
}

/** Detach the exact current store incarnation before asynchronous backend cleanup. */
export function detachToolStore(tool: string, sessionId: string): DetachedToolRelease | undefined {
  return detachers.get(tool)?.(sessionId);
}
