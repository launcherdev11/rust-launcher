export const SETTINGS_SEARCH_EVENT = "launcher:settings-search";

let pending: string | null = null;

export function requestSettingsSearch(query: string) {
  pending = query;
  window.dispatchEvent(new CustomEvent<string>(SETTINGS_SEARCH_EVENT, { detail: query }));
}

export function takePendingSettingsSearch(): string | null {
  const q = pending;
  pending = null;
  return q;
}
