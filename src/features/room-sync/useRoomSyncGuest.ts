import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RoomPeerSession } from "../../api/webrtc/session";
import {
  createMessageReader,
  isArchivePath,
  RELAY_MAX_FILE_BYTES,
  sendMessage,
  type DenyReason,
  type FilesMessage,
  type ManifestError,
  type SyncFile,
  type SyncFileKind,
  type SyncManifest,
  type SyncOptions,
} from "./protocol";

const MANIFEST_TIMEOUT_MS = 120_000;
const FILE_IDLE_TIMEOUT_MS = 30_000;
const WRITE_BATCH_BYTES = 2 * 1024 * 1024;

export type PlannedFile = SyncFile & { kind: SyncFileKind };

export type SyncPlan = {
  stageId: string;
  hostGameVersion: string;
  hostLoader: string;
  localGameVersion: string;
  localLoader: string;
  versionMismatch: boolean;
  missing: PlannedFile[];
  enable: string[];
  extraMods: string[];
  extraScripts: string[];
  options: SyncOptions | null;
  optionsDiffer: boolean;
  unchanged: number;
  rejected: string[];
};

export type FileIssue = "invalid_archive" | "executable" | "native_code" | "no_mod_metadata";

export type InspectReport = {
  files: { path: string; title?: string | null; issues: FileIssue[]; blocked: boolean }[];
};

export type SyncResult = {
  mods: number;
  packs: number;
  configs: number;
  scripts: number;
  assets: number;
  disabled: number;
  enabled: number;
  removedScripts: number;
  options: boolean;
  backupDir?: string | null;
};

export type SyncStep = "manifest" | "create" | "plan" | "platform" | "transfer" | "inspect" | "apply";

export type ApplyChoices = {
  disableExtras: boolean;
  removeExtraScripts: boolean;
  applyOptions: boolean;
};

export type GuestSyncState =
  | { phase: "idle" }
  | { phase: "working"; step: SyncStep; done?: number; total?: number }
  | { phase: "review"; plan: SyncPlan; relayed: boolean }
  | {
      phase: "confirm";
      plan: SyncPlan;
      report: InspectReport;
      fromPlatforms: string[];
      fromHost: PlannedFile[];
      blockedByRelay: string[];
      failed: string[];
    }
  | { phase: "done"; result: SyncResult; profileId: string }
  | { phase: "error"; error: ManifestError | "no_channel" | "timeout" | "unknown"; detail?: string };

class SyncError extends Error {
  constructor(readonly code: ManifestError | "no_channel" | "timeout" | "unknown", detail?: string) {
    super(detail ?? code);
  }
}

class DeniedError extends Error {
  constructor(readonly reason: DenyReason) {
    super(reason);
  }
}

type ChunkWriter = (bytes: Uint8Array, offset: number) => Promise<void>;

type FileReceiver = {
  path: string;
  size: number;
  received: number;
  pending: Uint8Array[];
  pendingBytes: number;
  written: number;
  writes: Promise<void>;
  writer: ChunkWriter;
  resolve: () => void;
  reject: (error: Error) => void;
  touch: () => void;
};

function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

