import { useEffect, useRef, useState } from "react";
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

/**
 * Starts a WebRTC peer session when the selected room has ≥2 members
 * and the platform WebSocket is connected.
 *
 * After DataChannel is open, the session is FROZEN: WS reconnect must NOT
 * tear it down — the game tunnel no longer needs signaling.
 */
export function useRoomPeerSession(
  room: Room | null,
  localUserId: string,
  callbacks?: {
    onTunnelOpen?: () => void;
    /** Called when room/peer identity changes (NOT on P2P reconnect). */
    onSessionReset?: () => void;
  },
): { link: PeerLinkState; session: RoomPeerSession | null } {
  const [link, setLink] = useState<PeerLinkState>(IDLE);
  const [session, setSession] = useState<RoomPeerSession | null>(null);
  const [wsStatus, setWsStatus] = useState(getWsStatus);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const disposeRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef<string | null>(null);
  const roomRef = useRef(room);
  const channelOpenRef = useRef(false);
  const linkStatusRef = useRef<PeerLinkState["status"]>("idle");
  const onTunnelOpenRef = useRef(callbacks?.onTunnelOpen);
  const onSessionResetRef = useRef(callbacks?.onSessionReset);
  roomRef.current = room;
  onTunnelOpenRef.current = callbacks?.onTunnelOpen;
  onSessionResetRef.current = callbacks?.onSessionReset;

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

  const members = room?.members ?? [];
  const peerUserId =
    members
      .filter((m) => m.user_id !== localUserId)
      .map((m) => m.user_id)
      .sort()
      .join(",") || null;

  const identity =
    room && localUserId && peerUserId && (room.member_count ?? 0) >= 2
      ? `${room.id}:${room.owner_user_id}:${localUserId}:${peerUserId}`
      : null;

  useEffect(() => {
    const identityChanged = identityRef.current !== identity;
    if (identityChanged) {
      if (identityRef.current != null) {
        onSessionResetRef.current?.();
      }
      identityRef.current = identity;
      setReconnectAttempt(0);
      channelOpenRef.current = false;
      disposeRef.current?.();
      disposeRef.current = null;
      setLink(IDLE);
      setSession(null);
    }

    if (!identity) {
      disposeRef.current?.();
      disposeRef.current = null;
      setLink(IDLE);
      setSession(null);
      return;
    }

    if (channelOpenRef.current && disposeRef.current) {
      return;
    }

    if (wsStatus !== "connected") {
      return;
    }

    if (disposeRef.current && !identityChanged) {
      return;
    }

    const current = roomRef.current;
    if (!current) return;

    const peer = (current.members ?? [])
      .filter((m) => m.user_id !== localUserId)
      .sort((a, b) => a.user_id.localeCompare(b.user_id))[0];
    if (!peer) return;

    disposeRef.current?.();
    const handle = startPeerSignaling({
      roomId: current.id,
      localUserId,
      hostUserId: current.owner_user_id,
      peerUserId: peer.user_id,
      onState: (state) => {
        channelOpenRef.current = state.channelOpen;
        linkStatusRef.current = state.status;
        setLink(state);
      },
      onSession: setSession,
      onTunnelOpen: () => onTunnelOpenRef.current?.(),
    });
    disposeRef.current = handle.dispose;

    return () => {
    };
  }, [identity, localUserId, wsStatus, reconnectAttempt]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (link.status === "connected" && link.channelOpen) {
      setReconnectAttempt(0);
    }
  }, [link.status, link.channelOpen]);

  useEffect(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (!identity || wsStatus !== "connected") return;
    if (channelOpenRef.current) return;
    if (link.status !== "failed" && link.status !== "closed") return;

    const delay = Math.min(1500 * (reconnectAttempt + 1), MAX_RECONNECT_DELAY_MS);
    reconnectTimerRef.current = setTimeout(() => {
      disposeRef.current?.();
      disposeRef.current = null;
      channelOpenRef.current = false;
      setReconnectAttempt((n) => n + 1);
    }, delay);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [link.status, identity, wsStatus, reconnectAttempt]);

  return { link, session };
}
