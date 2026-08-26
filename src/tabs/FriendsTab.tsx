import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { joinRoom, listFriendsRooms, type Room, type RoomMember } from "../api/rooms";
import { WS_EVENT, type WsEvent } from "../api/ws";
import {
  API_AUTH_CHANGED_EVENT,
  API_NICKNAME_KEY,
} from "../api/auth";
import { getStoredAccessToken } from "../api/client";
import { ApiError } from "../api/client";
import { localeTag, useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc, userListAvatarCacheKey } from "../lib/avatar";
import { formatDurationShort, formatPresenceStatus, getElapsedSeconds } from "../lib/socialActivity";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import { UserProfileModal, type UserProfileSeed } from "../components/UserProfileModal";
import {
  ActionButton,
  AuthGate,
  EmptyState,
  FriendRowSkeleton,
  Panel,
  TextField,
} from "../components/ui";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };
type PresenceFilter = "all" | "online" | "offline";

type AvatarTarget = {
  nickname: string;
  ely_username?: string | null;
  mc_uuid?: string | null;
};

function decodeJwtSub(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const payload = JSON.parse(atob(parts[1])) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

function isRoomVisibleToUser(room: Room, userId: string): boolean {
  if (room.visibility !== "private") return true;
  if (!userId) return false;
  if (room.owner_user_id === userId) return true;
  return (room.members ?? []).some((member) => member.user_id === userId);
}

type FriendsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  onOpenRooms?: () => void;
  onOpenAccounts?: () => void;
};

function formatLastSeen(
  iso: string | null | undefined,
  language: Language,
  tt: (key: string, vars?: Record<string, string | number>) => string,
  nowMs: number,
): string {
  if (!iso) return tt("friends.lastSeenNever");
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return tt("friends.lastSeenNever");
  const diffMs = Math.max(0, nowMs - then);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return tt("friends.lastSeenJustNow");
  if (mins < 60) return tt("friends.lastSeenMinutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tt("friends.lastSeenHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 14) return tt("friends.lastSeenDays", { count: days });
  return new Date(then).toLocaleDateString(localeTag(language), {
    day: "numeric",
    month: "short",
  });
}

