import { useState } from "react";
import type { Room } from "../../api/rooms";
import {
  ActionButton,
  ConnectionNotice,
  EmptyState,
  ErrorState,
  RoomCardSkeleton,
  TextField,
} from "../../components/ui";
import type { Language, useT } from "../../i18n";
import { formatDurationShort, formatRoomVisibility, getElapsedSeconds } from "../../lib/socialActivity";
import { shortRoomId } from "./roomHelpers";
import { MemberAvatars, PlayerAvatar, RoomGameTag, StatusBadge, type AvatarResolver } from "./roomParts";

type Props = {
  tt: ReturnType<typeof useT>;
  language: Language;
  userId: string;
  nowMs: number;
  rooms: Room[];
  friendsRooms: Room[];
  activeRoom: Room | null;
  loading: boolean;
  busyAction: string | null;
  loadError: string | null;
  avatarSrcFor: AvatarResolver;
  statusLabel: (status: string) => string;
  onCreate: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onOpenRoom: (room: Room) => void;
  onJoinRoom: (roomId: string) => void;
  onJoinByName: (nameOrId: string, password: string, onDone: () => void) => void;
};

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="flex items-baseline gap-2 text-sm font-semibold text-white/85">
      {title}
      <span className="ui-caption">{count}</span>
    </h3>
  );
}

