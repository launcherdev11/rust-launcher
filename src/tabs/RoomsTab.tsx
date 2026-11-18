import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeRoom,
  createRoom,
  getRoom,
  getRoomSession,
  inviteToRoom,
  joinRoom,
  leaveRoom,
  leaveRoomBestEffort,
  listFriendsRooms,
  listRooms,
  updateRoom,
  type CreateRoomInput,
  type Room,
  type RoomMember,
  type RoomSession,
  type UpdateRoomInput,
} from "../api/rooms";
import { listFriends, sendFriendRequest, type FriendRow } from "../api/friends";
import { API_AUTH_CHANGED_EVENT, API_NICKNAME_KEY } from "../api/auth";
import { ApiError, getStoredAccessToken } from "../api/client";
import { UserProfileModal, type UserProfileSeed } from "../components/UserProfileModal";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { useRoomPeerSession } from "../hooks/useRoomPeerSession";
import { RoomSyncPanel } from "../features/room-sync/RoomSyncPanel";
import { RoomModpackGate } from "../features/room-sync/RoomModpackGate";
import {
  createProfileForRoom,
  getHostRoomProfile,
  setHostRoomProfile,
} from "../features/room-sync/roomModpacks";
import type { InstanceProfileCard } from "../app/types";
import { useRoomSyncHost } from "../features/room-sync/useRoomSyncHost";
import { useT, type Language } from "../i18n";
import { buildInitialAvatarDataUrl, getUserListAvatarSrc, userListAvatarCacheKey } from "../lib/avatar";
import type { LaunchPresenceContext, RoomPresenceContext } from "../lib/socialActivity";
import { copyTextToClipboard } from "../lib/clipboard";
import type { GameStatus } from "../lib/gameConsoleWindow";
import { AuthGate } from "../components/ui";
import { CreateRoomModal } from "./rooms/CreateRoomModal";
import { RoomDetail } from "./rooms/RoomDetail";
import { RoomsLobby } from "./rooms/RoomsLobby";
import {
  decodeJwtSub,
  isRoomLoaderId,
  isRoomVisibleToUser,
  type RoomCurrentGame,
  type RoomGameSettings,
} from "./rooms/roomHelpers";
import type { AvatarTarget } from "./rooms/roomParts";
import { useRoomWorld } from "./rooms/useRoomWorld";

export type { RoomCurrentGame, RoomGameSettings } from "./rooms/roomHelpers";

type NotificationKind = "info" | "success" | "error" | "warning";
type ShowNotificationOptions = { sound?: boolean };

type RoomsTabProps = {
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  language: Language;
  minecraftAccountKind: "microsoft" | "ely" | "offline" | string;
  gameStatus: GameStatus;
  isLaunching?: boolean;
  tabActive?: boolean;
  onLaunchGame?: () => void;
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
  onApplyRoomGameSettings?: (settings: RoomGameSettings) => void;
  currentGame?: RoomCurrentGame | null;
  profiles?: InstanceProfileCard[];
  onSelectProfile?: (profileId: string) => Promise<void>;
  onProfilesChanged?: () => Promise<void>;
};

const NO_PROFILES: InstanceProfileCard[] = [];

function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : String(e);
}

