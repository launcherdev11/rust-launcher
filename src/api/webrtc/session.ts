import type { ConnectionType, IceCandidateDto } from "../ws";
import { fetchIceServers, fetchTurnCredentials } from "../rtc";

export type PeerSessionStatus =
  | "idle"
  | "preparing"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export type PeerSessionCallbacks = {
  onLocalIce: (candidate: IceCandidateDto) => void;
  onLocalOffer: (sdp: string) => void;
  onLocalAnswer: (sdp: string) => void;
  onStatus: (status: PeerSessionStatus) => void;
  onConnectionType?: (type: ConnectionType) => void;
  onChannelOpen?: () => void;
  onTunnelOpen?: () => void;
  onTunnelReady?: () => void;
};

function urlList(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls];
}

function hasTurnUrl(urls: string | string[]): boolean {
  return urlList(urls).some((u) => u.startsWith("turn:") || u.startsWith("turns:"));
}

function expandTurnTransports(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const raw of urls) {
    add(raw);
    if (!raw.startsWith("turn:") && !raw.startsWith("turns:")) continue;
    if (/[?&]transport=/i.test(raw)) continue;
    const join = raw.includes("?") ? "&" : "?";
    add(`${raw}${join}transport=udp`);
    add(`${raw}${join}transport=tcp`);
  }
  return out;
}

function hasStunUrl(urls: string | string[]): boolean {
  return urlList(urls).some((u) => u.startsWith("stun:"));
}

const ICE_CACHE_MS = 60_000;
let iceCache: { servers: RTCIceServer[]; turnOk: boolean; at: number } | null = null;

export function lastTurnAvailable(): boolean {
  return iceCache?.turnOk === true;
}

async function buildIceServers(): Promise<{ servers: RTCIceServer[]; turnOk: boolean }> {
  if (iceCache && Date.now() - iceCache.at < ICE_CACHE_MS) {
    return iceCache;
  }

  const servers: RTCIceServer[] = [];
  let turnOk = false;

  try {
    const turn = await fetchTurnCredentials();
    if (turn.urls?.length) {
      servers.push({
        urls: expandTurnTransports(turn.urls),
        username: turn.username,
        credential: turn.password,
      });
      turnOk = hasTurnUrl(turn.urls);
    }
  } catch (err) {
    console.warn("[webrtc] GET /network/turn failed", err);
  }

  try {
    const ice = await fetchIceServers();
    for (const s of ice.ice_servers) {
      if (turnOk && hasTurnUrl(s.urls)) continue;
      servers.push({
        urls: s.urls,
        username: s.username ?? undefined,
        credential: s.credential ?? undefined,
      });
      if (!turnOk && hasTurnUrl(s.urls) && s.credential) turnOk = true;
    }
  } catch (err) {
    console.warn("[webrtc] GET /rtc/ice-servers failed", err);
  }

  if (servers.length === 0) {
    servers.push(
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    );
  } else if (!servers.some((s) => hasStunUrl(s.urls))) {
    servers.unshift({ urls: "stun:stun.l.google.com:19302" });
  }

  if (!turnOk) {
    console.warn(
      "[webrtc] TURN credentials unavailable — CGNAT/symmetric NAT will stay on connecting (set TURN_HOST + start coturn)",
    );
  } else {
    console.info("[webrtc] TURN ready", {
      urls: servers.flatMap((s) => urlList(s.urls)).filter((u) => hasTurnUrl(u)),
    });
  }

  if (turnOk) {
    iceCache = { servers, turnOk, at: Date.now() };
  }
  return { servers, turnOk };
}

async function detectConnectionType(pc: RTCPeerConnection): Promise<ConnectionType> {
  try {
    const stats = await pc.getStats();
    let selectedPairId: string | null = null;
    const pairs = new Map<string, RTCStats>();
    const locals = new Map<string, RTCStats>();

    stats.forEach((report) => {
      if (report.type === "transport") {
        const t = report as RTCStats & { selectedCandidatePairId?: string };
        if (t.selectedCandidatePairId) selectedPairId = t.selectedCandidatePairId;
      }
      if (report.type === "candidate-pair") pairs.set(report.id, report);
      if (report.type === "local-candidate") locals.set(report.id, report);
    });

    const pair = selectedPairId
      ? pairs.get(selectedPairId)
      : [...pairs.values()].find((p) => (p as { state?: string }).state === "succeeded");

    if (pair) {
      const localId = (pair as { localCandidateId?: string }).localCandidateId;
      const local = localId ? locals.get(localId) : undefined;
      const candidateType = (local as { candidateType?: string } | undefined)?.candidateType;
      if (candidateType === "relay") return "relay";
    }
  } catch {
  }
  return "direct";
}

