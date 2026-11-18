import { useMemo, useState, type ReactNode } from "react";
import type { FriendRow } from "../../api/friends";
import type { Room, RoomMember, UpdateRoomInput } from "../../api/rooms";
import type { PeerLinkState } from "../../api/webrtc/signaling";
import { NicknameWithSponsor } from "../../components/SponsorBadge";
import {
  ActionButton,
  ConnectionNotice,
  HoldToConfirmButton,
  Panel,
  TextField,
} from "../../components/ui";
import type { Language, useT } from "../../i18n";
import type { GameStatus } from "../../lib/gameConsoleWindow";
import { formatDurationShort, formatRoomVisibility, getElapsedSeconds } from "../../lib/socialActivity";
import { RoomSettingsPanel } from "./RoomSettingsPanel";
import { isSameMinecraftVersion, shortRoomId, type RoomCurrentGame } from "./roomHelpers";
import { PlayerAvatar, RoomGameTag, StatusBadge, pingToneClass, type AvatarResolver } from "./roomParts";
import type { HostStateStatus, RoomWorld } from "./useRoomWorld";

type WorldStage =
  | "open"
  | "noResponse"
  | "noGame"
  | "waitLan"
  | "connecting"
  | "hostOffline"
  | "hostClosed"
  | "statusUnknown";

type Props = {
  room: Room;
  tt: ReturnType<typeof useT>;
  language: Language;
  userId: string;
  isOwner: boolean;
  nowMs: number;
  sessionStartedAt: string | null;
  loading: boolean;
  busyAction: string | null;
  joinBusy: boolean;
  isLaunching: boolean;
  gameStatus: GameStatus;
  currentGame: RoomCurrentGame | null;
  mcAccountKind: string;
  friends: FriendRow[];
  friendIds: Set<string>;
  avatarSrcFor: AvatarResolver;
  statusLabel: (status: string) => string;
  world: RoomWorld | null;
  hostStateStatus: HostStateStatus;
  ownPing: number | null;
  memberPings: Record<string, number>;
  guestBridgePort: number | null;
  peerLink: PeerLinkState;
  peerLinks: Record<string, PeerLinkState>;
  expectedPeers: number;
  connectedPeers: number;
  offlinePeerIds: string[];
  syncPanel?: ReactNode;
  onBack: () => void;
  onClose: () => void;
  onLeave: () => void;
  onKick: (userId: string) => void;
  onInvite: (nickname: string, onDone: () => void) => void;
  onAddFriend: (member: RoomMember) => void;
  onOpenProfile: (member: RoomMember) => void;
  onCopy: (value: string, message: string) => void;
  onReconnect: () => void;
  onLaunchGame?: () => void;
  onJoinWorld: () => void;
  manualLanPort: number | null;
  onSetManualLanPort: (port: number | null) => void;
  onSaveSettings: (input: UpdateRoomInput) => void;
  onWarning: (message: string) => void;
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="ui-caption">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-white/90">{children}</dd>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="ui-caption">{label}</p>
        <p className="truncate text-sm font-medium text-white/85" title={value}>
          {value}
        </p>
      </div>
      <button type="button" className="icon-btn" aria-label={copyLabel} title={copyLabel} onClick={onCopy}>
        <img src="/launcher-assets/copy.png" alt="" className="h-4 w-4 object-contain opacity-80" />
      </button>
    </div>
  );
}

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

