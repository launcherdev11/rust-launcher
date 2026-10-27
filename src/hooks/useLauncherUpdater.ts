import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  createFallbackUpdatePopupBanner,
  fetchLauncherBanners,
  pickUpdatePopupBanner,
  readCachedLauncherBanners,
  type LauncherBannerData,
} from "../lib/launcherBanners";
import type { NotificationKind, ShowNotificationOptions } from "../app/notifications";
import type { Settings, Tt } from "../app/types";

const LAUNCHER_UPDATE_BADGE_STORAGE_KEY = "mc16launcher:lastLauncherUpdateBadge";

type UseLauncherUpdaterOptions = {
  settings: Settings | null;
  showNotification: (kind: NotificationKind, message: string, options?: ShowNotificationOptions) => void;
  tt: Tt;
};

export function useLauncherUpdater({ settings, showNotification, tt }: UseLauncherUpdaterOptions) {
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "up-to-date" | "error"
  >("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState<number | null>(null);
  const [updatePopupBanner, setUpdatePopupBanner] = useState<LauncherBannerData | null>(null);
  const [launcherVersion, setLauncherVersion] = useState<string | null>(null);
  const [launcherUpdateBadge, setLauncherUpdateBadge] = useState<"latest" | "outdated" | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = sessionStorage.getItem(LAUNCHER_UPDATE_BADGE_STORAGE_KEY);
      if (v === "latest" || v === "outdated") return v;
    } catch {
    }
    return null;
  });
  const persistLauncherUpdateBadge = useCallback((v: "latest" | "outdated") => {
    setLauncherUpdateBadge(v);
    try {
      sessionStorage.setItem(LAUNCHER_UPDATE_BADGE_STORAGE_KEY, v);
    } catch {
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setLauncherVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const installUpdate = useCallback(
    async (
      upd?: import("@tauri-apps/plugin-updater").Update | null,
    ) => {
      let update = upd;
      if (!update && updateVersion) {
        setUpdateStatus("checking");
        const u = await check();
        if (!u) {
          setUpdateStatus("available");
          return;
        }
        update = u;
      }
      if (!update) return;
      try {
        setUpdateStatus("downloading");
        setUpdateDownloadPercent(0);
        let downloaded = 0;
        let total = 0;
        await update.download((event) => {
          if (event.event === "Started" && event.data?.contentLength) {
            total = event.data.contentLength;
            downloaded = 0;
          } else if (event.event === "Progress" && event.data?.chunkLength) {
            downloaded += event.data.chunkLength;
            if (total > 0) {
              setUpdateDownloadPercent(Math.min(99, Math.round((downloaded / total) * 100)));
            }
          }
        });
        setUpdateStatus("installing");
        setUpdateDownloadPercent(100);
        await update.install();
        showNotification("success", tt("settings.updates.installedRestart"));
        await relaunch();
      } catch (e) {
        console.error("Update install failed:", e);
        setUpdateStatus("available");
        setUpdateDownloadPercent(null);
        showNotification("error", tt("settings.updates.checkFailed"));
      }
    },
    [updateVersion, showNotification, tt],
  );

  const markUpdatePopupShown = useCallback((version: string) => {
    try {
      localStorage.setItem("mc16launcher:lastShownUpdateVersion", version);
    } catch {
    }
  }, []);

  const previewUpdatePopup = useCallback(async () => {
    try {
      const cached = readCachedLauncherBanners();
      let banners = cached ?? [];
      if (!pickUpdatePopupBanner(banners)) {
        try {
          banners = await fetchLauncherBanners();
        } catch (e) {
          console.error("Failed to fetch banners for popup preview:", e);
        }
      }
      const popup =
        pickUpdatePopupBanner(banners) ?? createFallbackUpdatePopupBanner();
      setUpdatePopupBanner(popup);
      if (!updateVersion) {
        setUpdateVersion("preview");
      }
      return true;
    } catch (e) {
      console.error("Failed to preview update popup:", e);
      showNotification("error", tt("settings.updates.checkFailed"));
      return false;
    }
  }, [showNotification, tt, updateVersion]);

  const maybeShowUpdatePopup = useCallback(
    async (version: string) => {
      try {
        const cached = readCachedLauncherBanners();
        let banners = cached ?? [];
        if (!pickUpdatePopupBanner(banners)) {
          banners = await fetchLauncherBanners();
        }
        const popup = pickUpdatePopupBanner(banners);
        if (!popup) return false;
        setUpdatePopupBanner(popup);
        markUpdatePopupShown(version);
        return true;
      } catch (e) {
        console.error("Failed to load update popup banner:", e);
        return false;
      }
    },
    [markUpdatePopupShown],
  );

  useEffect(() => {
    try {
      if (localStorage.getItem("mc16launcher:forceUpdatePopup") !== "1") return;
      localStorage.removeItem("mc16launcher:forceUpdatePopup");
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      void previewUpdatePopup();
    }, 800);
    return () => window.clearTimeout(t);
  }, [previewUpdatePopup]);

  const checkForUpdate = useCallback(
    async (options?: { silent?: boolean; source?: "startup" | "manual" }) => {
      const silent = options?.silent ?? false;
      const source = options?.source ?? "manual";
      try {
        setUpdateStatus("checking");
        setUpdateVersion(null);
        const update = await check();
        if (update) {
          setUpdateVersion(update.version);
          setUpdateStatus("available");
          persistLauncherUpdateBadge("outdated");

          const notifyEnabled = settings?.notify_new_update !== false;
          const shouldNotifyManual = !silent && notifyEnabled;
          const shouldNotifyStartup = source === "startup" && notifyEnabled;
          const autoInstall = settings?.auto_install_updates === true;

          if (autoInstall) {
            void installUpdate(update);
            return;
          }

          if (shouldNotifyStartup) {
            const key = "mc16launcher:lastShownUpdateVersion";
            let lastShown: string | null = null;
            try {
              lastShown = localStorage.getItem(key);
            } catch {
              lastShown = null;
            }
            if (lastShown !== update.version) {
              const shownPopup = await maybeShowUpdatePopup(update.version);
              if (!shownPopup) {
                showNotification(
                  "info",
                  tt("settings.updates.released", { version: update.version }),
                );
                markUpdatePopupShown(update.version);
              }
            }
          } else if (shouldNotifyManual) {
            const shownPopup = await maybeShowUpdatePopup(update.version);
            if (!shownPopup) {
              showNotification(
                "info",
                tt("settings.updates.available", { version: update.version }),
              );
            }
          }
        } else {
          setUpdatePopupBanner(null);
          setUpdateStatus("up-to-date");
          persistLauncherUpdateBadge("latest");
          if (!silent) {
            showNotification("info", tt("settings.updates.noneFound"));
          }
        }
      } catch (e) {
        console.error("Update check failed:", e);
        setUpdateStatus("error");
        if (!silent) {
          showNotification("info", tt("settings.updates.checkFailed"));
        }
      }
    },
    [
      settings?.notify_new_update,
      settings?.auto_install_updates,
      showNotification,
      tt,
      installUpdate,
      persistLauncherUpdateBadge,
      maybeShowUpdatePopup,
      markUpdatePopupShown,
    ],
  );

  const checkForUpdateRef = useRef(checkForUpdate);
  checkForUpdateRef.current = checkForUpdate;
  const didStartupUpdateCheckRef = useRef(false);

  useEffect(() => {
    if (settings == null) return;
    if (settings.check_updates_on_start === false) return;
    if (didStartupUpdateCheckRef.current) return;
    const t = setTimeout(() => {
      didStartupUpdateCheckRef.current = true;
      void checkForUpdateRef.current({ silent: true, source: "startup" });
    }, 2000);
    return () => clearTimeout(t);
  }, [settings?.check_updates_on_start]);

  const launcherVersionBadgeKind = useMemo(() => {
    if (updateStatus === "available") return "outdated" as const;
    if (updateStatus === "up-to-date") return "latest" as const;
    if (launcherUpdateBadge === "outdated") return "outdated" as const;
    if (launcherUpdateBadge === "latest") return "latest" as const;
    return "unknown" as const;
  }, [updateStatus, launcherUpdateBadge]);

  return {
    updateStatus,
    updateVersion,
    updateDownloadPercent,
    updatePopupBanner,
    setUpdatePopupBanner,
    launcherVersion,
    launcherVersionBadgeKind,
    checkForUpdate,
    installUpdate,
    previewUpdatePopup,
  };
}