class HostLink {
  private waiters: { match: (m: FilesMessage) => boolean; resolve: (m: FilesMessage) => void }[] = [];
  private receiver: FileReceiver | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly session: RoomPeerSession) {
    this.unsubscribe = session.onFiles(
      createMessageReader(
        (message) => this.onMessage(message),
        (data) => this.onBinary(data),
      ),
    );
  }

  private flush(receiver: FileReceiver) {
    if (receiver.pendingBytes === 0) return;
    const bytes = concat(receiver.pending, receiver.pendingBytes);
    const offset = receiver.written;
    receiver.written += receiver.pendingBytes;
    receiver.pending = [];
    receiver.pendingBytes = 0;
    receiver.writes = receiver.writes.then(() => receiver.writer(bytes, offset));
    receiver.writes.catch((e) => {
      if (this.receiver === receiver) this.receiver = null;
      receiver.reject(e instanceof Error ? e : new Error(String(e)));
    });
  }

  private onMessage(message: FilesMessage) {
    const receiver = this.receiver;
    if (receiver && "path" in message && message.path === receiver.path) {
      if (message.t === "file_denied") {
        this.receiver = null;
        receiver.reject(new DeniedError(message.reason));
        return;
      }
      if (message.t === "file_end") {
        this.receiver = null;
        if (receiver.received !== receiver.size) {
          receiver.reject(new Error("size mismatch"));
          return;
        }
        this.flush(receiver);
        receiver.writes.then(receiver.resolve, receiver.reject);
        return;
      }
      if (message.t === "file_begin") {
        receiver.touch();
        return;
      }
    }
    const index = this.waiters.findIndex((w) => w.match(message));
    if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(message);
  }

  private onBinary(data: ArrayBuffer) {
    const receiver = this.receiver;
    if (!receiver) return;
    receiver.touch();
    receiver.received += data.byteLength;
    if (receiver.received > receiver.size) {
      this.receiver = null;
      receiver.reject(new Error("size mismatch"));
      return;
    }
    receiver.pending.push(new Uint8Array(data));
    receiver.pendingBytes += data.byteLength;
    if (receiver.pendingBytes >= WRITE_BATCH_BYTES) this.flush(receiver);
  }

  requestManifest(): Promise<SyncManifest> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new SyncError("timeout")), MANIFEST_TIMEOUT_MS);
      this.waiters.push({
        match: (m) => m.t === "manifest",
        resolve: (m) => {
          window.clearTimeout(timer);
          if (m.t !== "manifest") return;
          if (m.manifest && Array.isArray(m.manifest.files)) resolve(m.manifest);
          else reject(new SyncError(m.error ?? "failed"));
        },
      });
      if (!sendMessage(this.session, { t: "manifest_req" })) {
        window.clearTimeout(timer);
        reject(new SyncError("no_channel"));
      }
    });
  }

  fetchFile(
    path: string,
    size: number,
    writer: ChunkWriter,
    onProgress: (received: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer = 0;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        fn();
      };
      const fail = (error: Error) =>
        settle(() => {
          if (this.receiver?.path === path) this.receiver = null;
          reject(error);
        });
      const receiver: FileReceiver = {
        path,
        size,
        received: 0,
        pending: [],
        pendingBytes: 0,
        written: 0,
        writes: Promise.resolve(),
        writer,
        resolve: () => settle(resolve),
        reject: fail,
        touch: () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => fail(new SyncError("timeout")), FILE_IDLE_TIMEOUT_MS);
          onProgress(receiver.received);
        },
      };
      this.receiver = receiver;
      receiver.touch();
      if (!sendMessage(this.session, { t: "file_req", path })) fail(new SyncError("no_channel"));
    });
  }

  dispose() {
    this.unsubscribe();
    this.receiver?.reject(new Error("cancelled"));
    this.receiver = null;
    this.waiters = [];
  }
}

function stageWriter(stageId: string, path: string): ChunkWriter {
  return (bytes, offset) =>
    invoke("room_sync_stage_chunk", bytes, {
      headers: {
        "x-stage-id": stageId,
        "x-path": encodeURIComponent(path),
        "x-offset": String(offset),
      },
    });
}