export function RoomsLobby({
  tt,
  language,
  userId,
  nowMs,
  rooms,
  friendsRooms,
  activeRoom,
  loading,
  busyAction,
  loadError,
  avatarSrcFor,
  statusLabel,
  onCreate,
  onRefresh,
  onRetry,
  onOpenRoom,
  onJoinRoom,
  onJoinByName,
}: Props) {
  const [nameOrId, setNameOrId] = useState("");
  const [password, setPassword] = useState("");

  const canSubmitJoin = Boolean(nameOrId.trim() || password.trim());
  const submitJoin = () => {
    if (!canSubmitJoin) return;
    onJoinByName(nameOrId, password, () => {
      setNameOrId("");
      setPassword("");
    });
  };

  const renderMyRoom = (room: Room) => {
    const isActive = room.id === activeRoom?.id;
    return (
      <button
        key={room.id}
        type="button"
        onClick={() => onOpenRoom(room)}
        className={`interactive-press flex w-full items-center gap-3 rounded-2xl border bg-black/30 px-3.5 py-3 text-left transition-colors hover:bg-black/45 ${
          isActive ? "border-accent-from/50" : "border-white/10 hover:border-white/20"
        }`}
      >
        <MemberAvatars members={room.members ?? []} avatarSrcFor={avatarSrcFor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white/90">
              {room.name?.trim() || shortRoomId(room.id)}
            </p>
            <StatusBadge status={room.status} label={statusLabel(room.status)} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RoomGameTag room={room} />
            <span className="tag">{tt("rooms.players", { count: room.member_count, max: room.max_players })}</span>
            <span className="tag">{formatRoomVisibility(room.visibility, tt)}</span>
            <span className="tag">
              {room.owner_user_id === userId ? tt("rooms.youOwner") : tt("rooms.youMember")}
            </span>
          </div>
        </div>
      </button>
    );
  };

  const renderFriendRoom = (room: Room) => {
    const owner = (room.members ?? []).find((m) => m.user_id === room.owner_user_id);
    const ownerNick = owner?.nickname ?? shortRoomId(room.owner_user_id);
    const elapsed = getElapsedSeconds(room.session_started_at, nowMs);
    const canJoin = room.status === "open";
    const joining = busyAction === `join:${room.id}`;
    return (
      <div
        key={room.id}
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-3.5 py-3"
      >
        <PlayerAvatar
          target={{ nickname: ownerNick, ely_username: owner?.ely_username, mc_uuid: owner?.mc_uuid }}
          avatarSrcFor={avatarSrcFor}
          className="h-9 w-9 ring-1 ring-white/20"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white/90">{room.name?.trim() || ownerNick}</p>
            <StatusBadge status={room.status} label={statusLabel(room.status)} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="tag">{tt("rooms.ownedBy", { nick: ownerNick })}</span>
            <RoomGameTag room={room} />
            <span className="tag">{tt("rooms.players", { count: room.member_count, max: room.max_players })}</span>
            {elapsed != null ? <span className="tag">{formatDurationShort(elapsed, tt)}</span> : null}
          </div>
        </div>
        <ActionButton
          size="sm"
          variant="secondary"
          loading={joining}
          loadingLabel={tt("rooms.joining")}
          disabled={!canJoin || (loading && !joining)}
          disabledReason={!canJoin ? tt("rooms.joinClosedReason") : undefined}
          onClick={() => onJoinRoom(room.id)}
        >
          {tt("rooms.joinFriendRoom")}
        </ActionButton>
      </div>
    );
  };

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5 py-4">
      <ConnectionNotice language={language} />

      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="ui-title">{tt("rooms.title")}</h2>
          <p className="ui-subtitle mt-0.5">{tt("rooms.subtitleSignedIn")}</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label={tt("rooms.refresh")}
          title={tt("rooms.refresh")}
          disabled={loading}
          onClick={onRefresh}
        >
          <img
            src="/launcher-assets/refresh.png"
            alt=""
            className={`h-4 w-4 object-contain opacity-80 ${busyAction === "refresh" ? "animate-spin" : ""}`}
          />
        </button>
        <ActionButton variant="primary" onClick={onCreate}>
          {tt("rooms.create")}
        </ActionButton>
      </header>

      {activeRoom ? (
        <div className="glass-inset flex flex-wrap items-center gap-3 border-accent-from/40 px-4 py-3">
          <MemberAvatars members={activeRoom.members ?? []} avatarSrcFor={avatarSrcFor} />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">
            {tt("rooms.activeRoom", { name: activeRoom.name?.trim() || shortRoomId(activeRoom.id) })}
          </p>
          <ActionButton size="sm" variant="secondary" onClick={() => onOpenRoom(activeRoom)}>
            {tt("rooms.backToRoom")}
          </ActionButton>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextField
            type="text"
            value={nameOrId}
            onChange={(e) => setNameOrId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitJoin();
            }}
            className="flex-1"
            placeholder={tt("rooms.joinIdPlaceholder")}
          />
          <TextField
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitJoin();
            }}
            className="sm:w-52"
            placeholder={tt("rooms.joinPasswordPlaceholder")}
            autoComplete="off"
          />
          <ActionButton
            variant="secondary"
            loading={busyAction === "join"}
            loadingLabel={tt("rooms.joining")}
            disabled={(loading && busyAction !== "join") || !canSubmitJoin}
            onClick={submitJoin}
          >
            {tt("rooms.join")}
          </ActionButton>
        </div>
        <p className="ui-meta">{tt("rooms.joinHint")}</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-2.5">
          <SectionTitle title={tt("rooms.yourRooms")} count={rooms.length} />
          {loading && rooms.length === 0 ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <RoomCardSkeleton />
              <RoomCardSkeleton />
            </div>
          ) : rooms.length === 0 && loadError ? (
            <ErrorState
              compact
              title={tt("common.state.loadFailed")}
              description={tt("common.state.loadFailedHint")}
              details={loadError}
              action={
                <ActionButton size="sm" variant="primary" onClick={onRetry}>
                  {tt("common.state.retry")}
                </ActionButton>
              }
            />
          ) : rooms.length === 0 ? (
            <EmptyState compact title={tt("rooms.emptyTitle")} description={tt("rooms.emptyBody")} />
          ) : (
            <div className="flex flex-col gap-2">{rooms.map(renderMyRoom)}</div>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <SectionTitle title={tt("rooms.friendRoomsTitle")} count={friendsRooms.length} />
          {loading && friendsRooms.length === 0 ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <RoomCardSkeleton />
              <RoomCardSkeleton />
            </div>
          ) : friendsRooms.length === 0 ? (
            <EmptyState compact title={tt("rooms.noFriendsRooms")} />
          ) : (
            <div className="flex flex-col gap-2">{friendsRooms.map(renderFriendRoom)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
