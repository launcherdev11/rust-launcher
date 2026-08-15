import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type UserStats = {
  user_id: string;
  playtime_seconds: number;
  launch_count: number;
  first_launch_at?: string | null;
  last_launch_at?: string | null;
};

export async function fetchMyStats(): Promise<UserStats> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ stats: UserStats }>("/stats/me");
  return data.stats;
}

export async function reportStats(input: {
  playtime_seconds_delta?: number;
  playtime_seconds?: number;
  launched?: boolean;
}): Promise<UserStats> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ stats: UserStats }>("/stats/report", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.stats;
}
