import { invoke } from "@tauri-apps/api/core";
import type {
  ContentProvider,
  CurseforgeModDetails,
  ModrinthContentType,
  ProjectDetail,
} from "./types";

type ModrinthProjectFull = {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url: string | null;
  downloads: number;
  followers: number;
  project_type: string;
  categories: string[];
  gallery?: {
    url: string;
    title?: string | null;
    featured?: boolean;
  }[];
  source_url?: string | null;
  issues_url?: string | null;
  wiki_url?: string | null;
  discord_url?: string | null;
  donation_urls?: { id: string; platform: string; url: string }[];
  team?: string;
};

export async function fetchProjectDetail(
  provider: ContentProvider,
  projectKey: string,
  contentType: ModrinthContentType,
  fallback?: {
    slug?: string;
    title?: string;
    description?: string;
    icon_url?: string | null;
    author?: string;
    downloads?: number;
    follows?: number;
  },
): Promise<ProjectDetail> {
  if (provider === "modrinth") {
    const res = await fetch(
      `https://api.modrinth.com/v2/project/${projectKey}`,
    );
    if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
    const data: ModrinthProjectFull = await res.json();
    return {
      key: data.id,
      slug: data.slug,
      title: data.title,
      summary: data.description || fallback?.description || "",
      body: data.body || data.description || "",
      bodyFormat: "markdown",
      icon_url: data.icon_url,
      downloads: data.downloads,
      follows: data.followers ?? 0,
      author: fallback?.author || "—",
      project_type: data.project_type || contentType,
      categories: (data.categories || []).filter(Boolean),
      gallery: (data.gallery || []).map((g) => ({
        url: g.url,
        title: g.title,
      })),
      links: {
        website: `https://modrinth.com/${data.project_type}/${data.slug}`,
        wiki: data.wiki_url,
        issues: data.issues_url,
        source: data.source_url,
        discord: data.discord_url,
      },
    };
  }

  const data = await invoke<CurseforgeModDetails>("curseforge_get_mod", {
    modId: Number(projectKey),
  });
  return {
    key: String(data.id),
    slug: fallback?.slug || String(data.id),
    title: data.name,
    summary: data.summary || fallback?.description || "",
    body: data.description || data.summary || "",
    bodyFormat: "html",
    icon_url: data.thumbnailUrl,
    downloads: data.downloadCount,
    follows: 0,
    author: data.author || fallback?.author || "—",
    project_type: contentType,
    categories: (data.categories || []).map((c) => c.name),
    gallery: (data.screenshots || []).map((s) => ({
      url: s.url,
      title: s.title,
    })),
    links: {
      website: data.websiteUrl,
      wiki: data.wikiUrl,
      issues: data.issuesUrl,
      source: data.sourceUrl,
    },
  };
}
