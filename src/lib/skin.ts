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
