import { readDataCache, writeDataCache } from "./launcherDataCache";
import {
  buildLauncherNewsUrls,
  fetchFirstAvailableMirror,
  resolveLauncherNewsAssetUrl,
} from "./remoteMirrors";

export type LauncherBannerData = {
  type?: string;
  imageUrl: string;
  title?: string;
  subtitle?: string;
  link?: string;
  ip?: string;
};

type LauncherBannerResponse =
  | LauncherBannerData
  | LauncherBannerData[]
  | { banners: LauncherBannerData[] };

export { BANNER_BASE_URL } from "./remoteMirrors";

const BANNER_CACHE_KEY = "play-banners";

export function resolveBannerImageUrl(url: string): string {
  return resolveLauncherNewsAssetUrl(url);
}

export function normalizeBannerServerIp(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let ip = raw.trim();
  if (!ip) return "";
  ip = ip.replace(/^https?:\/\//i, "");
  const cut = ip.search(/[/?#]/);
  if (cut >= 0) ip = ip.slice(0, cut);
  return ip.trim();
}

export function bannerServerAddress(banner: LauncherBannerData): string {
  const extra = banner as Record<string, unknown>;
  return (
    normalizeBannerServerIp(banner.ip) ||
    normalizeBannerServerIp(extra.IP) ||
    normalizeBannerServerIp(extra.Ip) ||
    normalizeBannerServerIp(extra.serverIp)
  );
}

export function isPopupBanner(banner: LauncherBannerData): boolean {
  return String(banner.type ?? "")
    .trim()
    .toLowerCase() === "popup";
}

export function isCarouselBanner(banner: LauncherBannerData): boolean {
  return !isPopupBanner(banner);
}

export function repairLooseJson(text: string): string {
  return text
    .replace(/("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(\s*\r?\n\s*)(?=")/g, "$1,$2")
    .replace(/(})(\s*\r?\n\s*)(?=\{)/g, "$1,$2")
    .replace(/(\])(\s*\r?\n\s*)(?=\[)/g, "$1,$2");
}

function parseBannerJson(text: string): LauncherBannerResponse {
  try {
    return JSON.parse(text) as LauncherBannerResponse;
  } catch {
    return JSON.parse(repairLooseJson(text)) as LauncherBannerResponse;
  }
}

function normalizeBanners(raw: LauncherBannerResponse): LauncherBannerData[] {
  let parsed: LauncherBannerData[] = [];

  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (raw && "banners" in raw && Array.isArray(raw.banners)) {
    parsed = raw.banners;
  } else if (raw && typeof raw === "object" && "imageUrl" in raw) {
    parsed = [raw as LauncherBannerData];
  }

  return parsed
    .filter((b) => typeof b?.imageUrl === "string" && b.imageUrl.trim().length > 0)
    .map((b) => {
      const ip = bannerServerAddress(b);
      const type =
        typeof b.type === "string" && b.type.trim() ? b.type.trim() : undefined;
      return {
        ...b,
        ...(type ? { type } : {}),
        ...(ip ? { ip } : {}),
      };
    });
}

export async function fetchLauncherBanners(
  signal?: AbortSignal,
): Promise<LauncherBannerData[]> {
  const response = await fetchFirstAvailableMirror(
    buildLauncherNewsUrls("banner.json"),
    { signal },
  );
  const text = await response.text();
  let parsed: LauncherBannerData[];
  try {
    parsed = normalizeBanners(parseBannerJson(text));
  } catch (parseErr) {
    const loose = text.replace(/"(\s*\r?\n\s*)"/g, '",$1"');
    parsed = normalizeBanners(JSON.parse(loose) as LauncherBannerResponse);
    if (!parsed.length) throw parseErr;
  }
  if (!parsed.length) {
    throw new Error("Invalid banner format");
  }
  writeDataCache(BANNER_CACHE_KEY, parsed);
  return parsed;
}

export function createFallbackUpdatePopupBanner(): LauncherBannerData {
  return {
    type: "popup",
    imageUrl: "2.1.0.png",
    title: "Обновление",
    subtitle: "Тестовый preview popup",
    link: "https://16-launcher.ru/news/update-2-1-0",
  };
}

export function readCachedLauncherBanners(
  maxAgeMs = 300_000,
): LauncherBannerData[] | null {
  return readDataCache<LauncherBannerData[]>(BANNER_CACHE_KEY, maxAgeMs);
}

export function pickUpdatePopupBanner(
  banners: LauncherBannerData[],
): LauncherBannerData | null {
  return banners.find(isPopupBanner) ?? null;
}
