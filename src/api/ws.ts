import {
  ApiError,
  clearApiSession,
  getApiBaseUrl,
  getStoredAccessToken,
  getStoredRefreshToken,
  persistApiSession,
} from "./client";
import { API_AUTH_CHANGED_EVENT, refreshSession } from "./auth";

export const WS_EVENT = "mc16launcher:ws-event";
export const WS_STATUS_EVENT = "mc16launcher:ws-status";

export type IceCandidateDto = {
  candidate: string;
  sdp_mid?: string | null;
  sdp_m_line_index?: number | null;
};

export type ConnectionType = "direct" | "relay";

export type WsEvent =
  | { type: "user_online"; payload: { user_id: string; nickname?: string | null } }
  | { type: "user_offline"; payload: { user_id: string; last_seen?: string | null } }
  | {
      type: "friend_request_created";
      payload: {
        request_id: string;
        from_user_id: string;
        from_nickname: string;
        to_user_id: string;
      };
    }
  | {
      type: "friend_request_accepted";
      payload: { request_id: string; user_id: string; friend_user_id: string };
    }
  | { type: "friend_removed"; payload: { user_id: string; friend_user_id: string } }
  | { type: "room_created"; payload: { room_id: string; owner_user_id: string } }
  | {
      type: "room_updated";
      payload: { room_id: string; status: string; member_count: number };
    }
  | { type: "room_closed"; payload: { room_id: string } }
  | {
      type: "room_member_joined";
      payload: { room_id: string; user_id: string; nickname: string };
    }
  | { type: "room_member_left"; payload: { room_id: string; user_id: string } }
  | {
      type: "room_invite";
      payload: {
        room_id: string;
        from_user_id: string;
        from_nickname: string;
        to_user_id: string;
      };
    }
  | {
      type: "notification";
      payload: { id: string; notification_type: string; payload: unknown };
    }
  | {
      type: "offer";
      payload: {
        from_user_id: string;
        to_user_id: string;
        room_id: string;
        sdp: string;
      };
    }
  | {
      type: "answer";
      payload: {
        from_user_id: string;
        to_user_id: string;
        room_id: string;
        sdp: string;
      };
    }
  | {
      type: "ice_candidate";
      payload: {
        from_user_id: string;
        to_user_id: string;
        room_id: string;
        candidate: IceCandidateDto;
      };
    }
  | {
      type: "peer_join";
      payload: { room_id: string; user_id: string; nickname?: string | null };
    }
  | { type: "peer_leave"; payload: { room_id: string; user_id: string } }
  | { type: "peer_ready"; payload: { room_id: string; user_id: string } }
  | {
      type: "connection_failed";
      payload: { room_id: string; user_id: string; reason?: string | null };
    }
  | {
      type: "connection_established";
      payload: { room_id: string; user_id: string; connection_type: ConnectionType };
    }
  | { type: "heartbeat"; payload?: Record<string, never> };

export type WsClientMessage =
  | { type: "heartbeat"; payload: Record<string, never> }
  | { type: "presence_heartbeat"; payload: Record<string, never> }
  | { type: "offer"; payload: { to_user_id: string; room_id: string; sdp: string } }
  | { type: "answer"; payload: { to_user_id: string; room_id: string; sdp: string } }
  | {
      type: "ice_candidate";
      payload: { to_user_id: string; room_id: string; candidate: IceCandidateDto };
    }
  | { type: "peer_ready"; payload: { room_id: string } }
  | { type: "connection_failed"; payload: { room_id: string; reason?: string } }
  | {
      type: "connection_established";
      payload: { room_id: string; connection_type: ConnectionType };
    };

function wsBaseUrl(): string {
  const http = getApiBaseUrl();
  if (http.startsWith("https://")) return `wss://${http.slice("https://".length)}`;
  if (http.startsWith("http://")) return `ws://${http.slice("http://".length)}`;
  return `ws://${http}`;
}

type Status = "disconnected" | "connecting" | "connected";

let socket: WebSocket | null = null;
let status: Status = "disconnected";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let intentionalClose = false;
/** WS closed before open — usually HTTP 401 on /ws upgrade. */
let authRecoveryAttempts = 0;
const MAX_AUTH_RECOVERY_ATTEMPTS = 2;

