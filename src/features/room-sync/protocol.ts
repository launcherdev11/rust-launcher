import type { RoomPeerSession } from "../../api/webrtc/session";

export type SyncFileKind = "mod" | "pack" | "config" | "script" | "asset";

export type SyncFile = {
  path: string;
  sha1: string;
  size: number;
  fingerprint?: number;
};

export type SyncOptions = {
  resourcePacks: string[];
  shaderPack?: string | null;
  shadersEnabled: boolean;
};

export type SyncManifest = {
  gameVersion: string;
  loader: string;
  loaderVersion?: string | null;
  sharesConfigs?: boolean;
  options?: SyncOptions | null;
  files: SyncFile[];
};

export type ManifestError = "disabled" | "no_profile" | "failed";
export type DenyReason = "relay" | "not_shared" | "failed";

export type FilesMessage =
  | { t: "manifest_req" }
  | { t: "manifest"; manifest?: SyncManifest; error?: ManifestError }
  | { t: "file_req"; path: string }
  | { t: "file_begin"; path: string; size: number }
  | { t: "file_end"; path: string }
  | { t: "file_denied"; path: string; reason: DenyReason };

type PartMessage = { t: "part"; id: string; i: number; n: number; d: string };

const MAX_MESSAGE_CHARS = 32_000;
const MAX_PARTS = 2048;
const BUFFER_HIGH_BYTES = 1024 * 1024;
const BUFFER_POLL_MS = 10;

let partSeq = 0;

export function sendMessage(session: RoomPeerSession, message: FilesMessage): boolean {
  const json = JSON.stringify(message);
  if (json.length <= MAX_MESSAGE_CHARS) return session.sendFiles(json);
  partSeq += 1;
  const id = `${Date.now().toString(36)}-${partSeq}`;
  const n = Math.ceil(json.length / MAX_MESSAGE_CHARS);
  for (let i = 0; i < n; i += 1) {
    const part: PartMessage = { t: "part", id, i, n, d: json.slice(i * MAX_MESSAGE_CHARS, (i + 1) * MAX_MESSAGE_CHARS) };
    if (!session.sendFiles(JSON.stringify(part))) return false;
  }
  return true;
}

export function createMessageReader(
  onMessage: (message: FilesMessage) => void,
  onBinary: (data: ArrayBuffer) => void,
): (data: string | ArrayBuffer) => void {
  let assembling: { id: string; parts: string[]; received: number } | null = null;
  return (data) => {
    if (typeof data !== "string") {
      onBinary(data);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const message = parsed as FilesMessage | PartMessage;
    if (message.t !== "part") {
      onMessage(message);
      return;
    }
    if (!Number.isInteger(message.n) || message.n < 1 || message.n > MAX_PARTS) return;
    if (!assembling || assembling.id !== message.id) {
      assembling = { id: message.id, parts: new Array(message.n), received: 0 };
    }
    if (message.i < 0 || message.i >= assembling.parts.length || assembling.parts[message.i] != null) return;
    assembling.parts[message.i] = message.d;
    assembling.received += 1;
    if (assembling.received === assembling.parts.length) {
      const json = assembling.parts.join("");
      assembling = null;
      try {
        onMessage(JSON.parse(json) as FilesMessage);
      } catch {
      }
    }
  };
}

export async function waitForSendBuffer(session: RoomPeerSession): Promise<void> {
  while (session.filesBufferedAmount > BUFFER_HIGH_BYTES) {
    if (!session.supportsRoomFiles) throw new Error("channel closed");
    await new Promise((resolve) => window.setTimeout(resolve, BUFFER_POLL_MS));
  }
}

export const RELAY_MAX_FILE_BYTES = 1024 * 1024;
export const RELAY_BUDGET_BYTES = 8 * 1024 * 1024;

export function isArchivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".jar") || lower.endsWith(".zip");
}
