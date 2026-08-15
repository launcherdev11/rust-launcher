import { useCallback, useEffect, useState } from "react";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type PlatformNotification,
} from "../api/notifications";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { useT, type Language } from "../i18n";
import { localizedAchievementField } from "./AchievementsPanel";

type NotificationKind = "info" | "success" | "error" | "warning";

type Props = {
  showNotification: (kind: NotificationKind, message: string) => void;
  language: Language;
};

export function PlatformNotificationsPanel({ showNotification, language }: Props) {
  const tt = useT(language);
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PlatformNotification[]>([]);

  const syncAuth = useCallback(() => {
    setAccessToken(getStoredAccessToken() ?? "");
  }, []);

  useEffect(() => {
    syncAuth();
    window.addEventListener(API_AUTH_CHANGED_EVENT, syncAuth);
    window.addEventListener("storage", syncAuth);
    return () => {
      window.removeEventListener(API_AUTH_CHANGED_EVENT, syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, [syncAuth]);

  const reload = useCallback(async () => {
    setItems(await listNotifications());
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void reload()
      .catch((e) => {
        if (!cancelled) {
          showNotification("error", e instanceof ApiError ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, reload, showNotification]);

  useEffect(() => {
    const onWs = (ev: Event) => {
      const detail = (ev as CustomEvent<WsEvent>).detail;
      if (detail?.type === "notification") {
        void reload().catch(() => {});
      }
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reload]);

  const unread = items.filter((n) => !n.read_at).length;

  const labelFor = (n: PlatformNotification) => {
    const p = n.payload ?? {};
    if (n.type === "friend_request") {
      return tt("notifications.friendRequest", {
        nick: String(p.from_nickname ?? ""),
      });
    }
    if (n.type === "friend_accept") {
      return tt("notifications.friendAccept", {
        nick: String(p.friend_nickname ?? ""),
      });
    }
    if (n.type === "room_invite") {
      return tt("notifications.roomInvite", {
        nick: String(p.from_nickname ?? ""),
      });
    }
    if (n.type === "achievement") {
      const code = String(p.code ?? "");
      const title = localizedAchievementField(
        language,
        code,
        "title",
        String(p.title ?? code),
      );
      return tt("notifications.achievement", { title });
    }
    return tt("notifications.system");
  };

  return (
    <div className="w-full rounded-2xl border border-white/10 glass-panel bg-black/40 px-5 py-5 shadow-xl backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white/90">{tt("notifications.title")}</p>
          <p className="text-xs text-white/45">
            {accessToken
              ? tt("notifications.unread", { count: unread })
              : tt("notifications.signInFirst")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!accessToken || loading}
            onClick={() => {
              setLoading(true);
              void reload()
                .catch((e) => showNotification("error", e instanceof ApiError ? e.message : String(e)))
                .finally(() => setLoading(false));
            }}
            className="interactive-press rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
          >
            {tt("notifications.refresh")}
          </button>
          <button
            type="button"
            disabled={!accessToken || loading || unread === 0}
            onClick={() => {
              setLoading(true);
              void markAllNotificationsRead()
                .then(reload)
                .catch((e) => showNotification("error", e instanceof ApiError ? e.message : String(e)))
                .finally(() => setLoading(false));
            }}
            className="interactive-press rounded-lg border border-emerald-500/35 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
          >
            {tt("notifications.readAll")}
          </button>
        </div>
      </div>

      {!accessToken ? null : items.length === 0 ? (
        <p className="text-sm text-white/55">{tt("notifications.empty")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {items.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 ${
                n.read_at ? "border-white/10 bg-black/20" : "border-emerald-500/25 bg-emerald-600/10"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm text-white/90">{labelFor(n)}</p>
                <p className="mt-0.5 text-[11px] text-white/40">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              {!n.read_at ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    void markNotificationRead(n.id)
                      .then(reload)
                      .catch((e) =>
                        showNotification("error", e instanceof ApiError ? e.message : String(e)),
                      );
                  }}
                  className="interactive-press shrink-0 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
                >
                  {tt("notifications.markRead")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