function MemberAvatars({
  members,
  avatarSrcFor,
  max = 4,
}: {
  members: RoomMember[];
  avatarSrcFor: (member: AvatarTarget) => string;
  max?: number;
}) {
  const shown = members.slice(0, max);
  const extra = Math.max(0, members.length - shown.length);
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <img
          key={m.user_id}
          src={avatarSrcFor(m)}
          alt=""
          title={m.is_sponsor ? `${m.nickname} ★` : m.nickname}
          className="h-7 w-7 rounded-full object-cover ring-2 ring-black/70 [image-rendering:pixelated]"
          style={{ marginLeft: i === 0 ? 0 : -8 }}
          draggable={false}
          onError={(event) => {
            event.currentTarget.src = buildInitialAvatarDataUrl(m.nickname);
          }}
        />
      ))}
      {extra > 0 ? (
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70 ring-2 ring-black/70"
          style={{ marginLeft: shown.length ? -8 : 0 }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "emerald" | "amber" | "sky";
}) {
  const tone =
    accent === "emerald"
      ? "text-emerald-100"
      : accent === "amber"
        ? "text-amber-100"
        : accent === "sky"
          ? "text-sky-100"
          : "text-white/90";
  return (
    <div className="glass-panel rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5 shadow-xl backdrop-blur-md">
      <p className="ui-section">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${tone}`}>{value}</p>
      {hint ? <p className="ui-meta mt-0.5">{hint}</p> : null}
    </div>
  );
}

export function FriendsTab({
  showNotification,
  language,
  onOpenRooms,
  onOpenAccounts,
}: FriendsTabProps) {
  const tt = useT(language);
  const friendNickInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [profileNickname, setProfileNickname] = useState("");

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([]);
  const [friendsRooms, setFriendsRooms] = useState<Room[]>([]);
  const [friendNickToAdd, setFriendNickToAdd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("all");
  const [friendAvatarByKey, setFriendAvatarByKey] = useState<Record<string, string>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, PresenceInfo>>({});
  const [viewingProfile, setViewingProfile] = useState<UserProfileSeed | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const syncAuth = useCallback(() => {
    const token = getStoredAccessToken() ?? "";
    setAccessToken(token);
    setUserId(token ? decodeJwtSub(token) : "");
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

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const reloadAll = useCallback(async () => {
    const [friendsRes, requestsRes, presenceRes, roomsRes] = await Promise.all([
      listFriends(),
      listIncomingRequests(),
      fetchFriendsPresence().catch(() => [] as PresenceInfo[]),
      listFriendsRooms().catch(() => [] as Room[]),
    ]);
    setFriends(friendsRes);
    setIncomingRequests(requestsRes);
    setPresenceByUserId(
      Object.fromEntries(presenceRes.map((p) => [p.user_id, p])),
    );
    setFriendsRooms(roomsRes);
  }, []);

  const handleAcceptRequest = async (requestId: string) => {
    if (!accessToken) return;
    setBusyAction(`accept:${requestId}`);
    setRequestsLoading(true);
    try {
      await acceptFriendRequest(requestId);
      showNotification("success", tt("friends.toast.requestAccepted"));
      await reloadAll();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
      setBusyAction(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!accessToken) return;
    setBusyAction(`reject:${requestId}`);
    setRequestsLoading(true);
    try {
      await rejectFriendRequest(requestId);
      showNotification("info", tt("friends.toast.requestRejected"));
      setIncomingRequests(await listIncomingRequests());
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setRequestsLoading(false);
      setBusyAction(null);
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

    setBusyAction("add");
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
      setBusyAction(null);
    }
  };

  const handleRemoveFriend = async (friend: FriendRow) => {
    if (!accessToken) return;
    const ok = window.confirm(tt("friends.removeConfirm", { nick: friend.nickname }));
    if (!ok) return;

    setBusyAction(`remove:${friend.user_id}`);
    setLoading(true);
    try {
      await removeFriend(friend.user_id);
      showNotification("info", tt("friends.toast.removed"));
      await reloadAll();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  };

  const handleRefresh = () => {
    if (!accessToken) return;
    setBusyAction("refresh");
    setLoading(true);
    setRequestsLoading(true);
    void reloadAll()
      .catch((e) => {
        showNotification("error", e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
        setRequestsLoading(false);
        setBusyAction(null);
      });
  };

  const handleJoinFriendRoom = async (roomId: string) => {
    if (!accessToken) return;
    setBusyAction(`join:${roomId}`);
    setLoading(true);
    try {
      await joinRoom(roomId);
      showNotification("success", tt("rooms.toast.joined"));
      onOpenRooms?.();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
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
      setFriendsRooms([]);
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
            activity: prev[userId]?.activity,
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
        detail.type === "presence_updated"
      ) {
        const next = detail.payload.presence;
        setPresenceByUserId((prev) => ({
          ...prev,
          [next.user_id]: next,
        }));
        return;
      }

      if (
        detail.type === "friend_request_created" ||
        detail.type === "friend_request_accepted" ||
        detail.type === "friend_removed"
      ) {
        void reloadAll().catch(() => {});
        return;
      }

      if (
        detail.type === "room_created" ||
        detail.type === "room_updated" ||
        detail.type === "room_closed" ||
        detail.type === "room_member_joined" ||
        detail.type === "room_member_left" ||
        detail.type === "room_invite"
      ) {
        void listFriendsRooms()
          .then(setFriendsRooms)
          .catch(() => {});
      }
    };

    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reloadAll]);

  useEffect(() => {
    let isCancelled = false;
    const targets: AvatarTarget[] = [
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
      ...friendsRooms.flatMap((room) =>
        (room.members ?? []).map((m) => ({
          nickname: m.nickname,
          ely_username: m.ely_username,
          mc_uuid: m.mc_uuid,
        })),
      ),
    ].filter((t) => t.ely_username?.trim() || t.mc_uuid?.trim());

    if (targets.length === 0) {
      setFriendAvatarByKey({});
      return;
    }

    void (async () => {
      const unique = new Map<string, AvatarTarget>();
      for (const target of targets) {
        unique.set(userListAvatarCacheKey(target), target);
      }
      const entries = await Promise.all(
        [...unique.values()].map(async (target) => {
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
  }, [friends, incomingRequests, friendsRooms]);

  const onlineCount = useMemo(
    () => friends.filter((f) => presenceByUserId[f.user_id]?.online).length,
    [friends, presenceByUserId],
  );

  const visibleFriendsRooms = useMemo(
    () => friendsRooms.filter((room) => isRoomVisibleToUser(room, userId)),
    [friendsRooms, userId],
  );

  const roomByFriendId = useMemo(() => {
    const map = new Map<string, Room>();
    for (const room of visibleFriendsRooms) {
      map.set(room.owner_user_id, room);
      for (const member of room.members ?? []) {
        map.set(member.user_id, room);
      }
    }
    return map;
  }, [visibleFriendsRooms]);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = friends.filter((f) => {
      if (q && !f.nickname.toLowerCase().includes(q)) return false;
      const online = Boolean(presenceByUserId[f.user_id]?.online);
      if (presenceFilter === "online") return online;
      if (presenceFilter === "offline") return !online;
      return true;
    });
    return [...list].sort((a, b) => {
      const aOnline = presenceByUserId[a.user_id]?.online ? 1 : 0;
      const bOnline = presenceByUserId[b.user_id]?.online ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" });
    });
  }, [friends, presenceByUserId, searchQuery, presenceFilter]);

  const onlineFriends = useMemo(
    () => filteredFriends.filter((f) => presenceByUserId[f.user_id]?.online),
    [filteredFriends, presenceByUserId],
  );
  const offlineFriends = useMemo(
    () => filteredFriends.filter((f) => !presenceByUserId[f.user_id]?.online),
    [filteredFriends, presenceByUserId],
  );

  const avatarFor = (input: AvatarTarget) =>
    friendAvatarByKey[userListAvatarCacheKey(input)] ??
    buildInitialAvatarDataUrl(input.nickname);

  const statusLabel = (status: string) => {
    if (status === "open") return tt("rooms.status.open");
    if (status === "full") return tt("rooms.status.full");
    if (status === "closed") return tt("rooms.status.closed");
    return status;
  };

  const statusTone = (status: string) => {
    if (status === "open") return "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30";
    if (status === "full") return "bg-amber-500/15 text-amber-100 ring-amber-500/30";
    return "bg-white/10 text-white/60 ring-white/15";
  };

  const renderFriendCard = (f: FriendRow) => {
    const presence = presenceByUserId[f.user_id];
    const online = Boolean(presence?.online);
    const room = roomByFriendId.get(f.user_id);
    const canJoinRoom = room?.status === "open";
    return (
      <li
        key={f.user_id}
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-3.5 py-3 transition hover:border-white/20 hover:bg-black/40"
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
              className="h-11 w-11 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
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
            <p className={`mt-0.5 text-xs ${online ? "text-emerald-300/80" : "text-white/40"}`}>
              {online
                ? formatPresenceStatus(presence, tt)
                : presence?.last_seen
                  ? formatLastSeen(presence.last_seen, language, tt, nowMs)
                  : tt("friends.lastSeenNever")}
            </p>
            {room ? (
              <p className="mt-0.5 truncate text-[11px] text-sky-200/80">
                {tt("friends.inRoom")}
                {" · "}
                {tt("rooms.players", {
                  count: room.member_count,
                  max: room.max_players,
                })}
              </p>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {canJoinRoom && room ? (
            <ActionButton
              size="sm"
              variant="sky"
              loading={busyAction === `join:${room.id}`}
              loadingLabel={tt("rooms.joining")}
              disabled={loading && busyAction !== `join:${room.id}`}
              onClick={() => void handleJoinFriendRoom(room.id)}
            >
              {tt("rooms.joinFriendRoom")}
            </ActionButton>
          ) : null}
          <ActionButton
            size="sm"
            variant="secondary"
            loading={busyAction === `remove:${f.user_id}`}
            disabled={loading && busyAction !== `remove:${f.user_id}`}
            onClick={() => void handleRemoveFriend(f)}
            className="hover:border-red-400/30 hover:bg-red-600/15 hover:text-red-100"
          >
            {tt("friends.remove")}
          </ActionButton>
        </div>
      </li>
    );
  };

  const howToSteps = [
    tt("friends.howToStep1"),
    tt("friends.howToStep2"),
    tt("friends.howToStep3"),
    tt("friends.howToStep4"),
  ];

  if (!accessToken) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-5 py-6">
        <div className="w-full text-center">
          <h1 className="ui-title">{tt("app.sidebar.friends")}</h1>
          <p className="ui-subtitle mt-1.5">{tt("friends.subtitleSignedOut")}</p>
        </div>
        <AuthGate
          title={tt("friends.authGateTitle")}
          description={tt("friends.authGateBody")}
          ctaLabel={tt("common.goToAccounts")}
          onSignIn={() => onOpenAccounts?.()}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full max-w-4xl flex-col gap-5 py-6">
        <div className="w-full text-center">
          <h1 className="ui-title">{tt("app.sidebar.friends")}</h1>
          <p className="ui-subtitle mt-1.5">
            {tt("friends.subtitleSignedIn")}
          </p>
        </div>

        <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <TextField
            ref={friendNickInputRef}
            type="text"
            value={friendNickToAdd}
            onChange={(e) => setFriendNickToAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && friendNickToAdd.trim()) void handleSendRequest();
            }}
            placeholder={tt("friends.friendNicknamePlaceholder")}
          />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              variant="emerald"
              size="md"
              loading={busyAction === "add"}
              loadingLabel={tt("common.sending")}
              disabled={loading || !friendNickToAdd.trim()}
              onClick={() => void handleSendRequest()}
            >
              {tt("friends.add")}
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="md"
              loading={busyAction === "refresh"}
              loadingLabel={tt("common.loading")}
              disabled={loading && busyAction !== "refresh"}
              onClick={handleRefresh}
            >
              {tt("friends.refresh")}
            </ActionButton>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={tt("friends.statFriends")}
            value={friends.length}
            hint={tt("friends.statFriendsHint")}
          />
          <StatCard
            label={tt("friends.statOnline")}
            value={onlineCount}
            hint={tt("friends.friendsOnline", {
              online: onlineCount,
              total: friends.length,
            })}
            accent="emerald"
          />
          <StatCard
            label={tt("friends.statRequests")}
            value={incomingRequests.length}
            hint={
              incomingRequests.length > 0
                ? tt("friends.incomingCount", { count: incomingRequests.length })
                : tt("friends.noIncoming")
            }
            accent="amber"
          />
          <StatCard
            label={tt("friends.statRooms")}
            value={visibleFriendsRooms.length}
            hint={tt("friends.statRoomsHint")}
            accent="sky"
          />
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex flex-col gap-3">
            <Panel className="flex flex-col gap-3 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="ui-section">
                  {tt("friends.yourFriends")}
                </p>
                {friends.length > 0 ? (
                  <p className="ui-meta mt-0.5">
                    {tt("friends.friendsOnline", {
                      online: onlineCount,
                      total: friends.length,
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            {friends.length > 0 ? (
              <>
                <TextField
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tt("friends.searchPlaceholder")}
                />
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", tt("friends.filterAll"), friends.length],
                      ["online", tt("friends.filterOnline"), onlineCount],
                      ["offline", tt("friends.filterOffline"), friends.length - onlineCount],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPresenceFilter(id)}
                      className={`interactive-press rounded-full px-2.5 py-1 text-xs font-semibold ${
                        presenceFilter === id
                          ? "border border-emerald-400/35 bg-emerald-500/20 text-emerald-100"
                          : "border border-white/10 bg-black/30 text-white/55 hover:bg-black/50"
                      }`}
                    >
                      {label} · {count}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {loading && friends.length === 0 ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <FriendRowSkeleton />
                <FriendRowSkeleton />
                <FriendRowSkeleton />
              </div>
            ) : friends.length === 0 ? (
              <EmptyState
                title={tt("friends.emptyTitle")}
                description={tt("friends.emptyBody")}
                action={
                  <ActionButton
                    variant="primary"
                    size="sm"
                    onClick={() => friendNickInputRef.current?.focus()}
                  >
                    {tt("friends.emptyFocusAdd")}
                  </ActionButton>
                }
              />
            ) : filteredFriends.length === 0 ? (
              <EmptyState
                compact
                title={tt("friends.noSearchResults")}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {onlineFriends.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="ui-section text-emerald-200/70">
                      {tt("friends.onlineSection")} · {onlineFriends.length}
                    </p>
                    <ul className="flex flex-col gap-2">{onlineFriends.map(renderFriendCard)}</ul>
                  </div>
                ) : null}
                {offlineFriends.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="ui-section">
                      {tt("friends.offlineSection")} · {offlineFriends.length}
                    </p>
                    <ul className="flex flex-col gap-2">{offlineFriends.map(renderFriendCard)}</ul>
                  </div>
                ) : null}
              </div>
            )}

            {friends.length === 0 && !loading ? (
              <ol className="mt-1 flex w-full flex-col gap-2">
                {howToSteps.map((step, index) => (
                  <li
                    key={step}
                    className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/25 px-3 py-2.5 text-sm text-white/70"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-emerald-200">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}
            </Panel>
          </section>

          <div className="flex flex-col gap-5">
            <Panel className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-section text-amber-200/80">
                  {tt("friends.incomingTitle")}
                </p>
                {incomingRequests.length > 0 ? (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-100">
                    {incomingRequests.length}
                  </span>
                ) : null}
              </div>

              {incomingRequests.length === 0 ? (
                <EmptyState compact title={tt("friends.noIncoming")} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {incomingRequests.map((r) => (
                    <li
                      key={r.request_id}
                      className="flex flex-col gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2.5"
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
                        <div className="min-w-0">
                          <NicknameWithSponsor
                            nickname={r.from_nickname}
                            isSponsor={r.from_is_sponsor}
                            sponsorTitle={tt("common.sponsor")}
                          />
                          {r.created_at ? (
                            <p className="text-[11px] text-amber-100/60">
                              {formatLastSeen(r.created_at, language, tt, nowMs)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <ActionButton
                          size="sm"
                          variant="emerald"
                          className="flex-1"
                          loading={busyAction === `accept:${r.request_id}`}
                          disabled={requestsLoading && busyAction !== `accept:${r.request_id}`}
                          onClick={() => void handleAcceptRequest(r.request_id)}
                        >
                          {tt("friends.accept")}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          loading={busyAction === `reject:${r.request_id}`}
                          disabled={requestsLoading && busyAction !== `reject:${r.request_id}`}
                          onClick={() => void handleRejectRequest(r.request_id)}
                        >
                          {tt("friends.reject")}
                        </ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-section">
                  {tt("rooms.friendsRooms")}
                </p>
                {onOpenRooms ? (
                  <button
                    type="button"
                    onClick={onOpenRooms}
                    className="ui-caption font-semibold text-sky-200/80 hover:text-sky-100"
                  >
                    {tt("friends.openRooms")}
                  </button>
                ) : null}
              </div>

              {visibleFriendsRooms.length === 0 ? (
                <EmptyState compact title={tt("rooms.noFriendsRooms")} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {visibleFriendsRooms.map((room) => {
                    const members = room.members ?? [];
                    const owner = members.find((m) => m.user_id === room.owner_user_id);
                    const ownerNick = owner?.nickname ?? room.owner_user_id.slice(0, 8);
                    const canJoin = room.status === "open";
                    const roomTitle = room.name?.trim() || ownerNick;
                    const sessionPlaytimeSeconds = getElapsedSeconds(room.session_started_at, nowMs);
                    return (
                      <div
                        key={room.id}
                        className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-3.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <img
                              src={avatarFor({
                                nickname: ownerNick,
                                ely_username: owner?.ely_username,
                                mc_uuid: owner?.mc_uuid,
                              })}
                              alt=""
                              className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                              draggable={false}
                              onError={(event) => {
                                event.currentTarget.src = buildInitialAvatarDataUrl(ownerNick);
                              }}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white/90">{roomTitle}</p>
                              <p className="text-[11px] text-white/45">
                                {tt("rooms.ownedBy", { nick: ownerNick })}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone(room.status)}`}
                          >
                            {statusLabel(room.status)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <MemberAvatars members={members} avatarSrcFor={avatarFor} />
                          <div className="text-right">
                            <p className="text-[11px] text-white/45">
                              {tt("rooms.players", {
                                count: room.member_count,
                                max: room.max_players,
                              })}
                            </p>
                            {sessionPlaytimeSeconds != null ? (
                              <p className="mt-0.5 text-[10px] font-semibold text-emerald-200/80">
                                {tt("rooms.sessionPlaytimeLabel")}:{" "}
                                {formatDurationShort(sessionPlaytimeSeconds, tt)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <ActionButton
                          size="sm"
                          variant="sky"
                          fullWidth
                          loading={busyAction === `join:${room.id}`}
                          loadingLabel={tt("rooms.joining")}
                          disabled={!canJoin || (loading && busyAction !== `join:${room.id}`)}
                          onClick={() => void handleJoinFriendRoom(room.id)}
                        >
                          {tt("rooms.joinFriendRoom")}
                        </ActionButton>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      {viewingProfile ? (
        <UserProfileModal
          language={language}
          seed={viewingProfile}
          isFriend
          onClose={() => setViewingProfile(null)}
        />
      ) : null}
    </>
  );
}
