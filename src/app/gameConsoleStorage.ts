import type { GameConsoleLine, GameConsoleSession, ProfileConsoleData } from "./types";

export const GAME_CONSOLE_STORAGE_KEY = "game_console_persist_v2";
export const GAME_CONSOLE_STORAGE_KEY_V1 = "game_console_persist_v1";
export const MAX_CONSOLE_LINES = 2000;
export const MAX_ARCHIVED_SESSIONS = 25;
export const HIDDEN_CONSOLE_BUFFER_MAX = 500;
export const GAME_CONSOLE_BATCH_FLUSH_MS = 150;
export const GAME_CONSOLE_PERSIST_DEBOUNCE_MS = 2500;

export function normalizeConsoleLine(l: unknown, i: number): GameConsoleLine | null {
  if (!l || typeof l !== "object") return null;
  const o = l as Record<string, unknown>;
  const line = typeof o.line === "string" ? o.line : "";
  const source = o.source === "stderr" ? "stderr" : "stdout";
  const id =
    typeof o.id === "number" && Number.isFinite(o.id)
      ? o.id
      : Date.now() + i + Math.random();
  return { id, line, source };
}

export function normalizeConsoleSessions(sessionsRaw: unknown): GameConsoleSession[] {
  if (!Array.isArray(sessionsRaw)) return [];
  return sessionsRaw
    .flatMap((s, si): GameConsoleSession[] => {
      if (!s || typeof s !== "object") return [];
      const o = s as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : `${Date.now()}-${si}`;
      const startedAt =
        typeof o.startedAt === "number" && Number.isFinite(o.startedAt)
          ? o.startedAt
          : Date.now();
      const endedAt =
        typeof o.endedAt === "number" && Number.isFinite(o.endedAt) ? o.endedAt : undefined;
      const lr = Array.isArray(o.lines) ? o.lines : [];
      const slines = lr
        .map((l, i) => normalizeConsoleLine(l, i + si * 1000))
        .filter((x): x is GameConsoleLine => x !== null)
        .slice(-MAX_CONSOLE_LINES);
      const session: GameConsoleSession = { id, startedAt, lines: slines };
      if (endedAt !== undefined) session.endedAt = endedAt;
      return [session];
    })
    .slice(0, MAX_ARCHIVED_SESSIONS);
}

export function normalizeProfileConsoleData(raw: unknown): ProfileConsoleData {
  if (!raw || typeof raw !== "object") {
    return { lines: [], sessions: [] };
  }
  const o = raw as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines = linesRaw
    .map((l, i) => normalizeConsoleLine(l, i))
    .filter((x): x is GameConsoleLine => x !== null)
    .slice(-MAX_CONSOLE_LINES);
  return { lines, sessions: normalizeConsoleSessions(o.sessions) };
}

export function loadPersistedGameConsoleByProfile(): Record<string, ProfileConsoleData> {
  if (typeof window === "undefined") return {};
  try {
    const rawV2 = window.localStorage.getItem(GAME_CONSOLE_STORAGE_KEY);
    if (rawV2) {
      const data = JSON.parse(rawV2) as { byProfile?: unknown };
      const byProfileRaw =
        data.byProfile && typeof data.byProfile === "object"
          ? (data.byProfile as Record<string, unknown>)
          : {};
      const out: Record<string, ProfileConsoleData> = {};
      for (const [profileId, value] of Object.entries(byProfileRaw)) {
        if (typeof profileId !== "string" || !profileId.trim()) continue;
        out[profileId] = normalizeProfileConsoleData(value);
      }
      return out;
    }

    const rawV1 = window.localStorage.getItem(GAME_CONSOLE_STORAGE_KEY_V1);
    if (!rawV1) return {};
    const data = JSON.parse(rawV1) as { lines?: unknown; sessions?: unknown };
    const migrated = normalizeProfileConsoleData(data);
    if (migrated.lines.length === 0 && migrated.sessions.length === 0) return {};

    let migrateProfileId: string | null = null;
    try {
      migrateProfileId = window.localStorage.getItem("modpacks_selected_profile_id");
    } catch {
    }
    if (!migrateProfileId?.trim()) return {};
    return { [migrateProfileId]: migrated };
  } catch {
    return {};
  }
}
