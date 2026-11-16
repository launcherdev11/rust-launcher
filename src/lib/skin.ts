import { dataUrlToBlob } from "./dataUrl";

export type McSkin = {
  id: string;
  alias: string;
  url: string;
  variant: "CLASSIC" | "SLIM" | string;
  state: "ACTIVE" | "INACTIVE" | string;
};

export type SkinModelVariant = "classic" | "slim";

export async function fetchMcSkins(): Promise<McSkin[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<McSkin[]>("list_mc_skins");
  return raw.map((skin) => ({
    ...skin,
    variant: skin.variant === "SLIM" ? "SLIM" : "CLASSIC",
    state: skin.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
  }));
}

export async function selectMcSkin(skinId: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dataUrl = await invoke<string | null>("set_mc_active_skin", { skinId });
  if (!dataUrl) {
    throw new Error("Failed to apply skin");
  }
  return dataUrl;
}

export async function uploadMcSkin(filePath: string, variant: SkinModelVariant): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dataUrl = await invoke<string | null>("upload_mc_skin", {
    filePath,
    variant,
  });
  if (!dataUrl) {
    throw new Error("Failed to upload skin");
  }
  return dataUrl;
}

export async function fetchMcTextureDataUrl(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("get_mc_texture_data_url", { url: trimmed });
  } catch (error) {
    console.debug("[texture] failed to fetch Mojang texture via backend", error);
    return null;
  }
}

export function findActiveMcSkin(skins: McSkin[]): McSkin | null {
  return skins.find((skin) => skin.state === "ACTIVE") ?? null;
}

type UvRect = { x: number; y: number; w: number; h: number };

const SKIN_FRONT = {
  head: { x: 8, y: 8, w: 8, h: 8 } as UvRect,
  hat: { x: 40, y: 8, w: 8, h: 8 } as UvRect,
  body: { x: 20, y: 20, w: 8, h: 12 } as UvRect,
  jacket: { x: 20, y: 36, w: 8, h: 12 } as UvRect,
  rightArm: { x: 44, y: 20, w: 4, h: 12 } as UvRect,
  rightSleeve: { x: 44, y: 36, w: 4, h: 12 } as UvRect,
  leftArm: { x: 36, y: 52, w: 4, h: 12 } as UvRect,
  leftSleeve: { x: 52, y: 52, w: 4, h: 12 } as UvRect,
  rightArmSlim: { x: 44, y: 20, w: 3, h: 12 } as UvRect,
  rightSleeveSlim: { x: 44, y: 36, w: 3, h: 12 } as UvRect,
  leftArmSlim: { x: 36, y: 52, w: 3, h: 12 } as UvRect,
  leftSleeveSlim: { x: 52, y: 52, w: 3, h: 12 } as UvRect,
  rightLeg: { x: 4, y: 20, w: 4, h: 12 } as UvRect,
  rightPants: { x: 4, y: 36, w: 4, h: 12 } as UvRect,
  leftLeg: { x: 20, y: 52, w: 4, h: 12 } as UvRect,
  leftPants: { x: 4, y: 52, w: 4, h: 12 } as UvRect,
};

const assembledSkinCache = new Map<string, string>();

async function loadSkinBitmap(url: string): Promise<ImageBitmap> {
  const dataUrl = url.startsWith("data:") ? url : await fetchMcTextureDataUrl(url);
  if (!dataUrl) {
    throw new Error("Failed to load skin texture");
  }
  return createImageBitmap(dataUrlToBlob(dataUrl));
}

function blit(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  region: UvRect,
  dx: number,
  dy: number,
  scale: number,
): void {
  ctx.drawImage(
    bitmap,
    region.x,
    region.y,
    region.w,
    region.h,
    dx,
    dy,
    region.w * scale,
    region.h * scale,
  );
}

export async function renderAssembledSkinThumbnail(
  url: string,
  options?: { variant?: string; size?: number },
): Promise<string> {
  const variant = options?.variant === "SLIM" || options?.variant === "slim" ? "slim" : "classic";
  const size = options?.size ?? 96;
  const cacheKey = `${url}@assembled-front:${variant}:${size}`;
  const cached = assembledSkinCache.get(cacheKey);
  if (cached) return cached;

  const bitmap = await loadSkinBitmap(url);
  try {
    const isLegacy = bitmap.height === 32;
    const slim = variant === "slim";
    const armW = slim ? 3 : 4;
    const bodyW = 8;
    const spriteW = armW + bodyW + armW;
    const spriteH = 8 + 12 + 12;
    const scale = Math.max(1, Math.floor(size / Math.max(spriteW, spriteH)));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create 2D context");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    const drawW = spriteW * scale;
    const drawH = spriteH * scale;
    const ox = Math.floor((size - drawW) / 2);
    const oy = Math.floor((size - drawH) / 2);

    const headX = ox + armW * scale;
    const bodyX = ox + armW * scale;
    const rightArmX = ox;
    const leftArmX = ox + (armW + bodyW) * scale;
    const rightLegX = ox + armW * scale;
    const leftLegX = ox + (armW + 4) * scale;
    const headY = oy;
    const torsoY = oy + 8 * scale;
    const legsY = oy + (8 + 12) * scale;

    blit(ctx, bitmap, SKIN_FRONT.head, headX, headY, scale);
    blit(ctx, bitmap, SKIN_FRONT.body, bodyX, torsoY, scale);
    blit(
      ctx,
      bitmap,
      slim ? SKIN_FRONT.rightArmSlim : SKIN_FRONT.rightArm,
      rightArmX,
      torsoY,
      scale,
    );
    if (isLegacy) {
      ctx.save();
      ctx.translate(leftArmX + armW * scale, torsoY);
      ctx.scale(-1, 1);
      blit(ctx, bitmap, slim ? SKIN_FRONT.rightArmSlim : SKIN_FRONT.rightArm, 0, 0, scale);
      ctx.restore();
      blit(ctx, bitmap, SKIN_FRONT.rightLeg, rightLegX, legsY, scale);
      ctx.save();
      ctx.translate(leftLegX + 4 * scale, legsY);
      ctx.scale(-1, 1);
      blit(ctx, bitmap, SKIN_FRONT.rightLeg, 0, 0, scale);
      ctx.restore();
    } else {
      blit(
        ctx,
        bitmap,
        slim ? SKIN_FRONT.leftArmSlim : SKIN_FRONT.leftArm,
        leftArmX,
        torsoY,
        scale,
      );
      blit(ctx, bitmap, SKIN_FRONT.rightLeg, rightLegX, legsY, scale);
      blit(ctx, bitmap, SKIN_FRONT.leftLeg, leftLegX, legsY, scale);
    }

    blit(ctx, bitmap, SKIN_FRONT.hat, headX, headY, scale);
    if (!isLegacy) {
      blit(ctx, bitmap, SKIN_FRONT.jacket, bodyX, torsoY, scale);
      blit(
        ctx,
        bitmap,
        slim ? SKIN_FRONT.rightSleeveSlim : SKIN_FRONT.rightSleeve,
        rightArmX,
        torsoY,
        scale,
      );
      blit(
        ctx,
        bitmap,
        slim ? SKIN_FRONT.leftSleeveSlim : SKIN_FRONT.leftSleeve,
        leftArmX,
        torsoY,
        scale,
      );
      blit(ctx, bitmap, SKIN_FRONT.rightPants, rightLegX, legsY, scale);
      blit(ctx, bitmap, SKIN_FRONT.leftPants, leftLegX, legsY, scale);
    }

    const dataUrl = canvas.toDataURL("image/png");
    assembledSkinCache.set(cacheKey, dataUrl);
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
