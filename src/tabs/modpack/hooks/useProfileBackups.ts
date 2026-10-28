import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  type EditorSection,
  type InstanceProfile,
  type NotificationKind,
  type ProfileBackupInfo,
  type ProfileBackupSettings,
  type ViewId,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type AutoBackupPayload = { profile_id: string; backup: ProfileBackupInfo };

type ProfileBackupsDeps = {
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  editorSection: EditorSection;
  selectedProfileId: string | null;
  refreshProfiles: (options?: { background?: boolean; }) => Promise<void>;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
};

export function useProfileBackups(deps: ProfileBackupsDeps) {
  const {
    showNotification,
    tt,
    editorSection,
    selectedProfileId,
    refreshProfiles,
    setSelectedProfileId,
    setActiveView,
  } = deps;

  const [backupsModalProfileId, setBackupsModalProfileId] = useState<string | null>(null);
  const [backupsList, setBackupsList] = useState<ProfileBackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupRestoringId, setBackupRestoringId] = useState<string | null>(null);
  const [backupSettings, setBackupSettings] = useState<ProfileBackupSettings | null>(null);

  const backupsSectionProfileId = editorSection === "backups" ? selectedProfileId : null;

  useEffect(() => {
    setBackupSettings(null);
    if (!backupsSectionProfileId) return;
    let cancelled = false;
    invoke<ProfileBackupSettings>("get_profile_backup_settings", {
      profileId: backupsSectionProfileId,
    })
      .then((settings) => {
        if (!cancelled) setBackupSettings(settings);
      })
      .catch((e) => console.warn("Failed to load backup settings:", e));
    return () => {
      cancelled = true;
    };
  }, [backupsSectionProfileId]);

  const autoBackupListenerRef = useRef<(payload: AutoBackupPayload) => void>(() => {});
  autoBackupListenerRef.current = ({ profile_id, backup }) => {
    if (backup.kind !== "auto") return;
    showNotification("success", tt("modpacks.backups.autoCreated", { name: backup.profile_name }), {
      sound: false,
    });
    if (profile_id === backupsModalProfileId || profile_id === backupsSectionProfileId) {
      void loadBackupsList(profile_id);
    }
  };

  useEffect(() => {
    const unlisten = listen<AutoBackupPayload>("profile-backup-finished", ({ payload }) =>
      autoBackupListenerRef.current(payload),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  async function updateBackupSettings(patch: Partial<ProfileBackupSettings>) {
    if (!backupsSectionProfileId || !backupSettings) return;
    const previous = backupSettings;
    const next = { ...backupSettings, ...patch };
    setBackupSettings(next);
    try {
      const saved = await invoke<ProfileBackupSettings>("set_profile_backup_settings", {
        profileId: backupsSectionProfileId,
        settings: next,
      });
      setBackupSettings(saved);
    } catch (e) {
      console.error(e);
      setBackupSettings(previous);
      showNotification("error", tt("modpacks.backups.settingsSaveFailed"));
    }
  }

  async function loadBackupsList(profileId: string) {
    setBackupsLoading(true);
    try {
      const list = await invoke<ProfileBackupInfo[]>("list_profile_backups", { profileId });
      setBackupsList(list);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.backups.loadFailed"));
      setBackupsList([]);
    } finally {
      setBackupsLoading(false);
    }
  }

  async function openBackupsModal(profileId: string) {
    setBackupsModalProfileId(profileId);
    setBackupsList([]);
    await loadBackupsList(profileId);
  }

  async function handleCreateBackup(profileId: string) {
    if (backupCreating) return;
    setBackupCreating(true);
    try {
      await invoke<ProfileBackupInfo>("create_profile_backup", { profileId });
      showNotification("success", tt("modpacks.backups.created"));
      const shouldRefreshList =
        backupsModalProfileId === profileId ||
        (editorSection === "backups" && selectedProfileId === profileId);
      if (shouldRefreshList) {
        await loadBackupsList(profileId);
      }
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification("error", tt("modpacks.backups.createFailed", { msg }));
    } finally {
      setBackupCreating(false);
    }
  }

  async function handleRestoreBackup(profileId: string, backupId: string) {
    if (backupRestoringId) return;
    setBackupRestoringId(backupId);
    try {
      const profile = await invoke<InstanceProfile>("restore_profile_backup_as_new", {
        profileId,
        backupId,
      });
      showNotification("success", tt("modpacks.backups.restored", { name: profile.name }));
      await refreshProfiles();
      setBackupsModalProfileId(null);
      setSelectedProfileId(profile.id);
      setActiveView("manage");
      void invoke("set_selected_profile", { id: profile.id });
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification("error", tt("modpacks.backups.restoreFailed", { msg }));
    } finally {
      setBackupRestoringId(null);
    }
  }

  async function handleDeleteBackup(profileId: string, backupId: string) {
    try {
      await invoke("delete_profile_backup", { profileId, backupId });
      showNotification("success", tt("modpacks.backups.deleted"));
      await loadBackupsList(profileId);
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification("error", tt("modpacks.backups.deleteFailed", { msg }));
    }
  }

  return {
    backupsModalProfileId,
    setBackupsModalProfileId,
    backupsList,
    backupsLoading,
    backupCreating,
    backupRestoringId,
    backupSettings,
    updateBackupSettings,
    loadBackupsList,
    openBackupsModal,
    handleCreateBackup,
    handleRestoreBackup,
    handleDeleteBackup,
  };
}
