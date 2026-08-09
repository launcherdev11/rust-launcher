import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeRoom,
  createRoom,
  inviteToRoom,
  joinRoom,
  leaveRoom,
  listFriendsRooms,
  listRooms,
  type Room,
  type RoomMember,
} from "../api/rooms";
import { listFriends, type FriendRow } from "../api/friends";
import { API_AUTH_CHANGED_EVENT, API_NICKNAME_KEY } from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import {
  attachLanTunnel,
  startGuestBridge,
  startHostBridge,
  stopBridge,
  type LanBridgeStatus,
} from "../api/lanBridge";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { useRoomPeerSession } from "../hooks/useRoomPeerSession";
import { useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc, userListAvatarCacheKey } from "../lib/avatar";
import { NicknameWithSponsor } from "../components/SponsorBadge";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

type AvatarTarget = {
  nickname: string;
  ely_username?: string | null;
  mc_uuid?: string | null;
};

type RoomsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  /** Minecraft account kind for the active launcher profile (not platform API session). */
  minecraftAccountKind: "microsoft" | "ely" | "offline" | string;
  /** Same Play-tab launch as the green Play button, but with a server address. */
  onLaunchToServer: (serverAddress: string) => Promise<void>;
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

function shortRoomId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function statusTone(status: string): string {
  if (status === "open") return "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30";
  if (status === "full") return "bg-amber-500/15 text-amber-100 ring-amber-500/30";
  return "bg-white/10 text-white/60 ring-white/15";
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

export function RoomsTab({
  showNotification,
  language,
  minecraftAccountKind,
  onLaunchToServer,
}: RoomsTabProps) {
  const tt = useT(language);

  const mcAuthLabel =
    minecraftAccountKind === "microsoft"
      ? tt("rooms.mcOnlineMicrosoft")
      : minecraftAccountKind === "ely"
        ? tt("rooms.mcOnlineEly")
        : tt("rooms.mcOffline");
  const mcAuthOnline =
    minecraftAccountKind === "microsoft" || minecraftAccountKind === "ely";

  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [profileNickname, setProfileNickname] = useState("");

  const [rooms, setRooms] = useState<Room[]>([]);
  const [friendsRooms, setFriendsRooms] = useState<Room[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [showJoinPanel, setShowJoinPanel] = useState(false);
  const [inviteNickname, setInviteNickname] = useState("");
  const [avatarByKey, setAvatarByKey] = useState<Record<string, string>>({});

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

  const reloadRooms = useCallback(async () => {
    const [mine, friendsOwned, friendList] = await Promise.all([
      listRooms(),
      listFriendsRooms().catch(() => [] as Room[]),
      listFriends().catch(() => [] as FriendRow[]),
    ]);
    setRooms(mine);
    setFriendsRooms(friendsOwned);
    setFriends(friendList);
    setSelectedRoomId((prev) => {
      if (prev && mine.some((r) => r.id === prev)) return prev;
      return null;
    });
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setRooms([]);
      setFriendsRooms([]);
      setFriends([]);
      setSelectedRoomId(null);
      setManaging(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void reloadRooms()
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
  }, [accessToken, reloadRooms, showNotification]);

  useEffect(() => {
    const onWs = (ev: Event) => {
      const detail = (ev as CustomEvent<WsEvent>).detail;
      if (!detail || typeof detail !== "object" || !("type" in detail)) return;
      if (
        detail.type === "room_created" ||
        detail.type === "room_updated" ||
        detail.type === "room_closed" ||
        detail.type === "room_member_joined" ||
        detail.type === "room_member_left" ||
        detail.type === "room_invite"
      ) {
        void reloadRooms().catch(() => {});
      }
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reloadRooms]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const isOwner = selectedRoom?.owner_user_id === userId;

  useEffect(() => {
    if (!selectedRoom) setManaging(false);
  }, [selectedRoom]);

  const [lanPortInput, setLanPortInput] = useState("25565");
  const [bridgeStatus, setBridgeStatus] = useState<string>("idle");
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const tunnelDisposeRef = useRef<(() => void) | null>(null);
  const pendingLanPortRef = useRef<number | null>(null);
  const guestTunnelOpenPendingRef = useRef(false);
  const hostBridgeStartedRef = useRef(false);
  const peerSessionRef = useRef<ReturnType<typeof useRoomPeerSession>["session"]>(null);

  const resetTunnelState = useCallback(() => {
    tunnelDisposeRef.current?.();
    tunnelDisposeRef.current = null;
    pendingLanPortRef.current = null;
    guestTunnelOpenPendingRef.current = false;
    hostBridgeStartedRef.current = false;
    setHostReady(false);
    setBridgeStatus("idle");
    void stopBridge();
  }, []);

  const startHostBridgeIfReady = useCallback(
    async (port: number) => {
      if (hostBridgeStartedRef.current) return;
      hostBridgeStartedRef.current = true;
      try {
        await startHostBridge(port);
        setBridgeStatus("connecting");
      } catch (e) {
        hostBridgeStartedRef.current = false;
        showNotification("error", e instanceof Error ? e.message : String(e));
      }
    },
    [showNotification],
  );

  const onTunnelOpen = useCallback(() => {
    const port = pendingLanPortRef.current;
    if (port == null) {
      guestTunnelOpenPendingRef.current = true;
      return;
    }
    void startHostBridgeIfReady(port);
  }, [startHostBridgeIfReady]);

  const { link: peerLink, session: peerSession } = useRoomPeerSession(selectedRoom, userId, {
    onTunnelOpen: isOwner ? onTunnelOpen : undefined,
    onSessionReset: resetTunnelState,
  });
  peerSessionRef.current = peerSession;

  useEffect(() => {
    return () => {
      tunnelDisposeRef.current?.();
      tunnelDisposeRef.current = null;
    };
  }, []);

  const ensureTunnelAttached = useCallback(async () => {
    const session = peerSessionRef.current;
    if (!session?.channelOpen) {
      throw new Error("P2P DataChannel is not open yet");
    }
    if (tunnelDisposeRef.current) return;
    tunnelDisposeRef.current = await attachLanTunnel({
      sendBinary: (data) => session.sendBinary(data),
      canSend: () => session.canSendBinary,
      onRemoteBinary: (handler) => session.onRemoteBinary(handler),
      onStatus: (s: LanBridgeStatus) => {
        setBridgeStatus(s.state);
        if (s.state === "connected" && !isOwner) {
          session.signalTunnelOpen();
        }
      },
    });
  }, [isOwner]);

  const handleHostShareWorld = async () => {
    const port = Number.parseInt(lanPortInput.trim(), 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      showNotification("warning", "Укажите порт Open to LAN (1–65535)");
      return;
    }
    if (peerLink.status !== "connected" || !peerLink.channelOpen) {
      showNotification("warning", tt("rooms.needP2p"));
      return;
    }
    setTunnelBusy(true);
    try {
      pendingLanPortRef.current = port;
      await ensureTunnelAttached();
      setHostReady(true);
      await startHostBridgeIfReady(port);
      if (guestTunnelOpenPendingRef.current) guestTunnelOpenPendingRef.current = false;
      showNotification(
        "success",
        "Мир готов к подключению. Гость может нажать «Войти в мир».",
      );
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setTunnelBusy(false);
    }
  };

  const handleGuestJoinWorld = async () => {
    if (peerLink.status !== "connected" || !peerLink.channelOpen) {
      showNotification("warning", tt("rooms.needP2p"));
      return;
    }
    if (!mcAuthOnline) {
      showNotification(
        "error",
        "Войти в мир друга нельзя в офлайн-режиме. Войдите через Microsoft или Ely на вкладке Аккаунты.",
      );
      return;
    }
    setTunnelBusy(true);
    try {
      await ensureTunnelAttached();
      const localPort = await startGuestBridge();
      if (!peerSessionRef.current?.channelOpen) {
        throw new Error("P2P канал закрылся до запуска игры — дождитесь channel open и попробуйте снова");
      }
      console.info("[Rooms] guest bridge listening", { localPort, bridgeStatus });
      showNotification(
        "info",
        `Туннель 127.0.0.1:${localPort} — запускаю игру…`,
      );
      await onLaunchToServer(`127.0.0.1:${localPort}`);
      showNotification(
        "success",
        `Игра → 127.0.0.1:${localPort}. Не закрывайте лаунчер — туннель внутри него.`,
      );
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setTunnelBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    setLoading(true);
    try {
      const room = await createRoom(5);
      showNotification("success", tt("rooms.toast.created"));
      await reloadRooms();
      setSelectedRoomId(room.id);
      setManaging(true);
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (roomId?: string) => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    const id = (roomId ?? joinRoomId).trim();
    if (!id) return;
    setLoading(true);
    try {
      const room = await joinRoom(id);
      showNotification("success", tt("rooms.toast.joined"));
      setJoinRoomId("");
      setShowJoinPanel(false);
      await reloadRooms();
      setSelectedRoomId(room.id);
      setManaging(true);
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!selectedRoom) return;
    setLoading(true);
    try {
      await leaveRoom(selectedRoom.id);
      showNotification("info", tt("rooms.toast.left"));
      setManaging(false);
      setSelectedRoomId(null);
      await reloadRooms();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    if (!selectedRoom) return;
    setLoading(true);
    try {
      await closeRoom(selectedRoom.id);
      showNotification("info", tt("rooms.toast.closed"));
      setManaging(false);
      setSelectedRoomId(null);
      await reloadRooms();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleKick = async (memberUserId: string) => {
    if (!selectedRoom) return;
    setLoading(true);
    try {
      await leaveRoom(selectedRoom.id, memberUserId);
      showNotification("info", tt("rooms.toast.kicked"));
      await reloadRooms();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      showNotification("success", tt("rooms.idCopied"), { sound: false });
    } catch {
      showNotification("error", id);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    void reloadRooms()
      .catch((e) => {
        showNotification("error", e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  };

  const statusLabel = (status: string) => {
    if (status === "open") return tt("rooms.status.open");
    if (status === "full") return tt("rooms.status.full");
    if (status === "closed") return tt("rooms.status.closed");
    return status;
  };

  const openRoom = (room: Room) => {
    setSelectedRoomId(room.id);
    setManaging(true);
  };

  const inviteableFriends = useMemo(() => {
    if (!selectedRoom) return friends;
    const memberIds = new Set((selectedRoom.members ?? []).map((m) => m.user_id));
    return friends.filter((f) => !memberIds.has(f.user_id));
  }, [friends, selectedRoom]);

  useEffect(() => {
    let cancelled = false;
    const targets: AvatarTarget[] = [];
    const pushUnique = (target: AvatarTarget) => {
      if (!target.ely_username?.trim() && !target.mc_uuid?.trim()) return;
      const key = userListAvatarCacheKey(target);
      if (targets.some((t) => userListAvatarCacheKey(t) === key)) return;
      targets.push(target);
    };

    for (const room of [...rooms, ...friendsRooms]) {
      for (const m of room.members ?? []) {
        pushUnique(m);
      }
    }
    for (const f of friends) {
      pushUnique(f);
    }

    if (targets.length === 0) {
      setAvatarByKey({});
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
      if (!cancelled) setAvatarByKey(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [rooms, friendsRooms, friends]);

  const avatarSrcFor = useCallback(
    (target: AvatarTarget) =>
      avatarByKey[userListAvatarCacheKey(target)] ?? buildInitialAvatarDataUrl(target.nickname),
    [avatarByKey],
  );

  const p2pReady = peerLink.status === "connected" && peerLink.channelOpen;

  const p2pStatusLabel = (() => {
    if (selectedRoom && selectedRoom.member_count < 2) return tt("rooms.p2pWaiting");
    if (p2pReady) return tt("rooms.p2pReady");
    return tt("rooms.p2pConnecting");
  })();

  const handleInviteFriend = async (nickname: string) => {
    if (!selectedRoom) return;
    const nick = nickname.trim();
    if (!nick) return;
    if (nick === profileNickname.trim()) {
      showNotification("warning", tt("rooms.toast.cannotInviteSelf"));
      return;
    }
    setLoading(true);
    try {
      await inviteToRoom(selectedRoom.id, nick);
      showNotification("success", tt("rooms.toast.invited"));
      setInviteNickname("");
      await reloadRooms();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const renderMyRoomCard = (room: Room) => {
    const owned = room.owner_user_id === userId;
    const members = room.members ?? [];
    return (
      <button
        key={room.id}
        type="button"
        onClick={() => openRoom(room)}
        className="group flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/35 p-4 text-left shadow-soft transition hover:border-emerald-400/35 hover:bg-black/50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold text-white/90">
              {shortRoomId(room.id)}
            </p>
            <p className="mt-1 text-xs text-white/45">
              {tt("rooms.players", { count: room.member_count, max: room.max_players })}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone(room.status)}`}
          >
            {statusLabel(room.status)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <MemberAvatars members={members} avatarSrcFor={avatarSrcFor} />
          <span
            className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
              owned
                ? "bg-emerald-500/15 text-emerald-200"
                : "bg-white/10 text-white/65"
            }`}
          >
            {owned ? tt("rooms.youOwner") : tt("rooms.youMember")}
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-white/8 pt-3 text-xs text-white/40 group-hover:text-emerald-200/80">
          <span>{tt("rooms.openRoom")}</span>
          <span aria-hidden>→</span>
        </div>
      </button>
    );
  };

  const renderFriendRoomCard = (room: Room) => {
    const members = room.members ?? [];
    const owner = members.find((m) => m.user_id === room.owner_user_id);
    const ownerNick = owner?.nickname ?? shortRoomId(room.owner_user_id);
    const canJoin = room.status === "open";

    return (
      <div
        key={room.id}
        className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-black/40 to-black/50 p-4 shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={avatarSrcFor({
                nickname: ownerNick,
                ely_username: owner?.ely_username,
                mc_uuid: owner?.mc_uuid,
              })}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
              draggable={false}
              onError={(event) => {
                event.currentTarget.src = buildInitialAvatarDataUrl(ownerNick);
              }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white/90">{ownerNick}</p>
              <p className="mt-0.5 text-xs text-white/45">
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

        <div className="flex items-center justify-between gap-3">
          <MemberAvatars members={members} avatarSrcFor={avatarSrcFor} />
          <p className="text-xs text-white/45">
            {tt("rooms.players", { count: room.member_count, max: room.max_players })}
          </p>
        </div>

        <button
          type="button"
          disabled={!accessToken || loading || !canJoin}
          onClick={() => void handleJoin(room.id)}
          className="interactive-press mt-auto rounded-xl border border-sky-400/35 bg-sky-500/15 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/25 disabled:opacity-60"
        >
          {tt("rooms.joinFriendRoom")}
        </button>
      </div>
    );
  };

  if (managing && selectedRoom) {
    const members = selectedRoom.members ?? [];
    return (
      <div className="flex w-full max-w-4xl flex-col gap-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setManaging(false)}
            className="interactive-press rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-black/50"
          >
            ← {tt("rooms.backToList")}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyId(selectedRoom.id)}
              className="interactive-press rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-black/50"
            >
              {tt("rooms.copyId")}
            </button>
            {isOwner ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleClose()}
                className="interactive-press rounded-xl border border-red-500/35 bg-red-600/20 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-600/30 disabled:opacity-60"
              >
                {tt("rooms.close")}
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleLeave()}
                className="interactive-press rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm font-semibold text-white/75 hover:bg-black/60 disabled:opacity-60"
              >
                {tt("rooms.leave")}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-black/45 to-black/60 p-5 shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-white/45">
                {tt("rooms.manageTitle")}
              </p>
              <h2 className="mt-1 truncate font-mono text-lg font-bold text-white/95">
                {shortRoomId(selectedRoom.id)}
              </h2>
              <p className="mt-1 text-sm text-white/50">
                {tt("rooms.players", {
                  count: selectedRoom.member_count,
                  max: selectedRoom.max_players,
                })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ${statusTone(selectedRoom.status)}`}
              >
                {statusLabel(selectedRoom.status)}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  isOwner
                    ? "bg-emerald-500/15 text-emerald-200"
                    : "bg-white/10 text-white/65"
                }`}
              >
                {isOwner ? tt("rooms.youOwner") : tt("rooms.youMember")}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="flex flex-col gap-4 lg:col-span-3">
            <section className="rounded-2xl border border-white/10 glass-panel bg-black/40 p-5 shadow-xl backdrop-blur-md">
              <p className="text-xs font-bold uppercase tracking-wider text-white/45">
                {tt("rooms.connectionTitle")}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
                  <span className="text-sm text-white/55">{tt("rooms.mcAccount")}</span>
                  <span
                    className={`text-sm font-semibold ${
                      mcAuthOnline ? "text-emerald-300/90" : "text-amber-300/90"
                    }`}
                  >
                    {mcAuthLabel}
                  </span>
                </div>
                {!mcAuthOnline ? (
                  <p className="text-xs text-amber-200/70">{tt("rooms.mcOfflineHint")}</p>
                ) : null}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
                  <span className="text-sm text-white/55">{tt("rooms.p2pLabel")}</span>
                  <span
                    className={`text-sm font-semibold ${
                      p2pReady ? "text-emerald-300/90" : "text-white/70"
                    }`}
                  >
                    {p2pStatusLabel}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 glass-panel bg-black/40 p-5 shadow-xl backdrop-blur-md">
              <p className="text-xs font-bold uppercase tracking-wider text-white/45">
                {tt("rooms.worldTitle")}
              </p>

              {selectedRoom.member_count < 2 ? (
                <p className="mt-4 text-sm text-white/55">{tt("rooms.waitForPeer")}</p>
              ) : isOwner ? (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-xs font-semibold text-white/45">{tt("rooms.lanPort")}</span>
                      <input
                        type="text"
                        value={lanPortInput}
                        onChange={(e) => setLanPortInput(e.target.value)}
                        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/30"
                        placeholder="25565"
                        disabled={tunnelBusy}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={tunnelBusy || !p2pReady}
                      onClick={() => void handleHostShareWorld()}
                      className="interactive-press rounded-xl border border-emerald-500/40 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60"
                    >
                      {hostReady ? tt("rooms.shareWorldWaiting") : tt("rooms.shareWorld")}
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-white/45">{tt("rooms.hostSteps")}</p>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    disabled={tunnelBusy || !mcAuthOnline || !p2pReady}
                    onClick={() => void handleGuestJoinWorld()}
                    className="interactive-press w-full rounded-xl border border-emerald-500/40 bg-emerald-600/25 px-4 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60 sm:w-fit"
                    title={
                      !mcAuthOnline
                        ? "Войдите через Microsoft или Ely на вкладке Аккаунты"
                        : undefined
                    }
                  >
                    {tt("rooms.joinWorld")}
                  </button>
                  <p className="text-xs leading-relaxed text-white/45">{tt("rooms.guestSteps")}</p>
                </div>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-2">
            <section className="rounded-2xl border border-white/10 glass-panel bg-black/40 p-5 shadow-xl backdrop-blur-md">
              <p className="text-xs font-bold uppercase tracking-wider text-white/45">
                {tt("rooms.membersTitle")}
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {members.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <img
                        src={avatarSrcFor(m)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.src = buildInitialAvatarDataUrl(m.nickname);
                        }}
                      />
                      <div className="min-w-0">
                        <NicknameWithSponsor
                          nickname={m.nickname}
                          isSponsor={m.is_sponsor}
                          sponsorTitle={tt("common.sponsor")}
                        />
                        <p className="text-xs text-white/45">
                          {m.role === "owner" ? tt("rooms.role.owner") : tt("rooms.role.member")}
                        </p>
                      </div>
                    </div>
                    {isOwner && m.role !== "owner" ? (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleKick(m.user_id)}
                        className="interactive-press rounded-lg border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs font-semibold text-white/75 hover:bg-black/60 disabled:opacity-60"
                      >
                        {tt("rooms.kick")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            {isOwner ? (
              <section className="rounded-2xl border border-white/10 glass-panel bg-black/40 p-5 shadow-xl backdrop-blur-md">
                <p className="text-xs font-bold uppercase tracking-wider text-white/45">
                  {tt("rooms.inviteTitle")}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {inviteableFriends.length > 0 ? (
                    <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                      {inviteableFriends.map((f) => (
                        <li
                          key={f.user_id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <img
                              src={avatarSrcFor(f)}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                              draggable={false}
                              onError={(event) => {
                                event.currentTarget.src = buildInitialAvatarDataUrl(f.nickname);
                              }}
                            />
                            <NicknameWithSponsor
                              nickname={f.nickname}
                              isSponsor={f.is_sponsor}
                              sponsorTitle={tt("common.sponsor")}
                              as="span"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void handleInviteFriend(f.nickname)}
                            className="interactive-press shrink-0 rounded-lg border border-emerald-500/35 bg-emerald-600/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
                          >
                            {tt("rooms.invite")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm leading-relaxed text-white/50">{tt("rooms.inviteEmpty")}</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteNickname}
                      onChange={(e) => setInviteNickname(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inviteNickname.trim()) {
                          void handleInviteFriend(inviteNickname);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/30 disabled:opacity-60"
                      placeholder={tt("rooms.inviteNicknamePlaceholder")}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      disabled={loading || !inviteNickname.trim()}
                      onClick={() => void handleInviteFriend(inviteNickname)}
                      className="interactive-press shrink-0 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm font-semibold text-white/75 hover:bg-black/50 disabled:opacity-60"
                    >
                      {tt("rooms.invite")}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 py-6">
      <div className="w-full text-center">
        <h1 className="text-lg font-bold tracking-tight text-white/95">{tt("app.sidebar.rooms")}</h1>
        <p className="mt-1.5 text-sm text-white/50">
          {accessToken ? tt("rooms.subtitleSignedIn") : tt("rooms.subtitleSignedOut")}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 glass-panel bg-black/40 p-4 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!accessToken || loading}
            onClick={() => void handleCreate()}
            className="interactive-press rounded-xl border border-emerald-500/40 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60"
          >
            {tt("rooms.create")}
          </button>
          <button
            type="button"
            disabled={!accessToken}
            onClick={() => setShowJoinPanel((v) => !v)}
            className={`interactive-press rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
              showJoinPanel
                ? "border-sky-400/40 bg-sky-500/20 text-sky-100"
                : "border-white/15 bg-black/30 text-white/70 hover:bg-black/50"
            }`}
          >
            {tt("rooms.joinById")}
          </button>
          <button
            type="button"
            disabled={!accessToken || loading}
            onClick={handleRefresh}
            className="interactive-press rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-sm font-semibold text-white/70 hover:bg-black/50 disabled:opacity-60"
          >
            {tt("rooms.refresh")}
          </button>
        </div>
      </div>

      {showJoinPanel ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4 sm:flex-row sm:items-center">
          <input
            type="text"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/40 disabled:opacity-60"
            placeholder={tt("rooms.joinIdPlaceholder")}
            disabled={!accessToken}
          />
          <button
            type="button"
            disabled={!accessToken || loading || !joinRoomId.trim()}
            onClick={() => void handleJoin()}
            className="interactive-press rounded-xl border border-sky-400/35 bg-sky-500/20 px-4 py-2.5 text-sm font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-60"
          >
            {tt("rooms.join")}
          </button>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-white/45">
            {tt("rooms.yourRooms")}
          </p>
          {loading ? <span className="text-xs text-white/35">…</span> : null}
        </div>

        {!accessToken ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
            {tt("rooms.signInFirst")}
          </p>
        ) : rooms.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
            {tt("rooms.noRooms")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">{rooms.map(renderMyRoomCard)}</div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-white/45">
          {tt("rooms.friendsRooms")}
        </p>

        {!accessToken ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
            {tt("rooms.signInFirst")}
          </p>
        ) : friendsRooms.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
            {tt("rooms.noFriendsRooms")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">{friendsRooms.map(renderFriendRoomCard)}</div>
        )}
      </section>
    </div>
  );
}
