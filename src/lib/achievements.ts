import type { AchievementRow } from "../api/achievements";
import type { UserStats } from "../api/stats";

export const HIDDEN_ACHIEVEMENT_CODES = new Set(["five_friends"]);

export type AchievementCategory =
  | "profile"
  | "game"
  | "bosses"
  | "survival"
  | "mining"
  | "travel"
  | "village"
  | "social"
  | "other";

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  "profile",
  "game",
  "bosses",
  "survival",
  "mining",
  "travel",
  "village",
  "social",
  "other",
];

/** count: plain number, distance: centimetres, damage: tenths of a point, ticks: game ticks. */
export type GameStatUnit = "count" | "distance" | "damage" | "ticks";

type AchievementGoal =
  | { metric: "launches" | "playtime"; target: number }
  | { metric: "game"; keys: string[]; target: number; unit: GameStatUnit; each?: boolean };

type AchievementMeta = {
  category: AchievementCategory;
  goal?: AchievementGoal;
};

const DIAMOND_ORE = ["mined:diamond_ore", "mined:deepslate_diamond_ore"];
const EMERALD_ORE = ["mined:emerald_ore", "mined:deepslate_emerald_ore"];
const WALK = ["custom:walk_one_cm", "custom:sprint_one_cm"];
const PICKAXES = ["wooden", "stone", "iron", "golden", "diamond", "netherite"].map(
  (tier) => `broken:${tier}_pickaxe`,
);
const KM = 100_000;

function game(
  category: AchievementCategory,
  keys: string | string[],
  target: number,
  unit: GameStatUnit = "count",
): AchievementMeta {
  return {
    category,
    goal: { metric: "game", keys: Array.isArray(keys) ? keys : [keys], target, unit },
  };
}

