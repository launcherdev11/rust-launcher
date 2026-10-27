import { invoke } from "@tauri-apps/api/core";

export type WorldBackupKind = "manual" | "auto" | "safety";
export type WorldBackup = { id: string; createdAtMs: number; size: number; kind: WorldBackupKind };

export type WorldDimension = { id: string; regionCount: number };
export type WorldRegionRef = { rx: number; rz: number; chunkCount: number; size: number };
export type WorldOverview = {
  dataVersion: number | null;
  versionName: string | null;
  regions: WorldRegionRef[];
};

export type WorldRegionDetail = {
  rx: number;
  rz: number;
  image: string;
  status: number[];
  inhabitedTicks: number[];
  dataVersion: number[];
  savedAt: number[];
};

export const CHUNK_STATUS = {
  absent: 0,
  ok: 1,
  damaged: 2,
  unreadable: 3,
  proto: 4,
} as const;

export const listWorldBackups = (profileId: string, world: string) =>
  invoke<WorldBackup[]>("list_world_backups", { profileId, world });
export const createWorldBackup = (profileId: string, world: string) =>
  invoke<WorldBackup>("create_world_backup", { profileId, world });
export const deleteWorldBackup = (profileId: string, world: string, backupId: string) =>
  invoke<void>("delete_world_backup", { profileId, world, backupId });
export const restoreWorldBackup = (profileId: string, world: string, backupId: string) =>
  invoke<void>("restore_world_backup", { profileId, world, backupId });
export const openWorldBackupsFolder = (profileId: string, world: string) =>
  invoke<void>("open_world_backups_folder", { profileId, world });

export const listWorldDimensions = (profileId: string, world: string) =>
  invoke<WorldDimension[]>("list_world_dimensions", { profileId, world });
export const getWorldOverview = (profileId: string, world: string, dimension: string) =>
  invoke<WorldOverview>("get_world_overview", { profileId, world, dimension });
export const getWorldRegion = (profileId: string, world: string, dimension: string, rx: number, rz: number) =>
  invoke<WorldRegionDetail>("get_world_region", { profileId, world, dimension, rx, rz });
export const deleteWorldChunks = (
  profileId: string,
  world: string,
  dimension: string,
  chunks: { x: number; z: number }[],
) => invoke<number>("delete_world_chunks", { profileId, world, dimension, chunks });
