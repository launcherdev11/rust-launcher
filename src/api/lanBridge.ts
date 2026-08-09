import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const LAN_BRIDGE_DATA = "lan-bridge-data";
export const LAN_BRIDGE_STATUS = "lan-bridge-status";

export type LanBridgeStatus = {
  session_id?: string;
  state: string;
  detail?: string | null;
};

export type LanBridgeData = {
  session_id?: string;
  data_b64: string;
};

function b64FromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizeSessionId(sessionId?: string | null): string {
  const trimmed = (sessionId ?? "").trim();
  return trimmed || "default";
}

/** Start guest TCP listener; returns local port for Minecraft quick-play join. */
export async function startGuestBridge(sessionId: string): Promise<number> {
  return invoke<number>("lan_bridge_start_guest", {
    sessionId: normalizeSessionId(sessionId),
  });
}

/** Host: connect bridge to local Open-to-LAN Minecraft port (one session per guest). */
export async function startHostBridge(sessionId: string, lanPort: number): Promise<void> {
  await invoke("lan_bridge_start_host", {
    sessionId: normalizeSessionId(sessionId),
    lanPort,
  });
}

export async function writeBridgeBytes(
  sessionId: string,
  data: ArrayBuffer | Uint8Array,
): Promise<void> {
  await invoke("lan_bridge_write", {
    sessionId: normalizeSessionId(sessionId),
    dataB64: b64FromBytes(data),
  });
}

/** Stop one session, or all sessions when sessionId is omitted. */
export async function stopBridge(sessionId?: string | null): Promise<void> {
  await invoke("lan_bridge_stop", {
    sessionId: sessionId == null ? null : normalizeSessionId(sessionId),
  });
}

const OUTBOUND_QUEUE_WARN = 256;
const BACKPRESSURE_POLL_MS = 8;

/**
 * Wire Tauri TCP bridge ↔ WebRTC DataChannel for a single peer session.
 * Returns dispose() — detaches listeners only. Does NOT stop the Rust bridge
 * (stopping mid-join causes Minecraft "connection refused").
 *
 * Ordering is critical: Minecraft TCP is a single byte stream. Concurrent
 * `lan_bridge_write` IPC calls (or silent DataChannel drops) scramble packets
 * and surface as zlib `incorrect header check` after world join.
 */
export async function attachLanTunnel(opts: {
  sessionId: string;
  sendBinary: (data: ArrayBuffer) => boolean;
  canSend?: () => boolean;
  onRemoteBinary: (handler: (data: ArrayBuffer) => void) => () => void;
  onStatus?: (status: LanBridgeStatus) => void;
}): Promise<() => void> {
  const sessionId = normalizeSessionId(opts.sessionId);
  const unsubs: UnlistenFn[] = [];
  let disposed = false;

  let inboundWriteChain: Promise<void> = Promise.resolve();

  const outboundQueue: ArrayBuffer[] = [];
  let flushingOutbound = false;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const flushOutbound = async () => {
    if (flushingOutbound) return;
    flushingOutbound = true;
    try {
      while (!disposed && outboundQueue.length > 0) {
        while (!disposed && opts.canSend && !opts.canSend()) {
          await sleep(BACKPRESSURE_POLL_MS);
        }
        if (disposed) break;
        const chunk = outboundQueue[0]!;
        if (opts.sendBinary(chunk)) {
          outboundQueue.shift();
        } else {
          await sleep(BACKPRESSURE_POLL_MS);
        }
      }
    } finally {
      flushingOutbound = false;
      if (!disposed && outboundQueue.length > 0) {
        void flushOutbound();
      }
    }
  };

  unsubs.push(
    await listen<LanBridgeData>(LAN_BRIDGE_DATA, (ev) => {
      if (disposed) return;
      const payloadSession = normalizeSessionId(ev.payload.session_id);
      if (payloadSession !== sessionId) return;
      try {
        const bytes = bytesFromB64(ev.payload.data_b64);
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        if (outboundQueue.length === OUTBOUND_QUEUE_WARN) {
          console.warn(
            "[lan-bridge] outbound queue growing under DataChannel backpressure",
            outboundQueue.length,
          );
        }
        outboundQueue.push(ab);
        void flushOutbound();
      } catch {
      }
    }),
  );

  unsubs.push(
    await listen<LanBridgeStatus>(LAN_BRIDGE_STATUS, (ev) => {
      const payloadSession = normalizeSessionId(ev.payload.session_id);
      if (payloadSession !== sessionId) return;
      opts.onStatus?.(ev.payload);
    }),
  );

  const detachRemote = opts.onRemoteBinary((data) => {
    if (disposed) return;
    const copy = data.slice(0);
    inboundWriteChain = inboundWriteChain
      .then(() => {
        if (disposed) return;
        return writeBridgeBytes(sessionId, copy);
      })
      .catch((err) => {
        console.warn("[lan-bridge] writeBridgeBytes failed", err);
      });
  });

  return () => {
    disposed = true;
    outboundQueue.length = 0;
    detachRemote();
    for (const u of unsubs) {
      try {
        void u();
      } catch {
      }
    }
  };
}

export { b64FromBytes, bytesFromB64 };
