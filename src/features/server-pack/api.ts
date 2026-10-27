import { invoke } from "@tauri-apps/api/core";

export type ServerKind = "vanilla" | "paper" | "purpur" | "fabric" | "forge" | "neoforge";
export type ServerAuth = "microsoft" | "ely" | "offline";

export type ServerPackConfig = {
  kind: ServerKind | null;
  ramMb: number;
  auth: ServerAuth;
  eula: boolean;
  includeConfigs: boolean;
  modOverrides: Record<string, boolean>;
  properties: Record<string, string>;
};

export type ServerPackState = {
  name: string;
  loader: string;
  mcVersion: string;
  loaderVersion: string | null;
  kinds: ServerKind[];
  javaMajor: number;
  saved: boolean;
  config: ServerPackConfig;
};

export type ServerPackMod = { file: string; title: string; clientOnly: boolean };
export type ServerPackExportResult = { mods: number; skipped: number };

export const isModdedKind = (kind: ServerKind | null) =>
  kind === "fabric" || kind === "forge" || kind === "neoforge";

export const modIncluded = (config: ServerPackConfig, mod: ServerPackMod) =>
  config.modOverrides[mod.file] ?? !mod.clientOnly;

export const getServerPack = (profileId: string) => invoke<ServerPackState>("get_server_pack", { profileId });
export const saveServerPackConfig = (profileId: string, config: ServerPackConfig) =>
  invoke<void>("save_server_pack_config", { profileId, config });
export const listServerPackMods = (profileId: string) =>
  invoke<ServerPackMod[]>("list_server_pack_mods", { profileId });
export const exportServerPack = (profileId: string, destPath: string) =>
  invoke<ServerPackExportResult>("export_server_pack", { profileId, destPath });
