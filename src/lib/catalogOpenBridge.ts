import type { ContentProvider, ModrinthContentType } from "../tabs/mods/types";

export type CatalogOpenRequest =
  | {
      kind: "project";
      provider: ContentProvider;
      contentType: ModrinthContentType;
      key: string;
    }
  | {
      kind: "browse";
      contentType: ModrinthContentType;
    };

export const CATALOG_OPEN_EVENT = "launcher:catalog-open";

let pending: CatalogOpenRequest | null = null;

export function requestCatalogOpen(request: CatalogOpenRequest) {
  pending = request;
  window.dispatchEvent(new CustomEvent<CatalogOpenRequest>(CATALOG_OPEN_EVENT, { detail: request }));
}

export function takePendingCatalogOpen(): CatalogOpenRequest | null {
  const request = pending;
  pending = null;
  return request;
}
