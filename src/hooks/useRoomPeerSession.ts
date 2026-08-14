import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "../api/rooms";
import {
  startPeerSignaling,
  type PeerLinkState,
} from "../api/webrtc/signaling";
import type { RoomPeerSession } from "../api/webrtc/session";
import { WS_STATUS_EVENT, getWsStatus } from "../api/ws";

const IDLE: PeerLinkState = {
  status: "idle",
  connectionType: null,
  peerUserId: null,
  channelOpen: false,
};

const MAX_RECONNECT_DELAY_MS = 12_000;
const CONNECTING_TIMEOUT_MS = 25_000;

type PeerHandle = {
  dispose: () => void;
  peerUserId: string;
};

function remotePeerIdsFor(room: Room | null, localUserId: string): string[] {
  if (!room || !localUserId) return [];
  const members = room.members ?? [];
  if (members.length === 0) return [];

  if (localUserId === room.owner_user_id) {
    return members
      .filter((m) => m.user_id !== localUserId)
      .map((m) => m.user_id)
      .sort();
  }

  const amMember = members.some((m) => m.user_id === localUserId);
  if (!amMember) return [];
  return [room.owner_user_id];
}

function aggregateLink(peers: Record<string, PeerLinkState>, expectedIds: string[]): PeerLinkState {
  if (expectedIds.length === 0) return IDLE;

  const links = expectedIds.map((id) => peers[id]).filter(Boolean) as PeerLinkState[];
  if (links.length === 0) {
    return { ...IDLE, status: "preparing", peerUserId: expectedIds[0] ?? null };
  }

  const open = links.filter((l) => l.channelOpen && l.status === "connected");
  if (open.length > 0) {
    const preferred = open.find((l) => l.connectionType === "direct") ?? open[0]!;
    return {
      status: "connected",
      connectionType: preferred.connectionType,
      peerUserId: preferred.peerUserId,
      channelOpen: true,
    };
  }

  if (links.some((l) => l.status === "connecting" || l.status === "preparing")) {
    return {
      status: "connecting",
      connectionType: null,
      peerUserId: links[0]?.peerUserId ?? expectedIds[0] ?? null,
      channelOpen: false,
    };
  }

  if (links.every((l) => l.status === "failed" || l.status === "closed")) {
    return {
      status: "failed",
      connectionType: null,
      peerUserId: links[0]?.peerUserId ?? null,
      channelOpen: false,
    };
  }

  return {
    status: links[0]?.status ?? "connecting",
    connectionType: null,
    peerUserId: links[0]?.peerUserId ?? expectedIds[0] ?? null,
    channelOpen: false,
  };
}

