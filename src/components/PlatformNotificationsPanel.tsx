import { useMemo, useState } from "react";
import type { PlatformNotification } from "../api/notifications";
import {
  usePlatformNotifications,
  type PlatformNotificationsState,
} from "../hooks/usePlatformNotifications";
import { localeTag, useT, type Language } from "../i18n";
import { localizedAchievementField } from "./AchievementsPanel";
import { Spinner } from "./ui";

type NotificationKind = "info" | "success" | "error" | "warning";

type Props = {
  showNotification: (kind: NotificationKind, message: string) => void;
  language: Language;
  state?: PlatformNotificationsState;
  variant?: "full" | "preview";
  previewLimit?: number;
  onSignIn?: () => void;
  className?: string;
};

type Filter = "all" | "unread";

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function PlatformNotificationsPanel({
  showNotification,
  language,
  state,
  variant = "full",
  previewLimit = 4,
  onSignIn,
  className = "",
}: Props) {
  const tt = useT(language);
  const own = usePlatformNotifications({
    enabled: !state,
    onError: (message) => showNotification("error", message),
  });
  const { signedIn, items, unread, loading, error, reload, markRead, markAllRead } = state ?? own;
  const [filter, setFilter] = useState<Filter>("all");
  const preview = variant === "preview";
  const locale = localeTag(language);

  const labelFor = (n: PlatformNotification) => {
    const p = n.payload ?? {};
    if (n.type === "friend_request") {
      return tt("notifications.friendRequest", { nick: String(p.from_nickname ?? "") });
    }
    if (n.type === "friend_accept") {
      return tt("notifications.friendAccept", { nick: String(p.friend_nickname ?? "") });
    }
    if (n.type === "room_invite") {
      return tt("notifications.roomInvite", { nick: String(p.from_nickname ?? "") });
    }
    if (n.type === "achievement") {
      const code = String(p.code ?? "");
      const title = localizedAchievementField(language, code, "title", String(p.title ?? code));
      return tt("notifications.achievement", { title });
    }
    return tt("notifications.system");
  };

  const groups = useMemo(() => {
    const visible = preview
      ? items.slice(0, previewLimit)
      : filter === "unread"
        ? items.filter((n) => !n.read_at)
        : items;
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const out: { key: string; label: string; rows: PlatformNotification[] }[] = [];
    for (const n of visible) {
      const date = new Date(n.created_at);
      const valid = !Number.isNaN(date.getTime());
      const key = valid ? dayKey(date) : "unknown";
      let group = out.find((g) => g.key === key);
      if (!group) {
        const label = !valid
          ? "—"
          : key === dayKey(now)
            ? tt("notifications.today")
            : key === dayKey(yesterday)
              ? tt("notifications.yesterday")
              : date.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "long",
                  year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
                });
        group = { key, label, rows: [] };
        out.push(group);
      }
      group.rows.push(n);
    }
    return out;
  }, [items, filter, preview, previewLimit, locale, tt]);

  if (!signedIn) {
    return (
      <div className={className}>
        <p className="text-sm text-white/55">{tt("notifications.signInFirst")}</p>
        {onSignIn ? (
          <button type="button" className="btn btn-tint btn-sm mt-3" onClick={onSignIn}>
            {tt("app.accounts.signIn")}
          </button>
        ) : null}
      </div>
    );
  }

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    if (!preview || date.toDateString() === new Date().toDateString()) return time;
    return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${time}`;
  };

  const renderItem = (n: PlatformNotification) => {
    const isUnread = !n.read_at;
    return (
      <li
        key={n.id}
        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
          isUnread ? "border-accent-to/30 bg-accent-from/10" : "border-white/10 bg-black/20"
        }`}
      >
        <div className="min-w-0">
          <p className={`text-sm [overflow-wrap:anywhere] ${isUnread ? "text-white/90" : "text-white/60"}`}>
            {labelFor(n)}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-white/40">{formatTime(n.created_at)}</p>
        </div>
        {isUnread && !preview ? (
          <button
            type="button"
            onClick={() => void markRead(n.id)}
            className="interactive-press shrink-0 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[0.8125rem] font-semibold text-white/70 hover:bg-black/50"
          >
            {tt("notifications.markRead")}
          </button>
        ) : null}
      </li>
    );
  };

  const list =
    loading && items.length === 0 ? (
      <div className="flex items-center gap-2 py-6 text-sm text-white/55">
        <Spinner />
        {tt("common.loading")}
      </div>
    ) : groups.length === 0 ? (
      <p className="text-sm text-white/55">
        {filter === "unread" && items.length > 0
          ? tt("notifications.emptyUnread")
          : tt("notifications.empty")}
      </p>
    ) : preview ? (
      <ul className="flex flex-col gap-2">{groups.flatMap((g) => g.rows).map(renderItem)}</ul>
    ) : (
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            <p className="text-[0.75rem] font-bold text-white/45">{group.label}</p>
            <ul className="flex flex-col gap-2">{group.rows.map(renderItem)}</ul>
          </section>
        ))}
      </div>
    );

  if (preview) {
    return <div className={className}>{list}</div>;
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white/90">{tt("notifications.title")}</p>
          <p className="text-xs text-white/45">
            {unread > 0 ? tt("notifications.unread", { count: unread }) : tt("notifications.allRead")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass-toolbar flex h-8 items-center gap-1 p-1">
            {(
              [
                ["all", tt("notifications.filterAll")],
                ["unread", tt("notifications.filterUnread")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`interactive-press rounded-lg px-2.5 py-1 text-[0.75rem] font-semibold transition-colors ${
                  filter === id ? "seg-on" : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void reload()}
            className="interactive-press rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
          >
            {tt("notifications.refresh")}
          </button>
          <button
            type="button"
            disabled={loading || unread === 0}
            onClick={() => void markAllRead()}
            className="interactive-press rounded-lg border border-accent-to/40 bg-accent-from/20 px-3 py-1.5 text-xs font-semibold text-accent-hi hover:bg-accent-from/30 disabled:opacity-60"
          >
            {tt("notifications.readAll")}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger-hi/90">{error}</p> : null}

      {list}
    </div>
  );
}
