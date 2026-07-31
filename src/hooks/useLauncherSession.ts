import { useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { API_AUTH_CHANGED_EVENT } from "../api/auth";
import { getStoredAccessToken } from "../api/client";
import {
  closeLauncherSession,
  createLauncherSession,
  getStoredLauncherSessionId,
  pingLauncherSession,
} from "../api/launcherSessions";

const PING_INTERVAL_MS = 25_000;

/** Creates a launcher session on sign-in and keeps it alive via ping. */
export function useLauncherSession() {
  const sessionIdRef = useRef<string | null>(getStoredLauncherSessionId());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const closeCurrent = () => {
      const id = sessionIdRef.current;
      if (!id) return;
      sessionIdRef.current = null;
      void closeLauncherSession(id).catch(() => {});
    };

    const start = async () => {
      stop();
      if (!getStoredAccessToken()) {
        closeCurrent();
        return;
      }

      try {
        let version: string | undefined;
        try {
          version = await getVersion();
        } catch {
          version = undefined;
        }

        const session = await createLauncherSession({
          device_name: "16Launcher",
          platform: navigator.platform || "unknown",
          launcher_version: version,
        });
        if (cancelled) {
          void closeLauncherSession(session.id).catch(() => {});
          return;
        }
        sessionIdRef.current = session.id;

        timer = setInterval(() => {
          const id = sessionIdRef.current;
          if (!id || !getStoredAccessToken()) return;
          void pingLauncherSession(id).catch(() => {
            // session may have expired — recreate next auth cycle
          });
        }, PING_INTERVAL_MS);
      } catch {
        // ignore until next auth change
      }
    };

    const onAuth = () => {
      if (getStoredAccessToken()) {
        void start();
      } else {
        stop();
        closeCurrent();
      }
    };

    const onPageHide = () => {
      closeCurrent();
    };

    onAuth();
    window.addEventListener(API_AUTH_CHANGED_EVENT, onAuth);
    window.addEventListener("storage", onAuth);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener(API_AUTH_CHANGED_EVENT, onAuth);
      window.removeEventListener("storage", onAuth);
      window.removeEventListener("pagehide", onPageHide);
      closeCurrent();
    };
  }, []);
}
