import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstanceProfileCard } from "../../app/types";
import type { CatalogOpenRequest } from "../../lib/catalogOpenBridge";
import type { ProfileContentFocus, ProfileContentTab } from "../../lib/profileContentFocusBridge";
import { searchCurseforgeCatalog, searchModrinthCatalog, type SearchCatalogParams } from "../../tabs/mods/catalogApi";
import type { CurseforgeModHit, ModrinthProject } from "../../tabs/mods/types";
import type { PaletteCommand } from "./matching";

type Tt = (key: string, vars?: Record<string, string | number>) => string;

type InstalledContentEntry = {
  profileId: string;
  category: ProfileContentTab;
  filename: string;
  title?: string;
  source?: string;
  enabled: boolean;
};

export type PaletteContentSearchDeps = {
  tt: Tt;
  profiles: InstanceProfileCard[];
  openProfileContent: (focus: ProfileContentFocus) => void;
  openCatalogProject: (request: CatalogOpenRequest) => void;
};

const CATALOG_MIN_QUERY = 2;
const CATALOG_DEBOUNCE_MS = 350;
const CATALOG_PER_PROVIDER = 5;

export const PROVIDER_LOGOS: Record<string, string> = {
  modrinth: "/launcher-assets/modrinth.svg",
  curseforge: "/launcher-assets/curseforge.svg",
};

function catalogParams(provider: "modrinth" | "curseforge", query: string, signal: AbortSignal): SearchCatalogParams {
  return {
    provider,
    contentType: "mod",
    query,
    gameVersion: "",
    loader: "any",
    page: 0,
    sort: "relevance",
    categoryIds: [],
    clientSide: "any",
    serverSide: "any",
    signal,
  };
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function usePaletteContentSearch(open: boolean, query: string, deps: PaletteContentSearchDeps) {
  const { tt, profiles, openProfileContent, openCatalogProject } = deps;
  const [index, setIndex] = useState<InstalledContentEntry[]>([]);
  const [catalog, setCatalog] = useState<PaletteCommand[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    invoke<InstalledContentEntry[]>("list_installed_content_index")
      .then((entries) => {
        if (!cancelled) setIndex(entries);
      })
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const contentCommands = useMemo(() => {
    const nameById = new Map(profiles.map((p) => [p.id, p.name]));
    const out: PaletteCommand[] = [];
    for (const entry of index) {
      const profileName = nameById.get(entry.profileId);
      if (!profileName) continue;
      const title = entry.title?.trim() || entry.filename;
      const parts = [profileName, tt(`modpacks.contentTabs.${entry.category}`)];
      if (!entry.enabled) parts.push(tt("commandPalette.contentDisabled"));
      out.push({
        id: `content:${entry.profileId}:${entry.category}:${entry.filename}`,
        group: "content",
        title,
        subtitle: parts.join(" · "),
        keywords: [entry.filename],
        badgeSrc: entry.source ? PROVIDER_LOGOS[entry.source] ?? null : null,
        transient: true,
        run: () =>
          openProfileContent({
            profileId: entry.profileId,
            contentTab: entry.category,
            query: title,
          }),
      });
    }
    return out;
  }, [index, profiles, tt, openProfileContent]);

  const trimmed = query.trim();

  useEffect(() => {
    if (!open || trimmed.length < CATALOG_MIN_QUERY) {
      setCatalog([]);
      setCatalogLoading(false);
      return;
    }
    const controller = new AbortController();
    setCatalogLoading(true);
    const timer = window.setTimeout(() => {
      const modrinth = searchModrinthCatalog(catalogParams("modrinth", trimmed, controller.signal)).then(
        (res) =>
          (res.hits as ModrinthProject[]).slice(0, CATALOG_PER_PROVIDER).map<PaletteCommand>((p) => ({
            id: `catalog:modrinth:${p.project_id}`,
            group: "catalog",
            title: p.title,
            subtitle: [tt("mods.provider.modrinth"), p.author, formatDownloads(p.downloads)].filter(Boolean).join(" · "),
            iconSrc: p.icon_url,
            badgeSrc: PROVIDER_LOGOS.modrinth,
            transient: true,
            run: () =>
              openCatalogProject({ kind: "project", provider: "modrinth", contentType: "mod", key: p.project_id }),
          })),
      );
      const curseforge = searchCurseforgeCatalog(catalogParams("curseforge", trimmed, controller.signal)).then(
        (res) =>
          (res.hits as CurseforgeModHit[]).slice(0, CATALOG_PER_PROVIDER).map<PaletteCommand>((p) => ({
            id: `catalog:curseforge:${p.id}`,
            group: "catalog",
            title: p.name,
            subtitle: [tt("mods.provider.curseforge"), p.author, formatDownloads(p.downloadCount)]
              .filter(Boolean)
              .join(" · "),
            iconSrc: p.thumbnailUrl,
            badgeSrc: PROVIDER_LOGOS.curseforge,
            transient: true,
            run: () =>
              openCatalogProject({ kind: "project", provider: "curseforge", contentType: "mod", key: String(p.id) }),
          })),
      );
      void Promise.allSettled([modrinth, curseforge]).then((results) => {
        if (controller.signal.aborted) return;
        const lists = results.map((r) => (r.status === "fulfilled" ? r.value : []));
        const merged: PaletteCommand[] = [];
        for (let i = 0; i < CATALOG_PER_PROVIDER; i++) {
          for (const list of lists) if (list[i]) merged.push(list[i]);
        }
        setCatalog(merged);
        setCatalogLoading(false);
      });
    }, CATALOG_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, trimmed, tt, openCatalogProject]);

  return { contentCommands, catalogCommands: catalog, catalogLoading };
}