export class RoomPeerSession {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private readonly roomId: string;
  private readonly localUserId: string;
  private readonly remoteUserId: string;
  private readonly isHost: boolean;
  private readonly iceTransportPolicy: RTCIceTransportPolicy;
  private readonly callbacks: PeerSessionCallbacks;
  private closed = false;
  private remoteBinaryHandlers = new Set<(data: ArrayBuffer) => void>();
  private pendingRemoteOffer: string | null = null;
  private pendingRemoteIce: IceCandidateDto[] = [];
  private tunnelReadyWaiters: Array<() => void> = [];
  private tunnelReady = false;

  constructor(opts: {
    roomId: string;
    localUserId: string;
    remoteUserId: string;
    isHost: boolean;
    iceTransportPolicy?: RTCIceTransportPolicy;
    callbacks: PeerSessionCallbacks;
  }) {
    this.roomId = opts.roomId;
    this.localUserId = opts.localUserId;
    this.remoteUserId = opts.remoteUserId;
    this.isHost = opts.isHost;
    this.iceTransportPolicy = opts.iceTransportPolicy ?? "all";
    this.callbacks = opts.callbacks;
  }

  get peerId(): string {
    return this.remoteUserId;
  }

  get room(): string {
    return this.roomId;
  }

  get channelOpen(): boolean {
    return this.channel?.readyState === "open";
  }

