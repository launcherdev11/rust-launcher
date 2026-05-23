export type ProfileAvatarInput = {
  nickname: string;
  ely_username: string | null;
  ely_uuid: string | null;
  mc_uuid: string | null;
};

export function buildInitialAvatarDataUrl(label: string): string {
  const ch = (label.trim().charAt(0) || "?").toUpperCase();
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b2648"/>
      <stop offset="100%" stop-color="#102f55"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="32" fill="url(#g)"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" fill="#d7e7ff" font-family="Inter,Segoe UI,Arial" font-size="28" font-weight="700">${ch}</text>
</svg>
`.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type AvatarCacheEntry = {
  src: string;
  expiresAt: number;
};

type ElyAvatarCommandResponse = string | null;

const AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ELY_AVATAR_CACHE_PREFIX = "ely_avatar_cache_v1:";
const memoryCache = new Map<string, AvatarCacheEntry>();

function normalizeCacheKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function getDiskCache(cacheKey: string): AvatarCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${ELY_AVATAR_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const entry = parsed as Partial<AvatarCacheEntry>;
    if (typeof entry.src !== "string" || typeof entry.expiresAt !== "number") return null;
    if (entry.expiresAt <= Date.now()) {
      window.localStorage.removeItem(`${ELY_AVATAR_CACHE_PREFIX}${cacheKey}`);
      return null;
    }
    return { src: entry.src, expiresAt: entry.expiresAt };
  } catch (error) {
    console.debug("[avatar] failed to read Ely disk cache", error);
    return null;
  }
}

function putCache(cacheKey: string, src: string): void {
  const entry: AvatarCacheEntry = { src, expiresAt: Date.now() + AVATAR_CACHE_TTL_MS };
  memoryCache.set(cacheKey, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${ELY_AVATAR_CACHE_PREFIX}${cacheKey}`, JSON.stringify(entry));
  } catch (error) {
    console.debug("[avatar] failed to persist Ely disk cache", error);
  }
}

function getCachedAvatarSrc(cacheKey: string): string | null {
  const inMemory = memoryCache.get(cacheKey);
  if (inMemory && inMemory.expiresAt > Date.now()) return inMemory.src;
  if (inMemory) memoryCache.delete(cacheKey);

  const diskEntry = getDiskCache(cacheKey);
  if (!diskEntry) return null;
  memoryCache.set(cacheKey, diskEntry);
  return diskEntry.src;
}

function createNearestNeighborCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create 2D context");
  }
  ctx.imageSmoothingEnabled = false;
  return canvas;
}

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Skin request failed: ${response.status}`);
  }
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

export function resolveAvatarKey(profile: ProfileAvatarInput): string | null {
  const elyUsername = profile.ely_username?.trim();
  if (elyUsername) return elyUsername;
  const legacyNickname = profile.nickname?.trim();
  if (legacyNickname) return legacyNickname;
  return null;
}

export function buildElySkinUrl(username: string): string {
  return `https://skinsystem.ely.by/skins/${encodeURIComponent(username)}.png`;
}

export async function getElyAvatarByUsername(
  username: string,
  fallbackSrc: string,
  size: number = 64,
): Promise<string> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) return fallbackSrc;

  const cacheKey = normalizeCacheKey(normalizedUsername);
  const cached = getCachedAvatarSrc(cacheKey);
  if (cached) return cached;

  try {
    let avatarSrc: string | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      avatarSrc = await invoke<ElyAvatarCommandResponse>("get_ely_avatar", {
        username: normalizedUsername,
      });
    } catch (error) {
      console.debug("[avatar] Rust Ely avatar command unavailable, using frontend crop", error);
    }

    if (!avatarSrc) {
      avatarSrc = await buildAvatarFromSkin(buildElySkinUrl(normalizedUsername), size);
    }
    if (!avatarSrc) return fallbackSrc;

    putCache(cacheKey, avatarSrc);
    return avatarSrc;
  } catch (error) {
    console.debug("[avatar] Ely skin avatar failed, falling back", error);
    return fallbackSrc;
  }
}

export async function buildAvatarFromSkin(
  skinUrl: string,
  size: number = 64,
): Promise<string> {
  const bitmap = await loadImageBitmap(skinUrl);
  try {
    if (bitmap.width < 64 || bitmap.height < 16) {
      throw new Error(`Unexpected skin size ${bitmap.width}x${bitmap.height}`);
    }

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 8;
    sourceCanvas.height = 8;
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!sourceCtx) {
      throw new Error("Failed to create source canvas context");
    }
    sourceCtx.imageSmoothingEnabled = false;

    sourceCtx.clearRect(0, 0, 8, 8);
    sourceCtx.drawImage(bitmap, 8, 8, 8, 8, 0, 0, 8, 8);
    sourceCtx.drawImage(bitmap, 40, 8, 8, 8, 0, 0, 8, 8);

    const outCanvas = createNearestNeighborCanvas(size);
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) {
      throw new Error("Failed to create output canvas context");
    }
    outCtx.drawImage(sourceCanvas, 0, 0, 8, 8, 0, 0, size, size);
    return outCanvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export async function getAvatarSrc(
  profile: ProfileAvatarInput,
  fallbackSrc: string,
  size: number = 64,
): Promise<string> {
  const elyKeyRaw = resolveAvatarKey(profile);
  if (elyKeyRaw) {
    const src = await getElyAvatarByUsername(elyKeyRaw, fallbackSrc, size);
    if (src !== fallbackSrc) return src;
  }

  const mcUuid = profile.mc_uuid?.trim().replace(/-/g, "");
  const elyUuid = profile.ely_uuid?.trim().replace(/-/g, "");
  const uuid = mcUuid || elyUuid;
  if (uuid) {
    return `https://crafatar.com/renders/head/${uuid}?scale=6&default=MHF_Steve`;
  }

  return fallbackSrc;
}
