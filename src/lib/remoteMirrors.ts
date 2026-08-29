const LAUNCHER_NEWS_OWNER = "16steyy";
const LAUNCHER_NEWS_REPO = "16Launcher-News";
const LAUNCHER_NEWS_BRANCH = "main";

export const LAUNCHER_NEWS_CDN_BASE =
  `https://cdn.jsdelivr.net/gh/${LAUNCHER_NEWS_OWNER}/${LAUNCHER_NEWS_REPO}@${LAUNCHER_NEWS_BRANCH}/`;

export const LAUNCHER_NEWS_RAW_BASE =
  `https://raw.githubusercontent.com/${LAUNCHER_NEWS_OWNER}/${LAUNCHER_NEWS_REPO}/${LAUNCHER_NEWS_BRANCH}/`;

const LAUNCHER_NEWS_MIRROR_BASES = [LAUNCHER_NEWS_RAW_BASE, LAUNCHER_NEWS_CDN_BASE];

export const REMOTE_FETCH_TIMEOUT_MS = 5_000;

/** @deprecated Use resolveLauncherNewsAssetUrl */
export const BANNER_BASE_URL = LAUNCHER_NEWS_RAW_BASE;

export function buildLauncherNewsUrls(
  relativePath: string,
  options?: { cacheBust?: boolean },
): string[] {
  const clean = relativePath.replace(/^\.?\//, "");
  const cacheBust = options?.cacheBust !== false ? `?t=${Date.now()}` : "";
  return LAUNCHER_NEWS_MIRROR_BASES.map((base) => `${base}${clean}${cacheBust}`);
}

export function resolveLauncherNewsAssetUrl(url: string): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `${LAUNCHER_NEWS_RAW_BASE}${trimmed.replace(/^\.?\//, "")}`;
}

export async function fetchFirstAvailableMirror(
  urls: string[],
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS;
  let lastError: unknown = null;
  const { timeoutMs: _timeout, ...fetchInit } = init ?? {};

  for (const url of urls) {
    if (fetchInit.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    fetchInit.signal?.addEventListener("abort", onParentAbort);

    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
        cache: fetchInit.cache ?? "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return response;
    } catch (error) {
      if (fetchInit.signal?.aborted) {
        throw error instanceof DOMException
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      lastError = error;
    } finally {
      window.clearTimeout(timeoutId);
      fetchInit.signal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastError ?? new Error("All mirrors failed");
}
