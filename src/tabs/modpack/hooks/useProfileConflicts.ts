import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  type ConflictActionKind,
  conflictAffectedSet,
  detectProfileConflicts as detectProfileConflictsCore,
  guessLoaderVariant,
  type JarModInfo,
  type ProfileConflict,
} from "../../../lib/profileConflicts";
import { invoke } from "@tauri-apps/api/core";
import {
  type ContentTab,
  type InstanceProfile,
  type NotificationKind,
  type ViewId,
} from "../types";

type ProfileConflictsDeps = {
  selectedProfile: InstanceProfile | null;
  isProfileSettingsOpen: boolean;
  activeView: ViewId;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  profileConflictsRefreshToken: number;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
  setProfileConflictsRefreshToken: Dispatch<SetStateAction<number>>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
};

export function useProfileConflicts(deps: ProfileConflictsDeps) {
  const {
    selectedProfile,
    isProfileSettingsOpen,
    activeView,
    tt,
    profileConflictsRefreshToken,
    refreshItems,
    setProfileConflictsRefreshToken,
    showNotification,
  } = deps;

  const [profileConflictsLoading, setProfileConflictsLoading] = useState(false);
  const [profileConflicts, setProfileConflicts] = useState<ProfileConflict[]>([]);

  useEffect(() => {
    const shouldLoad =
      !!selectedProfile &&
      (isProfileSettingsOpen || activeView === "manage");
    if (!shouldLoad || !selectedProfile) {
      if (!isProfileSettingsOpen && activeView !== "manage") {
        setProfileConflicts([]);
        setProfileConflictsLoading(false);
      }
      return;
    }
    let cancelled = false;
    setProfileConflictsLoading(true);
    const profile = selectedProfile;
    void (async () => {
      try {
        const [entries, jarInfos] = await Promise.all([
          invoke<{ name: string; enabled: boolean }[]>("list_profile_items", {
            id: profile.id,
            category: "mods",
          }),
          invoke<JarModInfo[]>("scan_profile_mod_jars", {
            profileId: profile.id,
          }).catch(() => [] as JarModInfo[]),
        ]);
        if (cancelled) return;
        const heuristic = detectProfileConflictsCore({
          entries: entries ?? [],
          profile,
          jarInfos: jarInfos ?? [],
          tt,
        });
        let incompatible: ProfileConflict[] = [];
        try {
          const apiItems = await invoke<
            { filename: string; enabled: boolean; title?: string | null; projectId?: string | null }[]
          >("check_profile_incompatible_content", {
            profileId: profile.id,
            category: "mods",
          });
          const claimed = new Set(
            heuristic.flatMap((c) => c.affected.map((f) => f.toLowerCase())),
          );
          incompatible = (apiItems ?? [])
            .filter((m) => m.enabled)
            .filter((m) => !claimed.has(m.filename.toLowerCase()))
            .map((m) => ({
              id: `incompat:${m.filename}`,
              severity: "warning" as const,
              category: "incompatible" as const,
              title: tt("modpacks.conflicts.incompatible.title"),
              reason: tt("modpacks.conflicts.incompatible.reason", {
                name: m.title || m.filename,
              }),
              affected: [m.filename],
              solutions: [tt("modpacks.conflicts.incompatible.solutionDisable")],
              actions: [
                {
                  id: "disable",
                  label: tt("modpacks.conflicts.actions.disableIncompatible"),
                  kind: "disable_all" as const,
                },
              ],
            }));
        } catch {
        }
        if (cancelled) return;
        const seen = new Set(heuristic.map((c) => c.id));
        const merged = [
          ...heuristic,
          ...incompatible.filter((c) => !seen.has(c.id)),
        ];
        merged.sort((a, b) => {
          if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
          return 0;
        });
        setProfileConflicts(merged);
      } catch {
        if (!cancelled) setProfileConflicts([]);
      } finally {
        if (!cancelled) setProfileConflictsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    isProfileSettingsOpen,
    selectedProfile,
    profileConflictsRefreshToken,
    tt,
  ]);

  const conflictFilenames = useMemo(
    () => conflictAffectedSet(profileConflicts),
    [profileConflicts],
  );

  async function applyConflictAction(
    conflict: ProfileConflict,
    action: { kind: ConflictActionKind; keep?: string },
  ) {
    if (!selectedProfile) return;
    const affected = conflict.affected.slice();
    let toDisable: string[] = [];
    if (action.kind === "disable_all") {
      toDisable = affected;
    } else if (action.kind === "disable_wrong_loader") {
      const loader = (selectedProfile.loader ?? "").toLowerCase();
      toDisable = affected.filter((f) => {
        const v = guessLoaderVariant(f);
        return v != null && v !== loader;
      });
      if (toDisable.length === 0) toDisable = affected.slice(1);
    } else {
      const keep = action.keep ?? affected[0];
      if (!keep) return;
      toDisable = affected.filter((f) => f && f !== keep);
    }
    if (toDisable.length === 0) return;
    try {
      for (const f of toDisable) {
        await invoke("set_profile_item_enabled", {
          id: selectedProfile.id,
          category: "mods",
          filename: f,
          enabled: false,
        });
      }
      await refreshItems(selectedProfile.id, "mods");
      setProfileConflictsRefreshToken((v) => v + 1);
      showNotification("success", tt("modpacks.profileSettings.saved"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.manage.toggleFailed"));
    }
  }

  return {
    profileConflictsLoading,
    profileConflicts,
    conflictFilenames,
    applyConflictAction,
  };
}
