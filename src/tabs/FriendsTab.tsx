import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptFriendRequest,
  listFriends,
  listIncomingRequests,
  rejectFriendRequest,
  removeFriend,
  sendFriendRequest,
  type FriendRow,
  type IncomingRequestRow,
} from "../api/friends";
import { fetchFriendsPresence, type PresenceInfo } from "../api/presence";
import { WS_EVENT, type WsEvent } from "../api/ws";
import {
  API_AUTH_CHANGED_EVENT,
  API_NICKNAME_KEY,
} from "../api/auth";
import { getStoredAccessToken } from "../api/client";
import { ApiError } from "../api/client";
import { useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc, userListAvatarCacheKey } from "../lib/avatar";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import { UserProfileModal, type UserProfileSeed } from "../components/UserProfileModal";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [friendAvatarByKey, setFriendAvatarByKey] = useState<Record<string, string>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, PresenceInfo>>({});
  const [viewingProfile, setViewingProfile] = useState<UserProfileSeed | null>(null);

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
    const [friendsRes, requestsRes, presenceRes] = await Promise.all([
      listFriends(),
      listIncomingRequests(),
      fetchFriendsPresence().catch(() => [] as PresenceInfo[]),
    ]);
    setFriends(friendsRes);
    setIncomingRequests(requestsRes);
    setPresenceByUserId(
      Object.fromEntries(presenceRes.map((p) => [p.user_id, p])),
    );
  }, []);

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

  const handleRemoveFriend = async (friend: FriendRow) => {
    if (!accessToken) return;
    const ok = window.confirm(tt("friends.removeConfirm", { nick: friend.nickname }));
    if (!ok) return;

    setLoading(true);
    try {
      await removeFriend(friend.user_id);
      showNotification("info", tt("friends.toast.removed"));
      await reloadAll();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openFriendProfile = (friend: FriendRow) => {
    setViewingProfile({
      user_id: friend.user_id,
      nickname: friend.nickname,
      is_sponsor: friend.is_sponsor,
      ely_username: friend.ely_username,
      mc_uuid: friend.mc_uuid,
      online: Boolean(presenceByUserId[friend.user_id]?.online),
    });
  };

  useEffect(() => {
    if (!accessToken) {
      setFriends([]);
      setIncomingRequests([]);
      setPresenceByUserId({});
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
    const onWs = (ev: Event) => {
      const detail = (ev as CustomEvent<WsEvent>).detail;
      if (!detail || typeof detail !== "object" || !("type" in detail)) return;

      if (detail.type === "user_online") {
        const userId = detail.payload.user_id;
        setPresenceByUserId((prev) => ({
          ...prev,
          [userId]: {
            user_id: userId,
            online: true,
            last_seen: prev[userId]?.last_seen,
          },
        }));
        return;
      }

      if (detail.type === "user_offline") {
        const userId = detail.payload.user_id;
        setPresenceByUserId((prev) => ({
          ...prev,
          [userId]: {
            user_id: userId,
            online: false,
            last_seen: detail.payload.last_seen ?? prev[userId]?.last_seen,
          },
        }));
        return;
      }

      if (
        detail.type === "friend_request_created" ||
        detail.type === "friend_request_accepted" ||
        detail.type === "friend_removed"
      ) {
        void reloadAll().catch(() => {});
      }
    };

    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reloadAll]);

  useEffect(() => {
    let isCancelled = false;
    const targets = [
      ...friends.map((f) => ({
        nickname: f.nickname,
        ely_username: f.ely_username,
        mc_uuid: f.mc_uuid,
      })),
      ...incomingRequests.map((r) => ({
        nickname: r.from_nickname,
        ely_username: r.from_ely_username,
        mc_uuid: r.from_mc_uuid,
      })),
    ].filter((t) => t.ely_username?.trim() || t.mc_uuid?.trim());

    if (targets.length === 0) {
      setFriendAvatarByKey({});
      return;
    }

    void (async () => {
      const entries = await Promise.all(
        targets.map(async (target) => {
          const key = userListAvatarCacheKey(target);
          const src = await getUserListAvatarSrc(target, 64);
          return [key, src] as const;
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

  const onlineCount = useMemo(
    () => friends.filter((f) => presenceByUserId[f.user_id]?.online).length,
    [friends, presenceByUserId],
  );

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? friends.filter((f) => f.nickname.toLowerCase().includes(q))
      : friends;
    return [...list].sort((a, b) => {
      const aOnline = presenceByUserId[a.user_id]?.online ? 1 : 0;
      const bOnline = presenceByUserId[b.user_id]?.online ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" });
    });
  }, [friends, presenceByUserId, searchQuery]);

  const avatarFor = (input: {
    nickname: string;
    ely_username?: string | null;
    mc_uuid?: string | null;
  }) =>
    friendAvatarByKey[userListAvatarCacheKey(input)] ??
    buildInitialAvatarDataUrl(input.nickname);

  return (
    <>
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 py-6">
        <div className="w-full text-center">
          <h1 className="text-lg font-bold tracking-tight text-white/95">{tt("app.sidebar.friends")}</h1>
          <p className="mt-1.5 text-sm text-white/50">
            {accessToken ? tt("friends.subtitleSignedIn") : tt("friends.subtitleSignedOut")}
          </p>
        </div>

        <div className="w-full rounded-2xl border border-white/10 glass-panel bg-black/40 px-5 py-5 shadow-xl backdrop-blur-md sm:px-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={friendNickToAdd}
                onChange={(e) => setFriendNickToAdd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && friendNickToAdd.trim()) void handleSendRequest();
                }}
                className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/30 disabled:opacity-60"
                placeholder={tt("friends.friendNicknamePlaceholder")}
                disabled={!accessToken}
              />
              <button
                type="button"
                disabled={!accessToken || loading || !friendNickToAdd.trim()}
                onClick={() => void handleSendRequest()}
                className="interactive-press rounded-xl border border-emerald-500/35 bg-emerald-600/20 px-4 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
              >
                {tt("friends.add")}
              </button>
            </div>

            {!accessToken ? (
              <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/55">
                {tt("friends.signInFirst")}
              </p>
            ) : (
              <>
                {incomingRequests.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-xs font-semibold tracking-wide text-amber-200/80">
                      {tt("friends.incomingCount", { count: incomingRequests.length })}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {incomingRequests.map((r) => (
                        <li
                          key={r.request_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2.5"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <img
                              src={avatarFor({
                                nickname: r.from_nickname,
                                ely_username: r.from_ely_username,
                                mc_uuid: r.from_mc_uuid,
                              })}
                              alt=""
                              className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                              draggable={false}
                              onError={(event) => {
                                event.currentTarget.src = buildInitialAvatarDataUrl(r.from_nickname);
                              }}
                            />
                            <NicknameWithSponsor
                              nickname={r.from_nickname}
                              isSponsor={r.from_is_sponsor}
                              sponsorTitle={tt("common.sponsor")}
                            />
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
                  </div>
                ) : null}

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-white/45">
                        {tt("friends.yourFriends")}
                      </p>
                      {friends.length > 0 ? (
                        <p className="mt-0.5 text-xs text-white/40">
                          {tt("friends.friendsOnline", {
                            online: onlineCount,
                            total: friends.length,
                          })}
                        </p>
                      ) : null}
                    </div>
                    {loading ? <span className="text-xs text-white/35">…</span> : null}
                  </div>

                  {friends.length > 0 ? (
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
                      placeholder={tt("friends.searchPlaceholder")}
                    />
                  ) : null}

                  {friends.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/55">
                      {tt("friends.noFriends")}
                    </p>
                  ) : filteredFriends.length === 0 ? (
                    <p className="text-sm text-white/55">{tt("friends.noSearchResults")}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {filteredFriends.map((f) => {
                        const online = Boolean(presenceByUserId[f.user_id]?.online);
                        return (
                          <li
                            key={f.user_id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 transition hover:border-white/20 hover:bg-black/40"
                          >
                            <button
                              type="button"
                              onClick={() => openFriendProfile(f)}
                              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:opacity-95"
                              title={tt("friends.viewProfile")}
                            >
                              <div className="relative shrink-0">
                                <img
                                  src={avatarFor({
                                    nickname: f.nickname,
                                    ely_username: f.ely_username,
                                    mc_uuid: f.mc_uuid,
                                  })}
                                  alt=""
                                  className="h-9 w-9 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                                  draggable={false}
                                  onError={(event) => {
                                    event.currentTarget.src = buildInitialAvatarDataUrl(f.nickname);
                                  }}
                                />
                                <span
                                  className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-black/80 ${
                                    online ? "bg-emerald-400" : "bg-white/25"
                                  }`}
                                />
                              </div>
                              <div className="min-w-0">
                                <NicknameWithSponsor
                                  nickname={f.nickname}
                                  isSponsor={f.is_sponsor}
                                  sponsorTitle={tt("common.sponsor")}
                                />
                                <p
                                  className={`text-xs ${
                                    online ? "text-emerald-300/80" : "text-white/40"
                                  }`}
                                >
                                  {online ? tt("friends.online") : tt("friends.offline")}
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void handleRemoveFriend(f)}
                              className="interactive-press shrink-0 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs font-semibold text-white/55 hover:border-red-400/30 hover:bg-red-600/15 hover:text-red-100 disabled:opacity-60"
                            >
                              {tt("friends.remove")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {viewingProfile ? (
        <UserProfileModal
          language={language}
          seed={viewingProfile}
          onClose={() => setViewingProfile(null)}
        />
      ) : null}
    </>
  );
}
