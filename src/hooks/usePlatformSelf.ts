import { useCallback, useEffect, useState } from "react";
import { API_NICKNAME_KEY, fetchMe, type PlatformUser } from "../api/auth";
import { fetchMyStats, type UserStats } from "../api/stats";
import { usePlatformAccessToken } from "./usePlatformAccessToken";

export type PlatformSelfState = {
  signedIn: boolean;
  user: PlatformUser | null;
  nickname: string;
  stats: UserStats | null;
  reload: () => Promise<void>;
};

function cachedNickname(): string {
  try {
    return window.localStorage.getItem(API_NICKNAME_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function usePlatformSelf(): PlatformSelfState {
  const signedIn = usePlatformAccessToken() !== "";
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [nickname, setNickname] = useState(cachedNickname);
  const [stats, setStats] = useState<UserStats | null>(null);

  const reload = useCallback(async () => {
    if (!signedIn) {
      setUser(null);
      setStats(null);
      setNickname("");
      return;
    }
    setNickname((prev) => prev || cachedNickname());
    const [me, myStats] = await Promise.allSettled([fetchMe(), fetchMyStats()]);
    if (me.status === "fulfilled") {
      setUser(me.value);
      setNickname(me.value.nickname?.trim() || "");
      if (me.value.nickname) window.localStorage.setItem(API_NICKNAME_KEY, me.value.nickname);
    }
    if (myStats.status === "fulfilled") setStats(myStats.value);
  }, [signedIn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { signedIn, user, nickname: user?.nickname?.trim() || nickname, stats, reload };
}
