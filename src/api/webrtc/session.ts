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
};

async function buildIceServers(): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [];
  try {
    const turn = await fetchTurnCredentials();
    servers.push({
      urls: turn.urls,
      username: turn.username,
      credential: turn.password,
    });
  } catch {
  }

  try {
    const ice = await fetchIceServers();
    for (const s of ice.ice_servers) {
      const isTurn = s.urls.some((u) => u.startsWith("turn:"));
      if (
        isTurn &&
        servers.some((x) =>
          Array.isArray(x.urls)
            ? (x.urls as string[]).some((u) => u.startsWith("turn:"))
            : String(x.urls).startsWith("turn:"),
        )
      ) {
        continue;
      }
      servers.push({
        urls: s.urls,
        username: s.username ?? undefined,
        credential: s.credential ?? undefined,
      });
    }
  } catch {
    servers.push({ urls: "stun:stun.l.google.com:19302" });
  }

  return servers;
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
  private readonly callbacks: PeerSessionCallbacks;
  private closed = false;
  private remoteBinaryHandlers = new Set<(data: ArrayBuffer) => void>();
  private pendingRemoteOffer: string | null = null;
  private pendingRemoteIce: IceCandidateDto[] = [];

  constructor(opts: {
    roomId: string;
    localUserId: string;
    remoteUserId: string;
    isHost: boolean;
    callbacks: PeerSessionCallbacks;
  }) {
    this.roomId = opts.roomId;
    this.localUserId = opts.localUserId;
    this.remoteUserId = opts.remoteUserId;
    this.isHost = opts.isHost;
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
    const iceServers = await buildIceServers();
    if (this.closed) return;
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
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
    if (this.pc.remoteDescription) return "restart";
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
    if (!this.channel || this.channel.readyState !== "open") return false;
    try {
      this.channel.send("tunnel:open");
      return true;
    } catch {
      return false;
    }
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