export function useRoomPeerSession(
  room: Room | null,
  localUserId: string,
  callbacks?: {
    onTunnelOpen?: (fromPeerUserId: string) => void;
    onSessionReset?: () => void;
    onPeerChannelOpen?: (peerUserId: string, session: RoomPeerSession) => void;
  },
): {
  link: PeerLinkState;
  session: RoomPeerSession | null;
  sessions: Record<string, RoomPeerSession>;
  peerLinks: Record<string, PeerLinkState>;
  expectedPeerIds: string[];
  connectedPeerIds: string[];
} {
  const [peerLinks, setPeerLinks] = useState<Record<string, PeerLinkState>>({});
  const [sessions, setSessions] = useState<Record<string, RoomPeerSession>>({});
  const [wsStatus, setWsStatus] = useState(getWsStatus);
  const [reconnectTick, setReconnectTick] = useState(0);

  const handlesRef = useRef<Map<string, PeerHandle>>(new Map());
  const reconnectAttemptRef = useRef<Map<string, number>>(new Map());
  const reconnectTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const connectingTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const channelOpenRef = useRef<Map<string, boolean>>(new Map());
  const sessionsByPeerRef = useRef<Record<string, RoomPeerSession>>({});
  const roomRef = useRef(room);
  const onTunnelOpenRef = useRef(callbacks?.onTunnelOpen);
  const onSessionResetRef = useRef(callbacks?.onSessionReset);
  const onPeerChannelOpenRef = useRef(callbacks?.onPeerChannelOpen);
  roomRef.current = room;
  onTunnelOpenRef.current = callbacks?.onTunnelOpen;
  onSessionResetRef.current = callbacks?.onSessionReset;
  onPeerChannelOpenRef.current = callbacks?.onPeerChannelOpen;

  const expectedPeerIds = useMemo(
    () => remotePeerIdsFor(room, localUserId),
    [room, localUserId],
  );
  const expectedKey = expectedPeerIds.join(",");

  useEffect(() => {
    const onStatus = (ev: Event) => {
      const next = (ev as CustomEvent<string>).detail;
      if (next === "connected" || next === "connecting" || next === "disconnected") {
        setWsStatus(next);
      }
    };
    window.addEventListener(WS_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(WS_STATUS_EVENT, onStatus);
  }, []);

  const clearPeerTimers = (peerId: string) => {
    const c = connectingTimerRef.current.get(peerId);
    if (c) {
      clearTimeout(c);
      connectingTimerRef.current.delete(peerId);
    }
    const r = reconnectTimerRef.current.get(peerId);
    if (r) {
      clearTimeout(r);
      reconnectTimerRef.current.delete(peerId);
    }
  };

  const disposePeer = (peerId: string) => {
    clearPeerTimers(peerId);
    handlesRef.current.get(peerId)?.dispose();
    handlesRef.current.delete(peerId);
    channelOpenRef.current.delete(peerId);
    delete sessionsByPeerRef.current[peerId];
    setPeerLinks((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setSessions((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  };

  const requestRestart = (peerId: string) => {
    if (channelOpenRef.current.get(peerId)) return;
    disposePeer(peerId);
    setPeerLinks((prev) => ({
      ...prev,
      [peerId]: {
        status: "failed",
        connectionType: null,
        peerUserId: peerId,
        channelOpen: false,
      },
    }));
    reconnectAttemptRef.current.set(
      peerId,
      (reconnectAttemptRef.current.get(peerId) ?? 0) + 1,
    );
    setReconnectTick((n) => n + 1);
  };

  useEffect(() => {
    const currentIds = new Set(expectedPeerIds);
    let removed = false;
    for (const peerId of [...handlesRef.current.keys()]) {
      if (!currentIds.has(peerId)) {
        disposePeer(peerId);
        reconnectAttemptRef.current.delete(peerId);
        removed = true;
      }
    }
    if (removed) {
      onSessionResetRef.current?.();
    }

    if (!room || !localUserId || expectedPeerIds.length === 0) {
      for (const peerId of [...handlesRef.current.keys()]) {
        disposePeer(peerId);
      }
      setPeerLinks({});
      setSessions({});
      return;
    }

    if (wsStatus !== "connected") {
      return;
    }

    const currentRoom = roomRef.current;
    if (!currentRoom) return;

    for (const peerUserId of expectedPeerIds) {
      if (handlesRef.current.has(peerUserId)) continue;
      if (channelOpenRef.current.get(peerUserId)) continue;

      const handle = startPeerSignaling({
        roomId: currentRoom.id,
        localUserId,
        hostUserId: currentRoom.owner_user_id,
        peerUserId,
        onState: (state) => {
          const wasOpen = channelOpenRef.current.get(peerUserId) === true;
          channelOpenRef.current.set(peerUserId, state.channelOpen);
          setPeerLinks((prev) => ({ ...prev, [peerUserId]: state }));
          if (state.channelOpen) {
            reconnectAttemptRef.current.set(peerUserId, 0);
            clearPeerTimers(peerUserId);
            if (!wasOpen) {
              const session = sessionsByPeerRef.current[peerUserId];
              if (session) onPeerChannelOpenRef.current?.(peerUserId, session);
            }
          }
        },
        onSession: (session) => {
          if (!session) {
            delete sessionsByPeerRef.current[peerUserId];
          } else {
            sessionsByPeerRef.current[peerUserId] = session;
          }
          setSessions((prev) => {
            if (!session) {
              if (!(peerUserId in prev)) return prev;
              const next = { ...prev };
              delete next[peerUserId];
              return next;
            }
            return { ...prev, [peerUserId]: session };
          });
        },
        onTunnelOpen: () => onTunnelOpenRef.current?.(peerUserId),
        onRequestRestart: () => requestRestart(peerUserId),
      });

      handlesRef.current.set(peerUserId, {
        dispose: handle.dispose,
        peerUserId,
      });
    }
  }, [expectedKey, localUserId, wsStatus, reconnectTick, room?.id, room?.owner_user_id]);

  useEffect(() => {
    return () => {
      for (const peerId of [...handlesRef.current.keys()]) {
        disposePeer(peerId);
      }
      reconnectAttemptRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (wsStatus !== "connected") return;

    for (const peerId of expectedPeerIds) {
      const link = peerLinks[peerId];
      clearTimeout(connectingTimerRef.current.get(peerId));
      connectingTimerRef.current.delete(peerId);

      if (!link || link.channelOpen) continue;
      if (link.status !== "preparing" && link.status !== "connecting") continue;

      connectingTimerRef.current.set(
        peerId,
        setTimeout(() => requestRestart(peerId), CONNECTING_TIMEOUT_MS),
      );
    }

    return () => {
      for (const peerId of expectedPeerIds) {
        const t = connectingTimerRef.current.get(peerId);
        if (t) clearTimeout(t);
      }
    };
  }, [peerLinks, expectedKey, wsStatus, reconnectTick]);

  useEffect(() => {
    if (wsStatus !== "connected") return;

    for (const peerId of expectedPeerIds) {
      const link = peerLinks[peerId];
      const existing = reconnectTimerRef.current.get(peerId);
      if (existing) {
        clearTimeout(existing);
        reconnectTimerRef.current.delete(peerId);
      }

      if (!link || link.channelOpen) continue;
      if (link.status !== "failed" && link.status !== "closed") continue;
      if (handlesRef.current.has(peerId)) continue;

      const attempt = reconnectAttemptRef.current.get(peerId) ?? 0;
      const delay = Math.min(1500 * (attempt + 1), MAX_RECONNECT_DELAY_MS);
      reconnectTimerRef.current.set(
        peerId,
        setTimeout(() => {
          setReconnectTick((n) => n + 1);
        }, delay),
      );
    }

    return () => {
      for (const t of reconnectTimerRef.current.values()) clearTimeout(t);
      reconnectTimerRef.current.clear();
    };
  }, [peerLinks, expectedKey, wsStatus]);

  const link = aggregateLink(peerLinks, expectedPeerIds);
  const connectedPeerIds = expectedPeerIds.filter(
    (id) => peerLinks[id]?.channelOpen && peerLinks[id]?.status === "connected",
  );

  const session =
    (link.peerUserId && sessions[link.peerUserId]) ||
    sessions[connectedPeerIds[0] ?? ""] ||
    sessions[expectedPeerIds[0] ?? ""] ||
    null;

  return {
    link,
    session,
    sessions,
    peerLinks,
    expectedPeerIds,
    connectedPeerIds,
  };
}
