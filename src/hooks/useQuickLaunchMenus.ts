import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstanceProfileCard } from "../app/types";

const QUICK_LAUNCH_LIMIT = 8;
const QUICK_LAUNCH_DEBOUNCE_MS = 1500;
const IS_WINDOWS = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

type Tt = (key: string, vars?: Record<string, string | number>) => string;

export function useQuickLaunchMenus(
  ready: boolean,
  profiles: InstanceProfileCard[],
  pinnedProfileIds: string[],
  tt: Tt,
) {
  const payload = useMemo(() => {
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const picked: InstanceProfileCard[] = [];
    for (const id of pinnedProfileIds) {
      const p = byId.get(id);
      if (p) picked.push(p);
    }
    const recent = profiles
      .filter((p) => p.last_played_at && !pinnedProfileIds.includes(p.id))
      .sort((a, b) => (b.last_played_at ?? 0) - (a.last_played_at ?? 0));
    picked.push(...recent);
    return JSON.stringify({
      category: tt("jumpList.category"),
      profiles: picked.slice(0, QUICK_LAUNCH_LIMIT).map((p) => ({
        profileId: p.id,
        name: p.name,
        description: tt("jumpList.description", {
          version: [p.game_version, p.loader !== "vanilla" ? p.loader : null].filter(Boolean).join(" · "),
        }),
      })),
    });
  }, [profiles, pinnedProfileIds, tt]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const { category, profiles: list } = JSON.parse(payload) as {
        category: string;
        profiles: { profileId: string; name: string; description: string }[];
      };
      invoke("update_tray_profiles", { title: category, profiles: list }).catch((e) => console.error(e));
      if (IS_WINDOWS) {
        invoke("update_jump_list", { category, profiles: list }).catch((e) => console.error(e));
      }
    }, QUICK_LAUNCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, payload]);
}