  async start(): Promise<void> {
    if (this.closed) return;
    this.callbacks.onStatus("preparing");
    const { servers: iceServers, turnOk } = await buildIceServers();
    if (this.closed) return;
    const policy =
      this.iceTransportPolicy === "relay" && turnOk ? "relay" : "all";
    if (this.iceTransportPolicy === "relay" && !turnOk) {
      console.warn("[webrtc] relay requested but TURN is unavailable");
    }
    console.info("[webrtc] start", {
      peer: this.remoteUserId,
      iceTransportPolicy: policy,
      turn: turnOk,
    });
    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: policy,
      iceCandidatePoolSize: turnOk ? 2 : 0,
    });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        console.info("[webrtc] ice gathering complete", { peer: this.remoteUserId });
        return;
      }
      const typ = ev.candidate.type;
      if (typ === "relay") {
        console.info("[webrtc] relay candidate", { peer: this.remoteUserId, protocol: ev.candidate.protocol });
      }
      this.callbacks.onLocalIce({
        candidate: ev.candidate.candidate,
        sdp_mid: ev.candidate.sdpMid,
        sdp_m_line_index:
          ev.candidate.sdpMLineIndex == null ? null : ev.candidate.sdpMLineIndex,
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        this.callbacks.onStatus("connected");
        void detectConnectionType(pc).then((t) => this.callbacks.onConnectionType?.(t));
      } else if (state === "failed") {
        this.callbacks.onStatus("failed");
      } else if (state === "connecting") {
        this.callbacks.onStatus("connecting");
      } else if (state === "closed") {
        if (!this.closed) this.callbacks.onStatus("closed");
      } else if (state === "disconnected") {
        this.callbacks.onStatus("connecting");
      }
    };

    if (this.isHost) {
      this.channel = pc.createDataChannel("mc16", { ordered: true });
      this.wireChannel(this.channel);
      await this.createAndSendOffer();
    } else {
      pc.ondatachannel = (ev) => {
        this.channel = ev.channel;
        this.wireChannel(this.channel);
      };
      if (this.pendingRemoteOffer) {
        const pendingOffer = this.pendingRemoteOffer;
        this.pendingRemoteOffer = null;
        await this.handleRemoteOffer(pendingOffer);
      }
    }

    if (this.pendingRemoteIce.length > 0) {
      const pendingIce = [...this.pendingRemoteIce];
      this.pendingRemoteIce = [];
      for (const candidate of pendingIce) {
        await this.handleRemoteIce(candidate);
      }
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.pc || this.closed || !this.isHost) return;
    const offer = await this.pc.createOffer();
    if (this.closed || !this.pc) return;
    await this.pc.setLocalDescription(offer);
    if (offer.sdp) this.callbacks.onLocalOffer(offer.sdp);
    this.callbacks.onStatus("connecting");
  }

  async renegotiateOffer(): Promise<"resent" | "restart" | "noop"> {
    if (!this.isHost || this.closed || !this.pc) return "noop";
    if (this.channel?.readyState === "open") return "noop";

    const conn = this.pc.connectionState;
    if (conn === "connecting" || conn === "connected") return "noop";
    if (this.pc.remoteDescription) {
      if (conn === "failed" || conn === "disconnected" || conn === "closed") {
        return "restart";
      }
      return "noop";
    }

    try {
      await this.createAndSendOffer();
      return "resent";
    } catch {
      return "restart";
    }
  }

  private wireChannel(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      try {
        channel.send(`ping:${this.localUserId}`);
      } catch {
      }
      this.callbacks.onChannelOpen?.();
    };
    channel.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data === "tunnel:open") {
          this.callbacks.onTunnelOpen?.();
        } else if (ev.data === "tunnel:ready") {
          this.tunnelReady = true;
          const waiters = this.tunnelReadyWaiters.splice(0);
          for (const w of waiters) w();
          this.callbacks.onTunnelReady?.();
        }
        return;
      }
      if (ev.data instanceof ArrayBuffer) {
        for (const h of this.remoteBinaryHandlers) h(ev.data);
      } else if (ArrayBuffer.isView(ev.data)) {
        const view = ev.data as ArrayBufferView;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        for (const h of this.remoteBinaryHandlers) h(copy.buffer as ArrayBuffer);
      }
    };
  }

  signalTunnelOpen(): boolean {
    this.tunnelReady = false;
    if (!this.channel || this.channel.readyState !== "open") return false;
    try {
      this.channel.send("tunnel:open");
      return true;
    } catch {
      return false;
    }
  }

  signalTunnelReady(): boolean {
    if (!this.channel || this.channel.readyState !== "open") return false;
    try {
      this.channel.send("tunnel:ready");
      return true;
    } catch {
      return false;
    }
  }

  waitForTunnelReady(timeoutMs = 20_000): Promise<void> {
    if (this.tunnelReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.tunnelReadyWaiters.indexOf(onReady);
        if (idx >= 0) this.tunnelReadyWaiters.splice(idx, 1);
        reject(new Error("tunnel:ready timeout"));
      }, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.tunnelReadyWaiters.push(onReady);
    });
  }

  static readonly BUFFERED_AMOUNT_HIGH = 2 * 1024 * 1024;

  get bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? Number.MAX_SAFE_INTEGER;
  }

  get canSendBinary(): boolean {
    return (
      !!this.channel &&
      this.channel.readyState === "open" &&
      this.channel.bufferedAmount < RoomPeerSession.BUFFERED_AMOUNT_HIGH
    );
  }

  sendBinary(data: ArrayBuffer): boolean {
    if (!this.canSendBinary || !this.channel) return false;
    try {
      this.channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  onRemoteBinary(handler: (data: ArrayBuffer) => void): () => void {
    this.remoteBinaryHandlers.add(handler);
    return () => {
      this.remoteBinaryHandlers.delete(handler);
    };
  }

  private async drainPendingIce(): Promise<void> {
    if (!this.pc?.remoteDescription) return;
    const pending = this.pendingRemoteIce.splice(0);
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdp_mid ?? undefined,
          sdpMLineIndex: candidate.sdp_m_line_index ?? undefined,
        });
      } catch {
      }
    }
  }

  async handleRemoteOffer(sdp: string): Promise<void> {
    if (this.isHost) return;
    if (!this.pc) {
      this.pendingRemoteOffer = sdp;
      return;
    }
    if (this.channel?.readyState === "open") return;
    try {
      await this.pc.setRemoteDescription({ type: "offer", sdp });
      await this.drainPendingIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (answer.sdp) this.callbacks.onLocalAnswer(answer.sdp);
      this.callbacks.onStatus("connecting");
    } catch {
      this.callbacks.onStatus("failed");
    }
  }

  async handleRemoteAnswer(sdp: string): Promise<void> {
    if (!this.pc || !this.isHost) return;
    if (this.channel?.readyState === "open") return;
    try {
      if (this.pc.signalingState !== "have-local-offer") return;
      await this.pc.setRemoteDescription({ type: "answer", sdp });
      await this.drainPendingIce();
    } catch {
      this.callbacks.onStatus("failed");
    }
  }

  async handleRemoteIce(candidate: IceCandidateDto): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingRemoteIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdp_mid ?? undefined,
        sdpMLineIndex: candidate.sdp_m_line_index ?? undefined,
      });
    } catch {
    }
  }

  close(): void {
    this.closed = true;
    this.remoteBinaryHandlers.clear();
    this.tunnelReady = false;
    this.tunnelReadyWaiters.splice(0);
    try {
      this.channel?.close();
    } catch {
    }
    try {
      this.pc?.close();
    } catch {
    }
    this.pc = null;
    this.channel = null;
    this.callbacks.onStatus("closed");
  }
}
