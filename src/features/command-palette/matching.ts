export type PaletteGroup = "recent" | "actions" | "navigation" | "instances" | "settings";

export type PaletteCommand = {
  id: string;
  group: Exclude<PaletteGroup, "recent">;
  title: string;
  subtitle?: string;
  keywords?: string[];
  iconSrc?: string | null;
  hint?: string;
  disabled?: boolean;
  run: () => void;
};

export type RankedCommand = PaletteCommand & { score: number; shownGroup: PaletteGroup };

const USAGE_KEY = "launcher_palette_usage_v1";
const MAX_USAGE_ENTRIES = 120;
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 5;

type UsageEntry = { weight: number; at: number };
type UsageMap = Record<string, UsageEntry>;

function readUsage(): UsageMap {
  try {
    const raw = window.localStorage.getItem(USAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as UsageMap) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function decayed(entry: UsageEntry, now: number): number {
  return entry.weight * Math.pow(0.5, (now - entry.at) / HALF_LIFE_MS);
}

export function recordPaletteUse(id: string) {
  const now = Date.now();
  const usage = readUsage();
  const prev = usage[id];
  usage[id] = { weight: (prev ? decayed(prev, now) : 0) + 1, at: now };
  const trimmed = Object.entries(usage)
    .sort((a, b) => decayed(b[1], now) - decayed(a[1], now))
    .slice(0, MAX_USAGE_ENTRIES);
  try {
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
  }
}

function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, "");
  if (!q) return 0;
  const t = fold(text);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const atWordStart = found === 0 || /[\s\-_./:(]/.test(t[found - 1]);
    streak = found === ti ? streak + 1 : 0;
    score += 1 + (atWordStart ? 6 : 0) + streak * 2 - Math.min(found - ti, 6) * 0.3;
    ti = found + 1;
  }
  if (t.startsWith(fold(query).trim())) score += 12;
  return score;
}

export function rankCommands(commands: PaletteCommand[], query: string): RankedCommand[] {
  const now = Date.now();
  const usage = readUsage();
  const q = query.trim();

  if (!q) {
    const recentIds = Object.entries(usage)
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id]) => id);
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recent: RankedCommand[] = [];
    for (const id of recentIds) {
      const cmd = byId.get(id);
      if (!cmd || cmd.disabled) continue;
      recent.push({ ...cmd, score: 0, shownGroup: "recent" });
      if (recent.length >= RECENT_LIMIT) break;
    }
    const recentSet = new Set(recent.map((c) => c.id));
    const rest = commands
      .filter((c) => !recentSet.has(c.id) && c.group !== "settings")
      .map((c) => ({ ...c, score: 0, shownGroup: c.group as PaletteGroup }));
    return [...recent, ...rest];
  }

  const ranked: RankedCommand[] = [];
  for (const cmd of commands) {
    const fields = [cmd.title, cmd.subtitle ?? "", ...(cmd.keywords ?? [])];
    let best: number | null = null;
    fields.forEach((field, i) => {
      const s = fuzzyScore(q, field);
      if (s == null) return;
      const weighted = i === 0 ? s : s * 0.7;
      best = best == null ? weighted : Math.max(best, weighted);
    });
    if (best == null) continue;
    const u = usage[cmd.id];
    const boost = u ? Math.min(decayed(u, now), 10) * 1.5 : 0;
    ranked.push({ ...cmd, score: (best as number) + boost, shownGroup: cmd.group });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 60);
}
