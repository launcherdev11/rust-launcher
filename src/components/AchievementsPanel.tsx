import { useCallback, useEffect, useState } from "react";
import { listAchievements, type AchievementRow } from "../api/achievements";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { useT, type Language } from "../i18n";

type AchievementsPanelProps = {
  language: Language;
  compact?: boolean;
};

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 fill-current"} aria-hidden="true">
      <path d="M5 3h14v2a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V3Zm2 2v0a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V5H7Zm-2 4h2a7 7 0 0 0 6 6.92V19H7v2h10v-2h-6v-3.08A7 7 0 0 0 15 7h2a7 7 0 0 1-7 7 7 7 0 0 1-7-7Zm14 0h2a7 7 0 0 1-4.9 6.68A7.002 7.002 0 0 0 19 11Z" />
    </svg>
  );
}

export function AchievementsPanel({ language, compact = false }: AchievementsPanelProps) {
  const tt = useT(language);
  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [error, setError] = useState("");

  const syncAuth = useCallback(() => {
    setAccessToken(getStoredAccessToken() ?? "");
  }, []);

  const reload = useCallback(async () => {
    if (!getStoredAccessToken()) {
      setAchievements([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setAchievements(await listAchievements());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncAuth();
    const onChanged = () => syncAuth();
    window.addEventListener(API_AUTH_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(API_AUTH_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, [syncAuth]);

  useEffect(() => {
    if (accessToken) {
      void reload();
    } else {
      setAchievements([]);
    }
  }, [accessToken, reload]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  if (!accessToken) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
          {tt("achievements.title")}
        </p>
        <p className="mt-2 text-sm text-white/55">{tt("achievements.signInFirst")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrophyIcon className="h-4 w-4 text-amber-300/90" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
            {tt("achievements.title")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">
            {tt("achievements.progress", { unlocked: unlockedCount, total: achievements.length })}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => void reload()}
            className="interactive-press rounded-lg border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:bg-black/55 disabled:opacity-60"
          >
            {tt("achievements.refresh")}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-red-300/90">{error}</p> : null}

      {loading && achievements.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">{tt("common.loading")}</p>
      ) : achievements.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">{tt("achievements.empty")}</p>
      ) : (
        <div
          className={`mt-3 grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}
        >
          {achievements.map((achievement) => (
            <div
              key={achievement.code}
              className={`rounded-xl border px-3 py-2.5 transition ${
                achievement.unlocked
                  ? "border-amber-400/25 bg-amber-500/10"
                  : "border-white/8 bg-black/25 opacity-70"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    achievement.unlocked
                      ? "bg-amber-500/20 text-amber-200"
                      : "bg-white/5 text-white/35"
                  }`}
                >
                  <TrophyIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white/90">{achievement.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-white/55">{achievement.description}</p>
                  {achievement.unlocked && achievement.unlocked_at ? (
                    <p className="mt-1 text-[10px] text-amber-200/70">
                      {tt("achievements.unlockedAt", {
                        date: new Date(achievement.unlocked_at).toLocaleDateString(),
                      })}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                      {tt("achievements.locked")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
