import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { confirmDialog } from "../../../lib/confirmDialog";
import {
  type ContentSnapshot,
  type ContentTab,
  type InstanceProfile,
  type NotificationKind,
  type ProfileContentUpdate,
  type ProfileIncompatibleContent,
  type ProfileItemEntry,
} from "../types";
import { invoke } from "@tauri-apps/api/core";

type ContentUpdatesDeps = {
  selectedProfile: InstanceProfile | null;
  contentTab: ContentTab;
  setContentUpdatesAvailableFilenames: Dispatch<SetStateAction<Set<string>>>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  refreshItems: (id: string, tab: ContentTab) => Promise<void>;
};

export function useContentUpdates(deps: ContentUpdatesDeps) {
  const {
    selectedProfile,
    contentTab,
    setContentUpdatesAvailableFilenames,
    showNotification,
    tt,
    refreshItems,
  } = deps;

  const [contentUpdates, setContentUpdates] = useState<ProfileContentUpdate[]>([]);
  const [contentUpdatesChecking, setContentUpdatesChecking] = useState(false);
  const [contentUpdatesApplying, setContentUpdatesApplying] = useState(false);

  const [contentUpdatesSingleApplyingFilename, setContentUpdatesSingleApplyingFilename] =
    useState<string | null>(null);

  const [isContentUpdatesModalOpen, setIsContentUpdatesModalOpen] = useState(false);

  const [contentSnapshot, setContentSnapshot] = useState<ContentSnapshot | null>(null);
  const [contentRollbackBusy, setContentRollbackBusy] = useState(false);

  const profileId = selectedProfile?.id ?? null;
  const snapshotCategory =
    contentTab === "mods"
      ? "mods"
      : contentTab === "resourcepacks"
        ? "resourcepacks"
        : "shaderpacks";

  async function refreshContentSnapshot() {
    if (!profileId) {
      setContentSnapshot(null);
      return;
    }
    try {
      const list = await invoke<ContentSnapshot[]>("list_content_snapshots", { profileId });
      setContentSnapshot(list.find((s) => s.category === snapshotCategory) ?? null);
    } catch (e) {
      console.warn("Failed to list content snapshots:", e);
      setContentSnapshot(null);
    }
  }

  useEffect(() => {
    void refreshContentSnapshot();
  }, [profileId, snapshotCategory]);

  const [selectedContentUpdateFilenames, setSelectedContentUpdateFilenames] = useState<
    Set<string>

  >(new Set());

  async function applyContentUpdatesAfterVersionChange(
    profileId: string,
  ): Promise<{ updated: number; incompatible: ProfileIncompatibleContent[] }> {
    const categories = ["mods", "resourcepacks", "shaderpacks"] as const;
    let total = 0;
    for (const category of categories) {
      try {
        const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
          profileId,
          category,
        });
        if (updates.length === 0) continue;
        const payload = updates.map((u) => ({
          filename: u.filename,
          enabled: u.enabled,
          latestUrl: u.latestUrl,
          latestFilename: u.latestFilename,
          latestSha1: u.latestSha1 ?? null,
        }));
        const applied = await invoke<number>("apply_profile_content_updates", {
          profileId,
          category,
          updates: payload,
        });
        total += applied;
      } catch (e) {
        console.warn(`Content update failed for ${category}:`, e);
      }
    }

    const incompatible: ProfileIncompatibleContent[] = [];
    try {
      const mods = await invoke<ProfileIncompatibleContent[]>(
        "check_profile_incompatible_content",
        {
          profileId,
          category: "mods",
        },
      );
      for (const mod of mods) {
        incompatible.push(mod);
        if (!mod.enabled) continue;
        try {
          await invoke("set_profile_item_enabled", {
            id: profileId,
            category: "mods",
            filename: mod.filename,
            enabled: false,
          });
        } catch (e) {
          console.warn(`Failed to disable incompatible mod ${mod.filename}:`, e);
        }
      }
    } catch (e) {
      console.warn("Incompatible mods check failed:", e);
    }

    return { updated: total, incompatible };
  }

  async function handleCheckContentUpdates() {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";
    setContentUpdatesChecking(true);
    try {
      const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
      });
      setContentUpdates(updates);
      if (category === "mods") {
        setContentUpdatesAvailableFilenames(new Set(updates.map((u) => u.filename)));
      }
      if (updates.length === 0) {
        showNotification("info", tt("modpacks.contentUpdates.noneFound"));
        return;
      }
      setSelectedContentUpdateFilenames(new Set(updates.map((u) => u.filename)));
      setIsContentUpdatesModalOpen(true);
      showNotification(
        "info",
        tt("modpacks.contentUpdates.found", { count: updates.length }),
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.checkFailed", { msg }));
    } finally {
      setContentUpdatesChecking(false);
    }
  }

  async function handleApplyContentUpdates(updateAll: boolean) {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";
    const selected = updateAll
      ? contentUpdates
      : contentUpdates.filter((u) => selectedContentUpdateFilenames.has(u.filename));
    if (selected.length === 0) {
      showNotification("warning", tt("modpacks.contentUpdates.selectAtLeastOne"));
      return;
    }
    setContentUpdatesApplying(true);
    try {
      const payload = selected.map((u) => ({
        filename: u.filename,
        enabled: u.enabled,
        latestUrl: u.latestUrl,
        latestFilename: u.latestFilename,
        latestSha1: u.latestSha1 ?? null,
      }));
      const applied = await invoke<number>("apply_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
        updates: payload,
      });
      showNotification("success", tt("modpacks.contentUpdates.applied", { count: applied }));
      setIsContentUpdatesModalOpen(false);
      setContentUpdates([]);
      setSelectedContentUpdateFilenames(new Set());
      await refreshItems(selectedProfile.id, contentTab);
      await refreshContentSnapshot();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.applyFailed", { msg }));
    } finally {
      setContentUpdatesApplying(false);
    }
  }

  async function handleUpdateSingleItem(item: ProfileItemEntry) {
    if (!selectedProfile) return;
    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";

    setContentUpdatesSingleApplyingFilename(item.name);
    try {
      const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
      });
      const update = updates.find((u) => u.filename === item.name);
      if (!update) {
        setContentUpdatesAvailableFilenames((prev) => {
          if (!prev.has(item.name)) return prev;
          const next = new Set(prev);
          next.delete(item.name);
          return next;
        });
        showNotification("info", tt("modpacks.contentUpdates.noneFoundForItem"));
        return;
      }

      const applied = await invoke<number>("apply_profile_content_updates", {
        profileId: selectedProfile.id,
        category,
        updates: [
          {
            filename: update.filename,
            enabled: update.enabled,
            latestUrl: update.latestUrl,
            latestFilename: update.latestFilename,
            latestSha1: update.latestSha1 ?? null,
          },
        ],
      });

      showNotification("success", tt("modpacks.contentUpdates.applied", { count: applied }));
      await refreshItems(selectedProfile.id, contentTab);
      await refreshContentSnapshot();
      setContentUpdatesAvailableFilenames((prev) => {
        if (!prev.has(item.name)) return prev;
        const next = new Set(prev);
        next.delete(item.name);
        return next;
      });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.applyFailed", { msg }));
    } finally {
      setContentUpdatesSingleApplyingFilename(null);
    }
  }

  async function handleRollbackContentUpdate() {
    if (!selectedProfile || !contentSnapshot) return;
    const ok = await confirmDialog({
      message: tt("modpacks.contentUpdates.rollbackConfirm", {
        count: contentSnapshot.items.length,
      }),
      confirmLabel: tt("modpacks.contentUpdates.rollbackConfirmLabel"),
    });
    if (!ok) return;
    setContentRollbackBusy(true);
    try {
      const restored = await invoke<number>("restore_content_snapshot", {
        profileId: selectedProfile.id,
        snapshotId: contentSnapshot.id,
      });
      showNotification("success", tt("modpacks.contentUpdates.rollbackDone", { count: restored }));
      await refreshItems(selectedProfile.id, contentTab);
      await refreshContentSnapshot();
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", tt("modpacks.contentUpdates.rollbackFailed", { msg }));
    } finally {
      setContentRollbackBusy(false);
    }
  }

  return {
    contentSnapshot,
    contentRollbackBusy,
    handleRollbackContentUpdate,
    contentUpdates,
    contentUpdatesChecking,
    contentUpdatesApplying,
    contentUpdatesSingleApplyingFilename,
    isContentUpdatesModalOpen,
    setIsContentUpdatesModalOpen,
    selectedContentUpdateFilenames,
    setSelectedContentUpdateFilenames,
    applyContentUpdatesAfterVersionChange,
    handleCheckContentUpdates,
    handleApplyContentUpdates,
    handleUpdateSingleItem,
  };
}
