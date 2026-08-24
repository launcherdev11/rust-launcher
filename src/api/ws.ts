import {
  clearApiSession,
  getApiBaseUrl,
  getStoredAccessToken,
  getStoredRefreshToken,
} from "./client";
import { API_AUTH_CHANGED_EVENT, ensureValidAccessToken } from "./auth";
import { normalizePresenceInfo, type PresenceInfo } from "./presence";
import { normalizeRoom } from "./rooms";

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
  | { type: "presence_updated"; payload: { presence: PresenceInfo } }
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
      payload: {
        room_id: string;
        status: string;
        member_count: number;
        name?: string | null;
        visibility?: string | null;
        join_code?: string | null;
        invite_only?: boolean | null;
        session_started_at?: string | null;
      };
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : value == null ? null : undefined;
}

function asOptionalTimestampString(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return value == null ? null : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | null | undefined {
  return typeof value === "boolean" ? value : value == null ? null : undefined;
}

function asLooseBoolean(value: unknown): boolean | null | undefined {
  if (typeof value === "boolean" || value == null) {
    return asOptionalBoolean(value);
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return undefined;
}

function normalizeWsEvent(input: unknown): WsEvent | null {
  const raw = asObject(input);
  if (!raw) return null;

  const type = asOptionalString(raw.type);
  const payload = raw.payload;
  if (!type) return null;

  if (type === "presence_updated") {
    const payloadObject = asObject(payload);
    const presence = normalizePresenceInfo(payloadObject?.presence ?? payload);
    return presence ? { type, payload: { presence } } : null;
  }

  if (type === "room_updated") {
    const payloadObject = asObject(payload);
    const normalizedRoom = normalizeRoom(payloadObject);
    if (normalizedRoom) {
      return {
        type,
        payload: {
          room_id: normalizedRoom.id,
          status: normalizedRoom.status,
          member_count: normalizedRoom.member_count,
          name: normalizedRoom.name ?? null,
          visibility: normalizedRoom.visibility ?? null,
          invite_only: normalizedRoom.invite_only ?? null,
          session_started_at: normalizedRoom.session_started_at ?? null,
        },
      };
    }

    const roomId =
      asOptionalString(payloadObject?.room_id) ?? asOptionalString(payloadObject?.roomId);
    const status = asOptionalString(payloadObject?.status);
    const memberCount =
      asOptionalNumber(payloadObject?.member_count) ?? asOptionalNumber(payloadObject?.memberCount);
    if (!roomId || !status || memberCount == null) return null;

    return {
      type,
      payload: {
        room_id: roomId,
        status,
        member_count: memberCount,
          name:
            asOptionalString(payloadObject?.name) ??
            asOptionalString(payloadObject?.room_name) ??
            asOptionalString(payloadObject?.roomName) ??
            null,
        visibility:
            asOptionalString(payloadObject?.visibility) ??
            asOptionalString(payloadObject?.room_visibility) ??
            asOptionalString(payloadObject?.roomVisibility) ??
            (asLooseBoolean(payloadObject?.is_private) === true
              ? "private"
              : asLooseBoolean(payloadObject?.is_private) === false
                ? "public"
                : null),
        invite_only:
          asOptionalBoolean(payloadObject?.invite_only) ??
            asOptionalBoolean(payloadObject?.inviteOnly) ??
            asLooseBoolean(payloadObject?.private) ??
          null,
        session_started_at:
            asOptionalTimestampString(payloadObject?.session_started_at) ??
            asOptionalTimestampString(payloadObject?.sessionStartedAt) ??
            asOptionalTimestampString(asObject(payloadObject?.session)?.started_at) ??
            asOptionalTimestampString(asObject(payloadObject?.session)?.startedAt) ??
            null,
      },
    };
  }

  return raw as WsEvent;
}

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
let connectGeneration = 0;
let connectInFlight = false;
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

async function recoverAfterWsAuthFailure(): Promise<void> {
  if (authRecoveryAttempts >= MAX_AUTH_RECOVERY_ATTEMPTS) {
    clearApiSession();
    authRecoveryAttempts = 0;
    return;
  }
  authRecoveryAttempts += 1;

  if (!getStoredRefreshToken()) {
    clearApiSession();
    authRecoveryAttempts = 0;
    return;
  }

  const newToken = await ensureValidAccessToken({ force: true });
  if (newToken) {
    connectPlatformWs();
    return;
  }
  if (getStoredAccessToken()) {
    scheduleReconnect();
  } else {
    authRecoveryAttempts = 0;
  }
}

function openPlatformWs(token: string): void {
  intentionalClose = false;
  clearTimers();
  setStatus("connecting");
  let opened = false;

  const url = `${wsBaseUrl()}/ws`;
  const ws = new WebSocket(url, ["mc16launcher.bearer", token]);
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
      const data = normalizeWsEvent(JSON.parse(String(ev.data)));
      if (!data) return;
      window.dispatchEvent(new CustomEvent(WS_EVENT, { detail: data }));
    } catch {
    }
  };

  ws.onerror = () => {
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

export function connectPlatformWs(): void {
  if (typeof window === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (connectInFlight) return;

  const generation = ++connectGeneration;
  connectInFlight = true;
  setStatus("connecting");

  void (async () => {
    try {
      const token = await ensureValidAccessToken();
      if (generation !== connectGeneration) return;
      if (!token) {
        disconnectPlatformWs();
        return;
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      openPlatformWs(token);
    } catch {
      if (generation !== connectGeneration) return;
      if (getStoredAccessToken()) {
        scheduleReconnect();
      } else {
        disconnectPlatformWs();
      }
    } finally {
      if (generation === connectGeneration) {
        connectInFlight = false;
      }
    }
  })();
}

export function disconnectPlatformWs(): void {
  intentionalClose = true;
  connectGeneration += 1;
  connectInFlight = false;
  pendingSignalingMessages.length = 0;
  clearTimers();
  if (socket) {
    try {
      socket.close();
    } catch {
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
