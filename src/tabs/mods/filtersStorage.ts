import type { SavedCatalogItem } from "./types";

const FAVORITES_KEY = "mods_favorites";
const RECENT_KEY = "mods_recent";
const SORT_KEY = "mods_sort";
const MAX_RECENT = 20;

function readList(key: string): SavedCatalogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCatalogItem =>
        item &&
        typeof item === "object" &&
        typeof item.provider === "string" &&
        typeof item.id === "string" &&
        typeof item.title === "string",
    );
  } catch {
    return [];
  }
}

function writeList(key: string, items: SavedCatalogItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
  }
}

export function loadFavorites(): SavedCatalogItem[] {
  return readList(FAVORITES_KEY);
}

export function saveFavorites(items: SavedCatalogItem[]) {
  writeList(FAVORITES_KEY, items);
}

export function toggleFavorite(item: SavedCatalogItem): SavedCatalogItem[] {
  const current = loadFavorites();
  const idx = current.findIndex(
    (f) => f.provider === item.provider && f.id === item.id,
  );
  let next: SavedCatalogItem[];
  if (idx >= 0) {
    next = current.filter((_, i) => i !== idx);
  } else {
    next = [{ ...item, savedAt: Date.now() }, ...current];
  }
  saveFavorites(next);
  return next;
}

export function isFavorite(
  favorites: SavedCatalogItem[],
  provider: string,
  id: string,
): boolean {
  return favorites.some((f) => f.provider === provider && f.id === id);
}

export function loadRecent(): SavedCatalogItem[] {
  return readList(RECENT_KEY);
}

export function clearRecent(): SavedCatalogItem[] {
  writeList(RECENT_KEY, []);
  return [];
}

export function pushRecent(item: SavedCatalogItem): SavedCatalogItem[] {
  const current = loadRecent().filter(
    (r) => !(r.provider === item.provider && r.id === item.id),
  );
  const next = [{ ...item, savedAt: Date.now() }, ...current].slice(0, MAX_RECENT);
  writeList(RECENT_KEY, next);
  return next;
}

export function loadStoredSort(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SORT_KEY);
  } catch {
    return null;
  }
}

export function saveStoredSort(sort: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_KEY, sort);
  } catch {
  }
}