export function RoomsTab({
  showNotification,
  language,
  minecraftAccountKind,
  gameStatus,
  isLaunching = false,
  tabActive = true,
  onLaunchGame,
  onLaunchToServer,
  onPresenceContextChange,
  onRoomLaunchContextChange,
  onOpenAccounts,
  onApplyRoomGameSettings,
  currentGame = null,
  profiles = NO_PROFILES,
  onSelectProfile,
  onProfilesChanged,
}: RoomsTabProps) {
  const tt = useT(language);

  const mcAuthOnline = minecraftAccountKind === "microsoft" || minecraftAccountKind === "ely";

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const appliedRoomGameKeyRef = useRef<string | null>(null);
  const [avatarByKey, setAvatarByKey] = useState<Record<string, string>>({});
  const [viewingProfile, setViewingProfile] = useState<UserProfileSeed | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [joinBusy, setJoinBusy] = useState(false);

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

  const mergeRoomIntoLists = useCallback((room: Room) => {
    const patch = (prev: Room[]) =>
      prev.map((item) => (item.id === room.id ? { ...item, ...room } : item));
    setRooms(patch);
    setFriendsRooms(patch);
  }, []);

  const refreshRoomDetail = useCallback(
    async (roomId: string): Promise<Room | null> => {
      try {
        const room = await getRoom(roomId);
        mergeRoomIntoLists(room);
        return room;
      } catch {
        return null;
      }
    },
    [mergeRoomIntoLists],
  );

  const reloadRooms = useCallback(async () => {
    const [mine, friendsOwned, friendList] = await Promise.all([
      listRooms(),
      listFriendsRooms().catch(() => [] as Room[]),
      listFriends().catch(() => [] as FriendRow[]),
    ]);
    setRooms(mine);
    setFriendsRooms(friendsOwned);
    setFriends(friendList);
    setLoadError(null);
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
          const msg = errorText(e);
          setLoadError(msg);
          showNotification("error", msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadRooms, showNotification]);

  const retryLoadRooms = useCallback(() => {
    setLoading(true);
    void reloadRooms()
      .catch((e) => {
        const msg = errorText(e);
        setLoadError(msg);
        showNotification("error", msg);
      })
      .finally(() => setLoading(false));
  }, [reloadRooms, showNotification]);

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
          void refreshRoomDetail(selectedRoomId);
          void getRoomSession(selectedRoomId)
            .then(setSelectedRoomSession)
            .catch(() => {});
        }
      }
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [reloadRooms, refreshRoomDetail, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoomId) return;
    let cancelled = false;
    void refreshRoomDetail(selectedRoomId);
    const timer = window.setInterval(() => {
      if (!cancelled) void refreshRoomDetail(selectedRoomId);
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshRoomDetail, selectedRoomId]);

  const selectedRoom =
    rooms.find((r) => r.id === selectedRoomId) ??
    friendsRooms.find((r) => r.id === selectedRoomId) ??
    null;
  const isOwner = selectedRoom?.owner_user_id === userId;
  const selectedRoomSessionStartedAt =
    selectedRoomSession?.started_at ?? selectedRoom?.session_started_at ?? null;

  useEffect(() => {
    if (!selectedRoom) return;
    const members = selectedRoom.members ?? [];
    if (selectedRoom.member_count >= 2 && members.length < 2) {
      void refreshRoomDetail(selectedRoom.id);
    }
  }, [refreshRoomDetail, selectedRoom]);

  useEffect(() => {
    if (!selectedRoom) setManaging(false);
  }, [selectedRoom]);

  useEffect(() => {
    if (!selectedRoomId || !userId || isOwner) return;
    const roomId = selectedRoomId;
    const onPageHide = () => leaveRoomBestEffort(roomId);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [selectedRoomId, userId, isOwner]);

  useEffect(() => {
    if (!tabActive) return;

    const sync = () => setNowMs(Date.now());
    sync();

    let id: number | null = null;
    const start = () => {
      if (id != null) return;
      id = window.setInterval(sync, 1000);
    };
    const stop = () => {
      if (id == null) return;
      window.clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
        start();
      } else {
        stop();
      }
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tabActive]);

  useEffect(() => {
    if (!accessToken || !selectedRoomId) {
      setSelectedRoomSession(null);
      return;
    }
    let cancelled = false;
    void getRoomSession(selectedRoomId)
      .then((session) => {
        if (!cancelled) setSelectedRoomSession(session);
      })
      .catch(() => {
        if (!cancelled) setSelectedRoomSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedRoomId]);

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

  const {
    link: peerLink,
    sessions,
    peerLinks,
    expectedPeerIds,
    connectedPeerIds,
    offlinePeerIds,
    reconnectAll,
  } = useRoomPeerSession(selectedRoom, userId);

  const onPeerOutdated = useCallback(() => {
    showNotification("warning", tt("rooms.peerLauncherOutdated"));
  }, [showNotification, tt]);

  const {
    gameLanPort,
    manualLanPort,
    applyManualLanPort,
    world,
    hostStateStatus,
    memberPings,
    ownPing,
    guestBridgePort,
    ensureGuestBridge,
  } = useRoomWorld({
    room: selectedRoom,
    userId,
    sessions,
    peerLinks,
    expectedPeerIds,
    gameRunning: gameStatus === "running",
    onPeerOutdated,
  });

  const handleManualLanPort = async (port: number | null) => {
    const reachable = await applyManualLanPort(port);
    if (port == null) {
      showNotification("info", tt("rooms.world.manualPortCleared"));
    } else if (reachable) {
      showNotification("success", tt("rooms.world.manualPortApplied", { port }));
    } else {
      showNotification("warning", tt("rooms.world.manualPortNoAnswer", { port }));
    }
  };

  const hostSharing = isOwner && gameLanPort != null;
  const syncProfileId = currentGame?.source === "profile" ? currentGame.profileId ?? null : null;
  // Хозяин раздаёт сборку, выбранную при создании комнаты, даже если сейчас выбрана другая.
  const pinnedHostProfileId = isOwner && selectedRoom ? getHostRoomProfile(selectedRoom.id) : null;
  const hostProfileId =
    pinnedHostProfileId && profiles.some((p) => p.id === pinnedHostProfileId)
      ? pinnedHostProfileId
      : syncProfileId;
  useRoomSyncHost({
    isOwner,
    sessions,
    profileId: hostProfileId,
    forceShare: Boolean(selectedRoom?.modpack_name),
  });

  useEffect(() => {
    if (!onRoomLaunchContextChange) return;
    if (!selectedRoom || !hostSharing) {
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
  }, [hostSharing, onRoomLaunchContextChange, selectedRoom, selectedRoomSessionStartedAt]);

  const handleGuestJoinWorld = async () => {
    if (peerLink.status !== "connected" || !peerLink.channelOpen) {
      showNotification("warning", tt("rooms.needP2p"));
      return;
    }
    const hostPeerId = selectedRoom?.owner_user_id;
    if (!hostPeerId) {
      showNotification("error", tt("rooms.hostNotFound"));
      return;
    }
    if (!mcAuthOnline) {
      showNotification("error", tt("rooms.joinOfflineBlocked"));
      return;
    }
    setJoinBusy(true);
    try {
      const hostSession = sessions[hostPeerId];
      if (!hostSession?.channelOpen) {
        throw new Error(tt("rooms.p2pChannelClosed"));
      }
      if (!hostSession.supportsLanTunnel) {
        throw new Error(tt("rooms.peerLauncherOutdated"));
      }
      const localPort = await ensureGuestBridge();
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
      showNotification("error", errorText(e));
    } finally {
      setJoinBusy(false);
    }
  };

  const applyRoomGameIfNeeded = useCallback(
    (room: Room) => {
      const version = room.game_version?.trim();
      const loaderRaw = room.loader?.trim() ?? "vanilla";
      if (!version || !isRoomLoaderId(loaderRaw)) return;
      const key = `${room.id}:${loaderRaw}:${version}`;
      if (appliedRoomGameKeyRef.current === key) return;
      appliedRoomGameKeyRef.current = key;
      onApplyRoomGameSettings?.({ loader: loaderRaw, gameVersion: version });
      showNotification(
        "info",
        tt("rooms.toast.versionApplied", { version: `${loaderRaw} ${version}` }),
      );
    },
    [onApplyRoomGameSettings, showNotification, tt],
  );

  useEffect(() => {
    if (managing && selectedRoom) applyRoomGameIfNeeded(selectedRoom);
  }, [
    applyRoomGameIfNeeded,
    managing,
    selectedRoom?.id,
    selectedRoom?.game_version,
    selectedRoom?.loader,
  ]);

  const handleCreate = async (input: CreateRoomInput, modpackProfileId?: string) => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    setBusyAction("create");
    setLoading(true);
    try {
      const room = await createRoom(input);
      if (modpackProfileId) setHostRoomProfile(room.id, modpackProfileId);
      showNotification("success", tt("rooms.toast.created"));
      setShowCreateModal(false);
      await reloadRooms();
      setSelectedRoomId(room.id);
      setManaging(true);
      applyRoomGameIfNeeded(room);
    } catch (e) {
      showNotification("error", errorText(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  };

  const enterJoinedRoom = async (room: Room) => {
    showNotification("success", tt("rooms.toast.joined"));
    await reloadRooms();
    setSelectedRoomId(room.id);
    setManaging(true);
    applyRoomGameIfNeeded(room);
  };

  const handleJoinListed = async (roomId: string) => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    setBusyAction(`join:${roomId}`);
    setLoading(true);
    try {
      await enterJoinedRoom(await joinRoom(roomId));
    } catch (e) {
      showNotification("error", errorText(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  };

  const handleJoinByName = async (nameOrId: string, password: string, onDone: () => void) => {
    if (!accessToken) {
      showNotification("warning", tt("rooms.toast.signInFirst"));
      return;
    }
    const idOrName = nameOrId.trim();
    const secret = password.trim();
    if (!idOrName && !secret) return;
    setBusyAction("join");
    setLoading(true);
    try {
      const room = await joinRoom(idOrName || secret, {
        password: idOrName ? secret || undefined : undefined,
      });
      onDone();
      await enterJoinedRoom(room);
    } catch (e) {
      showNotification("error", errorText(e));
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
      showNotification("error", errorText(e));
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
      showNotification("error", errorText(e));
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
      showNotification("error", errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = async (value: string, successMessage: string) => {
    const copied = await copyTextToClipboard(value);
    if (copied) showNotification("success", successMessage, { sound: false });
    else showNotification("error", value);
  };

  const handleRefresh = () => {
    setBusyAction("refresh");
    setLoading(true);
    void reloadRooms()
      .catch((e) => {
        showNotification("error", errorText(e));
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
    applyRoomGameIfNeeded(room);
  };

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
      showNotification("error", errorText(e));
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

  const handleInvite = async (nickname: string, onDone: () => void) => {
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
      onDone();
      await reloadRooms();
    } catch (e) {
      showNotification("error", errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (input: UpdateRoomInput) => {
    if (!selectedRoom || !isOwner) return;
    setBusyAction("update-room");
    setLoading(true);
    try {
      const room = await updateRoom(selectedRoom.id, input);
      mergeRoomIntoLists(room);
      applyRoomGameIfNeeded(room);
      showNotification("success", tt("rooms.toast.settingsSaved"));
    } catch (e) {
      showNotification("error", errorText(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  };

  if (managing && selectedRoom) {
    return (
      <>
        <RoomDetail
          room={selectedRoom}
          tt={tt}
          language={language}
          userId={userId}
          isOwner={isOwner}
          nowMs={nowMs}
          sessionStartedAt={selectedRoomSessionStartedAt}
          loading={loading}
          busyAction={busyAction}
          joinBusy={joinBusy}
          isLaunching={isLaunching}
          gameStatus={gameStatus}
          currentGame={currentGame}
          mcAccountKind={minecraftAccountKind}
          friends={friends}
          friendIds={friendIds}
          avatarSrcFor={avatarSrcFor}
          statusLabel={statusLabel}
          world={world}
          hostStateStatus={hostStateStatus}
          ownPing={ownPing}
          memberPings={memberPings}
          guestBridgePort={guestBridgePort}
          peerLink={peerLink}
          peerLinks={peerLinks}
          expectedPeers={expectedPeerIds.length}
          connectedPeers={connectedPeerIds.length}
          offlinePeerIds={offlinePeerIds}
          syncPanel={
            <RoomSyncPanel
              isOwner={isOwner}
              tt={tt}
              session={isOwner ? null : sessions[selectedRoom.owner_user_id] ?? null}
              profileId={syncProfileId}
            />
          }
          onBack={() => {
            setViewingProfile(null);
            setManaging(false);
          }}
          onClose={() => void handleClose()}
          onLeave={() => void handleLeave()}
          onKick={(memberId) => void handleKick(memberId)}
          onInvite={(nickname, onDone) => void handleInvite(nickname, onDone)}
          onAddFriend={(member) => void handleAddFriendFromRoom(member)}
          onOpenProfile={openMemberProfile}
          onCopy={(value, message) => void handleCopyText(value, message)}
          onReconnect={() => {
            reconnectAll();
            void refreshRoomDetail(selectedRoom.id);
            showNotification("info", tt("rooms.p2pReconnectToast"));
          }}
          onLaunchGame={onLaunchGame}
          onJoinWorld={() => void handleGuestJoinWorld()}
          manualLanPort={manualLanPort}
          onSetManualLanPort={(port) => void handleManualLanPort(port)}
          onSaveSettings={(input) => void handleSaveSettings(input)}
          onWarning={(message) => showNotification("warning", message)}
        />
        {!isOwner && selectedRoom.modpack_name ? (
          <RoomModpackGate
            key={selectedRoom.id}
            room={selectedRoom}
            tt={tt}
            session={sessions[selectedRoom.owner_user_id] ?? null}
            profiles={profiles}
            onSelectProfile={async (profileId) => {
              await onSelectProfile?.(profileId);
            }}
            onCreateProfile={async (manifest) => {
              const id = await createProfileForRoom(selectedRoom.modpack_name ?? manifest.gameVersion, manifest);
              await onProfilesChanged?.();
              return id;
            }}
            onLeave={() => void handleLeave()}
          />
        ) : null}
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
      <div className="flex w-full max-w-6xl flex-col gap-4 py-4">
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
      <RoomsLobby
        tt={tt}
        language={language}
        userId={userId}
        nowMs={nowMs}
        rooms={rooms}
        friendsRooms={visibleFriendsRooms}
        activeRoom={selectedRoom}
        loading={loading}
        busyAction={busyAction}
        loadError={loadError}
        avatarSrcFor={avatarSrcFor}
        statusLabel={statusLabel}
        onCreate={() => setShowCreateModal(true)}
        onRefresh={handleRefresh}
        onRetry={retryLoadRooms}
        onOpenRoom={openRoom}
        onJoinRoom={(roomId) => void handleJoinListed(roomId)}
        onJoinByName={(nameOrId, password, onDone) => void handleJoinByName(nameOrId, password, onDone)}
      />
      <CreateRoomModal
        open={showCreateModal}
        busy={busyAction === "create"}
        tt={tt}
        currentGame={currentGame}
        profiles={profiles}
        onClose={() => {
          if (busyAction !== "create") setShowCreateModal(false);
        }}
        onSubmit={(input, modpackProfileId) => void handleCreate(input, modpackProfileId)}
        onWarning={(message) => showNotification("warning", message)}
        onError={(message) => showNotification("error", message)}
      />
    </>
  );
}
