import type { CatalogSourceTab, LoaderFilter, ModrinthContentType, SideSupport } from "./types";

export type CatalogSession = {
  contentType: ModrinthContentType;
  search: string;
  selectedCategories: string[];
  clientSide: SideSupport;
  serverSide: SideSupport;
  installedOnly: boolean;
  sourceTab: CatalogSourceTab;
  page: number;
  gameVersion: string;
  loader: LoaderFilter;
  scrollTop: number;
};

let session: Partial<CatalogSession> = {};

export function readCatalogSession(): Partial<CatalogSession> {
  return session;
}

export function patchCatalogSession(patch: Partial<CatalogSession>) {
  session = { ...session, ...patch };
}
