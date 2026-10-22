import type { AchievementRow } from "../api/achievements";
import type { UserStats } from "../api/stats";

export const HIDDEN_ACHIEVEMENT_CODES = new Set(["five_friends"]);

export type AchievementCategory = "profile" | "game" | "social" | "other";

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = ["profile", "game", "social", "other"];

type AchievementGoal = { metric: "launches" | "playtime"; target: number };

type AchievementMeta = {
  category: AchievementCategory;
  goal?: AchievementGoal;
};

const META: Record<string, AchievementMeta> = {
  welcome: { category: "profile" },
  identity_linked: { category: "profile" },
  theme_submit: { category: "profile" },
  first_launch: { category: "game", goal: { metric: "launches", target: 1 } },
  ten_launches: { category: "game", goal: { metric: "launches", target: 10 } },
  fifty_launches: { category: "game", goal: { metric: "launches", target: 50 } },
  hour_played: { category: "game", goal: { metric: "playtime", target: 3600 } },
  ten_hours: { category: "game", goal: { metric: "playtime", target: 36000 } },
  first_friend: { category: "social" },
  first_room: { category: "social" },
  first_join: { category: "social" },
  room_invite: { category: "social" },
};

const FALLBACK_META: AchievementMeta = { category: "other" };

export function achievementMeta(code: string): AchievementMeta {
  return META[code] ?? FALLBACK_META;
}

export type AchievementProgress = {
  metric: AchievementGoal["metric"];
  current: number;
  target: number;
  ratio: number;
};

export function achievementProgress(
  achievement: AchievementRow,
  stats: UserStats | null | undefined,
): AchievementProgress | null {
  if (achievement.unlocked || !stats) return null;
  const goal = achievementMeta(achievement.code).goal;
  if (!goal) return null;
  const raw = goal.metric === "launches" ? stats.launch_count : stats.playtime_seconds;
  const current = Math.max(0, Math.min(goal.target, Number(raw) || 0));
  return { metric: goal.metric, current, target: goal.target, ratio: current / goal.target };
}

export function sortByUnlockedAtDesc(rows: AchievementRow[]): AchievementRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.unlocked_at ? Date.parse(a.unlocked_at) : 0;
    const tb = b.unlocked_at ? Date.parse(b.unlocked_at) : 0;
    return tb - ta;
  });
}
