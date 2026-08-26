import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeRoom,
  createRoom,
  getRoomSession,
  inviteToRoom,
  joinRoom,
  leaveRoom,
  listFriendsRooms,
  listRooms,
  type Room,
  type RoomMember,
  type RoomSession,
} from "../api/rooms";
import { listFriends, sendFriendRequest, type FriendRow } from "../api/friends";
import { API_AUTH_CHANGED_EVENT, API_NICKNAME_KEY } from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { UserProfileModal, type UserProfileSeed } from "../components/UserProfileModal";
import {
  allowGuestForward,
  attachLanTunnel,
  getLocalLanIp,
  startGuestBridge,
  startHostBridge,
  stopBridge,
  type LanBridgeStatus,
} from "../api/lanBridge";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { useRoomPeerSession } from "../hooks/useRoomPeerSession";
import { useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc, userListAvatarCacheKey } from "../lib/avatar";
import {
  formatDurationShort,
  formatRoomVisibility,
  getElapsedSeconds,
  type LaunchPresenceContext,
  type RoomPresenceContext,
} from "../lib/socialActivity";
import { copyTextToClipboard } from "../lib/clipboard";
import type { GameStatus } from "../lib/gameConsoleWindow";
import { NicknameWithSponsor } from "../components/SponsorBadge";
import {
  ActionButton,
  AuthGate,
  EmptyState,
  Modal,
  Panel,
  RoomCardSkeleton,
  TextField,
} from "../components/ui";

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
  minecraftAccountKind: "microsoft" | "ely" | "offline" | string;
  gameStatus: GameStatus;
  onLaunchToServer: (
    serverAddress: string,
    options?: {
      requireOnlineAccount?: boolean;
      presenceContext?: LaunchPresenceContext | null;
    },
  ) => Promise<void>;
  onPresenceContextChange?: (context: RoomPresenceContext | null) => void;
  onRoomLaunchContextChange?: (context: LaunchPresenceContext | null) => void;
  onOpenAccounts?: () => void;
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

