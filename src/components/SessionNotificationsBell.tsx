import { useMemo, type RefObject } from "react";
import type { Language } from "../i18n";
import { t } from "../i18n";

export type SessionNotificationKind = "info" | "success" | "error" | "warning";

export type SessionNotification = {
  id: number;
  kind?: SessionNotificationKind;
  message: string;
  colorMsg?: string;
  iconMsg?: string;
  at: number;
  seen: boolean;
};

type Props = {
  language: Language;
  open: boolean;
  items: SessionNotification[];
  onToggle: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  onClear: () => void;
};

type DisplayItem =
  | {
      type: "single";
      key: string;
      item: SessionNotification;
      latestAt: number;
    }
  | {
      type: "group";
      key: string;
      representative: SessionNotification;
      count: number;
      unread: boolean;
      latestAt: number;
    };

function notificationIdentityKey(n: Pick<SessionNotification, "kind" | "message" | "colorMsg" | "iconMsg">): string {
  return `${n.kind ?? ""}\0${n.message}\0${n.colorMsg ?? ""}\0${n.iconMsg ?? ""}`;
}

function resolveIconSrc(n: Pick<SessionNotification, "kind" | "iconMsg">): string {
  const custom = n.iconMsg?.trim();
  if (custom) {
    if (/^https?:\/\//i.test(custom) || custom.startsWith("/")) return custom;
    if (/^[a-zA-Z0-9_-]+\.(png|webp|gif)$/i.test(custom)) {
      return `/launcher-assets/${custom}`;
    }
    const lower = custom.toLowerCase();
    if (lower === "info") return "/launcher-assets/info.png";
    if (lower === "success") return "/launcher-assets/success.png";
    if (lower === "error") return "/launcher-assets/errorIcon.png";
    if (lower === "warning" || lower === "warn") return "/launcher-assets/warn.png";
  }

  if (n.kind === "success") return "/launcher-assets/success.png";
  if (n.kind === "error") return "/launcher-assets/errorIcon.png";
  if (n.kind === "warning") return "/launcher-assets/warn.png";
  if (n.kind === "info") return "/launcher-assets/info.png";
  return "/launcher-assets/icon.png";
}

function kindLabel(kind: SessionNotificationKind | undefined, language: Language): string {
  if (kind === "success") return t(language, "app.sessionNotifications.kindSuccess");
  if (kind === "error") return t(language, "app.sessionNotifications.kindError");
  if (kind === "warning") return t(language, "app.sessionNotifications.kindWarning");
  if (kind === "info") return t(language, "app.sessionNotifications.kindInfo");
  return t(language, "app.sessionNotifications.kindSystem");
}

function kindAccentClass(kind: SessionNotificationKind | undefined): string {
  if (kind === "success") return "text-emerald-300/90";
  if (kind === "error") return "text-red-300/90";
  if (kind === "warning") return "text-amber-200/90";
  if (kind === "info") return "text-sky-300/90";
  return "text-white/45";
}

function formatTime(at: number, language: Language): string {
  try {
    return new Date(at).toLocaleTimeString(language === "ru" ? "ru-RU" : language, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function buildDisplayItems(items: SessionNotification[]): DisplayItem[] {
  const byKey = new Map<string, SessionNotification[]>();
  for (const item of items) {
    const key = notificationIdentityKey(item);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  const display: DisplayItem[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => b.at - a.at);
    if (sorted.length > 3) {
      display.push({
        type: "group",
        key,
        representative: sorted[0],
        count: sorted.length,
        unread: sorted.some((x) => !x.seen),
        latestAt: sorted[0].at,
      });
    } else {
      for (const item of sorted) {
        display.push({
          type: "single",
          key: `${key}:${item.id}`,
          item,
          latestAt: item.at,
        });
      }
    }
  }

  return display.sort((a, b) => b.latestAt - a.latestAt);
}

export function SessionNotificationsBell({
  language,
  open,
  items,
  onToggle,
  panelRef,
  onClear,
}: Props) {
  const tt = (key: string, params?: Record<string, string | number>) => t(language, key, params);
  const unreadCount = useMemo(() => items.reduce((n, item) => n + (item.seen ? 0 : 1), 0), [items]);
  const displayItems = useMemo(() => buildDisplayItems(items), [items]);

  return (
    <div className="relative" ref={panelRef} data-no-drag>
      <button
        type="button"
        onClick={onToggle}
        className="interactive-press relative flex h-8 w-8 items-center justify-center rounded-md bg-black/25 text-white/70 hover:bg-black/40 hover:text-white"
        title={tt("app.sessionNotifications.title")}
        aria-label={tt("app.sessionNotifications.title")}
        aria-expanded={open}
      >
        <img
          src="/launcher-assets/notiflication.png"
          alt=""
          className="h-5 w-5 object-contain opacity-90"
        />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-[100] mt-1.5 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/12 bg-[#14141c] shadow-2xl">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
              {tt("app.sessionNotifications.heading")}
            </p>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="interactive-press rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white/45 hover:bg-white/10 hover:text-white/80"
              >
                {tt("app.sessionNotifications.clear")}
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(320px,50vh)] overflow-y-auto">
            {displayItems.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-white/45">
                {tt("app.sessionNotifications.empty")}
              </p>
            ) : (
              displayItems.map((entry) => {
                if (entry.type === "group") {
                  const n = entry.representative;
                  return (
                    <div
                      key={entry.key}
                      className={`flex items-start gap-2.5 border-t border-white/5 px-3 py-2.5 ${
                        entry.unread ? "bg-white/[0.04]" : ""
                      }`}
                    >
                      <img
                        src={resolveIconSrc(n)}
                        alt=""
                        className="mt-0.5 h-4 w-4 shrink-0 object-contain opacity-90"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${kindAccentClass(n.kind)}`}>
                            {kindLabel(n.kind, language)}
                          </span>
                          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/75">
                            {tt("app.sessionNotifications.groupBadge", { count: entry.count })}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-white/35">
                            {formatTime(entry.latestAt, language)}
                          </span>
                        </div>
                        <p className="mt-0.5 break-words text-xs leading-snug text-white/88">{n.message}</p>
                        <p className="mt-1 text-[10px] text-white/40">
                          {tt("app.sessionNotifications.groupHint", { count: entry.count })}
                        </p>
                      </div>
                      {entry.unread ? (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                      ) : null}
                    </div>
                  );
                }

                const n = entry.item;
                return (
                  <div
                    key={entry.key}
                    className={`flex items-start gap-2.5 border-t border-white/5 px-3 py-2.5 ${
                      !n.seen ? "bg-white/[0.04]" : ""
                    }`}
                  >
                    <img
                      src={resolveIconSrc(n)}
                      alt=""
                      className="mt-0.5 h-4 w-4 shrink-0 object-contain opacity-90"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${kindAccentClass(n.kind)}`}>
                          {kindLabel(n.kind, language)}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-white/35">
                          {formatTime(n.at, language)}
                        </span>
                      </div>
                      <p className="mt-0.5 break-words text-xs leading-snug text-white/88">{n.message}</p>
                    </div>
                    {!n.seen ? (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
