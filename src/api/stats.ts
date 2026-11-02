import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type GameStats = Record<string, number>;

export type UserStats = {
  user_id: string;
  playtime_seconds: number;
  launch_count: number;
  first_launch_at?: string | null;
  last_launch_at?: string | null;
  game?: GameStats;
};

export const STATS_UPDATED_EVENT = "platform-stats-updated";

export async function fetchMyStats(): Promise<UserStats> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ stats: UserStats }>("/stats/me");
  return data.stats;
}

export async function reportStats(input: {
  playtime_seconds_delta?: number;
  playtime_seconds?: number;
  launched?: boolean;
  game?: GameStats;
}): Promise<UserStats> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ stats: UserStats }>("/stats/report", {
    method: "POST",
    body: JSON.stringify(input),
  });
  window.dispatchEvent(new CustomEvent<UserStats>(STATS_UPDATED_EVENT, { detail: data.stats }));
  return data.stats;
}

const PENDING_GAME_STATS_KEY = "pending_game_stats";

function readPendingGameStats(): GameStats {
  try {
    const raw = window.localStorage.getItem(PENDING_GAME_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePendingGameStats(stats: GameStats) {
  try {
    if (Object.keys(stats).length === 0) {
      window.localStorage.removeItem(PENDING_GAME_STATS_KEY);
    } else {
      window.localStorage.setItem(PENDING_GAME_STATS_KEY, JSON.stringify(stats));
    }
  } catch {
  }
}

function mergeGameStats(base: GameStats, extra: GameStats): GameStats {
  const out: GameStats = { ...base };
  for (const [key, raw] of Object.entries(extra)) {
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value) || value <= 0) continue;
    const prev = Number(out[key]) || 0;
    out[key] = key.startsWith("max:") ? Math.max(prev, value) : prev + value;
  }
  return out;
}

let flushing: Promise<void> | null = null;

/** Sends in-game counters; on failure they stay queued and go out with the next report. */
export function reportGameStats(delta: GameStats = {}): Promise<void> {
  writePendingGameStats(mergeGameStats(readPendingGameStats(), delta));
  if (flushing) return flushing.then(() => reportGameStats());
  flushing = (async () => {
    const pending = readPendingGameStats();
    if (Object.keys(pending).length === 0) return;
    try {
      await reportStats({ game: pending });
      const rest = readPendingGameStats();
      for (const key of Object.keys(pending)) {
        if (rest[key] === pending[key]) delete rest[key];
        else if (!key.startsWith("max:")) rest[key] = (Number(rest[key]) || 0) - pending[key];
      }
      writePendingGameStats(mergeGameStats({}, rest));
    } catch {
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