function ManualPortRow({
  tt,
  manualPort,
  onApply,
}: {
  tt: ReturnType<typeof useT>;
  manualPort: number | null;
  onApply: (port: number | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const parsed = parsePort(draft);

  const submit = () => {
    if (parsed == null) return;
    onApply(parsed);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/10 pt-4">
      <label htmlFor="room-manual-port" className="ui-caption">
        {tt("rooms.world.manualPortLabel")}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <TextField
          id="room-manual-port"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="min-w-0 flex-1 basis-40"
          placeholder={manualPort != null ? String(manualPort) : tt("rooms.world.manualPortPlaceholder")}
        />
        <ActionButton size="sm" variant="secondary" disabled={parsed == null} onClick={submit}>
          {tt("rooms.world.manualPortApply")}
        </ActionButton>
        {manualPort != null ? (
          <ActionButton size="sm" variant="ghost" onClick={() => onApply(null)}>
            {tt("rooms.world.manualPortReset")}
          </ActionButton>
        ) : null}
      </div>
      <p className="ui-meta">
        {manualPort != null
          ? tt("rooms.world.manualPortActive", { port: manualPort })
          : tt("rooms.world.manualPortHint")}
      </p>
    </div>
  );
}

export function RoomDetail({
  room,
  tt,
  language,
  userId,
  isOwner,
  nowMs,
  sessionStartedAt,
  loading,
  busyAction,
  joinBusy,
  isLaunching,
  gameStatus,
  currentGame,
  mcAccountKind,
  friends,
  friendIds,
  avatarSrcFor,
  statusLabel,
  world,
  hostStateStatus,
  ownPing,
  memberPings,
  guestBridgePort,
  peerLink,
  peerLinks,
  expectedPeers,
  connectedPeers,
  offlinePeerIds,
  syncPanel,
  onBack,
  onClose,
  onLeave,
  onKick,
  onInvite,
  onAddFriend,
  onOpenProfile,
  onCopy,
  onReconnect,
  onLaunchGame,
  onJoinWorld,
  manualLanPort,
  onSetManualLanPort,
  onSaveSettings,
  onWarning,
}: Props) {
  const [inviteNickname, setInviteNickname] = useState("");

  const members = room.members ?? [];
  const title = room.name?.trim() || shortRoomId(room.id);
  const gameRunning = gameStatus === "running";
  const p2pReady = peerLink.status === "connected" && peerLink.channelOpen;
  const hostOffline = !isOwner && offlinePeerIds.includes(room.owner_user_id);
  const mcAuthOnline = mcAccountKind === "microsoft" || mcAccountKind === "ely";

  const stage: WorldStage = (() => {
    if (isOwner) {
      if (world) return world.reachable ? "open" : "noResponse";
      return gameRunning ? "waitLan" : "noGame";
    }
    if (!p2pReady) return hostOffline ? "hostOffline" : "connecting";
    if (hostStateStatus === "pending") return "connecting";
    if (hostStateStatus === "missing") return "statusUnknown";
    if (world) return world.reachable ? "open" : "noResponse";
    return "hostClosed";
  })();

  const stageText: Record<WorldStage, { title: string; body: string | null }> = {
    open: { title: tt("rooms.world.openTitle"), body: world?.motd ?? null },
    noResponse: {
      title: tt("rooms.world.noResponseTitle"),
      body: tt("rooms.world.noResponseBody"),
    },
    noGame: { title: tt("rooms.world.noGameTitle"), body: tt("rooms.world.noGameBody") },
    waitLan: { title: tt("rooms.world.waitLanTitle"), body: tt("rooms.world.waitLanBody") },
    connecting: { title: tt("rooms.world.connectingTitle"), body: tt("rooms.world.connectingBody") },
    hostOffline: { title: tt("rooms.world.hostOfflineTitle"), body: tt("rooms.world.hostOfflineBody") },
    hostClosed: { title: tt("rooms.world.hostClosedTitle"), body: tt("rooms.world.hostClosedBody") },
    statusUnknown: { title: tt("rooms.world.statusUnknownTitle"), body: tt("rooms.world.statusUnknownBody") },
  };

  const stageDotClass =
    stage === "open"
      ? "bg-emerald-400"
      : stage === "noResponse" || stage === "hostOffline"
        ? "bg-warn-hi"
        : "bg-white/30";

  const linkLabel = (() => {
    if (room.member_count < 2) return tt("rooms.p2pWaiting");
    if (expectedPeers === 0 && offlinePeerIds.length > 0) return tt("rooms.p2pPeerOffline");
    if (expectedPeers === 0) return tt("rooms.p2pWaiting");
    const counter = expectedPeers > 1 ? ` (${connectedPeers}/${expectedPeers})` : "";
    if (p2pReady) {
      const kind =
        peerLink.connectionType === "relay"
          ? tt("rooms.linkRelay")
          : peerLink.connectionType === "direct"
            ? tt("rooms.linkDirect")
            : tt("rooms.p2pReady");
      return `${kind}${counter}`;
    }
    if (peerLink.status === "failed" || peerLink.status === "closed") {
      return `${tt("rooms.p2pReconnecting")}${counter}`;
    }
    return `${tt("rooms.p2pConnecting")}${counter}`;
  })();

  const canReconnect = room.member_count >= 2 && expectedPeers > 0 && connectedPeers < expectedPeers;
  const canJoinWorld = stage === "open" || stage === "noResponse" || stage === "statusUnknown";
  const guestAddress = !isOwner && guestBridgePort != null ? `127.0.0.1:${guestBridgePort}` : null;
  const elapsedSession = getElapsedSeconds(sessionStartedAt, nowMs);

  const versionMismatch =
    !isOwner && world?.version && currentGame && !isSameMinecraftVersion(world.version, currentGame.gameVersion)
      ? { world: world.version, yours: currentGame.gameVersion }
      : null;

  const inviteable = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.user_id));
    return friends.filter((f) => !memberIds.has(f.user_id));
  }, [friends, members]);

  const submitInvite = () => {
    if (!inviteNickname.trim()) return;
    onInvite(inviteNickname, () => setInviteNickname(""));
  };

  const accountLabel =
    mcAccountKind === "microsoft"
      ? tt("rooms.mcOnlineMicrosoft")
      : mcAccountKind === "ely"
        ? tt("rooms.mcOnlineEly")
        : tt("rooms.mcOffline");

  const pingCaption = isOwner ? tt("rooms.pingWorst") : tt("rooms.pingToHost");

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4 py-4">
      <ConnectionNotice language={language} />

      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="icon-btn"
          aria-label={tt("rooms.backToList")}
          title={tt("rooms.backToList")}
          onClick={onBack}
        >
          <img src="/launcher-assets/back.svg" alt="" className="h-4 w-4 opacity-80" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="ui-title truncate">{title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={room.status} label={statusLabel(room.status)} />
            <span className="tag">{isOwner ? tt("rooms.youOwner") : tt("rooms.youMember")}</span>
            <span className="tag">{formatRoomVisibility(room.visibility, tt)}</span>
            <RoomGameTag room={room} unknownLabel={tt("rooms.gameMetaUnknown")} />
          </div>
        </div>
        {isOwner ? (
          <HoldToConfirmButton
            className="btn btn-sm btn-danger"
            holdHint={tt("rooms.closeHoldHint")}
            disabled={loading}
            onConfirm={onClose}
          >
            {tt("rooms.close")}
          </HoldToConfirmButton>
        ) : (
          <ActionButton size="sm" variant="secondary" disabled={loading} onClick={onLeave}>
            {tt("rooms.leave")}
          </ActionButton>
        )}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel padding="lg" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stageDotClass}`} aria-hidden />
                  <h3 className="text-xl font-semibold tracking-tight text-white">{stageText[stage].title}</h3>
                </div>
                {stageText[stage].body ? (
                  <p className="ui-subtitle mt-1.5 max-w-prose">{stageText[stage].body}</p>
                ) : null}
              </div>
              {ownPing != null || room.member_count >= 2 ? (
                <div className="shrink-0 text-right">
                  <p
                    className={`text-3xl font-semibold tabular-nums tracking-tight ${
                      ownPing != null ? pingToneClass(ownPing) : "text-white/30"
                    }`}
                  >
                    {ownPing != null ? tt("rooms.pingValue", { ms: ownPing }) : tt("rooms.pingUnknown")}
                  </p>
                  <p className="ui-caption mt-0.5">{pingCaption}</p>
                </div>
              ) : null}
            </div>

            {versionMismatch ? <p className="locked-hint">{tt("rooms.versionMismatch", versionMismatch)}</p> : null}
            {!mcAuthOnline && !isOwner ? <p className="locked-hint">{tt("rooms.mcOfflineHint")}</p> : null}

            {!isOwner || stage === "noGame" || canReconnect ? (
            <div className="flex flex-wrap items-center gap-2">
              {isOwner && stage === "noGame" ? (
                <ActionButton
                  variant="primary"
                  loading={isLaunching}
                  loadingLabel={tt("rooms.world.launching")}
                  disabled={!currentGame}
                  disabledReason={!currentGame ? tt("rooms.auto.none") : undefined}
                  onClick={() => onLaunchGame?.()}
                >
                  {tt("rooms.world.launch")}
                </ActionButton>
              ) : null}
              {!isOwner ? (
                <ActionButton
                  variant="primary"
                  loading={joinBusy || isLaunching}
                  disabled={!canJoinWorld || !mcAuthOnline}
                  disabledReason={
                    !mcAuthOnline
                      ? tt("rooms.mcOfflineHint")
                      : !canJoinWorld
                        ? tt("rooms.world.joinUnavailable")
                        : undefined
                  }
                  onClick={onJoinWorld}
                >
                  {gameRunning ? tt("rooms.world.joinFromRunningGame") : tt("rooms.joinWorld")}
                </ActionButton>
              ) : null}
              {canReconnect ? (
                <ActionButton size="sm" variant="ghost" disabled={loading} onClick={onReconnect}>
                  {tt("rooms.p2pReconnect")}
                </ActionButton>
              ) : null}
            </div>
            ) : null}

            {stage === "open" && world && world.players.length > 0 ? (
              <p className="ui-meta">{tt("rooms.world.playersNow", { names: world.players.join(", ") })}</p>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 sm:grid-cols-3">
              <Fact label={tt("rooms.factVersion")}>{world?.version ?? room.game_version?.trim() ?? tt("rooms.pingUnknown")}</Fact>
              <Fact label={tt("rooms.factPlayers")}>
                {world?.playersOnline != null && world.playersMax != null
                  ? tt("rooms.players", { count: world.playersOnline, max: world.playersMax })
                  : tt("rooms.pingUnknown")}
              </Fact>
              {isOwner ? (
                <Fact label={tt("rooms.factPort")}>{world?.port ?? tt("rooms.pingUnknown")}</Fact>
              ) : (
                <div className="min-w-0">
                  <dt className="ui-caption">{tt("rooms.factAddress")}</dt>
                  <dd className="mt-0.5 truncate text-sm font-semibold text-white/90">
                    {guestAddress ? (
                      <button
                        type="button"
                        className="truncate text-accent-hi transition-colors hover:text-white"
                        title={tt("rooms.connectAddressHint")}
                        onClick={() => onCopy(guestAddress, tt("rooms.connectAddressCopied"))}
                      >
                        {guestAddress}
                      </button>
                    ) : (
                      tt("rooms.pingUnknown")
                    )}
                  </dd>
                </div>
              )}
              <Fact label={tt("rooms.factLink")}>{linkLabel}</Fact>
              <Fact label={tt("rooms.factSession")}>
                {elapsedSession != null ? formatDurationShort(elapsedSession, tt) : tt("rooms.pingUnknown")}
              </Fact>
              <Fact label={tt("rooms.factAccount")}>
                <span className={mcAuthOnline ? "text-emerald-300" : "text-warn-hi"}>{accountLabel}</span>
              </Fact>
            </dl>

            {isOwner ? (
              <ManualPortRow tt={tt} manualPort={manualLanPort} onApply={onSetManualLanPort} />
            ) : null}
          </Panel>

          {syncPanel}

          {isOwner ? (
            <RoomSettingsPanel
              room={room}
              tt={tt}
              busy={loading}
              saving={busyAction === "update-room"}
              currentGame={currentGame}
              onSave={onSaveSettings}
              onWarning={onWarning}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel padding="md" className="flex flex-col gap-2.5">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-white/85">
              {tt("rooms.membersTitle")}
              <span className="ui-caption">{tt("rooms.players", { count: room.member_count, max: room.max_players })}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {members.map((member) => {
                const ping = memberPings[member.user_id];
                const relayed = peerLinks[member.user_id]?.connectionType === "relay";
                const isSelf = member.user_id === userId;
                return (
                  <li key={member.user_id} className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-white/5">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(member)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      title={tt("friends.viewProfile")}
                    >
                      <PlayerAvatar
                        target={member}
                        avatarSrcFor={avatarSrcFor}
                        className="h-8 w-8 ring-1 ring-white/20"
                      />
                      <span className="min-w-0">
                        <NicknameWithSponsor
                          nickname={member.nickname}
                          isSponsor={member.is_sponsor}
                          sponsorTitle={tt("common.sponsor")}
                          as="span"
                          className="truncate text-sm"
                        />
                        <span className="ui-caption block truncate">
                          {member.role === "owner" ? tt("rooms.role.owner") : tt("rooms.role.member")}
                          {member.online === false ? `, ${tt("rooms.memberOffline")}` : ""}
                        </span>
                      </span>
                    </button>
                    {ping != null ? (
                      <span className="shrink-0 text-right">
                        <span className={`block text-[0.8125rem] font-semibold tabular-nums ${pingToneClass(ping)}`}>
                          {tt("rooms.pingValue", { ms: ping })}
                        </span>
                        {relayed ? <span className="ui-caption block">{tt("rooms.linkRelay")}</span> : null}
                      </span>
                    ) : null}
                    {!isSelf && !friendIds.has(member.user_id) ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={tt("friends.add")}
                        title={tt("friends.add")}
                        disabled={loading}
                        onClick={() => onAddFriend(member)}
                      >
                        <img src="/launcher-assets/add_freind.png" alt="" className="h-4 w-4 object-contain opacity-80" />
                      </button>
                    ) : null}
                    {isOwner && member.role !== "owner" ? (
                      <ActionButton size="sm" variant="ghost" disabled={loading} onClick={() => onKick(member.user_id)}>
                        {tt("rooms.kick")}
                      </ActionButton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {room.member_count < 2 ? <p className="ui-meta">{tt("rooms.waitForPeer")}</p> : null}
          </Panel>

          {isOwner ? (
            <Panel padding="md" className="flex flex-col gap-2.5">
              <h3 className="text-sm font-semibold text-white/85">{tt("rooms.inviteTitle")}</h3>
              {inviteable.length > 0 ? (
                <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                  {inviteable.map((friend) => (
                    <li key={friend.user_id} className="flex items-center justify-between gap-2 rounded-xl px-1.5 py-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <PlayerAvatar
                          target={friend}
                          avatarSrcFor={avatarSrcFor}
                          className="h-6 w-6 ring-1 ring-white/20"
                        />
                        <NicknameWithSponsor
                          nickname={friend.nickname}
                          isSponsor={friend.is_sponsor}
                          sponsorTitle={tt("common.sponsor")}
                          as="span"
                          className="truncate text-sm"
                        />
                      </span>
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        disabled={loading}
                        onClick={() => onInvite(friend.nickname, () => {})}
                      >
                        {tt("rooms.invite")}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-meta">{tt("rooms.inviteEmpty")}</p>
              )}
              <div className="flex gap-1.5">
                <TextField
                  type="text"
                  value={inviteNickname}
                  onChange={(e) => setInviteNickname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitInvite();
                  }}
                  className="min-w-0 flex-1"
                  placeholder={tt("rooms.inviteNicknamePlaceholder")}
                  disabled={loading}
                />
                <ActionButton
                  size="sm"
                  variant="secondary"
                  disabled={loading || !inviteNickname.trim()}
                  onClick={submitInvite}
                >
                  {tt("rooms.invite")}
                </ActionButton>
              </div>
            </Panel>
          ) : null}

          <Panel padding="md" className="flex flex-col gap-2.5">
            <h3 className="text-sm font-semibold text-white/85">{tt("rooms.accessTitle")}</h3>
            {room.name?.trim() ? (
              <CopyRow
                label={tt("rooms.roomNameLabel")}
                value={room.name.trim()}
                copyLabel={tt("rooms.accessCopy")}
                onCopy={() => onCopy(room.name!.trim(), tt("rooms.nameCopied"))}
              />
            ) : null}
            <CopyRow
              label={tt("rooms.accessId")}
              value={room.id}
              copyLabel={tt("rooms.accessCopy")}
              onCopy={() => onCopy(room.id, tt("rooms.idCopied"))}
            />
            {isOwner && room.visibility === "private" && room.join_code?.trim() ? (
              <CopyRow
                label={tt("rooms.passwordLabel")}
                value={room.join_code.trim()}
                copyLabel={tt("rooms.accessCopy")}
                onCopy={() => onCopy(room.join_code!.trim(), tt("rooms.passwordCopied"))}
              />
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
