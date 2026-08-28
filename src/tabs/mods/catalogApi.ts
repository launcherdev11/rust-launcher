import { invoke } from "@tauri-apps/api/core";
import {
  CATALOG_PAGE_SIZE,
  MODRINTH_LOADER_CATEGORY_SLUGS,
  sortToCurseforgeField,
  sortToModrinthIndex,
  type CatalogCategory,
  type CatalogSort,
  type ContentProvider,
  type CurseforgeCategoryHit,
  type CurseforgeFileHit,
  type CurseforgeModHit,
  type LoaderFilter,
  type ModrinthContentType,
  type ModrinthProject,
  type ModrinthSearchResponse,
  type ModrinthVersion,
  type SideSupport,
} from "./types";

export type SearchCatalogParams = {
  provider: ContentProvider;
  contentType: ModrinthContentType;
  query: string;
  gameVersion: string;
  loader: LoaderFilter;
  page: number;
  sort: CatalogSort;
  categoryIds: string[];
  clientSide: SideSupport;
  serverSide: SideSupport;
  signal?: AbortSignal;
};

export type SearchCatalogResult = {
  hits: ModrinthProject[] | CurseforgeModHit[];
  total: number;
};

export async function fetchModrinthCategories(
  contentType: ModrinthContentType,
  signal?: AbortSignal,
): Promise<CatalogCategory[]> {
  const res = await fetch("https://api.modrinth.com/v2/tag/category", {
    signal,
  });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
  const data: {
    name: string;
    icon?: string;
    project_type: string;
    header?: string;
  }[] = await res.json();

  return data
    .filter((c) => c.project_type === contentType)
    .filter((c) => !MODRINTH_LOADER_CATEGORY_SLUGS.has(c.name))
    .map((c) => ({
      id: c.name,
      name: c.name.replace(/-/g, " "),
      slug: c.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchCurseforgeCategories(
  contentType: ModrinthContentType,
): Promise<CatalogCategory[]> {
  const data = await invoke<CurseforgeCategoryHit[]>(
    "curseforge_list_categories",
    { contentType },
  );
  return (data ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    slug: c.slug || String(c.id),
  }));
}

export async function searchModrinthCatalog(
  params: SearchCatalogParams,
): Promise<SearchCatalogResult> {
  const facets: string[][] = [
    [`project_type:${params.contentType}`],
    [`versions:${params.gameVersion}`],
  ];

  if (params.contentType === "mod" && params.loader !== "any") {
    facets.push([`categories:${params.loader}`]);
  }

  for (const cat of params.categoryIds) {
    if (cat) facets.push([`categories:${cat}`]);
  }

  if (params.clientSide !== "any") {
    facets.push([`client_side:${params.clientSide}`]);
  }
  if (params.serverSide !== "any") {
    facets.push([`server_side:${params.serverSide}`]);
  }

  const searchParams = new URLSearchParams({
    limit: String(CATALOG_PAGE_SIZE),
    index: sortToModrinthIndex(params.sort),
    offset: String(params.page * CATALOG_PAGE_SIZE),
  });
  if (params.query.trim().length > 0) {
    searchParams.set("query", params.query.trim());
  }
  searchParams.set("facets", JSON.stringify(facets));

  const url = `https://api.modrinth.com/v2/search?${searchParams.toString()}`;
  const response = await fetch(url, { signal: params.signal });
  if (!response.ok) throw new Error(`Modrinth HTTP ${response.status}`);
  const data: ModrinthSearchResponse = await response.json();
  return { hits: data.hits, total: data.total_hits ?? data.hits.length };
}

export async function searchCurseforgeCatalog(
  params: SearchCatalogParams,
): Promise<SearchCatalogResult> {
  const categoryId =
    params.categoryIds.length > 0 ? Number(params.categoryIds[0]) : undefined;
  const data = await invoke<{
    hits: CurseforgeModHit[];
    index: number;
    pageSize: number;
    totalCount: number;
  }>("curseforge_search_mods", {
    contentType: params.contentType,
    searchFilter: params.query,
    gameVersion: params.gameVersion,
    loader: params.loader,
    index: params.page * CATALOG_PAGE_SIZE,
    pageSize: CATALOG_PAGE_SIZE,
    sortField: sortToCurseforgeField(params.sort),
    categoryId:
      categoryId != null && !Number.isNaN(categoryId) ? categoryId : null,
  });
  return {
    hits: data.hits,
    total: data.totalCount ?? data.hits.length,
  };
}

export async function fetchModrinthVersions(
  projectId: string,
  gameVersion: string,
  contentType: ModrinthContentType,
  loader: LoaderFilter,
  signal?: AbortSignal,
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams();
  if (gameVersion) {
    params.set("game_versions", JSON.stringify([gameVersion]));
  }
  if (contentType === "mod" && loader !== "any") {
    params.set("loaders", JSON.stringify([loader]));
  }
  const url = `https://api.modrinth.com/v2/project/${projectId}/version${
    params.size > 0 ? `?${params.toString()}` : ""
  }`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Modrinth HTTP ${response.status}`);
  return response.json();
}

export async function fetchCurseforgeVersions(
  modId: number,
  gameVersion: string,
  loader: LoaderFilter,
): Promise<CurseforgeFileHit[]> {
  return invoke<CurseforgeFileHit[]>("curseforge_get_mod_files", {
    modId,
    gameVersion,
    loader,
  });
}

export async function fetchGameVersions(
  provider: ContentProvider,
  signal?: AbortSignal,
): Promise<string[]> {
  if (provider === "curseforge") {
    return invoke<string[]>("curseforge_list_minecraft_versions");
  }
  const res = await fetch("https://api.modrinth.com/v2/tag/game_version", {
    signal,
  });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
  const data: { version: string; version_type: string }[] = await res.json();
  return data
    .filter((t) => t.version_type === "release")
    .map((t) => t.version);
}
