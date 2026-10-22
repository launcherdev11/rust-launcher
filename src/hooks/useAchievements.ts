import { useCallback, useEffect, useState } from "react";
import { listAchievements, listUserAchievements, type AchievementRow } from "../api/achievements";
import { ApiError } from "../api/client";
import { WS_EVENT, type WsEvent } from "../api/ws";
import { HIDDEN_ACHIEVEMENT_CODES } from "../lib/achievements";
import { usePlatformAccessToken } from "./usePlatformAccessToken";

export type AchievementsState = {
  signedIn: boolean;
  achievements: AchievementRow[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

export function useAchievements(
  userId: string | null = null,
  { enabled = true }: { enabled?: boolean } = {},
): AchievementsState {
  const signedIn = usePlatformAccessToken() !== "";
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled || !signedIn) {
      setAchievements([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rows = userId ? await listUserAchievements(userId) : await listAchievements();
      setAchievements(rows.filter((row) => !HIDDEN_ACHIEVEMENT_CODES.has(row.code)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled, signedIn, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A freshly unlocked achievement arrives as a platform notification.
  useEffect(() => {
    if (!enabled || !signedIn || userId) return;
    const onWs = (ev: Event) => {
      const detail = (ev as CustomEvent<WsEvent>).detail;
      if (detail?.type === "notification" && detail.payload?.notification_type === "achievement") {
        void reload();
      }
    };
    window.addEventListener(WS_EVENT, onWs);
    return () => window.removeEventListener(WS_EVENT, onWs);
  }, [enabled, signedIn, userId, reload]);

  return { signedIn, achievements, loading, error, reload };
}
