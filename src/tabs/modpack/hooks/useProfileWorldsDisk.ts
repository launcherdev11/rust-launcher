import type { Language } from "../../../i18n";
import { useState } from "react";
import {
  type InstanceProfile,
  type NotificationKind,
  type ProfileDiskUsage,
  type ProfileWorldInfo,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { formatByteSize } from "../../../i18n";
import { confirmDialog } from "../../../lib/confirmDialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

type ProfileWorldsDiskDeps = {
  selectedProfileId: string | null;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  selectedProfile: InstanceProfile | null;
  language: Language;
};

export function useProfileWorldsDisk(deps: ProfileWorldsDiskDeps) {
  const {
    selectedProfileId,
    tt,
    showNotification,
    selectedProfile,
    language,
  } = deps;

  const [profileWorlds, setProfileWorlds] = useState<ProfileWorldInfo[]>([]);
  const [profileWorldsLoading, setProfileWorldsLoading] = useState(false);
  const [selectedWorldPaths, setSelectedWorldPaths] = useState<Set<string>>(new Set());
  const [worldsDeleteBusy, setWorldsDeleteBusy] = useState(false);
  const [profileDiskUsage, setProfileDiskUsage] = useState<ProfileDiskUsage | null>(null);
  const [profileDiskLoading, setProfileDiskLoading] = useState(false);
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set());
  const [cleanupBusy, setCleanupBusy] = useState(false);

  async function refreshProfileWorlds(profileId: string) {
    setProfileWorldsLoading(true);
    try {
      const list = await invoke<ProfileWorldInfo[]>("list_profile_worlds", {
        profileId,
      });
      setProfileWorlds(list ?? []);
      setSelectedWorldPaths((prev) => {
        if (prev.size === 0) return prev;
        const valid = new Set((list ?? []).map((w) => w.path));
        const next = new Set<string>();
        for (const p of prev) {
          if (valid.has(p)) next.add(p);
        }
        return next;
      });
    } catch (e) {
      console.error(e);
      setProfileWorlds([]);
      setSelectedWorldPaths(new Set());
    } finally {
      setProfileWorldsLoading(false);
    }
  }

  async function handleDeleteSelectedWorlds() {
    if (!selectedProfileId || selectedWorldPaths.size === 0) return;
    const count = selectedWorldPaths.size;
    const ok = await confirmDialog({
      message: tt("modpacks.editor.worldsDeleteConfirm", { count }),
      confirmLabel: tt("common.delete"),
    });
    if (!ok) return;
    setWorldsDeleteBusy(true);
    try {
      await invoke("delete_profile_worlds", {
        profileId: selectedProfileId,
        worldPaths: Array.from(selectedWorldPaths),
      });
      showNotification("success", tt("modpacks.editor.worldsDeleted", { count }));
      setSelectedWorldPaths(new Set());
      await refreshProfileWorlds(selectedProfileId);
    } catch (e) {
      showNotification(
        "error",
        tt("modpacks.editor.worldsDeleteFailed", {
          msg: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setWorldsDeleteBusy(false);
    }
  }

  async function refreshProfileDiskUsage(profileId: string) {
    setProfileDiskLoading(true);
    try {
      const usage = await invoke<ProfileDiskUsage>("get_profile_disk_usage", {
        profileId,
      });
      setProfileDiskUsage(usage);
      setCleanupSelected(
        new Set((usage.folders ?? []).filter((f) => f.cleanable).map((f) => f.id)),
      );
    } catch (e) {
      console.error(e);
      setProfileDiskUsage(null);
    } finally {
      setProfileDiskLoading(false);
    }
  }

  async function handleCleanupProfile() {
    if (!selectedProfile || cleanupBusy) return;
    const targets = [...cleanupSelected];
    if (targets.length === 0) {
      showNotification("info", tt("modpacks.editor.cleanupNothing"));
      return;
    }
    setCleanupBusy(true);
    try {
      const result = await invoke<{ freedBytes: number; removed: string[] }>(
        "cleanup_profile",
        { profileId: selectedProfile.id, targets },
      );
      showNotification(
        "success",
        tt("modpacks.editor.cleanupDone", {
          size: formatByteSize(language, result.freedBytes ?? 0),
        }),
      );
      await refreshProfileDiskUsage(selectedProfile.id);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("modpacks.editor.cleanupFailed", { msg }));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function openProfileSubfolder(sub: "saves" | "config") {
    if (!selectedProfile) return;
    try {
      const base = selectedProfile.directory.replace(/[\\/]+$/, "");
      const sep = selectedProfile.directory.includes("\\") ? "\\" : "/";
      await revealItemInDir(`${base}${sep}${sub}`);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.editor.openFailed"));
    }
  }

  function diskFolderLabel(id: string): string {
    const map: Record<string, string> = {
      mods: "modpacks.editor.folderMods",
      resourcepacks: "modpacks.editor.folderResourcepacks",
      shaderpacks: "modpacks.editor.folderShaderpacks",
      saves: "modpacks.editor.folderSaves",
      config: "modpacks.editor.folderConfig",
      datapacks: "modpacks.editor.folderDatapacks",
      logs: "modpacks.editor.folderLogs",
      "crash-reports": "modpacks.editor.folderCrashReports",
      cache: "modpacks.editor.folderCache",
      ".cache": "modpacks.editor.folderCache",
      ".fabric": "modpacks.editor.folderFabric",
      other: "modpacks.editor.folderOther",
    };
    return tt(map[id] ?? "modpacks.editor.folderOther");
  }

  return {
    profileWorlds,
    profileWorldsLoading,
    selectedWorldPaths,
    setSelectedWorldPaths,
    worldsDeleteBusy,
    profileDiskUsage,
    profileDiskLoading,
    cleanupSelected,
    setCleanupSelected,
    cleanupBusy,
    refreshProfileWorlds,
    handleDeleteSelectedWorlds,
    refreshProfileDiskUsage,
    handleCleanupProfile,
    openProfileSubfolder,
    diskFolderLabel,
  };
}
