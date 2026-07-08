import { useCallback, useEffect, useState } from "react";
import {
  acceptFriendRequest,
  listFriends,
  listIncomingRequests,
  rejectFriendRequest,
  sendFriendRequest,
  type FriendRow,
  type IncomingRequestRow,
} from "../api/friends";
import {
  API_AUTH_CHANGED_EVENT,
  API_NICKNAME_KEY,
} from "../api/auth";
import { getStoredAccessToken } from "../api/client";
import { ApiError } from "../api/client";
import { useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getElyAvatarByUsername } from "../lib/avatar";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

type FriendsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
};

export function FriendsTab({ showNotification, language }: FriendsTabProps) {
  const tt = useT(language);

  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [profileNickname, setProfileNickname] = useState("");

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([]);
  const [friendNickToAdd, setFriendNickToAdd] = useState("");
  const [friendAvatarByKey, setFriendAvatarByKey] = useState<Record<string, string>>({});

  const syncAuth = useCallback(() => {
    const token = getStoredAccessToken() ?? "";
    setAccessToken(token);
    try {
      setProfileNickname(window.localStorage.getItem(API_NICKNAME_KEY) ?? "");
    } catch {
      setProfileNickname("");
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

  const reloadAll = useCallback(async () => {
    const [friendsRes, requestsRes] = await Promise.all([listFriends(), listIncomingRequests()]);
    setFriends(friendsRes);
    setIncomingRequests(requestsRes);
  }, []);

  const handleLoadFriends = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      setFriends(await listFriends());
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadIncomingRequests = async () => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      setIncomingRequests(await listIncomingRequests());
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      await acceptFriendRequest(requestId);
      showNotification("success", tt("friends.toast.requestAccepted"));
      await reloadAll();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      await rejectFriendRequest(requestId);
      showNotification("info", tt("friends.toast.requestRejected"));
      setIncomingRequests(await listIncomingRequests());
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleSendRequest = async () => {
    if (!accessToken) {
      showNotification("warning", tt("friends.toast.signInFirst"));
      return;
    }
    const toNick = friendNickToAdd.trim();
    if (!toNick) return;
    if (toNick === profileNickname.trim()) {
      showNotification("warning", tt("friends.toast.cannotAddSelf"));
      return;
    }

    setLoading(true);
    try {
      const result = await sendFriendRequest(toNick);
      if (result.already_exists) {
        showNotification("info", tt("friends.toast.requestExists"));
      } else {
        showNotification("success", tt("friends.toast.requestSent"));
      }
      setFriendNickToAdd("");
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) {
      setFriends([]);
      setIncomingRequests([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setRequestsLoading(true);

    void reloadAll()
      .catch((e) => {
        if (!cancelled) {
          showNotification("error", e instanceof ApiError ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRequestsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadAll, showNotification]);

  useEffect(() => {
    let isCancelled = false;
    const elyNicknames = Array.from(
      new Set(
        [
          ...friends.map((f) => f.ely_username ?? ""),
          ...incomingRequests.map((r) => r.from_ely_username ?? ""),
        ]
          .map((nick) => nick.trim())
          .filter((nick) => nick.length > 0),
      ),
    );
    if (elyNicknames.length === 0) {
      setFriendAvatarByKey({});
      return;
    }

    void (async () => {
      const entries = await Promise.all(
        elyNicknames.map(async (elyUsername) => {
          const fallback = buildInitialAvatarDataUrl(elyUsername);
          const src = await getElyAvatarByUsername(elyUsername, fallback, 64);
          return [elyUsername.toLowerCase(), src] as const;
        }),
      );
      if (!isCancelled) {
        setFriendAvatarByKey(Object.fromEntries(entries));
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [friends, incomingRequests]);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 py-6">
      <div className="w-full text-center">
        <h1 className="text-lg font-bold tracking-tight text-white/95">{tt("app.sidebar.friends")}</h1>
        <p className="mt-1.5 text-sm text-white/50">
          {accessToken ? tt("friends.subtitleSignedIn") : tt("friends.subtitleSignedOut")}
        </p>
      </div>

      <div className="w-full rounded-2xl border border-white/10 glass-panel bg-black/40 px-6 py-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={friendNickToAdd}
              onChange={(e) => setFriendNickToAdd(e.target.value)}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30 disabled:opacity-60"
              placeholder={tt("friends.friendNicknamePlaceholder")}
              disabled={!accessToken}
            />
            <button
              type="button"
              disabled={!accessToken || loading || !friendNickToAdd.trim()}
              onClick={() => void handleSendRequest()}
              className="interactive-press rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
            >
              {tt("friends.add")}
            </button>
            <button
              type="button"
              disabled={!accessToken || loading}
              onClick={() => void handleLoadFriends()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
            >
              {tt("friends.refresh")}
            </button>
            <button
              type="button"
              disabled={!accessToken || requestsLoading}
              onClick={() => void handleLoadIncomingRequests()}
              className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
            >
              {tt("friends.requests")}
            </button>
          </div>

          <div className="h-px w-full bg-white/10" />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-white/45">{tt("friends.incomingTitle")}</p>
            {!accessToken ? (
              <p className="text-sm text-white/60">{tt("friends.signInFirst")}</p>
            ) : incomingRequests.length === 0 ? (
              <p className="text-sm text-white/60">{tt("friends.noIncoming")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {incomingRequests.map((r) => (
                  <li
                    key={r.request_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <img
                        src={
                          (r.from_ely_username
                            ? friendAvatarByKey[r.from_ely_username.trim().toLowerCase()]
                            : undefined) ?? buildInitialAvatarDataUrl(r.from_nickname)
                        }
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.src = buildInitialAvatarDataUrl(r.from_nickname);
                        }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white/90">{r.from_nickname}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={requestsLoading}
                        onClick={() => void handleAcceptRequest(r.request_id)}
                        className="interactive-press rounded-lg border border-emerald-500/35 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
                      >
                        {tt("friends.accept")}
                      </button>
                      <button
                        type="button"
                        disabled={requestsLoading}
                        onClick={() => void handleRejectRequest(r.request_id)}
                        className="interactive-press rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/75 hover:bg-black/60 disabled:opacity-60"
                      >
                        {tt("friends.reject")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="h-px w-full bg-white/10" />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wider text-white/45">{tt("friends.yourFriends")}</p>
            {!accessToken ? (
              <p className="text-sm text-white/60">{tt("friends.signInFirst")}</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-white/60">{tt("friends.noFriends")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {friends.map((f) => (
                  <li
                    key={f.user_id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                  >
                    <img
                      src={
                        (f.ely_username
                          ? friendAvatarByKey[f.ely_username.trim().toLowerCase()]
                          : undefined) ?? buildInitialAvatarDataUrl(f.nickname)
                      }
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
                      draggable={false}
                      onError={(event) => {
                        event.currentTarget.src = buildInitialAvatarDataUrl(f.nickname);
                      }}
                    />
                    <span className="truncate text-sm font-semibold text-white/90">{f.nickname}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
