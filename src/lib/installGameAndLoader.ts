import { invoke } from "@tauri-apps/api/core";

export type InstallLoaderId = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

type VersionRef = { id: string; url?: string | null };
type ForgeVersionRef = {
  id: string;
  mc_version: string;
  forge_build: string;
  installer_url?: string | null;
};

export type InstallGameHooks = {
  onGameInstallStart?: (gameVersion: string) => void;
  onGameInstallEnd?: (gameVersion: string) => void;
  onLoaderInstallStart?: (loader: InstallLoaderId, loaderVersion: string) => void;
  manifestUrlError?: (gameVersion: string) => Error;
  knownVersions?: VersionRef[];
};

export async function installGameAndLoader(
  gameVersion: string,
  loader: InstallLoaderId,
  loaderVersion: string | null,
  hooks: InstallGameHooks = {},
): Promise<void> {
  let versionUrl = hooks.knownVersions?.find((v) => v.id === gameVersion)?.url ?? null;
  if (!versionUrl) {
    const all = await invoke<VersionRef[]>("fetch_all_versions");
    versionUrl = all.find((v) => v.id === gameVersion)?.url ?? null;
  }
  if (!versionUrl) {
    throw hooks.manifestUrlError?.(gameVersion) ?? new Error(`No manifest for ${gameVersion}`);
  }

  try {
    await invoke("reset_download_cancel");
  } catch (e) {
    console.error(e);
  }

  const installed = await invoke<string[]>("list_installed_versions");
  if (!installed.includes(gameVersion)) {
    hooks.onGameInstallStart?.(gameVersion);
    try {
      await invoke("install_version", { versionId: gameVersion, versionUrl });
    } finally {
      hooks.onGameInstallEnd?.(gameVersion);
    }
  }

  if (loader === "vanilla" || !loaderVersion) return;
  hooks.onLoaderInstallStart?.(loader, loaderVersion);
  if (loader === "fabric") {
    await invoke("install_fabric", { gameVersion, loaderVersion });
  } else if (loader === "quilt") {
    await invoke("install_quilt", { gameVersion, loaderVersion });
  } else if (loader === "forge") {
    const forgeList = await invoke<ForgeVersionRef[]>("fetch_forge_versions");
    const match = forgeList.find((v) => v.mc_version === gameVersion && v.forge_build === loaderVersion);
    const versionId = match?.id ?? `${gameVersion}-forge-${loaderVersion}`;
    const installerUrl =
      match?.installer_url ??
      `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${gameVersion}-${loaderVersion}/forge-${gameVersion}-${loaderVersion}-installer.jar`;
    await invoke("install_forge", { versionId, installerUrl });
  } else if (loader === "neoforge") {
    await invoke("install_neoforge", { versionId: `${gameVersion}-neoforge-${loaderVersion}` });
  }
}