function isRoomVisibleToUser(room: Room, userId: string): boolean {
  if (room.visibility !== "private") return true;
  if (!userId) return false;
  if (room.owner_user_id === userId) return true;
  return (room.members ?? []).some((member) => member.user_id === userId);
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
  gameStatus,
  onLaunchToServer,
  onPresenceContextChange,
  onRoomLaunchContextChange,
  onOpenAccounts,
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [profileNickname, setProfileNickname] = useState("");

  const [rooms, setRooms] = useState<Room[]>([]);
  const [friendsRooms, setFriendsRooms] = useState<Room[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRoomSession, setSelectedRoomSession] = useState<RoomSession | null>(null);
  const [managing, setManaging] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [showJoinPanel, setShowJoinPanel] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createRoomName, setCreateRoomName] = useState("");
  const [createRoomVisibility, setCreateRoomVisibility] = useState<"public" | "private">("public");
  const [createRoomPassword, setCreateRoomPassword] = useState("");
  const [isVisibilityDropdownOpen, setIsVisibilityDropdownOpen] = useState(false);
  const visibilityDropdownRef = useRef<HTMLDivElement | null>(null);
  const [inviteNickname, setInviteNickname] = useState("");
  const [avatarByKey, setAvatarByKey] = useState<Record<string, string>>({});
  const [viewingProfile, setViewingProfile] = useState<UserProfileSeed | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lanPortInput, setLanPortInput] = useState("25565");
  const [bridgeStatus, setBridgeStatus] = useState<string>("idle");
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const [localLanIp, setLocalLanIp] = useState<string | null>(null);
  const [activeLanPort, setActiveLanPort] = useState<number | null>(null);
  const [guestBridgePort, setGuestBridgePort] = useState<number | null>(null);

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
        if (selectedRoomId) {
          void getRoomSession(selectedRoomId)
            .then(setSelectedRoomSession)
            .catch(() => {});
        }
      }
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reloadRooms, selectedRoomId]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const isOwner = selectedRoom?.owner_user_id === userId;
  const selectedRoomSessionStartedAt =
    selectedRoomSession?.started_at ?? selectedRoom?.session_started_at ?? null;

  useEffect(() => {
    if (!selectedRoom) setManaging(false);
  }, [selectedRoom]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!accessToken || !selectedRoomId) {
      setSelectedRoomSession(null);
      return;
    }
    let cancelled = false;
    void getRoomSession(selectedRoomId)
      .then((session) => {
        if (!cancelled) {
          setSelectedRoomSession(session);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedRoomSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedRoomId]);

  useEffect(() => {
    if (!managing || !selectedRoomId) {
      setLocalLanIp(null);
      return;
    }
    let cancelled = false;
    void getLocalLanIp()
      .then((ip) => {
        if (!cancelled) setLocalLanIp(ip);
      })
      .catch(() => {
        if (!cancelled) setLocalLanIp(null);
      });
    return () => {
      cancelled = true;
    };
  }, [managing, selectedRoomId]);

  const roomConnectAddress = useMemo(() => {
    if (isOwner && hostReady && activeLanPort != null) {
      const hostIp = localLanIp ?? "127.0.0.1";
      return `${hostIp}:${activeLanPort}`;
    }
    if (!isOwner && guestBridgePort != null) {
      return `127.0.0.1:${guestBridgePort}`;
    }
    return null;
  }, [activeLanPort, guestBridgePort, hostReady, isOwner, localLanIp]);

  useEffect(() => {
    if (!onPresenceContextChange) return;
    if (!selectedRoom) {
      onPresenceContextChange(null);
      return;
    }
    const memberNicknames = (selectedRoom.members ?? [])
      .filter((member) => member.user_id !== userId)
      .map((member) => member.nickname)
      .filter(Boolean);
    onPresenceContextChange({
      roomId: selectedRoom.id,
      roomName: selectedRoom.name?.trim() || null,
      visibility: selectedRoom.visibility ?? null,
      joinCode: selectedRoom.join_code?.trim() || null,
      memberNicknames,
      sessionStartedAt: selectedRoomSessionStartedAt,
    });
    return () => {
      onPresenceContextChange(null);
    };
  }, [onPresenceContextChange, selectedRoom, selectedRoomSessionStartedAt, userId]);

  useEffect(() => {
    if (!onRoomLaunchContextChange) return;
    if (!selectedRoom || !hostReady || !isOwner) {
      onRoomLaunchContextChange(null);
      return;
    }
    onRoomLaunchContextChange({
      kind: "room_world",
      worldName: selectedRoom.name?.trim() || null,
      startedAt: selectedRoomSessionStartedAt ?? new Date().toISOString(),
    });
    return () => {
      onRoomLaunchContextChange(null);
    };
  }, [hostReady, isOwner, onRoomLaunchContextChange, selectedRoom, selectedRoomSessionStartedAt]);

  const tunnelDisposeByPeerRef = useRef<Map<string, () => void>>(new Map());
  const hostBridgeStartedByPeerRef = useRef<Set<string>>(new Set());
  const pendingLanPortRef = useRef<number | null>(null);
  const pendingGuestPeersRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<Record<string, import("../api/webrtc/session").RoomPeerSession>>({});

  const resetTunnelState = useCallback(() => {
    for (const dispose of tunnelDisposeByPeerRef.current.values()) {
      try {
        dispose();
      } catch {
      }
    }
    tunnelDisposeByPeerRef.current.clear();
    hostBridgeStartedByPeerRef.current.clear();
    pendingLanPortRef.current = null;
    pendingGuestPeersRef.current.clear();
    setHostReady(false);
    setActiveLanPort(null);
    setGuestBridgePort(null);
    setBridgeStatus("idle");
    void stopBridge();
  }, []);

  const ensureTunnelAttachedForPeer = useCallback(
    async (peerUserId: string) => {
      const session = sessionsRef.current[peerUserId];
      if (!session?.channelOpen) {
        throw new Error("P2P DataChannel is not open yet");
      }
      if (tunnelDisposeByPeerRef.current.has(peerUserId)) return;

      const dispose = await attachLanTunnel({
        sessionId: peerUserId,
        sendBinary: (data) => session.sendBinary(data),
        canSend: () => session.canSendBinary,
        onRemoteBinary: (handler) => session.onRemoteBinary(handler),
        onStatus: (s: LanBridgeStatus) => {
          setBridgeStatus(s.state);
          if (!isOwner && s.state === "listening" && s.detail) {
            const match = /:(\d+)$/.exec(s.detail);
            if (match) {
              setGuestBridgePort(Number.parseInt(match[1]!, 10));
            }
          }
          if (s.state === "connected" && isOwner) {
            session.signalTunnelReady();
          }
          if (s.state === "connected" && !isOwner) {
            session.signalTunnelOpen();
            void session
              .waitForTunnelReady(20_000)
              .then(() => allowGuestForward(peerUserId))
              .catch((err) => {
                console.warn("[Rooms] tunnel:ready wait failed, allowing forward anyway", err);
                return allowGuestForward(peerUserId);
              });
          }
        },
      });
      tunnelDisposeByPeerRef.current.set(peerUserId, dispose);
    },
    [isOwner],
  );

  const startHostBridgeForPeer = useCallback(
    async (peerUserId: string, port: number) => {
      if (hostBridgeStartedByPeerRef.current.has(peerUserId)) return;
      hostBridgeStartedByPeerRef.current.add(peerUserId);
      try {
        await ensureTunnelAttachedForPeer(peerUserId);
        await startHostBridge(peerUserId, port);
        setBridgeStatus("connecting");
      } catch (e) {
        hostBridgeStartedByPeerRef.current.delete(peerUserId);
        showNotification("error", e instanceof Error ? e.message : String(e));
      }
    },
    [ensureTunnelAttachedForPeer, showNotification],
  );

  const onTunnelOpen = useCallback(
    (fromPeerUserId: string) => {
      const port = pendingLanPortRef.current;
      if (port == null) {
        pendingGuestPeersRef.current.add(fromPeerUserId);
        return;
      }
      void startHostBridgeForPeer(fromPeerUserId, port);
    },
    [startHostBridgeForPeer],
  );

  const onPeerChannelOpen = useCallback(
    (peerUserId: string) => {
      if (!isOwner || !hostReady || pendingLanPortRef.current == null) return;
      void ensureTunnelAttachedForPeer(peerUserId).catch(() => {});
    },
    [ensureTunnelAttachedForPeer, hostReady, isOwner],
  );

  const {
    link: peerLink,
    sessions,
    expectedPeerIds,
    connectedPeerIds,
  } = useRoomPeerSession(selectedRoom, userId, {
    onTunnelOpen: isOwner ? onTunnelOpen : undefined,
    onSessionReset: resetTunnelState,
    onPeerChannelOpen: isOwner ? onPeerChannelOpen : undefined,
  });
  sessionsRef.current = sessions;

  useEffect(() => {
    return () => {
      for (const dispose of tunnelDisposeByPeerRef.current.values()) {
        try {
          dispose();
        } catch {
        }
      }
      tunnelDisposeByPeerRef.current.clear();
    };
  }, []);

  const handleHostShareWorld = async () => {
    const port = Number.parseInt(lanPortInput.trim(), 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      showNotification("warning", "Укажите порт Open to LAN (1–65535)");
      return;
    }
    if (connectedPeerIds.length === 0) {
      showNotification("warning", tt("rooms.needP2p"));
      return;
    }
    setTunnelBusy(true);
    try {
      pendingLanPortRef.current = port;
      setActiveLanPort(port);
      setHostReady(true);
    
      for (const peerId of connectedPeerIds) {
        await ensureTunnelAttachedForPeer(peerId);
      }
      const waitingGuests = [...pendingGuestPeersRef.current];
      pendingGuestPeersRef.current.clear();
      for (const peerId of waitingGuests) {
        await startHostBridgeForPeer(peerId, port);
      }
      showNotification(
        "success",
        "Мир готов к подключению. Гости могут нажать «Войти в мир».",
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
    const hostPeerId = selectedRoom?.owner_user_id;
    if (!hostPeerId) {
      showNotification("error", "Не найден хост комнаты");
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
      await ensureTunnelAttachedForPeer(hostPeerId);
      const localPort = await startGuestBridge(hostPeerId);
      setGuestBridgePort(localPort);
      if (!sessionsRef.current[hostPeerId]?.channelOpen) {
        throw new Error("P2P канал закрылся — дождитесь channel open и попробуйте снова");
      }
      console.info("[Rooms] guest bridge listening", { localPort, bridgeStatus, hostPeerId });
      const serverAddress = `127.0.0.1:${localPort}`;
      const presenceContext: LaunchPresenceContext = {
        kind: "room_world",
        serverAddress,
        worldName: selectedRoom?.name?.trim() || null,
        startedAt: selectedRoomSessionStartedAt ?? new Date().toISOString(),
      };

      if (gameStatus === "running") {
        const copied = await copyTextToClipboard(serverAddress);
        onRoomLaunchContextChange?.(presenceContext);
        showNotification(
          "success",
          copied
            ? tt("rooms.joinWorldInGameCopied", { address: serverAddress })
            : tt("rooms.joinWorldInGame", { address: serverAddress }),
        );
        return;
      }

      showNotification("info", tt("rooms.joinWorldLaunching", { address: serverAddress }));
      await onLaunchToServer(serverAddress, {
        requireOnlineAccount: true,
        presenceContext,
      });
      showNotification("success", tt("rooms.joinWorldLaunched", { address: serverAddress }));
    } catch (e) {
      showNotification("error", e instanceof Error ? e.message : String(e));
    } finally {
      setTunnelBusy(false);
    }
  };

  const resetCreateForm = () => {
    setCreateRoomName("");
    setCreateRoomVisibility("public");
    setCreateRoomPassword("");
    setIsVisibilityDropdownOpen(false);
  };

  useEffect(() => {
    if (!showCreateModal || !isVisibilityDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        visibilityDropdownRef.current &&
        target &&
        !visibilityDropdownRef.current.contains(target)
      ) {
        setIsVisibilityDropdownOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsVisibilityDropdownOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isVisibilityDropdownOpen, showCreateModal]);

  const handleCreate = async () => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    const password = createRoomPassword.trim();
    if (createRoomVisibility === "private") {
      if (password.length < 4 || password.length > 32) {
        showNotification("warning", tt("rooms.toast.passwordRequired"));
        return;
      }
    }
    setBusyAction("create");
    setLoading(true);
    try {
      const room = await createRoom({
        name: createRoomName.trim() || undefined,
        visibility: createRoomVisibility,
        password: createRoomVisibility === "private" ? password : undefined,
      });
      showNotification("success", tt("rooms.toast.created"));
      resetCreateForm();
      setShowCreateModal(false);
      await reloadRooms();
      setSelectedRoomId(room.id);
      setManaging(true);
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  };

  const handleJoin = async (roomId?: string) => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    const idOrName = (roomId ?? joinRoomId).trim();
    const password = roomId ? undefined : joinPassword.trim();
    if (!idOrName && !password) return;
    setBusyAction(roomId ? `join:${roomId}` : "join");
    setLoading(true);
    try {
      const room = await joinRoom(idOrName || password!, {
        password: idOrName ? password || undefined : undefined,
      });
      showNotification("success", tt("rooms.toast.joined"));
      setJoinRoomId("");
      setJoinPassword("");
      setShowJoinPanel(false);
      await reloadRooms();
      setSelectedRoomId(room.id);
      setManaging(true);
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
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

  const handleCopyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showNotification("success", successMessage, { sound: false });
    } catch {
      showNotification("error", value);
    }
  };

  const handleCopyId = async (id: string) => {
    await handleCopyText(id, tt("rooms.idCopied"));
  };

  const handleRefresh = () => {
    setBusyAction("refresh");
    setLoading(true);
    void reloadRooms()
      .catch((e) => {
        showNotification("error", e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
        setBusyAction(null);
      });
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

  const friendIds = useMemo(() => new Set(friends.map((f) => f.user_id)), [friends]);

  const openMemberProfile = (member: RoomMember) => {
    setViewingProfile({
      user_id: member.user_id,
      nickname: member.nickname,
      is_sponsor: member.is_sponsor,
      ely_username: member.ely_username,
      mc_uuid: member.mc_uuid,
    });
  };

  const handleAddFriendFromRoom = async (member: RoomMember) => {
    if (!accessToken || member.user_id === userId) return;
    setLoading(true);
    try {
      const result = await sendFriendRequest(member.nickname.trim());
      if (result.already_exists) {
        showNotification("info", tt("friends.toast.requestExists"));
      } else {
        showNotification("success", tt("friends.toast.requestSent"));
      }
      await reloadRooms();
    } catch (e) {
      showNotification("error", e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

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

  const visibleFriendsRooms = useMemo(
    () => friendsRooms.filter((room) => isRoomVisibleToUser(room, userId)),
    [friendsRooms, userId],
  );

  const p2pReady = peerLink.status === "connected" && peerLink.channelOpen;
  const expectedPeers = expectedPeerIds.length;
  const connectedPeers = connectedPeerIds.length;
  const linkKind =
    peerLink.connectionType === "relay"
      ? "relay"
      : peerLink.connectionType === "direct"
        ? "direct"
        : null;

  const p2pStatusLabel = (() => {
    if (selectedRoom && selectedRoom.member_count < 2) return tt("rooms.p2pWaiting");
    if (p2pReady) {
      const kind = linkKind ? ` · ${linkKind}` : "";
      if (expectedPeers > 1) {
        return `${tt("rooms.p2pReady")} (${connectedPeers}/${expectedPeers})${kind}`;
      }
      return `${tt("rooms.p2pReady")}${kind}`;
    }
    if (expectedPeers === 0) return tt("rooms.p2pWaiting");
    if (connectedPeers > 0 && expectedPeers > 1) {
      return `${tt("rooms.p2pConnecting")} (${connectedPeers}/${expectedPeers})`;
    }
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
    const roomTitle = room.name?.trim() || shortRoomId(room.id);
    return (
      <button
        key={room.id}
        type="button"
        onClick={() => openRoom(room)}
        className="group flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-left transition hover:border-emerald-400/35 hover:bg-black/50"
      >
        <MemberAvatars members={members} avatarSrcFor={avatarSrcFor} max={3} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white/90">{roomTitle}</p>
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone(room.status)}`}
            >
              {statusLabel(room.status)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {tt("rooms.players", { count: room.member_count, max: room.max_players })}
            {" · "}
            {formatRoomVisibility(room.visibility, tt)}
            {" · "}
            {owned ? tt("rooms.youOwner") : tt("rooms.youMember")}
          </p>
        </div>
        <span className="shrink-0 text-xs text-white/35 group-hover:text-emerald-200/80">→</span>
      </button>
    );
  };

  const renderFriendRoomCard = (room: Room) => {
    const members = room.members ?? [];
    const owner = members.find((m) => m.user_id === room.owner_user_id);
    const ownerNick = owner?.nickname ?? shortRoomId(room.owner_user_id);
    const canJoin = room.status === "open";
    const roomTitle = room.name?.trim() || ownerNick;
    const sessionPlaytimeSeconds = getElapsedSeconds(room.session_started_at, nowMs);

    return (
      <div
        key={room.id}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5"
      >
        <img
          src={avatarSrcFor({
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white/90">{roomTitle}</p>
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone(room.status)}`}
            >
              {statusLabel(room.status)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {tt("rooms.ownedBy", { nick: ownerNick })}
            {" · "}
            {tt("rooms.players", { count: room.member_count, max: room.max_players })}
            {sessionPlaytimeSeconds != null
              ? ` · ${formatDurationShort(sessionPlaytimeSeconds, tt)}`
              : ""}
          </p>
        </div>
        <ActionButton
          size="sm"
          variant="sky"
          loading={busyAction === `join:${room.id}`}
          loadingLabel={tt("rooms.joining")}
          disabled={!canJoin || (loading && busyAction !== `join:${room.id}`)}
          onClick={() => void handleJoin(room.id)}
        >
          {tt("rooms.joinFriendRoom")}
        </ActionButton>
      </div>
    );
  };

  if (managing && selectedRoom) {
    const members = selectedRoom.members ?? [];
    const roomTitle = selectedRoom.name?.trim() || shortRoomId(selectedRoom.id);
    const sessionPlaytimeSeconds = getElapsedSeconds(selectedRoomSessionStartedAt, nowMs);
    return (
      <>
        <div className="flex w-full max-w-4xl flex-col gap-5 py-6">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              size="sm"
              variant="secondary"
              onClick={() => {
                setViewingProfile(null);
                setManaging(false);
              }}
            >
              ← {tt("rooms.backToList")}
            </ActionButton>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="ui-title truncate text-base">{roomTitle}</h2>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone(selectedRoom.status)}`}
                >
                  {statusLabel(selectedRoom.status)}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                    isOwner
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-white/10 text-white/65"
                  }`}
                >
                  {isOwner ? tt("rooms.youOwner") : tt("rooms.youMember")}
                </span>
              </div>
              <p className="ui-meta mt-0.5 truncate">
                {tt("rooms.players", {
                  count: selectedRoom.member_count,
                  max: selectedRoom.max_players,
                })}
                {" · "}
                {formatRoomVisibility(selectedRoom.visibility, tt)}
                {" · "}
                {shortRoomId(selectedRoom.id)}
                {roomConnectAddress ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyText(
                          roomConnectAddress,
                          tt("rooms.connectAddressCopied"),
                        )
                      }
                      className="font-semibold text-emerald-300/85 transition hover:text-emerald-200"
                      title={tt("rooms.connectAddressHint")}
                    >
                      {roomConnectAddress}
                    </button>
                  </>
                ) : null}
                {sessionPlaytimeSeconds != null
                  ? ` · ${tt("rooms.sessionPlaytimeLabel")}: ${formatDurationShort(sessionPlaytimeSeconds, tt)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roomConnectAddress ? (
                <ActionButton
                  size="sm"
                  variant="emerald"
                  onClick={() =>
                    void handleCopyText(roomConnectAddress, tt("rooms.connectAddressCopied"))
                  }
                  title={tt("rooms.connectAddressHint")}
                >
                  {roomConnectAddress}
                </ActionButton>
              ) : null}
              <ActionButton
                size="sm"
                variant="secondary"
                onClick={() => void handleCopyId(selectedRoom.id)}
              >
                {tt("rooms.copyId")}
              </ActionButton>
              {isOwner && selectedRoom.visibility === "private" && selectedRoom.join_code?.trim() ? (
                <ActionButton
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void handleCopyText(
                      selectedRoom.join_code!.trim(),
                      tt("rooms.passwordCopied"),
                    )
                  }
                >
                  {tt("rooms.passwordLabel")}: {selectedRoom.join_code.trim()}
                </ActionButton>
              ) : null}
              {isOwner ? (
                <ActionButton
                  size="sm"
                  variant="danger"
                  disabled={loading}
                  onClick={() => void handleClose()}
                >
                  {tt("rooms.close")}
                </ActionButton>
              ) : (
                <ActionButton
                  size="sm"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => void handleLeave()}
                >
                  {tt("rooms.leave")}
                </ActionButton>
              )}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="flex flex-col gap-5">
              <Panel padding="sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-black/30 px-2.5 py-2">
                    <span className="ui-caption">{tt("rooms.mcAccount")}</span>
                    <span
                      className={`text-xs font-semibold ${
                        mcAuthOnline ? "text-emerald-300/90" : "text-amber-300/90"
                      }`}
                    >
                      {mcAuthLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-black/30 px-2.5 py-2">
                    <span className="ui-caption">{tt("rooms.p2pLabel")}</span>
                    <span
                      className={`truncate text-xs font-semibold ${
                        p2pReady ? "text-emerald-300/90" : "text-white/70"
                      }`}
                    >
                      {p2pStatusLabel}
                    </span>
                  </div>
                </div>
                {!mcAuthOnline ? (
                  <p className="ui-meta mt-2 text-amber-200/70">{tt("rooms.mcOfflineHint")}</p>
                ) : null}
              </Panel>

              <Panel padding="sm">
                <p className="ui-section">{tt("rooms.worldTitle")}</p>

                {selectedRoom.member_count < 2 ? (
                  <p className="mt-2 text-sm text-white/55">{tt("rooms.waitForPeer")}</p>
                ) : isOwner ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-[11px] font-semibold text-white/45">{tt("rooms.lanPort")}</span>
                        <input
                          type="text"
                          value={lanPortInput}
                          onChange={(e) => setLanPortInput(e.target.value)}
                          className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/30"
                          placeholder="25565"
                          disabled={tunnelBusy}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={tunnelBusy || !p2pReady}
                        onClick={() => void handleHostShareWorld()}
                        className="interactive-press rounded-lg border border-emerald-500/40 bg-emerald-600/25 px-3 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60"
                      >
                        {hostReady ? tt("rooms.shareWorldWaiting") : tt("rooms.shareWorld")}
                      </button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-white/45">{tt("rooms.hostSteps")}</p>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={tunnelBusy || !mcAuthOnline || !p2pReady}
                      onClick={() => void handleGuestJoinWorld()}
                      className="interactive-press w-full rounded-lg border border-emerald-500/40 bg-emerald-600/25 px-3 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-600/35 disabled:opacity-60 sm:w-fit"
                      title={
                        !mcAuthOnline
                          ? "Войдите через Microsoft или Ely на вкладке Аккаунты"
                          : undefined
                      }
                    >
                      {tt("rooms.joinWorld")}
                    </button>
                    <p className="ui-meta leading-relaxed">{tt("rooms.guestSteps")}</p>
                  </div>
                )}
              </Panel>
            </div>

            <div className="flex flex-col gap-5">
              <Panel padding="sm">
                <p className="ui-section">
                  {tt("rooms.membersTitle")} · {members.length}
                </p>
                <ul className="mt-2 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
                  {members.map((m) => (
                    <li
                      key={m.user_id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => openMemberProfile(m)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition hover:opacity-95"
                        title={tt("friends.viewProfile")}
                      >
                        <img
                          src={avatarSrcFor(m)}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
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
                            className="truncate text-sm"
                          />
                          <p className="ui-caption">
                            {m.role === "owner" ? tt("rooms.role.owner") : tt("rooms.role.member")}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {m.user_id !== userId && !friendIds.has(m.user_id) ? (
                          <ActionButton
                            size="sm"
                            variant="emerald"
                            disabled={loading}
                            onClick={() => void handleAddFriendFromRoom(m)}
                          >
                            {tt("friends.add")}
                          </ActionButton>
                        ) : null}
                        {isOwner && m.role !== "owner" ? (
                          <ActionButton
                            size="sm"
                            variant="secondary"
                            disabled={loading}
                            onClick={() => void handleKick(m.user_id)}
                          >
                            {tt("rooms.kick")}
                          </ActionButton>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>

              {isOwner ? (
                <Panel padding="sm">
                  <p className="ui-section">{tt("rooms.inviteTitle")}</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {inviteableFriends.length > 0 ? (
                      <ul className="flex max-h-36 flex-col gap-1.5 overflow-y-auto">
                        {inviteableFriends.map((f) => (
                          <li
                            key={f.user_id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <img
                                src={avatarSrcFor(f)}
                                alt=""
                                className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
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
                                className="truncate text-sm"
                              />
                            </div>
                            <ActionButton
                              size="sm"
                              variant="emerald"
                              disabled={loading}
                              onClick={() => void handleInviteFriend(f.nickname)}
                            >
                              {tt("rooms.invite")}
                            </ActionButton>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ui-meta leading-relaxed">{tt("rooms.inviteEmpty")}</p>
                    )}
                    <div className="flex gap-1.5">
                      <TextField
                        type="text"
                        value={inviteNickname}
                        onChange={(e) => setInviteNickname(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && inviteNickname.trim()) {
                            void handleInviteFriend(inviteNickname);
                          }
                        }}
                        className="min-w-0 flex-1"
                        placeholder={tt("rooms.inviteNicknamePlaceholder")}
                        disabled={loading}
                      />
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        disabled={loading || !inviteNickname.trim()}
                        onClick={() => void handleInviteFriend(inviteNickname)}
                      >
                        {tt("rooms.invite")}
                      </ActionButton>
                    </div>
                  </div>
                </Panel>
              ) : null}
            </div>
          </div>
        </div>
        {viewingProfile ? (
          <UserProfileModal
            language={language}
            seed={viewingProfile}
            currentUserId={userId}
            isFriend={friendIds.has(viewingProfile.user_id)}
            onClose={() => setViewingProfile(null)}
            onNotify={showNotification}
            onFriendRequestSent={() => {
              void reloadRooms().catch(() => {});
            }}
          />
        ) : null}
      </>
    );
  }

  if (!accessToken) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-5 py-6">
        <div className="w-full text-center">
          <h1 className="ui-title">{tt("app.sidebar.rooms")}</h1>
          <p className="ui-subtitle mt-1.5">{tt("rooms.subtitleSignedOut")}</p>
        </div>
        <AuthGate
          title={tt("rooms.authGateTitle")}
          description={tt("rooms.authGateBody")}
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
          <h1 className="ui-title">{tt("app.sidebar.rooms")}</h1>
          <p className="ui-subtitle mt-1.5">{tt("rooms.subtitleSignedIn")}</p>
        </div>

        <Panel className="flex flex-wrap items-center justify-center gap-2">
          <ActionButton
            size="sm"
            variant="emerald"
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
          >
            {tt("rooms.create")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant={showJoinPanel ? "sky" : "secondary"}
            onClick={() => setShowJoinPanel((v) => !v)}
          >
            {tt("rooms.joinById")}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="secondary"
            loading={busyAction === "refresh"}
            loadingLabel={tt("common.loading")}
            disabled={loading && busyAction !== "refresh"}
            onClick={handleRefresh}
          >
            {tt("rooms.refresh")}
          </ActionButton>
        </Panel>

        {showJoinPanel ? (
          <Panel padding="sm" className="flex flex-col gap-2 border-sky-400/20 bg-sky-500/5">
            <p className="ui-meta leading-relaxed">{tt("rooms.joinHint")}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <TextField
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (joinRoomId.trim() || joinPassword.trim())) {
                    void handleJoin();
                  }
                }}
                className="flex-1 focus:border-sky-400/40"
                placeholder={tt("rooms.joinIdPlaceholder")}
              />
              <TextField
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (joinRoomId.trim() || joinPassword.trim())) {
                    void handleJoin();
                  }
                }}
                className="sm:w-44 focus:border-sky-400/40"
                placeholder={tt("rooms.joinPasswordPlaceholder")}
                autoComplete="off"
              />
              <ActionButton
                size="sm"
                variant="sky"
                loading={busyAction === "join"}
                loadingLabel={tt("rooms.joining")}
                disabled={
                  (loading && busyAction !== "join") ||
                  (!joinRoomId.trim() && !joinPassword.trim())
                }
                onClick={() => void handleJoin()}
              >
                {tt("rooms.join")}
              </ActionButton>
            </div>
          </Panel>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Panel className="flex flex-col gap-3">
            <p className="ui-section">
              {tt("rooms.yourRooms")}
              {` · ${rooms.length}`}
            </p>

            {loading && rooms.length === 0 ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <RoomCardSkeleton />
                <RoomCardSkeleton />
              </div>
            ) : rooms.length === 0 ? (
              <EmptyState
                compact
                title={tt("rooms.emptyTitle")}
                description={tt("rooms.emptyBody")}
                action={
                  <ActionButton
                    size="sm"
                    variant="emerald"
                    onClick={() => {
                      resetCreateForm();
                      setShowCreateModal(true);
                    }}
                  >
                    {tt("rooms.emptyCreateCta")}
                  </ActionButton>
                }
              />
            ) : (
              <div className="flex flex-col gap-2">{rooms.map(renderMyRoomCard)}</div>
            )}
          </Panel>

          <Panel className="flex flex-col gap-3">
            <p className="ui-section">
              {tt("rooms.friendsRooms")}
              {` · ${visibleFriendsRooms.length}`}
            </p>

            {loading && visibleFriendsRooms.length === 0 ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <RoomCardSkeleton />
                <RoomCardSkeleton />
              </div>
            ) : visibleFriendsRooms.length === 0 ? (
              <EmptyState compact title={tt("rooms.noFriendsRooms")} />
            ) : (
              <div className="flex flex-col gap-2">
                {visibleFriendsRooms.map(renderFriendRoomCard)}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={showCreateModal}
        title={tt("rooms.createModalTitle")}
        subtitle={tt("rooms.createModalSubtitle")}
        onClose={() => {
          if (!loading) setShowCreateModal(false);
        }}
        closeDisabled={loading}
        closeLabel={tt("common.close")}
        footer={
          <>
            <ActionButton
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => setShowCreateModal(false)}
            >
              {tt("common.cancel")}
            </ActionButton>
            <ActionButton
              size="sm"
              variant="emerald"
              loading={busyAction === "create"}
              loadingLabel={tt("rooms.creating")}
              disabled={loading && busyAction !== "create"}
              onClick={() => void handleCreate()}
            >
              {tt("rooms.createModalSubmit")}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="ui-caption font-semibold">{tt("rooms.roomNameLabel")}</span>
              <TextField
                type="text"
                value={createRoomName}
              onChange={(e) => setCreateRoomName(e.target.value)}
              placeholder={tt("rooms.roomNamePlaceholder")}
              disabled={loading}
              autoFocus
            />
          </label>

          <div ref={visibilityDropdownRef} className="relative flex flex-col gap-1">
            <span className="ui-caption font-semibold">{tt("rooms.visibilityLabel")}</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => setIsVisibilityDropdownOpen((prev) => !prev)}
              className="interactive-press flex w-full items-center justify-between rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-left text-sm text-white outline-none transition-colors hover:border-white/25 hover:bg-black/50 focus:border-white/25 disabled:opacity-60"
            >
              <span>
                {createRoomVisibility === "private"
                  ? tt("rooms.visibility.private")
                  : tt("rooms.visibility.public")}
              </span>
              <span className="text-[10px] text-white/50">▾</span>
            </button>
            {isVisibilityDropdownOpen ? (
              <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/15 bg-black/90 p-1 shadow-soft backdrop-blur-lg">
                {(
                  [
                    { value: "public" as const, label: tt("rooms.visibility.public") },
                    { value: "private" as const, label: tt("rooms.visibility.private") },
                  ] as const
                ).map((option) => {
                  const active = createRoomVisibility === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setCreateRoomVisibility(option.value);
                        setIsVisibilityDropdownOpen(false);
                        if (option.value === "public") setCreateRoomPassword("");
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        active ? "bg-white/90 text-black" : "text-white/80 hover:bg-white/10"
                      }`}
                    >
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <p className="ui-meta leading-relaxed">
            {createRoomVisibility === "private"
              ? tt("rooms.privateHint")
              : tt("rooms.publicHint")}
          </p>

          {createRoomVisibility === "private" ? (
            <label className="flex flex-col gap-1">
              <span className="ui-caption font-semibold">{tt("rooms.passwordLabel")}</span>
              <TextField
                type="text"
                value={createRoomPassword}
                onChange={(e) => setCreateRoomPassword(e.target.value)}
                placeholder={tt("rooms.passwordPlaceholder")}
                disabled={loading}
                autoComplete="off"
              />
            </label>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
