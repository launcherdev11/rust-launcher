import type { DownloadJobKind } from "../../hooks/useDownloadJobs";
import type { Language } from "../../i18n";

export type ModrinthContentType = "mod" | "resourcepack" | "shader" | "modpack";
export type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader";
export type ContentProvider = "modrinth" | "curseforge";
export type CatalogSort =
  | "relevance"
  | "downloads"
  | "updated"
  | "newest"
  | "popularity";
export type SideSupport = "any" | "required" | "optional" | "unsupported";
export type CatalogSourceTab = "catalog" | "recent";
export type NotificationKind = "info" | "success" | "error" | "warning";
export type LoaderFilter = "forge" | "fabric" | "quilt" | "neoforge" | "any";

export type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: ModrinthProjectType;
  categories?: string[];
};

export type ModrinthSearchResponse = {
  hits: ModrinthProject[];
  limit: number;
  offset: number;
  total_hits: number;
};

export type ModrinthFile = {
  url: string;
  filename: string;
  primary?: boolean;
};

export type ModrinthVersion = {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  date_published: string;
};

export type CurseforgeModHit = {
  id: number;
  slug: string;
  name: string;
  summary: string;
  downloadCount: number;
  thumbnailUrl: string | null;
  author: string;
  classId: number;
};

export type CurseforgeFileHit = {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl: string | null;
  gameVersions: string[];
  loaders: string[];
  fileDate: string;
};

export type CurseforgeCategoryHit = {
  id: number;
  name: string;
  slug: string;
  iconUrl?: string | null;
};

export type CurseforgeScreenshot = {
  url: string;
  title?: string | null;
};

export type CurseforgeModDetails = {
  id: number;
  name: string;
  summary: string;
  description: string;
  downloadCount: number;
  thumbnailUrl: string | null;
  author: string;
  websiteUrl?: string | null;
  wikiUrl?: string | null;
  issuesUrl?: string | null;
  sourceUrl?: string | null;
  categories: CurseforgeCategoryHit[];
  screenshots: CurseforgeScreenshot[];
};

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
};

export type CatalogProject = {
  key: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: string;
};

export type CatalogVersion = {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  file_url: string;
  filename: string;
};

export type GalleryItem = {
  url: string;
  title?: string | null;
};

export type ProjectDetail = {
  key: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  bodyFormat: "markdown" | "html";
  icon_url: string | null;
  downloads: number;
  follows: number;
  author: string;
  project_type: string;
  categories: string[];
  gallery: GalleryItem[];
  links: {
    website?: string | null;
    wiki?: string | null;
    issues?: string | null;
    source?: string | null;
    discord?: string | null;
  };
};

export type SavedCatalogItem = {
  provider: ContentProvider;
  id: string;
  slug: string;
  title: string;
  iconUrl: string | null;
  contentType: ModrinthContentType;
  savedAt: number;
};

export type MrpackImportProgressPayload = {
  phase: string;
  current?: number;
  total?: number;
  message?: string | null;
};

export type ModsTabProps = {
  showNotification: (
    kind: NotificationKind,
    message: string,
    options?: { sound?: boolean },
  ) => void;
  language: Language;
  activeProfileId?: string | null;
  activeProfileGameVersion?: string | null;
  activeProfileLoader?: string | null;
  onOpenModpacksTab?: () => void;
  onSelectedModTitleChange?: (title: string | null) => void;
  fillPane?: boolean;
  registerDownloadJob?: (params: {
    id: string;
    label: string;
    kind: DownloadJobKind;
    percent?: number | null;
  }) => void;
  updateDownloadJob?: (id: string, percent: number | null) => void;
  finishDownloadJob?: (id: string) => void;
  makeDownloadJobId?: (prefix: string) => string;
};

export const CATALOG_PAGE_SIZE = 30;

export const MODRINTH_LOADER_CATEGORY_SLUGS = new Set([
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "liteloader",
  "modloader",
  "rift",
  "datapack",
  "iris",
  "optifine",
  "canvas",
  "vanilla",
]);

export function modrinthProjectUrl(
  projectType: ModrinthProjectType | string,
  slug: string,
): string {
  return `https://modrinth.com/${projectType}/${slug}`;
}

export function curseforgeProjectUrl(
  slug: string,
  contentType: ModrinthContentType,
): string {
  const segment =
    contentType === "resourcepack"
      ? "texture-packs"
      : contentType === "shader"
        ? "customization"
        : contentType === "modpack"
          ? "modpacks"
          : "mc-mods";
  return `https://www.curseforge.com/minecraft/${segment}/${slug}`;
}

export function mapContentTypeToCategory(t: ModrinthContentType): string {
  if (t === "mod") return "mods";
  if (t === "resourcepack") return "resourcepacks";
  if (t === "shader") return "shaderpacks";
  return "";
}

export function invokeErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim().length > 0) return e;
  if (e instanceof Error && e.message.trim().length > 0) return e.message;
  return fallback;
}

export function isDownloadCancelledMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    msg.includes("отменена") ||
    lower.includes("cancelled") ||
    lower.includes("canceled")
  );
}

export function sortToCurseforgeField(sort: CatalogSort): number {
  switch (sort) {
    case "relevance":
      return 1;
    case "popularity":
      return 2;
    case "updated":
      return 3;
    case "newest":
      return 11;
    case "downloads":
    default:
      return 6;
  }
}

export function sortToModrinthIndex(sort: CatalogSort): string {
  switch (sort) {
    case "relevance":
      return "relevance";
    case "updated":
      return "updated";
    case "newest":
      return "newest";
    case "popularity":
    case "downloads":
    default:
      return "downloads";
  }
}
