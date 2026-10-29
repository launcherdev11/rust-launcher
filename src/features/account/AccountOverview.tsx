import { useMemo } from "react";
import {
  AchievementIcon,
  formatAchievementDate,
  formatAchievementProgress,
  localizedAchievementField,
} from "../../components/AchievementsPanel";
import { AccountAvatar } from "../../components/account_avatar";
import { DeleteIcon } from "../../components/delete_icon";
import { PlatformNotificationsPanel } from "../../components/PlatformNotificationsPanel";
import { Spinner } from "../../components/ui";
import type { UserStats } from "../../api/stats";
import type { AchievementsState } from "../../hooks/useAchievements";
import type { PlatformNotificationsState } from "../../hooks/usePlatformNotifications";
import { formatPlaytimeShort, useT, type Language } from "../../i18n";
import { achievementProgress, sortByUnlockedAtDesc } from "../../lib/achievements";
import type { ProfileAvatarInput } from "../../lib/avatar";
import { AssetIcon, accountKindTagClass } from "./icons";

type NotificationKind = "info" | "success" | "error" | "warning";

export type SavedAccount = {
  id: string;
  label: string;
  kind: string;
  is_active: boolean;
};

export function SavedAccountsList({
  language,
  accounts,
  activeAvatar,
  addingAccount,
  accountKindShortLabel,
  onSwitch,
  onRemove,
  onAdd,
}: {
  language: Language;
  accounts: SavedAccount[];
  activeAvatar: ProfileAvatarInput;
  addingAccount: boolean;
  accountKindShortLabel: (kind: string) => string;
  onSwitch: (accountId: string) => void;
  onRemove: (accountId: string) => void;
  onAdd: () => void;
}) {
  const tt = useT(language);

  return (
    <aside className="glass-panel flex min-h-[200px] min-w-0 flex-col overflow-hidden md:min-h-0">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3.5 py-3">
        <h2 className="min-w-0 truncate text-xs font-bold text-white/45">
          {tt("app.accounts.savedListTitle")}
        </h2>
        <button
          type="button"
          disabled={addingAccount}
          onClick={onAdd}
          className="interactive-press flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent-to/40 bg-accent-from/20 px-2.5 text-[0.8125rem] font-semibold text-accent-hi hover:bg-accent-from/30 disabled:opacity-50"
          title={tt("app.accounts.addAccount")}
        >
          <AssetIcon name="add" className="h-3 w-3" />
          {tt("app.accounts.addShort")}
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {accounts.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-white/45">{tt("app.accounts.emptyList")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {accounts.map((acc) => (
              <li key={acc.id}>
                <div
                  className={`group flex items-center gap-2 rounded-xl border px-2 py-2 transition ${
                    acc.is_active
                      ? "border-accent-to/40 bg-accent-from/20"
                      : "border-transparent bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                  }`}
                >
                  <button
                    type="button"
                    disabled={acc.is_active}
                    onClick={() => onSwitch(acc.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left enabled:cursor-pointer disabled:cursor-default"
                  >
                    <AccountAvatar
                      username={acc.label}
                      profile={acc.is_active ? activeAvatar : undefined}
                      kind={acc.kind}
                      size={72}
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white/95">{acc.label}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ${accountKindTagClass(acc.kind)}`}
                        >
                          {accountKindShortLabel(acc.kind)}
                        </span>
                        {acc.is_active ? (
                          <span className="text-[0.75rem] font-medium text-emerald-300/90">
                            {tt("app.accounts.activeBadge")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(acc.id)}
                    className="interactive-press shrink-0 rounded-lg p-2 opacity-40 transition hover:bg-danger/15 hover:opacity-100 group-hover:opacity-80"
                    title={tt("app.accounts.removeTitle")}
                    aria-label={tt("app.accounts.removeTitle")}
                  >
                    <DeleteIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function CardTitle({
  title,
  extra,
  actionLabel,
  onAction,
}: {
  title: string;
  extra?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-bold text-white/45">
        {title}
        {extra ? <span className="ml-1.5 font-semibold text-white/35">{extra}</span> : null}
      </p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="interactive-press rounded-lg px-2 py-0.5 text-[0.8125rem] font-semibold text-accent-hi/90 hover:bg-white/5 hover:text-white"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function OverviewProgressCard({
  language,
  achievements,
  stats,
  onOpenAchievements,
}: {
  language: Language;
  achievements: AchievementsState;
  stats: UserStats | null;
  onOpenAchievements: () => void;
}) {
  const tt = useT(language);
  const rows = achievements.achievements;
  const unlockedCount = rows.filter((a) => a.unlocked).length;

  const recent = useMemo(
    () => sortByUnlockedAtDesc(rows.filter((a) => a.unlocked)).slice(0, 3),
    [rows],
  );
  const next = useMemo(
    () =>
      rows
        .filter((a) => !a.unlocked)
        .map((a) => ({ row: a, progress: achievementProgress(a, stats) }))
        .sort((a, b) => (b.progress?.ratio ?? -1) - (a.progress?.ratio ?? -1))
        .slice(0, 2),
    [rows, stats],
  );

  return (
    <section className="glass-panel flex flex-col gap-3 px-4 py-4">
      <CardTitle
        title={tt("achievements.title")}
        extra={rows.length > 0 ? `${unlockedCount}/${rows.length}` : undefined}
        actionLabel={tt("app.accounts.overview.allAchievements")}
        onAction={onOpenAchievements}
      />

      {stats ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <p className="text-[0.75rem] text-white/45">{tt("app.accounts.stats.playtime")}</p>
            <p className="truncate text-sm font-semibold text-white/90">
              {formatPlaytimeShort(language, stats.playtime_seconds)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <p className="text-[0.75rem] text-white/45">{tt("app.accounts.stats.launches")}</p>
            <p className="truncate text-sm font-semibold text-white/90">{stats.launch_count}</p>
          </div>
        </div>
      ) : null}

      {achievements.loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Spinner className="h-3.5 w-3.5" />
          {tt("common.loading")}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-[0.75rem] text-white/40">{tt("app.accounts.overview.recentAchievements")}</p>
            {recent.length === 0 ? (
              <p className="text-sm text-white/50">{tt("app.accounts.overview.noRecent")}</p>
            ) : (
              recent.map((a) => (
                <div
                  key={a.code}
                  className="flex items-center gap-2.5 rounded-xl border border-warn-line/20 bg-warn/[0.07] px-2.5 py-2"
                >
                  <AchievementIcon className="h-4 w-4 shrink-0 object-contain" />
                  <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-white/90">
                    {localizedAchievementField(language, a.code, "title", a.title)}
                  </p>
                  <span className="shrink-0 text-[0.75rem] text-warn-fg/60">
                    {formatAchievementDate(language, a.unlocked_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          {next.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[0.75rem] text-white/40">{tt("app.accounts.overview.nextAchievements")}</p>
              {next.map(({ row, progress }) => (
                <div key={row.code} className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2">
                  <p className="truncate text-[0.8125rem] font-semibold text-white/70">
                    {localizedAchievementField(language, row.code, "title", row.title)}
                  </p>
                  {progress ? (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-warn-hi/60"
                          style={{ width: `${Math.max(3, Math.round(progress.ratio * 100))}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[0.75rem] text-white/40">
                        {formatAchievementProgress(language, progress)}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-[0.75rem] text-white/45">
                      {localizedAchievementField(language, row.code, "description", row.description)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function OverviewNotificationsCard({
  language,
  notifications,
  showNotification,
  onOpenNotifications,
}: {
  language: Language;
  notifications: PlatformNotificationsState;
  showNotification: (kind: NotificationKind, message: string) => void;
  onOpenNotifications: () => void;
}) {
  const tt = useT(language);
  return (
    <section className="glass-panel flex flex-col gap-3 px-4 py-4">
      <CardTitle
        title={tt("notifications.title")}
        extra={notifications.unread > 0 ? String(notifications.unread) : undefined}
        actionLabel={tt("app.accounts.overview.allNotifications")}
        onAction={onOpenNotifications}
      />
      <PlatformNotificationsPanel
        language={language}
        showNotification={showNotification}
        state={notifications}
        variant="preview"
        previewLimit={3}
      />
    </section>
  );
}

export function SignedOutCard({ language, onSignIn }: { language: Language; onSignIn: () => void }) {
  const tt = useT(language);
  return (
    <section className="glass-panel flex flex-col gap-3 px-4 py-4">
      <p className="text-sm font-semibold text-white/90">{tt("app.accounts.overview.signedOutTitle")}</p>
      <p className="text-sm leading-relaxed text-white/55">{tt("app.accounts.overview.signedOutBody")}</p>
      <button
        type="button"
        onClick={onSignIn}
        className="interactive-press self-start rounded-xl border border-accent-to/40 bg-accent-from/20 px-3.5 py-2 text-xs font-semibold text-accent-hi hover:bg-accent-from/30"
      >
        {tt("app.accounts.signIn")}
      </button>
    </section>
  );
}
