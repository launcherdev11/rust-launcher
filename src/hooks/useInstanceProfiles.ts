import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { reportStats } from "../api/stats";
import { getStoredAccessToken } from "../api/client";
import { readDataCache, writeDataCache } from "../lib/launcherDataCache";
import type { NotificationKind } from "../app/notifications";
import { toInstanceProfileCard, toInstanceProfileSummary } from "../app/profiles";
import type { InstanceProfileCard, InstanceProfileSummary, SidebarItemId, Tt } from "../app/types";

type UseInstanceProfilesOptions = {
  showNotification: (kind: NotificationKind, message: string) => void;
  tt: Tt;
  setActiveItemWithSound: (next: SidebarItemId) => void;
};

export function useInstanceProfiles({
  showNotification,
  tt,
  setActiveItemWithSound,
}: UseInstanceProfilesOptions) {
  const [activeInstanceProfile, setActiveInstanceProfile] = useState<InstanceProfileSummary | null>(null);
  const [knownProfiles, setKnownProfiles] = useState<InstanceProfileCard[]>([]);
  const [profilesHydrated, setProfilesHydrated] = useState(false);
  const [pinnedProfileIds, setPinnedProfileIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("modpacks_sidebar_pins");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return parsed
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .slice(0, 3);
      }
    } catch {
    }
    return [];
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("modpacks_sidebar_pins", JSON.stringify(pinnedProfileIds.slice(0, 3)));
    } catch {
    }
  }, [pinnedProfileIds]);

  const pinnedProfiles = useMemo(() => {
    const byId = new Map(knownProfiles.map((p) => [p.id, p]));
    return pinnedProfileIds.map((id) => byId.get(id)).filter((p): p is InstanceProfileCard => !!p).slice(0, 3);
  }, [knownProfiles, pinnedProfileIds]);

  const activeProfileCard = useMemo(() => {
    if (!activeInstanceProfile) return null;
    return knownProfiles.find((p) => p.id === activeInstanceProfile.id) ?? null;
  }, [activeInstanceProfile, knownProfiles]);

  useEffect(() => {
    if (!profilesHydrated) return;
    const knownIds = new Set(knownProfiles.map((p) => p.id));
    setPinnedProfileIds((prev) => prev.filter((id) => knownIds.has(id)).slice(0, 3));
  }, [knownProfiles, profilesHydrated]);

  const handleToggleSidebarPin = (profile: InstanceProfileCard) => {
    let pinLimitReached = false;
    setPinnedProfileIds((prev) => {
      if (prev.includes(profile.id)) return prev.filter((id) => id !== profile.id);
      if (prev.length >= 3) {
        pinLimitReached = true;
        return prev;
      }
      return [...prev, profile.id];
    });
    if (pinLimitReached) {
      showNotification("warning", tt("app.pinnedProfiles.pinLimit"));
    }
  };

  const handleOpenProfileInModpacks = async (profileId: string) => {
    const profile = knownProfiles.find((p) => p.id === profileId);
    if (profile) {
      setActiveInstanceProfile(toInstanceProfileSummary(profile));
    }
    try {
      await invoke("set_selected_profile", { id: profileId });
    } catch {
    }
    setActiveItemWithSound("modpacks");
  };

  const handleDeleteProfileFromSidebar = async (profileId: string) => {
    try {
      await invoke("delete_profile", { id: profileId });
      setKnownProfiles((prev) => prev.filter((p) => p.id !== profileId));
      setPinnedProfileIds((prev) => prev.filter((id) => id !== profileId));
      if (activeInstanceProfile?.id === profileId) {
        setActiveInstanceProfile(null);
      }
      showNotification("success", tt("modpacks.toast.profileDeleted"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("modpacks.toast.deleteProfileFailedWithMsg", { msg }));
    }
  };

  const handleModpackProfileSelectionChange = useCallback(
    (
      p: InstanceProfileSummary | (InstanceProfileSummary & { game_version: string; loader: string }) | null,
    ) => {
      setActiveInstanceProfile(
        p ? toInstanceProfileSummary(p) : null,
      );
    },
    [],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{
      profile_id: string;
      delta_seconds: number;
      total_seconds?: number;
    }>("playtime-updated", (event) => {
      const profileId = event.payload?.profile_id;
      const delta = Number(event.payload?.delta_seconds ?? 0);
      const totalRaw = event.payload?.total_seconds;
      const total =
        totalRaw != null && Number.isFinite(Number(totalRaw))
          ? Math.max(0, Math.floor(Number(totalRaw)))
          : null;
      if (!profileId) return;

      setKnownProfiles((prev) => {
        const next = prev.map((p) => {
          if (p.id !== profileId) return p;
          const nextSeconds =
            total != null
              ? total
              : Number.isFinite(delta) && delta > 0
                ? (p.play_time_seconds ?? 0) + Math.floor(delta)
                : p.play_time_seconds;
          return { ...p, play_time_seconds: nextSeconds };
        });
        writeDataCache("profiles", next);
        return next;
      });

      if (!Number.isFinite(delta) || delta <= 0) return;
      if (!getStoredAccessToken()) return;
      void reportStats({ playtime_seconds_delta: Math.floor(delta) }).catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const current = await invoke<InstanceProfileSummary | null>("get_selected_profile");
        if (current) {
          setActiveInstanceProfile(toInstanceProfileSummary(current));
        }
      } catch {
      }
    })();
  }, []);

  useEffect(() => {
    const cached = readDataCache<InstanceProfileCard[]>("profiles", 8_000);
    if (cached?.length) {
      setKnownProfiles(cached);
      setProfilesHydrated(true);
    }

    (async () => {
      try {
        const list = await invoke<InstanceProfileCard[]>("get_profiles");
        const mapped = list.map(toInstanceProfileCard);
        writeDataCache("profiles", mapped);
        setKnownProfiles(mapped);
      } catch {
      } finally {
        setProfilesHydrated(true);
      }
    })();
  }, []);

  const handleCreateProfileDesktopShortcut = async (profile: InstanceProfileCard) => {
    try {
      const path = await invoke<string>("create_profile_desktop_shortcut", {
        profileId: profile.id,
      });
      showNotification(
        "success",
        path
          ? `${tt("modpacks.shortcut.created")} (${path})`
          : tt("modpacks.shortcut.created"),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showNotification("error", tt("modpacks.shortcut.failed", { msg }));
    }
  };

  return {
    activeInstanceProfile,
    setActiveInstanceProfile,
    knownProfiles,
    setKnownProfiles,
    profilesHydrated,
    setProfilesHydrated,
    pinnedProfileIds,
    pinnedProfiles,
    activeProfileCard,
    handleToggleSidebarPin,
    handleOpenProfileInModpacks,
    handleDeleteProfileFromSidebar,
    handleModpackProfileSelectionChange,
    handleCreateProfileDesktopShortcut,
  };
}
