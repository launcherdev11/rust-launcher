import { useMemo, useState } from "react";
import type { AchievementRow } from "../api/achievements";
import type { UserStats } from "../api/stats";
import { useAchievements, type AchievementsState } from "../hooks/useAchievements";
import { localeTag, t, useT, type Language } from "../i18n";
import {
  ACHIEVEMENT_CATEGORIES,
  achievementMeta,
  achievementProgress,
} from "../lib/achievements";
import { Spinner } from "./ui";

export function localizedAchievementField(
  language: Language,
  code: string,
  field: "title" | "description",
  fallback: string,
): string {
  const key = `achievements.items.${code}.${field}`;
  const value = t(language, key);
  return value === key ? fallback : value;
}

const ACHIEVEMENTS_ICON_SRC = "/launcher-assets/achivements.png";

export function AchievementIcon({ className }: { className?: string }) {
  return (
    <img
      src={ACHIEVEMENTS_ICON_SRC}
      alt=""
      className={className ?? "h-5 w-5 object-contain"}
      aria-hidden
      draggable={false}
    />
  );
}

type Filter = "all" | "unlocked" | "locked";

type AchievementsPanelProps = {
  language: Language;
  userId?: string | null;
  state?: AchievementsState;
  stats?: UserStats | null;
  compact?: boolean;
  onSignIn?: () => void;
  className?: string;
};

export function AchievementsPanel({
  language,
  userId = null,
  state,
  stats = null,
  compact = false,
  onSignIn,
  className = "",
}: AchievementsPanelProps) {
  const tt = useT(language);
  const own = useAchievements(userId, { enabled: !state });
  const { signedIn, achievements, loading, error, reload } = state ?? own;
  const [filter, setFilter] = useState<Filter>("all");

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  const groups = useMemo(() => {
    const visible = achievements.filter((a) =>
      filter === "all" ? true : filter === "unlocked" ? a.unlocked : !a.unlocked,
    );
    return ACHIEVEMENT_CATEGORIES.map((category) => {
      const all = achievements.filter((a) => achievementMeta(a.code).category === category);
      return {
        category,
        total: all.length,
        unlocked: all.filter((a) => a.unlocked).length,
        rows: visible.filter((a) => achievementMeta(a.code).category === category),
      };
    }).filter((g) => g.rows.length > 0);
  }, [achievements, filter]);

  if (!signedIn) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <AchievementIcon className="h-4 w-4 object-contain" />
          <p className="text-[0.75rem] font-bold text-white/45">{tt("achievements.title")}</p>
        </div>
        <p className="mt-2 text-sm text-white/55">{tt("achievements.signInFirst")}</p>
        {onSignIn ? (
          <button type="button" className="btn btn-tint btn-sm mt-3" onClick={onSignIn}>
            {tt("app.accounts.signIn")}
          </button>
        ) : null}
      </div>
    );
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: tt("achievements.filterAll") },
    { id: "unlocked", label: tt("achievements.filterUnlocked") },
    { id: "locked", label: tt("achievements.filterLocked") },
  ];

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AchievementIcon className="h-4 w-4 object-contain" />
          <p className="text-[0.75rem] font-bold text-white/45">{tt("achievements.title")}</p>
          <span className="text-xs text-white/50">
            {tt("achievements.progress", { unlocked: unlockedCount, total: achievements.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass-toolbar flex h-8 items-center gap-1 p-1">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`interactive-press rounded-lg px-2.5 py-1 text-[0.75rem] font-semibold transition-colors ${
                  filter === f.id ? "seg-on" : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void reload()}
            className="interactive-press rounded-lg border border-white/10 bg-black/35 px-3 py-1 text-[0.8125rem] font-semibold text-white/70 hover:bg-black/55 disabled:opacity-60"
          >
            {tt("achievements.refresh")}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-300/90">{error}</p> : null}

      {loading && achievements.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-white/55">
          <Spinner />
          {tt("common.loading")}
        </div>
      ) : achievements.length === 0 ? (
        error ? null : <p className="text-sm text-white/55">{tt("achievements.empty")}</p>
      ) : groups.length === 0 ? (
        <p className="py-6 text-sm text-white/45">{tt("achievements.noneInFilter")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="flex flex-col gap-2">
            <p className="text-[0.75rem] font-bold text-white/45">
              {tt(`achievements.category.${group.category}`)}
              <span className="ml-1.5 font-semibold text-white/30">
                {group.unlocked}/{group.total}
              </span>
            </p>
            <div
              className={`grid items-stretch gap-2 ${
                compact
                  ? "grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]"
              }`}
            >
              {group.rows.map((achievement) => (
                <AchievementCard
                  key={achievement.code}
                  achievement={achievement}
                  language={language}
                  stats={stats}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export function formatAchievementDate(language: Language, iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(localeTag(language));
}

export function formatAchievementProgress(
  language: Language,
  progress: NonNullable<ReturnType<typeof achievementProgress>>,
): string {
  if (progress.metric === "launches") {
    return t(language, "achievements.progressLaunches", {
      current: progress.current,
      target: progress.target,
    });
  }
  const hours = (seconds: number) =>
    (seconds / 3600).toLocaleString(localeTag(language), { maximumFractionDigits: 1 });
  return t(language, "achievements.progressPlaytime", {
    current: hours(progress.current),
    target: hours(progress.target),
  });
}

export function AchievementCard({
  achievement,
  language,
  stats,
}: {
  achievement: AchievementRow;
  language: Language;
  stats?: UserStats | null;
}) {
  const tt = useT(language);
  const progress = achievementProgress(achievement, stats);
  const unlockedDate = achievement.unlocked
    ? formatAchievementDate(language, achievement.unlocked_at)
    : "";

  return (
    <div
      className={`flex h-full gap-2.5 rounded-xl border px-3 py-2.5 transition ${
        achievement.unlocked
          ? "border-amber-400/25 bg-amber-500/10"
          : "border-white/10 bg-black/25"
      }`}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          achievement.unlocked ? "bg-amber-500/20" : "bg-white/5 opacity-50"
        }`}
      >
        <AchievementIcon className="h-4 w-4 object-contain" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p
          className={`text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${
            achievement.unlocked ? "text-white/90" : "text-white/60"
          }`}
        >
          {localizedAchievementField(language, achievement.code, "title", achievement.title)}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-white/50">
          {localizedAchievementField(
            language,
            achievement.code,
            "description",
            achievement.description,
          )}
        </p>
        <div className="mt-auto pt-2">
          {achievement.unlocked ? (
            <p className="text-[0.75rem] text-amber-200/70">
              {unlockedDate
                ? tt("achievements.unlockedAt", { date: unlockedDate })
                : tt("achievements.unlockedNoDate")}
            </p>
          ) : progress ? (
            <div className="flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-amber-300/60"
                  style={{ width: `${Math.max(3, Math.round(progress.ratio * 100))}%` }}
                />
              </div>
              <span className="shrink-0 text-[0.75rem] text-white/40">
                {formatAchievementProgress(language, progress)}
              </span>
            </div>
          ) : (
            <p className="text-[0.75rem] font-semibold text-white/35">{tt("achievements.locked")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
