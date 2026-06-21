import {
  createBuild,
  deleteBuild,
  getBuild,
  listBuilds,
  replaceBuildContents,
  updateBuild,
  type BuildContentInput,
  type BuildRow,
} from "../api/builds";
import { getStoredAccessToken } from "../api/client";
import { invoke } from "@tauri-apps/api/core";

const PROFILE_BUILD_MAP_KEY = "mc16launcher:profile_cloud_build_v1";

export type ProfileForSync = {
  id: string;
  name: string;
  game_version: string;
  loader: string;
  play_time_seconds: number | null;
  last_played_at?: number | null;
};

type ProfileBuildMap = Record<string, string>;

type CloudStatsMergeResult = {
  updated: boolean;
  play_time_seconds: number;
  last_played_at?: number | null;
};

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function loadProfileBuildMap(): ProfileBuildMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROFILE_BUILD_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProfileBuildMap;
  } catch {
    return {};
  }
}

function saveProfileBuildMap(map: ProfileBuildMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_BUILD_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

function setProfileBuildMapping(profileId: string, buildId: string) {
  const map = loadProfileBuildMap();
  map[profileId] = buildId;
  saveProfileBuildMap(map);
}

function clearProfileBuildMapping(profileId: string) {
  const map = loadProfileBuildMap();
  delete map[profileId];
  saveProfileBuildMap(map);
}

export function getProfileCloudBuildId(profileId: string): string | null {
  return loadProfileBuildMap()[profileId] ?? null;
}

export function getLinkedProfileIds(): Set<string> {
  return new Set(Object.keys(loadProfileBuildMap()));
}

function unixSecondsToRfc3339(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function rfc3339ToUnixSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function matchesProfile(build: BuildRow, profile: ProfileForSync): boolean {
  return (
    build.name.trim().toLowerCase() === profile.name.trim().toLowerCase() &&
    build.minecraft_version.trim() === profile.game_version.trim() &&
    build.loader.trim().toLowerCase() === profile.loader.trim().toLowerCase()
  );
}

export function isBuildSyncAvailable(): boolean {
  return Boolean(getStoredAccessToken());
}

async function findExistingCloudBuild(profile: ProfileForSync): Promise<string | null> {
  const builds = await listBuilds();
  const match = builds.find((b) => matchesProfile(b, profile));
  return match?.id ?? null;
}

export async function ensureCloudBuildId(profile: ProfileForSync): Promise<string | null> {
  if (!isBuildSyncAvailable()) return null;

  const map = loadProfileBuildMap();
  const mapped = map[profile.id];
  if (mapped) {
    try {
      await getBuild(mapped);
      return mapped;
    } catch {
      clearProfileBuildMapping(profile.id);
    }
  }

  const existing = await findExistingCloudBuild(profile);
  if (existing) {
    setProfileBuildMapping(profile.id, existing);
    return existing;
  }

  const created = await createBuild({
    name: profile.name.trim(),
    minecraft_version: profile.game_version.trim(),
    loader: profile.loader.trim(),
  });
  setProfileBuildMapping(profile.id, created.build.id);
  return created.build.id;
}

async function resolveCloudBuildId(profile: ProfileForSync): Promise<string | null> {
  if (!isBuildSyncAvailable()) return null;

  const mapped = getProfileCloudBuildId(profile.id);
  if (mapped) {
    try {
      await getBuild(mapped);
      return mapped;
    } catch {
      clearProfileBuildMapping(profile.id);
    }
  }

  return findExistingCloudBuild(profile);
}

export async function pullProfileStatsFromCloud(
  profile: ProfileForSync,
): Promise<ProfileForSync | null> {
  if (!isBuildSyncAvailable()) return null;

  const buildId = await resolveCloudBuildId(profile);
  if (!buildId) return null;

  setProfileBuildMapping(profile.id, buildId);

  const remote = await getBuild(buildId);
  const remotePlaytime = Math.max(0, remote.build.playtime_seconds);
  const remoteLastPlayed = rfc3339ToUnixSeconds(remote.build.last_launch_at);
  const localPlaytime = Math.max(0, profile.play_time_seconds ?? 0);
  const localLastPlayed = Math.max(0, profile.last_played_at ?? 0);

  if (remotePlaytime <= localPlaytime && remoteLastPlayed <= localLastPlayed) {
    return null;
  }

  const result = await invoke<CloudStatsMergeResult>("merge_profile_cloud_stats", {
    profileId: profile.id,
    remote: {
      play_time_seconds: remotePlaytime,
      last_played_at: remoteLastPlayed > 0 ? remoteLastPlayed : null,
    },
  });

  if (!result.updated) return null;

  return {
    ...profile,
    play_time_seconds: result.play_time_seconds,
    last_played_at: result.last_played_at ?? null,
  };
}

export async function syncProfileToCloud(profile: ProfileForSync): Promise<void> {
  if (!isBuildSyncAvailable()) return;

  const buildId = await ensureCloudBuildId(profile);
  if (!buildId) return;

  const remote = await getBuild(buildId);
  const localPlaytime = Math.max(0, profile.play_time_seconds ?? 0);
  const remotePlaytime = Math.max(0, remote.build.playtime_seconds);
  const mergedPlaytime = Math.max(localPlaytime, remotePlaytime);

  const localLastPlayed = Math.max(0, profile.last_played_at ?? 0);
  const remoteLastPlayed = rfc3339ToUnixSeconds(remote.build.last_launch_at);
  const mergedLastPlayed = Math.max(localLastPlayed, remoteLastPlayed);

  const patch: {
    playtime_seconds: number;
    last_launch_at?: string;
  } = { playtime_seconds: mergedPlaytime };

  if (mergedLastPlayed > 0) {
    patch.last_launch_at = unixSecondsToRfc3339(mergedLastPlayed);
  }

  if (
    mergedPlaytime !== remotePlaytime ||
    mergedLastPlayed !== remoteLastPlayed
  ) {
    await updateBuild(buildId, patch);
  }
}

type TauriBuildContentEntry = {
  source: string;
  projectId: string;
  versionId?: string | null;
  fileId?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
};

async function collectLocalBuildContents(profileId: string): Promise<BuildContentInput[]> {
  const entries = await invoke<TauriBuildContentEntry[]>("collect_profile_build_contents", {
    profileId,
  });
  return entries.map((entry) => ({
    source: entry.source,
    project_id: entry.projectId,
    version_id: entry.versionId ?? null,
    file_id: entry.fileId ?? null,
    type: entry.type,
    metadata: entry.metadata ?? null,
  }));
}

export async function syncProfileContentsToCloud(profile: ProfileForSync): Promise<void> {
  if (!isBuildSyncAvailable()) return;

  const buildId = await ensureCloudBuildId(profile);
  if (!buildId) return;

  const contents = await collectLocalBuildContents(profile.id);
  await replaceBuildContents(buildId, contents);
}

export async function syncProfileFullToCloud(profile: ProfileForSync): Promise<void> {
  await syncProfileToCloud(profile);
  await syncProfileContentsToCloud(profile);
}

export function scheduleProfileSync(profile: ProfileForSync, delayMs = 1500): void {
  if (!isBuildSyncAvailable()) return;

  const existing = syncTimers.get(profile.id);
  if (existing) clearTimeout(existing);

  syncTimers.set(
    profile.id,
    setTimeout(() => {
      syncTimers.delete(profile.id);
      void syncProfileFullToCloud(profile).catch((e) => {
        console.warn("[buildSync] profile sync failed:", e);
      });
    }, delayMs),
  );
}

export async function syncAllProfilesToCloud(
  profiles: ProfileForSync[],
): Promise<ProfileForSync[]> {
  if (!isBuildSyncAvailable() || profiles.length === 0) return profiles;

  const updated = [...profiles];
  for (let i = 0; i < updated.length; i++) {
    try {
      const pulled = await pullProfileStatsFromCloud(updated[i]);
      if (pulled) updated[i] = pulled;
    } catch (e) {
      console.warn(`[buildSync] pull failed for ${updated[i].id}:`, e);
    }
  }

  for (const profile of updated) {
    try {
      await syncProfileFullToCloud(profile);
    } catch (e) {
      console.warn(`[buildSync] sync failed for ${profile.id}:`, e);
    }
  }

  return updated;
}

export async function deleteCloudBuild(buildId: string): Promise<void> {
  await deleteBuild(buildId);
  const map = loadProfileBuildMap();
  for (const [profileId, mappedId] of Object.entries(map)) {
    if (mappedId === buildId) {
      clearProfileBuildMapping(profileId);
    }
  }
}

export function flushPendingProfileSyncs(): void {
  for (const timer of syncTimers.values()) {
    clearTimeout(timer);
  }
  syncTimers.clear();
}
