import type { ReactNode } from "react";
import type { Room, RoomMember } from "../../api/rooms";
import { LoaderIcon } from "../../components/loader_icon";
import { buildInitialAvatarDataUrl } from "../../lib/avatar";
import { roomLoaderOf } from "./roomHelpers";

export type AvatarTarget = {
  nickname: string;
  ely_username?: string | null;
  mc_uuid?: string | null;
};

export type AvatarResolver = (target: AvatarTarget) => string;

const PING_GOOD_MS = 80;
const PING_FAIR_MS = 180;

export function pingToneClass(ms: number): string {
  if (ms <= PING_GOOD_MS) return "text-emerald-300";
  if (ms <= PING_FAIR_MS) return "text-warn-hi";
  return "text-danger-hi";
}

export function roomStatusTone(status: string): string {
  if (status === "open") return "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30";
  if (status === "full") return "bg-warn/15 text-warn-fg ring-warn/30";
  return "bg-white/10 text-white/60 ring-white/15";
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.75rem] font-semibold ring-1 ${roomStatusTone(status)}`}>
      {label}
    </span>
  );
}

export function PlayerAvatar({
  target,
  avatarSrcFor,
  className,
}: {
  target: AvatarTarget;
  avatarSrcFor: AvatarResolver;
  className: string;
}) {
  return (
    <img
      src={avatarSrcFor(target)}
      alt=""
      className={`shrink-0 rounded-full object-cover [image-rendering:pixelated] ${className}`}
      draggable={false}
      onError={(event) => {
        event.currentTarget.src = buildInitialAvatarDataUrl(target.nickname);
      }}
    />
  );
}

export function MemberAvatars({
  members,
  avatarSrcFor,
  max = 3,
}: {
  members: RoomMember[];
  avatarSrcFor: AvatarResolver;
  max?: number;
}) {
  const shown = members.slice(0, max);
  const extra = Math.max(0, members.length - shown.length);
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((member, index) => (
        <span key={member.user_id} title={member.nickname} className={index === 0 ? "" : "-ml-2"}>
          <PlayerAvatar
            target={member}
            avatarSrcFor={avatarSrcFor}
            className="h-8 w-8 ring-2 ring-black/70"
          />
        </span>
      ))}
      {extra > 0 ? (
        <span className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[0.75rem] font-semibold text-white/70 ring-2 ring-black/70">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

export function RoomGameTag({ room, unknownLabel }: { room: Room; unknownLabel?: string }) {
  const version = room.game_version?.trim();
  if (!version) {
    return unknownLabel ? <span className="tag">{unknownLabel}</span> : null;
  }
  const loader = roomLoaderOf(room);
  return (
    <span className="tag max-w-full">
      <LoaderIcon loader={loader} className="h-3.5 w-3.5" />
      <span className="truncate">{version}</span>
    </span>
  );
}

export function SegmentedField<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ui-caption font-semibold">{label}</span>
      <div
        className="seg-track grid gap-1 p-1"
        role="radiogroup"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                active ? "seg-on" : "text-white/60 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
