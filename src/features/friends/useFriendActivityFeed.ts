import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listUserAchievements } from "../../api/achievements";
import type { FriendRow } from "../../api/friends";
import type { PresenceActivity, PresenceInfo } from "../../api/presence";
import type { Room } from "../../api/rooms";

export type FriendActivityEvent = { id: string; userId: string; at: string } & (
  | { kind: "achievement"; code: string; title: string }
  | { kind: "playing"; activity: PresenceActivity; signature: string }
  | { kind: "room_opened" | "room_session"; roomName: string | null }
);

const STORAGE_PREFIX = "friends_activity_feed:";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 150;
const ACHIEVEMENTS_POLL_MS = 5 * 60 * 1000;
const ACHIEVEMENTS_CONCURRENCY = 4;
const SAME_SESSION_MS = 12 * 60 * 60 * 1000;

function loadEvents(owner: string): FriendActivityEvent[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + owner) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEvents(owner: string, events: FriendActivityEvent[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + owner, JSON.stringify(events));
  } catch {
  }
}

function mergeEvents(
  current: FriendActivityEvent[],
  incoming: FriendActivityEvent[],
): FriendActivityEvent[] {
  const known = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => !known.has(event.id));
  if (fresh.length === 0) return current;
  const oldest = Date.now() - RETENTION_MS;
  return [...current, ...fresh]
    .filter((event) => Date.parse(event.at) >= oldest)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_EVENTS);
}

function playingSignature(presence: PresenceInfo | undefined): string | null {
  const activity = presence?.online ? presence.activity : null;
  if (!activity || activity.kind === "launcher") return null;
  return [
    activity.kind,
    activity.modpack_name,
    activity.server_address,
    activity.world_name,
    activity.room_id,
  ].join("|");
}

function validPastTimestamp(value: string | null | undefined, nowMs: number): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs ? value : null;
}

export function useFriendActivityFeed({
  userId,
  friends,
  presenceByUserId,
  rooms,
}: {
  userId: string;
  friends: FriendRow[];
  presenceByUserId: Record<string, PresenceInfo>;
  rooms: Room[];
}): FriendActivityEvent[] {
  const [feed, setFeed] = useState<{ owner: string; events: FriendActivityEvent[] }>({
    owner: "",
    events: [],
  });
  const ready = Boolean(userId) && feed.owner === userId;
  const lastPlayingRef = useRef(new Map<string, string | null>());

  const friendKey = useMemo(
    () => friends.map((friend) => friend.user_id).sort().join(","),
    [friends],
  );
  const friendIds = useMemo(() => (friendKey ? friendKey.split(",") : []), [friendKey]);

  const addEvents = useCallback((incoming: FriendActivityEvent[]) => {
    if (incoming.length === 0) return;
    setFeed((prev) => {
      const events = mergeEvents(prev.events, incoming);
      return events === prev.events ? prev : { owner: prev.owner, events };
    });
  }, []);

  useEffect(() => {
    lastPlayingRef.current = new Map();
    setFeed({ owner: userId, events: userId ? loadEvents(userId) : [] });
  }, [userId]);

  useEffect(() => {
    if (feed.owner) saveEvents(feed.owner, feed.events);
  }, [feed]);

  useEffect(() => {
    if (!ready || friendIds.length === 0) return;
    let cancelled = false;

    const loadAchievements = async () => {
      const queue = [...friendIds];
      const worker = async () => {
        while (!cancelled) {
          const friendId = queue.shift();
          if (!friendId) return;
          try {
            const rows = await listUserAchievements(friendId);
            if (cancelled) return;
            addEvents(
              rows.flatMap((row) =>
                row.unlocked && row.unlocked_at
                  ? [
                      {
                        id: `achievement:${friendId}:${row.code}`,
                        userId: friendId,
                        at: row.unlocked_at,
                        kind: "achievement" as const,
                        code: row.code,
                        title: row.title,
                      },
                    ]
                  : [],
              ),
            );
          } catch {
          }
        }
      };
      await Promise.all(Array.from({ length: ACHIEVEMENTS_CONCURRENCY }, worker));
    };

    void loadAchievements();
    const timer = window.setInterval(() => void loadAchievements(), ACHIEVEMENTS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready, friendIds, addEvents]);

  useEffect(() => {
    if (!ready) return;
    const nowMs = Date.now();
    const incoming: FriendActivityEvent[] = [];
    for (const friendId of friendIds) {
      const presence = presenceByUserId[friendId];
      const signature = playingSignature(presence);
      const previous = lastPlayingRef.current.get(friendId);
      lastPlayingRef.current.set(friendId, signature);
      if (!signature || signature === previous || !presence?.activity) continue;
      if (previous === undefined) {
        const recent = feed.events.find(
          (event) => event.userId === friendId && event.kind === "playing",
        );
        if (
          recent?.kind === "playing" &&
          recent.signature === signature &&
          nowMs - Date.parse(recent.at) < SAME_SESSION_MS
        ) {
          continue;
        }
      }
      const at =
        validPastTimestamp(presence.activity.started_at, nowMs) ?? new Date(nowMs).toISOString();
      incoming.push({
        id: `playing:${friendId}:${signature}:${at}`,
        userId: friendId,
        at,
        kind: "playing",
        activity: presence.activity,
        signature,
      });
    }
    addEvents(incoming);
  }, [ready, friendIds, presenceByUserId, addEvents]);

  useEffect(() => {
    if (!ready) return;
    const nowMs = Date.now();
    const friendSet = new Set(friendIds);
    const incoming: FriendActivityEvent[] = [];
    for (const room of rooms) {
      if (!friendSet.has(room.owner_user_id)) continue;
      const roomName = room.name?.trim() || null;
      const openedAt = validPastTimestamp(room.created_at, nowMs);
      if (openedAt) {
        incoming.push({
          id: `room:${room.id}`,
          userId: room.owner_user_id,
          at: openedAt,
          kind: "room_opened",
          roomName,
        });
      }
      const sessionAt = validPastTimestamp(room.session_started_at, nowMs);
      if (sessionAt) {
        incoming.push({
          id: `room-session:${room.id}:${sessionAt}`,
          userId: room.owner_user_id,
          at: sessionAt,
          kind: "room_session",
          roomName,
        });
      }
    }
    addEvents(incoming);
  }, [ready, friendIds, rooms, addEvents]);

  return useMemo(() => {
    const friendSet = new Set(friendIds);
    return feed.events.filter((event) => friendSet.has(event.userId));
  }, [feed.events, friendIds]);
}
