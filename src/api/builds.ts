import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type BuildContentRow = {
  id: string;
  source: "modrinth" | "curseforge" | string;
  project_id: string;
  version_id?: string | null;
  file_id?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
};

export type BuildRow = {
  id: string;
  name: string;
  minecraft_version: string;
  loader: string;
  playtime_seconds: number;
  last_launch_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type BuildDetail = {
  build: BuildRow;
  contents: BuildContentRow[];
};

export type BuildContentInput = {
  source: "modrinth" | "curseforge" | string;
  project_id: string;
  version_id?: string | null;
  file_id?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
};

export type CreateBuildInput = {
  name: string;
  minecraft_version: string;
  loader: string;
  contents?: BuildContentInput[];
};

export type UpdateBuildInput = {
  name?: string;
  minecraft_version?: string;
  loader?: string;
  playtime_seconds?: number;
  last_launch_at?: string;
};

export async function listBuilds(): Promise<BuildRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ builds: BuildRow[] }>("/builds");
  return data.builds ?? [];
}

export async function getBuild(buildId: string): Promise<BuildDetail> {
  await ensureValidAccessToken();
  return apiFetch<BuildDetail>(`/builds/${buildId}`);
}

export async function createBuild(input: CreateBuildInput): Promise<BuildDetail> {
  await ensureValidAccessToken();
  return apiFetch<BuildDetail>("/builds", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateBuild(buildId: string, input: UpdateBuildInput): Promise<BuildRow> {
  await ensureValidAccessToken();
  return apiFetch<BuildRow>(`/builds/${buildId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteBuild(buildId: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/builds/${buildId}`, { method: "DELETE" });
}

export async function listBuildContents(buildId: string): Promise<BuildContentRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ contents: BuildContentRow[] }>(`/builds/${buildId}/contents`);
  return data.contents ?? [];
}

export async function replaceBuildContents(
  buildId: string,
  contents: BuildContentInput[],
): Promise<BuildContentRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ contents: BuildContentRow[] }>(`/builds/${buildId}/contents`, {
    method: "PUT",
    body: JSON.stringify({ contents }),
  });
  return data.contents ?? [];
}
