import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  GAME_LAN_PORT_EVENT,
  attachLanTunnel,
  detectGameLanPort,
  getGameLanPort,
  queryLanWorld,
  setHostLanPort,
  startGuestBridge,
  stopBridge,
  type LanBridgeStatus,
  type LanWorldInfo,
} from "../../api/lanBridge";
import type { Room } from "../../api/rooms";
import type { RoomPeerSession } from "../../api/webrtc/session";
import type { PeerLinkState } from "../../api/webrtc/signaling";

const TICK_MS = 2_000;
const WORLD_POLL_MS = 4_000;
const PORT_DETECT_MS = 4_000;
const WORLD_MISSES_BEFORE_UNREACHABLE = 3;
const HOST_STATE_WAIT_MS = 6_000;
const OUTDATED_PEER_CHECK_MS = 5_000;
const MAX_SHARED_PLAYERS = 20;

export type RoomWorld = LanWorldInfo & {
  port: number;
  reachable: boolean;
};

export type HostStateStatus = "pending" | "known" | "missing";

type HostState = {
  world: RoomWorld | null;
  pings: Record<string, number>;
};

type LanTunnelEntry = {
  session: RoomPeerSession;
  cancelled: boolean;
  dispose: (() => void) | null;
  ready: Promise<void>;
};

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseHostState(raw: string | null): HostState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { world?: unknown; pings?: unknown };
    const pings: Record<string, number> = {};
    if (parsed.pings && typeof parsed.pings === "object") {
      for (const [id, ms] of Object.entries(parsed.pings)) {
        const value = asCount(ms);
        if (value != null) pings[id] = value;
      }
    }
    const w = parsed.world as Record<string, unknown> | null | undefined;
    const port = w ? asCount(w.port) : null;
    const world: RoomWorld | null =
      w && port != null
        ? {
            port,
            reachable: w.reachable !== false,
            motd: asText(w.motd),
            version: asText(w.version),
            playersOnline: asCount(w.playersOnline),
            playersMax: asCount(w.playersMax),
            players: Array.isArray(w.players)
              ? w.players.filter((n): n is string => typeof n === "string").slice(0, MAX_SHARED_PLAYERS)
              : [],
          }
        : null;
    return { world, pings };
  } catch {
    return null;
  }
}

function sameNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function useRoomWorld({
  room,
  userId,
  sessions,
  peerLinks,
  expectedPeerIds,
  gameRunning,
  onPeerOutdated,
}: {
  room: Room | null;
  userId: string;
  sessions: Record<string, RoomPeerSession>;
  peerLinks: Record<string, PeerLinkState>;
  expectedPeerIds: string[];
  gameRunning: boolean;
  onPeerOutdated: () => void;
}) {
  const roomId = room?.id ?? null;
  const hostId = room?.owner_user_id ?? null;
  const isHost = Boolean(room) && hostId === userId;

  const [gameLanPort, setGameLanPort] = useState<number | null>(null);
  const [manualLanPort, setManualLanPort] = useState<number | null>(null);
  const [worldInfo, setWorldInfo] = useState<LanWorldInfo | null>(null);
  const [worldReachable, setWorldReachable] = useState(true);
  const [peerPings, setPeerPings] = useState<Record<string, number>>({});
  const [hostStateRaw, setHostStateRaw] = useState<string | null>(null);
  const [hostStateExpired, setHostStateExpired] = useState(false);
  const [guestBridgePort, setGuestBridgePort] = useState<number | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const onPeerOutdatedRef = useRef(onPeerOutdated);
  onPeerOutdatedRef.current = onPeerOutdated;

  const tunnelsByPeerRef = useRef<Map<string, LanTunnelEntry>>(new Map());
  const tunnelChainByPeerRef = useRef<Map<string, Promise<void>>>(new Map());
  const warnedOutdatedPeersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void getGameLanPort()
      .then((port) => {
        if (active) setGameLanPort(port);
      })
      .catch(() => {});
    const unlisten = listen<number | null>(GAME_LAN_PORT_EVENT, (ev) => setGameLanPort(ev.payload));
    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  const disposeTunnel = useCallback((peerUserId: string) => {
    const entry = tunnelsByPeerRef.current.get(peerUserId);
    if (!entry) return;
    tunnelsByPeerRef.current.delete(peerUserId);
    entry.cancelled = true;
    entry.dispose?.();
  }, []);

  const onBridgeStatus = useCallback((status: LanBridgeStatus) => {
    if (status.state === "refused" || status.state === "error") {
      console.warn("[Rooms] lan bridge", status.state, status.detail);
    }
  }, []);

  const attachTunnel = useCallback(
    (peerUserId: string, session: RoomPeerSession): LanTunnelEntry => {
      const entry: LanTunnelEntry = {
        session,
        cancelled: false,
        dispose: null,
        ready: Promise.resolve(),
      };
      tunnelsByPeerRef.current.set(peerUserId, entry);
      const previous = tunnelChainByPeerRef.current.get(peerUserId) ?? Promise.resolve();
      entry.ready = previous
        .then(async () => {
          if (entry.cancelled) return;
          const dispose = await attachLanTunnel({
            sessionId: peerUserId,
            sendBinary: (data) => session.sendBinary(data),
            canSend: () => session.canSendBinary,
            onRemoteBinary: (handler) => session.onRemoteBinary(handler),
            onStatus: onBridgeStatus,
          });
          if (entry.cancelled) dispose();
          else entry.dispose = dispose;
        })
        .catch((err) => {
          console.warn("[Rooms] lan tunnel attach failed", err);
          if (tunnelsByPeerRef.current.get(peerUserId) === entry) {
            tunnelsByPeerRef.current.delete(peerUserId);
          }
        });
      tunnelChainByPeerRef.current.set(peerUserId, entry.ready);
      return entry;
    },
    [onBridgeStatus],
  );

  useEffect(() => {
    const wanted = new Map<string, RoomPeerSession>();
    for (const peerId of expectedPeerIds) {
      const session = sessions[peerId];
      if (session && peerLinks[peerId]?.channelOpen) wanted.set(peerId, session);
    }
    for (const [peerId, entry] of [...tunnelsByPeerRef.current]) {
      if (wanted.get(peerId) !== entry.session) disposeTunnel(peerId);
    }
    for (const [peerId, session] of wanted) {
      if (tunnelsByPeerRef.current.has(peerId)) continue;
      attachTunnel(peerId, session);
      if (warnedOutdatedPeersRef.current.has(peerId)) continue;
      window.setTimeout(() => {
        if (!session.channelOpen || session.supportsLanTunnel) return;
        if (warnedOutdatedPeersRef.current.has(peerId)) return;
        warnedOutdatedPeersRef.current.add(peerId);
        onPeerOutdatedRef.current();
      }, OUTDATED_PEER_CHECK_MS);
    }
  }, [attachTunnel, disposeTunnel, expectedPeerIds, peerLinks, sessions]);

  useEffect(() => {
    return () => {
      for (const peerId of [...tunnelsByPeerRef.current.keys()]) disposeTunnel(peerId);
      tunnelChainByPeerRef.current.clear();
      warnedOutdatedPeersRef.current.clear();
      setGuestBridgePort(null);
      void stopBridge().catch(() => {});
    };
  }, [roomId, disposeTunnel]);

  useEffect(() => {
    setManualLanPort(null);
  }, [roomId]);

  const hostLanPort = manualLanPort ?? gameLanPort;
  const sharedPort = isHost ? hostLanPort : null;

  useEffect(() => {
    void setHostLanPort(sharedPort).catch(() => {});
  }, [sharedPort]);

  useEffect(() => {
    return () => {
      void setHostLanPort(null).catch(() => {});
    };
  }, []);

  const needsPortDetection =
    isHost && gameRunning && manualLanPort == null && (gameLanPort == null || !worldReachable);

  useEffect(() => {
    if (!needsPortDetection) return;
    let cancelled = false;
    let timer: number | null = null;
    const detect = async () => {
      const port = await detectGameLanPort().catch(() => undefined);
      if (cancelled) return;
      if (port !== undefined) setGameLanPort(port);
      timer = window.setTimeout(() => void detect(), PORT_DETECT_MS);
    };
    void detect();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [needsPortDetection]);

  const applyManualLanPort = useCallback(async (port: number | null): Promise<boolean> => {
    setManualLanPort(port);
    if (port == null) return true;
    const info = await queryLanWorld(port).catch(() => null);
    return info != null;
  }, []);

  useEffect(() => {
    setWorldInfo(null);
    setWorldReachable(true);
    if (!isHost || hostLanPort == null) return;
    const port = hostLanPort;
    let cancelled = false;
    let misses = 0;
    let timer: number | null = null;
    const poll = async () => {
      const info = await queryLanWorld(port).catch(() => null);
      if (cancelled) return;
      if (info) {
        misses = 0;
        setWorldInfo(info);
        setWorldReachable(true);
      } else {
        misses += 1;
        if (misses >= WORLD_MISSES_BEFORE_UNREACHABLE) {
          setWorldInfo(null);
          setWorldReachable(false);
        }
      }
      timer = window.setTimeout(() => void poll(), WORLD_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [hostLanPort, isHost]);

  const ownWorld = useMemo<RoomWorld | null>(() => {
    if (!isHost || hostLanPort == null) return null;
    return {
      port: hostLanPort,
      reachable: worldReachable,
      motd: worldInfo?.motd ?? null,
      version: worldInfo?.version ?? null,
      playersOnline: worldInfo?.playersOnline ?? null,
      playersMax: worldInfo?.playersMax ?? null,
      players: worldInfo?.players ?? [],
    };
  }, [hostLanPort, isHost, worldInfo, worldReachable]);

  const ownWorldRef = useRef(ownWorld);
  ownWorldRef.current = ownWorld;

  useEffect(() => {
    setPeerPings({});
    if (!roomId) return;
    const tick = () => {
      const open = Object.entries(sessionsRef.current);
      const next: Record<string, number> = {};
      for (const [peerId, session] of open) {
        session.probeRtt();
        const rtt = session.rttMs;
        if (rtt != null) next[peerId] = Math.round(rtt);
      }
      setPeerPings((prev) => (sameNumbers(prev, next) ? prev : next));
      if (isHost) {
        const state = JSON.stringify({ world: ownWorldRef.current, pings: next });
        for (const [, session] of open) session.sendRoomState(state);
      }
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isHost, roomId]);

  const hostSession = !isHost && hostId ? sessions[hostId] ?? null : null;
  const hostChannelOpen = !isHost && hostId ? peerLinks[hostId]?.channelOpen === true : false;

  useEffect(() => {
    setHostStateRaw(null);
    if (!hostSession) return;
    return hostSession.onRoomState(setHostStateRaw);
  }, [hostSession]);

  useEffect(() => {
    setHostStateExpired(false);
    if (!hostChannelOpen) return;
    const timer = window.setTimeout(() => setHostStateExpired(true), HOST_STATE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [hostChannelOpen, hostSession]);

  const hostState = useMemo(() => parseHostState(hostStateRaw), [hostStateRaw]);

  const ensureGuestBridge = useCallback(async (): Promise<number> => {
    if (!hostId) throw new Error("room host is unknown");
    const session = sessionsRef.current[hostId];
    if (!session) throw new Error("host session is not connected");
    const tunnel = tunnelsByPeerRef.current.get(hostId) ?? attachTunnel(hostId, session);
    await tunnel.ready;
    const port = await startGuestBridge(hostId);
    setGuestBridgePort(port);
    return port;
  }, [attachTunnel, hostId]);

  useEffect(() => {
    if (!hostChannelOpen) return;
    void ensureGuestBridge().catch((err) => {
      console.warn("[Rooms] guest bridge failed", err);
    });
  }, [ensureGuestBridge, hostChannelOpen, hostSession]);

  const hostPing = hostId ? peerPings[hostId] ?? null : null;

  const memberPings = useMemo<Record<string, number>>(() => {
    if (isHost || !hostId) return peerPings;
    const pings = { ...hostState?.pings };
    if (hostPing != null) {
      pings[hostId] = hostPing;
      pings[userId] = hostPing;
    }
    return pings;
  }, [hostId, hostPing, hostState, isHost, peerPings, userId]);

  const peerPingValues = Object.values(peerPings);
  const ownPing = isHost
    ? peerPingValues.length > 0
      ? Math.max(...peerPingValues)
      : null
    : hostPing;

  const hostStateStatus: HostStateStatus = isHost || hostState
    ? "known"
    : hostStateExpired
      ? "missing"
      : "pending";

  return {
    gameLanPort: hostLanPort,
    manualLanPort,
    applyManualLanPort,
    world: isHost ? ownWorld : hostState?.world ?? null,
    hostStateStatus,
    memberPings,
    ownPing,
    guestBridgePort,
    ensureGuestBridge,
  };
}
