import { invoke } from "@tauri-apps/api/core";

export type ConfigFileEntry = { path: string; size: number; modifiedMs: number };
export type ConfigFileContent = { content: string; modifiedMs: number; lossy: boolean };
export type ConfigVersion = { id: string; savedAtMs: number; size: number };
export type ConfigSearchHit = { path: string; lineNo: number; line: string };
export type ConfigValidation = { ok: boolean; line: number | null; message: string | null };

export const SAVE_CONFLICT = "CONFLICT";

export const listConfigFiles = (profileId: string) =>
  invoke<ConfigFileEntry[]>("list_config_files", { profileId });

export const readConfigFile = (profileId: string, path: string) =>
  invoke<ConfigFileContent>("read_config_file", { profileId, path });

export const saveConfigFile = (
  profileId: string,
  path: string,
  content: string,
  expectedModifiedMs: number | null,
  force = false,
) => invoke<number>("save_config_file", { profileId, path, content, expectedModifiedMs, force });

export const listConfigVersions = (profileId: string, path: string) =>
  invoke<ConfigVersion[]>("list_config_versions", { profileId, path });

export const readConfigVersion = (profileId: string, path: string, versionId: string) =>
  invoke<string>("read_config_version", { profileId, path, versionId });

export const searchConfigFiles = (profileId: string, query: string) =>
  invoke<ConfigSearchHit[]>("search_config_files", { profileId, query });

export const validateConfigToml = (content: string) =>
  invoke<ConfigValidation>("validate_config_toml", { content });
