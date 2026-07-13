type CacheEntry<T> = {
  value: T;
  at: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function readDataCache<T>(key: string, ttlMs: number): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) return null;
  return entry.value as T;
}

export function writeDataCache<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
}

export function invalidateDataCache(key: string): void {
  store.delete(key);
}

export function scheduleIdleWork(work: () => void, timeoutMs = 1500): () => void {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(work, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 0);
  return () => clearTimeout(id);
}