export function useRoomSyncGuest(session: RoomPeerSession | null, profileId: string | null) {
  const [state, setState] = useState<GuestSyncState>({ phase: "idle" });
  const linkRef = useRef<HostLink | null>(null);
  const stageRef = useRef<string | null>(null);
  const targetProfileRef = useRef<string | null>(profileId);
  const runRef = useRef(0);

  const discardStage = useCallback(() => {
    const stageId = stageRef.current;
    stageRef.current = null;
    if (stageId) void invoke("room_sync_discard", { stageId }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    runRef.current += 1;
    linkRef.current?.dispose();
    linkRef.current = null;
    discardStage();
    setState({ phase: "idle" });
  }, [discardStage]);

  useEffect(() => reset, [session, reset]);

  const fail = (run: number, e: unknown) => {
    if (run !== runRef.current) return;
    console.warn("[room-sync]", e);
    linkRef.current?.dispose();
    linkRef.current = null;
    discardStage();
    if (e instanceof SyncError) setState({ phase: "error", error: e.code });
    else setState({ phase: "error", error: "unknown", detail: e instanceof Error ? e.message : String(e) });
  };

  const start = useCallback(
    async (options?: { profileId?: string; createProfile?: (manifest: SyncManifest) => Promise<string> }) => {
      reset();
      const run = runRef.current;
      const requested = options?.profileId ?? profileId;
      if (!session?.supportsRoomFiles || (!requested && !options?.createProfile)) {
        setState({ phase: "error", error: "no_channel" });
        return;
      }
      const link = new HostLink(session);
      linkRef.current = link;
      try {
        setState({ phase: "working", step: "manifest" });
        const manifest = await link.requestManifest();
        if (run !== runRef.current) return;
        let target = requested;
        if (options?.createProfile) {
          setState({ phase: "working", step: "create" });
          target = await options.createProfile(manifest);
          if (run !== runRef.current) return;
        }
        targetProfileRef.current = target ?? null;
        setState({ phase: "working", step: "plan" });
        const plan = await invoke<SyncPlan>("room_sync_plan", { profileId: target, manifest });
        stageRef.current = plan.stageId;
        const relayed = await session.isRelayed();
        if (run !== runRef.current) return;
        setState({ phase: "review", plan, relayed });
      } catch (e) {
        fail(run, e);
      }
    },
    [session, profileId, reset],
  );

  const download = useCallback(async () => {
    if (state.phase !== "review" || !session || !linkRef.current) return;
    const run = runRef.current;
    const { plan } = state;
    const link = linkRef.current;
    try {
      setState({ phase: "working", step: "platform" });
      const archives = plan.missing.filter((f) => f.kind === "mod" || f.kind === "pack");
      const fromPlatforms = await invoke<string[]>("room_sync_fetch_platform", {
        stageId: plan.stageId,
        files: archives,
      });
      if (run !== runRef.current) return;

      const relayed = await session.isRelayed();
      const fetched = new Set(fromPlatforms);
      const remaining = plan.missing.filter((f) => !fetched.has(f.path));
      const blockedByRelay = relayed
        ? remaining.filter((f) => f.size > RELAY_MAX_FILE_BYTES).map((f) => f.path)
        : [];
      const toTransfer = remaining.filter((f) => !blockedByRelay.includes(f.path));
      const total = toTransfer.reduce((sum, f) => sum + f.size, 0);
      const fromHost: PlannedFile[] = [];
      const failed: string[] = [];
      let done = 0;

      for (const file of toTransfer) {
        if (run !== runRef.current) return;
        setState({ phase: "working", step: "transfer", done, total });
        try {
          await link.fetchFile(file.path, file.size, stageWriter(plan.stageId, file.path), (received) => {
            if (run === runRef.current) {
              setState({ phase: "working", step: "transfer", done: done + received, total });
            }
          });
          await invoke("room_sync_stage_finish", {
            stageId: plan.stageId,
            path: file.path,
            sha1: file.sha1,
            size: file.size,
          });
          fromHost.push(file);
        } catch (e) {
          if (e instanceof DeniedError && e.reason === "relay") blockedByRelay.push(file.path);
          else failed.push(file.path);
        }
        done += file.size;
      }
      if (run !== runRef.current) return;

      setState({ phase: "working", step: "inspect" });
      const report = await invoke<InspectReport>("room_sync_inspect", {
        stageId: plan.stageId,
        paths: fromHost.filter((f) => isArchivePath(f.path)).map((f) => f.path),
      });
      if (run !== runRef.current) return;
      setState({ phase: "confirm", plan, report, fromPlatforms, fromHost, blockedByRelay, failed });
    } catch (e) {
      fail(run, e);
    }
  }, [state, session]);

  const apply = useCallback(
    async (choices: ApplyChoices) => {
      const target = targetProfileRef.current;
      if (state.phase !== "confirm" || !target) return;
      const run = runRef.current;
      const { plan, fromPlatforms, fromHost } = state;
      try {
        setState({ phase: "working", step: "apply" });
        const result = await invoke<SyncResult>("room_sync_apply", {
          request: {
            profileId: target,
            stageId: plan.stageId,
            files: [...fromPlatforms, ...fromHost.map((f) => f.path)],
            disable: choices.disableExtras ? plan.extraMods : [],
            enable: plan.enable,
            removeScripts: choices.removeExtraScripts ? plan.extraScripts : [],
            options: choices.applyOptions && plan.optionsDiffer ? plan.options : null,
          },
        });
        stageRef.current = null;
        linkRef.current?.dispose();
        linkRef.current = null;
        if (run === runRef.current) setState({ phase: "done", result, profileId: target });
      } catch (e) {
        fail(run, e);
      }
    },
    [state],
  );

  return { state, start, download, apply, reset };
}
