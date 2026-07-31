import {
  sendWsMessage,
  WS_EVENT,
  type ConnectionType,
  type IceCandidateDto,
  type WsEvent,
} from "../ws";
import { RoomPeerSession, type PeerSessionStatus } from "./session";

export type PeerLinkState = {
  status: PeerSessionStatus;
  connectionType: ConnectionType | null;
  peerUserId: string | null;
  channelOpen: boolean;
};

type Options = {
  roomId: string;
  localUserId: string;
  /** Room owner creates the offer. */
  hostUserId: string;
  peerUserId: string;
  onState: (state: PeerLinkState) => void;
  onSession?: (session: RoomPeerSession | null) => void;
  /** Host-only: guest signaled that Minecraft connected to the tunnel. */
  onTunnelOpen?: () => void;
};

/**
 * Bind platform WS signaling to a single RoomPeerSession.
 * Caller must dispose() when the room is left or peer leaves.
 */
export function startPeerSignaling(opts: Options): { dispose: () => void; getSession: () => RoomPeerSession | null } {
  const isHost = opts.localUserId === opts.hostUserId;
  let session: RoomPeerSession | null = null;
  let disposed = false;

  const emit = (partial: Partial<PeerLinkState>) => {
    opts.onState({
      status: partial.status ?? "idle",
      connectionType: partial.connectionType ?? null,
      peerUserId: opts.peerUserId,
      channelOpen: partial.channelOpen ?? session?.channelOpen ?? false,
      ...partial,
    });
  };

  const session_ = new RoomPeerSession({
    roomId: opts.roomId,
    localUserId: opts.localUserId,
    remoteUserId: opts.peerUserId,
    isHost,
    callbacks: {
      onLocalIce: (candidate: IceCandidateDto) => {
        sendWsMessage({
          type: "ice_candidate",
          payload: {
            to_user_id: opts.peerUserId,
            room_id: opts.roomId,
            candidate,
          },
        });
      },
      onLocalOffer: (sdp) => {
        sendWsMessage({
          type: "offer",
          payload: { to_user_id: opts.peerUserId, room_id: opts.roomId, sdp },
        });
      },
      onLocalAnswer: (sdp) => {
        sendWsMessage({
          type: "answer",
          payload: { to_user_id: opts.peerUserId, room_id: opts.roomId, sdp },
        });
      },
      onStatus: (status) => {
        emit({ status, peerUserId: opts.peerUserId });
      },
      onConnectionType: (connectionType) => {
        emit({ status: "connected", connectionType, peerUserId: opts.peerUserId });
        sendWsMessage({
          type: "connection_established",
          payload: { room_id: opts.roomId, connection_type: connectionType },
        });
      },
      onChannelOpen: () => {
        emit({ channelOpen: true, status: "connected" });
      },
      onTunnelOpen: () => {
        opts.onTunnelOpen?.();
      },
    },
  });
  session = session_;
  opts.onSession?.(session_);

  const onWs = (ev: Event) => {
    if (disposed) return;
    const detail = (ev as CustomEvent<WsEvent>).detail;
    if (!detail || typeof detail !== "object" || !("type" in detail)) return;

    if (detail.type === "offer") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId || p.from_user_id !== opts.peerUserId) return;
      if (p.to_user_id !== opts.localUserId) return;
      void session?.handleRemoteOffer(p.sdp);
    } else if (detail.type === "answer") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId || p.from_user_id !== opts.peerUserId) return;
      if (p.to_user_id !== opts.localUserId) return;
      void session?.handleRemoteAnswer(p.sdp);
    } else if (detail.type === "ice_candidate") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId || p.from_user_id !== opts.peerUserId) return;
      if (p.to_user_id !== opts.localUserId) return;
      void session?.handleRemoteIce(p.candidate);
    } else if (detail.type === "peer_leave") {
      // WS disconnect ≠ room leave — keep the WebRTC session alive.
    } else if (detail.type === "room_member_left") {
      const p = detail.payload;
      if (p.room_id === opts.roomId && p.user_id === opts.peerUserId) {
        session?.close();
        emit({ status: "closed", channelOpen: false });
        opts.onSession?.(null);
      }
    }
  };

  window.addEventListener(WS_EVENT, onWs);

  void session_.start().catch(() => {
    emit({ status: "failed" });
  });

  sendWsMessage({ type: "peer_ready", payload: { room_id: opts.roomId } });

  return {
    getSession: () => session,
    dispose: () => {
      disposed = true;
      window.removeEventListener(WS_EVENT, onWs);
      session?.close();
      session = null;
      opts.onSession?.(null);
    },
  };
}
