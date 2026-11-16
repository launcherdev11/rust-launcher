import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RoomPeerSession } from "../../api/webrtc/session";
import {
  createMessageReader,
  RELAY_BUDGET_BYTES,
  RELAY_MAX_FILE_BYTES,
  sendMessage,
  waitForSendBuffer,
  type FilesMessage,
  type SyncManifest,
} from "./protocol";
import { readRoomShareSettings } from "./shareSettings";

const READ_CHUNK_BYTES = 64 * 1024;

type HostContext = { profileId: string | null; forceShare: boolean };

function serveSession(session: RoomPeerSession, getContext: () => HostContext): () => void {
  let disposed = false;
  let queue = Promise.resolve();
  let shared = new Map<string, number>();
  let sharedProfileId: string | null = null;
  let sharedWithConfigs = false;
  let relayedBytes = 0;

  const sendFile = async (path: string) => {
    const size = shared.get(path);
    const profileId = sharedProfileId;
    if (size == null || !profileId) {
      sendMessage(session, { t: "file_denied", path, reason: "not_shared" });
      return;
    }
    if (await session.isRelayed()) {
      if (size > RELAY_MAX_FILE_BYTES || relayedBytes + size > RELAY_BUDGET_BYTES) {
        sendMessage(session, { t: "file_denied", path, reason: "relay" });
        return;
      }
      relayedBytes += size;
    }
    sendMessage(session, { t: "file_begin", path, size });
    try {
      let offset = 0;
      while (offset < size && !disposed) {
        const chunk = await invoke<ArrayBuffer>("room_sync_read_file", {
          profileId,
          path,
          offset,
          length: READ_CHUNK_BYTES,
          includeConfigs: sharedWithConfigs,
        });
        if (chunk.byteLength === 0) throw new Error("file changed");
        await waitForSendBuffer(session);
        if (!session.sendFiles(chunk)) throw new Error("channel closed");
        offset += chunk.byteLength;
      }
      sendMessage(session, { t: "file_end", path });
    } catch (e) {
      console.warn("[room-sync] send failed", path, e);
      sendMessage(session, { t: "file_denied", path, reason: "failed" });
    }
  };

  const handle = async (message: FilesMessage) => {
    if (disposed) return;
    if (message.t === "manifest_req") {
      const settings = readRoomShareSettings();
      const { profileId, forceShare } = getContext();
      if (!settings.enabled && !forceShare) {
        sendMessage(session, { t: "manifest", error: "disabled" });
        return;
      }
      if (!profileId) {
        sendMessage(session, { t: "manifest", error: "no_profile" });
        return;
      }
      try {
        const manifest = await invoke<SyncManifest>("room_sync_manifest", {
          profileId,
          includeConfigs: settings.configs,
        });
        shared = new Map(manifest.files.map((file) => [file.path, file.size]));
        sharedProfileId = profileId;
        sharedWithConfigs = settings.configs;
        sendMessage(session, { t: "manifest", manifest });
      } catch (e) {
        console.warn("[room-sync] manifest failed", e);
        sendMessage(session, { t: "manifest", error: "failed" });
      }
    } else if (message.t === "file_req" && typeof message.path === "string") {
      await sendFile(message.path);
    }
  };

  const unsubscribe = session.onFiles(
    createMessageReader(
      (message) => {
        queue = queue.then(() => handle(message)).catch(() => {});
      },
      () => {},
    ),
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}

export function useRoomSyncHost({
  isOwner,
  sessions,
  profileId,
  forceShare = false,
}: {
  isOwner: boolean;
  sessions: Record<string, RoomPeerSession>;
  profileId: string | null;
  forceShare?: boolean;
}) {
  const contextRef = useRef<HostContext>({ profileId, forceShare });
  contextRef.current = { profileId, forceShare };
  const servedRef = useRef(new Map<RoomPeerSession, () => void>());

  useEffect(() => {
    const served = servedRef.current;
    const active = new Set(isOwner ? Object.values(sessions) : []);
    for (const [session, dispose] of served) {
      if (!active.has(session)) {
        dispose();
        served.delete(session);
      }
    }
    for (const session of active) {
      if (!served.has(session)) served.set(session, serveSession(session, () => contextRef.current));
    }
  }, [isOwner, sessions]);

  useEffect(
    () => () => {
      for (const dispose of servedRef.current.values()) dispose();
      servedRef.current.clear();
    },
    [],
  );
}
