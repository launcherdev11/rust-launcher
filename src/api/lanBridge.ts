import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const LAN_BRIDGE_STATUS = "lan-bridge-status";

export type LanBridgeStatus = {
  session_id?: string;
  state: string;
  detail?: string | null;
};

function normalizeSessionId(sessionId?: string | null): string {
  const trimmed = (sessionId ?? "").trim();
  return trimmed || "default";
}

export async function startGuestBridge(sessionId: string): Promise<number> {
  return invoke<number>("lan_bridge_start_guest", {
    sessionId: normalizeSessionId(sessionId),
  });
}

export async function setHostLanPort(port: number | null): Promise<void> {
  await invoke("lan_bridge_set_host_port", { port });
}

export async function probeLanPort(port: number): Promise<boolean> {
  return invoke<boolean>("lan_bridge_probe_port", { port });
}

export async function stopBridge(sessionId?: string | null): Promise<void> {
  await invoke("lan_bridge_stop", {
    sessionId: sessionId == null ? null : normalizeSessionId(sessionId),
  });
}

const OUTBOUND_PAUSE_BYTES = 2 * 1024 * 1024;
const OUTBOUND_RESUME_BYTES = 512 * 1024;
const BACKPRESSURE_POLL_MS = 8;
const INBOUND_BATCH_MAX = 256 * 1024;
const INBOUND_WRITE_ATTEMPTS = 3;

function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(data)) return Uint8Array.from(data as number[]).buffer;
  return null;
}

function concatChunks(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export async function attachLanTunnel(opts: {
  sessionId: string;
  sendBinary: (data: ArrayBuffer) => boolean;
  canSend: () => boolean;
  onRemoteBinary: (handler: (data: ArrayBuffer) => void) => () => void;
  onStatus?: (status: LanBridgeStatus) => void;
}): Promise<() => void> {
  const sessionId = normalizeSessionId(opts.sessionId);
  let disposed = false;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const outboundQueue: ArrayBuffer[] = [];
  let outboundBytes = 0;
  let flowPaused = false;
  let flushingOutbound = false;

  const setFlow = (paused: boolean) => {
    if (flowPaused === paused) return;
    flowPaused = paused;
    void invoke("lan_bridge_set_flow", { sessionId, paused }).catch(() => {});
  };

  const flushOutbound = async () => {
    if (flushingOutbound) return;
    flushingOutbound = true;
    try {
      while (!disposed && outboundQueue.length > 0) {
        const chunk = outboundQueue[0]!;
        if (!opts.canSend() || !opts.sendBinary(chunk)) {
          await sleep(BACKPRESSURE_POLL_MS);
          continue;
        }
        outboundQueue.shift();
        outboundBytes -= chunk.byteLength;
        if (flowPaused && outboundBytes < OUTBOUND_RESUME_BYTES) setFlow(false);
      }
    } finally {
      flushingOutbound = false;
    }
  };

  const onFrame = new Channel<ArrayBuffer>();
  onFrame.onmessage = (data) => {
    if (disposed) return;
    const buf = toArrayBuffer(data);
    if (!buf || buf.byteLength === 0) return;
    if (outboundQueue.length === 0 && opts.canSend() && opts.sendBinary(buf)) return;
    outboundQueue.push(buf);
    outboundBytes += buf.byteLength;
    if (outboundBytes > OUTBOUND_PAUSE_BYTES) setFlow(true);
    void flushOutbound();
  };

  const unlistenStatus: UnlistenFn = await listen<LanBridgeStatus>(LAN_BRIDGE_STATUS, (ev) => {
    if (normalizeSessionId(ev.payload.session_id) !== sessionId) return;
    opts.onStatus?.(ev.payload);
  });

  let generation: number;
  try {
    generation = await invoke<number>("lan_bridge_attach", { sessionId, onFrame });
  } catch (err) {
    unlistenStatus();
    throw err;
  }

  const inboundPending: Uint8Array[] = [];
  let writingInbound = false;

  const writeInbound = async (body: Uint8Array) => {
    for (let attempt = 1; attempt <= INBOUND_WRITE_ATTEMPTS; attempt++) {
      if (disposed) return;
      try {
        await invoke("lan_bridge_write", body, { headers: { "x-lan-session": sessionId } });
        return;
      } catch (err) {
        if (attempt === INBOUND_WRITE_ATTEMPTS) {
          console.warn("[lan-bridge] write failed", err);
          return;
        }
        await sleep(50 * attempt);
      }
    }
  };

  const pumpInbound = async () => {
    if (writingInbound) return;
    writingInbound = true;
    try {
      while (!disposed && inboundPending.length > 0) {
        let count = 0;
        let size = 0;
        while (count < inboundPending.length) {
          const next = inboundPending[count]!.byteLength;
          if (count > 0 && size + next > INBOUND_BATCH_MAX) break;
          size += next;
          count++;
        }
        await writeInbound(concatChunks(inboundPending.splice(0, count), size));
      }
    } finally {
      writingInbound = false;
    }
  };

  const detachRemote = opts.onRemoteBinary((data) => {
    if (disposed || data.byteLength === 0) return;
    inboundPending.push(new Uint8Array(data));
    void pumpInbound();
  });

  return () => {
    if (disposed) return;
    disposed = true;
    outboundQueue.length = 0;
    inboundPending.length = 0;
    onFrame.onmessage = () => {};
    detachRemote();
    unlistenStatus();
    void invoke("lan_bridge_detach", { sessionId, generation }).catch(() => {});
  };
}