/** Thresholds mirror GAME_GOALS in backend/src/achievements.rs. */
const META: Record<string, AchievementMeta> = {
  welcome: { category: "profile" },
  identity_linked: { category: "profile" },
  theme_submit: { category: "profile" },
  first_launch: { category: "game", goal: { metric: "launches", target: 1 } },
  ten_launches: { category: "game", goal: { metric: "launches", target: 10 } },
  fifty_launches: { category: "game", goal: { metric: "launches", target: 50 } },
  hour_played: { category: "game", goal: { metric: "playtime", target: 3600 } },
  ten_hours: { category: "game", goal: { metric: "playtime", target: 36000 } },

  dragon_1: game("bosses", "killed:ender_dragon", 1),
  dragon_3: game("bosses", "killed:ender_dragon", 3),
  dragon_10: game("bosses", "killed:ender_dragon", 10),
  dragon_25: game("bosses", "killed:ender_dragon", 25),
  dragon_egg: game("bosses", "picked_up:dragon_egg", 1),
  hardcore_dragon: game("bosses", "hardcore:killed:ender_dragon", 1),
  wither_1: game("bosses", "killed:wither", 1),
  wither_5: game("bosses", "killed:wither", 5),
  warden_1: game("bosses", "killed:warden", 1),
  boss_trio: {
    category: "bosses",
    goal: {
      metric: "game",
      keys: ["killed:ender_dragon", "killed:wither", "killed:warden"],
      target: 1,
      unit: "count",
      each: true,
    },
  },
  elder_guardian_3: game("bosses", "killed:elder_guardian", 3),
  ravager_15: game("bosses", "killed:ravager", 15),
  breeze_30: game("bosses", "killed:breeze", 30),
  creeper_500: game("bosses", "killed:creeper", 500),
  enderman_200: game("bosses", "killed:enderman", 200),
  phantom_100: game("bosses", "killed:phantom", 100),
  totem_10: game("bosses", "used:totem_of_undying", 10),
  shield_10k: game("bosses", "custom:damage_blocked_by_shield", 100_000, "damage"),
  damage_100k: game("bosses", "custom:damage_dealt", 1_000_000, "damage"),

  killed_by_creeper_10: game("survival", "killed_by:creeper", 10),
  killed_by_dragon: game("survival", "killed_by:ender_dragon", 1),
  killed_by_warden: game("survival", "killed_by:warden", 1),
  deaths_300: game("survival", "custom:deaths", 300),
  no_death_day: game("survival", "max:custom:time_since_death", 1_728_000, "ticks"),
  fall_1km: game("survival", "custom:fall_one_cm", KM, "distance"),
  cake_100: game("survival", "custom:eat_cake_slice", 100),

  diamond_200: game("mining", DIAMOND_ORE, 200),
  emerald_50: game("mining", EMERALD_ORE, 50),
  debris_32: game("mining", "mined:ancient_debris", 32),
  amethyst_256: game("mining", "mined:amethyst_cluster", 256),
  blocks_50k: game("mining", "mined:_all", 50_000),
  pickaxes_25: game("mining", PICKAXES, 25),
  netherite_broken: game("mining", "broken:netherite_pickaxe", 1),

  walk_25km: game("travel", WALK, 25 * KM, "distance"),
  walk_250km: game("travel", WALK, 250 * KM, "distance"),
  elytra_100km: game("travel", "custom:aviate_one_cm", 100 * KM, "distance"),
  boat_20km: game("travel", "custom:boat_one_cm", 20 * KM, "distance"),
  minecart_10km: game("travel", "custom:minecart_one_cm", 10 * KM, "distance"),
  swim_10km: game("travel", "custom:swim_one_cm", 10 * KM, "distance"),
  strider_1km: game("travel", "custom:strider_one_cm", KM, "distance"),
  pig_1km: game("travel", "custom:pig_one_cm", KM, "distance"),
  all_biomes: { category: "travel" },

  trades_300: game("village", "custom:traded_with_villager", 300),
  raids_5: game("village", "custom:raid_win", 5),
  bred_200: game("village", "custom:animals_bred", 200),
  fish_250: game("village", "custom:fish_caught", 250),
  enchant_100: game("village", "custom:enchant_item", 100),
  beacon: game("village", "crafted:beacon", 1),
  noteblock_1000: game("village", "custom:play_noteblock", 1_000),
  records_10: game("village", "custom:play_record", 10),
  bell_100: game("village", "custom:bell_ring", 100),
  chests_1000: game("village", "custom:open_chest", 1_000),
  flowers_50: game("village", "custom:pot_flower", 50),

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
  unit?: GameStatUnit;
  current: number;
  target: number;
  ratio: number;
};

function goalProgress(
  goal: AchievementGoal,
  stats: UserStats,
): { current: number; target: number; unit?: GameStatUnit } {
  if (goal.metric !== "game") {
    const raw = goal.metric === "launches" ? stats.launch_count : stats.playtime_seconds;
    return { current: Number(raw) || 0, target: goal.target };
  }
  const value = (key: string) => Math.max(0, Number(stats.game?.[key]) || 0);
  if (goal.each) {
    return {
      current: goal.keys.filter((key) => value(key) >= goal.target).length,
      target: goal.keys.length,
      unit: "count",
    };
  }
  return {
    current: goal.keys.reduce((sum, key) => sum + value(key), 0),
    target: goal.target,
    unit: goal.unit,
  };
}

export function achievementProgress(
  achievement: AchievementRow,
  stats: UserStats | null | undefined,
): AchievementProgress | null {
  if (achievement.unlocked || !stats) return null;
  const goal = achievementMeta(achievement.code).goal;
  if (!goal) return null;
  const { current: raw, target, unit } = goalProgress(goal, stats);
  const current = Math.max(0, Math.min(target, raw));
  return { metric: goal.metric, unit, current, target, ratio: current / target };
}

export function sortByUnlockedAtDesc(rows: AchievementRow[]): AchievementRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.unlocked_at ? Date.parse(a.unlocked_at) : 0;
    const tb = b.unlocked_at ? Date.parse(b.unlocked_at) : 0;
    return tb - ta;
  });
}
