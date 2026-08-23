export type McCape = {
  id: string;
  alias: string;
  url: string;
  state: "ACTIVE" | "INACTIVE";
};

export async function fetchMcCapes(): Promise<McCape[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<McCape[]>("list_mc_capes");
  return raw.map((c) => ({
    ...c,
    state: c.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
  }));
}

export async function selectMcCape(capeId: string | null): Promise<McCape[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<McCape[]>("set_mc_active_cape", { capeId });
  return raw.map((c) => ({
    ...c,
    state: c.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
  }));
}

export function findActiveMcCape(capes: McCape[]): McCape | null {
  return capes.find((c) => c.state === "ACTIVE") ?? null;
}

const THUMB_W = 56;
const THUMB_H = 32;

const capeThumbCache = new Map<string, string>();

const CAPE_UV = {
  top: { x: 1, y: 0, w: 10, h: 1 },
  face: { x: 1, y: 1, w: 10, h: 16 },
} as const;

async function loadCapeImageBitmap(url: string): Promise<ImageBitmap> {
  const { fetchMcTextureDataUrl } = await import("./skin");
  const dataUrl = await fetchMcTextureDataUrl(url);
  if (dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }

  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Cape request failed: ${response.status}`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function blitRegion(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  region: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  ctx.drawImage(bitmap, region.x, region.y, region.w, region.h, dx, dy, dw, dh);
}

export async function renderAssembledCapeThumbnail(url: string): Promise<string> {
  const cacheKey = `${url}@assembled-v2`;
  const cached = capeThumbCache.get(cacheKey);
  if (cached) return cached;

  const bitmap = await loadCapeImageBitmap(url);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create 2D context");
    }

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);

    if (bitmap.width === 64 && bitmap.height === 32) {
      const assembledW = CAPE_UV.face.w;
      const assembledH = CAPE_UV.top.h + CAPE_UV.face.h;
      const scale = Math.min(THUMB_W / assembledW, THUMB_H / assembledH);
      const drawW = assembledW * scale;
      const drawH = assembledH * scale;
      const drawX = (THUMB_W - drawW) / 2;
      const drawY = (THUMB_H - drawH) / 2;
      const topH = CAPE_UV.top.h * scale;
      const faceH = CAPE_UV.face.h * scale;

      blitRegion(ctx, bitmap, CAPE_UV.top, drawX, drawY, drawW, topH);
      blitRegion(ctx, bitmap, CAPE_UV.face, drawX, drawY + topH, drawW, faceH);
    } else {
      const scale = Math.min(THUMB_W / bitmap.width, THUMB_H / bitmap.height);
      const drawW = bitmap.width * scale;
      const drawH = bitmap.height * scale;
      const drawX = (THUMB_W - drawW) / 2;
      const drawY = (THUMB_H - drawH) / 2;
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, drawX, drawY, drawW, drawH);
    }

    const dataUrl = canvas.toDataURL("image/png");
    capeThumbCache.set(cacheKey, dataUrl);
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
