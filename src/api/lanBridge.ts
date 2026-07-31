import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const LAN_BRIDGE_DATA = "lan-bridge-data";
export const LAN_BRIDGE_STATUS = "lan-bridge-status";

export type LanBridgeStatus = {
  state: string;
  detail?: string | null;
};

export type LanBridgeData = {
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

/** Start guest TCP listener; returns local port for Minecraft quick-play join. */
export async function startGuestBridge(): Promise<number> {
  return invoke<number>("lan_bridge_start_guest");
}

/** Host: connect bridge to local Open-to-LAN Minecraft port. */
export async function startHostBridge(lanPort: number): Promise<void> {
  await invoke("lan_bridge_start_host", { lanPort });
}

export async function writeBridgeBytes(data: ArrayBuffer | Uint8Array): Promise<void> {
  await invoke("lan_bridge_write", { dataB64: b64FromBytes(data) });
}

export async function stopBridge(): Promise<void> {
  await invoke("lan_bridge_stop");
}

const OUTBOUND_QUEUE_WARN = 256;
const BACKPRESSURE_POLL_MS = 8;

/**
 * Wire Tauri TCP bridge ↔ WebRTC DataChannel.
 * Returns dispose() — detaches listeners only. Does NOT stop the Rust bridge
 * (stopping mid-join causes Minecraft "connection refused").
 *
 * Ordering is critical: Minecraft TCP is a single byte stream. Concurrent
 * `lan_bridge_write` IPC calls (or silent DataChannel drops) scramble packets
 * and surface as zlib `incorrect header check` after world join.
 */
export async function attachLanTunnel(opts: {
  sendBinary: (data: ArrayBuffer) => boolean;
  canSend?: () => boolean;
  onRemoteBinary: (handler: (data: ArrayBuffer) => void) => () => void;
  onStatus?: (status: LanBridgeStatus) => void;
}): Promise<() => void> {
  const unsubs: UnlistenFn[] = [];
  let disposed = false;

  // Serialize DC → TCP writes so async Tauri invokes cannot reorder bytes.
  let inboundWriteChain: Promise<void> = Promise.resolve();

  // Queue TCP → DC chunks; retry when DataChannel is backpressured instead of dropping.
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
      try {
        const bytes = bytesFromB64(ev.payload.data_b64);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        // Never drop TCP bytes — Minecraft's stream desyncs into zlib DecoderException.
        if (outboundQueue.length === OUTBOUND_QUEUE_WARN) {
          console.warn(
            "[lan-bridge] outbound queue growing under DataChannel backpressure",
            outboundQueue.length,
          );
        }
        outboundQueue.push(ab);
        void flushOutbound();
      } catch {
        // ignore malformed
      }
    }),
  );

  unsubs.push(
    await listen<LanBridgeStatus>(LAN_BRIDGE_STATUS, (ev) => {
      opts.onStatus?.(ev.payload);
    }),
  );

  const detachRemote = opts.onRemoteBinary((data) => {
    if (disposed) return;
    // Copy immediately: ArrayBuffer may be reused by the browser after the handler returns.
    const copy = data.slice(0);
    inboundWriteChain = inboundWriteChain
      .then(() => {
        if (disposed) return;
        return writeBridgeBytes(copy);
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
        // ignore
      }
    }
  };
}

export { b64FromBytes, bytesFromB64 };
