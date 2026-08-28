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
  hostUserId: string;
  peerUserId: string;
  iceTransportPolicy?: RTCIceTransportPolicy;
  onState: (state: PeerLinkState) => void;
  onSession?: (session: RoomPeerSession | null) => void;
  onTunnelOpen?: () => void;
  onRequestRestart?: () => void;
};

const PEER_READY_INTERVAL_MS = 2_500;
const RENEGOTIATE_DEBOUNCE_MS = 1_200;

export function startPeerSignaling(opts: Options): {
  dispose: () => void;
  getSession: () => RoomPeerSession | null;
} {
  const isHost = opts.localUserId === opts.hostUserId;
  let session: RoomPeerSession | null = null;
  let disposed = false;
  let channelOpen = false;
  let lastRenegotiateAt = 0;
  let peerReadyTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (partial: Partial<PeerLinkState>) => {
    if (disposed) return;
    if (partial.channelOpen === true) channelOpen = true;
    if (partial.status === "closed" || partial.status === "failed") {
      channelOpen = false;
    }
    const next: PeerLinkState = {
      status: "idle",
      connectionType: null,
      peerUserId: opts.peerUserId,
      channelOpen: session?.channelOpen ?? channelOpen,
      ...partial,
    };
    if (partial.channelOpen === true && next.status === "idle") {
      next.status = "connected";
    }
    opts.onState(next);
  };

  const announceReady = () => {
    if (disposed || channelOpen) return;
    sendWsMessage({ type: "peer_ready", payload: { room_id: opts.roomId, user_id: opts.localUserId } });
  };

  const renegotiateFromPeerReady = () => {
    if (disposed || !isHost || channelOpen || !session) return;
    const now = Date.now();
    if (now - lastRenegotiateAt < RENEGOTIATE_DEBOUNCE_MS) return;
    lastRenegotiateAt = now;
    void session.renegotiateOffer().then((result) => {
      if (result === "restart" && !disposed && !channelOpen) {
        opts.onRequestRestart?.();
      }
    });
  };

  const session_ = new RoomPeerSession({
    roomId: opts.roomId,
    localUserId: opts.localUserId,
    remoteUserId: opts.peerUserId,
    isHost,
    iceTransportPolicy: opts.iceTransportPolicy,
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
        channelOpen = true;
        if (peerReadyTimer) {
          clearInterval(peerReadyTimer);
          peerReadyTimer = null;
        }
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
    } else if (detail.type === "peer_ready") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId) return;
      if (p.user_id && p.user_id !== opts.peerUserId) return;
      if (channelOpen) return;
      if (isHost) {
        renegotiateFromPeerReady();
      } else {
        announceReady();
      }
    } else if (detail.type === "peer_join") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId || p.user_id !== opts.peerUserId) return;
      if (channelOpen) return;
      announceReady();
      if (isHost) renegotiateFromPeerReady();
    } else if (detail.type === "room_member_joined") {
      const p = detail.payload;
      if (p.room_id !== opts.roomId || p.user_id !== opts.peerUserId) return;
      if (channelOpen) return;
      announceReady();
      if (isHost) renegotiateFromPeerReady();
    } else if (detail.type === "peer_leave") {
      const p = detail.payload;
      if (p.room_id === opts.roomId && p.user_id === opts.peerUserId) {
        channelOpen = false;
        emit({ status: "closed", channelOpen: false });
        opts.onSession?.(null);
        opts.onRequestRestart?.();
      }
    } else if (detail.type === "room_member_left") {
      const p = detail.payload;
      if (p.room_id === opts.roomId && p.user_id === opts.peerUserId) {
        channelOpen = false;
        emit({ status: "closed", channelOpen: false });
        opts.onSession?.(null);
        opts.onRequestRestart?.();
      }
    }
  };

  window.addEventListener(WS_EVENT, onWs);

  void session_.start().catch(() => {
    emit({ status: "failed" });
  });

  announceReady();
  peerReadyTimer = setInterval(announceReady, PEER_READY_INTERVAL_MS);

  return {
    getSession: () => session,
    dispose: () => {
      disposed = true;
      if (peerReadyTimer) {
        clearInterval(peerReadyTimer);
        peerReadyTimer = null;
      }
      window.removeEventListener(WS_EVENT, onWs);
      session?.close();
      session = null;
      opts.onSession?.(null);
    },
  };
}
