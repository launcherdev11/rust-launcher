import { useEffect, useRef } from "react";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { getStoredAccessToken } from "../api/client";
import { sendPresenceHeartbeat, sendPresenceOffline, type PresenceActivity } from "../api/presence";

const HEARTBEAT_INTERVAL_MS = 25_000;

export function usePresenceHeartbeat(activity?: PresenceActivity | null) {
  const onlineRef = useRef(false);
  const activityRef = useRef<PresenceActivity | null>(activity ?? null);

  useEffect(() => {
    activityRef.current = activity ?? null;
  }, [activity]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const markOffline = () => {
      if (!onlineRef.current) return;
      onlineRef.current = false;
      void sendPresenceOffline().catch(() => {});
    };

    const tick = async () => {
      if (cancelled) return;
      const token = getStoredAccessToken();
      if (!token) {
        stop();
        if (onlineRef.current) {
          onlineRef.current = false;
        }
        return;
      }
      try {
        await sendPresenceHeartbeat({ activity: activityRef.current });
        onlineRef.current = true;
      } catch {
      }
    };

    const start = () => {
      stop();
      if (!getStoredAccessToken()) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, HEARTBEAT_INTERVAL_MS);
    };

    const onAuthChanged = () => {
      if (getStoredAccessToken()) {
        start();
      } else {
        stop();
        markOffline();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };

    const onPageHide = () => {
      markOffline();
    };

    start();
    window.addEventListener(API_AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener(API_AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      markOffline();
    };
  }, []);
}