const SIGNALING_MESSAGE_TYPES = new Set<WsClientMessage["type"]>([
  "offer",
  "answer",
  "ice_candidate",
  "peer_ready",
  "connection_failed",
  "connection_established",
]);
const pendingSignalingMessages: WsClientMessage[] = [];
const MAX_PENDING_SIGNALING = 64;

function isSignalingMessage(message: WsClientMessage): boolean {
  return SIGNALING_MESSAGE_TYPES.has(message.type);
}

function flushPendingSignalingMessages(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (pendingSignalingMessages.length > 0) {
    const message = pendingSignalingMessages.shift()!;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      pendingSignalingMessages.unshift(message);
      break;
    }
  }
}

function setStatus(next: Status) {
  status = next;
  window.dispatchEvent(new CustomEvent(WS_STATUS_EVENT, { detail: next }));
}

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPlatformWs();
  }, 2_500);
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    sendWsMessage({ type: "heartbeat", payload: {} });
  }, 25_000);
}

export function getWsStatus(): Status {
  return status;
}

/** Send a typed client message. Signaling messages are queued until reconnect. */
export function sendWsMessage(message: WsClientMessage): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (isSignalingMessage(message)) {
      pendingSignalingMessages.push(message);
      if (pendingSignalingMessages.length > MAX_PENDING_SIGNALING) {
        pendingSignalingMessages.shift();
      }
    }
    return false;
  }
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    if (isSignalingMessage(message)) {
      pendingSignalingMessages.push(message);
      if (pendingSignalingMessages.length > MAX_PENDING_SIGNALING) {
        pendingSignalingMessages.shift();
      }
    }
    return false;
  }
}

/**
 * After JWT_SECRET rotation (or deleted refresh sessions), a still-unexpired
 * access token keeps failing /ws forever. Recover via refresh once, else clear.
 */
async function recoverAfterWsAuthFailure(): Promise<void> {
  if (authRecoveryAttempts >= MAX_AUTH_RECOVERY_ATTEMPTS) {
    clearApiSession();
    authRecoveryAttempts = 0;
    return;
  }
  authRecoveryAttempts += 1;

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    clearApiSession();
    authRecoveryAttempts = 0;
    return;
  }

  try {
    const tokens = await refreshSession(refreshToken);
    persistApiSession(tokens.access_token, tokens.refresh_token);
    // persistApiSession emits auth-changed → reconnect with new access token
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 400)) {
      clearApiSession();
      authRecoveryAttempts = 0;
      return;
    }
    // Transient network error — retry later without wiping the session.
    if (getStoredAccessToken()) {
      scheduleReconnect();
    }
  }
}

export function connectPlatformWs(): void {
  if (typeof window === "undefined") return;
  const token = getStoredAccessToken();
  if (!token) {
    disconnectPlatformWs();
    return;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  intentionalClose = false;
  clearTimers();
  setStatus("connecting");
  let opened = false;

  const url = `${wsBaseUrl()}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    opened = true;
    authRecoveryAttempts = 0;
    setStatus("connected");
    startHeartbeat();
    flushPendingSignalingMessages();
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as WsEvent;
      window.dispatchEvent(new CustomEvent(WS_EVENT, { detail: data }));
    } catch {
      // ignore malformed
    }
  };

  ws.onerror = () => {
    // onclose will handle reconnect / auth recovery
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    clearTimers();
    setStatus("disconnected");
    if (intentionalClose) return;

    if (!opened) {
      void recoverAfterWsAuthFailure();
      return;
    }

    if (getStoredAccessToken()) {
      scheduleReconnect();
    }
  };
}

export function disconnectPlatformWs(): void {
  intentionalClose = true;
  pendingSignalingMessages.length = 0;
  clearTimers();
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }
  setStatus("disconnected");
}

export function startPlatformWsLifecycle(): () => void {
  const onAuth = () => {
    if (getStoredAccessToken()) {
      connectPlatformWs();
    } else {
      disconnectPlatformWs();
    }
  };

  onAuth();
  window.addEventListener(API_AUTH_CHANGED_EVENT, onAuth);
  window.addEventListener("storage", onAuth);

  return () => {
    window.removeEventListener(API_AUTH_CHANGED_EVENT, onAuth);
    window.removeEventListener("storage", onAuth);
    disconnectPlatformWs();
  };
}
