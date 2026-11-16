import type { CSSProperties } from "react";
import type { FriendRow } from "../../api/friends";
import { localizedAchievementField } from "../../components/AchievementsPanel";
import { EmptyState, Panel, Switch } from "../../components/ui";
import type { Language } from "../../i18n";
import { setActivitySharing, useActivitySharing } from "../../lib/activityPrivacy";
import { buildInitialAvatarDataUrl } from "../../lib/avatar";
import { formatPresenceStatus } from "../../lib/socialActivity";
import type { FriendActivityEvent } from "./useFriendActivityFeed";

const MAX_VISIBLE_EVENTS = 40;

type Tt = (key: string, vars?: Record<string, string | number>) => string;

function eventText(event: FriendActivityEvent, language: Language, tt: Tt): string {
  switch (event.kind) {
    case "achievement":
      return tt("friends.feed.achievement", {
        title: localizedAchievementField(language, event.code, "title", event.title),
      });
    case "playing":
      return formatPresenceStatus(
        { user_id: event.userId, online: true, activity: event.activity },
        tt,
      );
    case "room_opened":
      return event.roomName
        ? tt("friends.feed.roomOpenedNamed", { name: event.roomName })
        : tt("friends.feed.roomOpened");
    case "room_session":
      return event.roomName
        ? tt("friends.feed.roomSessionNamed", { name: event.roomName })
        : tt("friends.feed.roomSession");
  }
}

export function FriendActivityPanel({
  events,
  friends,
  language,
  tt,
  avatarSrcFor,
  formatTime,
  onOpenProfile,
}: {
  events: FriendActivityEvent[];
  friends: FriendRow[];
  language: Language;
  tt: Tt;
  avatarSrcFor: (friend: FriendRow) => string;
  formatTime: (iso: string) => string;
  onOpenProfile: (friend: FriendRow) => void;
}) {
  const sharing = useActivitySharing();
  const friendById = new Map(friends.map((friend) => [friend.user_id, friend]));
  const visible = events.slice(0, MAX_VISIBLE_EVENTS);

  return (
    <Panel className="flex flex-col gap-3">
      <p className="ui-section">{tt("friends.feed.title")}</p>

      {visible.length === 0 ? (
        <EmptyState
          compact
          title={tt("friends.feed.empty")}
          description={tt("friends.feed.emptyHint")}
        />
      ) : (
        <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1">
          {visible.map((event, index) => {
            const friend = friendById.get(event.userId);
            if (!friend) return null;
            return (
              <li key={event.id} style={{ "--i": index } as CSSProperties} className="list-item-in">
                <button
                  type="button"
                  onClick={() => onOpenProfile(friend)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                  title={tt("friends.viewProfile")}
                >
                  <img
                    src={avatarSrcFor(friend)}
                    alt=""
                    className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20 [image-rendering:pixelated]"
                    draggable={false}
                    onError={(e) => {
                      e.currentTarget.src = buildInitialAvatarDataUrl(friend.nickname);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white/90">
                      {friend.nickname}
                    </span>
                    <span className="block break-words text-[0.8125rem] leading-snug text-white/65">
                      {eventText(event, language, tt)}
                    </span>
                    <span className="block text-[0.75rem] text-white/40">
                      {formatTime(event.at)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-start justify-between gap-3 border-t border-white/10 pt-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/85">{tt("friends.feed.shareLabel")}</p>
          <p className="ui-meta mt-0.5">{tt("friends.feed.shareHint")}</p>
        </div>
        <Switch
          checked={sharing}
          onChange={setActivitySharing}
          title={tt("friends.feed.shareLabel")}
          className="shrink-0"
        />
      </div>
    </Panel>
  );
}
